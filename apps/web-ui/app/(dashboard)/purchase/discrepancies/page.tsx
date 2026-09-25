"use client"

import { useAuth } from "@/context/AuthContext"
import { businessDate } from "@/lib/business-date"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, BadgeIndianRupee, CheckCircle2, FilePlus2, Scale, Unlock } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { purchaseApi } from "@/lib/api"
import type { Discrepancy } from "@/lib/procurement-types"

const today = () => businessDate()

export default function PurchaseDiscrepanciesPage() {
  const { activePlant } = useAuth()
  const client = useQueryClient(); const [selected, setSelected] = useState<string[]>([]); const [reason, setReason] = useState<Record<string, string>>({}); const [notice, setNotice] = useState("")
  const query = useQuery({ queryKey: ["purchase-v2", "discrepancies", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getDiscrepancies() })
  const rows: Discrepancy[] = query.data?.data?.items || []; const summary = query.data?.data?.summary || {}
  const mutate = useMutation({ mutationFn: ({ row, action }: { row: Discrepancy; action: string }) => purchaseApi.actOnDiscrepancy(row.id, { action, expected_version: row.version, reason: reason[row.id] || (action === "RELEASE_STOCK" ? "Released for use while commercial claim remains open" : "Commercial variance reviewed") }), onSuccess: () => { setNotice("Commercial review saved; stock eligibility was recalculated from both QC and commercial status."); client.invalidateQueries({ queryKey: ["purchase-v2"] }) } })
  const createNote = useMutation({ mutationFn: () => purchaseApi.createDebitNote({ request_id: crypto.randomUUID(), note_date: today(), discrepancy_ids: selected, reason: "Supplier invoice differences reviewed against receipt evidence" }), onSuccess: ({ data }) => { setSelected([]); setNotice(`${data.debit_note_no} created as a governed draft.`); client.invalidateQueries({ queryKey: ["purchase-v2"] }) } })
  const positiveOpen = rows.filter((row) => row.claimable_amount > 0 && ["OPEN", "UNDER_REVIEW"].includes(row.status))
  const favorable = rows.filter((row) => row.signed_amount < 0).reduce((sum, row) => sum + Math.abs(row.signed_amount), 0)

  return <ProcurementShell eyebrow="Invoice difference register" title="Invoice differences"
    description="Positive and favorable differences stay visible separately. Accepting a variance, keeping a claim open and releasing stock are explicit actions; none rewrite the PO or invoice rate.">
    <RequestErrors errors={[mutate.error, createNote.error, query.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Open cases" value={summary.open_cases || 0} detail="Awaiting commercial decision" icon={AlertTriangle} tone="amber" /><SummaryCard label="Potential claims" value={`₹${Number(summary.claimable_amount || 0).toLocaleString("en-IN")}`} detail="Open rate and quantity claims" icon={BadgeIndianRupee} tone="rose" /><SummaryCard label="Favorable difference" value={`₹${favorable.toLocaleString("en-IN")}`} detail="Shown separately, never silently netted" icon={CheckCircle2} tone="emerald" /><SummaryCard label="Selected for claim" value={selected.length} detail="One vendor per debit note" icon={Scale} tone="cyan" /></section>
    <WorkPanel title="Commercial comparison queue" description="One row per saved rate or quantity difference. Select positive rate rows for a debit-note draft."
      action={<button className={primaryButton} disabled={!selected.length || createNote.isPending} onClick={() => createNote.mutate()}><FilePlus2 className="h-4 w-4" /> Open debit note</button>}>
      {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : rows.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[1240px] text-left text-sm"><thead className="bg-muted text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><tr>{['Claim','Type','PO / GRN','Invoice','Vendor / item','Received kg','Invoice kg','PO rate','Invoice rate','Difference','Exposure','Status','Review reason','Actions'].map((head) => <th key={head} className="border-b border-border px-3 py-3">{head}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border align-top last:border-0"><td className="px-3 py-3"><input aria-label={`Select ${row.po_no} ${row.item_code}`} type="checkbox" disabled={row.type !== 'RATE' || row.claimable_amount <= 0 || !['OPEN','UNDER_REVIEW'].includes(row.status)} checked={selected.includes(row.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td><td className="px-3 py-3"><StateBadge value={row.type} /></td><td className="px-3 py-3 font-semibold text-foreground">{row.po_no} · R{row.revision_no}<div className="mt-1 text-xs font-normal text-muted-foreground">{row.grn_no}</div></td><td className="px-3 py-3">{row.invoice_no}<div className="mt-1 text-xs text-muted-foreground">{row.invoice_date}</div></td><td className="max-w-[190px] px-3 py-3">{row.supplier_name}<div className="mt-1 text-xs text-muted-foreground">{row.item_code} · {row.item_name}</div></td><td className="px-3 py-3 tabular-nums">{row.quantity_kg.toLocaleString("en-IN")}</td><td className="px-3 py-3 tabular-nums">{Number(row.invoice_quantity_kg ?? row.quantity_kg).toLocaleString("en-IN")}</td><td className="px-3 py-3 tabular-nums">₹{row.po_rate}</td><td className="px-3 py-3 tabular-nums">₹{row.invoice_rate}</td><td className="px-3 py-3 font-semibold tabular-nums">{row.delta >= 0 ? "+" : ""}{row.type === 'RATE' ? `₹${row.delta}/kg` : `${row.delta} ${row.type === "SPECIFICATION" ? "mm" : "kg"}`}</td><td className={`px-3 py-3 font-semibold tabular-nums ${row.signed_amount > 0 ? "text-signal-rose-ink" : "text-signal-emerald-ink"}`}>{row.type === 'RATE' ? `${row.signed_amount >= 0 ? "+" : ""}₹${row.signed_amount.toLocaleString("en-IN")}` : "Review quantity"}</td><td className="px-3 py-3"><StateBadge value={row.status} /></td><td className="w-[220px] px-3 py-3"><Field label="Decision record"><input className={fieldClass} value={reason[row.id] || ""} onChange={(e) => setReason({ ...reason, [row.id]: e.target.value })} placeholder="Required audit reason" /></Field></td><td className="px-3 py-3"><div className="flex flex-col gap-2"><button className={secondaryButton} disabled={mutate.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => mutate.mutate({ row, action: "ACCEPT_VARIANCE" })}><CheckCircle2 className="h-4 w-4" /> Accept difference</button><button className={secondaryButton} disabled={mutate.isPending || (reason[row.id] || "").trim().length < 3} onClick={() => mutate.mutate({ row, action: "RELEASE_STOCK" })}><Unlock className="h-4 w-4" /> Release, keep case</button></div></td></tr>)}</tbody></table></div> : <EmptyState label="No invoice discrepancies. Matching receipt quantities and rates remain outside this exception queue." />}
    </WorkPanel>
  </ProcurementShell>
}
