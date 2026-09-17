import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildRemoteScript } from "../src/server.js"

/**
 * E2E (flusso reale del pacchetto): genera lo script remoto per una config
 * completa (server + mcp + tools + commands), lo esegue in WSL in una HOME
 * sandbox dedicata, poi fa leggere la config a opencode reale (1.18.31) e
 * verifica che il MCP con chiave venga risolto da `{file:...}`.
 *
 * Avvio: `node test/e2e-sandbox.mjs`. Richiede WSL + rete (npx scarica i pkg).
 */

const tmpdir = "C:/Users/Rhaegal222/AppData/Local/Temp/opencode"
const scriptStage = path.join(tmpdir.replaceAll("/", "\\"), "oc-e2e-script.sh")
const probeStage = path.join(tmpdir.replaceAll("/", "\\"), "oc-e2e-probe.sh")

const sandboxHome = "/tmp/oc-e2e-home"
const cfgDir = `${sandboxHome}/.config/opencode`

const cfg = {
  sections: new Set(["server", "mcp", "tools", "commands"]),
  providers: new Set(["zen"]),
  mcpList: ["firecrawl", "tavily", "supabase"],
  mcpKeys: { firecrawl: "E2E-FIRECRAWL-KEY-12345" },
  tools: ["repomix"],
  customCommands: ["handoff"],
  defaultModel: "opencode/big-pickle",
  smallModel: "opencode/big-pickle",
}

const script = buildRemoteScript(cfg)
fs.writeFileSync(scriptStage, script)

// Probe: server MCP locale che scrive il proprio env su un log (verifica {file:}).
const probeScript = `#!/usr/bin/env node
const fs = require('fs')
const log = process.env.PROBE_LOG || '/tmp/oc-e2e-probe.log'
fs.writeFileSync(log, JSON.stringify({ got: process.env.FIRECRAWL_API_KEY || null }) + '\\n')
setInterval(() => {}, 1000)
`
fs.writeFileSync(probeStage, probeScript)

const wsl = (code, { check = true } = {}) => {
  const r = execFileSync("wsl", ["bash", "-lc", code], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 })
  return r.trim()
}

try {
  // 1) esegui lo script remoto in HOME sandbox
  const out = wsl(`set -e; rm -rf ${sandboxHome}; mkdir -p ${cfgDir}/secrets; export HOME=${sandboxHome}; cp /mnt/c/Users/Rhaegal222/AppData/Local/Temp/opencode/oc-e2e-script.sh /tmp/oc-e2e-script.sh && bash /tmp/oc-e2e-script.sh && echo SCRIPT_DONE`)
  if (!out.includes("SCRIPT_DONE")) throw new Error("script remoto non completato:\n" + out)

  // 2) artifact: chiave segreta scritta (NO tavily/supabase senza chiave), command copiato
  const files = wsl(`ls ${cfgDir}/secrets/${cfgDir}.no 2>/dev/null; ls ${cfgDir}/secrets 2>/dev/null; ls ${cfgDir}/command 2>/dev/null`)
  if (!files.includes("firecrawl.key")) throw new Error("firecrawl.key mancante:\n" + files)
  if (files.includes("tavily.key") || files.includes("supabase.key")) throw new Error("chiave scritta senza secret configurato:\n" + files)
  if (!files.includes("handoff.md")) throw new Error("command handoff.md mancante:\n" + files)

  // 3) file chiave = valore atteso
  const got = wsl(`cat ${cfgDir}/secrets/firecrawl.key`)
  if (got !== "E2E-FIRECRAWL-KEY-12345") throw new Error("contenuto key file errato: " + JSON.stringify(got))

  // 4) opencode reale legge la config - dopo il patcher: path normalizzati su CFG_DIR, enabled per esistenza file
  const mcpJson = wsl(`node -e "const c=require('${cfgDir}/opencode.json'); process.stdout.write(JSON.stringify(c.mcp))"`)
  const mcp = JSON.parse(mcpJson)
  if (mcp.firecrawl.enabled !== true || !mcp.firecrawl.environment || mcp.firecrawl.environment.FIRECRAWL_API_KEY.indexOf("{file:") !== 0) throw new Error("blocco mcp firecrawl malformato: " + mcpJson)
  if (!mcp.firecrawl.environment.FIRECRAWL_API_KEY.includes("secrets/firecrawl.key")) throw new Error("path {file:} non normalizzato su CFG_DIR: " + mcpJson)
  if (mcp.tavily.enabled !== false) throw new Error("tavily senza chiave deve essere disabled (patch): " + mcpJson)
  if (!/^@supabase\/mcp-server-supabase@0\.12\.0$/.test(mcp.supabase.command.slice(-1)[0])) throw new Error("comando supabase errato: " + mcpJson)

  // 5) {file:...} risolto da opencode reale: inietto probe nel blocco mcp e spawn via mcp list
  wsl(`set -e; export HOME=${sandboxHome}; cp /mnt/c/Users/Rhaegal222/AppData/Local/Temp/opencode/oc-e2e-probe.sh ${cfgDir}/e2e-probe.js; chmod +x ${cfgDir}/e2e-probe.js; node -e "
const fs=require('fs'); const p='${cfgDir}/opencode.json'; const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.mcp.e2eprobe={type:'local',command:['node','${cfgDir}/e2e-probe.js'],environment:{FIRECRAWL_API_KEY:'{file:${cfgDir}/secrets/firecrawl.key}'},enabled:true};
fs.writeFileSync(p, JSON.stringify(c,null,2));
"`)
  wsl(`rm -f /tmp/oc-e2e-probe.log; export HOME=${sandboxHome}; /tmp/oc-sandbox/opencode mcp list >/dev/null 2>&1; sleep 3; echo ---; cat /tmp/oc-e2e-probe.log 2>/dev/null || echo NO_PROBE_LOG`)
  const probeLogRaw = wsl(`cat /tmp/oc-e2e-probe.log 2>/dev/null || echo NO_PROBE_LOG`)
  if (!probeLogRaw.includes("E2E-FIRECRAWL-KEY-12345")) throw new Error("{file:...} non risolto da opencode reale:\n" + probeLogRaw)

  console.log("E2E OK: script remoto eseguito, artifact corretti, {file:...} risolto da opencode reale")
} catch (e) {
  console.error("E2E FAILED:", e.message)
  process.exit(1)
}