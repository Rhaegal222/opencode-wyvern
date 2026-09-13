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
import { ensureLocalKey, ensureSshConfigAlias, installKeyOnServer, verifyConnection } from "./server.js"
import { installClient } from "./client.js"

const SAMPLE_ENTRY = { server: "remote-server", host: "server.example.com", user: "you", dir: "~" }

async function collectEntry(defaults = {}) {
  const host = await ask("IP o hostname del server remoto", {
    hint: "es. server.example.com o 192.0.2.1 (solo esempio)",
    defaultValue: defaults.host || "",
    validate: (v) => v.length > 0,
  })
  const user = await ask("Utente SSH sul server", {
    hint: "es. root, ubuntu, deploy",
    defaultValue: defaults.user || "",
  })
  const port = await ask("Porta SSH (invio = 22)", {
    defaultValue: defaults.port || "",
    validate: (v) => (v === "" ? true : /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535),
  })
  const server = await ask("Alias SSH (usato dai comandi oc-*)", {
    hint: "rigo Host in ~/.ssh/config",
    defaultValue: defaults.server || "remote-server",
    validate: (v) => /^[a-zA-Z0-9._-]+$/.test(v),
  })
  const dir = await ask("Cartella remota di default (dir sessione)", {
    hint: "es. ~ o ~/projects",
    defaultValue: defaults.dir || "~",
  })
  return { server, host, user, port, dir }
}

async function collectProviders() {
  const sel = await checkbox("Quali provider abilitare sul server?", [
    { label: "Google Gemini (@ai-sdk/google)", value: "gemini" },
    { label: "OpenCode Zen (@openai/openai-provider)", value: "zen" },
  ])
  const providers = { gemini: false, zen: false }
  sel.forEach((s) => (providers[s.value] = true))

  const models = {}
  if (providers.gemini) {
    models.gemini = await ask("Modelli Gemini (virgola)", {
      hint: "nome esatto",
      defaultValue: "gemini-2.5-pro, gemini-2.5-flash",
    })
  }
  if (providers.zen) {
    models.zen = await ask("Modelli OpenCode Zen (virgola)", {
      defaultValue: "opencode-zen-2.5-pro",
    })
  }

  const envKeys = {}
  if (providers.gemini) {
    envKeys.GOOGLE_API_KEY = await secret("API key Google (GOOGLE_API_KEY) — resta sul server", { allowEmpty: true })
  }
  if (providers.zen) {
    envKeys.ZEN_API_KEY = await secret("API key OpenCode Zen (ZEN_API_KEY) — resta sul server", { allowEmpty: true })
  }
  if (Object.values(envKeys).some(Boolean)) {
    console.log(c.dim("  (le chiavi NON vengono salvate in locale; finiscono solo in ~/.config/opencode/.env sul server, chmod 600)"))
  }
  return { providers, models, envKeys }
}

export async function run(argv = []) {
  console.log(c.bold(c.cyan("oc-setup — OpenCode Wyvern "))
    + c.dim("(setup modulare: installi tutto, attivi quello che vuoi — nessun dato privato nel pacchetto)"))
  section("Connessione")

  const cfg = loadConfig()
  const entry = await collectEntry(cfg.entry || {})

  section("Sezioni (moduli)")
  console.log(c.dim("Installi tutto e attivi/disattivi i moduli quando vuoi (oc-setup activate/deactivate)."))
  const active = await checkbox("Quali sezioni vuoi attivare ora?", SECTIONS.map((s) => ({
    label: s.label,
    value: s.id,
  })), { defaultIndices: SECTIONS.map((_, i) => i) })
  const activeIds = new Set(active.map((s) => s.value))

  let providers = {}, models = {}, envKeys = {}
  if (activeIds.has("providers")) {
    const pr = await collectProviders()
    providers = pr.providers
    models = pr.models
    envKeys = pr.envKeys
  }
  let plugins = []
  if (activeIds.has("plugins") || activeIds.has("claude-mem")) {
    const defaults = PLUGIN_CHOICES.map((_, i) => i)
    const sel = await checkbox("Plugin opencode da includere nel config server?", PLUGIN_CHOICES.map((p) => ({ label: p.label, value: p.value })), { defaultIndices: defaults })
    plugins = sel.map((s) => s.value)
  }

  const sections = Object.fromEntries(SECTIONS.map((s) => [s.id, activeIds.has(s.id)]))
  saveConfig({ entry, sections, providers, models, plugins, configuredAt: new Date().toISOString() })

  section("Applicazione")
  const localClientTargets = []
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
  } else if (activeIds.has("client-pwsh") || activeIds.has("client-bash") || activeIds.has("server") || activeIds.has("commands") || activeIds.has("providers") || activeIds.has("plugins") || activeIds.has("claude-mem")) {
    ensureSshConfigAlias(entry)
  }

  for (const t of ["client-pwsh", "client-bash"]) {
    if (activeIds.has(t)) {
      await applyLocalSection(t, { entry })
      localClientTargets.push(t)
    }
  }

  const remoteIds = activeIds.has("server") || activeIds.has("commands") || activeIds.has("providers") || activeIds.has("plugins") || activeIds.has("claude-mem")
  if (remoteIds) {
    const ok = verifyConnection(entry)
    if (!ok) console.log(c.yellow("  server non raggiungibile ora: script pronto, esegui `oc-setup generate` quando torna"))
    applyRemoteSections({ ...cfg, entry, sections, providers, models, plugins, envKeys })
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
  console.log(c.bold(c.cyan("OpenCode Wyvern — stato")))
  console.log(`  config: ${configFilePath()}`)
  console.log(`  shell : PowerShell ${pwshProfilePath()} | bash ${bashRcPath()}`)
  console.log(`  entry : ${e ? `${e.user ? e.user + "@" : ""}${e.host}${e.port && e.port !== "22" ? ":" + e.port : ""} (alias: ${e.server}, dir: ${e.dir || "~"})` : "non configurata (esegui oc-setup)"}`)
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
    await installClient(cfg.entry || SAMPLE_ENTRY, { targets: [id] })
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