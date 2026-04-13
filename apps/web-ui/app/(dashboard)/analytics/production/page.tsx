"use client"

import { useProductionTrends, useShrinkAnalysis, useScrapAnalysis } from "@/hooks/use-analytics"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

export default function ProductionAnalyticsPage() {
  const { startDate, endDate, plantId } = useAnalyticsContext()

  const { data: trends, isLoading: load1 } = useProductionTrends(startDate, endDate, plantId)
  const { data: shrink, isLoading: load2 } = useShrinkAnalysis(startDate, endDate, plantId)
  const { data: scrap, isLoading: load3 } = useScrapAnalysis(startDate, endDate, plantId)

  if (load1 || load2 || load3) return <div className="p-8 text-slate-500">Loading production metrics...</div>

  // Aggregate shrink daily
  const dailyShrink = (shrink || []).reduce((acc: any, row: any) => {
    if (!acc[row.date]) acc[row.date] = { date: row.date, in: 0, out: 0 }
    acc[row.date].in += row.oven_input_weight
    acc[row.date].out += row.oven_output_weight
    return acc
  }, {})
  const shrinkData = Object.values(dailyShrink).map((d: any) => ({
    date: d.date,
    shrinkPercent: d.in ? Number(((d.in - d.out) / d.in * 100).toFixed(2)) : 0
  })).sort((a: any, b: any) => a.date.localeCompare(b.date))

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-96">
        <h3 className="font-semibold text-slate-800 mb-6">Production vs Scrap Trends (KG)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trends || []}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Line yAxisId="left" type="monotone" dataKey="production" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} name="Finished Weight" />
            <Line yAxisId="right" type="monotone" dataKey="scrap" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} name="Scrap Weight" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-80">
          <h3 className="font-semibold text-slate-800 mb-6">Average Oven Shrink %</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={shrinkData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Line type="step" dataKey="shrinkPercent" stroke="#f59e0b" strokeWidth={3} dot={false} name="Shrinkage %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <h3 className="font-semibold text-slate-800 mb-4">Job-wise Scrap Trace</h3>
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-600">Date</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Job Card</th>
                  <th className="px-3 py-2 font-semibold text-right text-slate-600">Scrap %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(scrap || []).map((s: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{s.date}</td>
                    <td className="px-3 py-2 font-medium">{s.job_id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${s.scrap_percent > 5 ? 'bg-rose-100 text-rose-700' : 'text-slate-700'}`}>
                        {s.scrap_percent}%
                      </span>
                    </td>
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
