import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildClientConfig, bundledWyrmrestCa, installWyrmrestCa, isCertificateTrustError, mergeClientConfig, validateClientEndpoint, verifyWyrmrestCa, writeClientConfig, WYRMREST_CA_FINGERPRINT } from "../src/client-opencode.js"
import { chooseDefaultModels, defaultClientOmniRouteBase, defaultOmniRouteBase } from "../src/server.js"

test("endpoint OmniRoute server e client sono distinti", () => {
  assert.equal(defaultOmniRouteBase(), "http://127.0.0.1:20128")
  assert.equal(defaultClientOmniRouteBase(), "https://omniroute.wyrmrest.local")
})

test("config client locale usa routing esplicito per primary e subagent", () => {
  const cfg = buildClientConfig()
  assert.equal(cfg.model, "omniroute/auto/best-coding")
  assert.equal(cfg.small_model, "omniroute/auto/cheap")
  assert.deepEqual(cfg.agent, {
    plan: { mode: "primary", model: "omniroute/auto/best-reasoning" },
    build: { mode: "primary", model: "omniroute/auto/best-coding" },
    explore: { mode: "subagent", model: "omniroute/auto/cheap" },
    general: { mode: "subagent", model: "omniroute/auto/cheap" },
  })
  assert.equal(cfg.provider.omniroute.options.baseURL, "https://omniroute.wyrmrest.local/v1")
  assert.equal(JSON.stringify(cfg).includes("autoCombos"), false)
})

test("config server OmniRoute usa gli stessi modelli espliciti", () => {
  const models = chooseDefaultModels(new Set(["omniroute"]))
  assert.equal(models.defaultModel, "omniroute/auto/best-coding")
  assert.equal(models.smallModel, "omniroute/auto/cheap")
})

test("merge client conserva campi custom e deduplica plugin OmniRoute", () => {
  const generated = buildClientConfig()
  const current = {
    provider: { omniroute: { options: { custom: true }, customProvider: true } },
    agent: { plan: { prompt: "custom", temperature: 0.2 } },
    plugin: [generated.plugin[0], generated.plugin[0], "other-plugin"],
  }
  const merged = mergeClientConfig(current, generated)
  assert.equal(merged.provider.omniroute.customProvider, true)
  assert.equal(merged.provider.omniroute.options.custom, true)
  assert.equal(merged.agent.plan.prompt, "custom")
  assert.equal(merged.agent.plan.temperature, 0.2)
  assert.equal(merged.plugin.filter((entry) => Array.isArray(entry) && entry[0] === generated.plugin[0][0]).length, 1)
  assert.equal(merged.plugin.includes("other-plugin"), true)
})

test("writeClientConfig è idempotente", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-client-"))
  const filePath = path.join(dir, "opencode.json")
  writeClientConfig({ filePath })
  const first = fs.readFileSync(filePath, "utf8")
  writeClientConfig({ filePath })
  assert.equal(fs.readFileSync(filePath, "utf8"), first)
})

test("validazione endpoint richiede HTTPS e rete privata VPN", () => {
  assert.equal(validateClientEndpoint("http://gateway.example", ["10.0.0.2"]).code, "https-required")
  assert.equal(validateClientEndpoint("http://127.0.0.1:20128", ["127.0.0.1"]).ok, true)
  assert.equal(validateClientEndpoint("https://gateway.example", ["203.0.113.10"]).code, "vpn-private-required")
  assert.equal(validateClientEndpoint("https://gateway.example", ["10.10.0.2"]).ok, true)
})

test("CA Wyrmrest incorporata è valida e fissata per fingerprint", () => {
  assert.equal(verifyWyrmrestCa(bundledWyrmrestCa()), true)
  assert.match(WYRMREST_CA_FINGERPRINT, /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/)
  assert.equal(verifyWyrmrestCa(bundledWyrmrestCa().replace("W", "X")), false)
})

test("errori TLS della CA vengono riconosciuti", () => {
  for (const code of ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]) {
    assert.equal(isCertificateTrustError({ cause: { code } }), true)
  }
  assert.equal(isCertificateTrustError({ cause: { code: "ECONNREFUSED" } }), false)
})

test("installazione CA crea un trust anchor locale e configura Node su Linux", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-ca-"))
  const filePath = path.join(dir, "wyrmrest-ca.crt")
  const result = installWyrmrestCa({ filePath, home: dir, platform: "linux" })
  assert.equal(result.ok, true)
  assert.equal(result.path, filePath)
  assert.equal(verifyWyrmrestCa(fs.readFileSync(filePath, "utf8")), true)
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
  assert.match(fs.readFileSync(path.join(dir, ".profile"), "utf8"), /NODE_EXTRA_CA_CERTS/)
})

test("installazione CA configura NODE_EXTRA_CA_CERTS su Windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-ca-win-"))
  const filePath = path.join(dir, "wyrmrest-ca.crt")
  const calls = []
  const exec = (command, args) => {
    calls.push({ command, args })
    return { status: 0 }
  }
  assert.equal(installWyrmrestCa({ filePath, platform: "win32", exec }).ok, true)
  assert.equal(calls[0].command, "setx.exe")
  assert.deepEqual(calls[0].args, ["NODE_EXTRA_CA_CERTS", filePath])
})
