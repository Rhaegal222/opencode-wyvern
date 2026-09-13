import { c } from "./prompts.js"
import { renderClient, installClient } from "./client.js"
import { buildRemoteScript, runRemote, verifyConnection } from "./server.js"

/**
 * Catalogo delle sezioni del setup. Ogni sezione è un modulo indipendente:
 * l'utente installa tutto (i dati vengono raccolti una volta) e attiva
 * solo le sezioni che vuole. Nessuna sezione contiene dati sensibili.
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
    label: "Server — provider (Google Gemini, OpenCode Zen)",
    desc: "SDK + blocco provider in opencode.json; API key in .env sul server (chmod 600).",
  },
  {
    id: "plugins",
    kind: "remote",
    group: "server",
    label: "Server — plugin (claude-mem, copilot-auth, ...)",
    desc: "Elenco plugin in opencode.json (copilot-auth, opencode-claude-auth, kimi-subscription, omniroute).",
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
  { label: "claude-mem", value: "claude-mem" },
  { label: "opencode-claude-auth", value: "opencode-claude-auth" },
  { label: "kimi-subscription", value: "kimi-subscription" },
  { label: "copilot-auth", value: "copilot-auth" },
  { label: "omniroute", value: "omniroute" },
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

/** Stato server derivato dalla config (provider/plugin/claude-mem env). */
export function serverState(cfg) {
  const sections = activeSections(cfg)
  const providers = new Set(["gemini", "zen"].filter((p) => cfg.providers?.[p]))
  const plugins = (cfg.plugins || []).filter((p) => p !== "claude-mem")
  const defaultModelId =
    providers.has("gemini") ? `google/${(cfg.models?.gemini || "gemini-2.5-pro").split(",")[0].trim()}`
    : providers.has("zen") ? `zen/${(cfg.models?.zen || "opencode-zen-2.5-pro").split(",")[0].trim()}`
    : undefined
  return {
    sections,
    providers,
    plugins,
    claudeMem: sections.has("claude-mem"),
    geminiModels: cfg.models?.gemini,
    zenModels: cfg.models?.zen,
    envKeys: cfg.envKeys || {},
    defaultModelId,
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

/** Applica una sezione locale (ssa, client) alla macchina corrente. */
export async function applyLocalSection(id, cfg) {
  if (id === "client-pwsh" || id === "client-bash") {
    await installClient(cfg.entry || cfg, { targets: [id] })
    return
  }
  if (id === "ssh") {
    console.log(c.cyan("[..] Chiave SSH + alias (l'installazione sul server richiede la password una volta)..."))
    // nulla da fare qui: la chiave/alias vengono gestiti dal wizard
  }
}

/** Applica le sezioni remoto: compone lo script e lo esegue via SSH. */
export function applyRemoteSections(cfg, { dryRun = false } = {}) {
  const state = serverState(cfg)
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