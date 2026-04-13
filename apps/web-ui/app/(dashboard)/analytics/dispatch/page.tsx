"use client"

import { useSalesTrends } from "@/hooks/use-analytics"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

export default function DispatchAnalyticsPage() {
    const { startDate, endDate, plantId } = useAnalyticsContext()
    const { data, isLoading } = useSalesTrends(startDate, endDate, plantId)

    if (isLoading) return <div className="p-8 text-slate-500">Loading dispatch & sales data...</div>

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-[400px]">
                <h3 className="font-semibold text-slate-800 mb-6">Sales Order Velocity Tracker</h3>
                <p className="text-sm text-slate-500 mb-4 -mt-4">Number of sales orders created vs pushed to production vs closed per day.</p>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data || []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="orders" stroke="#94a3b8" strokeWidth={2} dot={false} name="Orders Logged" />
                        <Line type="monotone" dataKey="released" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} name="Pushed to Prod" />
                        <Line type="monotone" dataKey="closed" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} name="Dispatch Closed" />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-xl">
                    <h4 className="text-emerald-800 font-semibold mb-1 text-sm">On-Time Final Dispatch</h4>
                    <p className="text-3xl font-bold text-emerald-900 mt-2">--%</p>
                    <p className="text-xs text-emerald-700/70 mt-1">Pending implementation based on TAT tracking.</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 p-5 rounded-xl">
                    <h4 className="text-blue-800 font-semibold mb-1 text-sm">Largest Dispatch Client</h4>
                    <p className="text-lg font-bold text-blue-900 mt-2 line-clamp-1">--</p>
                    <p className="text-xs text-blue-700/70 mt-1">Sourced from upcoming Customer data mart.</p>
                </div>
                <div className="bg-orange-50 border border-orange-100 p-5 rounded-xl">
                    <h4 className="text-orange-800 font-semibold mb-1 text-sm">Returns & Rejections</h4>
                    <p className="text-3xl font-bold text-orange-900 mt-2">0</p>
                    <p className="text-xs text-orange-700/70 mt-1">From Sales Return module.</p>
                </div>
            </div>
        </div>
    )
}
