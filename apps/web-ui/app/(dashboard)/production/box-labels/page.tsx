"use client"

// Box labels before packing (client 2026-11-21). Every open job card is listed with the boxes its release
// needs (released pcs ÷ the spec's qty per box, rounded up) plus 5 spare labels. Labels print in series
// 1..N, each with the plant heading, customer, size, colour, qty, the lot number (= the job card number),
// the box serial and a QR holding the box code packing will give that box. Every print is recorded before
// the browser prints (who, when, which serials); printing a serial again is a reprint and needs a reason
// from the Reason codes master. Printing never makes boxes or stock.
// Rights: Store, Planner and the plant supervisor by default, Owner and Admin always (server checks the same).

import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { History, Package, Printer, Search, Tag } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Suspense, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useSearchParams, useRouter, usePathname } from "next/navigation"

import { Chip, EmptyBlock, Notice, PickPlant, fieldClass } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { EMPTY_REASON, ReasonPicker, reasonProblem, type ReasonValue } from "@/components/reasons"
import { useAuth } from "@/context/AuthContext"
import { useSinglePlant } from "@/hooks/use-stock"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/api-stock"
import { resolveAppBaseUrl } from "@/lib/app-url"
import { boxesApi, type LabelPlan, type LabelPlanRow, type LabelQueueRow } from "@/lib/boxes"
import { personLabel } from "@/lib/people"
import { labelHeading } from "@/lib/reel-label"
import { cn } from "@/lib/utils"

const BOX_LABEL_ROLES = ["Owner", "Admin", "Store", "Planner", "PlantManager"]
const TAGLINE = "Mfg. of Paper Tubes And Cores (POY, FDY, IDY & DTY)"
const EMAIL = "sales.tube@amigoind.in"
type Size = "100x100" | "a4-6"
const SIZES: Array<{ value: Size; label: string }> = [
  { value: "100x100", label: "100 × 100 mm sticker (one per label)" },
  { value: "a4-6", label: "A4 sheet · 6 labels (2 × 3)" },
]

const fmt = (value: number | null | undefined) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const when = (value?: string | null) => {
  if (!value) return ""
  const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })
}
const ranges = (seqs: number[]) => {
  const parts: string[] = []
  let start: number | null = null
  let prev = 0
  for (const seq of [...seqs].sort((a, b) => a - b)) {
    if (start === null) { start = seq; prev = seq } else if (seq === prev + 1) prev = seq
    else { parts.push(start === prev ? String(start) : `${start}–${prev}`); start = seq; prev = seq }
  }
  if (start !== null) parts.push(start === prev ? String(start) : `${start}–${prev}`)
  return parts.join(", ")
}

/* Labels are paper: black on white in light and dark mode. Sizes are in cqw (1% of the label width), so the
 * preview and the printed sticker are the same drawing. Layout follows the plant's current sticker. */
const LABEL_CSS = `
.pl-label { container-type: inline-size; box-sizing: border-box; width: 100%; aspect-ratio: 1 / 1; display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: #000; border: 0.4mm solid #000; border-radius: 2mm; font-family: Arial, Helvetica, "Liberation Sans", sans-serif; line-height: 1.1;
  break-inside: avoid; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.pl-label * { box-sizing: border-box; }
/* Padding lives on the inner box: cqw there is measured on the label itself. */
.pl-in { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 2.6cqw 3cqw 2.4cqw; }
.pl-head { text-align: center; font-weight: 900; font-size: 6.4cqw; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-tag { text-align: center; font-weight: 700; font-size: 3.1cqw; margin-top: .6cqw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-mail { text-align: center; font-weight: 700; font-size: 3.1cqw; margin-top: .4cqw; }
.pl-top { display: grid; grid-template-columns: minmax(0, 1fr) 27cqw; align-items: end; gap: 2cqw; margin-top: 1.2cqw; }
.pl-serial { font-size: 3.2cqw; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.pl-serial b { display: block; font-size: 10cqw; font-weight: 900; letter-spacing: 0; line-height: 1; }
.pl-serial small { font-size: 3.6cqw; font-weight: 800; letter-spacing: 0; text-transform: none; }
.pl-qr svg { display: block; width: 100%; height: auto; }
.pl-table { margin-top: 1.6cqw; flex: 1 1 auto; min-height: 0; border: 0.45mm solid #000; border-radius: 2.4cqw; display: grid; grid-template-columns: 27cqw minmax(0, 1fr); grid-auto-rows: 1fr; overflow: hidden; }
.pl-table > div { display: flex; align-items: center; border-top: 0.3mm solid #000; padding: 0 2cqw; min-width: 0; }
.pl-table > div:nth-child(-n+2) { border-top: 0; }
.pl-table > div:nth-child(odd) { border-right: 0.3mm solid #000; justify-content: center; font-weight: 900; font-size: 4.6cqw; text-align: center; }
.pl-table > div:nth-child(even) { font-weight: 900; font-size: 5.4cqw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 1; padding-top: 0; align-content: center; }
.pl-table .pl-big { font-size: 9cqw !important; }
.pl-table .pl-blank { color: #fff; }
.pl-code { margin-top: 1cqw; display: flex; justify-content: space-between; gap: 2cqw; font-size: 3.4cqw; font-weight: 800; white-space: nowrap; }
.pl-code span:last-child { overflow: hidden; text-overflow: ellipsis; }
.pl-part { background: #000; color: #fff; padding: 0 1.4cqw; border-radius: 1cqw; }
.pl-print { display: none; }
@media print {
  body:has(.pl-print) > *:not(.pl-print) { display: none !important; }
  body:has(.pl-print) .pl-print { display: block; }
  .pl-print .pl-page { break-after: page; page-break-after: always; }
  .pl-print .pl-page:last-child { break-after: auto; page-break-after: auto; }
  .pl-print[data-size="100x100"] .pl-label { width: 96mm; height: 96mm; aspect-ratio: auto; }
  .pl-print[data-size="a4-6"] .pl-page { display: grid; grid-template-columns: repeat(2, 92mm); grid-auto-rows: 92mm; gap: 4mm 6mm; justify-content: center; align-content: start; }
  .pl-print[data-size="a4-6"] .pl-label { width: 100%; height: 100%; aspect-ratio: auto; }
}
`
const pageCss = (size: Size) => `@media print { @page { size: ${size === "100x100" ? "100mm 100mm" : "A4 portrait"}; margin: ${size === "100x100" ? "2mm" : "8mm"}; } }`

function PackLabel({ row, plan, heading, origin }: { row: LabelPlanRow; plan: LabelPlan; heading: string; origin: string }) {
  const url = `${origin}/production/boxes/${encodeURIComponent(row.box_code)}`
  return (
    <article className="pl-label" data-testid="pack-label" data-seq={row.seq}>
      <div className="pl-in">
      <div className="pl-head">{heading || "AMIGO INDUSTRIES"}</div>
      <div className="pl-tag">{TAGLINE}</div>
      <div className="pl-mail">Email :- {EMAIL}</div>
      <div className="pl-top">
        <div className="pl-serial">Box no.<b data-testid="pack-label-serial">{row.seq}</b><small>of {plan.planned_boxes}{row.kind === "SPARE" ? " · spare" : ""}</small></div>
        <div className="pl-qr"><QRCodeSVG value={url} size={180} level="M" bgColor="#ffffff" fgColor="#000000" /></div>
      </div>
      <div className="pl-table">
        <div>TO</div><div>{plan.customer || ""}</div>
        <div>SIZE</div><div>{plan.size_label || ""}</div>
        <div>COLOR</div><div>{plan.colour || ""}</div>
        <div>Qty.</div><div className={cn("pl-big", row.qty == null && "pl-blank")}>{row.qty == null ? "—" : fmt(row.qty)}</div>
        <div>LOT NO.</div><div className="pl-big" data-testid="pack-label-lot">{plan.lot_no || plan.job_card_no || ""}</div>
      </div>
      <div className="pl-code">
        <span>{row.box_code}</span>
        <span>{row.kind === "PART" ? <span className="pl-part">PART BOX</span> : plan.denier ? `Denier ${plan.denier}` : plan.sales_order_no || ""}</span>
      </div>
      </div>
    </article>
  )
}

export default function BoxLabelsBeforePackingPage() {
  return (
    <RoleGate allow={BOX_LABEL_ROLES}>
      <Suspense fallback={<LoadingState label="Loading open job cards…" />}>
        <BoxLabelsScreen />
      </Suspense>
    </RoleGate>
  )
}

function BoxLabelsScreen() {
  const search = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const single = useSinglePlant()
  const { activePlant } = useAuth()
  const plants = usePlants()
  const [filter, setFilter] = useState("")
  const [show, setShow] = useState<"todo" | "all">("todo")
  const selected = (search.get("card") || "").trim()

  const queue = useQuery({
    queryKey: ["box-labels", "queue", activePlant || "none"],
    enabled: single,
    queryFn: async () => ((await boxesApi.labelQueue()).data || []) as LabelQueueRow[],
  })
  const rows = useMemo(() => {
    const text = filter.trim().toLowerCase()
    return (queue.data || [])
      .filter((row) => show === "all" || row.missing_qty_per_box || row.printed_serials < row.labels_total)
      .filter((row) => !text || [row.job_card_no, row.customer, row.size_label, row.colour, row.sales_order_no].some((value) => String(value || "").toLowerCase().includes(text)))
  }, [queue.data, filter, show])
  const plant = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant) || String(row.code) === String(activePlant))
  const heading = labelHeading(plant)
  const pick = (id: string) => {
    const next = new URLSearchParams(search.toString())
    if (id) next.set("card", id)
    else next.delete("card")
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  if (!single) return <PickPlant what="box labels" />
  const total = queue.data?.length || 0
  const notPrinted = (queue.data || []).filter((row) => !row.missing_qty_per_box && row.printed_serials === 0).length
  return (
    <div className="min-w-0 space-y-4" data-testid="box-labels-queue">
      <PageHeader
        badge="Production"
        title="Box labels"
        description="Print every open job card's box stickers before packing: one per box the release needs plus 5 spare, numbered in series, lot number = job card number, with a QR for each box. Every print is recorded; printing a label again needs a reason."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section className="erp-panel min-w-0 rounded-xl p-4" aria-label="Open job cards">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Job card, customer, size, colour" aria-label="Find a job card" className={cn(fieldClass, "pl-9")} data-testid="box-labels-filter" />
            </label>
            <div role="radiogroup" aria-label="Which cards" className="flex gap-1 rounded-xl border border-border bg-card p-1">
              {([["todo", "To print"], ["all", "All open"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={show === value} onClick={() => setShow(value)} className={cn("min-h-9 rounded-lg px-3 text-[13px] font-medium", show === value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")} data-testid={`box-labels-show-${value}`}>{label}</button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{fmt(total)} open job card{total === 1 ? "" : "s"} · {fmt(notPrinted)} with no label printed yet</p>
          {queue.isLoading ? <LoadingState label="Loading open job cards…" /> : queue.isError ? (
            <ErrorState title="Open job cards could not be loaded" message={errorText(queue.error)} onRetry={() => void queue.refetch()} />
          ) : !rows.length ? (
            <EmptyBlock icon={Tag} title={total ? "Nothing left to print" : "No open job cards"} message={total ? "Every open card has all its labels printed. Choose All open to reprint." : "Released job cards appear here until they are completed."} testId="box-labels-queue-empty" />
          ) : (
            <ul className="mt-3 max-h-[calc(100dvh-16rem)] space-y-2 overflow-y-auto pr-1" data-testid="box-labels-list">
              {rows.map((row) => {
                const active = row.job_card_id === selected
                const done = !row.missing_qty_per_box && row.printed_serials >= row.labels_total
                return (
                  <li key={row.job_card_id}>
                    <button type="button" onClick={() => pick(row.job_card_id)} aria-pressed={active} data-testid={`box-labels-card-${row.job_card_no}`}
                      className={cn("flex w-full min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors sm:flex-row sm:items-center sm:gap-3", active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:bg-muted")}>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[14px] font-semibold text-foreground">{row.job_card_no}</span>
                          {row.missing_qty_per_box ? <Chip tone="rose">No qty per box on spec</Chip> : done ? <Chip tone="emerald">All printed</Chip> : row.printed_serials ? <Chip tone="amber">{row.printed_serials} of {row.labels_total} printed</Chip> : <Chip tone="blue">Not printed</Chip>}
                          {row.reprint_count ? <Chip tone="slate">{row.reprint_count} reprint{row.reprint_count === 1 ? "" : "s"}</Chip> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-foreground">{row.customer || "—"}</span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">{[row.size_label, row.colour, `${fmt(row.released_qty)} pcs`].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="shrink-0 text-[12.5px] text-muted-foreground sm:text-right">
                        {row.missing_qty_per_box ? "Box count unknown" : <><strong className="tabular-nums text-foreground">{row.planned_boxes}</strong> box{row.planned_boxes === 1 ? "" : "es"} × {fmt(row.qty_per_box)} + {row.spare_labels} spare</>}
                        {row.last_printed_at ? <span className="block">Last printed {when(row.last_printed_at)} · {personLabel(row.last_printed_by)}</span> : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        {selected ? <CardLabels key={selected} cardId={selected} heading={heading} onClose={() => pick("")} /> : (
          <section className="erp-panel rounded-xl p-4">
            <EmptyBlock icon={Package} title="Choose a job card" message="Its labels, the serials already printed and the print record show here." testId="box-labels-pick" />
          </section>
        )}
      </div>
    </div>
  )
}

function CardLabels({ cardId, heading, onClose }: { cardId: string; heading: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { activePlant } = useAuth()
  const [size, setSize] = useState<Size>("100x100")
  const [from, setFrom] = useState("1")
  const [to, setTo] = useState("")
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON)
  const [showReasonErrors, setShowReasonErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [printRows, setPrintRows] = useState<LabelPlanRow[]>([])
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const query = useQuery({
    queryKey: ["box-labels", "card", cardId],
    queryFn: async () => (await boxesApi.labelPlan(cardId)).data as LabelPlan,
  })
  const plan = query.data
  useEffect(() => {
    if (!plan) return
    // Start where printing stopped: the first serial never printed, through the last label.
    const firstOpen = plan.labels.find((row) => !row.printed)?.seq
    setFrom(String(firstOpen || 1))
    setTo(String(plan.labels_total || ""))
  }, [plan?.job_card_id, plan?.labels_total]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!printRows.length) return
    const done = () => setPrintRows([])
    window.addEventListener("afterprint", done)
    const timer = window.setTimeout(() => window.print(), 80)
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done) }
  }, [printRows])

  if (query.isLoading) return <section className="erp-panel rounded-xl p-4"><LoadingState label="Preparing labels…" /></section>
  if (query.isError || !plan) return <section className="erp-panel rounded-xl p-4"><ErrorState title="Labels could not be prepared" message={errorText(query.error)} onRetry={() => void query.refetch()} /></section>

  const origin = plan.public_origin || resolveAppBaseUrl()
  const fromN = Math.floor(Number(from))
  const toN = Math.floor(Number(to))
  const rangeOk = Number.isFinite(fromN) && Number.isFinite(toN) && fromN >= 1 && toN >= fromN && toN <= plan.labels_total
  const chosen = rangeOk ? plan.labels.filter((row) => row.seq >= fromN && row.seq <= toN) : []
  const again = chosen.filter((row) => row.printed > 0).map((row) => row.seq)
  const reasonError = again.length ? reasonProblem(reason) : null
  const preview = chosen.slice(0, 6)

  const print = async () => {
    setError("")
    if (!rangeOk) { setError(`Choose label numbers from 1 to ${plan.labels_total}.`); return }
    if (reasonError) { setShowReasonErrors(true); setError(reasonError); return }
    setSaving(true)
    try {
      const { data } = await boxesApi.recordLabelPrint(cardId, { from_seq: fromN, to_seq: toN, label_size: size, reason_code: again.length ? reason.code : null, reason_note: again.length ? reason.note || null : null })
      const fresh = data?.plan as LabelPlan | undefined
      if (fresh) queryClient.setQueryData(["box-labels", "card", cardId], fresh)
      void queryClient.invalidateQueries({ queryKey: ["box-labels", "queue"] })
      setReason(EMPTY_REASON)
      setShowReasonErrors(false)
      // Print exactly what was recorded.
      setPrintRows((fresh || plan).labels.filter((row) => row.seq >= fromN && row.seq <= toN))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }
  const pages: LabelPlanRow[][] = size === "a4-6"
    ? Array.from({ length: Math.ceil(printRows.length / 6) }, (_, index) => printRows.slice(index * 6, index * 6 + 6))
    : printRows.map((row) => [row])

  return (
    <section className="erp-panel min-w-0 space-y-4 self-start rounded-xl p-4 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto" aria-label={`Labels for ${plan.job_card_no}`} data-testid="box-labels-card">
      <style dangerouslySetInnerHTML={{ __html: LABEL_CSS + pageCss(size) }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-mono text-[16px] font-semibold text-foreground">{plan.job_card_no}</h2>
          <p className="truncate text-[13px] text-muted-foreground">{[plan.customer, plan.size_label, plan.colour].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/production/job-cards/${encodeURIComponent(cardId)}`} className="erp-btn-secondary !h-9">Open card</Link>
          <button type="button" className="erp-btn-secondary !h-9 xl:hidden" onClick={onClose}>Back to list</button>
        </div>
      </div>

      {plan.missing_qty_per_box ? (
        <Notice tone="rose" title="No qty per box on this spec" testId="box-labels-no-qpb">
          The box count comes from the spec&apos;s packing. Fill it in <Link className="font-semibold underline" href="/specifications/packing-setup">Specifications › Packing setup</Link>, then come back.
        </Notice>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="box-labels-plan">
            {[
              ["Released", `${fmt(plan.released_qty)} pcs`],
              ["Per box", `${fmt(plan.qty_per_box)} pcs${plan.box_master_code ? ` · ${plan.box_master_code}` : ""}`],
              ["Boxes", `${plan.planned_boxes} + ${plan.spare_labels} spare = ${plan.labels_total}`],
              ["Printed", `${plan.printed_serials} of ${plan.labels_total}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
                <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">From label no.</span>
              <input type="number" min={1} max={plan.labels_total} value={from} onChange={(event) => setFrom(event.target.value)} className={cn(fieldClass, "w-28 tabular-nums")} data-testid="box-labels-from" />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">To label no.</span>
              <input type="number" min={1} max={plan.labels_total} value={to} onChange={(event) => setTo(event.target.value)} className={cn(fieldClass, "w-28 tabular-nums")} data-testid="box-labels-to" />
            </label>
            <label className="min-w-[220px] flex-1 space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">Label size</span>
              <select value={size} onChange={(event) => setSize(event.target.value as Size)} className={fieldClass} data-testid="box-labels-size">
                {SIZES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setFrom("1"); setTo(String(plan.labels_total)) }}>All {plan.labels_total}</button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setFrom("1"); setTo(String(plan.planned_boxes)) }}>Boxes only (1–{plan.planned_boxes})</button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setFrom(String(plan.planned_boxes + 1)); setTo(String(plan.labels_total)) }}>Spare only</button>
          </div>

          {again.length ? (
            <div className="space-y-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft p-3" data-testid="box-labels-reprint">
              <p className="text-[13px] font-semibold text-signal-amber-ink">Label{again.length === 1 ? "" : "s"} {ranges(again)} {again.length === 1 ? "was" : "were"} printed before. Printing again is recorded as a reprint.</p>
              <ReasonPicker category="LABEL_REPRINT" value={reason} onChange={setReason} plantId={activePlant || undefined} label="Reprint reason" showErrors={showReasonErrors} />
            </div>
          ) : null}
          {error ? <Notice tone="rose" testId="box-labels-error">{error}</Notice> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">{rangeOk ? `${chosen.length} label${chosen.length === 1 ? "" : "s"}: ${ranges(chosen.map((row) => row.seq))}` : `Choose numbers from 1 to ${plan.labels_total}`}</p>
            <button type="button" className="erp-btn-primary !h-11" onClick={() => void print()} disabled={saving || !rangeOk || !chosen.length} data-testid="box-labels-print">
              <Printer className="h-4 w-4" aria-hidden="true" />
              {saving ? "Recording…" : `${again.length ? "Reprint" : "Print"} ${chosen.length} label${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>

          {preview.length ? (
            <div>
              <p className="mb-2 text-[12.5px] font-semibold text-foreground">Preview{chosen.length > preview.length ? ` · first ${preview.length} of ${chosen.length}` : ""}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="box-labels-preview">
                {preview.map((row) => <PackLabel key={row.seq} row={row} plan={plan} heading={heading} origin={origin} />)}
              </div>
            </div>
          ) : null}

          <details className="rounded-xl border border-border bg-card" open={plan.labels.length <= 30}>
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-foreground">All labels ({plan.labels_total})</summary>
            <div className="max-h-72 overflow-auto border-t border-border">
              <table className="w-full text-[12.5px]" data-testid="box-labels-serials">
                <thead><tr className="text-left text-muted-foreground"><th className="px-3 py-1.5">No.</th><th className="px-3 py-1.5">Box code</th><th className="px-3 py-1.5 text-right">Qty</th><th className="px-3 py-1.5">Box</th><th className="px-3 py-1.5">Printed</th></tr></thead>
                <tbody>
                  {plan.labels.map((row) => (
                    <tr key={row.seq} className="border-t border-border">
                      <td className="px-3 py-1.5 tabular-nums">{row.seq}</td>
                      <td className="px-3 py-1.5 font-mono">{row.box_code}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{row.qty == null ? "—" : fmt(row.qty)}</td>
                      <td className="px-3 py-1.5">{row.kind === "SPARE" ? "spare" : row.kind === "PART" ? "part box" : row.box_status ? row.box_status.toLowerCase() : "to pack"}</td>
                      <td className="px-3 py-1.5">{row.printed ? `${row.printed}×` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground"><History className="h-4 w-4" aria-hidden="true" />Print record</p>
        {plan.prints.length ? (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card text-[12.5px]" data-testid="box-labels-history">
            {plan.prints.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <strong className="text-foreground">{row.from_seq === row.to_seq ? `Label ${row.from_seq}` : `Labels ${row.from_seq}–${row.to_seq}`}</strong> · {row.label_count} printed
                  {row.is_reprint ? <> · <span className="font-semibold text-signal-amber-ink">reprint</span>{row.reason_code ? ` (${row.reason_code}${row.reason_note ? `: ${row.reason_note}` : ""})` : ""}</> : null}
                </span>
                <span className="text-muted-foreground">{when(row.printed_at)} · {personLabel(row.printed_by_name || row.printed_by)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[12.5px] text-muted-foreground">Not printed yet.</p>}
      </div>

      {mounted && printRows.length ? createPortal(
        <div className="pl-print" data-size={size} aria-hidden="true">
          {pages.map((page, index) => <div key={index} className="pl-page">{page.map((row) => <PackLabel key={row.seq} row={row} plan={plan} heading={heading} origin={origin} />)}</div>)}
        </div>,
        document.body,
      ) : null}
    </section>
  )
}
