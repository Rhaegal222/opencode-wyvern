import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import { c, confirm, closePrompts } from "./prompts.js"
import { ui } from "./i18n.js"
import { loadConfig } from "./config.js"
import { stripClientBlock, LEGACY_MARKERS } from "./client.js"
import { pwshProfilePath, bashRcPath, sshConfigPath, configDir } from "./shell.js"
import { sshTargetArgs } from "./server.js"

const CACHE_DIRS = ["opencode-wyvern", "opencode-remote"].map(
  (name) => path.join(homedir(), ".cache", name),
)

/** Rimuove il blocco `Host <alias>` (fino al prossimo Host) e i blocchi legacy. */
function removeSshAliasBlock(content, alias) {
  const lines = content.split(/\r?\n/)
  const legacyIdx = lines.findIndex((l) => LEGACY_MARKERS.some((m) => l.includes(m)))
  const keep = legacyIdx === -1 ? lines : lines.slice(0, legacyIdx)
  const hostRe = new RegExp(`^Host\\s+${alias}(?:\\s.*)?$`, "i")
  const out = []
  let skip = false
  for (const line of keep) {
    const t = line.trim()
    if (/^Host\s+\S+/.test(t)) skip = hostRe.test(t)
    if (!skip) out.push(line)
  }
  return out.join("\n").replace(/[\r\n]+$/, "")
}

function rmDir(p, label) {
  if (!fs.existsSync(p)) return false
  fs.rmSync(p, { recursive: true, force: true })
  return true
}

/**
 * Disinstallazione completa: rimuove blocchi client (PowerShell + bash),
 * cache locali e alias SSH dal config. La config locale (entry/providers/...)
 * viene PRESERVATA di default per poterla riusare in una reinstallazione; la
 * chiave SSH locale NON viene cancellata (potrebbe servire per altri accessi).
 * La pulizia del server è opzionale e va confermata esplicitamente.
 */
export async function runUninstall() {
  const cfg = loadConfig()
  const alias = (cfg.entry && cfg.entry.server) || "remote-server"

  console.log(c.bold(c.cyan(ui("oc-setup — disinstallazione completa", "oc-setup — complete uninstall"))))
  console.log(c.dim(ui("  rimuovo: blocchi client (PowerShell+bash), cache locali e alias SSH.",
    "  removing: client blocks (PowerShell+bash), local caches and SSH alias.")))
  console.log(c.dim(ui("  la config locale (~/.config/opencode-wyvern) viene preservata per la reinstallazione.",
    "  the local config (~/.config/opencode-wyvern) is kept, ready for the new install.")))
  console.log(c.dim(ui("  NON cancello la chiave ~/.ssh/id_ed25519 (potrebbe servire altrove).",
    "  I will NOT delete the ~/.ssh/id_ed25519 key (it may be needed elsewhere).")))

  const ok = await confirm(ui("Procedo con la disinstallazione?", "Proceed with the uninstall?"), false)
  if (!ok) {
    console.log(c.yellow(`  ${ui("annullato.", "cancelled.")}`))
    closePrompts()
    return
  }

  let changed = false

  for (const f of [pwshProfilePath(), bashRcPath()]) {
    const r = stripClientBlock(f)
    if (r.changed) {
      changed = true
      console.log(ui(
        `  - blocco client rimosso: ${r.filePath}  (backup: ${r.backup})`,
        `  - client block removed: ${r.filePath}  (backup: ${r.backup})`,
      ))
    }
  }
  if (!changed) console.log(c.dim(ui("  nessun blocco client trovato nei profili.", "  no client block found in the profiles.")))

  const sp = sshConfigPath()
  if (fs.existsSync(sp)) {
    const orig = fs.readFileSync(sp, "utf8")
    const next = removeSshAliasBlock(orig, alias)
    if (next !== orig) {
      const backup = `${sp}.bak-${crypto.randomBytes(3).toString("hex")}`
      fs.writeFileSync(backup, orig, "utf8")
      fs.writeFileSync(sp, next ? next + "\n" : "", "utf8")
      console.log(ui(
        `  - alias SSH '${alias}' rimosso da ${sp}  (backup: ${backup})`,
        `  - SSH alias '${alias}' removed from ${sp}  (backup: ${backup})`,
      ))
    } else {
      console.log(c.dim(ui(
        `  nessun alias '${alias}' trovato in ${sp}.`,
        `  no alias '${alias}' found in ${sp}.`,
      )))
    }
  }

  // La config locale serve spesso per la reinstallazione: default = conserva.
  const keepConfig = await confirm(ui(
    `Conservo la config locale (${configDir()}) per la reinstallazione?`,
    `Keep the local config (${configDir()}) for a new install?`,
  ), true)
  if (!keepConfig) {
    const r = rmDir(configDir(), "config locale")
    if (r) console.log(ui(`  - rimosso: ${configDir()}`, `  - removed: ${configDir()}`))
  }

  for (const d of CACHE_DIRS) {
    if (rmDir(d)) console.log(ui(`  - rimosso: ${d}`, `  - removed: ${d}`))
  }

  if (cfg.entry && cfg.entry.host && cfg.entry.user) {
    const clean = await confirm(ui(
      `Rimuovere anche la config opencode dal server (ssh ${cfg.entry.user}@${cfg.entry.host} → rm -rf ~/.config/opencode)?`,
      `Also remove the opencode config from the server (ssh ${cfg.entry.user}@${cfg.entry.host} → rm -rf ~/.config/opencode)?`,
    ), false)
    if (clean) {
      console.log(c.cyan(ui("[..] Rimuovo ~/.config/opencode sul server...", "[..] Removing ~/.config/opencode on the server...")))
      const res = spawnSync("ssh", [...sshTargetArgs(cfg.entry), "rm -rf ~/.config/opencode && echo DISINSTALL_OK"], {
        encoding: "utf8",
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 120000,
      })
      if (res.status === 0) console.log(c.green(ui("  config opencode rimossa dal server.", "  opencode config removed from the server.")))
      else console.log(c.yellow(ui("  server non raggiungibile o rm fallito (da rifare a mano).", "  server unreachable or rm failed (to be done manually).")))
    }
  }

  console.log(c.green(`\n${ui("Disinstallazione completata.", "Uninstall completed.")}`))
  if (keepConfig) {
    console.log(c.dim(ui(
      `  config locale preservata: ${configDir()} (per una reinstallazione indolore)`,
      `  local config kept: ${configDir()} (for a painless reinstall)`,
    )))
  } else {
    console.log(c.dim(ui(
      `  config locale rimossa: ${configDir()}`,
      `  local config removed: ${configDir()}`,
    )))
  }
  console.log(c.dim(ui(
    `  chiave SSH conservata: ${path.join(homedir(), ".ssh", "id_ed25519")}`,
    `  SSH key kept: ${path.join(homedir(), ".ssh", "id_ed25519")}`,
  )))
  console.log(c.dim(ui("  Per una nuova installazione:  oc-setup", "  For a new install:  oc-setup")))
  closePrompts()
}