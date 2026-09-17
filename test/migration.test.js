import test from "node:test"
import assert from "node:assert/strict"
import { migrateConfig } from "../src/config.js"
import { buildMcpBlock, MCP_PRESET_IDS, mcpSecretFile } from "../src/server.js"

test("v4: config pulita già a CONFIG_VERSION 4 non viene toccata", () => {
  const cfg = { configVersion: 4, entry: { host: "x" }, sections: { mcp: true }, mcpList: ["firecrawl"] }
  const out = migrateConfig(cfg)
  assert.equal(out, cfg, "nessuna modifica se già a v4 con preset validi")
})

test("v4: residuo figma attivo senza preset viene disattivato", () => {
  const cfg = { configVersion: 3, sections: { mcp: true, server: true }, mcpList: ["figma-developer"] }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, 4)
  assert.equal(out.sections.mcp, false, "sezione mcp attiva senza preset validi → disattivata")
  assert.equal(out.mcpList, undefined, "mcpList figma viene rimosso")
})

test("v4: mcpList figma con preset misti tiene solo i preset validi", () => {
  const cfg = { configVersion: 3, sections: { mcp: true }, mcpList: ["figma", "tavily"] }
  const out = migrateConfig(cfg)
  assert.deepEqual(out.mcpList, ["tavily"])
  assert.equal(out.sections.mcp, true, "preset valido presente → sezione resta attiva")
})

test("v4: mcpList non array non rompe la migrazione", () => {
  const cfg = { configVersion: 3, mcpList: "figma" }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, 4)
  assert.equal(out.mcpList, undefined)
})

test("v4: config v3 senza sezione mcp resta intatta tranne version", () => {
  const cfg = { configVersion: 3, entry: { host: "y" }, customCommands: ["baseline-ui"] }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, 4)
  assert.equal(out.entry.host, "y")
  assert.deepEqual(out.customCommands, ["baseline-ui"])
})