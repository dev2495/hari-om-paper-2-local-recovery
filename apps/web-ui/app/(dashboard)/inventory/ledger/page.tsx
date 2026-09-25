"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo, useState, useEffect } from "react"
import { ArrowLeft, ArrowRight, ClipboardList, MapPin, PackageSearch, Search, Workflow } from "lucide-react"

import { useInventoryBalances, useInventoryLocationOccupancy, useInventoryTransactions, useInventoryItems } from "@/hooks/use-inventory"

const formatNumber = (value: unknown, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

function formatDateTime(value: unknown) {
  if (!value) return "-"
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("en-GB")
}

function normalizeRows(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw?.items) ? raw.items : []
}

export default function InventoryLedgerPage() {
  const search = useSearchParams()
  const drillItemId = search?.get("item_id") || undefined
  const drillStart = search?.get("start") || undefined
  const drillEnd = search?.get("end") || undefined
  const drillFrom = search?.get("from") || undefined

  const balancesQuery = useInventoryBalances()
  const transactionsQuery = useInventoryTransactions(
    drillItemId
      ? {
          item_id: drillItemId,
          date_from: drillStart || undefined,
          date_to: drillEnd || undefined,
        }
      : undefined,
  )
  const occupancyQuery = useInventoryLocationOccupancy()
  const itemsQuery = useInventoryItems()
  const drillItem = useMemo(() => {
    if (!drillItemId) return null
    const items = Array.isArray(itemsQuery.data) ? itemsQuery.data : []
    return items.find((it: any) => String(it.id) === drillItemId) || null
  }, [itemsQuery.data, drillItemId])
  const { data: balancesRaw } = balancesQuery
  const { data: transactionsRaw } = transactionsQuery
  const { data: occupancyRaw } = occupancyQuery

  const balances = normalizeRows(balancesRaw)
  const transactions = normalizeRows(transactionsRaw)
  const locationRows = normalizeRows(occupancyRaw)
  const [balanceSearch, setBalanceSearch] = useState("")
  const [txnSearch, setTxnSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("ALL")
  const locationItemRows = locationRows.flatMap((location: any) =>
    (Array.isArray(location.items) ? location.items : []).map((item: any) => ({
      ...item,
      location_code: location.code,
      warehouse: location.warehouse,
      purpose: location.purpose,
    })),
  )

  const totalPhysical = balances.reduce((sum: number, item: any) => sum + Number(item.balance || item.qty_on_hand || 0), 0)
  const totalReserved = balances.reduce((sum: number, item: any) => sum + Number(item.reserved_qty || 0), 0)
  const totalAvailable = balances.reduce((sum: number, item: any) => sum + Number(item.available_qty || 0), 0)
  const filteredBalances = useMemo(() => {
    const needle = balanceSearch.trim().toLowerCase()
    return balances.filter((item: any) => {
      if (typeFilter !== "ALL" && String(item.type || "").toUpperCase() !== typeFilter) return false
      if (!needle) return true
      return [item.item_code, item.name, item.item_name, item.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [balances, balanceSearch, typeFilter])
  const filteredTransactions = useMemo(() => {
    const needle = txnSearch.trim().toLowerCase()
    if (!needle) return transactions
    return transactions.filter((txn: any) =>
      [txn.date, txn.type, txn.transaction_type, txn.stock_status, txn.reference, txn.external_ref, txn.item_code, txn.item_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [transactions, txnSearch])
  const isLoading = balancesQuery.isLoading || transactionsQuery.isLoading || occupancyQuery.isLoading
  const isError = balancesQuery.isError || transactionsQuery.isError || occupancyQuery.isError

  return (
    <div className="space-y-5">
      {drillItemId ? (
        <section className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-signal-cyan-line bg-signal-cyan-soft px-4 py-3 text-sm font-semibold text-signal-cyan-ink shadow-sm">
          <Workflow className="h-4 w-4" />
          Drill view ·{" "}
          <span className="font-mono font-bold text-signal-cyan-ink">
            {drillItem?.item_code || drillItemId}
          </span>
          {drillItem?.name ? ` · ${drillItem.name}` : null}
          {drillStart && drillEnd ? (
            <span className="text-signal-cyan-ink">
              · {drillStart} → {drillEnd}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] uppercase tracking-[0.12em] text-signal-cyan-ink">
            {transactions.length} txn(s)
          </span>
          {drillFrom ? (
            <Link
              href={drillFrom === "reconciliation" ? "/production/reconciliation" : `/${drillFrom}`}
              className="inline-flex items-center gap-1 rounded-full border border-signal-cyan-ink/40 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-signal-cyan-ink hover:bg-card"
            >
              <ArrowLeft className="h-3 w-3" /> Back to {drillFrom}
            </Link>
          ) : (
            <Link
              href="/inventory/ledger"
              className="inline-flex items-center gap-1 rounded-full border border-signal-cyan-ink/40 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-signal-cyan-ink hover:bg-card"
            >
              Clear drill <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </section>
      ) : null}
      <section className="rounded-[2rem] border border-border bg-gradient-to-br from-foreground via-cyan-950 to-foreground p-6 text-white shadow-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">Inventory audit</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em]">Ledger, balances, and location truth</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Physical, reserved, available, and transaction movement stay on one page so stores can audit stock without jumping between screens.
            </p>
          </div>
          <Link href="/inventory/stock-control" className="inline-flex items-center gap-2 rounded-full border border-border/20 bg-card/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-card/20">
            Stock close <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {isLoading ? <p className="mt-4 rounded-2xl bg-card/10 px-4 py-3 text-sm text-muted-foreground">Loading live inventory ledger...</p> : null}
        {isError ? <p className="mt-4 rounded-2xl border border-signal-rose-line/40 bg-rose-500/20 px-4 py-3 text-sm text-muted-foreground">Some inventory services failed. Showing whatever data loaded successfully.</p> : null}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Physical", value: totalPhysical, detail: "Book stock before reservations", icon: PackageSearch },
          { label: "Reserved", value: totalReserved, detail: "Committed against sales/dispatch", icon: ClipboardList },
          { label: "Available", value: totalAvailable, detail: "Free-to-issue balance", icon: MapPin },
        ].map((card) => (
          <div key={card.label} className="rounded-[1.5rem] border border-border bg-card p-4 shadow-lg shadow-slate-900/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{formatNumber(card.value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
              </div>
              <div className="rounded-2xl bg-primary p-3 text-primary-foreground">
                <card.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <h2 className="text-lg font-semibold text-foreground">Inventory balances</h2>
          <p className="mt-1 text-sm text-muted-foreground">Opening + receipts - issues - reservations, by item master.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex h-11 items-center gap-2 rounded-2xl border border-border bg-card px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={balanceSearch}
                onChange={(event) => setBalanceSearch(event.target.value)}
                placeholder="Search item, code, type..."
                className="w-56 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-11 rounded-2xl border border-border bg-card px-3 text-sm font-semibold text-muted-foreground"
            >
              <option value="ALL">All types</option>
              <option value="RAW_PAPER">Raw paper</option>
              <option value="ADHESIVE">Adhesive</option>
              <option value="PARCHMENT">Parchment</option>
              <option value="PACKING">Packing</option>
              <option value="FINISHED_GOOD">Finished goods</option>
            </select>
          </div>
          <div className="mt-4 max-h-[460px] overflow-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[hsl(var(--surface-2))] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 text-right">Physical</th>
                  <th className="px-3 py-3 text-right">Reserved</th>
                  <th className="px-3 py-3 text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredBalances.map((item: any) => (
                  <tr key={item.item_id || item.id}>
                    <td className="px-3 py-3 font-semibold text-foreground">{item.item_code}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.name || item.item_name}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.type}</td>
                    <td className="px-3 py-3 text-right font-semibold">{formatNumber(item.balance || item.qty_on_hand)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(item.reserved_qty)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-signal-cyan-ink">{formatNumber(item.available_qty)}</td>
                  </tr>
                ))}
                {!filteredBalances.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No item balances matched this filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <h2 className="text-lg font-semibold text-foreground">Location-wise items</h2>
          <p className="mt-1 text-sm text-muted-foreground">Bin-level load for quick store audit and physical count prep.</p>
          <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {locationItemRows.slice(0, 18).map((row: any, index: number) => (
              <div key={`${row.location_code}-${row.item_id || row.item_code || index}`} className="rounded-2xl border border-border bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{row.item_code} · {row.item_name}</p>
                    <p className="text-xs text-muted-foreground">{row.location_code} · {row.warehouse} · {row.purpose}</p>
                  </div>
                  <div className="text-right text-xs font-semibold text-foreground">
                    <p>{formatNumber(row.weight_kg)} kg</p>
                    <p>{formatNumber(row.qty)} qty</p>
                  </div>
                </div>
              </div>
            ))}
            {!locationItemRows.length ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Post inward with location to build bin-level balances.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recent transactions</h2>
            <p className="text-sm text-muted-foreground">Search movement type, reference, batch, external ref, or item.</p>
          </div>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-border bg-card px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={txnSearch}
              onChange={(event) => setTxnSearch(event.target.value)}
              placeholder="Search ledger..."
              className="w-56 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="mt-4 overflow-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Qty Change</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">External Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTransactions.map((txn: any, index: number) => (
                <tr key={txn.transaction_id || txn.id || `${txn.reference || "txn"}-${index}`}>
                  <td className="px-3 py-3 text-muted-foreground">{formatDateTime(txn.date)}</td>
                  <td className="px-3 py-3 font-semibold text-foreground">{txn.type || txn.transaction_type}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(txn.qty_change ?? txn.quantity)}</td>
                  <td className="px-3 py-3">{txn.stock_status || "-"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{txn.reference || "-"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{txn.external_ref || "-"}</td>
                </tr>
              ))}
              {!filteredTransactions.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No ledger movement matched this filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
