import { section, pwshProfilePath, bashRcPath, configFilePath } from "./shell.js"
import { confirm, ask, checkbox, secret, closePrompts, c } from "./prompts.js"
import { loadConfig, saveConfig } from "./config.js"
import {
  SECTIONS,
  PLUGIN_CHOICES,
  getSection,
  defaultSections,
  renderSection,
  applyLocalSection,
  applyRemoteSections,
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
} from "./server.js"
import { installClient } from "./client.js"

const SAMPLE_ENTRY = { server: "remote-server", host: "server.example.com", user: "you", dir: "~" }
const REMOTE_SECTIONS = new Set(["server", "commands", "providers", "plugins", "claude-mem"])

/** Coordina (dove, user, porta) e alias solo per le sezioni che le richiedono. */
async function collectEntrySmart(prev, needs) {
  const d = prev || {}
  const out = {}
  if (needs.host) {
    out.host = await ask("IP o hostname del server remoto", {
      hint: "es. server.example.com o 192.0.2.1 (solo esempio)",
      defaultValue: d.host || "",
      validate: (v) => v.length > 0,
    })
    out.user = await ask("Utente SSH sul server", {
      hint: "es. root, ubuntu (invio = solo hostname)",
      defaultValue: d.user || "",
    })
    out.port = await ask("Porta SSH (invio = 22)", {
      defaultValue: d.port || "",
      validate: (v) => isPortValid(v || ""),
    })
  }
  if (needs.alias) {
    out.server = await ask("Alias SSH (usato dai comandi oc-*)", {
      hint: "rigo Host in ~/.ssh/config",
      defaultValue: d.server || "remote-server",
      validate: (v) => /^[a-zA-Z0-9._-]+$/.test(v),
    })
  }
  if (needs.dir) {
    out.dir = await ask("Cartella remota di default (dir sessione)", {
      hint: "es. ~ o ~/projects",
      defaultValue: d.dir || "~",
    })
  }
  return out
}

/** Raccoglie i provider attivi, gli endpoint e le chiavi (che restano solo sul server). */
async function collectProvidersCfg(prev) {
  const choices = PROVIDER_ORDER.map((id) => ({
    label: PROVIDER_META[id].name + (PROVIDER_META[id].key ? " (key in .env)" : ""),
    value: id,
  }))
  const sel = await checkbox("Quali provider abilitare sul server?", choices)
  const providers = Object.fromEntries(PROVIDER_ORDER.map((id) => [id, false]))
  sel.forEach((s) => (providers[s.value] = true))

  let omnirouteUrl = (prev && prev.omnirouteUrl) || ""
  if (providers.omniroute) {
    omnirouteUrl = await ask("URL gateway OmniRoute (senza /v1)", {
      hint: "es. http://127.0.0.1:20128",
      defaultValue: omnirouteUrl || defaultOmniRouteBase(),
      validate: (v) => /^https?:\/\/\S+$/.test(v),
    })
  }

  const envKeys = {}
  for (const id of PROVIDER_ORDER) {
    const key = PROVIDER_META[id].key
    if (providers[id] && key) {
      envKeys[key] = await secret(`API key ${PROVIDER_META[id].name} (${key}) — resta sul server`, { allowEmpty: true })
    }
  }
  if (Object.values(envKeys).some(Boolean)) {
    console.log(c.dim("  (le chiavi NON vengono salvate in locale; finiscono solo in ~/.config/opencode/.env sul server, chmod 600)"))
  }

  const models = Object.fromEntries(
    PROVIDER_ORDER.filter((id) => providers[id]).map((id) => [id, (PROVIDER_META[id].defModels || []).join(", ")]),
  )
  return { providers, models, envKeys, omnirouteUrl }
}

export async function run(argv = []) {
  console.log(c.bold(c.cyan("oc-setup — OpenCode Wyvern "))
    + c.dim("(setup modulare: installi tutto, attivi quello che vuoi — nessun dato privato nel pacchetto)"))
  section("Moduli")

  const cfg = loadConfig()
  const active = await checkbox("Quali sezioni vuoi attivare ora?", SECTIONS.map((s) => ({
    label: s.label,
    value: s.id,
  })))
  const activeIds = new Set(active.map((s) => s.value))

  if (!activeIds.size) {
    console.log(c.yellow("  nessun modulo attivo: niente da installare. Esci e riavvia con \`oc-setup\` per sceglierne almeno uno."))
    closePrompts()
    return
  }

  const needs = {
    host: activeIds.has("ssh") || [...REMOTE_SECTIONS].some((id) => activeIds.has(id)),
    alias: activeIds.has("ssh") || activeIds.has("client-pwsh") || activeIds.has("client-bash"),
    dir: activeIds.has("client-pwsh") || activeIds.has("client-bash"),
  }

  section("Connessione")
  console.log(c.dim("  solo i dati necessari ai moduli che hai scelto."))
  const entry = await collectEntrySmart(cfg.entry || {}, needs)

  let providers = cfg.providers || Object.fromEntries(PROVIDER_ORDER.map((id) => [id, false]))
  let models = cfg.models || {}
  let envKeys = {}
  let omnirouteUrl = cfg.omnirouteUrl || ""
  if (activeIds.has("providers")) {
    const p = await collectProvidersCfg(cfg)
    providers = p.providers
    models = p.models
    omnirouteUrl = p.omnirouteUrl
    envKeys = p.envKeys
  }

  let plugins = cfg.plugins || []
  if (activeIds.has("plugins")) {
    const sel = await checkbox("Plugin opencode da includere nel config server?", PLUGIN_CHOICES.map((p) => ({ label: p.label, value: p.value })))
    plugins = sel.map((s) => s.value)
  }

  let tuning = cfg.tuning !== false
  if (activeIds.has("providers") || activeIds.has("plugins") || activeIds.has("claude-mem") || activeIds.has("server")) {
    tuning = await confirm("Aggiungo al config tool_output + compaction (default robusti)?", cfg.tuning !== false)
  }

  const sections = Object.fromEntries(SECTIONS.map((s) => [s.id, activeIds.has(s.id)]))
  saveConfig({ entry, sections, providers, models, plugins, omnirouteUrl, tuning, configuredAt: new Date().toISOString() })

  section("Applicazione")
  const anyClient = activeIds.has("client-pwsh") || activeIds.has("client-bash")
  if (!activeIds.has("ssh") && anyClient && !entry.host) {
    console.log(c.dim(`  client senza host: oc-* userà l'alias \`${entry.server}\`. Assicurati che ~/.ssh/config lo definisca.`))
  }

  const { key } = ensureLocalKey()
  console.log(c.dim(`  chiave: ${key}`))

  if (activeIds.has("ssh")) {
    ensureSshConfigAlias(entry)
    const doInstall = await confirm(`Installo la chiave pubblica su ${entry.user ? entry.user + "@" : ""}${entry.host} (password una volta)?`, true)
    if (doInstall) {
      try {
        installKeyOnServer(entry)
      } catch (err) {
        console.log(c.yellow(`  attenzione: ${err.message}`))
      }
    }
  } else if (entry.host && (activeIds.has("client-pwsh") || activeIds.has("client-bash") || [...REMOTE_SECTIONS].some((id) => activeIds.has(id)))) {
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
    const ok = verifyConnection(entry)
    if (!ok) console.log(c.yellow("  server non raggiungibile ora: script pronto, esegui `oc-setup generate` quando torna"))
    const saved = loadConfig()
    applyRemoteSections(saved, { envKeys })
  }

  console.log(c.green("\nFatto."))
  console.log(`  config    : ${configFilePath()} (solo dati non sensibili)`)
  if (localClientTargets.length) {
    console.log(`  client    : ${localClientTargets.map((t) => t === "client-pwsh" ? "PowerShell" : "bash").join(", ")} → ricarica profilo per attivare i comandi oc-*`)
  }
  closePrompts()
}

// ---------- subcomandi ----------

export async function cmdStatus() {
  const cfg = loadConfig()
  const e = cfg.entry
  const providers = cfg.providers && Object.entries(cfg.providers).filter(([, v]) => v).map(([k]) => k)
  console.log(c.bold(c.cyan("OpenCode Wyvern — stato")))
  console.log(`  config: ${configFilePath()}`)
  console.log(`  shell : PowerShell ${pwshProfilePath()} | bash ${bashRcPath()}`)
  console.log(`  entry : ${e ? `${e.user ? e.user + "@" : ""}${e.host || e.server}${e.port && e.port !== "22" ? ":" + e.port : ""} (alias: ${e.server || "-"}, dir: ${e.dir || "~"})` : "non configurata (esegui oc-setup)"}`)
  if (providers?.length) console.log(`  server: provider ${providers.join(", ")}${cfg.omnirouteUrl ? ` · omniroute ${cfg.omnirouteUrl}` : ""}${cfg.tuning ? " · tuning on" : ""}`)
  console.log("")
  console.log("  moduli:")
  for (const s of SECTIONS) {
    const active = cfg.sections?.[s.id]
    console.log(`   ${active ? c.green("●") : c.dim("○")}  ${s.id.padEnd(12)} ${active ? c.dim(s.label) : c.dim(s.label + " (disattivo)")}`)
  }
}

export async function cmdActivate(id) {
  if (!getSection(id)) return fail(`sezione sconosciuta: ${id}`)
  const cfg = loadConfig()
  cfg.sections = { ...defaultSections(), ...(cfg.sections || {}), [id]: true }
  saveConfig(cfg)
  console.log(c.green(`  sezione attivata: ${id}`))
  if (getSection(id).kind === "remote") {
    console.log(c.dim(`  per applicarla sul server: oc-setup generate`))
  } else if (id === "client-pwsh" || id === "client-bash") {
    await installClient(cfg.entry || SAMPLE_ENTRY, { targets: [id === "client-bash" ? "bash" : "pwsh"] })
  }
}

export async function cmdDeactivate(id) {
  if (!getSection(id)) return fail(`sezione sconosciuta: ${id}`)
  const cfg = loadConfig()
  cfg.sections = { ...defaultSections(), ...(cfg.sections || {}), [id]: false }
  saveConfig(cfg)
  console.log(c.yellow(`  sezione disattivata: ${id}`))
}

export async function cmdGenerate() {
  const cfg = loadConfig()
  if (!cfg.entry) return fail("nessuna config: esegui prima `oc-setup`")
  const act = new Set(Object.entries(cfg.sections || {}).filter(([, v]) => v).map(([k]) => k))
  for (const id of ["client-pwsh", "client-bash"]) {
    if (act.has(id)) await applyLocalSection(id, { entry: cfg.entry })
  }
  if (act.has("ssh")) {
    ensureSshConfigAlias(cfg.entry)
    console.log(c.dim("  alias SSH assicurato."))
    console.log(c.dim("  chiave: install via `oc-setup` se server raggiungibile."))
  }
  const remote = [...act].filter((id) => getSection(id)?.kind === "remote").length
  if (remote) applyRemoteSections(cfg)
}

export async function cmdPrint(id) {
  if (!getSection(id)) return fail(`sezione sconosciuta: ${id}`)
  const cfg = loadConfig()
  const rendered = renderSection(id, cfg.entry ? cfg : SAMPLE_ENTRY)
  if (!rendered) return fail(`sezione non stampabile: ${id}`)
  console.log(rendered.content)
}

function fail(msg) {
  console.error(c.red(msg))
}

// mantiene compat con vecchio bin: per --print-client
export async function runPrintClient(kind) {
  const id = kind === "bash" ? "client-bash" : "client-pwsh"
  await cmdPrint(id)
}