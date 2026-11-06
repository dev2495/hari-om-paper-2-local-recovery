/** Pure helpers of the gate (6 Nov 2026): mobile numbers and the pass / challan QR payloads. */

/** "9876543210" from what a person typed ("+91 98765 43210", "098765 43210"). */
export function mobileDigits(value: string): string {
  let digits = String(value || "").replace(/\D/g, "")
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1)
  return digits.slice(0, 10)
}

export const isMobile = (value: string) => /^[6-9]\d{9}$/.test(mobileDigits(value))

/** The pass token from a scanned pass QR ("HARIOM|VISIT|<token>" or a /visit/pass/<token> link). */
export function passTokenFromScan(value: string): string | null {
  const raw = String(value || "").trim()
  const link = /\/visit\/pass\/([A-Za-z0-9_-]{16,64})/.exec(raw)
  if (link) return link[1]
  if (/^HARIOM\|VISIT\|/i.test(raw)) return raw.split("|")[2]?.trim() || null
  return null
}

/** The dispatch_ref from a scanned challan QR ("HARIOM|DISPATCH|<plant>|<ref>" or a /gate?out=<ref> link). */
export function dispatchRefFromScan(value: string): string | null {
  const raw = String(value || "").trim()
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/gate")) {
      const url = new URL(raw, "http://x")
      const ref = url.searchParams.get("out")
      if (ref) return ref
    }
  } catch { /* not a link */ }
  if (/^HARIOM\|DISPATCH\|/i.test(raw)) return raw.split("|").slice(3).join("|").trim() || null
  return raw || null
}
