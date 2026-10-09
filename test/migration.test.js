import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CONFIG_VERSION, migrateConfig, saveConfig } from "../src/config.js"
import { buildMcpBlock, MCP_PRESET_IDS, mcpSecretFile } from "../src/server.js"

test("config pulita alla versione corrente non viene toccata", () => {
  const cfg = { configVersion: CONFIG_VERSION, entry: { host: "x" }, sections: { mcp: true, "client-local": false }, mcpList: ["firecrawl"], clientLocal: { omnirouteUrl: "https://omniroute.example.com", installBinary: false, caConfigured: false } }
  const out = migrateConfig(cfg)
  assert.equal(out, cfg, "nessuna modifica se già a v4 con preset validi")
})

test("v4: residuo figma attivo senza preset viene disattivato", () => {
  const cfg = { configVersion: 3, sections: { mcp: true, server: true }, mcpList: ["figma-developer"] }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, CONFIG_VERSION)
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
  assert.equal(out.configVersion, CONFIG_VERSION)
  assert.equal(out.mcpList, undefined)
})

test("v5: config legacy conserva dati e aggiunge client locale disattivo", () => {
  const cfg = { configVersion: 3, entry: { host: "y" }, customCommands: ["baseline-ui"] }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, CONFIG_VERSION)
  assert.equal(out.entry.host, "y")
  assert.deepEqual(out.customCommands, ["baseline-ui"])
  assert.equal(out.sections["client-local"], false)
  assert.deepEqual(out.clientLocal, { omnirouteUrl: "http://127.0.0.1:20128", installBinary: false, caConfigured: false })
})

test("v6: client locale esistente viene marcato per configurare la CA", () => {
  const cfg = { configVersion: 5, sections: { "client-local": true }, clientLocal: { omnirouteUrl: "https://omniroute.example.com", installBinary: true } }
  const out = migrateConfig(cfg)
  assert.equal(out.configVersion, 6)
  assert.deepEqual(out.clientLocal, { omnirouteUrl: "https://omniroute.example.com", installBinary: true, caConfigured: false })
})

test("config future non viene retrocessa", () => {
  const cfg = { configVersion: CONFIG_VERSION + 2, sections: { server: true } }
  assert.equal(migrateConfig(cfg), cfg)
})

test("saveConfig aggiunge la versione e conserva versioni future", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-config-"))
  const filePath = path.join(dir, "config.json")
  saveConfig({ sections: {} }, { filePath })
  assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).configVersion, CONFIG_VERSION)
  saveConfig({ configVersion: CONFIG_VERSION + 3 }, { filePath })
  assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).configVersion, CONFIG_VERSION + 3)
})
