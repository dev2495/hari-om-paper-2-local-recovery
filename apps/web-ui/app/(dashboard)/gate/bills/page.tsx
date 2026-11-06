"use client"

/**
 * Accounts bills inbox (6 Nov 2026, plan §4): expense bills photographed at the gate (electricity,
 * maintenance, courier …). Accounts fills party, bill no., date, amount and cost head and taps Filed.
 * No stock and no ledger: a register with the document. A wrong type can be moved to Stores.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Inbox, Search } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { GateDocDock } from "@/components/gate/gate-dock"
import { Chip } from "@/components/inventory/stock-ui"
import { Field, MessageBar, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { ReasonPicker, reasonNeedsNote, useReasonChoice, useReasonList } from "@/components/reasons"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type GateEntry } from "@/lib/api-gate"
import { businessDate } from "@/lib/business-date"
import { dayText, errorText, rupees, timeText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

type Tab = "TO_FILE" | "FILED"

export default function GateBillsPage() {
  return <RoleGate allow={["Accounts", "PlantManager"]}><Suspense fallback={null}><BillsInbox /></Suspense></RoleGate>
}

function BillsInbox() {
  const { activePlant } = useAuth()
  const params = useSearchParams()
  const [tab, setTab] = useState<Tab>("TO_FILE")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<string | null>(params.get("entry"))
  const concrete = Boolean(activePlant && activePlant !== "ALL")
  const bills = useQuery({ queryKey: ["gate", "bills", activePlant, tab, q], enabled: concrete, queryFn: () => gateApi.bills(tab, q || undefined), refetchInterval: 60_000 })
  const items = useMemo(() => bills.data?.items || [], [bills.data])
  const current = items.find((row) => row.id === selected) || null
  const wanted = useQuery({ queryKey: ["gate", "entry", selected], enabled: Boolean(selected && !current), queryFn: () => gateApi.entry(selected!) })
  const entry = current || wanted.data || null
  useEffect(() => { if (!selected && items[0]) setSelected(items[0].id) }, [items, selected])

  return (
    <div className="min-w-0 space-y-5" data-testid="gate-bills">
      <PageHeader title="Bills inbox" description="Expense bills photographed at the gate. Fill in the bill and tap Filed. Nothing goes to stock or the ledger." />
      {!concrete ? <MessageBar tone="info">Pick one plant at the top to see its bills.</MessageBar> : <>
        <div className="flex flex-wrap items-center gap-2">
          {(["TO_FILE", "FILED"] as Tab[]).map((key) => (
            <button key={key} onClick={() => { setTab(key); setSelected(null) }} className={cn("inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold max-sm:h-11", tab === key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
              {key === "TO_FILE" ? "To file" : "Filed"} <span className="tabular-nums opacity-80">{bills.data?.counts?.[key] ?? ""}</span>
            </button>
          ))}
          <label className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={cn(fieldClass, "pl-9 max-sm:h-11")} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Party, bill no., GE no., vehicle" aria-label="Search bills" />
          </label>
        </div>
        {bills.isError ? <MessageBar tone="error">The bills could not load: {errorText(bills.error)}</MessageBar> : null}
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-2" data-testid="gate-bills-list">
            {bills.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
            {!bills.isLoading && !items.length ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                <Inbox className="h-6 w-6" aria-hidden="true" />{tab === "TO_FILE" ? "No bill is waiting. Bills the watchman photographs (other than material) arrive here." : "No bill filed yet."}
              </div>
            ) : null}
            {items.map((row) => (
              <button key={row.id} onClick={() => setSelected(row.id)} className={cn("block w-full rounded-xl border bg-card p-3 text-left shadow-sm transition", selected === row.id ? "border-primary ring-2 ring-primary/15" : "border-border hover:border-foreground/20")}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold text-foreground">{row.category_label}</p>
                  <Chip tone={row.status === "FILED" ? "emerald" : "amber"}>{row.status === "FILED" ? "Filed" : "To file"}</Chip>
                </div>
                <p className="text-[12.5px] text-muted-foreground">{row.entry_no} · {timeText(row.created_at)}{row.gate_name ? ` · ${row.gate_name}` : ""}</p>
                <p className="text-[12.5px] text-foreground/85">{row.party_text || "Party not filled yet"}{row.bill_amount != null ? ` · ${rupees(row.bill_amount)}` : ""}{row.document_count ? "" : " · photos uploading"}</p>
              </button>
            ))}
          </div>
          {entry ? <BillDetail key={entry.id + ":" + entry.version} entry={entry} onFiled={() => setSelected(null)} /> : selected && wanted.isError ? <MessageBar tone="error">{errorText(wanted.error)}</MessageBar> : null}
        </div>
      </>}
    </div>
  )
}

function BillDetail({ entry, onFiled }: { entry: GateEntry; onFiled: () => void }) {
  const client = useQueryClient()
  const costHead = useReasonChoice("COST_HEAD")
  const categories = useReasonList("BILL_CATEGORY")
  const [form, setForm] = useState({ party_name: entry.party_text || "", bill_no: entry.bill_no || "", bill_date: entry.bill_date || businessDate(), amount: entry.bill_amount != null ? String(entry.bill_amount) : "" })
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const [moveTo, setMoveTo] = useState("")
  const [moveNote, setMoveNote] = useState("")
  const moveNeedsNote = reasonNeedsNote(moveTo)
  useEffect(() => { if (entry.cost_head_code && !costHead.value.code) costHead.setValue({ code: entry.cost_head_code, note: "" }) }, [entry.cost_head_code]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => client.invalidateQueries({ queryKey: ["gate"] })
  const problems = useMemo(() => [
    !form.party_name.trim() ? "Write the party (who sent the bill)." : "", !form.bill_no.trim() ? "Write the bill number." : "",
    !form.bill_date ? "Pick the bill date." : "", form.amount === "" || !(Number(form.amount) >= 0) ? "Enter the amount." : "",
  ].filter(Boolean), [form])
  const file = useMutation({
    mutationFn: () => gateApi.fileBill(entry.id, { expected_version: entry.version, party_name: form.party_name.trim(), bill_no: form.bill_no.trim(), bill_date: form.bill_date, amount: String(form.amount), cost_head_code: costHead.value.code, cost_head_note: costHead.value.note || undefined }),
    onSuccess: (row) => { setNotice({ tone: "success", text: `${row.entry_no} filed: ${row.party_text} bill ${row.bill_no}, ${rupees(row.bill_amount || 0)}, ${row.cost_head_label}.` }); refresh(); onFiled() },
    onError: (error) => setNotice({ tone: "error", text: errorText(error) }),
  })
  const move = useMutation({
    mutationFn: () => gateApi.recategorise(entry.id, { category_code: moveTo, category_note: moveNote.trim() || undefined, expected_version: entry.version }),
    onSuccess: (row) => { setNotice({ tone: "success", text: `${row.entry_no} is now ${row.category_label}${row.route === "STORES" ? " and went to Stores for the GRN" : ""}.` }); refresh(); onFiled() },
    onError: (error) => setNotice({ tone: "error", text: errorText(error) }),
  })
  const editable = entry.status === "WITH_ACCOUNTS" || entry.status === "AT_GATE" || entry.status === "FILED"
  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
      <WorkPanel title={`${entry.category_label} · ${entry.entry_no}`} description={`Photographed ${timeText(entry.created_at)}${entry.gate_name ? ` at ${entry.gate_name}` : ""}${entry.vehicle_no ? ` · vehicle ${entry.vehicle_no}` : ""}.${entry.status === "FILED" ? ` Filed ${dayText(entry.filed_at)}.` : " Accounts files it next."}`}>
        {notice ? <div className="mb-3"><MessageBar tone={notice.tone}>{notice.text}</MessageBar></div> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Party *"><input className={cn(fieldClass, "max-sm:h-11")} value={form.party_name} onChange={(event) => setForm({ ...form, party_name: event.target.value })} disabled={!editable} data-testid="bill-party" /></Field>
          <Field label="Bill number *"><input className={cn(fieldClass, "max-sm:h-11")} value={form.bill_no} onChange={(event) => setForm({ ...form, bill_no: event.target.value })} disabled={!editable} data-testid="bill-no" /></Field>
          <Field label="Bill date *"><input type="date" className={cn(fieldClass, "max-sm:h-11")} value={form.bill_date} onChange={(event) => setForm({ ...form, bill_date: event.target.value })} disabled={!editable} /></Field>
          <Field label="Amount ₹ *"><input inputMode="decimal" type="number" min="0" step="0.01" className={cn(fieldClass, "max-sm:h-11")} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} disabled={!editable} data-testid="bill-amount" /></Field>
        </div>
        <div className="mt-3"><ReasonPicker category="COST_HEAD" label="Cost head" value={costHead.value} onChange={costHead.setValue} showErrors={costHead.touched} compact testIdPrefix="bill:head" disabled={!editable} /></div>
        {editable ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">{problems.length ? problems[0] : "Filed bills stay in this register with their photo (Doc Vault › Expense bills)."}</p>
          <button className={primaryButton} disabled={file.isPending || problems.length > 0} onClick={() => { if (costHead.validate()) file.mutate() }} data-testid="bill-file"><CheckCircle2 className="h-4 w-4" />{entry.status === "FILED" ? "Save changes" : "Filed"}</button>
        </div> : null}
        {entry.status !== "FILED" ? (
          <details className="mt-5 rounded-lg bg-muted/60 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-foreground">Wrong type? Move it</summary>
            <p className="mt-2 text-[12.5px] text-muted-foreground">Material bills go to Stores for the GRN. The change is logged.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select className={cn(fieldClass, "max-w-xs max-sm:h-11")} value={moveTo} onChange={(event) => setMoveTo(event.target.value)} aria-label="New bill type">
                <option value="">Pick the right type</option>
                {(categories.data || []).filter((row) => row.code !== entry.category_code).map((row) => <option key={row.code} value={row.code}>{String(row.label || row.code).replace(/\s*\(write a note\)/i, "")}</option>)}
              </select>
              {moveNeedsNote ? <input className={cn(fieldClass, "max-w-xs max-sm:h-11")} value={moveNote} onChange={(event) => setMoveNote(event.target.value)} placeholder="What kind of bill? (required)" aria-label="Bill type note" /> : null}
              <button className={secondaryButton} disabled={!moveTo || move.isPending || (moveNeedsNote && moveNote.trim().length < 5)} onClick={() => move.mutate()}>Move</button>
            </div>
          </details>
        ) : null}
        {entry.history.length ? <ol className="mt-4 space-y-1 text-[12px] text-muted-foreground">{entry.history.map((row, index) => <li key={index}>{timeText(row.at)} · {row.action.toLowerCase().replaceAll("_", " ")} · {who(row.by)}</li>)}</ol> : null}
      </WorkPanel>
      <GateDocDock entry={entry} />
    </div>
  )
}
