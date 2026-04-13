"use client"

import { useInventoryValuation } from "@/hooks/use-analytics"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"

export default function InventoryAnalyticsPage() {
  const { plantId } = useAnalyticsContext()
  const { data, isLoading } = useInventoryValuation(plantId)

  if (isLoading) return <div className="p-8 text-slate-500">Loading inventory data...</div>

  const colors = ['#0ea5e9', '#f59e0b', '#10b981', '#6366f1', '#8b5cf6']

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Valuation Summary */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
          <h3 className="font-semibold text-slate-800 self-start w-full">Current Stock Breakdown</h3>
          <p className="text-3xl font-bold mt-4">{data?.total_value?.toLocaleString()} kg</p>
          <p className="text-sm text-slate-500 mb-6">Total Warehouse Value</p>
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.breakdown || []}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  nameKey="type"
                >
                  {(data?.breakdown || []).map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 mt-4 justify-center">
            {(data?.breakdown || []).map((b: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }}></div>
                {b.type}: <span className="font-medium">{b.value.toLocaleString()} kg</span>
              </div>
            ))}
          </div>
        </div>

        {/* Item List Component could go here. Omitted for brevity. */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <h3 className="font-semibold text-slate-800 mb-4">Stock Ledger Focus</h3>
          <p className="text-sm text-slate-500 mb-4">Fast-moving vs Dead Stock analysis to be integrated here based on movement velocity snapshots.</p>
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-600">Item</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Type</th>
                  <th className="px-3 py-2 font-semibold text-right text-slate-600">Stock (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.items || []).slice(0, 15).map((s: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-700">{s.name}</td>
                    <td className="px-3 py-2 text-slate-500">{s.type}</td>
                    <td className="px-3 py-2 text-right">{s.available_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
