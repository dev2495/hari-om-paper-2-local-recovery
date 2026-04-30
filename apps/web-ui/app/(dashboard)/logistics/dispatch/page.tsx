"use client"

import { useState } from "react"
import Link from "next/link"
import { useReadyJobs, useCustomers } from "@/hooks/use-dispatch"
import { Button } from "@/components/ui/button"
import { jobCardRef } from "@/lib/job-card-display"

export default function DispatchSelectionPage() {
    const { data: readyJobs, isLoading } = useReadyJobs()
    const { data: customers } = useCustomers()

    const [filterCustomer, setFilterCustomer] = useState("")
    const [filterJobNo, setFilterJobNo] = useState("")
    const [filterStatus, setFilterStatus] = useState("")

    if (isLoading) {
        return <div className="p-6 text-slate-500">Loading ready dispatches...</div>
    }

    const jobs = readyJobs || []

    // Create a mapping of customer_id -> name for quick lookup
    const customerMap = (customers || []).reduce((acc: any, c: any) => {
        acc[c.id] = c.name
        return acc
    }, {})

    const filteredJobs = jobs.filter((job: any) => {
        const customerName = customerMap[job.customer_id] || ""
        if (filterCustomer && !customerName.toLowerCase().includes(filterCustomer.toLowerCase())) return false
        if (filterJobNo && !jobCardRef(job).toLowerCase().includes(filterJobNo.toLowerCase())) return false

        // Status filter logic
        if (filterStatus) {
            if (filterStatus === "SEALED" && job.dispatch_status !== "SEALED") return false
            if (filterStatus === "DRAFT" && job.dispatch_status !== "DRAFT") return false
            if (filterStatus === "READY" && job.dispatch_status) return false
        }

        return true
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Dispatch Selection</h1>
                    <p className="text-sm text-slate-500">
                        Select Job Cards ready for dispatch. Only jobs past the PROCESS/PACKING stages are shown.
                    </p>
                </div>
            </div>

            <div className="erp-panel p-4 shadow-sm flex items-end gap-4 bg-white rounded-lg border border-slate-200">
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Customer</label>
                    <input
                        type="text"
                        className="w-full h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        placeholder="Filter by customer..."
                        value={filterCustomer}
                        onChange={(e) => setFilterCustomer(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Job Card No / ID</label>
                    <input
                        type="text"
                        className="w-full h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        placeholder="Search Job Card..."
                        value={filterJobNo}
                        onChange={(e) => setFilterJobNo(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Dispatch Status</label>
                    <select
                        className="w-full h-9 rounded-md border border-slate-300 px-3 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-white"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="">All Statuses</option>
                        <option value="READY">Ready (No Dispatch)</option>
                        <option value="DRAFT">Draft Dispatch</option>
                        <option value="SEALED">Sealed</option>
                    </select>
                </div>
                <Button variant="outline" className="h-9" onClick={() => { setFilterCustomer(""); setFilterJobNo(""); setFilterStatus(""); }}>Clear</Button>
            </div>

            <div className="erp-panel bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Job Card No</th>
                                <th className="px-4 py-3 font-semibold">Customer</th>
                                <th className="px-4 py-3 font-semibold">Size / Specs</th>
                                <th className="px-4 py-3 font-semibold">Planned Qty</th>
                                <th className="px-4 py-3 font-semibold">Stage</th>
                                <th className="px-4 py-3 font-semibold">Dispatch Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredJobs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                        No jobs found matching your filters.
                                    </td>
                                </tr>
                            ) : (
                                filteredJobs.map((job: any) => {
                                    const customerName = customerMap[job.customer_id] || "Unknown Customer"
                                    const spec = job.spec_snapshot || {}
                                    const specDisplay = spec.name || `${spec.dimensions?.tube_od_mm || '?'}x${spec.dimensions?.tube_thickness_mm || '?'} mm`

                                    return (
                                        <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-slate-900 border-l-[3px] border-l-transparent hover:border-l-amber-500">
                                                {jobCardRef(job)}
                                            </td>
                                            <td className="px-4 py-3 text-slate-700">{customerName}</td>
                                            <td className="px-4 py-3 text-slate-600">{specDisplay}</td>
                                            <td className="px-4 py-3 text-slate-700">{job.planned_qty}</td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs transition-colors bg-slate-100 text-slate-700 font-normal">
                                                    {job.current_stage}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {job.dispatch_status === "SEALED" ? (
                                                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors border-none bg-emerald-100 text-emerald-800 hover:bg-emerald-200">SEALED</span>
                                                ) : job.dispatch_status === "DRAFT" ? (
                                                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors text-amber-700 border-amber-300 bg-amber-50">DRAFT</span>
                                                ) : (
                                                    <span className="text-slate-400 italic text-xs">Ready</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button asChild size="sm" variant={job.dispatch_status === "SEALED" ? "outline" : "default"}>
                                                    <Link href={`/logistics/dispatch/new?job_card_id=${job.id}`}>
                                                        {job.dispatch_status === "SEALED" ? "View Challan" : job.dispatch_status === "DRAFT" ? "Edit Draft" : "Create Dispatch"}
                                                    </Link>
                                                </Button>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
