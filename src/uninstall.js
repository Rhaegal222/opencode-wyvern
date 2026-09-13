import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import { c, confirm, closePrompts } from "./prompts.js"
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
 * config e cache locali, alias SSH dal config. La chiave SSH locale NON
 * viene cancellata (potrebbe servire per altri accessi). La pulizia del
 * server è opzionale e va confermata esplicitamente.
 */
export async function runUninstall() {
  const cfg = loadConfig()
  const alias = (cfg.entry && cfg.entry.server) || "remote-server"

  console.log(c.bold(c.cyan("oc-setup — disinstallazione completa")))
  console.log(c.dim("  rimuovo: blocchi client (PowerShell+bash), config e cache locali, alias SSH."))
  console.log(c.dim("  NON cancello la chiave ~/.ssh/id_ed25519 (potrebbe servire altrove)."))

  const ok = await confirm("Procedo con la disinstallazione?", false)
  if (!ok) {
    console.log(c.yellow("  annullato."))
    closePrompts()
    return
  }

  let changed = false

  for (const f of [pwshProfilePath(), bashRcPath()]) {
    const r = stripClientBlock(f)
    if (r.changed) {
      changed = true
      console.log(`  - blocco client rimosso: ${r.filePath}  (backup: ${r.backup})`)
    }
  }
  if (!changed) console.log(c.dim("  nessun blocco client trovato nei profili."))

  const sp = sshConfigPath()
  if (fs.existsSync(sp)) {
    const orig = fs.readFileSync(sp, "utf8")
    const next = removeSshAliasBlock(orig, alias)
    if (next !== orig) {
      const backup = `${sp}.bak-${crypto.randomBytes(3).toString("hex")}`
      fs.writeFileSync(backup, orig, "utf8")
      fs.writeFileSync(sp, next ? next + "\n" : "", "utf8")
      console.log(`  - alias SSH '${alias}' rimosso da ${sp}  (backup: ${backup})`)
    } else {
      console.log(c.dim(`  nessun alias '${alias}' trovato in ${sp}.`))
    }
  }

  for (const d of [configDir(), ...CACHE_DIRS]) {
    if (rmDir(d)) console.log(`  - rimosso: ${d}`)
  }

  if (cfg.entry && cfg.entry.host && cfg.entry.user) {
    const clean = await confirm(
      `Rimuovere anche la config opencode dal server (ssh ${cfg.entry.user}@${cfg.entry.host} → rm -rf ~/.config/opencode)?`,
      false,
    )
    if (clean) {
      console.log(c.cyan("[..] Rimuovo ~/.config/opencode sul server..."))
      const res = spawnSync("ssh", [...sshTargetArgs(cfg.entry), "rm -rf ~/.config/opencode && echo DISINSTALL_OK"], {
        encoding: "utf8",
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 120000,
      })
      if (res.status === 0) console.log(c.green("  config opencode rimossa dal server."))
      else console.log(c.yellow("  server non raggiungibile o rm fallito (da rifare a mano)."))
    }
  }

  console.log(c.green("\nDisinstallazione completata."))
  console.log(c.dim(`  chiave SSH conservata: ${path.join(homedir(), ".ssh", "id_ed25519")}`))
  console.log(c.dim("  Per una nuova installazione:  oc-setup"))
  closePrompts()
}