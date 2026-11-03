"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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

const handoffLabels: Record<string, string> = { AWAITING_PACKING: "Waiting for Process to close", AWAITING_QC: "Waiting for Process to close", AWAITING_FG: "Waiting for the stock posting", QC_HOLD: "On QC hold", REJECTED_QC: "Nothing accepted at final QC", RETAINED_FG: "Extra pieces kept in stock", UNSEALED: "Ready for a challan", SEALED: "Challan sealed", BOXES_READY: "Boxes ready for a challan", PACKING: "Packing boxes" }
const STAGE_WORDS: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch", DONE: "Done" }
const PAGE_SIZE = 25
const pcs = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
// Only a card whose stock is posted can get a new challan; the server refuses the seal otherwise.
// A box card can get one as soon as a packed box is in stock, even while Process is still running.
const canStartChallan = (job: any) => job.dispatch_status === "DRAFT" || job.handoff_state === "UNSEALED" || job.handoff_state === "BOXES_READY"
const PROCESS_OPEN = new Set(["SLITTING", "WINDER", "OVEN", "PROCESS"])
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-IN")} ${count === 1 ? one : many}`

/** Box card state in plain words: "4 boxes ready · 120 pcs", "2 of 5 boxes shipped". */
function boxLines(job: any): string[] {
    const b = job.boxes || {}
    const total = Number(b.total || 0)
    const ready = Number(b.ready || 0)
    const shipped = Number(b.dispatched || 0)
    const waiting = Math.max(0, Number(b.packed || 0) - ready)
    const lines = [ready ? `${plural(ready, "box", "boxes")} ready · ${pcs(b.ready_pcs)} pcs` : "No box in stock yet"]
    if (shipped) lines.push(`${shipped} of ${plural(total, "box", "boxes")} shipped`)
    else lines.push(`${plural(total, "box", "boxes")} packed · ${pcs(b.boxed_pcs)} pcs`)
    if (waiting) lines.push(`${plural(waiting, "box", "boxes")} waiting for the stock posting`)
    if (Number(b.retained || 0)) lines.push(`${plural(Number(b.retained), "box", "boxes")} kept as surplus`)
    return lines
}

function FlaggedChip({ job }: { job: any }) {
    const flagged = Number(job.boxes?.flagged || 0)
    if (!job.box_mode || !flagged) return null
    return <span className="inline-flex items-center rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-xs font-semibold text-signal-amber-ink" title="A QC reading was out of band when these boxes were packed. Shipping is not blocked.">{plural(flagged, "box", "boxes")} QC flagged</span>
}

/**
 * Retain surplus on a box card: Process closed, boxes still packed, and no box fits in the released qty left
 * (the server checks the exact boxes). For a box card remaining_qty is the pcs in packed boxes — the amount the
 * settlement expects.
 */
const canRetainBoxes = (job: any) => {
    if (!job.box_mode || !(Number(job.remaining_qty) > 0) || job.handoff_state === "QC_HOLD" || job.dispatch_status === "SEALED") return false
    if (PROCESS_OPEN.has(String(job.current_stage || "").toUpperCase())) return false
    const room = Number(job.shipping_allowance || 0) - Number(job.dispatched_qty || 0)
    const perBox = Number(job.boxes?.qty_per_box || 0)
    return Number(job.max_ship_qty || 0) <= 0 || room <= 0 || (perBox > 0 && room < perBox && Number(job.boxes?.ready_pcs || 0) > room)
}

// ?card=<job card id> shows one card's dispatch (notification links; old /logistics/dispatch/<id> links redirect here).
export default function DispatchSelectionPage() {
    return <Suspense fallback={<div className="p-6 text-muted-foreground">Loading ready dispatches...</div>}><DispatchRegister /></Suspense>
}

function DispatchRegister() {
    const router = useRouter()
    const cardFilter = useSearchParams()?.get("card") || ""
    const { activePlant, user } = useAuth()
    const canRetain = (user?.roles || []).some(role => ["Owner", "Admin", "Dispatch"].includes(role))
    // Sales sees the register and prints sealed challans; making a challan is for the dispatch desk.
    const canPrepare = [user?.role, ...(user?.roles || [])].some(role => ["Owner", "Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"].includes(role || ""))
    const jobsQuery = useReadyJobs(activePlant)
    const customersQuery = useCustomers()
    const { data: plants = [] } = usePlants()
    const { data: readyJobs, isLoading } = jobsQuery
    const { data: customers } = customersQuery

    const [filterCustomer, setFilterCustomer] = useState("")
    const [filterJobNo, setFilterJobNo] = useState("")
    const [filterStatus, setFilterStatus] = useState("")
    const [shown, setShown] = useState(PAGE_SIZE)

    if (!activePlant || isLoading || customersQuery.isLoading) {
        return <div className="p-6 text-muted-foreground">Loading ready dispatches...</div>
    }
    if (jobsQuery.isError || customersQuery.isError) {
        const denied = ((jobsQuery.error || customersQuery.error) as any)?.response?.status === 403
        return (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-6">
                <p role="alert" className={denied ? "text-foreground" : "text-destructive"}>{denied ? "The dispatch register is not open to your role for this plant. Ask the Owner for access if your work needs it." : `Could not load dispatch handoffs: ${errorText(jobsQuery.error || customersQuery.error)}`}</p>
                {!denied && <Button variant="outline" className="min-h-11" onClick={() => { jobsQuery.refetch(); customersQuery.refetch() }}>Retry</Button>}
            </div>
        )
    }

    const jobs = readyJobs || []

    // Create a mapping of customer_id -> name for quick lookup
    const customerMap = (customers || []).reduce((acc: any, c: any) => {
        acc[c.id] = c.name
        return acc
    }, {})

    const filteredJobs = jobs.filter((job: any) => {
        if (cardFilter && String(job.id) !== cardFilter) return false
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
                title="Dispatch register"
                description="Make, continue or view the delivery challans of packed job cards. Sealing a challan takes the pieces out of stock and counts them as dispatched on the order."
                aside={
                    <div>
                        <p className="text-2xl font-semibold text-foreground">{filteredJobs.length}</p>
                        <p className="text-[12px] font-medium text-muted-foreground">job card{filteredJobs.length === 1 ? "" : "s"}</p>
                    </div>
                }
            />

            <div className="erp-panel grid gap-4 rounded-[1.25rem] border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Customer</label>
                    <input
                        type="text"
                        className="w-full min-h-11 sm:min-h-0 sm:h-9 rounded-md border border-border bg-card px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500"
                        placeholder="Customer name"
                        value={filterCustomer}
                        onChange={(e) => setFilterCustomer(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Job card</label>
                    <input
                        type="text"
                        className="w-full min-h-11 sm:min-h-0 sm:h-9 rounded-md border border-border bg-card px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500"
                        placeholder="Job card number"
                        value={filterJobNo}
                        onChange={(e) => setFilterJobNo(e.target.value)}
                    />
                </div>
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">Challan</label>
                    <select
                        className="w-full min-h-11 sm:min-h-0 sm:h-9 rounded-md border border-border bg-card px-3 text-sm focus:border-signal-amber-ink/40 focus:ring-1 focus:ring-amber-500 bg-card"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="">All</option>
                        <option value="READY">No challan yet</option>
                        <option value="DRAFT">Draft challan</option>
                        <option value="SEALED">Sealed</option>
                    </select>
                </div>
                <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => { setFilterCustomer(""); setFilterJobNo(""); setFilterStatus(""); if (cardFilter) router.replace("/logistics/dispatch") }}>Clear</Button>
            </div>
            {cardFilter ? (
                <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm" data-testid="dispatch-card-filter">
                    <span>{filteredJobs.length ? "Showing one job card." : "This job card is not on the dispatch register of this plant. Check the plant at the top, or it has nothing packed yet."}</span>
                    <Link href="/logistics/dispatch" className="font-medium text-signal-teal-ink underline">Show all job cards</Link>
                </p>
            ) : null}

            {/* Phone: one card per handoff with the action as a full-size button. */}
            <ul className="space-y-2 md:hidden" data-testid="dispatch-cards">
                {filteredJobs.slice(0, shown).map((job: any) => {
                    const maxShipQty = Number(job.max_ship_qty || 0)
                    const latestShipment = job.shipments?.[0]
                    const status = job.dispatch_status === "SEALED" ? (job.box_mode ? "All boxes done" : "Sealed") : job.dispatch_status === "DRAFT" ? "Draft challan" : handoffLabels[job.handoff_state] || "Ready for a challan"
                    return (
                        <li key={job.id} className="rounded-xl border border-border bg-card p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-semibold text-foreground">{jobCardRef(job)}</p>
                                    <p className="break-words text-xs text-muted-foreground">{customerMap[job.customer_id] || "Unknown customer"}</p>
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${job.dispatch_status === "SEALED" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : job.dispatch_status === "DRAFT" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-border bg-muted text-muted-foreground"}`}>{status}</span>
                            </div>
                            {job.box_mode ? (
                                <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground" data-testid="dispatch-box-state">
                                    {boxLines(job).map((line, index) => <p key={line} className={index === 0 ? "font-medium text-foreground" : undefined}>{line}</p>)}
                                    <p>{pcs(job.dispatched_qty)} pcs shipped · {pcs(maxShipQty)} pcs can ship now{PROCESS_OPEN.has(String(job.current_stage || "").toUpperCase()) ? ` · ${STAGE_WORDS[String(job.current_stage).toUpperCase()]} still running` : ""}</p>
                                    <FlaggedChip job={job} />
                                </div>
                            ) : <p className="mt-1.5 text-xs text-muted-foreground">{pcs(job.dispatchable_qty)} accepted · {pcs(job.dispatched_qty)} shipped · {pcs(maxShipQty)} pcs can ship now</p>}
                            {(job.shipments || []).map((shipment: any, index: number) => <Link key={shipment.id} href={`/logistics/dispatch/${job.id}/print?dispatch_id=${shipment.id}`} className="mt-1 flex min-h-11 items-center text-sm text-signal-teal-ink underline">Challan {job.shipments.length - index}: {pcs(shipment.qty)} pcs</Link>)}
                            {canPrepare && maxShipQty > 0 && canStartChallan(job) ? <Button asChild className="mt-2 min-h-11 w-full"><Link href={`/logistics/dispatch/new?job_card_id=${job.id}`}>{job.dispatch_status === "DRAFT" ? "Edit draft challan" : job.box_mode ? "Make challan from boxes" : "Make challan"}</Link></Button> : !latestShipment ? <p className="mt-2 text-xs text-muted-foreground">{handoffLabels[job.handoff_state] || "Not ready to ship"}</p> : null}
                            {canRetain && canRetainBoxes(job) && <RetainSurplusButton job={job} />}
                        </li>
                    )
                })}
                {!filteredJobs.length ? <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{jobs.length === 0 ? "No packed job cards are waiting." : "No job cards match these filters."}</li> : null}
            </ul>

            <div className="erp-panel hidden bg-card rounded-lg border border-border shadow-sm overflow-hidden md:block">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted text-muted-foreground border-b border-border">
                            <tr>
                                {/* Five columns so the register fits beside the sidebar without scrolling sideways:
                                    plant sits under the card, size under the customer, stage under the status. */}
                                <th className="px-4 py-3 font-semibold">Job card · plant</th>
                                <th className="px-4 py-3 font-semibold">Customer · size</th>
                                <th className="px-4 py-3 font-semibold">Pieces</th>
                                <th className="px-4 py-3 font-semibold">Challan · stage</th>
                                <th className="px-4 py-3 font-semibold text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredJobs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-0">
                                        <div className="flex min-h-[260px] flex-col items-center justify-center bg-gradient-to-b from-card to-muted/80 px-6 py-10 text-center">
                                            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink shadow-sm">
                                                {jobs.length === 0 ? <ClipboardCheck className="h-7 w-7" /> : <Truck className="h-7 w-7" />}
                                            </span>
                                            <h2 className="mt-4 text-lg font-semibold text-foreground">
                                                {jobs.length === 0 ? "No packed job cards are waiting" : "No job cards match these filters"}
                                            </h2>
                                            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                                                {jobs.length === 0
                                                    ? "A job card shows here once its packed pieces are in stock. Sealed challans stay here to view and print."
                                                    : "Clear or change the customer, job card and challan filters."}
                                            </p>
                                            <div className="mt-5 flex flex-wrap justify-center gap-2">
                                                {jobs.length === 0 ? (
                                                    <>
                                                        <Button asChild><Link href="/production/job-cards"><Factory className="mr-2 h-4 w-4" />Open job cards</Link></Button>
                                                    </>
                                                ) : (
                                                    <Button variant="outline" onClick={() => { setFilterCustomer(""); setFilterJobNo(""); setFilterStatus(""); }}>Clear all filters</Button>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredJobs.slice(0, shown).map((job: any) => {
                                    const customerName = customerMap[job.customer_id] || "Unknown Customer"
                                    const spec = job.spec_snapshot || {}
                                    const specDisplay = spec.name || `${spec.od_mm ?? spec.od_min_mm ?? spec.dimensions?.tube_od_mm ?? '?'} OD × ${spec.id_mm ?? spec.id_min_mm ?? '?'} ID × ${spec.length_mm ?? spec.length_min_mm ?? '?'} mm`
                                    const plant = plants.find((p: any) => String(p.id) === String(job.plant_id))
                                    const maxShipQty = Number(job.max_ship_qty || 0)
                                    const latestShipment = job.shipments?.[0]

                                    return (
                                        <tr key={job.id} className="hover:bg-muted transition-colors">
                                            <td className="px-4 py-3 align-top border-l-[3px] border-l-transparent hover:border-l-amber-500">
                                                <p className="whitespace-nowrap font-medium text-foreground">{jobCardRef(job)}</p>
                                                <p className="text-xs text-muted-foreground">{plant?.name || plant?.code || "Plant unavailable"}</p>
                                            </td>
                                            <td className="min-w-0 px-4 py-3 align-top">
                                                <p className="break-words text-foreground">{customerName}</p>
                                                <p className="break-words text-xs text-muted-foreground">{specDisplay}</p>
                                            </td>
                                            <td className="px-4 py-3 align-top text-muted-foreground" title={`Released ${pcs(job.released_qty ?? job.planned_qty)} pcs · up to ${pcs(job.shipping_allowance)} pcs may ship (with the allowed extra)`}>
                                                {job.box_mode ? (
                                                    <div className="space-y-0.5 text-xs tabular-nums" data-testid="dispatch-box-state">
                                                        {boxLines(job).map((line, index) => <p key={line} className={index === 0 ? "text-sm text-foreground" : undefined}>{line}</p>)}
                                                        <p>{pcs(job.dispatched_qty)} pcs shipped · {pcs(maxShipQty)} can ship now</p>
                                                        <FlaggedChip job={job} />
                                                    </div>
                                                ) : <>
                                                <p className="tabular-nums text-foreground">{pcs(job.dispatchable_qty)} accepted · {pcs(job.remaining_qty)} left to ship</p>
                                                <p className="text-xs tabular-nums">{pcs(job.dispatched_qty)} shipped · {pcs(maxShipQty)} can ship now{Number(job.qc_rejected_qty || 0) > 0 ? ` · ${pcs(job.qc_rejected_qty)} rejected at QC` : ""}{Number(job.qc_uninspected_qty || 0) > 0 ? ` · ${pcs(job.qc_uninspected_qty)} not inspected` : ""}{job.retained_qty > 0 ? ` · ${pcs(job.retained_qty)} kept in stock` : ""}</p>
                                                </>}
                                            </td>
                                            <td className="px-4 py-3 align-top">
                                                {job.dispatch_status === "SEALED" ? (
                                                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors border-none bg-signal-emerald-soft text-signal-emerald-ink hover:bg-signal-emerald-line">{job.box_mode ? "All boxes done" : "Sealed"}</span>
                                                ) : job.box_mode && job.handoff_state === "BOXES_READY" && job.dispatch_status !== "DRAFT" ? (
                                                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-signal-teal-ink border-signal-teal-line bg-signal-teal-soft">{handoffLabels.BOXES_READY}</span>
                                                ) : job.dispatch_status === "DRAFT" ? (
                                                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors text-signal-amber-ink border-signal-amber-line bg-signal-amber-soft">Draft challan</span>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">{handoffLabels[job.handoff_state] || "Ready for a challan"}</span>
                                                )}
                                                {job.dispatch_status === "DRAFT" && !["UNSEALED", "BOXES_READY"].includes(job.handoff_state) && <p className="mt-1 text-xs text-muted-foreground">{handoffLabels[job.handoff_state]}</p>}
                                                {job.current_stage && !["DISPATCH", "DONE"].includes(String(job.current_stage).toUpperCase()) ? <p className="mt-1 text-xs text-muted-foreground">Now at {STAGE_WORDS[String(job.current_stage).toUpperCase()] || String(job.current_stage).toLowerCase()}</p> : null}
                                            </td>
                                            <td className="px-4 py-3 align-top text-right">
                                                {(job.shipments || []).map((shipment: any, index: number) => <Link key={shipment.id} href={`/logistics/dispatch/${job.id}/print?dispatch_id=${shipment.id}`} className="mr-3 block text-xs text-signal-teal-ink underline">Challan {job.shipments.length - index}: {pcs(shipment.qty)} pcs</Link>)}
                                                {canPrepare && maxShipQty > 0 && canStartChallan(job) ? <Button asChild size="sm"><Link href={`/logistics/dispatch/new?job_card_id=${job.id}`}>{job.dispatch_status === "DRAFT" ? "Edit draft challan" : job.box_mode ? "Make challan from boxes" : "Make challan"}</Link></Button> : latestShipment ? <Button asChild size="sm" variant="outline"><Link href={`/logistics/dispatch/${job.id}/print?dispatch_id=${latestShipment.id}`}>View challan</Link></Button> : null}
                                                {canRetain && !job.box_mode && job.entry_model === "V2" && job.remaining_qty > 0 && job.dispatched_qty >= job.shipping_allowance && job.handoff_state === "UNSEALED" && <RetainSurplusButton job={job} />}
                                                {canRetain && canRetainBoxes(job) && <RetainSurplusButton job={job} />}
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            {filteredJobs.length > shown ? (
                <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
                    <span>Showing {shown} of {filteredJobs.length}</span>
                    <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setShown((value) => value + PAGE_SIZE)} data-testid="dispatch-show-more">Show {Math.min(PAGE_SIZE, filteredJobs.length - shown)} more</Button>
                </div>
            ) : null}
        </div>
    )
}
