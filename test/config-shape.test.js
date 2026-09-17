import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildServerConfig, buildRemoteScript, MCP_PRESETS, patchMcpBlock } from "../src/server.js"

/**
 * Valida la FORMA del blocco MCP generato (struttura statica, offline):
 * anti-Figma lesson: il cablaggio deve produrre esattamente il formato
 * locale documentato da opencode (McpLocalConfig: type/command/environment/…).
 */
test("blocco MCP: struttura McpLocalConfig corretta", () => {
  const cfg = buildServerConfig({
    mcpList: ["firecrawl", "tavily", "supabase"],
    mcpKeys: { firecrawl: "k1", tavily: "k2", supabase: "k3" },
  })
  assert.ok(cfg.mcp, "blocco mcp presente")
  for (const id of Object.keys(MCP_PRESETS)) {
    const e = cfg.mcp[id]
    assert.ok(e, `mcp.${id} presente`)
    assert.equal(e.type, "local")
    assert.ok(Array.isArray(e.command) && e.command.length >= 1)
    assert.ok(e.command.every((x) => typeof x === "string"))
    assert.equal(e.enabled, true, `${id} con chiave è enabled`)
    const envKey = MCP_PRESETS[id].envKey
    assert.equal(typeof e.environment[envKey], "string")
    assert.match(e.environment[envKey], /^\{file:+~.+\.key\}$/, `${id}: environment via {file:...}`)
  }
})

test("blocco MCP: nessuna chiave nel JSON prodotto", () => {
  const cfg = buildServerConfig({ mcpList: ["firecrawl"], mcpKeys: { firecrawl: "ALEATORIO-SEGRETO" } })
  const json = JSON.stringify(cfg)
  assert.ok(!json.includes("ALEATORIO-SEGRETO"), "la chiave non appare mai in chiaro nell'oggetto JSON")
  // buildRemoteScript: idem, e il b64 NON è la chiave in chiaro
  const script = buildRemoteScript({ sections: new Set(["mcp"]), mcpList: ["firecrawl"], mcpKeys: { firecrawl: "ALEATORIO-SEGRETO" } })
  assert.ok(!script.includes("ALEATORIO-SEGRETO"))
})

test("script remoto: riga secret file presente per ogni MCP con chiave", () => {
  const script = buildRemoteScript({
    sections: new Set(["mcp"]),
    mcpList: ["firecrawl", "supabase", "tavily"],
    mcpKeys: { firecrawl: "a", supabase: "b" },
  })
  const lines = script.split("\n")
  // la riga di "scrittura" del secret è quella base64 → > path; chmod è separata
  const writeLines = lines.filter((l) => l.includes("base64 -d > ") && l.includes("secrets/") && l.includes(".key"))
  assert.equal(writeLines.filter((l) => l.includes("firecrawl.key")).length, 1, "firecrawl scrive il suo key file")
  assert.equal(writeLines.filter((l) => l.includes("supabase.key")).length, 1, "supabase scrive il suo key file")
  assert.equal(writeLines.filter((l) => l.includes("tavily.key")).length, 0, "tavily senza chiave non scrive file")
})

test("script remoto: haServer true anche solo con mcp (senza provider)", () => {
  const script = buildRemoteScript({ sections: new Set(["mcp"]), mcpList: ["tavily"] })
  assert.ok(script.includes("opencode.json"), "con mcp attivo l'opencode.json viene riscritto")
})

test("patchMcpBlock: normalizza path {file:} e abilita solo se il secret esiste", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-patch-"))
  const keyFile = path.join(dir, "secrets", "firecrawl.key")
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, "k", "utf8")

  const cfg = buildServerConfig({ mcpList: ["firecrawl", "tavily"], mcpKeys: { firecrawl: "k1" } })
  const patched = patchMcpBlock(
    JSON.parse(JSON.stringify(cfg)),
    cfg.mcp,
    dir.endsWith("/") ? dir.slice(0, -1) : dir,
  )
  assert.equal(patched.mcp.firecrawl.enabled, true)
  assert.equal(patched.mcp.firecrawl.environment.FIRECRAWL_API_KEY, `{file:${dir}/secrets/firecrawl.key}`)
  assert.equal(patched.mcp.tavily.enabled, false, "senza file segreto → disabled")
  // nessuna doppia graffa / path corrotti
  assert.ok(!patched.mcp.firecrawl.environment.FIRECRAWL_API_KEY.includes("}}"))
})