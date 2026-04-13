"use client"

import { useDashboardOverview } from "@/hooks/use-analytics"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

export default function DashboardOverviewPage() {
    const { plantId } = useAnalyticsContext()
    const { data, isLoading } = useDashboardOverview(plantId)

    if (isLoading) return <div className="p-8 text-slate-500 animate-pulse">Gathering intelligence...</div>
    if (!data) return <div className="p-8 text-rose-500">Failed to load dashboard data.</div>

    const kpis = [
        { label: "Today's Production", value: `${data.today_production} kg`, color: "text-emerald-600" },
        { label: "Today's Dispatch", value: `${data.today_dispatch} kg`, color: "text-blue-600" },
        { label: "Oven Shrink %", value: `${data.shrink_percent}%`, color: "text-amber-600" },
        { label: "Est. Total Scrap %", value: `${data.scrap_percent}%`, color: "text-rose-600" },
        { label: "Avg Bamboo Loss %", value: `${data.bamboo_loss_percent}%`, color: "text-orange-600" },
        { label: "Active Specs", value: data.active_specs, color: "text-slate-700" },
    ]

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                {kpis.map((kpi, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{kpi.label}</p>
                        <p className={`text-2xl font-bold tracking-tight ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="font-semibold text-slate-800 mb-4">Stock Value & Critical Items</h3>
                    <p className="text-3xl font-bold text-slate-900 mb-6">{data.current_stock_value.toLocaleString()} kg <span className="text-sm font-normal text-slate-500">Total Raw Material</span></p>

                    <h4 className="text-sm font-semibold text-rose-800 bg-rose-50 px-3 py-1 inline-block rounded-md mb-3">Below Reorder Level</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {data.low_stock_items.length === 0 ? (
                            <p className="text-sm text-slate-500 italic">No low stock items</p>
                        ) : (
                            data.low_stock_items.map((item: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center text-sm p-2 bg-slate-50 rounded border border-slate-100">
                                    <span className="font-medium text-slate-700">{item.item_name} <span className="text-xs text-slate-400 ml-1">({item.category})</span></span>
                                    <span className="font-bold text-rose-600">{item.current_stock} kg</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="font-semibold text-slate-800 mb-4">Sales & Backlog</h3>
                    <div className="flex gap-8 mb-6">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">SO Fill Rate</p>
                            <p className="text-2xl font-bold text-slate-900">{data.fill_rate}%</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Pending Backlog</p>
                            <p className="text-2xl font-bold text-amber-600">{data.so_backlog} Orders</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Maker-Checker Queue</p>
                            <p className="text-2xl font-bold text-blue-600">{data.maker_checker_queue} Drafts</p>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 italic">Note: Dispatch delays are measured from actual job card completion to gate out.</p>
                </div>
            </div>
        </div>
    )
}
