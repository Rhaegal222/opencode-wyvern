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
export const CONFIG_VERSION = 4

/** Id dei preset MCP "market" nativi (v4). Serve alla migrazione per distinguerli dal residuo Figma. */
const MCP_PRESET_IDS = ["firecrawl", "tavily", "supabase"]

/**
 * Migra una config salvata:
 * - 0.3.0 (v3): rimuove i residui del vecchio preset MCP Figma (`mcpList`,
 *   sezione `mcp`). La sezione `mcp` del 0.3.0 era solo Figma (instabile).
 * - 0.4.0 (v4): la sezione `mcp` torna con i preset market verificati
 *   (firecrawl, tavily, supabase): `mcpList` riparte da zero (vuoto). I residui
 *   Figma che fossero rimasti nel frattempo vengono rimossi se la sezione è
 *   ancora impostata come attiva SENZA alcun preset mcp valido.
 * Host, providers, plugin, comandi, tuning e moduli restano intatti.
 * Ritorna la config stessa se non è cambiato nulla.
 */
export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg
  let changed = false
  const next = { ...cfg }

  // Residuo v3: mcpList era il preset Figma (rimosso). Ora torna come lista
  // dei preset market scelti: se non ci sono preset validi, svuotiamo tutto.
  if (next.mcpList !== undefined && !Array.isArray(next.mcpList)) {
    delete next.mcpList
    changed = true
  }
  if (Array.isArray(next.mcpList)) {
    const valid = next.mcpList.filter((id) => typeof id === "string" && MCP_PRESET_IDS.includes(id))
    if (valid.length !== next.mcpList.length) {
      next.mcpList = valid.length ? valid : undefined
      changed = true
    }
    if (next.mcpList === undefined) delete next.mcpList
  }
  if (next.sections && Object.prototype.hasOwnProperty.call(next.sections, "mcp")) {
    const mcpActive = !!(next.sections && next.sections.mcp)
    const noValidMcp = !Array.isArray(next.mcpList) || next.mcpList.length === 0
    if (mcpActive && noValidMcp) {
      const s = { ...next.sections }
      s.mcp = false // la vecchia sezione figma attiva senza preset → disattiva
      next.sections = s
      changed = true
    }
  }

  if (next.configVersion !== CONFIG_VERSION) {
    next.configVersion = CONFIG_VERSION
    changed = true
  }

  return changed ? next : cfg
}

export function loadConfig() {
  try {
    const f = configFilePath()
    if (!fs.existsSync(f)) return {}
    const cfg = JSON.parse(fs.readFileSync(f, "utf8"))
    const migrated = migrateConfig(cfg)
    if (migrated !== cfg) saveConfig(migrated)
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