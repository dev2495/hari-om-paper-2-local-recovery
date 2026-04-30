"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight, ClipboardList, MapPin, PackageSearch, Search } from "lucide-react"

import { useInventoryBalances, useInventoryLocationOccupancy, useInventoryTransactions } from "@/hooks/use-inventory"

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
  const balancesQuery = useInventoryBalances()
  const transactionsQuery = useInventoryTransactions()
  const occupancyQuery = useInventoryLocationOccupancy()
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
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-950 via-cyan-950 to-slate-800 p-6 text-white shadow-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">Inventory audit</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em]">Ledger, balances, and location truth</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-50/80">
              Physical, reserved, available, and transaction movement stay on one page so stores can audit stock without jumping between screens.
            </p>
          </div>
          <Link href="/inventory/stock-control" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">
            Stock close <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {isLoading ? <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm text-cyan-50">Loading live inventory ledger...</p> : null}
        {isError ? <p className="mt-4 rounded-2xl border border-rose-300/40 bg-rose-500/20 px-4 py-3 text-sm text-rose-50">Some inventory services failed. Showing whatever data loaded successfully.</p> : null}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Physical", value: totalPhysical, detail: "Book stock before reservations", icon: PackageSearch },
          { label: "Reserved", value: totalReserved, detail: "Committed against sales/dispatch", icon: ClipboardList },
          { label: "Available", value: totalAvailable, detail: "Free-to-issue balance", icon: MapPin },
        ].map((card) => (
          <div key={card.label} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{formatNumber(card.value)}</p>
                <p className="mt-1 text-xs text-slate-500">{card.detail}</p>
              </div>
              <div className="rounded-2xl bg-cyan-950 p-3 text-white">
                <card.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <h2 className="text-lg font-semibold text-slate-950">Inventory balances</h2>
          <p className="mt-1 text-sm text-slate-500">Opening + receipts - issues - reservations, by item master.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={balanceSearch}
                onChange={(event) => setBalanceSearch(event.target.value)}
                placeholder="Search item, code, type..."
                className="w-56 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
            >
              <option value="ALL">All types</option>
              <option value="RAW_PAPER">Raw paper</option>
              <option value="ADHESIVE">Adhesive</option>
              <option value="PARCHMENT">Parchment</option>
              <option value="PACKING">Packing</option>
              <option value="FINISHED_GOOD">Finished goods</option>
            </select>
          </div>
          <div className="mt-4 max-h-[460px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                <tr>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 text-right">Physical</th>
                  <th className="px-3 py-3 text-right">Reserved</th>
                  <th className="px-3 py-3 text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredBalances.map((item: any) => (
                  <tr key={item.item_id || item.id}>
                    <td className="px-3 py-3 font-semibold text-slate-900">{item.item_code}</td>
                    <td className="px-3 py-3 text-slate-700">{item.name || item.item_name}</td>
                    <td className="px-3 py-3 text-slate-500">{item.type}</td>
                    <td className="px-3 py-3 text-right font-semibold">{formatNumber(item.balance || item.qty_on_hand)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(item.reserved_qty)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-cyan-900">{formatNumber(item.available_qty)}</td>
                  </tr>
                ))}
                {!filteredBalances.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No item balances matched this filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <h2 className="text-lg font-semibold text-slate-950">Location-wise items</h2>
          <p className="mt-1 text-sm text-slate-500">Bin-level load for quick store audit and physical count prep.</p>
          <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {locationItemRows.slice(0, 18).map((row: any, index: number) => (
              <div key={`${row.location_code}-${row.item_id || row.item_code || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{row.item_code} · {row.item_name}</p>
                    <p className="text-xs text-slate-500">{row.location_code} · {row.warehouse} · {row.purpose}</p>
                  </div>
                  <div className="text-right text-xs font-semibold text-slate-800">
                    <p>{formatNumber(row.weight_kg)} kg</p>
                    <p>{formatNumber(row.qty)} qty</p>
                  </div>
                </div>
              </div>
            ))}
            {!locationItemRows.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Post inward with location to build bin-level balances.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Recent transactions</h2>
            <p className="text-sm text-slate-500">Search movement type, reference, batch, external ref, or item.</p>
          </div>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={txnSearch}
              onChange={(event) => setTxnSearch(event.target.value)}
              placeholder="Search ledger..."
              className="w-56 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Qty Change</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">External Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredTransactions.map((txn: any, index: number) => (
                <tr key={txn.transaction_id || txn.id || `${txn.reference || "txn"}-${index}`}>
                  <td className="px-3 py-3 text-slate-600">{formatDateTime(txn.date)}</td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{txn.type || txn.transaction_type}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(txn.qty_change ?? txn.quantity)}</td>
                  <td className="px-3 py-3">{txn.stock_status || "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{txn.reference || "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{txn.external_ref || "-"}</td>
                </tr>
              ))}
              {!filteredTransactions.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No ledger movement matched this filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
