"use client"

import { useMemo, useState } from "react"

import { useCreateInventoryQualityInspection } from "@/hooks/use-inventory"
import { formatAllowedRange, qcExceptionFeedback, qcInputKind, type QcParameterRule } from "@/lib/qc-measurement"

/**
 * Reel-wise incoming QC (client 2026-10-26): every reel / coil of one GRN line in one table,
 * with its own readings and its own pass / hold / reject decision. Each row is saved as that
 * reel's own inspection, so one held reel never holds (or releases) the others.
 */
type Decision = "AUTO" | "HOLD" | "REJECT"
type Entry = { readings: Record<string, string>; decision: Decision; reason: string }
type Result = { ok: boolean; text: string }

const EMPTY: Entry = { readings: {}, decision: "AUTO", reason: "" }
const keyOf = (lot: any) => `${lot.entity_type}:${lot.entity_id}`
const filled = (entry?: Entry) => Boolean(entry && (Object.values(entry.readings).some((value) => String(value).trim() !== "") || entry.decision !== "AUTO"))

function errorText(error: any) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || "Could not save"
}

export function ReelWiseQcTable({ lots, rules, onSaved }: { lots: any[]; rules: QcParameterRule[]; onSaved?: (summary: string, tone: "success" | "info" | "error") => void }) {
  const save = useCreateInventoryQualityInspection()
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [busy, setBusy] = useState(false)
  const columns = useMemo(() => rules.filter((rule) => rule.applicable !== false), [rules])
  const entry = (lot: any) => entries[keyOf(lot)] || EMPTY
  const update = (lot: any, patch: Partial<Entry>) => setEntries((current) => ({ ...current, [keyOf(lot)]: { ...(current[keyOf(lot)] || EMPTY), ...patch } }))
  const setReading = (lot: any, code: string, value: string) => update(lot, { readings: { ...entry(lot).readings, [code]: value } })
  const toSave = lots.filter((lot) => filled(entries[keyOf(lot)]))

  function copyFirstRow() {
    const first = lots.find((lot) => Object.values(entry(lot).readings).some((value) => String(value).trim() !== ""))
    if (!first) return
    const source = entry(first).readings
    setEntries((current) => {
      const next = { ...current }
      for (const lot of lots) {
        const own = next[keyOf(lot)] || EMPTY
        if (!Object.values(own.readings).some((value) => String(value).trim() !== "")) next[keyOf(lot)] = { ...own, readings: { ...source } }
      }
      return next
    })
  }

  async function saveAll() {
    if (!toSave.length) return
    setBusy(true)
    const outcome: Record<string, Result> = {}
    let passed = 0
    let held = 0
    let failedToSave = 0
    for (const lot of toSave) {
      const row = entry(lot)
      const readings = Object.fromEntries(
        Object.entries(row.readings)
          .filter(([, value]) => String(value).trim() !== "")
          .map(([code, value]) => {
            const number = Number(value)
            return [code, Number.isFinite(number) && qcInputKind(columns.find((rule) => rule.code === code)) === "number" ? number : value]
          }),
      )
      // The one reason written on the row explains every reading of that reel that is out of band.
      const reasons = row.reason.trim()
        ? Object.fromEntries(columns.filter((rule) => qcExceptionFeedback(rule, row.readings[rule.code])?.verdict === "FAIL").map((rule) => [rule.code, row.reason.trim()]))
        : {}
      try {
        const response = await save.mutateAsync({
          entity_type: lot.entity_type,
          entity_id: lot.entity_id,
          material_type: lot.material_type,
          source: lot.source || "INWARD",
          readings,
          reasons,
          notes: row.reason.trim() || undefined,
          disposition: row.decision === "AUTO" ? undefined : row.decision,
        })
        const data = response?.data || {}
        const released = data.stock_status === "UNRESTRICTED"
        if (released) passed += 1
        else held += 1
        outcome[keyOf(lot)] = { ok: true, text: `${data.status}${released ? " · released" : " · held"}` }
      } catch (error) {
        failedToSave += 1
        outcome[keyOf(lot)] = { ok: false, text: errorText(error) }
      }
    }
    setResults((current) => ({ ...current, ...outcome }))
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !outcome[key]?.ok)))
    setBusy(false)
    onSaved?.(
      `Saved ${toSave.length - failedToSave} of ${toSave.length} reels: ${passed} released, ${held} held${failedToSave ? `, ${failedToSave} not saved` : ""}.`,
      failedToSave ? "error" : held ? "info" : "success",
    )
  }

  if (!columns.length) return null
  return (
    <div className="space-y-3" data-testid="reel-wise-qc">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          Enter each reel&apos;s readings on its own row. <strong className="text-foreground">Decision</strong>: &quot;Pass if in band&quot; releases the reel only when every reading is within the standard; &quot;Hold&quot; keeps it out of issue. Rows left empty are not saved.
        </p>
        <button type="button" onClick={copyFirstRow} className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
          Copy first filled row to empty rows
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-muted text-left text-[11.5px] text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-40 whitespace-nowrap bg-muted px-2 py-2 font-semibold">Reel / coil</th>
              {columns.map((rule) => (
                <th key={rule.code} className="min-w-24 px-2 py-2 align-bottom font-semibold" title={formatAllowedRange(rule)}>
                  {rule.label}
                  <span className="block font-normal">{formatAllowedRange(rule).replace(/^Allowed: /, "")}</span>
                </th>
              ))}
              <th className="px-2 py-2 font-semibold">Decision</th>
              <th className="px-2 py-2 font-semibold">Reason / note</th>
              <th className="px-2 py-2 font-semibold">Saved</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot, index) => {
              const row = entry(lot)
              const result = results[keyOf(lot)]
              return (
                <tr key={keyOf(lot)} className="border-t border-border align-top" data-testid={`reel-wise-row-${index}`}>
                  <td className="sticky left-0 z-10 min-w-40 whitespace-nowrap bg-card px-2 py-2">
                    <p className="font-semibold">{lot.unit_label || String(lot.label || "").split(" · ")[0]}</p>
                    <p className="text-[11.5px] text-muted-foreground">{lot.unit_ref ? `Vendor ${lot.unit_ref} · ` : ""}{lot.qty} {lot.uom || "KG"}</p>
                    {lot.last_inspection ? <p className="text-[11px] text-muted-foreground">Last: {lot.last_inspection.status}{lot.last_inspection.disposition ? ` · ${lot.last_inspection.disposition}` : ""}</p> : null}
                  </td>
                  {columns.map((rule) => {
                    const value = row.readings[rule.code] || ""
                    const verdict = qcExceptionFeedback(rule, value)?.verdict
                    const tone = verdict === "FAIL" || verdict === "INVALID" ? "border-signal-rose-line bg-signal-rose-soft" : verdict === "PASS" ? "border-signal-emerald-line" : "border-input"
                    const label = `${lot.unit_label || "Reel"} ${rule.label}`
                    return (
                      <td key={rule.code} className="px-1 py-1.5">
                        {qcInputKind(rule) === "select" ? (
                          <select aria-label={label} data-testid={`reel-wise-${index}-${rule.code}`} value={value} onChange={(event) => setReading(lot, rule.code, event.target.value)} className={`h-9 w-28 rounded-lg border bg-card px-2 ${tone}`}>
                            <option value="">—</option>
                            {(rule.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            aria-label={label}
                            data-testid={`reel-wise-${index}-${rule.code}`}
                            type={qcInputKind(rule) === "number" ? "number" : "text"}
                            step="0.001"
                            inputMode={qcInputKind(rule) === "number" ? "decimal" : undefined}
                            value={value}
                            onChange={(event) => setReading(lot, rule.code, event.target.value)}
                            className={`h-9 rounded-lg border bg-card px-2 tabular-nums ${qcInputKind(rule) === "number" ? "w-20" : "w-32"} ${tone}`}
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1.5">
                    <select aria-label={`${lot.unit_label || "Reel"} decision`} data-testid={`reel-wise-${index}-decision`} value={row.decision} onChange={(event) => update(lot, { decision: event.target.value as Decision })} className="h-9 rounded-lg border border-input bg-card px-2">
                      <option value="AUTO">Pass if in band</option>
                      <option value="HOLD">Hold</option>
                      <option value="REJECT">Reject</option>
                    </select>
                  </td>
                  <td className="px-1 py-1.5">
                    <input aria-label={`${lot.unit_label || "Reel"} reason`} value={row.reason} onChange={(event) => update(lot, { reason: event.target.value })} placeholder="If out of band or held" className="h-9 w-44 rounded-lg border border-input bg-card px-2" />
                  </td>
                  <td className={`px-2 py-2 text-[12px] ${result ? (result.ok ? "text-foreground" : "text-signal-rose-ink") : "text-muted-foreground"}`} data-testid={`reel-wise-${index}-result`}>
                    {result ? result.text : filled(entries[keyOf(lot)]) ? "To save" : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        data-testid="reel-wise-save"
        disabled={busy || !toSave.length}
        onClick={() => void saveAll()}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Saving reels…" : toSave.length ? `Save ${toSave.length} reel${toSave.length === 1 ? "" : "s"}` : "Enter readings to save"}
      </button>
    </div>
  )
}
