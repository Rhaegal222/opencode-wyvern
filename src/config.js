import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { configDir, configFilePath } from "./shell.js"
import { ui } from "./i18n.js"

/**
 * Configurazione persistente della CLI.
 *
 * NB: NON contiene mai chiavi API né password. I segreti API vengono scritti
 * esclusivamente nel file `.env` sul SERVER (chmod 600), mai qui.
 */
/**
 * Versione della config persistente. Viene scritta su ogni save; quando un
 * aggiornamento del pacchetto richiede una migrazione, basta incrementarla:
 * al primo comando la config viene aggiornata in automatico e le note
 * (mini-guida post-update) vengono mostrate una sola volta.
 */
export const CONFIG_VERSION = 2

/**
 * Preset MCP obsoleti rimpiazzati in versioni successive a 0.2.5.
 * La migrazione li sostituisce con il preset corretto SENZA toccare nient'altro:
 * host, providers, plugin, comandi, tuning e moduli restano intatti.
 */
const MCP_RETIRED = {
  "figma-developer": "figma",
}

/**
 * Migra una config salvata: sostituisce il vecchio preset MCP Figma
 * (`figma-developer`, npx + token) con il nuovo Figma Desktop MCP (`figma`)
 * e aggiorna `configVersion`. Sezioni attive e resto della config sono
 * preservati. Ritorna la config stessa se non è cambiato nulla.
 */
export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg
  let changed = false
  const next = { ...cfg }

  if (Array.isArray(next.mcpList)) {
    const mapped = next.mcpList.map((id) => MCP_RETIRED[id] || id)
    if (mapped.some((id, i) => id !== next.mcpList[i])) {
      next.mcpList = mapped
      changed = true
    }
  }

  if (next.configVersion !== CONFIG_VERSION) {
    next.configVersion = CONFIG_VERSION
    changed = true
  }

  return changed ? next : cfg
}

/** True se la (pre)config fa uso dell'MCP Figma: serve per decidere se mostrare la guida. */
function figmaInvolved(cfg) {
  if (!cfg || typeof cfg !== "object") return false
  if (Array.isArray(cfg.mcpList) && cfg.mcpList.some((id) => id === "figma" || id === "figma-developer")) return true
  return !!cfg.sections?.["mcp"]
}

/** Mini-guida post-aggiornamento: stampata UNA volta, subito dopo la migrazione. */
function printFigmaGuide() {
  const it = `Aggiornato al nuovo Figma Desktop MCP (rimosso il vecchio setup con token).
  • Apri Figma desktop con il file in Dev Mode (Shift D): l'agente legge il file da 127.0.0.1:3845.
  • Se opencode gira su un server remoto, inoltra la porta: ssh -L 3845:127.0.0.1:3845 <server>
  • Nessun token: le credenziali Figma (FIGMA_API_KEY) e l'hack PATH sono stati rimossi dalla config del server.`
  const en = `Upgraded to the new Figma Desktop MCP (old token-based setup removed).
  • Open Figma desktop with the file in Dev Mode (Shift D): the agent reads the file from 127.0.0.1:3845.
  • If opencode runs on a remote server, forward the port: ssh -L 3845:127.0.0.1:3845 <server>
  • No token needed: Figma credentials (FIGMA_API_KEY) and the PATH hack have been removed from the server config.`
  console.log(`[oc-wyvern] ${ui(it, en)}`)
}

export function loadConfig() {
  try {
    const f = configFilePath()
    if (!fs.existsSync(f)) return {}
    const cfg = JSON.parse(fs.readFileSync(f, "utf8"))
    const migrated = migrateConfig(cfg)
    if (migrated !== cfg) {
      saveConfig(migrated)
      if (figmaInvolved(cfg)) printFigmaGuide()
    }
    return migrated
  } catch {
    return {}
  }
}

export function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(configFilePath(), JSON.stringify(cfg, null, 2) + "\n", "utf8")
  try {
    fs.chmodSync(configFilePath(), 0o600)
  } catch {
    /* non critico */
  }
}

export function maskSecret(value) {
  if (!value) return value
  if (value.length <= 8) return "*".repeat(value.length)
  return value.slice(0, 4) + "*".repeat(Math.max(4, value.length - 8)) + value.slice(-4)
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
  return p
}

export function templatePath(name) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", name)
}

export function readTemplate(name) {
  const p = templatePath(name)
  if (!fs.existsSync(p)) {
    throw new Error(`template mancante: ${name}`)
  }
  return fs.readFileSync(p, "utf8")
}

/**
 * Sostituisce i segnaposto `__KEY__` con i valori forniti.
 */
export function render(template, vars) {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`__${key.toUpperCase()}__`).join(String(value))
  }
  return out
}