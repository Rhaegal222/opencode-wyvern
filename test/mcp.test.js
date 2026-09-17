import test from "node:test"
import assert from "node:assert/strict"
import { buildMcpBlock, buildServerConfig, buildRemoteScript } from "../src/server.js"

test("buildMcpBlock: con chiave → enabled + environment via {file:...}", () => {
  const block = buildMcpBlock(["firecrawl", "tavily"], { keys: { firecrawl: "sk-test" } })
  assert.equal(block.firecrawl.type, "local")
  assert.deepEqual(block.firecrawl.command, ["npx", "-y", "firecrawl-mcp@3.24.0"])
  assert.equal(block.firecrawl.enabled, true)
  assert.equal(block.firecrawl.environment.FIRECRAWL_API_KEY, "{file:~/.config/opencode/secrets/firecrawl.key}")
  assert.equal(block.tavily.enabled, false, "senza chiave → enabled false, config valida")
  assert.equal(block.tavily.environment, undefined)
})

test("buildServerConfig: mcp block presente solo con preset selezionati", () => {
  const cfg = buildServerConfig({ mcpList: ["supabase"], mcpKeys: { supabase: "sb-secret" } })
  assert.ok(cfg.mcp, "blocco mcp presente")
  assert.equal(cfg.mcp.supabase.command[2], "@supabase/mcp-server-supabase@0.12.0")
  assert.equal(cfg.mcp.supabase.environment.SUPABASE_ACCESS_TOKEN, "{file:~/.config/opencode/secrets/supabase.key}")
})

test("buildServerConfig: niente mcp se nessun preset", () => {
  const cfg = buildServerConfig({ providers: new Set(["zen"]) })
  assert.equal(cfg.mcp, undefined)
})

test("buildRemoteScript: scrive secrets MCP e installa tools", () => {
  const script = buildRemoteScript({
    sections: new Set(["server", "mcp", "tools"]),
    providers: new Set(["zen"]),
    mcpList: ["firecrawl", "tavily"],
    mcpKeys: { firecrawl: "fc-key" },
    tools: ["repomix"],
  })
  assert.ok(script.includes('mkdir -p "$CFG_DIR/plugins" "$CFG_DIR/command" "$CFG_DIR/secrets"'))
  assert.ok(script.includes("secrets/firecrawl.key"))
  assert.ok(!script.includes("secrets/tavily.key"), "tavily senza chiave → nessun file")
  assert.ok(script.includes('npm install -g repomix@latest'))
  const jsonLine = script.split("\n").find((l) => l.includes("opencode.json"))
  assert.ok(jsonLine, "opencode.json scritto")
  const decoded = JSON.parse(Buffer.from(jsonLine.match(/'([^']+)'/)[1], "base64").toString("utf8"))
  assert.equal(decoded.mcp.firecrawl.enabled, true)
  assert.equal(decoded.mcp.tavily.enabled, false, "nel json tavily resta disabled senza chiave")
})

test("buildRemoteScript: plugin superpowers+ponytail installati e listati", () => {
  const script = buildRemoteScript({
    sections: new Set(["server", "plugins"]),
    providers: new Set(["zen"]),
    plugins: ["superpowers", "ponytail"],
  })
  assert.ok(script.includes("superpowers@git+https://github.com/obra/superpowers.git"))
  assert.ok(script.includes("@dietrichgebert/ponytail@latest"))
  const jsonLine = script.split("\n").find((l) => l.includes("opencode.json"))
  const decoded = JSON.parse(Buffer.from(jsonLine.match(/'([^']+)'/)[1], "base64").toString("utf8"))
  assert.ok(decoded.plugin.includes("superpowers@git+https://github.com/obra/superpowers.git"))
  assert.ok(decoded.plugin.includes("@dietrichgebert/ponytail@latest"))
})

test("buildRemoteScript: nessun segreto litterale nello script", () => {
  const script = buildRemoteScript({
    sections: new Set(["server", "mcp"]),
    providers: new Set(["zen"]),
    mcpList: ["firecrawl"],
    mcpKeys: { firecrawl: "fc-real-key-12345" },
  })
  // la chiave viaggia solo come base64, mai in chiaro
  assert.ok(!script.includes("fc-real-key-12345"))
  assert.ok(script.includes(Buffer.from("fc-real-key-12345", "utf8").toString("base64")))
})