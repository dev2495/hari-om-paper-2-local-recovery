"use client"

import { CheckCheck, ChevronDown, ClipboardCheck, Loader2, OctagonX, Pencil, ScanLine, Scale, TriangleAlert } from "lucide-react"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"

import { QrScanner } from "@/components/common/qr-scanner"
import { DocumentDrawer } from "@/components/documents/DocumentDrawer"
import { DocumentThumb } from "@/components/documents/DocumentsPanel"
import { ReasonPicker, filterReasons, reasonNeedsNote, useReasonChoice, useReasonList } from "@/components/reasons"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useEntityDocuments } from "@/hooks/use-documents"
import { useReweighIncomingLot, useSaveIncomingBillEntries } from "@/hooks/use-inventory"
import { inventoryApi } from "@/lib/api"
import {
  EMPTY_BILL_ROW,
  acceptAllWeighed,
  billRowPayload,
  billRules,
  billTiles,
  cellVerdict,
  findLotByCode,
  lotRules,
  planRow,
  rowDiff,
  typoWarning,
  parseQty,
  type BillDecision,
  type BillLot,
  type BillRowEntry,
} from "@/lib/incoming-qc"
import { formatAllowedRange, qcInputKind, type QcParameterRule } from "@/lib/qc-measurement"
import { parseScanCode } from "@/lib/scan-code"
import { errorText, qtyText, signedQty, unitWord } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

type RowResult = { ok: boolean; message: string }

const DECISIONS: Array<{ key: BillDecision; label: string; title: string }> = [
  { key: "ACCEPT", label: "Accept", title: "Released for issue when every reading entered is in band. Needs the actual weight." },
  { key: "HOLD", label: "Hold", title: "Keep out of issue for review. No weight needed." },
  { key: "REJECT", label: "Reject", title: "Reject: return to the supplier or concession later. No weight needed." },
]

const STATUS_TONE: Record<string, string> = {
  Issuable: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  Concession: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  Held: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
  Rejected: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
  "Returned to supplier": "border-border bg-muted text-muted-foreground",
  Waiting: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
}

function shortRange(rule: QcParameterRule) {
  const text = formatAllowedRange(rule).replace(/^Allowed: /, "")
  if (/^Recorded only|^Record reading/.test(text)) return "record"
  if (/^Note/.test(text)) return "note"
  if (/^Choose: /.test(text)) return text.replace(/^Choose: /, "")
  return text
}

function cellTone(verdict: ReturnType<typeof cellVerdict>) {
  if (verdict === "FAIL" || verdict === "INVALID") return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
  if (verdict === "PASS") return "border-signal-emerald-line bg-signal-emerald-soft/40"
  return "border-input bg-card"
}

/** Enter moves down the same column (the Actual column when weighing). */
function moveOnEnter(event: KeyboardEvent<HTMLElement>, column: string, index: number) {
  if (event.key !== "Enter") return
  event.preventDefault()
  const root = (event.currentTarget as HTMLElement).closest("[data-bill-sheet]")
  const visible = (selector: string) => Array.from(root?.querySelectorAll<HTMLElement>(selector) || []).find((element) => element.offsetParent !== null)
  ;(visible(`[data-col="${column}"][data-row="${index + 1}"]`) || visible('[data-testid="bill-save"]'))?.focus()
}

function DecisionSwitch({ value, onChange, label, big, disabled }: { value: BillDecision; onChange: (value: BillDecision) => void; label: string; big?: boolean; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg border border-border bg-muted p-0.5", big && "flex w-full")}>
      {DECISIONS.map((item) => {
        const active = value === item.key
        return (
          <button key={item.key} type="button" role="radio" aria-checked={active} title={item.title} disabled={disabled} onClick={() => onChange(item.key)}
            className={cn("whitespace-nowrap rounded-md font-semibold transition-colors disabled:opacity-50",
              big ? "h-11 flex-1 text-[14px]" : "h-7 px-2.5 text-[12px] max-sm:h-11",
              active ? item.key === "REJECT" ? "bg-signal-rose-ink text-background shadow-sm" : item.key === "HOLD" ? "bg-signal-amber-ink text-background shadow-sm" : "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground")}>
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function ReadingInput({ rule, value, onChange, label, row }: { rule: QcParameterRule; value: string; onChange: (value: string) => void; label: string; row: number }) {
  const kind = qcInputKind(rule)
  const verdict = cellVerdict(rule, value)
  const common = { "aria-label": label, "data-col": `check:${rule.code}`, "data-row": row, "aria-invalid": verdict === "FAIL" || verdict === "INVALID" ? true : undefined }
  if (kind === "select") {
    return (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)} className={cn("h-9 w-28 rounded-lg border px-2 text-[13px] max-sm:h-11 max-sm:w-full max-sm:text-base", cellTone(verdict))}>
        <option value="">—</option>
        {(rule.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  return (
    <input {...common} type="text" inputMode={kind === "number" ? "decimal" : undefined} autoComplete="off" value={value}
      onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => moveOnEnter(event, `check:${rule.code}`, row)}
      placeholder={kind === "number" ? rule.unit || "value" : "note"}
      className={cn("h-9 rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-ring/30 max-sm:h-11 max-sm:w-full max-sm:text-base", kind === "number" ? "w-[5.5rem]" : "w-32", cellTone(verdict))} />
  )
}

function StatusPill({ lot, result }: { lot: any; result?: RowResult }) {
  if (result && !result.ok) {
    return <span className="inline-flex max-w-[220px] items-start gap-1 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-2 py-1 text-[11.5px] font-semibold leading-4 text-signal-rose-ink" data-testid={`bill-row-error-${lot.code}`}><OctagonX className="mt-px h-3 w-3 shrink-0" />{result.message}</span>
  }
  const word = lot.status_word || "Waiting"
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", STATUS_TONE[word] || STATUS_TONE.Waiting)}>{word}</span>
}

function idemKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `bill-${crypto.randomUUID()}` : `bill-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Incoming QC of one bill (6 Nov 2026): every reel / lot of the bill or challan in one sheet with its bill qty,
 * the actual qty QC weighs, the difference, optional checks and a decision. Rows changed since the last save
 * are saved together; each row has its own key and its own result, so one bad row never blocks the others.
 */
export function IncomingInspectionEntry({ bill, canInspect, onSaved, onOpenBill, focusKey }: {
  bill: any
  canInspect: boolean
  onSaved?: (summary: string, tone: "success" | "info" | "error") => void
  onOpenBill?: (key: string) => void
  focusKey?: string | null
}) {
  const lots: BillLot[] = useMemo(() => (Array.isArray(bill?.lots) ? bill.lots : []), [bill?.lots])
  const plantId = bill?.plant_id || undefined
  const rules = useMemo(() => billRules(lots), [lots])
  const save = useSaveIncomingBillEntries()
  const reasonRows = filterReasons(useReasonList("INCOMING_QC", plantId, canInspect).data, "")
  const [entries, setEntries] = useState<Record<string, BillRowEntry>>({})
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [showChecks, setShowChecks] = useState(false)
  const [scan, setScan] = useState("")
  const [scanNote, setScanNote] = useState<{ text: string; open?: string } | null>(null)
  const [reweighing, setReweighing] = useState<any | null>(null)
  const keys = useRef<Record<string, { print: string; key: string }>>({})

  useEffect(() => { setEntries({}); setResults({}); keys.current = {} }, [bill?.key])

  const entryOf = (lot: BillLot) => entries[lot.key] || EMPTY_BILL_ROW
  const update = (lot: BillLot, patch: Partial<BillRowEntry>) => setEntries((current) => ({ ...current, [lot.key]: { ...(current[lot.key] || EMPTY_BILL_ROW), ...patch } }))
  const plans = lots.map((lot) => ({ lot, entry: entryOf(lot), plan: planRow(lot, entryOf(lot)) }))
  const dirty = plans.filter((row) => row.plan.dirty)
  const blocked = dirty.filter((row) => row.plan.problem)
  const anyWeighable = lots.some((lot) => lot.can_weigh)
  const uom = lots[0]?.uom || "KG"

  function focusRow(lot: BillLot) {
    const index = lots.findIndex((item) => item.key === lot.key)
    // The desk table and the phone cards both carry the Actual cell; use the one on screen.
    const cell = Array.from(document.querySelectorAll<HTMLElement>(`[data-bill-sheet] [data-col="actual"][data-row="${index}"]`)).find((element) => element.offsetParent !== null)
    if (cell) {
      cell.scrollIntoView({ block: "center", behavior: "smooth" })
      cell.focus({ preventScroll: true })
      return
    }
    Array.from(document.querySelectorAll<HTMLElement>(`[data-lot-row="${lot.key}"], [data-lot-card="${lot.key}"]`)).find((element) => element.offsetParent !== null)
      ?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  useEffect(() => {
    if (!focusKey) return
    const lot = lots.find((item) => item.key.toLowerCase() === focusKey.toLowerCase())
    if (!lot) return
    const timer = window.setTimeout(() => focusRow(lot), 80)
    return () => window.clearTimeout(timer)
  }, [focusKey, bill?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function findScanned(raw: string) {
    const value = raw.trim()
    if (!value) return
    const parsed = parseScanCode(value)
    const code = parsed.kind === "REEL" || parsed.kind === "BATCH" ? parsed.code : value
    const lot = findLotByCode(lots, code, parsed.kind === "REEL" || parsed.kind === "BATCH" ? parsed.id : undefined)
    if (lot) {
      setScanNote(null)
      setScan("")
      focusRow(lot)
      return
    }
    try {
      const { data } = await inventoryApi.getIncomingBills(parsed.id && (parsed.kind === "REEL" || parsed.kind === "BATCH") ? { lot: `${parsed.kind}:${parsed.id}` } : { q: code })
      const other = (data?.items || []).find((item: any) => item.key !== bill?.key && (item.matched_lot || (item.lot_codes || []).some((row: any) => findLotByCode([row as any], code))))
      setScanNote(other ? { text: `${code} is on ${other.title}`, open: other.key } : { text: `${code} is not on this bill, and no other bill has it.` })
    } catch (error) {
      setScanNote({ text: errorText(error, "Could not look the code up. Try again.") })
    }
  }

  async function saveRows() {
    if (!dirty.length) return
    if (blocked.length) {
      setResults((current) => ({ ...current, ...Object.fromEntries(blocked.map(({ lot, plan }) => [lot.key, { ok: false, message: plan.problem || "Check this row" }])) }))
      onSaved?.(`${blocked.length} row${blocked.length === 1 ? "" : "s"} need${blocked.length === 1 ? "s" : ""} attention before saving.`, "error")
      return
    }
    const rows = dirty.map(({ lot, entry }) => {
      const print = JSON.stringify({ ...billRowPayload(lot, entry, ""), idempotency_key: "" })
      const saved = keys.current[lot.key]
      const key = saved && saved.print === print ? saved.key : idemKey()
      keys.current[lot.key] = { print, key }
      return billRowPayload(lot, entry, key)
    })
    try {
      const { data } = await save.mutateAsync({ key: bill.key, rows, plantId })
      const outcome: Record<string, RowResult> = {}
      for (const row of data?.rows || []) {
        const key = `${row.entity_type}:${row.entity_id}`
        outcome[key] = { ok: Boolean(row.ok), message: row.ok ? row.message || "Saved" : row.message || "Not saved" }
      }
      setResults(outcome)
      setEntries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !outcome[key]?.ok)))
      for (const key of Object.keys(outcome)) if (outcome[key].ok) delete keys.current[key]
      const ok = Number(data?.saved || 0)
      const failed = Number(data?.failed || 0)
      const check = data?.bill?.weight_check
      const tail = check?.status === "AWAITING_OWNER" ? " Weight short: the Owner decides." : check?.status === "DN_DRAFTED" ? " Weight short: debit note drafted." : check?.status === "WAITING_INVOICE" ? " Weight short: the debit note drafts when the invoice comes." : ""
      onSaved?.(`${ok} row${ok === 1 ? "" : "s"} saved${failed ? `, ${failed} not saved (see the red rows)` : ""}.${tail}`, failed ? "error" : "success")
    } catch (error) {
      onSaved?.(errorText(error, "The rows could not be saved. Nothing was changed; try again."), "error")
    }
  }

  const reasonSelect = (lot: BillLot, entry: BillRowEntry, big?: boolean) => (
    <div className={cn("flex flex-col gap-1.5", big ? "w-full" : "min-w-[210px]")}>
      <select aria-label={`${lot.code} reason`} value={entry.reasonCode} onChange={(event) => update(lot, { reasonCode: event.target.value })}
        className={cn("w-full rounded-lg border bg-card px-2 text-[12.5px]", big ? "h-11 text-base" : "h-8 max-sm:h-11", !entry.reasonCode ? "border-signal-amber-line" : "border-input")}>
        <option value="">Choose why (required)</option>
        {reasonRows.map((row) => <option key={row.code} value={row.code}>{row.label || row.code}</option>)}
      </select>
      {reasonNeedsNote(entry.reasonCode) || entry.reasonNote ? (
        <input aria-label={`${lot.code} reason note`} value={entry.reasonNote} onChange={(event) => update(lot, { reasonNote: event.target.value })} placeholder="Note (needed for Other)"
          className={cn("w-full rounded-lg border border-input bg-card px-2 text-[12.5px]", big ? "h-11 text-base" : "h-8 max-sm:h-11")} />
      ) : null}
    </div>
  )

  const typoConfirm = (lot: BillLot, entry: BillRowEntry, typo: string | null) => typo ? (
    <label className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-signal-amber-ink">
      <input type="checkbox" className="h-4 w-4" checked={entry.confirmFar} onChange={(event) => update(lot, { confirmFar: event.target.checked })} />
      {typo}: it is right
    </label>
  ) : null

  const tiles = billTiles(lots, entries)
  const lineRates = Array.from(new Set(((bill?.weight_check?.lines || []) as any[]).map((line) => line.rate).filter(Boolean)))
  const rate = lineRates.length === 1 ? Number(lineRates[0]) : null
  const tileUnit = tiles.uom === "MIXED" ? "" : unitWord(tiles.uom)
  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 })

  return (
    <div data-bill-sheet className="space-y-3" data-testid="qc-entry">
      {((bill as any)?.receipt_ids || []).slice(0, 4).map((receiptId: string, index: number) => (
        <BillPhotos key={receiptId} receiptId={receiptId} grnNo={((bill as any)?.grn_nos || [])[index]} />
      ))}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="bill-tiles">
        {[
          { label: "Bill weight", value: `${fmt(tiles.bill)} ${tileUnit}`, hint: `${tiles.counted} lot${tiles.counted === 1 ? "" : "s"}${lots.length > tiles.counted ? ` · ${lots.length - tiles.counted} rejected, left out` : ""}`, tone: "" },
          { label: `Weighed so far (${tiles.weighedCount})`, value: `${fmt(tiles.weighedActual)} ${tileUnit}`, hint: `of ${fmt(tiles.weighedBill)} ${tileUnit} billed on them`, tone: "" },
          { label: "Difference", value: tiles.weighedCount ? `${signedQty(tiles.diff, tiles.uom === "MIXED" ? "" : tiles.uom)}` : "—",
            hint: tiles.weighedCount ? `${tiles.weighedCount < tiles.counted ? "So far · " : ""}${tiles.diff < 0 && rate ? `₹${Math.round(-tiles.diff * rate).toLocaleString("en-IN")} at ₹${rate.toLocaleString("en-IN")}/${tileUnit}` : tiles.diff < 0 ? "short" : tiles.diff > 0 ? "over the bill" : "matches the bill"}` : "Weigh to see it",
            tone: tiles.weighedCount && tiles.diff < 0 ? "text-signal-rose-ink" : "" },
          { label: "Ready for issue", value: `${tiles.ready}`, hint: `of ${lots.length} lot${lots.length === 1 ? "" : "s"} · accepted, issuable`, tone: tiles.ready ? "text-signal-emerald-ink" : "" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3.5 py-2.5">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{tile.label}</p>
            <p className={cn("mt-0.5 text-[19px] font-semibold tabular-nums leading-7 text-foreground", tile.tone)}>{tile.value}</p>
            <p className="text-[11.5px] text-muted-foreground">{tile.hint}</p>
          </div>
        ))}
      </div>
      {canInspect ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="bill-toolbar">
          <label className="relative min-w-[220px] flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={scan} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findScanned(scan) } }}
              placeholder="Scan the AIT label or type the reel / lot no." aria-label="Scan a reel or lot" data-testid="bill-scan"
              className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-base sm:h-9 sm:text-[13px]" />
          </label>
          <QrScanner onScan={(value) => { setScan(value); void findScanned(value) }} label="Camera" title="Scan a reel or lot label" className="erp-btn-secondary !h-11 sm:!h-9" />
          <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => setEntries((current) => acceptAllWeighed(lots, current))} data-testid="bill-accept-all"
            title="Accept every weighed row that has no out-of-band reading">
            <CheckCheck className="h-4 w-4" /> Accept all weighed
          </button>
          {rules.length ? (
            <button type="button" className="erp-btn-secondary !h-11 max-sm:hidden sm:!h-9" aria-expanded={showChecks} onClick={() => setShowChecks((value) => !value)} data-testid="bill-more-checks">
              More checks ({rules.length}) <ChevronDown className={cn("h-4 w-4 transition-transform", showChecks && "rotate-180")} />
            </button>
          ) : null}
        </div>
      ) : null}
      {scanNote ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] font-semibold text-signal-amber-ink" data-testid="bill-scan-note">
          <span>{scanNote.text}</span>
          {scanNote.open && onOpenBill ? <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" onClick={() => { onOpenBill(scanNote.open!); setScanNote(null); setScan("") }}>Open it</button> : null}
        </div>
      ) : null}

      {/* Desk: one row per reel / lot. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="bg-muted/70 text-left text-[11.5px] text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-semibold">AIT / lot</th>
              <th className="px-2 py-2 font-semibold">Vendor reel</th>
              <th className="px-2 py-2 font-semibold">Item</th>
              <th className="px-2 py-2 text-right font-semibold">Bill {unitWord(uom)}</th>
              <th className="px-2 py-2 font-semibold">Actual {unitWord(uom)}<span className="text-signal-rose-ink" aria-hidden="true"> *</span></th>
              <th className="px-2 py-2 text-right font-semibold">Diff</th>
              {showChecks ? rules.map((rule) => (
                <th key={rule.code} className="px-1.5 py-2 align-bottom font-semibold" title={formatAllowedRange(rule)}>
                  <span className="block whitespace-nowrap text-foreground/85">{rule.label}</span>
                  <span className="block whitespace-nowrap font-normal tabular-nums">{shortRange(rule)}</span>
                </th>
              )) : null}
              <th className="px-2 py-2 font-semibold">Decision</th>
              <th className="px-2 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map(({ lot, entry, plan }, index) => {
              const diff = rowDiff(lot, entry)
              const own = new Set(lotRules(lot).map((rule) => rule.code))
              const typed = parseQty(entry.actual)
              const editable = canInspect && lot.can_enter !== false
              return (
                <tr key={lot.key} data-lot-row={lot.key} data-testid={`bill-row-${index}`} className={cn("border-t border-border align-top", results[lot.key]?.ok === false && "bg-signal-rose-soft/30")}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 shadow-[1px_0_0_hsl(var(--border))]">
                    <p className="whitespace-nowrap font-semibold text-foreground">{lot.code}</p>
                    {lot.last_inspection?.failures?.length ? <p className="text-[11px] text-signal-amber-ink">{lot.last_inspection.failures.join(", ")}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{lot.vendor_ref || "—"}</td>
                  <td className="min-w-[150px] max-w-[220px] px-2 py-2"><span className="block text-[12.5px] leading-5">{lot.item_name || "—"}</span>{lot.nominal?.width_mm ? <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{lot.nominal.width_mm} mm wide</span> : null}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{lot.bill_qty != null ? Number(lot.bill_qty).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-2 py-1.5">
                    {lot.actual_qty != null ? (
                      <div className="flex items-center gap-1">
                        <span className="font-semibold tabular-nums" data-testid={`bill-actual-${index}`}>{Number(lot.actual_qty).toLocaleString("en-IN")}</span>
                        {canInspect && !lot.reweigh_blocked ? <button type="button" title="Re-weigh (fix a typo)" aria-label={`Re-weigh ${lot.code}`} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setReweighing(lot)}><Pencil className="h-3.5 w-3.5" /></button> : null}
                      </div>
                    ) : editable && lot.can_weigh ? (
                      <div>
                        <input data-col="actual" data-row={index} aria-label={`${lot.code} actual weight`} type="text" inputMode="decimal" autoComplete="off" value={entry.actual}
                          onChange={(event) => update(lot, { actual: event.target.value, confirmFar: false })} onKeyDown={(event) => moveOnEnter(event, "actual", index)}
                          placeholder="weigh" className={cn("h-9 w-24 rounded-lg border px-2.5 text-[13px] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring/30", plan.typo ? "border-signal-amber-line bg-signal-amber-soft/50" : "border-input bg-card")} />
                        {typoConfirm(lot, entry, typed != null ? plan.typo : null)}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn("px-2 py-2 text-right font-semibold tabular-nums", diff == null ? "text-muted-foreground" : diff < 0 ? "text-signal-rose-ink" : "text-muted-foreground")}>{diff == null ? "—" : signedQty(diff, lot.uom).replace(` ${unitWord(lot.uom)}`, "")}</td>
                  {showChecks ? rules.map((rule) => (
                    <td key={rule.code} className="px-1 py-1.5">
                      {own.has(rule.code) && editable ? <ReadingInput rule={rule} row={index} value={entry.readings[rule.code] || ""} onChange={(value) => update(lot, { readings: { ...entry.readings, [rule.code]: value } })} label={`${lot.code} ${rule.label}`} />
                        : <span className="px-2 text-muted-foreground">{lot.last_inspection?.readings?.[rule.code] ?? "—"}</span>}
                    </td>
                  )) : null}
                  <td className="px-2 py-1.5">
                    {editable ? (
                      <div className="flex flex-col gap-1.5">
                        <DecisionSwitch value={entry.decision || "ACCEPT"} onChange={(decision) => update(lot, { decision })} label={`${lot.code} decision`} />
                        {plan.dirty && plan.needsReason ? reasonSelect(lot, entry) : null}
                        {(lot.inspection_holds || []).length && (entry.decision || "ACCEPT") === "ACCEPT" ? (
                          <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground" title={(lot.inspection_holds || []).map((hold) => hold.reason).join(" · ")}>
                            <input type="checkbox" checked={entry.closeHolds} onChange={(event) => update(lot, { closeHolds: event.target.checked })} /> Close the earlier hold if it passes
                          </label>
                        ) : null}
                      </div>
                    ) : <span className="text-[12px] text-muted-foreground">{lot.last_inspection ? `${lot.last_inspection.status}${lot.last_inspection.disposition ? ` · ${lot.last_inspection.disposition}` : ""}` : "—"}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill lot={lot} result={results[lot.key]} />
                    {plan.dirty && plan.problem && !results[lot.key] ? <p className="mt-1 max-w-[200px] text-[11px] font-semibold text-signal-amber-ink">{plan.problem}</p> : null}
                    {results[lot.key]?.ok ? <p className="mt-1 text-[11px] font-semibold text-signal-emerald-ink">{results[lot.key].message}</p> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Phone (QC walks the bay): one card per reel with a big weight input and Next reel. */}
      <div className="space-y-3 sm:hidden" data-testid="bill-cards">
        {plans.map(({ lot, entry, plan }, index) => {
          const diff = rowDiff(lot, entry)
          const editable = canInspect && lot.can_enter !== false
          const typed = parseQty(entry.actual)
          return (
            <article key={lot.key} data-lot-card={lot.key} className={cn("rounded-xl border bg-card p-3.5", results[lot.key]?.ok === false ? "border-signal-rose-line" : "border-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-foreground">{lot.code}</p>
                  <p className="text-[12.5px] text-muted-foreground">{lot.vendor_ref ? `Vendor ${lot.vendor_ref} · ` : ""}{lot.item_name}</p>
                </div>
                <StatusPill lot={lot} result={results[lot.key]} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bill</p>
                  <p className="text-[17px] font-semibold tabular-nums">{lot.bill_qty != null ? qtyText(lot.bill_qty, lot.uom) : "—"}</p>
                </div>
                <div className={cn("rounded-lg px-3 py-2", diff != null && diff < 0 ? "bg-signal-rose-soft" : "bg-[hsl(var(--surface-2))]")}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Difference</p>
                  <p className={cn("text-[17px] font-semibold tabular-nums", diff != null && diff < 0 ? "text-signal-rose-ink" : "")}>{diff == null ? "—" : signedQty(diff, lot.uom)}</p>
                </div>
              </div>
              {lot.actual_qty != null ? (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="text-[13px]">Weighed <strong className="tabular-nums">{qtyText(lot.actual_qty, lot.uom)}</strong></span>
                  {canInspect && !lot.reweigh_blocked ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setReweighing(lot)}><Pencil className="h-4 w-4" /> Re-weigh</button> : null}
                </div>
              ) : editable && lot.can_weigh ? (
                <label className="mt-3 block">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Actual {unitWord(lot.uom)} <span className="text-signal-rose-ink">*</span></span>
                  <input data-col="actual" data-row={index} aria-label={`${lot.code} actual weight`} type="text" inputMode="decimal" autoComplete="off" value={entry.actual}
                    onChange={(event) => update(lot, { actual: event.target.value, confirmFar: false })} onKeyDown={(event) => moveOnEnter(event, "actual", index)} placeholder="Weigh and type"
                    className={cn("mt-1 h-14 w-full rounded-xl border px-4 text-[22px] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring/30", plan.typo ? "border-signal-amber-line bg-signal-amber-soft/50" : "border-input bg-card")} />
                  {typoConfirm(lot, entry, typed != null ? plan.typo : null)}
                </label>
              ) : null}
              {editable ? (
                <div className="mt-3 space-y-2">
                  <DecisionSwitch big value={entry.decision || "ACCEPT"} onChange={(decision) => update(lot, { decision })} label={`${lot.code} decision`} />
                  {plan.dirty && plan.needsReason ? reasonSelect(lot, entry, true) : null}
                  {lotRules(lot).length ? (
                    <details className="rounded-lg border border-border px-3 py-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">More checks (optional)</summary>
                      <div className="mt-2 space-y-2">
                        {lotRules(lot).map((rule) => (
                          <label key={rule.code} className="block text-[12.5px] font-semibold">{rule.label} <span className="font-normal text-muted-foreground">{shortRange(rule) === "record" ? "" : shortRange(rule)}</span>
                            <div className="mt-1"><ReadingInput rule={rule} row={index} value={entry.readings[rule.code] || ""} onChange={(value) => update(lot, { readings: { ...entry.readings, [rule.code]: value } })} label={`${lot.code} ${rule.label}`} /></div>
                          </label>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {plan.dirty && plan.problem && !results[lot.key] ? <p className="text-[12px] font-semibold text-signal-amber-ink">{plan.problem}</p> : null}
                  {index < lots.length - 1 ? <button type="button" className="erp-btn-secondary !h-11 w-full" onClick={() => focusRow(lots[index + 1])}>Next reel</button> : null}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>

      {canInspect ? (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground" data-testid="bill-save-summary">
              {dirty.length ? (
                <><strong className="text-foreground">{dirty.length}</strong> row{dirty.length === 1 ? "" : "s"} to save{blocked.length ? <span className="font-semibold text-signal-amber-ink"> · {blocked.length} need{blocked.length === 1 ? "s" : ""} attention</span> : null}</>
              ) : anyWeighable ? "Weigh each reel and type the actual weight. Enter goes to the next reel." : "Every lot of this bill is weighed. Use Re-weigh to fix a typo."}
            </p>
            <button type="button" data-testid="bill-save" disabled={save.isPending || !dirty.length} onClick={() => void saveRows()} className="erp-btn-primary h-10 min-w-52 px-5 max-sm:h-11 max-sm:w-full">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {save.isPending ? "Saving…" : `Save weighed rows (${dirty.length})`}
            </button>
          </div>
        </div>
      ) : null}

      <ReweighDialog lot={reweighing} plantId={plantId} onClose={() => setReweighing(null)} onDone={(text) => { setReweighing(null); onSaved?.(text, "success") }} />
    </div>
  )
}

function ReweighDialog({ lot, plantId, onClose, onDone }: { lot: any | null; plantId?: string; onClose: () => void; onDone: (text: string) => void }) {
  const reweigh = useReweighIncomingLot()
  const reason = useReasonChoice("WEIGH_CORRECTION", plantId, { enabled: Boolean(lot) })
  const [value, setValue] = useState("")
  const [confirmFar, setConfirmFar] = useState(false)
  const [error, setError] = useState("")
  const requestId = useRef("")
  useEffect(() => { setValue(""); setConfirmFar(false); setError(""); reason.reset(); requestId.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) }, [lot?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lot) return null
  const actual = parseQty(value)
  const typo = typoWarning(actual, lot.bill_qty, lot.uom)
  async function submit() {
    setError("")
    if (actual == null || actual <= 0) return setError("Type the corrected weight.")
    if (!reason.validate()) return setError("Choose why the weight is corrected.")
    if (typo && !confirmFar) return setError(`${typo}. Tick to confirm.`)
    try {
      await reweigh.mutateAsync({ entityType: lot.entity_type, entityId: lot.entity_id, plantId, data: {
        request_id: requestId.current, actual_qty: actual, expected_actual_qty: lot.actual_qty, confirm_far: confirmFar, ...reason.payload(null),
      } })
      onDone(`${lot.code} re-weighed: ${qtyText(actual, lot.uom)}. The weight check of the bill is updated.`)
    } catch (err) {
      setError(errorText(err, "The correction could not be saved."))
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2"><Scale className="h-4 w-4" /> Re-weigh {lot.code}</DialogTitle>
        <DialogDescription>Saved {qtyText(lot.actual_qty, lot.uom)} by {lot.weighed_by || "QC"} · bill {qtyText(lot.bill_qty, lot.uom)}. Stock stays on the bill weight.</DialogDescription>
        <div className="space-y-3 pt-2">
          <label className="block text-[12.5px] font-semibold">Corrected weight ({unitWord(lot.uom)})
            <input autoFocus type="text" inputMode="decimal" value={value} onChange={(event) => { setValue(event.target.value); setConfirmFar(false) }}
              className="mt-1 h-12 w-full rounded-lg border border-input bg-card px-3 text-[18px] font-semibold tabular-nums" data-testid="reweigh-value" />
          </label>
          {typo ? <label className="flex items-center gap-2 text-[12.5px] font-semibold text-signal-amber-ink"><input type="checkbox" className="h-4 w-4" checked={confirmFar} onChange={(event) => setConfirmFar(event.target.checked)} />{typo}: it is right</label> : null}
          <ReasonPicker category="WEIGH_CORRECTION" plantId={plantId} label="Why it is corrected" value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact testIdPrefix="reweigh-reason" />
          {error ? <p className="flex items-start gap-1.5 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] font-semibold text-signal-rose-ink"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={onClose}>Cancel</button>
            <button type="button" className="erp-btn-primary !h-11 sm:!h-9" disabled={reweigh.isPending} onClick={() => void submit()}>{reweigh.isPending ? "Saving…" : "Save correction"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


/** The bill / challan photos of this GRN (gate photo and inward uploads): QC reads the vendor reel list off
 * them. Tapping one opens the vault viewer beside the sheet. Hidden when there are none or the login may not
 * open them. */
function BillPhotos({ receiptId, grnNo }: { receiptId: string; grnNo?: string | null }) {
  const query = useEntityDocuments("GRN", receiptId)
  const [open, setOpen] = useState<string | null>(null)
  const documents = (query.data?.items || []).filter((document) => ["VENDOR_BILL", "VENDOR_CHALLAN", "OTHER"].includes(String(document.kind)))
  if (!documents.length) return null
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2" data-testid="bill-photos">
      <div className="min-w-0 shrink-0">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Bill photo{documents.length === 1 ? "" : "s"}</p>
        <p className="text-[12px] text-muted-foreground">{grnNo ? `GRN ${grnNo} · ` : ""}tap to read the reel list</p>
      </div>
      <div className="flex min-w-0 gap-2 overflow-x-auto">
        {documents.map((document) => (
          <button key={document.id} type="button" onClick={() => setOpen(document.id)} title={`${document.kind_label} ${document.doc_no}`} aria-label={`Open ${document.kind_label} ${document.doc_no}`}
            className="h-14 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-card" data-testid="bill-photo">
            <DocumentThumb document={document} className="object-top" />
          </button>
        ))}
      </div>
      <DocumentDrawer documentId={open} onClose={() => setOpen(null)} />
    </div>
  )
}
