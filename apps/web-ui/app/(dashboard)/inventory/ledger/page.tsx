"use client"

import { useInventoryBalances, useInventoryTransactions } from "@/hooks/use-inventory"

export default function InventoryLedgerPage() {
  const { data: balances } = useInventoryBalances()
  const { data: transactions } = useInventoryTransactions()

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl border border-white/60 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold">Inventory Balances</h1>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Code</th>
                <th className="py-2">Item</th>
                <th className="py-2">Type</th>
                <th className="py-2">Physical</th>
                <th className="py-2">Reserved</th>
                <th className="py-2">Available</th>
              </tr>
            </thead>
            <tbody>
              {(balances || []).map((item: any) => (
                <tr key={item.item_id} className="border-b border-slate-100">
                  <td className="py-2">{item.item_code}</td>
                  <td className="py-2">{item.name}</td>
                  <td className="py-2">{item.type}</td>
                  <td className="py-2">{item.balance}</td>
                  <td className="py-2">{item.reserved_qty}</td>
                  <td className="py-2">{item.available_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Recent Transactions</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Date</th>
                <th className="py-2">Type</th>
                <th className="py-2">Qty Change</th>
                <th className="py-2">Reference</th>
                <th className="py-2">External Ref</th>
              </tr>
            </thead>
            <tbody>
              {(transactions || []).map((txn: any) => (
                <tr key={txn.transaction_id} className="border-b border-slate-100">
                  <td className="py-2">{new Date(txn.date).toLocaleString()}</td>
                  <td className="py-2">{txn.type}</td>
                  <td className="py-2">{txn.qty_change}</td>
                  <td className="py-2">{txn.reference}</td>
                  <td className="py-2">{txn.external_ref || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
