import { section, pwshProfilePath, bashRcPath, configFilePath } from "./shell.js"
import { confirm, ask, checkbox, select, secret, closePrompts, c } from "./prompts.js"
import { ui } from "./i18n.js"
import { loadConfig, saveConfig } from "./config.js"
import {
  SECTIONS,
  PLUGIN_CHOICES,
  COMMAND_CHOICES,
  MCP_CHOICES,
  getSection,
  defaultSections,
  renderSection,
  applyLocalSection,
  applyRemoteSections,
  neededConfigs,
} from "./sections.js"
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  defaultOmniRouteBase,
  isPortValid,
  ensureLocalKey,
  ensureSshConfigAlias,
  installKeyOnServer,
  verifyConnection,
  MCP_PRESETS,
  buildMcpRepairScript,
  runRemote,
  runScriptLocal,
} from "./server.js"
import { installClient } from "./client.js"

const SAMPLE_ENTRY = { server: "remote-server", host: "server.example.com", user: "you", dir: "~" }
const REMOTE_SECTIONS = new Set(["server", "commands", "providers", "plugins", "claude-mem", "mcp"])

/** Scenari preimpostati: dicono quali sezioni attivare prima di iniziare. */
const SCENARIOS = [
  {
    value: "client-server",
    label: ui("Client + Server", "Client + Server"),
    desc: ui("SSH, client oc-* e bootstrap completo del server (consigliato).", "SSH, oc-* clients and full server bootstrap (recommended)."),
    sections: ["ssh", "client-pwsh", "client-bash", "server", "commands", "mcp", "providers", "plugins", "claude-mem"],
  },
  {
    value: "client-only",
    label: ui("Solo client", "Client only"),
    desc: ui("SSH + comandi oc-* nei profili locali (il server opencode resta com'è).", "SSH + oc-* commands in local profiles (the opencode server stays untouched)."),
    sections: ["ssh", "client-pwsh", "client-bash"],
  },
  {
    value: "server-only",
    label: ui("Solo server", "Server only"),
    desc: ui("Bootstrap e config del server remoto via SSH (nessun profilo client).", "Remote server bootstrap & config over SSH (no local profiles)."),
    sections: ["server", "commands", "mcp", "providers", "plugins", "claude-mem"],
  },
  {
    value: "custom",
    label: ui("Personalizzato", "Custom"),
    desc: ui("Scelgo io le sezioni una a una.", "I'll pick the sections one by one."),
    sections: null,
  },
]

/** Coordina (dove, user, porta) e alias solo per le sezioni che le richiedono. */
async function collectEntrySmart(prev, needs) {
  const d = prev || {}
  const out = {}
  if (needs.host) {
    out.host = await ask(ui("IP o hostname del server remoto", "Remote server IP or hostname"), {
      hint: ui("es. server.example.com o 192.0.2.1 (solo esempio)", "e.g. server.example.com or 192.0.2.1 (example only)"),
      defaultValue: d.host || "",
      validate: (v) => v.length > 0,
    })
    out.user = await ask(ui("Utente SSH sul server", "SSH user on the server"), {
      hint: ui("es. root, ubuntu (invio = solo hostname)", "e.g. root, ubuntu (blank = hostname only)"),
      defaultValue: d.user || "",
    })
    out.port = await ask(ui("Porta SSH (invio = 22)", "SSH port (blank = 22)"), {
      defaultValue: d.port || "",
      validate: (v) => isPortValid(v || ""),
    })
  }
  if (needs.alias) {
    out.server = await ask(ui("Nome con cui i comandi oc-* chiamano il server (alias SSH)", "Name the oc-* commands use to reach the server (SSH alias)"), {
      hint: ui("qualsiasi nome, es. server-casa — finisce in ~/.ssh/config e in OC_SERVER", "any name, e.g. home-server — stored in ~/.ssh/config and OC_SERVER"),
      defaultValue: d.server || "remote-server",
      validate: (v) => /^[a-zA-Z0-9._-]+$/.test(v),
    })
  }
  if (needs.dir) {
    const raw = await ask(ui(
      "Cartella remota di default (dir sessione, parte già dalla home dell'utente)",
      "Default remote folder (session dir, already rooted at the user's home)"),
      {
        hint: ui(
          "lascia vuoto = ~  (es. projects/foo → ~/projects/foo; /assoluto resta assoluto)",
          "leave empty = ~  (e.g. projects/foo → ~/projects/foo; /absolute stays absolute)"),
        defaultValue: d.dir && d.dir !== "~" ? d.dir : "",
      })
    out.dir = normalizeDir(raw || (d.dir && d.dir !== "~" ? d.dir : "") || "~")
  }
  return out
}

/**
 * Normalizza la cartella remota: vuoto → `~`; relativo (o `./x`) → relativo
 * alla home (`~/x`); già `~/...`/`~` resta com'è; assoluto `/...` resta tale.
 * Evita il path doppio tipo `/home/user/home/user` se l'input incappa sul default.
 */
function normalizeDir(raw) {
  const v = (raw ?? "").trim()
  if (!v) return "~"
  if (v.startsWith("/")) return v.length === 1 ? "/" : v.replace(/\/+$/, "")
  if (v === "~" || v.startsWith("~/")) return v
  return `~/${v.replace(/^\.?\//, "").replace(/\/+$/, "")}`
}

/** Raccoglie i provider attivi, gli endpoint e le chiavi (che restano solo sul server). */
async function collectProvidersCfg(prev) {
  const choices = PROVIDER_ORDER.map((id) => ({
    label: PROVIDER_META[id].name + (PROVIDER_META[id].key ? " (key in .env)" : ""),
    value: id,
  }))
  const sel = await checkbox(ui("Quali provider abilitare sul server?", "Which providers do you want to enable on the server?"), choices)
  const providers = Object.fromEntries(PROVIDER_ORDER.map((id) => [id, false]))
  sel.forEach((s) => (providers[s.value] = true))

  let omnirouteUrl = (prev && prev.omnirouteUrl) || ""
  const baseUrls = { ...(prev && prev.baseUrls) }
  if (providers.omniroute) {
    omnirouteUrl = await ask(ui("URL gateway OmniRoute (senza /v1)", "OmniRoute gateway URL (without /v1)"), {
      hint: "es. http://127.0.0.1:20128",
      defaultValue: omnirouteUrl || defaultOmniRouteBase(),
      validate: (v) => /^https?:\/\/\S+$/.test(v),
    })
  }
  for (const id of PROVIDER_ORDER) {
    if (id !== "omniroute" && providers[id] && PROVIDER_META[id].baseURLVar) {
      baseUrls[id] = await ask(ui(
        `Base URL ${PROVIDER_META[id].name}`,
        `Base URL ${PROVIDER_META[id].name}`,
      ), {
        hint: ui("endpoint OpenAI-compatible (mantiene /v1)", "OpenAI-compatible endpoint (keeps /v1)"),
        defaultValue: baseUrls[id] || PROVIDER_META[id].defBase,
        validate: (v) => /^https?:\/\/\S+$/.test(v),
      })
    }
  }

  const envKeys = {}
  for (const id of PROVIDER_ORDER) {
    const key = PROVIDER_META[id].key
    if (providers[id] && key) {
      envKeys[key] = await secret(ui(
        `API key ${PROVIDER_META[id].name} (${key}) — resta sul server`,
        `API key ${PROVIDER_META[id].name} (${key}) — stays on the server`,
      ), { allowEmpty: true })
    }
  }
  if (Object.values(envKeys).some(Boolean)) {
    console.log(c.dim(ui(
      "  (le chiavi NON vengono salvate in locale; finiscono solo in ~/.config/opencode/.env sul server, chmod 600)",
      "  (keys are NOT stored locally; they only end up in ~/.config/opencode/.env on the server, chmod 600)",
    )))
  }

  const models = Object.fromEntries(
    PROVIDER_ORDER.filter((id) => providers[id]).map((id) => [id, (PROVIDER_META[id].defModels || []).join(", ")]),
  )
  return { providers, models, envKeys, omnirouteUrl, baseUrls }
}

/** Comandi custom (file command/*.md sul server) selezionati. */
async function collectCommandsCfg(prev) {
  const prevList = (prev && prev.customCommands) || ["baseline-ui"]
  const defaultIndices = COMMAND_CHOICES
    .map((ch, i) => (prevList.includes(ch.value) || ch.default ? i : -1))
    .filter((i) => i >= 0)
  const sel = await checkbox(ui("Quali comandi custom installare sul server?", "Which custom commands to install on the server?"), COMMAND_CHOICES.map((m) => ({ label: m.label, value: m.value })), { defaultIndices })
  return { customCommands: sel.map((s) => s.value) }
}

/** Server MCP selezionati (token non richiesto: Desktop MCP usa OAuth locale). */
async function collectMcpCfg(prev) {
  const prevList = (prev && prev.mcpList) || []
  const defaultIndices = MCP_CHOICES.map((m, i) => (prevList.includes(m.value) ? i : -1)).filter((i) => i >= 0)
  const sel = await checkbox(ui("Quali server MCP abilitare nel config server?", "Which MCP servers to enable in the server config?"), MCP_CHOICES.map((m) => ({ label: m.label, value: m.value })), { defaultIndices })
  return { mcpList: sel.map((s) => s.value) }
}

export async function run(argv = []) {
  console.log(c.bold(c.cyan("oc-setup — OpenCode Wyvern "))
    + c.dim(ui(
      "(setup modulare: installi tutto, attivi quello che vuoi — nessun dato privato nel pacchetto)",
      "(modular setup: install everything, activate what you want — no private data in the package)",
    )))
  const cfg = loadConfig()

  section(ui("Scenario", "Scenario"))
  const scenario = await select(
    ui("Quale scenario configuri?", "Which scenario are you configuring?"),
    SCENARIOS.map((s) => ({ label: `${s.label} — ${s.desc}`, value: s.value, sections: s.sections })),
  )

  let applyMode = cfg?.applyMode || "ssh"
  if (scenario.value === "server-only") {
    const modeSel = await select(
      ui("Come applichi lo script sul server?", "How do you apply the script on the server?"),
      [
        { label: ui("Via SSH da questo client", "Over SSH from this client"), value: "ssh" },
        { label: ui("In locale, su questa macchina (localhost)", "Locally, on this machine (localhost)"), value: "local" },
      ],
    )
    applyMode = modeSel.value
  }

  section(ui("Moduli", "Modules"))
  let activeIds
  if (scenario.sections) {
    activeIds = new Set(scenario.sections)
    console.log(c.dim(`  ${ui("attiverò:", "will activate:")} ${SECTIONS.filter((s) => activeIds.has(s.id)).map((s) => s.id).join(", ")}`))
  } else {
    const active = await checkbox(ui("Quali sezioni vuoi attivare ora?", "Which sections do you want to activate now?"), SECTIONS.map((s) => ({
      label: s.label,
      value: s.id,
    })))
    activeIds = new Set(active.map((s) => s.value))
  }

  if (!activeIds.size) {
    console.log(c.yellow(ui(
      "  nessun modulo attivo: niente da installare. Esci e riavvia con \`oc-setup\` per sceglierne almeno uno.",
      "  no active module: nothing to install. Exit and re-run \`oc-setup\` to pick at least one.",
    )))
    closePrompts()
    return
  }

  // Ogni sezione porta con sé le sue configurazioni (vedi SECTION_CONFIGS):
  // chiediamo solo ciò che serve alle sezioni scelte, mai altro.
  const nc = neededConfigs(activeIds)
  const localOnly = applyMode === "local"

  let entry = cfg.entry || {}
  if (!localOnly) {
    section(ui("Connessione", "Connection"))
    console.log(c.dim(ui("  solo i dati necessari ai moduli che hai scelto.", "  only the data needed by the modules you picked.")))
    entry = await collectEntrySmart(entry, { host: nc.has("host"), alias: nc.has("alias"), dir: nc.has("dir") })
  }

  let providers = cfg.providers || Object.fromEntries(PROVIDER_ORDER.map((id) => [id, false]))
  let models = cfg.models || {}
  let envKeys = {}
  let omnirouteUrl = cfg.omnirouteUrl || ""
  let baseUrls = cfg.baseUrls || {}
  if (activeIds.has("providers")) {
    const p = await collectProvidersCfg(cfg)
    providers = p.providers
    models = p.models
    omnirouteUrl = p.omnirouteUrl
    baseUrls = { ...baseUrls, ...p.baseUrls }
    envKeys = { ...envKeys, ...p.envKeys }
  }

  let plugins = cfg.plugins || []
  if (activeIds.has("plugins")) {
    const sel = await checkbox(ui("Plugin opencode da includere nel config server?", "opencode plugins to include in the server config?"), PLUGIN_CHOICES.map((p) => ({ label: p.label, value: p.value })))
    plugins = sel.map((s) => s.value)
  }

  let customCommands = cfg.customCommands || []
  if (activeIds.has("commands")) {
    customCommands = (await collectCommandsCfg(cfg)).customCommands
  }

  let mcpList = (cfg.mcpList || []).filter((id) => MCP_PRESETS[id])
  if (activeIds.has("mcp")) {
    mcpList = (await collectMcpCfg(cfg)).mcpList
  }

  let tuning = cfg.tuning !== false
  if (nc.has("tuning")) {
    tuning = await confirm(ui("Aggiungo al config tool_output + compaction (default robusti)?", "Add tool_output + compaction to the config (robust defaults)?"), cfg.tuning !== false)
  }

  const sections = Object.fromEntries(SECTIONS.map((s) => [s.id, activeIds.has(s.id)]))
  saveConfig({ entry, sections, providers, models, plugins, omnirouteUrl, baseUrls, customCommands, mcpList, tuning, applyMode, configuredAt: new Date().toISOString() })

  section(ui("Applicazione", "Application"))
  const anyClient = activeIds.has("client-pwsh") || activeIds.has("client-bash")
  if (!activeIds.has("ssh") && anyClient && !entry.host) {
    console.log(c.dim(ui(
      `  client senza host: oc-* userà l'alias \`${entry.server}\`. Assicurati che ~/.ssh/config lo definisca.`,
      `  client without host: oc-* will use the alias \`${entry.server}\`. Make sure ~/.ssh/config defines it.`,
    )))
  }

if (!localOnly) {
    const { key } = ensureLocalKey()
    console.log(c.dim(ui("  chiave:", "  key:") + ` ${key}`))
  }

  if (!localOnly && activeIds.has("ssh")) {
    ensureSshConfigAlias(entry)
    const doInstall = await confirm(ui(
      `Installo la chiave pubblica su ${entry.user ? entry.user + "@" : ""}${entry.host} (password una volta)?`,
      `Install the public key on ${entry.user ? entry.user + "@" : ""}${entry.host} (one-time password)?`,
    ), true)
    if (doInstall) {
      try {
        installKeyOnServer(entry)
        if (verifyConnection(entry)) {
          console.log(c.green(ui("  autenticazione SSH a chiave verificata.", "  SSH key authentication verified.")))
        } else {
          console.log(c.yellow(ui(
            "  attenzione: la chiave e' stata copiata, ma l'accesso senza password non e' stato verificato. Controlla sshd e ~/.ssh/authorized_keys sul server.",
            "  warning: the key was copied, but passwordless login could not be verified. Check sshd and ~/.ssh/authorized_keys on the server.",
          )))
        }
      } catch (err) {
        console.log(c.yellow(`  ${ui("attenzione:", "warning:")} ${err.message}`))
      }
    }
  } else if (!localOnly && entry.host && (activeIds.has("client-pwsh") || activeIds.has("client-bash"))) {
    ensureSshConfigAlias(entry)
  }

  const localClientTargets = []
  for (const t of ["client-pwsh", "client-bash"]) {
    if (activeIds.has(t)) {
      await applyLocalSection(t, { entry })
      localClientTargets.push(t)
    }
  }

  if ([...REMOTE_SECTIONS].some((id) => activeIds.has(id))) {
    const saved = loadConfig()
    if (!localOnly) {
      const ok = verifyConnection(entry)
      if (!ok) console.log(c.yellow(ui(
        "  server non raggiungibile ora: script pronto, esegui `oc-setup generate` quando torna",
        "  server unreachable now: script ready, run `oc-setup generate` when it's back",
      )))
      applyRemoteSections(saved, { envKeys, applyMode: "ssh" })
    } else {
      try {
        applyRemoteSections(saved, { envKeys, applyMode: "local" })
      } catch (err) {
        console.log(c.yellow(`  ${ui("attenzione:", "warning:")} ${err.message}`))
      }
    }
    await repairMcp(saved)
  }

  console.log(c.green(`\n${ui("Fatto.", "Done.")}`))
  console.log(`  config    : ${configFilePath()} ${ui("(solo dati non sensibili)", "(non-sensitive data only)")}`)
  printMcpHints(saved, localOnly)
  if (localClientTargets.length) {
    console.log(ui(
      `  client    : ${localClientTargets.map((t) => t === "client-pwsh" ? "PowerShell" : "bash").join(", ")} → ricarica profilo per attivare i comandi oc-*`,
      `  client    : ${localClientTargets.map((t) => t === "client-pwsh" ? "PowerShell" : "bash").join(", ")} → reload profile to activate the oc-* commands`,
    ))
  }
  closePrompts()
}

// ---------- subcomandi ----------

export async function cmdStatus() {
  const cfg = loadConfig()
  const e = cfg.entry
  const providers = cfg.providers && Object.entries(cfg.providers).filter(([, v]) => v).map(([k]) => k)
  console.log(c.bold(c.cyan(ui("OpenCode Wyvern — stato", "OpenCode Wyvern — status"))))
  console.log(`  config: ${configFilePath()}`)
  console.log(`  shell : PowerShell ${pwshProfilePath()} | bash ${bashRcPath()}`)
  console.log(`  entry : ${e ? `${e.user ? e.user + "@" : ""}${e.host || e.server}${e.port && e.port !== "22" ? ":" + e.port : ""} (alias: ${e.server || "-"}, dir: ${e.dir || "~"})` : ui("non configurata (esegui oc-setup)", "not configured (run oc-setup)")}`)
  if (cfg.applyMode === "local") console.log(`  apply : ${ui("in locale (localhost, senza SSH)", "local (localhost, no SSH)")}`)
  if (providers?.length) {
    const urls = providers.includes("omniroute") ? [`omniroute ${cfg.omnirouteUrl}`] : []
    for (const [id, url] of Object.entries(cfg.baseUrls || {})) urls.push(`${id} ${url}`)
    console.log(`  server: provider ${providers.join(", ")}${urls.length ? ` · ${urls.join(" · ")}` : ""}${cfg.tuning ? ui(" · tuning on", " · tuning on") : ""}`)
  }
  if (cfg.customCommands?.length) console.log(`  cmds  : ${cfg.customCommands.map((x) => "/" + x).join(", ")}`)
  const mcpList = (cfg.mcpList || []).filter((id) => MCP_PRESETS[id])
  if (mcpList.length) console.log(`  mcp   : ${mcpList.join(", ")}`)
  console.log("")
  console.log(ui("  moduli:", "  modules:"))
  for (const s of SECTIONS) {
    const active = cfg.sections?.[s.id]
    console.log(`   ${active ? c.green("●") : c.dim("○")}  ${s.id.padEnd(12)} ${active ? c.dim(s.label) : c.dim(s.label + ui(" (disattivo)", " (inactive)"))}`)
  }
}

export async function cmdActivate(id) {
  if (!getSection(id)) return fail(ui("sezione sconosciuta:", "unknown section:") + ` ${id}`)
  const cfg = loadConfig()
  cfg.sections = { ...defaultSections(), ...(cfg.sections || {}), [id]: true }
  saveConfig(cfg)
  console.log(c.green(`  ${ui("sezione attivata:", "section activated:")} ${id}`))
  if (getSection(id).kind === "remote") {
    console.log(c.dim(`  ${ui("per applicarla sul server: oc-setup generate", "to apply it on the server: oc-setup generate")}`))
  } else if (id === "client-pwsh" || id === "client-bash") {
    await installClient(cfg.entry || SAMPLE_ENTRY, { targets: [id === "client-bash" ? "bash" : "pwsh"] })
  }
}

export async function cmdDeactivate(id) {
  if (!getSection(id)) return fail(ui("sezione sconosciuta:", "unknown section:") + ` ${id}`)
  const cfg = loadConfig()
  cfg.sections = { ...defaultSections(), ...(cfg.sections || {}), [id]: false }
  saveConfig(cfg)
  console.log(c.yellow(`  ${ui("sezione disattivata:", "section deactivated:")} ${id}`))
}

export async function cmdGenerate() {
  const cfg = loadConfig()
  if (!cfg.entry) return fail(ui("nessuna config: esegui prima `oc-setup`", "no config: run `oc-setup` first"))
  const act = new Set(Object.entries(cfg.sections || {}).filter(([, v]) => v).map(([k]) => k))
  for (const id of ["client-pwsh", "client-bash"]) {
    if (act.has(id)) await applyLocalSection(id, { entry: cfg.entry })
  }
  if (act.has("ssh")) {
    ensureSshConfigAlias(cfg.entry)
    console.log(c.dim(ui("  alias SSH assicurato.", "  SSH alias ensured.")))
    console.log(c.dim(ui("  chiave: install via `oc-setup` se server raggiungibile.", "  key: install via `oc-setup` if the server is reachable.")))
  }
  const remote = [...act].filter((id) => getSection(id)?.kind === "remote").length
  if (remote) applyRemoteSections(cfg)
  await repairMcp(cfg)
  printMcpHints(cfg)
}

export async function cmdPrint(id) {
  if (!getSection(id)) return fail(ui("sezione sconosciuta:", "unknown section:") + ` ${id}`)
  const cfg = loadConfig()
  const rendered = renderSection(id, cfg.entry ? cfg : SAMPLE_ENTRY)
  if (!rendered) return fail(ui("sezione non stampabile:", "section not printable:") + ` ${id}`)
  console.log(rendered.content)
}

export async function cmdRepair() {
  const cfg = loadConfig()
  await repairMcp(cfg)
}

async function repairMcpLocal() {
  try {
    runScriptLocal(buildMcpRepairScript(), { label: ui(
      "[..] Riparazione chirurgica opencode.json in locale...",
      "[..] Repairing opencode.json locally (surgical)...",
    )})
  } catch (err) {
    console.error(c.red(`  ${ui("attenzione:", "warning:")} ${err.message}`))
  }
}

async function repairMcp(cfg, { applyMode } = {}) {
  const entry = cfg.entry
  const mode = applyMode || cfg.applyMode || "ssh"
  if (mode === "local" || !entry) {
    return repairMcpLocal()
  }
  const script = buildMcpRepairScript()
  const ok = verifyConnection(entry)
  if (!ok) {
    console.log(c.yellow(ui(
      `  server non raggiungibile: repair MCP rimandato — esegui \`oc-setup repair\` quando torna.`,
      `  server unreachable: MCP repair deferred — run \`oc-setup repair\` once it's back.`,
    )))
    return
  }
  runRemote(entry, script, { label: ui(
    "[..] Riparazione chirurgica opencode.json sul server...",
    "[..] Repairing opencode.json on the server (surgical)...",
  )})
}

/** Nota operativa MCP Figma: solo se il server è remoto serve inoltrare la porta del Figma desktop. */
function printMcpHints(cfg, localOnly = false) {
  if (!cfg || typeof cfg !== "object") return
  if (localOnly) return
  const mcpActive = !!cfg.sections?.["mcp"]
  const hasFigma = (cfg.mcpList || []).filter((id) => MCP_PRESETS[id]).includes("figma")
  const remoteHost = cfg.entry?.host && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(cfg.entry.host)
  if (mcpActive && hasFigma && remoteHost) {
    console.log(c.dim(ui(
      `  figma : server remoto → il Figma desktop gira sul client: apri un terminale sul client e inoltra la porta con \`ssh -R 3845:127.0.0.1:3845 ${cfg.entry.host}\``,
      `  figma : remote server → Figma desktop runs on the client: open a terminal on the client and forward the port with \`ssh -R 3845:127.0.0.1:3845 ${cfg.entry.host}\``,
    )))
  }
}

function fail(msg) {
  console.error(c.red(msg))
}

// mantiene compat con vecchio bin: per --print-client
export async function runPrintClient(kind) {
  const id = kind === "bash" ? "client-bash" : "client-pwsh"
  await cmdPrint(id)
}
