"use client"

// Stage QC readings for one batch: one row per check (name, allowed limit, one box per sample);
// rows stack on a phone and line up as columns on a PC.
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
      <p className="text-xs text-muted-foreground">
        {stageLabel}: measure {needed || "the"} sample{needed === 1 ? "" : "s"} and type each in its own box (S1, S2…). Green = within limits, red = outside.
      </p>
      <div className="divide-y divide-border rounded-xl border border-border bg-background">
        {shown.map((rule) => {
          const done = samples.filter((sample) => num(sample.readings[rule.code]) != null).length
          const need = Number(rule.min_readings || 0)
          return (
            <div key={rule.code} className="grid gap-1.5 px-3 py-2.5 md:grid-cols-[minmax(8rem,13rem)_minmax(8rem,12rem)_1fr] md:items-center md:gap-3">
              <div className="flex items-baseline justify-between gap-2 md:block">
                <span className="text-sm font-semibold text-foreground">
                  {rule.label}
                  {rule.unit ? <span className="font-normal text-muted-foreground"> ({rule.unit})</span> : null}
                </span>
                <span className={`text-xs font-semibold md:hidden ${need && done >= need ? "text-signal-emerald-ink" : "text-muted-foreground"}`}>
                  {done}/{need || done}
                </span>
              </div>
              <div className="text-xs font-semibold text-signal-emerald-ink" data-testid={`qc-allowed-${rule.code}`}>
                {allowedText(rule)}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {samples.map((sample, i) => {
                  const verdict = readingVerdict(rule, sample.readings[rule.code], sample.readings)
                  const band = rule.dynamic ? sampleBand(rule, sample.readings) : null
                  return (
                    <div key={sample.sample_id} className="w-[5.75rem]">
                      {editable ? (
                        <input
                          aria-label={`${rule.label} sample ${i + 1}`}
                          data-testid={`qc-reading-${rule.code}-${i + 1}`}
                          type="number"
                          step="any"
                          inputMode="decimal"
                          placeholder={`S${i + 1}`}
                          value={sample.readings[rule.code] ?? ""}
                          onChange={(event) => setReading(i, rule.code, event.target.value)}
                          className={`h-11 w-full rounded-lg border px-2 text-[15px] tabular-nums ${
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
                        <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                          {band.min != null ? fmt(band.min) : "…"}–{band.max != null ? fmt(band.max) : "…"}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                <span className={`hidden self-center text-xs font-semibold md:inline ${need && done >= need ? "text-signal-emerald-ink" : "text-muted-foreground"}`}>
                  {done}/{need || done}
                </span>
              </div>
            </div>
          )
        })}
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
