"use client"

import { useState } from "react"
import Link from "next/link"
import { ClipboardCheck, Factory, Truck } from "lucide-react"
import { useReadyJobs, useCustomers } from "@/hooks/use-dispatch"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { PageHeader } from "@/components/workspace/page-header"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { jobCardRef } from "@/lib/job-card-display"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/season-api"
import { RetainSurplusButton } from "@/components/production/RetainSurplusButton"

const handoffLabels: Record<string, string> = { AWAITING_PACKING: "Awaiting packing", AWAITING_QC: "Awaiting final QC", AWAITING_FG: "Awaiting FG posting", QC_HOLD: "QC hold", REJECTED_QC: "No accepted FG (QC closed)", RETAINED_FG: "Surplus retained in FG", UNSEALED: "Unsealed", SEALED: "Sealed" }

export default function DispatchSelectionPage() {
    const { activePlant, user } = useAuth()
    const canRetain = (user?.roles || []).some(role => ["Owner", "Admin", "Dispatch"].includes(role))
    const jobsQuery = useReadyJobs(activePlant)
    const customersQuery = useCustomers()
    const { data: plants = [] } = usePlants()
    const { data: readyJobs, isLoading } = jobsQuery
    const { data: customers } = customersQuery

    const [filterCustomer, setFilterCustomer] = useState("")
    const [filterJobNo, setFilterJobNo] = useState("")
    const [filterStatus, setFilterStatus] = useState("")

    if (!activePlant || isLoading || customersQuery.isLoading) {
        return <div className="p-6 text-muted-foreground">Loading ready dispatches...</div>
    }
    if (jobsQuery.isError || customersQuery.isError) return <div className="space-y-3 rounded-xl border border-border bg-card p-6"><p role="alert" className="text-destructive">Could not load dispatch handoffs: {errorText(jobsQuery.error || customersQuery.error)}</p><Button variant="outline" onClick={() => { jobsQuery.refetch(); customersQuery.refetch() }}>Retry</Button></div>

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
            <PageHeader
                variant="hero"
                appearance={MODULE_APPEARANCES.dispatch}
                badge="Finished-goods handoff"
                title="Dispatch Selection"
                description="Create, resume, or review challans for packed jobs. Sealing records stock outward and Sales fulfillment."
                aside={
                    <div>
                        <p className="text-2xl font-semibold text-foreground">{filteredJobs.length}</p>
                        <p className="text-[12px] font-medium text-muted-foreground">handoffs visible</p>
                    </div>
                }
            />

            <div className="erp-panel grid gap-4 rounded-[1.25rem] border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Customer</label>
                    <input
                        type="text"
                        className="w-full h-9 rounded-md border border-border px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500"
                        placeholder="Filter by customer..."
                        value={filterCustomer}
                        onChange={(e) => setFilterCustomer(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Job Card No / ID</label>
                    <input
                        type="text"
                        className="w-full h-9 rounded-md border border-border px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500"
                        placeholder="Search Job Card..."
                        value={filterJobNo}
                        onChange={(e) => setFilterJobNo(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Dispatch Status</label>
                    <select
                        className="w-full h-9 rounded-md border border-border px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500 bg-card"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="">All Statuses</option>
                        <option value="READY">Unsealed (No Draft)</option>
                        <option value="DRAFT">Draft Dispatch</option>
                        <option value="SEALED">Sealed</option>
                    </select>
                </div>
                <Button variant="outline" className="h-9" onClick={() => { setFilterCustomer(""); setFilterJobNo(""); setFilterStatus(""); }}>Clear</Button>
            </div>

            <div className="erp-panel bg-card rounded-lg border border-border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Job Card No</th>
                                <th className="px-4 py-3 font-semibold">Plant</th>
                                <th className="px-4 py-3 font-semibold">Customer</th>
                                <th className="px-4 py-3 font-semibold">Size / Specs</th>
                                <th className="px-4 py-3 font-semibold">Accepted FG / Balance</th>
                                <th className="px-4 py-3 font-semibold">Stage</th>
                                <th className="px-4 py-3 font-semibold">Dispatch Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredJobs.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-0">
                                        <div className="flex min-h-[260px] flex-col items-center justify-center bg-gradient-to-b from-card to-muted/80 px-6 py-10 text-center">
                                            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink shadow-sm">
                                                {jobs.length === 0 ? <ClipboardCheck className="h-7 w-7" /> : <Truck className="h-7 w-7" />}
                                            </span>
                                            <h2 className="mt-4 text-lg font-semibold text-foreground">
                                                {jobs.length === 0 ? "No packed handoffs are waiting" : "No dispatches match these filters"}
                                            </h2>
                                            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                                                {jobs.length === 0
                                                    ? "Jobs appear here after packing posts finished-goods inventory. Sealed challans remain visible for review and printing."
                                                    : "Clear or adjust the customer, job-card, and status filters to restore the matching handoffs."}
                                            </p>
                                            <div className="mt-5 flex flex-wrap justify-center gap-2">
                                                {jobs.length === 0 ? (
                                                    <>
                                                        <Button asChild variant="outline"><Link href="/production/job-cards"><Factory className="mr-2 h-4 w-4" />Open job cards</Link></Button>
                                                        <Button asChild><Link href="/planning/tracker">Open tracker</Link></Button>
                                                    </>
                                                ) : (
                                                    <Button variant="outline" onClick={() => { setFilterCustomer(""); setFilterJobNo(""); setFilterStatus(""); }}>Clear all filters</Button>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredJobs.map((job: any) => {
                                    const customerName = customerMap[job.customer_id] || "Unknown Customer"
                                    const spec = job.spec_snapshot || {}
                                    const specDisplay = spec.name || `${spec.od_mm ?? spec.od_min_mm ?? spec.dimensions?.tube_od_mm ?? '?'} OD × ${spec.id_mm ?? spec.id_min_mm ?? '?'} ID × ${spec.length_mm ?? spec.length_min_mm ?? '?'} mm`
                                    const plant = plants.find((p: any) => String(p.id) === String(job.plant_id))
                                    const maxShipQty = Number(job.max_ship_qty || 0)
                                    const latestShipment = job.shipments?.[0]

                                    return (
                                        <tr key={job.id} className="hover:bg-muted transition-colors">
                                            <td className="px-4 py-3 font-medium text-foreground border-l-[3px] border-l-transparent hover:border-l-amber-500">
                                                {jobCardRef(job)}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">{plant?.name || plant?.code || "Plant unavailable"}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{customerName}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{specDisplay}</td>
                                            <td className="px-4 py-3 text-muted-foreground"><p className="whitespace-nowrap">Accepted {job.dispatchable_qty ?? 0} · remaining {job.remaining_qty ?? 0} pcs</p><p className="text-xs">Packed {job.packed_qty ?? 0} · final QC rejected {job.qc_rejected_qty ?? 0} pcs</p><p className="text-xs">Unused / uninspected at final QC {job.qc_uninspected_qty ?? 0} pcs</p><p className="text-xs">Shipped {job.dispatched_qty ?? 0} · can ship {maxShipQty} pcs</p><p className="text-xs">Released {job.released_qty ?? job.planned_qty} · shipment allowance {job.shipping_allowance ?? 0} pcs</p>{job.retained_qty > 0 && <p className="text-xs">Retained FG {job.retained_qty} pcs</p>}</td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs transition-colors bg-muted text-muted-foreground font-normal">
                                                    {job.current_stage}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {job.dispatch_status === "SEALED" ? (
                                                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors border-none bg-signal-emerald-soft text-signal-emerald-ink hover:bg-signal-emerald-line">SEALED</span>
                                                ) : job.dispatch_status === "DRAFT" ? (
                                                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors text-signal-amber-ink border-signal-amber-line bg-signal-amber-soft">DRAFT</span>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">{handoffLabels[job.handoff_state] || "Unsealed"}</span>
                                                )}
                                                {job.dispatch_status === "DRAFT" && job.handoff_state !== "UNSEALED" && <p className="mt-1 text-xs text-muted-foreground">{handoffLabels[job.handoff_state]}</p>}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {(job.shipments || []).map((shipment: any, index: number) => <Link key={shipment.id} href={`/logistics/dispatch/${job.id}/print?dispatch_id=${shipment.id}`} className="mr-3 block text-xs text-signal-teal-ink underline">Shipment {job.shipments.length - index}: {shipment.qty} pcs</Link>)}
                                                {maxShipQty > 0 && job.handoff_state !== "REJECTED_QC" ? <Button asChild size="sm"><Link href={`/logistics/dispatch/new?job_card_id=${job.id}`}>{job.dispatch_status === "DRAFT" ? "Edit Draft" : "Create Dispatch"}</Link></Button> : latestShipment ? <Button asChild size="sm" variant="outline"><Link href={`/logistics/dispatch/${job.id}/print?dispatch_id=${latestShipment.id}`}>View Challan</Link></Button> : null}
                                                {canRetain && job.entry_model === "V2" && job.remaining_qty > 0 && job.dispatched_qty >= job.shipping_allowance && job.handoff_state === "UNSEALED" && <RetainSurplusButton job={job} />}
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
