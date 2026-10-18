"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Barcode, PackageCheck, Search } from "lucide-react"

import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useCreateTransaction, useInventoryItemBalance, useInventoryItems, useInventoryTransactions } from "@/hooks/use-inventory"
import { inventoryApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

const SHIFTS = [{ value: "A", label: "Shift A" }, { value: "B", label: "Shift B" }, { value: "GENERAL", label: "General" }]
const clockShift = () => { const hour = new Date().getHours(); return hour >= 8 && hour < 20 ? "A" : "B" }
const qtyText = (value: any, uom?: string) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${uom || ""}`.trim()
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || "Issue failed"
}

function parseInventoryQr(raw: string) {
  const parts = raw.trim().split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") return { entityType: parts[1].toUpperCase(), entityId: parts[3], code: parts[4] }
  return { entityType: "", entityId: "", code: raw.trim() }
}

/** Adhesive, parchment and packing go to the floor by shift (client rule 2026-10-18). */
export default function MaterialFloorIssuePage() {
  const { data: items = [] } = useInventoryItems()
  const createIssue = useCreateTransaction()
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const [itemSearch, setItemSearch] = useState("")
  const [scan, setScan] = useState("")
  const [pendingBatch, setPendingBatch] = useState("")
  const [form, setForm] = useState({ item_id: "", batch_id: "", qty: "", shift: clockShift(), effective_date: businessDate(), notes: "" })
  const balance = useInventoryItemBalance(form.item_id, Boolean(form.item_id))
  const today = useInventoryTransactions({ transaction_type: "ISSUE_PRODUCTION", date_from: businessDate(), date_to: businessDate() })

  const materials = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase()
    return (Array.isArray(items) ? items : [])
      .filter((item: any) => !["FINISHED_GOOD"].includes(String(item.type || "").toUpperCase()) && String(item.tracking_mode || "").toUpperCase() !== "REEL")
      .filter((item: any) => !needle || `${item.item_code} ${item.name} ${item.type}`.toLowerCase().includes(needle))
  }, [items, itemSearch])
  const itemName = (id: string) => { const item = (Array.isArray(items) ? items : []).find((row: any) => String(row.id) === String(id)); return item ? `${item.item_code} · ${item.name}` : "Material" }
  const selectedItem = materials.find((item: any) => String(item.id) === form.item_id)
  const batches = useMemo(() => (Array.isArray(balance.data?.batches) ? balance.data.batches : []).filter((batch: any) => Number(batch.available_qty ?? batch.current_balance ?? 0) > 0 && ["UNRESTRICTED", "WIP"].includes(String(batch.stock_status || "").toUpperCase())), [balance.data])
  const selectedBatch = batches.find((batch: any) => String(batch.batch_id) === form.batch_id)
  const available = selectedBatch ? Number(selectedBatch.available_qty ?? selectedBatch.current_balance ?? 0) : batches.reduce((sum: number, batch: any) => sum + Number(batch.available_qty ?? batch.current_balance ?? 0), 0)
  const issuedToday = (Array.isArray(today.data) ? today.data : []).filter((row: any) => row.movement_metadata?.destination === "FLOOR")

  useEffect(() => { setForm((current) => ({ ...current, batch_id: "" })) }, [form.item_id])
  useEffect(() => {
    if (!pendingBatch || !batches.length) return
    const wanted = pendingBatch.toUpperCase()
    const matched = batches.find((batch: any) => [batch.batch_id, batch.batch_no, batch.inward_no, batch.grn_no].some((value) => String(value || "").toUpperCase() === wanted))
    if (matched) { setForm((current) => ({ ...current, batch_id: matched.batch_id })); setNotice({ tone: "info", text: `Lot ${matched.inward_no || matched.batch_no} selected.` }); setPendingBatch("") }
  }, [batches, pendingBatch])

  async function resolveScan() {
    const parsed = parseInventoryQr(scan)
    if (parsed.entityType && parsed.entityType !== "BATCH") return setNotice({ tone: "error", text: "Scan a batch label (reels and coils are issued on the reel tab)." })
    if (parsed.entityId) {
      try {
        const { data } = await inventoryApi.getBatchLabel(parsed.entityId)
        if (!data?.item_id) return setNotice({ tone: "error", text: "That label could not be read." })
        setItemSearch(""); setPendingBatch(data.entity_id || parsed.entityId)
        setForm((current) => ({ ...current, item_id: String(data.item_id), batch_id: "" }))
        setScan("")
      } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
      return
    }
    const code = parsed.code.toUpperCase()
    const matched = batches.find((batch: any) => [batch.batch_no, batch.inward_no, batch.grn_no].some((value) => String(value || "").toUpperCase() === code))
    if (!matched) return setNotice({ tone: "error", text: form.item_id ? "That Amigo inward number is not available for this material." : "Choose the material first, or scan the printed lot QR." })
    setForm((current) => ({ ...current, batch_id: matched.batch_id })); setScan("")
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const qty = Number(form.qty)
    if (!selectedItem) return setNotice({ tone: "error", text: "Choose the material." })
    if (!(qty > 0)) return setNotice({ tone: "error", text: "Enter the quantity going to the floor." })
    if (qty > available + 1e-9) return setNotice({ tone: "error", text: `Only ${qtyText(available, selectedItem.uom)} is available${selectedBatch ? " in this lot" : ""}.` })
    try {
      await createIssue.mutateAsync({
        item_id: form.item_id, batch_id: form.batch_id || undefined, qty, shift: form.shift, reason_code: "FLOOR_ISSUE",
        effective_date: form.effective_date, notes: form.notes.trim() || undefined,
        external_ref: `FLOOR:${form.effective_date}:${form.shift}:${selectedBatch?.inward_no || selectedBatch?.batch_no || "FIFO"}:${crypto.randomUUID().slice(0, 8)}`,
      })
      setNotice({ tone: "success", text: `${qtyText(qty, selectedItem.uom)} of ${selectedItem.name} issued to the floor for shift ${form.shift}.` })
      setForm((current) => ({ ...current, batch_id: "", qty: "", notes: "" }))
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue"]}>
      <ProcurementShell eyebrow="Stores" title="Material issue to floor" description="Adhesive, parchment and packing go to the floor for a shift — not to a job card or machine. Issue daily; what goes to the floor is consumed in full. The job card records production, and the stock count settles real consumption." actions={<IssueDeskTabs />}>
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <WorkPanel title="Issue to floor" description="Scan the Amigo inward number on the lot label, or choose the material; the oldest lot is used when no lot is chosen.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2"><Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Scan lot label" className={fieldClass} value={scan} placeholder="Scan lot QR or type Amigo inward number" onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveScan() } }} /></label>
              <button type="button" className={secondaryButton} onClick={() => void resolveScan()}><PackageCheck className="h-4 w-4" />Select</button>
            </div>
            <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Material">
                  <div className="space-y-2">
                    <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="w-full bg-transparent text-[13px] outline-none" aria-label="Find material" placeholder="Find adhesive, parchment, packing…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} /></label>
                    <select className={fieldClass} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
                      <option value="">Choose material</option>
                      {materials.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name} ({String(item.type || "").replace(/_/g, " ").toLowerCase()})</option>)}
                    </select>
                  </div>
                </Field>
              </div>
              <Field label="Lot (Amigo inward no.)" hint="optional">
                <select className={fieldClass} value={form.batch_id} disabled={!form.item_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}>
                  <option value="">Oldest lot first</option>
                  {batches.map((batch: any) => <option key={batch.batch_id} value={batch.batch_id}>{batch.inward_no || batch.grn_no || batch.batch_no} · {qtyText(batch.available_qty ?? batch.current_balance, selectedItem?.uom)}</option>)}
                </select>
              </Field>
              <Field label={`Quantity${selectedItem ? ` · ${selectedItem.uom}` : ""}`} hint={selectedItem ? `${qtyText(available, selectedItem.uom)} available` : undefined}>
                <input className={fieldClass} type="number" min="0.001" step="0.001" inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </Field>
              <Field label="Shift">
                <div role="radiogroup" aria-label="Shift" className="flex gap-1 rounded-lg bg-muted p-1">
                  {SHIFTS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={form.shift === item.value} onClick={() => setForm({ ...form, shift: item.value })} className={cn("min-h-8 flex-1 rounded-md text-[13px] font-semibold", form.shift === item.value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{item.label}</button>)}
                </div>
              </Field>
              <Field label="Issue date"><input className={fieldClass} type="date" value={form.effective_date} max={businessDate()} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Note" hint="optional"><input className={fieldClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
              <button type="submit" className={cn(primaryButton, "justify-center sm:col-span-2")} disabled={createIssue.isPending || !form.item_id}><PackageCheck className="h-4 w-4" />Issue to floor</button>
            </form>
          </WorkPanel>
          <WorkPanel title={`Issued to floor today · ${issuedToday.length}`} description="Today's business date, all shifts.">
            {issuedToday.length ? (
              <ul className="divide-y divide-border">
                {issuedToday.map((row: any) => (
                  <li key={row.transaction_id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate"><span className="font-medium">{itemName(row.item_id)}</span><span className="block text-[12px] text-muted-foreground">Shift {row.movement_metadata?.shift || "—"}{row.movement_metadata?.notes ? ` · ${row.movement_metadata.notes}` : ""}</span></span>
                    <span className="shrink-0 font-semibold tabular-nums">{qtyText(Math.abs(Number(row.qty_change || 0)))}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing issued to the floor yet today.</p>}
          </WorkPanel>
        </div>
      </ProcurementShell>
    </RoleGate>
  )
}
