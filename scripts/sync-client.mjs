// Script di sviluppo: applica modifiche condivise e rigenera il template pwsh dal profilo.
// Uso: node scripts/sync-client.mjs
// Il template client-pwsh viene sempre rigenerato dal profilo SANITIZZATO (niente dati privati).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const PROFILE = "C:/Users/Rhaegal222/Documents/PowerShell/profile.ps1"
const SETUP_SH = "C:/Users/Rhaegal222/setup-opencode-remote.sh"
const Q = String.fromCharCode(39)

const PWSH_REPLACEMENTS = [
  // finestra 24h scorrevole (non giorno solare)
  [
    "function Get-OcTodaySessions {\n    @(Get-OcAllSessions) | Where-Object {\n        [DateTimeOffset]::FromUnixTimeMilliseconds($_.Updated).LocalDateTime.Date -eq (Get-Date).Date\n    }\n}",
    "function Get-OcRecentSessions {\n    $cutoff = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()\n    @(Get-OcAllSessions) | Where-Object { $_.Updated -ge $cutoff }\n}",
  ],
  [
    "    if ($TodayOnly) {\n        $today = (Get-Date).Date\n        $rows = @($rows | Where-Object { [DateTimeOffset]::FromUnixTimeMilliseconds($_.Updated).LocalDateTime.Date -eq $today })\n    }",
    "    if ($TodayOnly) {\n        $cutoff = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()\n        $rows = @($rows | Where-Object { $_.Updated -ge $cutoff })\n    }",
  ],
  ["$sessions = Get-OcTodaySessions", "$sessions = Get-OcRecentSessions"],
  ["$sessions = @(Get-OcTodaySessions)", "$sessions = @(Get-OcRecentSessions)"],
  ["Nessuna sessione di oggi (o SSH a chiave non configurato - esegui oc-connect).", "Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect)."],
  ["Sessioni di oggi:", "Sessioni nelle ultime 24 ore:"],
  ["Server raggiungibile ma nessuna sessione di oggi.", "Server raggiungibile ma nessuna sessione nelle ultime 24 ore."],
  ['"oc-sessions", "Lista sessioni opencode di oggi"', '"oc-sessions", "Lista sessioni opencode (ultime 24h)"'],
  ['"oc-resume", "Apre 1 tab per ogni sessione di oggi"', '"oc-resume", "Apre 1 tab per ogni sessione (ultime 24h)"'],
]

const BASH_REPLACEMENTS = [
  ['back="$(date -d "$(date +%F)" +%s)"', "back=$(( $(date +%s) - 86400 ))"],
  ["Nessuna sessione di oggi (o SSH a chiave non configurato - esegui oc-connect).", "Nessuna sessione nelle ultime 24 ore (o SSH a chiave non configurato - esegui oc-connect)."],
  ["Sessioni di oggi:", "Sessioni nelle ultime 24 ore:"],
  ["Nessuna sessione di oggi nel riepilogo.", "Nessuna sessione nelle ultime 24 ore nel riepilogo."],
  ['"oc-sessions" "Lista sessioni opencode di oggi"', '"oc-sessions" "Lista sessioni opencode (ultime 24h)"'],
]

/** Sanitizza il profilo reale -> template pubblicabile. */
function sanitize(ps) {
  let out = ps
    .replace(new RegExp(Q + "remote-server" + Q, "g"), Q + "__OC_SERVER__" + Q)
    .replace(/'(10\.0\.0\.1|server\.example\.com)'/g, Q + "__OC_HOST__" + Q)
    .replace(new RegExp(Q + "rhaegal222" + Q, "g"), Q + "__OC_USER__" + Q)
    .replace(/\$env:OC_DIR\s*=\s*'[^']*'/, "$env:OC_DIR     = '" + "__OC_DIR__" + "'")
    .replace(/\.cache\\opencode-remote\\/g, ".cache\\opencode-wyvern\\")
    .replace(/\.cache\/opencode-remote\//g, ".cache/opencode-wyvern/")
    .replace(/Opencode Remote - comandi/g, "OpenCode Wyvern - comandi")
    .replace(/# ---- Opencode Remote \(auto-generato\) ----/g, "# ---- OpenCode Wyvern (auto-generato) ----")
  return out
}

function applyReplacements(text, reps) {
  let out = text
  for (const [from, to] of reps) {
    let n = 0
    while (out.includes(from)) {
      out = out.replace(from, to)
      n++
      if (n > 20) break
    }
  }
  return out
}

// 1) profilo pwsh
let ps = fs.readFileSync(PROFILE, "utf8")
const psBefore = ps
ps = applyReplacements(ps, PWSH_REPLACEMENTS)
fs.writeFileSync(PROFILE, ps, "utf8")
console.log("profile.ps1:", psBefore === ps ? "invariato" : "aggiornato")

// 2) template pwsh dal profilo sanitizzato
fs.writeFileSync(path.join(ROOT, "templates", "client-pwsh.ps1"), sanitize(ps).replace(/\r\n/g, "\n"), "utf8")
console.log("templates/client-pwsh.ps1 rigenerato (sanitizzato)")

// 3) setup.sh + template bash
for (const f of [SETUP_SH, path.join(ROOT, "templates", "client-bash.sh")]) {
  let txt = fs.readFileSync(f, "utf8")
  const before = txt
  txt = applyReplacements(txt, BASH_REPLACEMENTS)
  fs.writeFileSync(f, txt, "utf8")
  console.log(path.basename(f) + ":", before === txt ? "invariato" : "aggiornato")
}