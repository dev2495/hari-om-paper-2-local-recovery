/**
 * One reader for everything printed with a QR (client 2026-10-27).
 *
 * New prints carry a link the phone camera opens: job cards `https://<site>/production/entry/<id>`,
 * material lots and tools `https://<site>/scan?c=<payload>`. In-app scan boxes and handheld scanners
 * may still hand us the older forms, so all of them are read here:
 *   - `HARIOM|REEL|<plant>|<id>|<AT no>` / `HARIOM|BATCH|<plant>|<id>|<lot no>` (lot labels)
 *   - `HARIOM|LOC|<plant>|<location id>|<CODE>` (rack / location labels, client 2026-10-28)
 *   - `hariom://tool/<asset no>` (tool labels)
 *   - `/production/entry/<id>`, `/production/job-cards/<id>`, `…supervisor-entry?job_card_id=<id>` (job cards)
 *   - a bare AT / lot / card number typed by hand.
 */

export type ScanKind = "JOB_CARD" | "REEL" | "BATCH" | "LOCATION" | "TOOL" | "CODE"

export type ParsedScan = {
  kind: ScanKind
  /** Record id (job card, reel, batch or location) when the value carries one. */
  id: string
  /** Plant the label was printed for (lot and location labels only). */
  plantId: string
  /** Human code: AT number, lot number, rack code, tool asset number, or the typed text. */
  code: string
  raw: string
}

const JOB_CARD_PATH = /\/production\/(?:entry|job-cards)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const LEGACY_ENTRY = /\/(?:production\/)?(?:supervisor-entry|eod-entry|entry)\b/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLANT_ID = /^[\w-]{1,64}$/
/** Label type in a `HARIOM|<type>|…` payload → scan kind. `LOCATION` is accepted as a long form of `LOC`. */
const LABEL_KINDS: Record<string, ScanKind> = { REEL: "REEL", BATCH: "BATCH", LOC: "LOCATION", LOCATION: "LOCATION" }

/** The printed payload of a location label; the QR carries it inside a `/scan?c=` link (buildScanUrl). */
export function locationScanPayload(plantId: string, locationId: string, code: string) {
  return `HARIOM|LOC|${plantId}|${locationId}|${code}`
}

function result(kind: ScanKind, raw: string, extra: Partial<ParsedScan> = {}): ParsedScan {
  return { kind, id: "", plantId: "", code: "", raw, ...extra }
}

/** Decode %-escapes; a malformed label keeps its raw text instead of throwing (a bad label never crashes a page). */
function decoded(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function asUrl(text: string): URL | null {
  try {
    if (/^https?:\/\//i.test(text)) return new URL(text)
    if (text.startsWith("/")) return new URL(text, "http://scan.local")
  } catch {
    return null
  }
  return null
}

export function parseScanCode(value: string | null | undefined, depth = 0): ParsedScan {
  const raw = String(value ?? "").trim()
  if (!raw) return result("CODE", raw)

  const tool = raw.match(/^hariom:\/\/tool\/(.+)$/i)
  if (tool) return result("TOOL", raw, { code: decoded(tool[1]).trim() })

  const parts = raw.split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") {
    const type = parts[1].toUpperCase()
    const id = parts[3].trim()
    const plant = parts[2].trim()
    const code = parts.slice(4).join("|").trim()
    // The id goes into API paths, so only a real record id counts; anything else is looked up by its printed number.
    const kind = LABEL_KINDS[type]
    if (!kind || !UUID.test(id)) return result("CODE", raw, { code: code || raw })
    return result(kind, raw, { plantId: PLANT_ID.test(plant) ? plant : "", id: id.toLowerCase(), code })
  }

  const url = asUrl(raw)
  if (url) {
    const inner = url.searchParams.get("c") || url.searchParams.get("scan")
    if (inner && depth < 2) return { ...parseScanCode(inner, depth + 1), raw }
    const card = url.pathname.match(JOB_CARD_PATH)
    if (card) return result("JOB_CARD", raw, { id: card[1].toLowerCase() })
    const legacyId = url.searchParams.get("job_card_id")
    if (legacyId && LEGACY_ENTRY.test(url.pathname) && UUID.test(legacyId)) return result("JOB_CARD", raw, { id: legacyId.toLowerCase() })
    return result("CODE", raw, { code: raw })
  }

  return result("CODE", raw, { code: raw })
}

/** The job card id in a scanned value, or the trimmed text when it is not a job card link. */
export function jobCardIdOf(value: string) {
  const parsed = parseScanCode(value)
  return parsed.kind === "JOB_CARD" ? parsed.id : parsed.raw
}
