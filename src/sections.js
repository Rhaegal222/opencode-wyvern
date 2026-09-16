import { c } from "./prompts.js"
import { ui } from "./i18n.js"
import { renderClient, installClient } from "./client.js"
import { buildRemoteScript, runRemote, runScriptLocal, verifyConnection, chooseDefaultModels } from "./server.js"

/**
 * Catalogo delle sezioni del setup. Ogni sezione è un modulo indipendente:
 * l'utente installa tutto (i dati vengono raccolti una volta) e attiva
 * solo le sezioni che vuole. Nessuna sezione contiene dati sensibili.
 * host/utente/chiavi sono richiesti al setup, mai presenti qui.
 */
export const SECTIONS = [
  {
    id: "ssh",
    kind: "local",
    group: "core",
    label: ui("SSH — chiave, alias, install sul server", "SSH — key, alias, server install"),
    desc: ui(
      "Genera/riusa ~/.ssh/id_ed25519 (senza passphrase), aggiunge l'alias a ~/.ssh/config e installa la chiave sul server (password una volta).",
      "Generates/reuses ~/.ssh/id_ed25519 (no passphrase), adds the alias to ~/.ssh/config and installs the key on the server (one-time password).",
    ),
  },
  {
    id: "client-pwsh",
    kind: "local",
    group: "client",
    label: ui("Client PowerShell — comandi oc-*", "PowerShell client — oc-* commands"),
    desc: ui(
      "Blocco oc-*, oc-go, oc-resume, oc-recap nel profilo PowerShell.",
      "oc-*, oc-go, oc-resume, oc-recap block in the PowerShell profile.",
    ),
  },
  {
    id: "client-bash",
    kind: "local",
    group: "client",
    label: ui("Client bash — comandi oc-*", "bash client — oc-* commands"),
    desc: ui(
      "Stesso blocco in ~/.bashrc.",
      "Same block in ~/.bashrc.",
    ),
  },
  {
    id: "server",
    kind: "remote",
    group: "server",
    label: ui("Server — bootstrap opencode", "Server — opencode bootstrap"),
    desc: ui(
      "Controlla node/npm, installa opencode se manca, crea ~/.config/opencode e AGENTS.md.",
      "Checks node/npm, installs opencode if missing, creates ~/.config/opencode and AGENTS.md.",
    ),
  },
  {
    id: "commands",
    kind: "remote",
    group: "server",
    label: ui(
      "Server — comandi custom (/baseline-ui, /review, /omniroute-restart…)",
      "Server — custom commands (/baseline-ui, /review, /omniroute-restart…)",
    ),
    desc: ui(
      "Scrive i comandi selezionati in ~/.config/opencode/command/*.md (agent in opencode).",
      "Writes the selected commands to ~/.config/opencode/command/*.md (opencode agents).",
    ),
  },
  {
    id: "providers",
    kind: "remote",
    group: "server",
    label: ui(
      "Server — provider (Copilot, Gemini, Zen, Anthropic, OpenAI, OmniRoute, Ollama)",
      "Server — providers (Copilot, Gemini, Zen, Anthropic, OpenAI, OmniRoute, Ollama)",
    ),
    desc: ui(
      "SDK + blocco provider in opencode.json; API key in .env sul server (chmod 600).",
      "SDK + provider block in opencode.json; API keys in .env on the server (chmod 600).",
    ),
  },
  {
    id: "plugins",
    kind: "remote",
    group: "server",
    label: ui(
      "Server — plugin (copilot-auth, claude-auth, kimi, omniroute)",
      "Server — plugins (copilot-auth, claude-auth, kimi, omniroute)",
    ),
    desc: ui(
      "Plugin npm installati in ~/.config/opencode e listati in opencode.json.",
      "npm plugins installed in ~/.config/opencode and listed in opencode.json.",
    ),
  },
  {
    id: "claude-mem",
    kind: "remote",
    group: "server",
    label: ui("Server — claude-mem (memoria)", "Server — claude-mem (memory)"),
    desc: ui(
      "Installa opcode-mem + wrapper plugins/claude-mem-plugin.js.",
      "Installs opcode-mem + plugins/claude-mem-plugin.js wrapper.",
    ),
  },
]

/**
 * Configurazioni associate a ciascuna sezione: il wizard chiede SOLO quelle
 * delle sezioni selezionate (principio "ogni sezione → le sue config").
 * Le config di connessione (host/user/port) sono condivise: chiunque le
 * richieda le riceve una volta sola.
 */
const SSH_CONN = ["host", "user", "port"]
export const SECTION_CONFIGS = {
  ssh: [...SSH_CONN, "alias", "keyInstall"],
  "client-pwsh": ["alias", "dir"],
  "client-bash": ["alias", "dir"],
  server: [...SSH_CONN, "tuning"],
  commands: [...SSH_CONN, "customCommands"],
  providers: [...SSH_CONN, "providersList", "omnirouteUrl", "apiKeys", "tuning"],
  plugins: [...SSH_CONN, "pluginsList", "tuning"],
  "claude-mem": [...SSH_CONN, "tuning"],
}

/** Unione delle configurazioni richieste da un insieme di sezioni. */
export function neededConfigs(sectionIds) {
  const set = new Set()
  for (const id of sectionIds) for (const k of SECTION_CONFIGS[id] || []) set.add(k)
  return set
}

export const PLUGIN_CHOICES = [
  { label: ui("copilot-auth (auth GitHub Copilot)", "copilot-auth (GitHub Copilot auth)"), value: "copilot-auth" },
  { label: ui("claude-auth (auth Claude)", "claude-auth (Claude auth)"), value: "claude-auth" },
  { label: "kimi-subscription", value: "kimi" },
  { label: ui("omniroute (gateway multi-modello)", "omniroute (multi-model gateway)"), value: "omniroute" },
]

export const COMMAND_CHOICES = [
  { label: "/baseline-ui — " + ui("baseline interfacce/strutture", "interface/structure baseline"), value: "baseline-ui", default: true },
  { label: "/omniroute-restart — " + ui("riavvia il container Docker OmniRoute", "restarts the OmniRoute Docker container"), value: "omniroute-restart" },
  { label: "/review — " + ui("checklist code review", "code review checklist"), value: "review" },
  { label: "/refactor — " + ui("piano di refactoring", "refactoring plan"), value: "refactor" },
  { label: "/tests — " + ui("genera casi di test", "generates test cases"), value: "tests" },
  { label: "/commit — " + ui("messaggio commit convenzionale", "conventional commit message"), value: "commit" },
  { label: "/explain — " + ui("spiega un blocco di codice", "explains a code block"), value: "explain" },
]

export function getSection(id) {
  return SECTIONS.find((s) => s.id === id)
}

/** Set degli id di sezione attivi da config. */
export function activeSections(cfg) {
  const map = cfg.sections || {}
  return new Set(Object.entries(map).filter(([, v]) => v).map(([k]) => k))
}

export function defaultSections() {
  return Object.fromEntries(SECTIONS.map((s) => [s.id, true]))
}

/** Provider attivi da config (chiavi booleane dell'oggetto cfg.providers). */
export function activeProviders(cfg) {
  const p = cfg.providers || {}
  return new Set(Object.entries(p).filter(([, v]) => v).map(([k]) => k))
}

/** Stato server derivato dalla config (provider/plugin/claude-mem/estensioni). */
export function serverState(cfg) {
  const sections = activeSections(cfg)
  const providers = activeProviders(cfg)
  const plugins = cfg.plugins || []
  const models = cfg.models || {}
  const omnirouteUrl = cfg.omnirouteUrl || ""
  const { defaultModel, smallModel } = chooseDefaultModels(providers, models, omnirouteUrl)
  return {
    sections,
    providers,
    plugins,
    claudeMem: sections.has("claude-mem"),
    models,
    omnirouteUrl,
    baseUrls: cfg.baseUrls || {},
    customCommands: cfg.customCommands || [],
    defaultModel,
    smallModel,
    tuning: cfg.tuning,
    envKeys: cfg.envKeys || {},
  }
}

/** Renderizza l'artefatto di una sezione locale o lo script remoto. */
export function renderSection(id, cfg) {
  if (id === "client-pwsh") return { content: renderClient("pwsh", cfg.entry || cfg) }
  if (id === "client-bash") return { content: renderClient("bash", cfg.entry || cfg) }
  const remoteIds = new Set(["server", "commands", "providers", "plugins", "claude-mem"])
  if (remoteIds.has(id)) {
    const state = serverState(cfg)
    const only = new Set([id])
    return { content: buildRemoteScript({ ...state, sections: only }), remote: true, script: true }
  }
  return null
}

/** Applica una sezione locale (ssh, client) alla macchina corrente. */
export async function applyLocalSection(id, cfg) {
  if (id === "client-pwsh" || id === "client-bash") {
    await installClient(cfg.entry || cfg, { targets: [id === "client-bash" ? "bash" : "pwsh"] })
    return
  }
if (id === "ssh") {
    console.log(c.cyan(ui(
      "[..] Chiave SSH + alias (l'installazione sul server richiede la password una volta)...",
      "[..] SSH key + alias (installing on the server requires the one-time password)...",
    )))
  }
}

/** Applica le sezioni remoto: compone lo script e lo esegue via SSH o in locale. */
export function applyRemoteSections(cfg, { dryRun = false, envKeys, applyMode } = {}) {
  const mode = applyMode || cfg.applyMode || "ssh"
  const state = { ...serverState(cfg), envKeys: envKeys || cfg.envKeys || {} }
  const script = buildRemoteScript(state)
  const remoteActive = [...state.sections].filter((id) => getSection(id)?.kind === "remote")
  if (!remoteActive.length) return { applied: false, script }

  if (mode === "local") {
    runScriptLocal(script)
    return { applied: true, script }
  }

  const ok = verifyConnection(cfg.entry || cfg)
  if (!ok) {
    // NB: non stampiamo lo script: con le API key dentro sarebbe un leak a video.
    console.log(c.yellow(ui(
      `  server non raggiungibile: script pronto (${script.length} byte). Esegui di nuovo \`oc-setup\` o \`oc-setup generate\` quando torna.`,
      `  server unreachable: script ready (${script.length} bytes). Re-run \`oc-setup\` or \`oc-setup generate\` once it's back.`,
    )))
    console.log(c.dim(ui(
      `  sezioni remoto da applicare: ${remoteActive.join(", ")}`,
      `  remote sections to apply: ${remoteActive.join(", ")}`,
    )))
    return { applied: false, script }
  }
  runRemote(cfg.entry || cfg, script)
  return { applied: true, script }
}
