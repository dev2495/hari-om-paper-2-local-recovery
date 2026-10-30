"use client"

import Link from "next/link"
import { ArrowUpRight, Boxes, ClipboardList, Flag, Scale } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useMonthEndSources } from "@/hooks/use-month-end"
import { dayText, personText, plainCode, qty, signedQty, storeChangeWords, type MonthEndItem, type MonthEndOverview } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

const STAGE_WORDS: Record<string, string> = { PROCESS: "Process", PACKING: "Packing", QC: "Final QC" }

/** Store rows come from inventory; read the common field names so any list renders in plain words. */
const pick = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") return row[key]
  return undefined
}
const DATE_KEYS = ["day", "date", "effective_date", "business_date", "issue_date", "inward_date", "posted_at", "approved_at", "counted_at", "at", "created_at"]
const REF_KEYS = ["doc", "ref", "reference", "document_no", "grn_no", "voucher_no", "issue_no", "count_no", "lot", "reel_no", "lot_no"]
const QTY_KEYS = ["qty", "quantity", "delta", "variance_qty", "issued_qty", "received_qty", "weight_kg", "qty_kg", "amount"]
const PEOPLE_KEYS = ["by", "issued_by", "counted_by", "approved_by", "created_by"]
/** Reasons that only repeat the section a line sits in ("Issued to the floor" under Issued). */
const SECTION_REASONS: Record<string, string[]> = {
  ISSUED: ["FLOOR_ISSUE", "MATERIAL_ISSUE", "ISSUE"],
  COUNT_VARIANCE: ["PHYSICAL_COUNT_VARIANCE"],
  RECEIVED: ["GRN", "RECEIPT", "PURCHASE_RECEIPT"],
  OPENING_LOAD: ["OPENING_LOAD"],
  SENT_BACK: ["SUPPLIER_RETURN", "QC_REJECT"],
}
/** Inventory's book kinds, in the order of the store identity (spec 2.1). */
const KIND_SECTIONS: Array<[string, string]> = [
  ["RECEIVED", "Received (GRN)"],
  ["OPENING_LOAD", "Opening loads"],
  ["SENT_BACK", "Sent back to supplier"],
  ["ISSUED", "Issued to the floor"],
  ["COUNT_VARIANCE", "Count differences"],
  ["CORRECTION", "Corrections"],
]
const SECTION_WORDS: Record<string, string> = {
  receipts: "Received", received: "Received", issues: "Issued to the floor", issued: "Issued to the floor",
  sent_back: "Sent back to supplier", corrections: "Corrections", count_lines: "Month-end count lines",
}

type StoreSection = { key: string; title: string; rows: Record<string, any>[] }

function storeSections(data: unknown): StoreSection[] {
  const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.rows) ? (data as any).rows : null
  if (rows && rows.some((row: any) => row?.kind)) {
    const known = KIND_SECTIONS.map(([kind, title]) => ({ key: kind, title, rows: rows.filter((row: any) => row?.kind === kind) }))
    const other = rows.filter((row: any) => !KIND_SECTIONS.some(([kind]) => kind === row?.kind))
    return [...known, ...(other.length ? [{ key: "OTHER", title: "Other movements", rows: other }] : [])].filter((section) => section.rows.length)
  }
  if (rows) return [{ key: "rows", title: "Store movements", rows }]
  if (!data || typeof data !== "object") return []
  return Object.entries(data as Record<string, any>)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({ key, title: SECTION_WORDS[key] || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), rows: value as Record<string, any>[] }))
}

/** One store line in words: reference first, then day, lot, reason, shift, machine and rack. */
function lineText(row: Record<string, any>, kind?: string) {
  const ref = pick(row, REF_KEYS)
  const when = pick(row, DATE_KEYS)
  const parts: string[] = []
  if (when) parts.push(dayText(String(when).slice(0, 10)))
  if (row?.lot && row.lot !== ref) parts.push(`lot ${row.lot}`)
  const reason = row?.reason ? String(row.reason) : ""
  if (reason && !(kind && SECTION_REASONS[kind]?.includes(reason))) parts.push(plainCode(reason))
  if (row?.shift) parts.push(/^shift/i.test(String(row.shift)) ? String(row.shift) : `shift ${row.shift}`)
  if (row?.section) parts.push(plainCode(row.section))
  if (row?.against_grn) parts.push(`from GRN ${row.against_grn}`)
  if (row?.location_name || row?.location_code) parts.push(`at ${row.location_name || row.location_code}`)
  if (row?.note) parts.push(String(row.note))
  for (const key of PEOPLE_KEYS) if (row?.[key]) parts.push(personText(String(row[key])))
  return {
    title: ref ? String(ref) : String(row?.label || "Line"),
    detail: parts.filter((part, index) => part && parts.indexOf(part) === index).join(" · "),
  }
}

function Identity({ item, view }: { item: MonthEndItem; view: MonthEndOverview }) {
  const unit = item.unit_label
  const change = storeChangeWords(item.corrections, item.count_variance, unit)
  const rows: Array<[string, string, string?]> = [
    ["Opening", qty(item.opening, unit)],
    ["+ Received", qty(item.received, unit), item.opening_loads ? `of which opening loads ${qty(item.opening_loads, unit)}` : undefined],
    ["− Sent back", qty(item.sent_back, unit)],
    ["− Issued to floor", qty(item.issued, unit)],
    ["± Count and corrections", signedQty(item.corrections, unit), item.corrections ? change.short : undefined],
    ["= Closing", qty(item.closing, unit)],
  ]
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <dl className="divide-y divide-border text-[13px]">
        {rows.map(([label, value, hint]) => (
          <div key={label} className={cn("flex items-baseline justify-between gap-3 px-3 py-2", label.startsWith("=") && "bg-[hsl(var(--surface-2))] font-semibold")}>
            <dt className="min-w-0">
              {label}
              {hint ? <span className="block text-[12px] font-normal text-muted-foreground">{hint}</span> : null}
            </dt>
            <dd className="shrink-0 tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 px-3 py-2">
          <dt>Used (opening + received − sent back − closing)</dt>
          <dd className="shrink-0 tabular-nums font-semibold">{view.actual_known && item.actual_used !== null ? qty(item.actual_used, unit) : "After the count"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 px-3 py-2">
          <dt>Spec · expected with {qty(item.normal_wastage_pct)}% wastage</dt>
          <dd className="shrink-0 tabular-nums">{qty(item.spec, unit)} · {qty(item.expected, unit)}</dd>
        </div>
      </dl>
      {!item.identity_ok ? (
        <p className="border-t border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12px] text-signal-amber-ink">The store figures for this item do not add up. Check the stock book before closing.</p>
      ) : null}
    </div>
  )
}

export function SourcesDrawer({ item, view, plantId, onClose }: { item: MonthEndItem | null; view: MonthEndOverview; plantId: string; onClose: () => void }) {
  const query = useMonthEndSources(view.month, item?.item_code, item?.item_id, item ? plantId : null)
  const data = query.data
  const unit = item?.unit_label || ""
  const sections = storeSections(data?.store?.data)
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        className="tube-sheet-right !left-auto !right-0 !top-0 !flex !h-dvh !max-h-dvh !w-full !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-0 !rounded-none !border-0 !p-0 md:!w-[min(640px,100vw)] md:!rounded-l-2xl md:!border-l"
        data-testid="month-end-sources"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b border-border bg-primary/[.04] py-3 pl-4 pr-12 sm:pl-5">
          <DialogTitle className="!text-[17px] font-semibold tracking-tight">{item?.item_name || "Item"}</DialogTitle>
          <DialogDescription className="mt-0.5 !text-[12.5px] text-muted-foreground">
            {item?.item_code} · where the {view.month_label} numbers come from
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {item ? (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Store book for the month</h3>
              <Identity item={item} view={view} />
            </section>
          ) : null}
          {query.isLoading ? <LoadingState label="Reading the job cards and store lines…" /> : null}
          {query.isError ? <ErrorState title="Sources could not be loaded" message="Try again in a minute." onRetry={() => query.refetch()} /> : null}
          {data ? (
            <>
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Spec from {data.spec.job_cards === 1 ? "1 job card" : `${data.spec.job_cards} job cards`} ·{" "}
                  {data.spec.totals && data.spec.totals.length > 1
                    ? data.spec.totals.map((total) => qty(total.qty, total.unit_label)).join(" + ")
                    : qty(data.spec.total, data.spec.total_unit_label || unit)}
                </h3>
                {data.spec.unit_differs ? (
                  <p className="mb-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft/60 px-3 py-2 text-[12.5px] leading-5 text-signal-amber-ink">
                    The job cards posted this spec in {data.spec.totals?.map((total) => total.unit_label).join(" and ") || "another unit"}, but the stock item counts in {data.spec.stock_unit_label || unit}. It is listed under Spec not linked and is not compared with the store.
                  </p>
                ) : null}
                {data.spec.rows.length ? (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {data.spec.rows.map((row) => (
                      <li key={`${row.job_card_id}-${row.posted_on}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
                        <div className="min-w-0">
                          <Link href={`/production/job-cards/${row.job_card_id}`} className="-my-1 inline-flex min-h-[44px] min-w-[44px] items-center font-semibold text-primary hover:underline sm:my-0 sm:min-h-0 sm:min-w-0">
                            {row.job_card_no || "Job card"}
                          </Link>
                          <p className="text-[12px] text-muted-foreground">
                            {STAGE_WORDS[String(row.stage || "")] || "Closed"} on {dayText(row.posted_on)} · {qty(row.good_qty, "pcs good")}
                            {row.product_code ? ` · ${row.product_code}` : ""}
                          </p>
                          {row.posted_after_close ? (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-signal-amber-ink">
                              <Flag className="h-3 w-3" aria-hidden="true" />Closed in {row.posted_after_close} after it was closed; counted here
                            </p>
                          ) : null}
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums">{qty(row.spec, row.unit_label || unit)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">No job card posted spec for this item in {view.month_label}.</p>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Boxes className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Store lines</h3>
                {data.store.available && sections.length ? (
                  <div className="space-y-3">
                    {sections.map((section) => (
                      <div key={section.key}>
                        <p className="mb-1 text-[12px] font-semibold text-muted-foreground">{section.title} · {section.rows.length}</p>
                        {section.rows.length ? (
                          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                            {section.rows.slice(0, 200).map((row, index) => {
                              const amount = pick(row, QTY_KEYS)
                              const text = lineText(row, section.key)
                              const signed = amount !== undefined ? Number(amount) : null
                              return (
                                <li key={String(row.id || index)} className="flex items-start justify-between gap-3 px-3 py-2 text-[12.5px]">
                                  <div className="min-w-0">
                                    <p className="break-words font-medium">{text.title}</p>
                                    {text.detail ? <p className="break-words text-[12px] text-muted-foreground">{text.detail}</p> : null}
                                  </div>
                                  {signed !== null && Number.isFinite(signed) ? (
                                    <span className="shrink-0 tabular-nums font-semibold">{signed > 0 ? "+" : signed < 0 ? "−" : ""}{qty(Math.abs(signed), unit)}</span>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <p className="text-[12px] text-muted-foreground">None this month.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-3 py-3 text-[12.5px] leading-5 text-muted-foreground">
                    The store&apos;s line-by-line list for this item is not available here yet. The stock ledger has every issue and receipt.
                  </p>
                )}
                {data.ledger_href ? (
                  <Link href={data.ledger_href} className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-[32px]">
                    Open the stock ledger for {view.month_label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                ) : null}
              </section>

              {data.note ? (
                <section className="rounded-xl border border-signal-blue-line bg-signal-blue-soft/60 px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-muted-foreground">Note</p>
                  <p className="mt-0.5 break-words text-[13px]">“{data.note.note}”</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{personText(data.note.noted_by)} · {dayText(data.note.noted_at)}</p>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
