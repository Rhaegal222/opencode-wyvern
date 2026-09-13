import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { configDir, configFilePath } from "./shell.js"

/**
 * Configurazione persistente della CLI.
 *
 * NB: NON contiene mai chiavi API né password. I segreti API vengono scritti
 * esclusivamente nel file `.env` sul SERVER (chmod 600), mai qui.
 */
export function loadConfig() {
  try {
    const f = configFilePath()
    if (!fs.existsSync(f)) return {}
    return JSON.parse(fs.readFileSync(f, "utf8"))
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