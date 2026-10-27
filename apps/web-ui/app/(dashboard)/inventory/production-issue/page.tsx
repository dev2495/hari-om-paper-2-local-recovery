"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Barcode, PackageCheck, Search } from "lucide-react"

import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useCreateTransaction, useInventoryBalances, useInventoryItemBalance, useInventoryItems, useInventoryTransactions, useIssueParchmentByWeight, useReelIssues } from "@/hooks/use-inventory"
import { inventoryApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"

const SHIFTS = [{ value: "A", label: "Shift A" }, { value: "B", label: "Shift B" }, { value: "GENERAL", label: "General" }]
const clockShift = () => { const hour = new Date().getHours(); return hour >= 8 && hour < 20 ? "A" : "B" }
const unitText = (uom?: string) => ({ KG: "kg", PCS: "pcs", L: "L" } as Record<string, string>)[String(uom || "").toUpperCase()] || String(uom || "").toLowerCase()
const qtyText = (value: any, uom?: string) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unitText(uom)}`.trim()
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || "Issue failed"
}
const isParchment = (item: any) => String(item?.type || "").toUpperCase() === "PARCHMENT"
const isPieces = (item: any) => String(item?.uom || "").toUpperCase() === "PCS"
const KIND_ORDER = ["ADHESIVE", "PARCHMENT", "PACKING", "OTHER"]
const KIND_LABEL: Record<string, string> = { ADHESIVE: "Adhesive", PARCHMENT: "Parchment", PACKING: "Packing", OTHER: "Other" }
const KIND_TONE: Record<string, string> = {
  ADHESIVE: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line",
  PARCHMENT: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line",
  PACKING: "bg-signal-teal-soft text-signal-teal-ink ring-signal-teal-line",
  OTHER: "bg-muted text-muted-foreground ring-border",
}
const kindOf = (item: any) => {
  const type = String(item?.type || "").toUpperCase()
  if (type === "ADHESIVE" || type === "PARCHMENT") return type
  if (type === "PACKAGING" || type === "PACKING") return "PACKING"
  return "OTHER"
}

function parseInventoryQr(raw: string) {
  const parts = raw.trim().split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") return { entityType: parts[1].toUpperCase(), entityId: parts[3], code: parts[4] }
  return { entityType: "", entityId: "", code: raw.trim() }
}

/**
 * Adhesive, parchment and packing go to the floor by shift (client rule 2026-10-18).
 * Units follow the item master (client 2026-10-26): parchment by colour and kg (no coil number),
 * plastic in kg, boxes in pieces. Stock on hand shows next to every material and lot.
 */
export default function MaterialFloorIssuePage() {
  const { data: items = [] } = useInventoryItems()
  const balancesQuery = useInventoryBalances()
  const createIssue = useCreateTransaction()
  const issueParchment = useIssueParchmentByWeight()
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const [itemSearch, setItemSearch] = useState("")
  const [scan, setScan] = useState("")
  const [pendingBatch, setPendingBatch] = useState("")
  const [kind, setKind] = useState("ALL")
  const [showEach, setShowEach] = useState(false)
  const [form, setForm] = useState({ item_id: "", batch_id: "", qty: "", shift: clockShift(), effective_date: businessDate(), notes: "" })
  const balance = useInventoryItemBalance(form.item_id, Boolean(form.item_id))
  const today = useInventoryTransactions({ transaction_type: "ISSUE_PRODUCTION", date_from: businessDate(), date_to: businessDate() })
  const todayReels = useReelIssues({ date_from: businessDate(), date_to: businessDate(), limit: 300 })

  const onHand = useMemo(() => {
    const out: Record<string, number> = {}
    for (const row of Array.isArray(balancesQuery.data) ? balancesQuery.data : []) out[String(row.item_id)] = Number(row.usable_qty || 0)
    return out
  }, [balancesQuery.data])
  const allItems: any[] = useMemo(() => (Array.isArray(items) ? items : []), [items])
  const materials = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase()
    return allItems
      // Bulk materials, plus parchment colours (stored as coils, issued by kg).
      .filter((item: any) => !["FINISHED_GOOD"].includes(String(item.type || "").toUpperCase()) && (String(item.tracking_mode || "").toUpperCase() !== "REEL" || isParchment(item)))
      .filter((item: any) => !needle || `${item.item_code} ${item.name} ${item.type}`.toLowerCase().includes(needle))
  }, [allItems, itemSearch])
  const manyPlants = new Set(allItems.map((item: any) => String(item.plant_id || ""))).size > 1
  const itemFor = (id: string) => allItems.find((row: any) => String(row.id) === String(id))
  const itemName = (id: string) => { const item = itemFor(id); return item ? `${item.item_code} · ${item.name}` : "Material" }
  const selectedItem = materials.find((item: any) => String(item.id) === form.item_id)
  const parchment = isParchment(selectedItem)
  const batches = useMemo(() => (Array.isArray(balance.data?.batches) ? balance.data.batches : []).filter((batch: any) => Number(batch.available_qty ?? batch.current_balance ?? 0) > 0 && ["UNRESTRICTED", "WIP"].includes(String(batch.stock_status || "").toUpperCase())), [balance.data])
  const selectedBatch = batches.find((batch: any) => String(batch.batch_id) === form.batch_id)
  const itemOnHand = selectedItem ? (parchment ? Number(onHand[String(selectedItem.id)] || 0) : batches.reduce((sum: number, batch: any) => sum + Number(batch.available_qty ?? batch.current_balance ?? 0), 0)) : 0
  const available = selectedBatch ? Number(selectedBatch.available_qty ?? selectedBatch.current_balance ?? 0) : itemOnHand
  const issuedToday = useMemo(() => {
    const bulk = (Array.isArray(today.data) ? today.data : []).filter((row: any) => row.movement_metadata?.destination === "FLOOR").map((row: any) => ({
      key: row.transaction_id, name: itemName(row.item_id), shift: row.movement_metadata?.shift, notes: row.movement_metadata?.notes,
      qty: Math.abs(Number(row.qty_change || 0)), uom: itemFor(row.item_id)?.uom,
    }))
    const parchmentCodes = new Set(allItems.filter(isParchment).map((item: any) => String(item.item_code)))
    const parchmentIssues = (Array.isArray(todayReels.data) ? todayReels.data : []).filter((row: any) => parchmentCodes.has(String(row.paper_code || ""))).map((row: any) => ({
      key: row.id, name: `${row.paper_code} · ${row.paper_name || "Parchment"}`, shift: row.shift, notes: `from coil ${row.reel_code}`, qty: Number(row.issued_weight_kg || 0), uom: "KG",
    }))
    return [...bulk, ...parchmentIssues]
  }, [today.data, todayReels.data, allItems]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setForm((current) => ({ ...current, batch_id: "" })) }, [form.item_id])
  useEffect(() => {
    if (!pendingBatch || !batches.length) return
    const wanted = pendingBatch.toUpperCase()
    const matched = batches.find((batch: any) => [batch.batch_id, batch.batch_no, batch.inward_no, batch.grn_no].some((value) => String(value || "").toUpperCase() === wanted))
    if (matched) { setForm((current) => ({ ...current, batch_id: matched.batch_id })); setNotice({ tone: "info", text: `Lot ${matched.inward_no || matched.batch_no} selected.` }); setPendingBatch("") }
  }, [batches, pendingBatch])

  async function resolveScan() {
    const parsed = parseInventoryQr(scan)
    if (parsed.entityType && parsed.entityType !== "BATCH") return setNotice({ tone: "error", text: "Scan a batch label. Paper reels and coils are issued on the reel tab; parchment is issued here by colour and kg." })
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
    if (!selectedItem) return setNotice({ tone: "error", text: parchment ? "Choose the parchment colour." : "Choose the material." })
    if (!(qty > 0)) return setNotice({ tone: "error", text: `Enter the ${isPieces(selectedItem) ? "number of pieces" : "quantity"} going to the floor.` })
    if (isPieces(selectedItem) && !Number.isInteger(qty)) return setNotice({ tone: "error", text: `${selectedItem.name} is counted in pieces. Enter a whole number.` })
    if (qty > available + 1e-9) return setNotice({ tone: "error", text: `Only ${qtyText(available, selectedItem.uom)} of ${selectedItem.name} is in stock and cleared for issue${selectedBatch ? " in this lot" : ""}. You asked for ${qtyText(qty, selectedItem.uom)}.` })
    const before = itemOnHand
    try {
      if (parchment) {
        const { data } = await issueParchment.mutateAsync({ plantId: selectedItem.plant_id || undefined, item_id: form.item_id, qty_kg: qty, shift: form.shift, issue_date: form.effective_date, notes: form.notes.trim() || undefined })
        setNotice({ tone: "success", text: data?.message || `${qtyText(qty, "KG")} of ${selectedItem.name} issued to the floor for shift ${form.shift}.` })
      } else {
        await createIssue.mutateAsync({
          plantId: selectedItem.plant_id || undefined,
          item_id: form.item_id, batch_id: form.batch_id || undefined, qty, shift: form.shift, reason_code: "FLOOR_ISSUE",
          effective_date: form.effective_date, notes: form.notes.trim() || undefined,
          external_ref: `FLOOR:${form.effective_date}:${form.shift}:${selectedBatch?.inward_no || selectedBatch?.batch_no || "FIFO"}:${crypto.randomUUID().slice(0, 8)}`,
        })
        setNotice({ tone: "success", text: `${qtyText(qty, selectedItem.uom)} of ${selectedItem.name} issued to the floor for shift ${form.shift}. ${qtyText(Math.max(0, before - qty), selectedItem.uom)} left in stock.` })
      }
      setForm((current) => ({ ...current, batch_id: "", qty: "", notes: "" }))
      void balancesQuery.refetch(); void balance.refetch()
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  const busy = createIssue.isPending || issueParchment.isPending
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of materials) out[kindOf(item)] = (out[kindOf(item)] || 0) + 1
    return out
  }, [materials])
  const shownMaterials = useMemo(() => materials
    .filter((item: any) => kind === "ALL" || kindOf(item) === kind)
    .sort((a: any, b: any) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) || Number((onHand[String(b.id)] || 0) > 0) - Number((onHand[String(a.id)] || 0) > 0) || String(a.name).localeCompare(String(b.name))), [materials, kind, onHand])
  const inStock = materials.filter((item: any) => Number(onHand[String(item.id)] || 0) > 0).length
  const todayByItem = useMemo(() => {
    const map = new Map<string, { name: string; uom?: string; shifts: Record<string, number>; total: number; count: number }>()
    for (const row of issuedToday) {
      const bucket = map.get(row.name) || { name: row.name, uom: row.uom, shifts: {}, total: 0, count: 0 }
      const shift = String(row.shift || "—").toUpperCase()
      bucket.shifts[shift] = (bucket.shifts[shift] || 0) + row.qty
      bucket.total += row.qty
      bucket.count += 1
      map.set(row.name, bucket)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [issuedToday])
  const qtyNumber = Number(form.qty)
  const quick = selectedItem ? (isPieces(selectedItem) ? [10, 25, 50, 100] : [5, 10, 25, 50]).filter((value) => value <= available) : []
  const pick = (id: string) => { setForm((current) => ({ ...current, item_id: id, qty: "" })); setNotice(null) }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue"]}>
      <ProcurementShell eyebrow="Stores" title="Material issue to floor" description="Adhesive, parchment and packing go to the floor for a shift — not to a job card or machine. What goes to the floor is consumed in full. Parchment is issued by colour and kg, plastic in kg, boxes in pieces." actions={<IssueDeskTabs />} allPlants>
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        <div className="grid gap-3 sm:grid-cols-3" data-testid="material-issue-stats">
          <StatTile label="Materials in stock" value={String(inStock)} hint={`of ${materials.length} adhesive, parchment and packing items`} />
          <StatTile label="Issued today" value={String(issuedToday.length)} hint={todayByItem.length ? `${todayByItem.length} material${todayByItem.length === 1 ? "" : "s"}` : "nothing yet"} />
          <StatTile label="Out of stock" value={String(materials.length - inStock)} hint="inward or pass incoming QC to issue" tone={materials.length - inStock ? "amber" : undefined} />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <WorkPanel title="1 · Pick the material" description="Tap a material, or scan the lot label (Amigo inward number). Only stock that passed incoming QC is counted.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-input px-3"><Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Scan lot label" className="h-9 w-full bg-transparent text-[13px] outline-none" value={scan} placeholder="Scan lot QR or type Amigo inward number" onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveScan() } }} /></label>
              <button type="button" className={secondaryButton} onClick={() => void resolveScan()}><PackageCheck className="h-4 w-4" />Find lot</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="w-full bg-transparent text-[13px] outline-none" aria-label="Find material" placeholder="Find adhesive, parchment colour, plastic, box…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} /></label>
              <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                {(["ALL", ...KIND_ORDER] as string[]).filter((key) => key === "ALL" || kindCounts[key]).map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={kind === key} onClick={() => setKind(key)} className={cn("h-7 rounded-md px-2.5 text-[12.5px] font-semibold", kind === key ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                    {key === "ALL" ? "All" : KIND_LABEL[key]} <span className="tabular-nums text-muted-foreground">{key === "ALL" ? materials.length : kindCounts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Material" data-testid="floor-issue-material">
              {shownMaterials.map((item: any) => {
                const stock = Number(onHand[String(item.id)] || 0)
                const chosen = String(item.id) === form.item_id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={stock <= 0}
                    onClick={() => pick(String(item.id))}
                    data-testid={`floor-issue-material-${item.item_code}`}
                    className={cn(
                      "flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left transition",
                      chosen ? "border-primary bg-primary/[.06] ring-2 ring-primary/25" : "border-border bg-card hover:border-foreground/25 hover:bg-muted/40",
                      stock <= 0 && "cursor-not-allowed opacity-55 hover:border-border hover:bg-card",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-foreground" title={item.name}>{item.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{manyPlants ? `${displayPlantScope(item.plant_id)} · ` : ""}{item.item_code}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset", KIND_TONE[kindOf(item)])}>{KIND_LABEL[kindOf(item)]}</span>
                    </span>
                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      <span className={cn("text-[15px] font-semibold tabular-nums", stock > 0 ? "text-foreground" : "text-signal-amber-ink")}>{stock > 0 ? qtyText(stock, item.uom) : "None in stock"}</span>
                      <span className="text-[11px] text-muted-foreground">{isParchment(item) ? "by colour · kg" : isPieces(item) ? "pieces" : unitText(item.uom)}</span>
                    </span>
                  </button>
                )
              })}
              {!shownMaterials.length ? <p className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground sm:col-span-2">No material matches. Clear the search or pick another kind.</p> : null}
            </div>
          </WorkPanel>

          <div className="xl:sticky xl:top-4">
            <WorkPanel title="2 · Issue to the floor" description={selectedItem ? "Oldest lot goes first unless you choose one." : "Pick a material on the left first."}>
              {selectedItem ? (
                <form onSubmit={submit} className="grid gap-3" data-testid="floor-issue-form">
                  <div data-testid="floor-issue-on-hand" className={cn("rounded-xl border px-3 py-2.5", itemOnHand > 0 ? "border-border bg-muted/50" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")}>
                    <p className="text-[14px] font-semibold text-foreground">{selectedItem.name}</p>
                    <p className="text-[12.5px] text-muted-foreground">{selectedItem.item_code}{manyPlants ? ` · ${displayPlantScope(selectedItem.plant_id)}` : ""}</p>
                    <p className="mt-1.5 text-[13px]">Cleared for issue: <strong className="tabular-nums">{qtyText(itemOnHand, selectedItem.uom)}</strong>{parchment ? " · all coils of this colour, oldest first" : batches.length ? ` in ${batches.length} lot${batches.length === 1 ? "" : "s"}` : ""}</p>
                  </div>
                  {parchment ? null : (
                    <Field label="Lot (Amigo inward no.)" hint="optional">
                      <select aria-label="Lot" className={fieldClass} value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}>
                        <option value="">Oldest lot first</option>
                        {batches.map((batch: any) => <option key={batch.batch_id} value={batch.batch_id}>{batch.inward_no || batch.grn_no || batch.batch_no} · {qtyText(batch.available_qty ?? batch.current_balance, selectedItem?.uom)} on hand</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label={`Quantity · ${isPieces(selectedItem) ? "pieces" : unitText(selectedItem.uom)}`} hint={`${qtyText(available, selectedItem.uom)} available`}>
                    <input aria-label="Quantity" data-testid="floor-issue-qty" className={cn(fieldClass, "h-11 text-[16px] font-semibold tabular-nums")} type="number" min={isPieces(selectedItem) ? "1" : "0.001"} step={isPieces(selectedItem) ? "1" : "0.001"} inputMode={isPieces(selectedItem) ? "numeric" : "decimal"} value={form.qty} placeholder="0" onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                  {quick.length ? (
                    <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Quick quantity">
                      {quick.map((value) => <button key={value} type="button" onClick={() => setForm({ ...form, qty: String(value) })} className={cn("h-7 rounded-full border px-3 text-[12px] font-semibold tabular-nums", qtyNumber === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{qtyText(value, selectedItem.uom)}</button>)}
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <Field label="Shift">
                      <div role="radiogroup" aria-label="Shift" className="flex gap-1 rounded-lg bg-muted p-1">
                        {SHIFTS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={form.shift === item.value} onClick={() => setForm({ ...form, shift: item.value })} className={cn("min-h-8 flex-1 rounded-md text-[13px] font-semibold", form.shift === item.value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{item.label}</button>)}
                      </div>
                    </Field>
                    <Field label="Issue date"><input className={fieldClass} type="date" value={form.effective_date} max={businessDate()} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
                  </div>
                  <Field label="Note" hint="optional"><input className={fieldClass} value={form.notes} placeholder="e.g. for the night shift" onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
                  <button type="submit" data-testid="floor-issue-submit" className={cn(primaryButton, "h-11 justify-center text-[14px]")} disabled={busy || !(qtyNumber > 0)}>
                    <PackageCheck className="h-4 w-4" />
                    {busy ? "Issuing…" : qtyNumber > 0 ? `Issue ${qtyText(qtyNumber, selectedItem.uom)} to floor · ${form.shift === "GENERAL" ? "general shift" : `shift ${form.shift}`}` : "Enter the quantity"}
                  </button>
                </form>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-5 text-center text-[13px] text-muted-foreground">
                  <PackageCheck className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                  Tap a material that has stock, or scan its lot label. The quantity, shift and date come next.
                </div>
              )}
            </WorkPanel>
          </div>
        </div>

        <WorkPanel title={`Issued to the floor today · ${issuedToday.length}`} description="Today's business date, by material and shift. Parchment shows the coil it came from.">
          {todayByItem.length ? (
            <div className="overflow-x-auto" data-testid="floor-issue-today">
              <table className="tube-grid w-full min-w-[560px] !text-[13px]">
                <thead><tr><th>Material</th><th className="num">Shift A</th><th className="num">Shift B</th><th className="num">General</th><th className="num">Total today</th></tr></thead>
                <tbody>
                  {todayByItem.map((row) => (
                    <tr key={row.name}>
                      <td><span className="font-medium">{row.name}</span><span className="block text-[11.5px] text-muted-foreground">{row.count} issue{row.count === 1 ? "" : "s"}</span></td>
                      {["A", "B", "GENERAL"].map((shift) => <td key={shift} className="num tabular-nums">{row.shifts[shift] ? qtyText(row.shifts[shift], row.uom) : "—"}</td>)}
                      <td className="num font-semibold tabular-nums">{qtyText(row.total, row.uom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="mt-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setShowEach((value) => !value)}>{showEach ? "Hide each issue" : `Show each issue (${issuedToday.length})`}</button>
              {showEach ? (
                <ul className="mt-1 divide-y divide-border">
                  {issuedToday.map((row) => (
                    <li key={row.key} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="min-w-0 truncate"><span className="font-medium">{row.name}</span><span className="text-muted-foreground"> · shift {row.shift || "—"}{row.notes ? ` · ${row.notes}` : ""}</span></span>
                      <span className="shrink-0 font-semibold tabular-nums">{qtyText(row.qty, row.uom)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : <p className="text-sm text-muted-foreground">Nothing issued to the floor yet today.</p>}
        </WorkPanel>
      </ProcurementShell>
    </RoleGate>
  )
}

function StatTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "amber" }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3", tone === "amber" ? "border-signal-amber-line" : "border-border")}>
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-[22px] font-semibold tabular-nums", tone === "amber" ? "text-signal-amber-ink" : "text-foreground")}>{value}</p>
      <p className="truncate text-[11.5px] text-muted-foreground">{hint}</p>
    </div>
  )
}
