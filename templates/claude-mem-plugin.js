// Wrapper di compatibilità per claude-mem.
// Re-esporta il plugin installato da `opcode-mem` con `export default`,
// così il loader di opencode lo carica correttamente anche quando insieme
// sono presenti altri plugin/auth provider. Nessun dato sensibile qui.

export { default } from "opcode-mem/dist/mem-plugin.js"