"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeIndianRupee, ChevronDown, FilePlus2, Scale, SkipForward, Timer } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { Field, MessageBar, RequestErrors, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { Chip } from "@/components/sales/order-chips"
import { useAuth } from "@/context/AuthContext"
import { purchaseApi } from "@/lib/api"
import { BAND_WORD, VARIANCE_STATUS_WORD } from "@/lib/incoming-qc"
import { personLabel } from "@/lib/people"
import { qtyText, timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const STATUS_FILTERS = [
  { key: "OPEN", label: "Open" },
  { key: "AWAITING_OWNER", label: "Owner decides" },
  { key: "DN_DRAFTED", label: "Debit note drafted" },
  { key: "WAITING_INVOICE", label: "Waits for invoice" },
  { key: "SKIPPED", label: "Skipped" },
  { key: "CLOSED", label: "Closed" },
  { key: "ALL", label: "All, incl. within limit" },
] as const

const OPEN_STATES = new Set(["AWAITING_OWNER", "CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED", "INFO_SENT"])
const tone = (status: string) => (status === "AWAITING_OWNER" ? "rose" : ["CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED"].includes(status) ? "amber" : status === "WITHIN" || status === "CLOSED" ? "emerald" : "slate")

const money = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

/**
 * Purchase › Invoice differences › Weight differences (6 Nov 2026): every bill weighed at incoming QC, its
 * band and who acts next. The Owner makes the debit note (through the normal debit-note rules) or skips it
 * with a reason; above the auto limit the draft is already made.
 */
export function WeightDifferencesPanel({ focusId }: { focusId?: string | null }) {
  const { activePlant, user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const isOwner = roles.has("Owner") || roles.has("Admin")
  const client = useQueryClient()
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["key"]>(focusId ? "ALL" : "OPEN")
  const [band, setBand] = useState("")
  const [vendor, setVendor] = useState("")
  const [raiser, setRaiser] = useState("")
  const [month, setMonth] = useState("")
  const [open, setOpen] = useState<string | null>(focusId || null)
  const [skipping, setSkipping] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const skipReason = useReasonChoice("WEIGHT_SHORT_SKIP")
  const params = useMemo(() => ({
    ...(status !== "OPEN" && status !== "ALL" ? { status } : {}), ...(status === "ALL" ? { include_within: true } : {}),
    ...(band ? { band } : {}), ...(raiser.trim() ? { po_raiser: raiser.trim() } : {}), ...(month ? { month } : {}),
  }), [status, band, raiser, month])
  const query = useQuery({ queryKey: ["purchase-v2", "weight-variances", activePlant, params], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getWeightVariances(params) })
  const all: any[] = query.data?.data?.items || []
  const rows = all.filter((row) => (status !== "OPEN" || OPEN_STATES.has(row.status)) && (!vendor.trim() || String(row.supplier_name || "").toLowerCase().includes(vendor.trim().toLowerCase())))
  const summary = query.data?.data?.summary || {}
  const decide = useMutation({
    mutationFn: ({ row, decision }: { row: any; decision: "MAKE_DEBIT_NOTE" | "SKIP" }) =>
      purchaseApi.decideWeightVariance(row.id, { decision, expected_version: row.version, ...(decision === "SKIP" ? skipReason.payload(null) : {}) }, row.plant_id),
    onSuccess: ({ data }) => { setNotice(data.outcome || "Saved."); setSkipping(null); skipReason.reset(); client.invalidateQueries({ queryKey: ["purchase-v2"] }) },
  })

  return (
    <div className="space-y-5" data-testid="weight-differences">
      <RequestErrors errors={[query.error, decide.error]} />
      {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Owner decides" value={summary.awaiting_owner || 0} detail="Short between the two limits" icon={Timer} tone="rose" />
        <SummaryCard label="Open weight cases" value={summary.open || 0} detail="Owner, case raised, invoice or debit note pending" icon={Scale} tone="amber" />
        <SummaryCard label="Weighed short" value={qtyText(summary.short_kg || 0, "KG")} detail="On the bills listed" icon={Scale} tone="slate" />
        <SummaryCard label="Claim value" value={money(summary.claim_amount || 0)} detail="Short × invoice rate (else PO rate)" icon={BadgeIndianRupee} tone="cyan" />
      </section>
      <WorkPanel title="Weight differences" description="Bill weight against the scale weight QC found, per bill. Stock stays on the bill weight; only the difference is claimed, through the same debit-note flow as any other invoice difference.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Status"><select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value as any)}>{STATUS_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
          <Field label="Band"><select className={fieldClass} value={band} onChange={(event) => setBand(event.target.value)}><option value="">Any</option>{Object.entries(BAND_WORD).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="Vendor"><input className={fieldClass} value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Name" /></Field>
          <Field label="PO raiser"><input className={fieldClass} value={raiser} onChange={(event) => setRaiser(event.target.value)} placeholder="Login or name" /></Field>
          <Field label="Month"><input className={fieldClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
        </div>
        {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : !rows.length ? (
          <EmptyState label={status === "OPEN" ? "No weight difference waits on anyone. Bills weighed within the limit are under All." : "Nothing matches these filters."} />
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => {
              const expanded = open === row.id
              const unit = row.uom === "MIXED" ? "" : row.uom
              return (
                <article key={row.id} data-testid={`weight-variance-${row.id}`} className={cn("rounded-xl border bg-card", row.status === "AWAITING_OWNER" ? "border-signal-rose-line" : "border-border")}>
                  <button type="button" className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.id)}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[14px] font-semibold text-foreground">{row.bill_label}</p>
                        <Chip tone="violet" size="xs" icon={Scale}>Weighed short</Chip>
                        <Chip tone={tone(row.status) as any} size="xs">{VARIANCE_STATUS_WORD[row.status] || row.status}</Chip>
                        {row.band ? <Chip tone="slate" size="xs">Band: {BAND_WORD[row.band] || row.band}</Chip> : null}
                        {row.reminder_due ? <Chip tone="rose" size="xs" icon={Timer}>48 h: reminder due</Chip> : null}
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{row.supplier_name} · GRN {(row.grn_nos || []).join(", ") || "—"}{row.po_no ? ` · PO ${row.po_no}` : ""} · raised by {personLabel(row.po_raiser) || "—"}</p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bill / scale</p><p className="text-[13px] font-semibold tabular-nums">{qtyText(row.bill_total, unit)} / {qtyText(row.actual_total, unit)}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Short</p><p className="text-[15px] font-semibold tabular-nums text-signal-rose-ink">{row.short_qty > 0 ? `−${qtyText(row.short_qty, unit)}` : row.excess_qty > 0 ? `+${qtyText(row.excess_qty, unit)}` : "0"}</p></div>
                      <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Claim</p><p className="text-[15px] font-semibold tabular-nums">{money(row.claim_amount)}</p></div>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                    </div>
                  </button>
                  {expanded ? (
                    <div className="space-y-3 border-t border-border px-4 py-3">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
                        <span>Limits on this bill: Owner above {qtyText(row.notify_kg, "KG")}, debit note above {qtyText(row.auto_kg, "KG")}</span>
                        {row.decided_by ? <span>{row.decision === "AUTO" ? "Made automatically" : row.decision === "SKIP" ? "Skipped" : "Debit note made"} by {personLabel(row.decided_by)} {row.decided_at ? timeText(row.decided_at) : ""}</span> : null}
                        {row.reason_label ? <span>Reason: {row.reason_label}{row.note ? ` · ${row.note}` : ""}</span> : null}
                        {row.debit_note_no ? <Link className="font-semibold text-signal-cyan-ink underline-offset-2 hover:underline" href={`/purchase/debit-notes?note=${row.debit_note_id}`}>Debit note {row.debit_note_no} · {String(row.debit_note_status || "").toLowerCase()}</Link> : null}
                        <Link className="font-semibold text-signal-cyan-ink underline-offset-2 hover:underline" href={`/quality/incoming?bill=${encodeURIComponent(row.bill_key)}`}>Open the bill in QC</Link>
                      </div>
                      {row.last_error ? <MessageBar tone="info">{row.last_error}</MessageBar> : null}
                      {row.grn_quantity_cases?.length ? <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink">The GRN already has a quantity case on {row.grn_quantity_cases.map((item: any) => `${item.item_code} (${qtyText(item.claimed_qty, "KG")} billed above the GRN)`).join(", ")}. Those kg are not claimed again here.</p> : null}
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[640px] text-left text-[12.5px]">
                          <thead className="bg-muted text-[11.5px] font-semibold text-muted-foreground"><tr>{["Reel / lot", "Vendor ref", "Bill", "Scale", "Difference", "Weighed by"].map((head) => <th key={head} className="px-3 py-2">{head}</th>)}</tr></thead>
                          <tbody>{(row.lots || []).map((lot: any) => {
                            const diff = lot.actual_qty != null && lot.bill_qty != null ? Number(lot.actual_qty) - Number(lot.bill_qty) : null
                            return <tr key={lot.entity_id} className={cn("border-t border-border", lot.rejected && "text-muted-foreground line-through")}><td className="px-3 py-2 font-semibold">{lot.code}</td><td className="px-3 py-2">{lot.vendor_ref || "—"}</td><td className="px-3 py-2 tabular-nums">{lot.bill_qty != null ? qtyText(Number(lot.bill_qty), lot.uom) : "—"}</td><td className="px-3 py-2 tabular-nums">{lot.actual_qty != null ? qtyText(Number(lot.actual_qty), lot.uom) : "not weighed"}</td><td className={cn("px-3 py-2 font-semibold tabular-nums", diff != null && diff < 0 && "text-signal-rose-ink")}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${qtyText(diff, lot.uom)}`}</td><td className="px-3 py-2">{lot.weighed_by ? `${personLabel(lot.weighed_by)} · ${timeText(lot.weighed_at)}` : "—"}</td></tr>
                          })}</tbody>
                        </table>
                      </div>
                      {(row.lines || []).filter((line: any) => Number(line.claim_qty) > 0).length ? (
                        <p className="text-[12.5px] text-muted-foreground">Claim per line: {(row.lines || []).filter((line: any) => Number(line.claim_qty) > 0).map((line: any) => `${line.item_code || "item"} ${qtyText(Number(line.claim_qty), "KG")} × ₹${Number(line.rate).toLocaleString("en-IN")} (${line.rate_source === "INVOICE" ? "invoice rate" : "PO rate, invoice to follow"}) = ${money(Number(line.amount))}`).join(" · ")}</p>
                      ) : null}
                      {isOwner && ["AWAITING_OWNER", "CLAIM_RAISED"].includes(row.status) ? (
                        <div className="flex flex-col gap-3 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3 sm:flex-row sm:items-end">
                          <button type="button" className={primaryButton} disabled={decide.isPending} onClick={() => decide.mutate({ row, decision: "MAKE_DEBIT_NOTE" })} data-testid="weight-make-dn">
                            <FilePlus2 className="h-4 w-4" /> {row.status === "CLAIM_RAISED" ? "Draft the debit note again" : "Make debit note"}
                          </button>
                          {row.status === "AWAITING_OWNER" ? (skipping === row.id ? (
                            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                              <div className="flex-1"><ReasonPicker category="WEIGHT_SHORT_SKIP" plantId={row.plant_id} label="Why no debit note" value={skipReason.value} onChange={skipReason.setValue} showErrors={skipReason.touched} compact testIdPrefix="weight-skip" /></div>
                              <button type="button" className={secondaryButton} disabled={decide.isPending} onClick={() => { if (skipReason.validate()) decide.mutate({ row, decision: "SKIP" }) }}>Skip with this reason</button>
                            </div>
                          ) : <button type="button" className={secondaryButton} onClick={() => { skipReason.reset(); setSkipping(row.id) }}><SkipForward className="h-4 w-4" /> Skip…</button>) : null}
                        </div>
                      ) : row.status === "AWAITING_OWNER" ? <p className="text-[12.5px] font-semibold text-signal-amber-ink">Waiting for the Owner to decide.</p> : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </WorkPanel>
    </div>
  )
}
