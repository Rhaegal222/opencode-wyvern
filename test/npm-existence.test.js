import test from "node:test"
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { PLUGIN_PKG, TOOL_PKG, MCP_PRESETS } from "../src/server.js"

/**
 * Guardia anti-Figma: ogni preset MCP/tool/plugin del pacchetto deve puntare a
 * un pacchetto npm REALE e stabile. Se un preset riferimento qualcosa che non
 * esiste su npm, qui fallisce prima della pubblicazione.
 * NB: fa rete (npm view). Le versioni sono fissate esplicitamente nei comandi MCP.
 */
function npmExists(pkg) {
  const name = pkg.replace(/@latest$/, "")
  try {
    execSync(`npm view ${JSON.stringify(name)} version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 })
    return true
  } catch {
    return false
  }
}

test("MCP_PRESETS: tutti i pacchetti esistono su npm (no Figma 2.0)", () => {
  for (const [id, preset] of Object.entries(MCP_PRESETS)) {
    const cmd = preset.command
    assert.equal(cmd[0], "npx", `preset ${id}: comando npx`)
    // formato: ["npx","-y","<pkg>@<ver>"]
    const spec = cmd[2]
    assert.match(spec, /@\d+\.\d+\.\d+$/, `preset ${id}: versione pinnata (${spec})`)
    const pkg = spec.split("@").slice(0, -1).join("@")
    assert.ok(npmExists(pkg), `preset ${id}: pacchetto npm esiste (${pkg})`)
    assert.ok(preset.envKey, `preset ${id}: envKey dichiarata`)
    assert.ok(preset.secretFile.endsWith(".key"), `preset ${id}: secretFile valido`)
  }
})

test("PLUGIN_PKG: plugin npm esistono (o sono spec git valide)", () => {
  // superpowers è una spec git (non interrogabile via npm view come versione pura)
  assert.match(PLUGIN_PKG.superpowers, /^superpowers@git\+/)
  assert.ok(npmExists("@dietrichgebert/ponytail"), "ponytail esiste su npm (niente @0xwilliamortiz/ponytail-improved)")
  assert.ok(npmExists("opencode-claude-auth"), "claude-auth")
  assert.ok(npmExists("@omniroute/opencode-plugin"), "omniroute")
})

test("TOOL_PKG: repomix esiste su npm", () => {
  assert.ok(npmExists("repomix"), "repomix esiste")
})