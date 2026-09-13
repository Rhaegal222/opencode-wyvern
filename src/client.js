import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { render, readTemplate, ensureDir } from "./config.js"
import { pwshProfilePath, bashRcPath } from "./shell.js"
import { c } from "./prompts.js"
import { ui } from "./i18n.js"

export const MARKER = "# ---- OpenCode Wyvern (auto-generato) ----"
/** Marker storici: un blocco generato in passato va comunque rimosso. */
export const LEGACY_MARKERS = ["# ---- Opencode Remote (auto-generato) ----"]

/** Mappa tipo template -> file di profilo su cui appende il blocco. */
const TARGETS = {
  pwsh: { tpl: "client-pwsh.ps1", path: pwshProfilePath },
  bash: { tpl: "client-bash.sh", path: bashRcPath },
}

/**
 * Blocco client renderizzato con i valori reali.
 * Nessun dato sensibile: solo alias/host/user/dir, mai chiavi o password.
 */
export function renderClient(kind, { server, host, user, dir }) {
  const vars = {
    OC_SERVER: server || "remote-server",
    OC_HOST: host || "localhost",
    OC_USER: user || "user",
    OC_DIR: dir || "~",
  }
  const tpl = readTemplate(TARGETS[kind].tpl)
  return render(tpl, vars).replace(/\r\n/g, "\n")
}

/** Sostituisce/crea il blocco generato in un profilo, con backup. */
function upsertBlock(filePath, block, { dryRun = false } = {}) {
  ensureDir(path.dirname(filePath)) // la dir del profilo può non esistere (machina nuova)
  const existed = fs.existsSync(filePath)
  let content = existed ? fs.readFileSync(filePath, "utf8") : ""

  if (content.trim() !== "" && !content.endsWith("\n")) content += "\n"

  // rimuove ogni blocco già generato (marker attuale o legacy), sempre in coda
  const all = [MARKER, ...LEGACY_MARKERS]
  const hits = all.map((m) => content.indexOf(m)).filter((i) => i !== -1)
  if (hits.length) {
    const start = Math.min(...hits)
    content = content.slice(0, start)
    if (content !== "" && !content.endsWith("\n")) content += "\n"
  }

  const stamp = `# --- installato da oc-setup il ${new Date().toISOString().slice(0, 10)} ---`
  const blockOut = block.replace(
    `${MARKER}\n`,
    `${MARKER}\n${stamp}\n`
  )

  let backup = null
  if (existed && !dryRun) {
    backup = `${filePath}.bak-${crypto.randomBytes(3).toString("hex")}`
    fs.writeFileSync(backup, content, "utf8")
  }
  if (!dryRun) {
    fs.writeFileSync(filePath, content + blockOut + "\n", "utf8")
  }
  return { filePath, backup, changed: true, dryRun }
}

/**
 * Rimuove i blocchi client auto-generati (marker attuale o legacy) da un
 * profilo, con backup dell'originale. Utile per la disinstallazione.
 */
export function stripClientBlock(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, changed: false }
  const content = fs.readFileSync(filePath, "utf8")
  const all = [MARKER, ...LEGACY_MARKERS]
  const hits = all.map((m) => content.indexOf(m)).filter((i) => i !== -1)
  if (!hits.length) return { filePath, changed: false }
  const start = Math.min(...hits)
  const stripped = content.slice(0, start).replace(/\s+$/, "")
  const backup = `${filePath}.bak-${crypto.randomBytes(3).toString("hex")}`
  fs.writeFileSync(backup, content, "utf8")
  fs.writeFileSync(filePath, stripped ? stripped + "\n" : "", "utf8")
  return { filePath, backup, changed: true }
}

/**
 * Installa i comandi client `oc-*` nei profili richiesti.
 * `onlyPrint` (null | "pwsh" | "bash") stampa il blocco renderizzato
 * senza modificare file. `targets` è l'array dei tipi da installare.
 */
export async function installClient(cfg, { targets = ["pwsh", "bash"], onlyPrint = null } = {}) {
  if (onlyPrint) {
    const kind = onlyPrint === "bash" ? "bash" : "pwsh"
    console.log(renderClient(kind, cfg))
    return { printed: true, kind }
  }

  const results = []
  for (const t of targets) {
    const target = TARGETS[t]
    if (!target) continue
    const block = renderClient(t, cfg)
    results.push(upsertBlock(target.path(), block))
  }

  console.log(c.green(`${ui("\nClient installato:", "\nClient installed:")}`))
  for (const r of results) {
    console.log(`  - ${r.filePath}${r.backup ? `  (backup: ${r.backup})` : ""}`)
  }
  console.log(c.dim(ui("\nRicarica il profilo con:  . $PROFILE   (PowerShell)  /  source ~/.bashrc   (bash)",
    "\nReload your profile with:  . $PROFILE   (PowerShell)  /  source ~/.bashrc   (bash)")))
  return { installed: results }
}