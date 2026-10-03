"use client"

import { businessDate } from "@/lib/business-date"

import { Suspense, useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useDispatchByJobCard, useCreateOrUpdateDispatch, useReadyJobs } from "@/hooks/use-dispatch"
import { usePlanningJobCard } from "@/hooks/use-production"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlants } from "@/hooks/use-system"
import { useAuth } from "@/context/AuthContext"
import { DispatchDocument } from "@/components/dispatch/dispatch-document"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { jobCardRef } from "@/lib/job-card-display"
import { errorText } from "@/lib/season-api"

function NewDispatchForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const jobCardId = searchParams?.get("job_card_id")

    const { activePlant, user } = useAuth()
    const jobQuery = usePlanningJobCard(jobCardId || "")
    const { data: jobCard, isLoading: loadingJob } = jobQuery
    const dispatchQuery = useDispatchByJobCard(jobCardId || "", true, activePlant)
    const { data: existingDispatch, isLoading: loadingDispatch } = dispatchQuery
    const customersQuery = useCustomers()
    const { data: customers, isLoading: loadingCustomers } = customersQuery
    const plantsQuery = usePlants()
    const { data: plants = [], isLoading: loadingPlants } = plantsQuery
    const handoffsQuery = useReadyJobs(jobCard?.plant_id || activePlant)
    const handoff = handoffsQuery.data?.find((job: any) => job.id === jobCardId)
    const maxShipQty = Number(handoff?.max_ship_qty || 0)
    const updateDispatch = useCreateOrUpdateDispatch(jobCard?.plant_id)
    const canSeal = [user?.role, ...(user?.roles || [])].some(role => ["Owner", "Admin", "Dispatch"].includes(role || ""))

    const [dispatchData, setDispatchData] = useState<any>(null)
    const [saveError, setSaveError] = useState("")
    const [confirming, setConfirming] = useState(false)
    const initializedJob = useRef<string | null>(null)
    const recoveredRequest = useRef<string | null>(null)
    const recovering = ["FAILED", "PENDING"].includes(existingDispatch?.dispatch_snapshot?.orchestration_state)

    useEffect(() => {
        const snapshot = existingDispatch?.dispatch_snapshot
        if (!recovering || !snapshot) return
        const request = `${existingDispatch.id}:${snapshot.dispatch_request_id || ""}`
        if (recoveredRequest.current === request) return
        recoveredRequest.current = request
        initializedJob.current = jobCardId || null
        setDispatchData(snapshot)
        setConfirming(false)
    }, [existingDispatch, recovering, jobCardId])

    useEffect(() => {
        if (!jobCard || !customers || loadingDispatch || loadingPlants || handoffsQuery.isFetching || !handoff) return
        if (initializedJob.current === jobCardId) return
        initializedJob.current = jobCardId || null

        // Generate initial snapshot from Job Card and Customers
        const customer = customers.find((c: any) => c.id === jobCard.sales_order?.customer_id) || {}
        const plant = plants.find((candidate: any) => String(candidate.id) === String(jobCard.plant_id) || String(candidate.code) === String(jobCard.plant_id)) || {}
        const spec = jobCard.spec_snapshot || {}
        const description = spec.name || jobCard.product_code || jobCardRef(jobCard)

        const packingStage = jobCard.stages?.find((s: any) => s.stage_type === "PACKING")
        const packedPcs = Number(handoff.packed_qty || 0)
        const totalPcs = Number(handoff.max_ship_qty || 0)
        const netWeight = totalPcs === packedPcs ? (packingStage?.entry_snapshot?.net_weight || packingStage?.entry_snapshot?.total_weight_kg || 0) : 0
        const pcsPerUnit = packingStage?.entry_snapshot?.pcs_per_bundle || totalPcs
        const _qtyUnits = pcsPerUnit ? Math.ceil(totalPcs / pcsPerUnit) : 1

        const initialData = {
            company: {
                id: plant.id,
                name: plant.name,
                legal_name: plant.legal_name,
                address: plant.address,
                gstin: plant.gstin,
            },
            job_card_no: jobCardRef(jobCard),
            date: businessDate(),
            customer: {
                id: customer.id,
                name: customer.name,
                address: customer.shipping_address || customer.billing_address || customer.address,
                gstin: customer.gst_no || customer.tax_id,
            },
            transporter: {
                vehicle_no: "",
                lr_no: "",
                name: ""
            },
            items: [
                {
                    description,
                    packing_type: packingStage ? "Bundle" : "Loose",
                    qty_units: _qtyUnits,
                    pcs_per_unit: pcsPerUnit,
                    total_pcs: totalPcs,
                    net_weight: netWeight,
                    remarks: ""
                }
            ],
            remarks: ""
        }
        setDispatchData(existingDispatch ? {
            ...existingDispatch.dispatch_snapshot,
            ...(!recovering ? {
                company: { ...existingDispatch.dispatch_snapshot.company, ...initialData.company },
                customer: { ...existingDispatch.dispatch_snapshot.customer, ...initialData.customer },
            } : {}),
        } : initialData)
    }, [jobCard, customers, existingDispatch, loadingDispatch, loadingPlants, plants, jobCardId, handoff, handoffsQuery.isFetching, recovering])

    if (!jobCardId) {
        return <div className="p-6">No Job Card selected.</div>
    }

    const failedQuery = [jobQuery, dispatchQuery, customersQuery, plantsQuery, handoffsQuery].find(query => query.isError)
    if (failedQuery) return <div className="space-y-3 rounded-xl border border-border bg-card p-6"><p role="alert" className="text-destructive">Could not load dispatch details: {errorText(failedQuery.error)}</p><Button variant="outline" onClick={() => failedQuery.refetch()}>Retry</Button><Button variant="ghost" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button></div>
    if (loadingJob || loadingDispatch || loadingCustomers || loadingPlants || handoffsQuery.isLoading) {
        return <div className="p-6">Loading dispatch details...</div>
    }
    if (!jobCard || (!handoffsQuery.isFetching && !handoff)) return <div className="space-y-3 p-6"><p>This job card has not reached packing, or is outside your selected plant scope.</p><Button variant="outline" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button></div>
    if (handoff?.handoff_state === "REJECTED_QC") return <div className="space-y-3 rounded-xl border border-border bg-card p-6"><h2 className="text-xl font-semibold">No accepted finished goods after final QC</h2><p className="text-sm text-muted-foreground">Packed {handoff.packed_qty} pcs · final QC rejected {handoff.qc_rejected_qty} pcs · unused / uninspected {handoff.qc_uninspected_qty || 0} pcs · accepted FG 0 pcs. This card has no quantity eligible for shipment or surplus retention.</p><Button variant="outline" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button><Button variant="ghost" onClick={() => router.push(`/quality/results?job_card_id=${jobCardId}`)}>Review QC results</Button></div>
    if (!dispatchData) return <div className="p-6">Loading dispatch details...</div>

    const getDispatchRequestId = () => {
        const storageKey = `dispatch-request:${jobCardId}`
        const fingerprint = JSON.stringify(dispatchData)
        const existing = window.sessionStorage.getItem(storageKey)
        if (existing) {
            try {
                const saved = JSON.parse(existing)
                if (saved?.fingerprint === fingerprint && saved?.requestId) return String(saved.requestId)
            } catch {
                // A pre-upgrade raw UUID is replaced by the fingerprinted record below.
            }
        }
        const requestId = window.crypto.randomUUID()
        window.sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, requestId }))
        return requestId
    }

    const handleSave = (status: "DRAFT" | "SEALED", confirmed = false) => {
        setSaveError("")
        if (status === "SEALED") {
            const qty = Number(dispatchData.items?.[0]?.total_pcs || dispatchData.dispatch_qty || dispatchData.qty)
            if (!Number.isInteger(qty) || qty <= 0 || qty > maxShipQty) {
                setSaveError(maxShipQty > 0 ? `Shipment quantity must be a whole number from 1 to ${maxShipQty} pcs.` : "No quantity remains within this card's shipment allowance. Refresh the dispatch register before continuing.")
                return
            }
            if (!recovering && (!Number.isInteger(Number(dispatchData.items?.[0]?.pcs_per_unit)) || Number(dispatchData.items?.[0]?.pcs_per_unit) <= 0 || !Number.isFinite(Number(dispatchData.items?.[0]?.net_weight)) || Number(dispatchData.items?.[0]?.net_weight) < 0)) {
                setSaveError("Enter a positive whole number of pieces per bundle and a non-negative net weight.")
                return
            }
            if (recovering && !existingDispatch?.dispatch_snapshot?.seal_request) {
                setSaveError("This older interrupted shipment requires its original request before it can be resumed. Do not create another shipment for the same stock.")
                return
            }
            const requiredValues = [
                ["plant legal name", dispatchData.company?.legal_name || dispatchData.company?.name],
                ["plant address", dispatchData.company?.address],
                ["plant GSTIN", dispatchData.company?.gstin],
                ["customer name", dispatchData.customer?.name],
                ["customer dispatch address", dispatchData.customer?.address],
                ["vehicle number", dispatchData.transporter?.vehicle_no],
                ["transporter name", dispatchData.transporter?.name],
                ["actual packed quantity", dispatchData.items?.[0]?.total_pcs],
            ]
            const missing = requiredValues.filter(([, value]) => !String(value || "").trim()).map(([label]) => label)
            if (missing.length) {
                setSaveError(`Complete the dispatch before sealing: ${missing.join(", ")}.`)
                return
            }
            if (!confirmed) {
                setConfirming(true)
                return
            }
        }

        updateDispatch.mutate(
            recovering ? existingDispatch.dispatch_snapshot.seal_request : {
                job_card_id: jobCardId,
                dispatch_snapshot: { ...dispatchData, qty: Number(dispatchData.items?.[0]?.total_pcs || 0), dispatch_qty: Number(dispatchData.items?.[0]?.total_pcs || 0) },
                status,
                dispatch_request_id: status === "SEALED" ? getDispatchRequestId() : undefined
            },
            {
                onSuccess: (response: any) => {
                    if (status === "SEALED") {
                        window.sessionStorage.removeItem(`dispatch-request:${jobCardId}`)
                        router.push(`/logistics/dispatch/${jobCardId}/print?dispatch_id=${response.data.id}`)
                    } else {
                        router.push(`/logistics/dispatch`)
                    }
                },
                onError: (err: any) => {
                    setSaveError(`Error saving dispatch: ${errorText(err)}`)
                }
            }
        )
    }

    const isSealed = existingDispatch?.status === "SEALED"
    const updateShipment = (field: string, value: string) => {
        const items = [...dispatchData.items]
        const row = { ...items[0], [field]: Number(value) }
        if (field === "total_pcs") row.pcs_per_unit = Math.min(Number(row.pcs_per_unit) || Number(value), Number(value))
        row.qty_units = row.pcs_per_unit > 0 ? Math.ceil(row.total_pcs / row.pcs_per_unit) : 0
        items[0] = row
        const { qty, dispatch_qty, quantity, total_qty, packed_qty, summary, ...snapshot } = dispatchData
        setDispatchData({ ...snapshot, items })
    }

    return (
        <div className="space-y-5 min-w-0 max-w-5xl mx-auto pb-12">
            <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center bg-card p-4 sm:p-5 rounded-xl border border-border">
                <div>
                    <h2 className="text-xl font-bold">{isSealed ? "View Dispatch Challan" : "Draft Dispatch Challan"}</h2>
                    <p className="text-sm text-muted-foreground">
                        {isSealed ? "This dispatch is sealed and locked." : "Draft data auto-generated from Job Card Snapshot."}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">Accepted FG {handoff?.dispatchable_qty || 0} pcs · final QC rejected {handoff?.qc_rejected_qty || 0} pcs · unused / uninspected {handoff?.qc_uninspected_qty || 0} pcs · gross packed {handoff?.packed_qty || 0} pcs</p>
                    <p className="mt-1 text-sm text-muted-foreground">Shipped {handoff?.dispatched_qty || 0} pcs · available to ship {maxShipQty} pcs · accepted FG remaining {handoff?.remaining_qty || 0} pcs{handoff?.retained_qty > 0 ? ` · retained FG ${handoff.retained_qty} pcs` : ""}</p>
                    {maxShipQty === 0 && handoff?.handoff_state === "UNSEALED" && handoff?.remaining_qty > 0 && <p className="mt-1 text-sm text-signal-amber-ink">The shipment allowance for this card has been fulfilled. Return to the dispatch register to review retention of the accepted surplus.</p>}
                    {handoff && !["UNSEALED", "SEALED"].includes(handoff.handoff_state) && <p className="mt-1 text-sm text-signal-amber-ink">Complete packing, final QC and FG posting, and resolve any QC hold before sealing.</p>}
                    {recovering && <p className="mt-1 text-sm text-signal-amber-ink">This shipment was interrupted. Retry its original command to finish stock and sales posting once. Its saved details remain locked.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" disabled={updateDispatch.isPending} onClick={() => router.back()}>Cancel</Button>
                    {!isSealed && (
                        <>
                            <Button variant="secondary" onClick={() => handleSave("DRAFT")} disabled={updateDispatch.isPending || recovering || maxShipQty <= 0}>
                                Save Draft
                            </Button>
                            {canSeal && <Button onClick={() => handleSave("SEALED")} disabled={updateDispatch.isPending || maxShipQty <= 0 || handoff?.handoff_state !== "UNSEALED"} >
                                {recovering ? "Retry shipment" : "Seal & Generate"}
                            </Button>}
                        </>
                    )}
                    {isSealed && (
                        <Button onClick={() => router.push(`/logistics/dispatch/${jobCardId}/print`)} >
                            Print Challan
                        </Button>
                    )}
                </div>
            </div>
            {saveError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}

            {!isSealed && <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3"><label className="text-sm">Shipment quantity (pcs)<Input type="number" min="1" max={maxShipQty} step="1" value={dispatchData.items?.[0]?.total_pcs ?? ""} disabled={recovering || updateDispatch.isPending} onChange={e => updateShipment("total_pcs", e.target.value)} /></label><label className="text-sm">Pieces per bundle<Input type="number" min="1" step="1" value={dispatchData.items?.[0]?.pcs_per_unit ?? ""} disabled={recovering || updateDispatch.isPending} onChange={e => updateShipment("pcs_per_unit", e.target.value)} /></label><label className="text-sm">Net weight (kg)<Input type="number" min="0" step="0.001" value={dispatchData.items?.[0]?.net_weight ?? ""} disabled={recovering || updateDispatch.isPending} onChange={e => updateShipment("net_weight", e.target.value)} /></label><p className="text-xs text-muted-foreground sm:col-span-3">Dispatch any part of the accepted FG quantity within the remaining shipment allowance for this card. The last bundle can contain fewer pieces. Plant and customer address/GSTIN are taken from their master records.</p></div>}

            <DispatchDocument
                dispatchData={dispatchData}
                onChange={isSealed || recovering || updateDispatch.isPending ? undefined : setDispatchData}
                printMode={false}
            />
            <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>{recovering ? "Resume shipment" : "Seal shipment"}</DialogTitle><DialogDescription>This locks the challan and records stock outward and Sales fulfillment for this shipment. The card completes after all accepted finished goods are shipped or surplus finished goods are explicitly retained.</DialogDescription></DialogHeader><p className="text-sm">{dispatchData.items?.[0]?.total_pcs || dispatchData.dispatch_qty} pcs · {dispatchData.customer?.name} · job card {jobCardRef(jobCard)}</p><DialogFooter><Button variant="outline" onClick={() => setConfirming(false)}>Keep editing</Button><Button disabled={updateDispatch.isPending} onClick={() => { setConfirming(false); handleSave("SEALED", true) }}>Confirm and seal</Button></DialogFooter></DialogContent></Dialog>
        </div>
    )
}

export default function NewDispatchPage() {
    return (
        <Suspense fallback={<div className="p-6">Loading view...</div>}>
            <NewDispatchForm />
        </Suspense>
    )
}
