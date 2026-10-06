import test from "node:test"
import assert from "node:assert/strict"
import { setSectionState } from "../src/sections.js"

test("activate e deactivate cambiano solo la sezione richiesta", () => {
  const initial = { server: false, providers: true }
  assert.deepEqual(setSectionState(initial, "client-local", true), { server: false, providers: true, "client-local": true })
  assert.deepEqual(setSectionState(initial, "providers", false), { server: false, providers: false })
})
