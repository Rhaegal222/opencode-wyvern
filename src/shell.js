import { spawnSync } from "node:child_process"
import { homedir, hostname, platform } from "node:os"
import path from "node:path"
import fs from "node:fs"

export function isWindows() {
  return platform() === "win32"
}

export function isBashShell() {
  return !isWindows()
}

/** Profilo PowerShell corrente (AllHosts), stile Windows/macOS/Linux. */
export function pwshProfilePath() {
  if (isWindows()) {
    return path.join(homedir(), "Documents", "PowerShell", "profile.ps1")
  }
  // macOS/Linux con pwsh installato
  return path.join(homedir(), ".config", "powershell", "profile.ps1")
}

export function bashRcPath() {
  return path.join(homedir(), ".bashrc")
}

export function keyPaths() {
  return {
    key: path.join(homedir(), ".ssh", "id_ed25519"),
    pub: path.join(homedir(), ".ssh", "id_ed25519.pub"),
  }
}

export function sshConfigPath() {
  return path.join(homedir(), ".ssh", "config")
}

export function configDir() {
  return path.join(homedir(), ".config", "opencode-wyvern")
}

export function configFilePath() {
  return path.join(configDir(), "config.json")
}

/** Costruisce lo string target SSH `[user@]host`. */
export function sshTarget({ user, host, port }) {
  const u = user ? `${user}@` : ""
  return port ? `${u}${host} -p ${port}` : `${u}${host}`
}

/**
 * Esegue un comando sincrono catturando stdout/stderr.
 * Con `stdio: true` il child eredita il terminale (utile per la password SSH).
 */
export function run(cmd, args = [], { silent = false, stdio = false, timeout = 120000 } = {}) {
  const res = spawnSync(cmd, args, {
    stdio: stdio ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout,
    encoding: "utf8",
  })
  const out = (res.stdout || "").toString().trim()
  const err = (res.stderr || "").toString().trim()
  const ok = res.status === 0
  if (!silent && !stdio && (err || (!ok && !out))) {
    if (err) process.stderr.write(err + "\n")
  }
  return { ok, status: res.status, stdout: out, stderr: err, signal: res.signal }
}

/** Trova un eseguibile nel PATH (Windows incluso). */
export function which(bin) {
  const winRoot = (process.env.SystemRoot || "C:\\Windows").toLowerCase()
  const scan = isWindows() ? process.env.PATH.split(";") : process.env.PATH.split(":")
  for (const dir of scan) {
    try {
      const candidates = isWindows() ? [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.ps1`] : [bin]
      for (const c of candidates) {
        const p = path.join(dir, c)
        if (fs.existsSync(p)) {
          // Su Windows, `C:\Windows\System32\bash.exe` è WSL (non eredita env)
          if (isWindows() && p.toLowerCase().startsWith(winRoot) && c === "bash.exe") continue
          return p
        }
      }
    } catch {
      /* ignora */
    }
  }
  return null
}

export function currentUser() {
  return process.env.USER || process.env.USERNAME || "user"
}

export function currentHost() {
  return hostname() || "localhost"
}

/** Stampa una sezione intestazione nel flusso della CLI. */
export const section = (title) => {
  const bar = "─".repeat(Math.min(56, process.stdout.columns ? process.stdout.columns - 2 : 56))
  console.log(`\n\x1b[36m${bar}\x1b[0m`)
  console.log(`\x1b[1m${title}\x1b[0m`)
  console.log(`\x1b[36m${bar}\x1b[0m`)
}