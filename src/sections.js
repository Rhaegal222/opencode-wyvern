import { c } from "./prompts.js"
import { renderClient, installClient } from "./client.js"
import { buildRemoteScript, runRemote, verifyConnection, chooseDefaultModels } from "./server.js"

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
    label: "SSH — chiave, alias, install sul server",
    desc: "Genera/riusa ~/.ssh/id_ed25519 (senza passphrase), aggiunge l'alias a ~/.ssh/config e installa la chiave sul server (password una volta).",
  },
  {
    id: "client-pwsh",
    kind: "local",
    group: "client",
    label: "Client PowerShell — comandi oc-*",
    desc: "Blocco oc-*, oc-go, oc-resume, oc-recap nel profilo PowerShell.",
  },
  {
    id: "client-bash",
    kind: "local",
    group: "client",
    label: "Client bash — comandi oc-*",
    desc: "Stesso blocco in ~/.bashrc.",
  },
  {
    id: "server",
    kind: "remote",
    group: "server",
    label: "Server — bootstrap opencode",
    desc: "Controlla node/npm, installa opencode se manca, crea ~/.config/opencode e AGENTS.md.",
  },
  {
    id: "commands",
    kind: "remote",
    group: "server",
    label: "Server — comando /baseline-ui",
    desc: "Scrive command/baseline-ui.md (baseline di interfaccia).",
  },
  {
    id: "providers",
    kind: "remote",
    group: "server",
    label: "Server — provider (Copilot, Gemini, Zenith, Anthropic, OpenAI, OmniRoute)",
    desc: "SDK + blocco provider in opencode.json; API key in .env sul server (chmod 600).",
  },
  {
    id: "plugins",
    kind: "remote",
    group: "server",
    label: "Server — plugin (copilot-auth, claude-auth, kimi, omniroute)",
    desc: "Plugin npm installati in ~/.config/opencode e listati in opencode.json.",
  },
  {
    id: "claude-mem",
    kind: "remote",
    group: "server",
    label: "Server — claude-mem (memoria)",
    desc: "Installa opcode-mem + wrapper plugins/claude-mem-plugin.js.",
  },
]

export const PLUGIN_CHOICES = [
  { label: "copilot-auth (auth GitHub Copilot)", value: "copilot-auth" },
  { label: "claude-auth (auth Claude)", value: "claude-auth" },
  { label: "kimi-subscription", value: "kimi" },
  { label: "omniroute (gateway multi-modello)", value: "omniroute" },
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
    console.log(c.cyan("[..] Chiave SSH + alias (l'installazione sul server richiede la password una volta)..."))
    // nulla da fare qui: la chiave/alias vengono gestiti dal wizard
  }
}

/** Applica le sezioni remoto: compone lo script e lo esegue via SSH. */
export function applyRemoteSections(cfg, { dryRun = false, envKeys } = {}) {
  const state = { ...serverState(cfg), envKeys: envKeys || cfg.envKeys || {} }
  const script = buildRemoteScript(state)
  const remoteActive = [...state.sections].filter((id) => getSection(id)?.kind === "remote")
  if (!remoteActive.length) return { applied: false, script }

  const ok = verifyConnection(cfg.entry || cfg)
  if (!ok) {
    // NB: non stampiamo lo script: con le API key dentro sarebbe un leak a video.
    console.log(c.yellow(`  server non raggiungibile: script pronto (${script.length} byte). Esegui di nuovo \`oc-setup\` o \`oc-setup generate\` quando torna.`))
    console.log(c.dim(`  sezioni remoto da applicare: ${remoteActive.join(", ")}`))
    return { applied: false, script }
  }
  runRemote(cfg.entry || cfg, script)
  return { applied: true, script }
}