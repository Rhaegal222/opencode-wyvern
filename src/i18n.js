/**
 * Localizzazione interfacce.
 *
 * Rileva la locale di sistema e rende coerente TUTTA la GUI:
 * - locale che inizia con "it" → italiano
 * - altrimenti → inglese
 *
 * Override: `OC_LANG=it` oppure `OC_LANG=en`.
 */
const raw = process.env.OC_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ""
const sys = raw || (Intl?.DateTimeFormat?.().resolvedOptions?.().locale ?? "") || "en"

export const LANG = /^it\b/i.test(sys) ? "it" : "en"
export const isIt = LANG === "it"
export const ui = (it, en) => (isIt ? it : en)

export const qHint   = ui("q=esci", "q=quit")
export const qLegend = ui("q=Esci", "q=Exit")
export const cancelMsg = ui("annullato.", "cancelled.")
