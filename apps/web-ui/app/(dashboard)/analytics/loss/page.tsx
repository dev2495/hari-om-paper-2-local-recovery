"use client"

import { useSupplierLoss, useGsmBfLoss } from "@/hooks/use-analytics"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts"

export default function LossAnalyticsPage() {
    const { startDate, endDate, plantId } = useAnalyticsContext()

    const { data: supplierLoss, isLoading: load1 } = useSupplierLoss(startDate, endDate, plantId)
    const { data: gsmBfLoss, isLoading: load2 } = useGsmBfLoss(startDate, endDate, plantId)

    if (load1 || load2) return <div className="p-8 text-slate-500">Loading intelligence models...</div>

    // Take top 10
    const topSuppliers = (supplierLoss || []).slice(0, 10)
    const topGsmBf = (gsmBfLoss || []).slice(0, 10).map((d: any) => ({ ...d, name: `${d.gsm || '?'} GSM / ${d.bf || '?'} BF` }))

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Supplier Loss Chart */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-96 flex flex-col">
                    <h3 className="font-semibold text-slate-800 mb-2">Material Loss % by Reel Supplier</h3>
                    <p className="text-xs text-slate-500 mb-6">Aggregated based on theoretical yield vs winder recon output.</p>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topSuppliers} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                                <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                <YAxis dataKey="supplier_name" type="category" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f1f5f9' }} />
                                <Bar dataKey="loss_percentage" name="Loss %" radius={[0, 4, 4, 0]}>
                                    {topSuppliers.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.loss_percentage > 5 ? '#ef4444' : '#64748b'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* GSM/BF Loss Chart */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-96 flex flex-col">
                    <h3 className="font-semibold text-slate-800 mb-2">Loss % by GSM/BF Specification</h3>
                    <p className="text-xs text-slate-500 mb-6">Identifies which paper properties are causing tears or yield issues.</p>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topGsmBf} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                                <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f1f5f9' }} />
                                <Bar dataKey="loss_percentage" name="Loss %" radius={[0, 4, 4, 0]}>
                                    {topGsmBf.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.loss_percentage > 5 ? '#f59e0b' : '#334155'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}
