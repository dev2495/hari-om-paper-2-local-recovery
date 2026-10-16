"use client"

// Stage QC readings for one batch: one row per parameter, one column per sample.
// Each row shows what is allowed in plain words; each cell turns green or red as it is typed,
// using the same frozen limits the server checks. Oven pre/post readings of a sample share a column.

import { relativeLimitText } from "@/lib/qc-measurement"

type Rule = {
  code: string
  label: string
  unit?: string | null
  min?: number | null
  max?: number | null
  mode?: string | null
  dynamic?: boolean
  lower?: { ref: string; factor: number; offset?: number }[]
  upper?: { ref: string; factor: number; offset?: number }[]
  applicable?: boolean | null
  min_readings?: number | null
}

export type QcSample = { sample_id: string; readings: Record<string, any> }

const num = (value: any) => (value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value))
const fmt = (value: number) => Number(value.toFixed(3)).toString()

function termValue(term: { ref: string; factor: number; offset?: number }, readings: Record<string, any>) {
  if (!term.ref.startsWith("SAMPLE.")) return null
  const base = num(readings[term.ref.slice(7)])
  return base == null ? null : base * Number(term.factor) + Number(term.offset || 0)
}

/** Limits for this sample: fixed limits, or limits computed from another reading of the same sample. */
export function sampleBand(rule: Rule, readings: Record<string, any>): { min: number | null; max: number | null } {
  if (!rule.dynamic) return { min: num(rule.min), max: num(rule.max) }
  const lows = (rule.lower || []).map((t) => termValue(t, readings)).filter((v): v is number => v != null)
  const highs = (rule.upper || []).map((t) => termValue(t, readings)).filter((v): v is number => v != null)
  return { min: lows.length ? Math.max(...lows) : null, max: highs.length ? Math.min(...highs) : null }
}

/** What is allowed, in words a QC inspector reads at a glance. */
export function allowedText(rule: Rule): string {
  const unit = rule.unit ? ` ${rule.unit}` : ""
  if (rule.applicable === false) return "Not checked on this card"
  if (rule.mode === "RECORD_ONLY") return "Record the reading (no limit)"
  if (rule.dynamic) {
    const words = relativeLimitText(rule) || "computed from this sample's other readings"
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  const min = num(rule.min)
  const max = num(rule.max)
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}${unit}`
  if (min != null) return `at least ${fmt(min)}${unit}`
  if (max != null) return `at most ${fmt(max)}${unit}`
  return "Record the reading (no limit)"
}

export function readingVerdict(rule: Rule, value: any, readings: Record<string, any>): "" | "pass" | "fail" {
  const reading = num(value)
  if (reading == null || rule.mode === "RECORD_ONLY") return ""
  const band = sampleBand(rule, readings)
  if (band.min == null && band.max == null) return ""
  if ((band.min != null && reading < band.min - 1e-9) || (band.max != null && reading > band.max + 1e-9)) return "fail"
  return "pass"
}

export function SeasonQcMatrix({
  rules,
  samples,
  onChange,
  editable = true,
  stageLabel,
}: {
  rules: Rule[]
  samples: QcSample[]
  onChange?: (samples: QcSample[]) => void
  editable?: boolean
  stageLabel: string
}) {
  const shown = rules.filter((rule) => rule.applicable !== false)
  if (!shown.length) return null
  const needed = Math.max(...shown.map((rule) => Number(rule.min_readings || 0)), 0)
  const setReading = (index: number, code: string, value: string) =>
    onChange?.(samples.map((sample, i) => (i === index ? { ...sample, readings: { ...sample.readings, [code]: value } } : sample)))
  const failures = shown.flatMap((rule) =>
    samples.map((sample, i) => (readingVerdict(rule, sample.readings[rule.code], sample.readings) === "fail" ? `${rule.label} · sample ${i + 1}` : null)).filter(Boolean),
  )
  return (
    <div className="space-y-2" data-testid="season-qc-matrix">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{stageLabel} QC readings for this batch</p>
        <p className="text-xs text-muted-foreground">
          Measure {needed || "the"} sample{needed === 1 ? "" : "s"} and write each one in its own column. Green = within limits, red = out of limits.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">Check</th>
              <th className="px-2 py-2 font-semibold">Allowed</th>
              {samples.map((sample, i) => (
                <th key={sample.sample_id} className="px-2 py-2 font-semibold">
                  Sample {i + 1}
                </th>
              ))}
              <th className="px-2 py-2 font-semibold">Done</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((rule) => {
              const done = samples.filter((sample) => num(sample.readings[rule.code]) != null).length
              const need = Number(rule.min_readings || 0)
              return (
                <tr key={rule.code} className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <div className="font-medium text-foreground">{rule.label}</div>
                    {rule.unit ? <div className="text-xs text-muted-foreground">{rule.unit}</div> : null}
                  </td>
                  <td className="px-2 py-2 text-xs font-semibold text-foreground" data-testid={`qc-allowed-${rule.code}`}>
                    {allowedText(rule)}
                  </td>
                  {samples.map((sample, i) => {
                    const verdict = readingVerdict(rule, sample.readings[rule.code], sample.readings)
                    const band = rule.dynamic ? sampleBand(rule, sample.readings) : null
                    return (
                      <td key={sample.sample_id} className="px-2 py-2">
                        {editable ? (
                          <input
                            aria-label={`${rule.label} sample ${i + 1}`}
                            data-testid={`qc-reading-${rule.code}-${i + 1}`}
                            type="number"
                            step="any"
                            inputMode="decimal"
                            value={sample.readings[rule.code] ?? ""}
                            onChange={(event) => setReading(i, rule.code, event.target.value)}
                            className={`h-10 w-24 rounded-lg border px-2 text-sm ${
                              verdict === "fail"
                                ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
                                : verdict === "pass"
                                  ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
                                  : "border-border bg-background"
                            }`}
                          />
                        ) : (
                          <span className={verdict === "fail" ? "font-semibold text-signal-rose-ink" : ""}>{sample.readings[rule.code] ?? "—"}</span>
                        )}
                        {band && (band.min != null || band.max != null) ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {band.min != null ? fmt(band.min) : "…"} – {band.max != null ? fmt(band.max) : "…"} {rule.unit || ""}
                          </div>
                        ) : null}
                      </td>
                    )
                  })}
                  <td className={`px-2 py-2 text-xs font-semibold ${need && done >= need ? "text-signal-emerald-ink" : "text-muted-foreground"}`}>
                    {done}/{need || done}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {failures.length ? (
        <p className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-xs text-signal-rose-ink" role="status">
          Out of limits: {failures.join(" · ")}. The batch is held until QC decides.
        </p>
      ) : null}
      {editable ? (
        <button
          type="button"
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
          onClick={() => onChange?.([...samples, { sample_id: crypto.randomUUID(), readings: {} }])}
        >
          + Add another sample
        </button>
      ) : null}
    </div>
  )
}
