"use client"

import { useAuth } from "@/context/AuthContext"
import { businessDate } from "@/lib/business-date"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeIndianRupee, CheckCheck, Clock3, FileWarning, Printer } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { purchaseApi } from "@/lib/api"

const today = () => businessDate()

export default function DebitNotesPage() {
  const { activePlant } = useAuth()
  const client = useQueryClient(); const [notice, setNotice] = useState(""); const [settlements, setSettlements] = useState<Record<string, string>>({})
  const query = useQuery({ queryKey: ["purchase-v2", "debit-notes", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getDebitNotes() })
  const notes: any[] = query.data?.data?.items || []
  const refresh = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const action = useMutation({ mutationFn: ({ note, name }: any) => purchaseApi.actOnDebitNote(note.id, { action: name, expected_version: note.version, reason: name === "VOID" ? "Voided after commercial review" : undefined }), onSuccess: ({ data }) => { setNotice(`${data.debit_note_no} moved to ${data.status}.`); refresh() } })
  const settle = useMutation({ mutationFn: (note: any) => purchaseApi.settleDebitNote(note.id, { amount: Number(settlements[note.id]), settlement_date: today(), reference: `SETTLEMENT-${today()}` }), onSuccess: ({ data }) => { setNotice(`${data.debit_note_no} settlement saved; ₹${data.open_amount.toLocaleString("en-IN")} remains open.`); refresh() } })
  const total = notes.reduce((sum, row) => sum + Number(row.total_amount || 0), 0); const open = notes.reduce((sum, row) => sum + Number(row.open_amount || 0), 0)

  return <ProcurementShell eyebrow="Commercial claims" title="Debit notes"
    description="Draft, approval, issue and settlement are separate states. Issuing a note does not mark cash or credit as settled, and no claim action moves physical stock.">
    <RequestErrors errors={[action.error, settle.error, query.error]} />
    {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
    <section className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Documents" value={notes.length} detail="Draft through settled" icon={FileWarning} tone="slate" /><SummaryCard label="Claimed value" value={`₹${total.toLocaleString("en-IN")}`} detail="All saved document totals" icon={BadgeIndianRupee} tone="rose" /><SummaryCard label="Open settlement" value={`₹${open.toLocaleString("en-IN")}`} detail="Issued value not yet settled" icon={Clock3} tone="amber" /></section>
    <WorkPanel title="Debit note register" description="Use Rate Review to create a draft from eligible discrepancies. Issued documents print from their saved lines.">
      {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : notes.length ? <div className="space-y-3">{notes.map((note) => <article key={note.id} className="debit-note-print rounded-xl border border-border bg-card p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] xl:items-end"><div><p className="hidden text-[11.5px] font-semibold text-signal-cyan-ink print:block">Amigo Industries Unit-2 · Commercial purchase claim</p><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-foreground">{note.debit_note_no}</h2><StateBadge value={note.status} /></div><p className="mt-2 text-sm font-medium text-muted-foreground">{note.supplier_name}</p><p className="mt-1 text-xs text-muted-foreground">{note.note_date} · {note.lines.length} source discrepancy line(s)</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{note.reason}</p></div><div><p className="text-[11.5px] font-semibold text-muted-foreground">Claim / settled / open</p><p className="mt-2 font-semibold tabular-nums">₹{note.total_amount.toLocaleString("en-IN")} / ₹{note.settled_amount.toLocaleString("en-IN")} / ₹{note.open_amount.toLocaleString("en-IN")}</p></div><div className="no-print flex flex-wrap gap-2">{note.status === "DRAFT" ? <button className={primaryButton} onClick={() => action.mutate({ note, name: "SUBMIT" })}>Submit</button> : null}{note.status === "SUBMITTED" ? <button className={primaryButton} onClick={() => action.mutate({ note, name: "APPROVE" })}><CheckCheck className="h-4 w-4" /> Approve</button> : null}{note.status === "APPROVED" ? <button className={primaryButton} onClick={() => action.mutate({ note, name: "ISSUE" })}>Issue immutable note</button> : null}<a className={secondaryButton} href={purchaseApi.debitNotePdfUrl(note.id)} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Saved PDF</a></div></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-y border-border text-[11.5px] font-semibold text-muted-foreground"><th className="px-2 py-2">Source case</th><th className="px-2 py-2">Claim</th><th className="px-2 py-2">Tax adjustment</th></tr></thead><tbody>{note.lines.map((line: any) => <tr key={line.id} className="border-b border-border"><td className="px-2 py-2 font-mono">{line.discrepancy_id}</td><td className="px-2 py-2 tabular-nums">₹{Number(line.claimed_amount).toLocaleString("en-IN")}</td><td className="px-2 py-2 tabular-nums">₹{Number(line.tax_adjustment).toLocaleString("en-IN")}</td></tr>)}</tbody></table></div>
        {['ISSUED','PARTIALLY_SETTLED'].includes(note.status) ? <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto]"><Field label="Settlement amount"><input className={fieldClass} type="number" min="0.01" max={note.open_amount} step="0.01" value={settlements[note.id] || ""} onChange={(e) => setSettlements({ ...settlements, [note.id]: e.target.value })} /></Field><button className={`${primaryButton} self-end`} disabled={Number(settlements[note.id]) <= 0 || settle.isPending} onClick={() => settle.mutate(note)}>Record settlement</button></div> : null}
      </article>)}</div> : <EmptyState label="No debit notes. Create one from eligible positive differences in Rate Review." />}
    </WorkPanel>
  </ProcurementShell>
}
