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
export const CONFIG_VERSION = 3

/**
 * Migra una config salvata: aggiorna `configVersion` e rimuove i residui del
 * vecchio preset MCP Figma (`mcpList`, sezione `mcp`) rimossi in 0.3.0.
 * Host, providers, plugin, comandi, tuning e moduli restano intatti.
 * Ritorna la config stessa se non è cambiato nulla.
 */
export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg
  let changed = false
  const next = { ...cfg }

  if (Array.isArray(next.mcpList) && next.mcpList.length) {
    delete next.mcpList
    changed = true
  }
  if (next.sections && Object.prototype.hasOwnProperty.call(next.sections, "mcp")) {
    const s = { ...next.sections }
    delete s.mcp
    next.sections = s
    changed = true
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