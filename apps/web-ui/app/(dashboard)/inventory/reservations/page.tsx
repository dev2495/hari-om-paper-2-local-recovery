"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, LockKeyhole, PackageCheck, RotateCcw } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { usePlants } from "@/hooks/use-system"
import { inventoryApi, salesApi } from "@/lib/api"

const errorText = (error: any) => {
  const detail = error?.response?.data?.detail || error?.message
  return typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "The reservation operation failed."
}

export default function InventoryReservationsPage() {
  const queryClient = useQueryClient()
  const { activePlant, setActivePlant } = useAuth()
  const { data: plants = [] } = usePlants()
  const concretePlant = Boolean(activePlant && activePlant.toUpperCase() !== "ALL")
  const { data: itemsData = [] } = useInventoryItems()
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const [form, setForm] = useState({ line_key: "", item_id: "", batch_id: "", qty: "" })

  const ordersQuery = useQuery({
    queryKey: ["reservation-sales-orders", activePlant],
    queryFn: async () => {
      const { data } = await salesApi.getOrders({ status_group: "open", limit: 500 })
      return Array.isArray(data) ? data : []
    },
    enabled: concretePlant,
  })
  const reservationsQuery = useQuery({
    queryKey: ["inventory-reservations", activePlant],
    queryFn: async () => {
      const { data } = await inventoryApi.getReservations({ limit: 500 })
      return Array.isArray(data) ? data : []
    },
    enabled: concretePlant,
  })

  const lineOptions = useMemo(
    () => (ordersQuery.data || []).flatMap((order: any) =>
      (order.lines || [])
        .filter((line: any) => Number(line.released_qty || 0) > 0 && Number(line.remaining_qty || 0) > 0)
        .map((line: any) => ({
          key: `${order.id}:${line.id}`,
          order_id: order.id,
          order_no: order.order_no,
          line_id: line.id,
          line_no: line.line_no,
          product_code: line.product_code,
          spec_id: line.approved_spec_id,
          remaining_qty: Number(line.remaining_qty || 0),
        })),
    ),
    [ordersQuery.data],
  )
  const selectedLine = lineOptions.find((line: any) => line.key === form.line_key)
  const finishedGoods = useMemo(
    () => (Array.isArray(itemsData) ? itemsData : []).filter((item: any) => String(item.type || "").toUpperCase() === "FINISHED_GOOD"),
    [itemsData],
  )
  const eligibleItems = useMemo(
    () => selectedLine
      ? finishedGoods.filter((item: any) => !item.spec_id || String(item.spec_id) === String(selectedLine.spec_id))
      : finishedGoods,
    [finishedGoods, selectedLine],
  )

  useEffect(() => {
    if (!selectedLine) return
    const exactItem = finishedGoods.find((item: any) => String(item.spec_id || "") === String(selectedLine.spec_id || ""))
    setForm((current) => ({
      ...current,
      item_id: exactItem?.id || (eligibleItems.length === 1 ? eligibleItems[0].id : current.item_id),
      batch_id: "",
      qty: current.qty && Number(current.qty) <= selectedLine.remaining_qty ? current.qty : String(selectedLine.remaining_qty),
    }))
  }, [form.line_key, selectedLine, finishedGoods, eligibleItems])

  const lotsQuery = useQuery({
    queryKey: ["reservation-lots", activePlant, form.item_id, selectedLine?.spec_id || ""],
    queryFn: async () => {
      const { data } = await inventoryApi.getLotAvailability(form.item_id, selectedLine?.spec_id)
      return Array.isArray(data?.lots) ? data.lots : []
    },
    enabled: concretePlant && Boolean(form.item_id),
  })
  const availableLots = (lotsQuery.data || []).filter((lot: any) => Number(lot.available_qty || 0) > 0)
  const selectedLot = availableLots.find((lot: any) => String(lot.batch_id) === form.batch_id)

  const createReservation = useMutation({
    mutationFn: async () => {
      if (!selectedLine || !form.item_id || !selectedLot) throw new Error("Select a released sales line, finished-good item, and available lot.")
      const qty = Number(form.qty)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Reservation quantity must be greater than zero.")
      if (qty > selectedLine.remaining_qty) throw new Error(`Quantity exceeds sales-line remaining quantity (${selectedLine.remaining_qty}).`)
      if (qty > Number(selectedLot.available_qty || 0)) throw new Error(`Quantity exceeds lot availability (${selectedLot.available_qty}).`)
      return inventoryApi.createReservation({
        sales_order_id: selectedLine.order_id,
        sales_order_line_id: selectedLine.line_id,
        item_id: form.item_id,
        batch_id: form.batch_id,
        spec_id: selectedLine.spec_id,
        qty,
      })
    },
    onSuccess: () => {
      setMessage({ tone: "success", text: "Finished goods reserved against the selected sales-order line and lot." })
      setForm({ line_key: "", item_id: "", batch_id: "", qty: "" })
      queryClient.invalidateQueries({ queryKey: ["inventory-reservations"] })
      queryClient.invalidateQueries({ queryKey: ["reservation-lots"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
    onError: (error) => setMessage({ tone: "error", text: errorText(error) }),
  })
  const releaseReservation = useMutation({
    mutationFn: (id: string) => inventoryApi.releaseReservation(id),
    onSuccess: () => {
      setMessage({ tone: "success", text: "Reservation released and stock availability restored." })
      queryClient.invalidateQueries({ queryKey: ["inventory-reservations"] })
      queryClient.invalidateQueries({ queryKey: ["reservation-lots"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
    },
    onError: (error) => setMessage({ tone: "error", text: errorText(error) }),
  })

  if (!concretePlant) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-cyan-200 bg-cyan-50 p-6">
        <LockKeyhole className="h-7 w-7 text-cyan-800" />
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Select one plant to manage reservations</h1>
        <p className="mt-2 text-sm text-slate-700">Reservations change dispatchable stock and therefore cannot be posted in the global reporting scope.</p>
        <select className="mt-5 h-11 w-full rounded-xl border border-cyan-200 bg-white px-3" value="" onChange={(event) => { if (event.target.value) { setActivePlant(event.target.value); window.location.reload() } }}>
          <option value="">Select plant</option>
          {plants.filter((plant: any) => plant.is_active !== false).map((plant: any) => <option key={plant.id} value={plant.id}>{plant.code} · {plant.name}</option>)}
        </select>
      </section>
    )
  }

  const reservations = reservationsQuery.data || []
  const activeCount = reservations.filter((row: any) => row.status === "ACTIVE").length
  const reservedQty = reservations.filter((row: any) => row.status === "ACTIVE").reduce((sum: number, row: any) => sum + Number(row.remaining_qty || 0), 0)

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <section className="rounded-3xl bg-slate-950 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Finished-goods allocation</p>
        <h1 className="mt-2 text-2xl font-semibold">Reserve real stock against released customer demand</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">Each reservation is tied to a sales-order line, approved specification, finished-good item, and physical lot. Dispatch consumes the matching reservation automatically.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-3 py-1.5">Active reservations: {activeCount}</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">Protected quantity: {reservedQty.toLocaleString("en-IN")}</span>
        </div>
      </section>

      {message ? <div className={`rounded-2xl border px-4 py-3 text-sm ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{message.text}</div> : null}

      <section className="grid min-w-0 gap-4 lg:grid-cols-[0.9fr_1.1fr] [&>*]:min-w-0">
        <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5" onSubmit={(event) => { event.preventDefault(); setMessage(null); createReservation.mutate() }}>
          <div>
            <h2 className="font-semibold text-slate-950">Create reservation</h2>
            <p className="mt-1 text-sm text-slate-500">Only released lines with remaining customer quantity are available.</p>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Released sales-order line</span>
            <select required className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3" value={form.line_key} onChange={(event) => setForm((current) => ({ ...current, line_key: event.target.value }))}>
              <option value="">Select line</option>
              {lineOptions.map((line: any) => <option key={line.key} value={line.key}>{line.order_no} · line {line.line_no} · {line.product_code || line.spec_id} · remaining {line.remaining_qty}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Finished-good item</span>
            <select required disabled={!selectedLine} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 disabled:bg-slate-100" value={form.item_id} onChange={(event) => setForm((current) => ({ ...current, item_id: event.target.value, batch_id: "" }))}>
              <option value="">Select item</option>
              {eligibleItems.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Available physical lot</span>
            <select required disabled={!form.item_id} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 disabled:bg-slate-100" value={form.batch_id} onChange={(event) => setForm((current) => ({ ...current, batch_id: event.target.value }))}>
              <option value="">Select lot</option>
              {availableLots.map((lot: any) => <option key={lot.batch_id} value={lot.batch_id}>{lot.batch_no} · available {lot.available_qty} · already reserved {lot.reserved_qty}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Quantity</span>
            <input required type="number" min="0.001" step="0.001" max={Math.min(selectedLine?.remaining_qty || Number.MAX_SAFE_INTEGER, Number(selectedLot?.available_qty || Number.MAX_SAFE_INTEGER))} className="h-11 w-full rounded-xl border border-slate-200 px-3" value={form.qty} onChange={(event) => setForm((current) => ({ ...current, qty: event.target.value }))} />
          </label>
          <button type="submit" disabled={createReservation.isPending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 font-semibold text-white disabled:opacity-50"><PackageCheck className="h-4 w-4" />{createReservation.isPending ? "Reserving…" : "Reserve stock"}</button>
        </form>

        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-semibold text-slate-950">Reservation ledger</h2><p className="mt-1 text-sm text-slate-500">Active, consumed, and released allocations.</p></div>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-4 space-y-3">
            {reservationsQuery.isLoading ? <p className="text-sm text-slate-500">Loading reservation ledger…</p> : null}
            {!reservationsQuery.isLoading && reservations.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No reservations have been posted for this plant.</p> : null}
            {reservations.map((row: any) => {
              const item = finishedGoods.find((candidate: any) => String(candidate.id) === String(row.item_id))
              return (
                <article key={row.id} className="min-w-0 rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{item ? `${item.item_code} · ${item.name}` : row.item_id}</p><p className="mt-1 break-all text-xs text-slate-500">Sales line {row.sales_order_line_id}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.status === "ACTIVE" ? "bg-cyan-50 text-cyan-800" : row.status === "CONSUMED" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{row.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><p className="text-slate-500">Reserved</p><p className="font-semibold">{row.reserved_qty}</p></div><div><p className="text-slate-500">Consumed</p><p className="font-semibold">{row.consumed_qty}</p></div><div><p className="text-slate-500">Remaining</p><p className="font-semibold">{row.remaining_qty}</p></div></div>
                  {row.status === "ACTIVE" && Number(row.consumed_qty || 0) === 0 ? <button type="button" onClick={() => releaseReservation.mutate(row.id)} disabled={releaseReservation.isPending} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700"><RotateCcw className="h-3.5 w-3.5" />Release reservation</button> : null}
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
