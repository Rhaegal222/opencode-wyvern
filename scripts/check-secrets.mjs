/**
 * Guardia pre-pubblicazione (hook `prepack`): impedisce di pubblicare il
 * pacchetto se in bin/, src/ o templates/ compaiono identità del server
 * (wyrmrest / 10.0.0.1 / rhaegal222 come host o utente) oppure valori
 * credenziali (API key, token, chiavi private).
 *
 * NB: package.json contiene l'handle npm dell'autore → non viene scansionato.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const BANNED_IDS = /\b(wyrmrest|10\.0\.0\.1|rhaegal222)\b/i
const CREDS = [
  /sk-[a-zA-Z0-9]{10,}/,
  /ghp_[0-9A-Za-z]{20,}/,
  /github_pat_[0-9A-Za-z_]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /(api[_-]?key|token|secret|password|passphrase)\s*[=:]\s*[A-Za-z0-9._/+-]{12,}/i,
  /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
]

const dirs = ["bin", "src", "templates"]
const failures = []

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".js") || e.name.endsWith(".md") || e.name.endsWith(".ps1") || e.name.endsWith(".sh")) scan(p)
  }
}

function scan(file) {
  const content = fs.readFileSync(file, "utf8")
  content.split(/\r?\n/).forEach((line, i) => {
    const id = line.match(BANNED_IDS)
    if (id) failures.push(`${path.relative(root, file)}:${i + 1} identità riservata "${id[0]}"`)
    for (const re of CREDS) {
      const m = line.match(re)
      if (m) failures.push(`${path.relative(root, file)}:${i + 1} possibile credenziale "${m[0].slice(0, 40)}"`)
    }
  })
}

for (const d of dirs) walk(path.join(root, d))

if (failures.length) {
  console.error("[check-secrets] blocco pubblicazione:")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log("[check-secrets] bin/src/templates puliti: nessuna identità o credenziale.")