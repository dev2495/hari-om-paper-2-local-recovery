"use client"

import { CheckCircle2, CircleSlash, ClipboardCheck, Copy, Hand, Loader2, OctagonX, TriangleAlert } from "lucide-react"
import { KeyboardEvent, useMemo, useState } from "react"

import { useCreateInventoryQualityInspection } from "@/hooks/use-inventory"
import {
  EMPTY_ENTRY,
  applicableRules,
  cellVerdict,
  entryHasInput,
  incomingReadingsPayload,
  incomingReasonsPayload,
  lotKey,
  lotName,
  previewIncomingLot,
  type IncomingDecision,
  type IncomingEntry,
  type IncomingPreview,
} from "@/lib/incoming-qc"
import { formatAllowedRange, qcInputKind, type QcParameterRule } from "@/lib/qc-measurement"
import { cn } from "@/lib/utils"

type Saved = { ok: boolean; released?: boolean; text: string; readings?: Record<string, string> }

const DECISIONS: Array<{ key: IncomingDecision; label: string; title: string }> = [
  { key: "AUTO", label: "By readings", title: "Released only if every check is within its band" },
  { key: "HOLD", label: "Hold", title: "Keep out of issue for review" },
  { key: "REJECT", label: "Reject", title: "Reject — return to supplier or concession later" },
]

const PREVIEW_STYLE: Record<IncomingPreview["kind"], { className: string; icon: any }> = {
  blank: { className: "border-border bg-muted text-muted-foreground", icon: CircleSlash },
  release: { className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", icon: CheckCircle2 },
  fail: { className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", icon: OctagonX },
  incomplete: { className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", icon: TriangleAlert },
  hold: { className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", icon: Hand },
  reject: { className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", icon: OctagonX },
  held_by_hold: { className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", icon: Hand },
}

function errorText(error: any) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
  return error?.message || "Could not save"
}

function shortRange(rule: QcParameterRule) {
  const text = formatAllowedRange(rule).replace(/^Allowed: /, "")
  if (/^Recorded only|^Record reading/.test(text)) return "record"
  if (/^Note/.test(text)) return "note"
  if (/^Choose: /.test(text)) return text.replace(/^Choose: /, "")
  return text
}

function PreviewChip({ preview, saved }: { preview: IncomingPreview; saved?: Saved }) {
  if (saved && preview.kind === "blank") {
    return (
      <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", saved.ok ? (saved.released ? PREVIEW_STYLE.release.className : PREVIEW_STYLE.hold.className) : PREVIEW_STYLE.fail.className)}>
        {saved.ok ? <ClipboardCheck className="h-3 w-3 shrink-0" /> : <OctagonX className="h-3 w-3 shrink-0" />}
        <span className="truncate">{saved.text}</span>
      </span>
    )
  }
  const style = PREVIEW_STYLE[preview.kind]
  const Icon = style.icon
  return (
    <span title={preview.text} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", style.className)}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{preview.label}</span>
    </span>
  )
}

function DecisionSwitch({ value, onChange, compact, label, testId }: { value: IncomingDecision; onChange: (value: IncomingDecision) => void; compact?: boolean; label: string; testId?: string }) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className={cn("inline-flex rounded-lg border border-border bg-muted p-0.5", !compact && "max-sm:flex max-sm:w-full")}>
      {DECISIONS.map((item) => {
        const active = value === item.key
        return (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={item.title}
            onClick={() => onChange(item.key)}
            className={cn(
              "whitespace-nowrap rounded-md font-semibold transition-colors max-sm:h-11",
              compact ? "h-7 px-2 text-[11.5px]" : "h-8 px-3 text-[12.5px] max-sm:flex-1 max-sm:px-2 max-sm:text-[13px]",
              active
                ? item.key === "REJECT"
                  ? "bg-signal-rose-ink text-background shadow-sm"
                  : item.key === "HOLD"
                    ? "bg-signal-amber-ink text-background shadow-sm"
                    : "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Weighed per reel / coil, so never copied from another row. */
const perLot = (rule?: QcParameterRule) => /weight/i.test(String(rule?.code || "")) || /weight/i.test(String(rule?.label || ""))

function cellTone(verdict: ReturnType<typeof cellVerdict>) {
  if (verdict === "FAIL" || verdict === "INVALID") return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
  if (verdict === "PASS") return "border-signal-emerald-line bg-signal-emerald-soft/40"
  return "border-input bg-card"
}

/** Enter moves to the same check on the next row (or the next check in the one-lot layout). */
function moveOnEnter(event: KeyboardEvent<HTMLElement>, row: number, col: number) {
  if (event.key !== "Enter") return
  event.preventDefault()
  const root = (event.currentTarget as HTMLElement).closest("[data-qc-entry]")
  const next = root?.querySelector<HTMLElement>(`[data-cell="${row + 1}:${col}"]`) || root?.querySelector<HTMLElement>(`[data-cell="0:${col + 1}"]`)
  next?.focus()
}

function ReadingInput({ rule, value, onChange, cell, label, testId, wide, hint }: { rule: QcParameterRule; value: string; onChange: (value: string) => void; cell: [number, number]; label: string; testId?: string; wide?: boolean; hint?: string }) {
  const kind = qcInputKind(rule)
  const verdict = cellVerdict(rule, value)
  const common = {
    "aria-label": label,
    "data-testid": testId,
    "data-cell": `${cell[0]}:${cell[1]}`,
    "aria-invalid": verdict === "FAIL" || verdict === "INVALID" ? true : undefined,
  }
  if (kind === "select") {
    return (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)} className={cn("h-9 rounded-lg border px-2 text-[13px] max-sm:h-11 max-sm:text-base", wide ? "w-full" : "w-28", cellTone(verdict))}>
        <option value="">—</option>
        {(rule.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  return (
    <input
      {...common}
      type="text"
      inputMode={kind === "number" ? "decimal" : undefined}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => moveOnEnter(event, cell[0], cell[1])}
      placeholder={hint || (kind === "number" ? (rule.unit || "value") : "write…")}
      className={cn(
        "h-9 rounded-lg border px-2.5 text-[13px] outline-none transition-colors focus:ring-2 focus:ring-ring/30 max-sm:h-11 max-sm:text-base",
        kind === "number" ? "tabular-nums" : "",
        wide ? "w-full" : kind === "number" ? "w-[5.5rem]" : "w-36",
        cellTone(verdict),
      )}
    />
  )
}

/**
 * Incoming QC entry: every lot of one inward line in one sheet. Each lot gets its own readings
 * and decision and is saved as its own inspection, so one held reel never holds the others.
 */
export function IncomingInspectionEntry({
  lots,
  liveLots,
  rules,
  canInspect,
  onSaved,
}: {
  lots: any[]
  liveLots: Map<string, any>
  rules: QcParameterRule[]
  canInspect: boolean
  onSaved?: (summary: string, tone: "success" | "info" | "error") => void
}) {
  const save = useCreateInventoryQualityInspection()
  const checks = useMemo(() => applicableRules(rules), [rules])
  const [entries, setEntries] = useState<Record<string, IncomingEntry>>({})
  const [saved, setSaved] = useState<Record<string, Saved>>({})
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const entryOf = (lot: any) => entries[lotKey(lot)] || EMPTY_ENTRY
  const live = (lot: any) => liveLots.get(lotKey(lot))
  const openHolds = (lot: any) => (Array.isArray(live(lot)?.inspection_holds) ? live(lot).inspection_holds : [])
  const update = (lot: any, patch: Partial<IncomingEntry>) =>
    setEntries((current) => ({ ...current, [lotKey(lot)]: { ...(current[lotKey(lot)] || EMPTY_ENTRY), ...patch } }))
  const setReading = (lot: any, code: string, value: string) => update(lot, { readings: { ...entryOf(lot).readings, [code]: value } })

  const rows = lots.map((lot) => {
    const entry = entryOf(lot)
    const preview = previewIncomingLot(checks, entry, { openHolds: openHolds(lot).length })
    return { lot, entry, preview, inQueue: Boolean(live(lot)), missingReason: preview.willSave && preview.needsReason && entry.reason.trim().length < 3 }
  })
  const toSave = rows.filter((row) => row.preview.willSave && row.inQueue)
  const blocked = toSave.filter((row) => row.missingReason)
  const willRelease = toSave.filter((row) => row.preview.kind === "release").length
  const single = lots.length === 1

  function fillDown() {
    const source = rows.find((row) => Object.values(row.entry.readings).some((value) => String(value).trim() !== ""))
    if (!source) return
    setEntries((current) => {
      const next = { ...current }
      for (const { lot } of rows) {
        const own = next[lotKey(lot)] || EMPTY_ENTRY
        const merged = { ...own.readings }
        for (const [code, value] of Object.entries(source.entry.readings)) {
          if (!perLot(checks.find((rule) => rule.code === code)) && !String(merged[code] || "").trim()) merged[code] = value
        }
        next[lotKey(lot)] = { ...own, readings: merged }
      }
      return next
    })
  }

  async function saveAll() {
    setAttempted(true)
    if (!toSave.length || blocked.length) return
    setBusy(true)
    const outcome: Record<string, Saved> = {}
    let released = 0
    let held = 0
    let failed = 0
    for (const { lot, entry, preview } of toSave) {
      const holds = openHolds(lot)
      const closing = preview.kind === "release" && holds.length > 0 && entry.closeHolds
      try {
        const response = await save.mutateAsync({
          plantId: lot.plant_id || undefined,
          entity_type: lot.entity_type,
          entity_id: lot.entity_id,
          material_type: lot.material_type,
          source: lot.source || "INWARD",
          readings: incomingReadingsPayload(checks, entry.readings),
          reasons: incomingReasonsPayload(checks, entry),
          notes: entry.reason.trim() || undefined,
          disposition: entry.decision === "AUTO" ? undefined : entry.decision,
          resolve_hold_ids: closing ? holds.map((hold: any) => hold.id) : [],
        })
        const data = response?.data || {}
        const isReleased = data.stock_status === "UNRESTRICTED"
        if (isReleased) released += 1
        else held += 1
        outcome[lotKey(lot)] = {
          ok: true,
          released: isReleased,
          text: isReleased ? `${data.status || "PASS"} · released` : `${data.status || "Saved"} · held`,
          readings: entry.readings,
        }
      } catch (error) {
        failed += 1
        outcome[lotKey(lot)] = { ok: false, text: errorText(error) }
      }
    }
    setSaved((current) => ({ ...current, ...outcome }))
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !outcome[key]?.ok)))
    setAttempted(false)
    setBusy(false)
    const total = toSave.length - failed
    onSaved?.(
      `${total} lot${total === 1 ? "" : "s"} saved: ${released} released for issue, ${held} held${failed ? `, ${failed} not saved` : ""}.`,
      failed ? "error" : held ? "info" : "success",
    )
  }

  if (!checks.length) return null

  const footer = canInspect ? (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground" data-testid="qc-entry-summary">
          {toSave.length ? (
            <>
              <strong className="text-foreground">{toSave.length}</strong> to save ·{" "}
              <span className="font-semibold text-signal-emerald-ink">{willRelease} will be released</span> ·{" "}
              <span className="font-semibold text-signal-amber-ink">{toSave.length - willRelease} stay held</span>
              {attempted && blocked.length ? <span className="ml-1 font-semibold text-signal-rose-ink">· write a reason on {blocked.length} row{blocked.length === 1 ? "" : "s"}</span> : null}
            </>
          ) : (
            "Enter readings. Each lot is saved on its own; empty rows are skipped."
          )}
        </p>
        <button type="button" data-testid="qc-entry-save" disabled={busy || !toSave.length} onClick={() => void saveAll()} className="erp-btn-primary h-10 min-w-48 px-5 max-sm:h-11 max-sm:w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
          {busy ? "Saving…" : toSave.length ? `Save ${toSave.length} inspection${toSave.length === 1 ? "" : "s"}` : "Save inspection"}
        </button>
      </div>
    </div>
  ) : null

  if (single) {
    const { lot, entry, preview, inQueue, missingReason } = rows[0]
    const holds = openHolds(lot)
    const result = saved[lotKey(lot)]
    return (
      <div data-qc-entry className="space-y-4" data-testid="qc-entry">
        {result || !inQueue ? (
          <div
            data-testid="qc-entry-0-result"
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-semibold",
              !result || (result.ok && result.released) ? PREVIEW_STYLE.release.className : result.ok ? PREVIEW_STYLE.hold.className : PREVIEW_STYLE.fail.className,
            )}
          >
            {!result || result.ok ? <ClipboardCheck className="h-4 w-4" /> : <OctagonX className="h-4 w-4" />}
            {!result ? "Cleared — this lot is no longer waiting for QC." : result.ok ? (result.released ? `Saved: ${result.text}. It can be issued to the floor now.` : `Saved: ${result.text}. It stays out of issue.`) : `Not saved: ${result.text}`}
          </div>
        ) : null}
        {/* Desk: a table. Phone (below sm): each check is a card, label and allowed range on one line,
            a full-width 44 px reading under it, and the result only once something is typed. */}
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-[13px] max-sm:block">
            <thead className="bg-muted/70 text-left text-[11.5px] uppercase tracking-wide text-muted-foreground max-sm:hidden">
              <tr>
                <th className="px-3 py-2 font-semibold">Check</th>
                <th className="px-3 py-2 font-semibold">Allowed</th>
                <th className="w-48 px-3 py-2 font-semibold">Reading</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">Result</th>
              </tr>
            </thead>
            <tbody className="max-sm:block max-sm:divide-y max-sm:divide-border">
              {checks.map((rule, index) => {
                const value = entry.readings[rule.code] || (inQueue ? "" : result?.readings?.[rule.code] || "")
                const verdict = cellVerdict(rule, value)
                const range = shortRange(rule)
                return (
                  <tr key={rule.code} data-testid={`qc-entry-check-${rule.code}`} className="border-t border-border max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:gap-y-2 max-sm:border-t-0 max-sm:px-3.5 max-sm:py-3">
                    <td className="px-3 py-2 max-sm:min-w-0 max-sm:p-0">
                      <p className="font-semibold text-foreground">{rule.label}{rule.required !== false ? <span className="text-signal-rose-ink" aria-hidden="true"> *</span> : null}{rule.unit ? <span className="font-normal text-muted-foreground sm:hidden"> · {rule.unit}</span> : null}</p>
                      {rule.unit ? <p className="text-[11.5px] text-muted-foreground max-sm:hidden">{rule.unit}</p> : null}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] tabular-nums text-muted-foreground max-sm:p-0 max-sm:text-right">
                      {range === "record" ? <><span className="sm:hidden">No limit</span><span className="max-sm:hidden">Record the value (no limit)</span></> : range === "note" ? "Write a note" : <span className="font-semibold text-foreground/80">{range}</span>}
                    </td>
                    <td className="px-3 py-1.5 max-sm:col-span-2 max-sm:p-0">
                      {canInspect && inQueue ? (
                        <ReadingInput wide rule={rule} value={value} onChange={(next) => setReading(lot, rule.code, next)} cell={[index, 0]} label={`${rule.label} reading`} testId={`qc-entry-0-${rule.code}`} hint={perLot(rule) && lot.qty ? `inward ${Number(lot.qty).toLocaleString("en-IN")} ${rule.unit || ""}`.trim() : undefined} />
                      ) : (
                        <span className="font-semibold tabular-nums text-foreground/85">{result?.readings?.[rule.code] || "—"}</span>
                      )}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right text-[12px] font-semibold max-sm:col-span-2 max-sm:p-0 max-sm:text-left", !value && "max-sm:hidden")}>
                      {verdict === "PASS" ? <span className="text-signal-emerald-ink">In band</span> : verdict === "FAIL" ? <span className="text-signal-rose-ink">Out of band</span> : verdict === "INVALID" ? <span className="text-signal-rose-ink">Not valid</span> : value ? <span className="text-muted-foreground">Recorded</span> : <span className="text-muted-foreground/60">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {canInspect && inQueue ? (
          <div className="grid gap-4 rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Decision</p>
              <DecisionSwitch value={entry.decision} onChange={(decision) => update(lot, { decision })} label="Decision" testId="qc-entry-0-decision" />
              <div><PreviewChip preview={preview} saved={saved[lotKey(lot)]} /></div>
            </div>
            <div className="space-y-2">
              <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="qc-single-reason">
                {preview.needsReason ? "Reason (required)" : "Note (optional)"}
              </label>
              <textarea
                id="qc-single-reason"
                value={entry.reason}
                onChange={(event) => update(lot, { reason: event.target.value })}
                placeholder={preview.kind === "fail" ? `Why ${preview.failing.join(", ")} is out of band` : holds.length ? "Why the earlier hold can close" : "Anything the store or purchase should know"}
                className={cn("min-h-[72px] w-full rounded-lg border bg-card px-3 py-2 text-[13px]", attempted && missingReason ? "border-signal-rose-line ring-2 ring-signal-rose-line/40" : "border-input")}
              />
              {holds.length ? (
                <label className="flex items-start gap-2 text-[12.5px] max-sm:min-h-11 max-sm:items-center">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 max-sm:mt-0 max-sm:h-5 max-sm:w-5" checked={entry.closeHolds} onChange={(event) => update(lot, { closeHolds: event.target.checked })} />
                  <span>Close the earlier hold{holds.length > 1 ? "s" : ""} if this re-check passes: <span className="text-muted-foreground">{holds.map((hold: any) => hold.reason).join(" · ")}</span></span>
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
        {footer}
      </div>
    )
  }

  return (
    <div data-qc-entry className="space-y-3" data-testid="qc-entry">
      {canInspect ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">One row per reel / coil / batch. Cells turn green in band and red out of band as you type; press Enter to go down.</p>
          <button type="button" onClick={fillDown} className="erp-btn-secondary h-8 text-[12px] max-sm:h-11" data-testid="qc-entry-fill-down">
            <Copy className="h-3.5 w-3.5" />
            Copy first row into empty cells (not weights)
          </button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="bg-muted/70 text-left text-[11.5px] text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-40 bg-muted px-3 py-2 font-semibold uppercase tracking-wide">Lot · outcome</th>
              {checks.map((rule) => (
                <th key={rule.code} className="px-1.5 py-2 align-bottom font-semibold" title={formatAllowedRange(rule)}>
                  <span className="block whitespace-nowrap text-foreground/85">{rule.label}{rule.required !== false ? <span className="text-signal-rose-ink" aria-hidden="true">*</span> : null}</span>
                  <span className="block whitespace-nowrap font-normal tabular-nums">{shortRange(rule)}</span>
                </th>
              ))}
              {canInspect ? <th className="px-2 py-2 font-semibold uppercase tracking-wide">Decision · reason</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lot, entry, preview, inQueue, missingReason }, index) => {
              const holds = openHolds(lot)
              return (
                <tr key={lotKey(lot)} className={cn("border-t border-border align-top", !inQueue && "bg-signal-emerald-soft/30")} data-testid={`qc-entry-row-${index}`}>
                  <td className="sticky left-0 z-10 min-w-40 bg-card px-3 py-2 shadow-[1px_0_0_hsl(var(--border))]">
                    <p className="font-semibold text-foreground">{lotName(lot)}</p>
                    <p className="text-[11.5px] text-muted-foreground">{lot.unit_ref ? `${lot.unit_ref} · ` : ""}{Number(lot.qty || 0).toLocaleString("en-IN")} {lot.uom || "KG"}</p>
                    {lot.last_inspection ? <p className="text-[11px] text-signal-amber-ink">Last: {lot.last_inspection.status}{lot.last_inspection.failures?.length ? ` · ${lot.last_inspection.failures.join(", ")}` : ""}</p> : null}
                    <div className="mt-1 max-w-[150px]" data-testid={`qc-entry-${index}-result`}>
                      {inQueue ? <PreviewChip preview={preview} saved={saved[lotKey(lot)]} /> : <PreviewChip preview={{ ...preview, kind: "blank" }} saved={saved[lotKey(lot)] || { ok: true, released: true, text: "Cleared" }} />}
                    </div>
                  </td>
                  {checks.map((rule, col) => (
                    <td key={rule.code} className="px-1 py-1.5">
                      {canInspect && inQueue ? (
                        <ReadingInput rule={rule} value={entry.readings[rule.code] || ""} onChange={(next) => setReading(lot, rule.code, next)} cell={[index, col]} label={`${lotName(lot)} ${rule.label}`} testId={`qc-entry-${index}-${rule.code}`} hint={perLot(rule) && lot.qty ? `inward ${Number(lot.qty).toLocaleString("en-IN")}` : undefined} />
                      ) : (
                        <span className="px-2 font-semibold tabular-nums text-foreground/80">{saved[lotKey(lot)]?.readings?.[rule.code] || "—"}</span>
                      )}
                    </td>
                  ))}
                  {canInspect ? (
                    <td className="px-2 py-1.5">
                      {inQueue ? (
                        <div className="flex min-w-[230px] flex-col gap-1.5">
                          <DecisionSwitch compact value={entry.decision} onChange={(decision) => update(lot, { decision })} label={`${lotName(lot)} decision`} testId={`qc-entry-${index}-decision`} />
                          <input
                            aria-label={`${lotName(lot)} reason`}
                            value={entry.reason}
                            onChange={(event) => update(lot, { reason: event.target.value })}
                            placeholder={preview.needsReason ? "Reason (required)" : "Note (optional)"}
                            className={cn("h-8 w-full rounded-lg border bg-card px-2 text-[12.5px] max-sm:h-11", attempted && missingReason ? "border-signal-rose-line ring-2 ring-signal-rose-line/40" : "border-input")}
                          />
                          {holds.length ? (
                            <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground" title={holds.map((hold: any) => hold.reason).join(" · ")}>
                              <input type="checkbox" checked={entry.closeHolds} onChange={(event) => update(lot, { closeHolds: event.target.checked })} />
                              Close earlier hold if it passes
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  )
}
