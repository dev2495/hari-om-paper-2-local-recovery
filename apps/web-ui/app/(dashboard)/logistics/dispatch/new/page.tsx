"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useDispatchByJobCard, useCreateOrUpdateDispatch } from "@/hooks/use-dispatch"
import { usePlanningJobCard } from "@/hooks/use-production"
import { useCustomers } from "@/hooks/use-master-data"
import { DispatchDocument } from "@/components/dispatch/dispatch-document"
import { Button } from "@/components/ui/button"
import { jobCardRef } from "@/lib/job-card-display"

function NewDispatchForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const jobCardId = searchParams?.get("job_card_id")

    const { data: jobCard, isLoading: loadingJob } = usePlanningJobCard(jobCardId || "")
    const { data: existingDispatch, isLoading: loadingDispatch } = useDispatchByJobCard(jobCardId || "")
    const { data: customers, isLoading: loadingCustomers } = useCustomers()
    const updateDispatch = useCreateOrUpdateDispatch()

    const [dispatchData, setDispatchData] = useState<any>(null)

    useEffect(() => {
        if (!jobCard || !customers || loadingDispatch) return

        if (existingDispatch) {
            setDispatchData(existingDispatch.dispatch_snapshot)
            return
        }

        // Generate initial snapshot from Job Card and Customers
        const customer = customers.find((c: any) => c.id === jobCard.sales_order?.customer_id) || {}
        const spec = jobCard.spec_snapshot || {}
        const description = spec.name || `Paper Tube ${spec.dimensions?.tube_od_mm || '?'}x${spec.dimensions?.tube_thickness_mm || '?'} mm`

        // Find packing/process stage to get quantities
        const packingStage = jobCard.stages?.find((s: any) => s.stage_type === "PACKING")
        const processStage = jobCard.stages?.find((s: any) => s.stage_type === "PROCESS")
        const latestStage = packingStage || processStage || {}

        // In a real factory, packing splits output into units. For this blueprint we extract what we can.
        const totalPcs = latestStage.output_qty || jobCard.planned_qty || 0
        const netWeight = latestStage.entry_snapshot?.net_weight || 0
        // Try to guess pcs_per_unit, or set defaults
        const pcsPerUnit = latestStage.entry_snapshot?.pcs_per_bundle || totalPcs
        const _qtyUnits = pcsPerUnit ? Math.ceil(totalPcs / pcsPerUnit) : 1

        const initialData = {
            job_card_no: jobCardRef(jobCard),
            date: new Date().toISOString().split("T")[0],
            customer: {
                id: customer.id,
                name: customer.name,
                address: customer.billing_address || customer.shipping_address || "Address unavailable"
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

        setDispatchData(initialData)
    }, [jobCard, customers, existingDispatch, loadingDispatch])

    if (!jobCardId) {
        return <div className="p-6">No Job Card selected.</div>
    }

    if (loadingJob || loadingDispatch || !dispatchData) {
        return <div className="p-6">Loading dispatch details...</div>
    }

    const handleSave = (status: "DRAFT" | "SEALED") => {
        if (status === "SEALED") {
            if (!confirm("Are you sure you want to seal this dispatch? This will lock it from further edits and mark the Job Card as dispatched.")) {
                return
            }
        }

        updateDispatch.mutate(
            {
                job_card_id: jobCardId,
                dispatch_snapshot: dispatchData,
                status
            },
            {
                onSuccess: () => {
                    if (status === "SEALED") {
                        router.push(`/logistics/dispatch/${jobCardId}/print`)
                    } else {
                        alert("Draft saved.")
                        router.push(`/logistics/dispatch`)
                    }
                },
                onError: (err: any) => {
                    alert(`Error saving dispatch: ${err.response?.data?.detail || err.message}`)
                }
            }
        )
    }

    const isSealed = existingDispatch?.status === "SEALED"

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-24 border rounded-xl shadow-2xl p-4 bg-slate-50">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                <div>
                    <h2 className="text-xl font-bold">{isSealed ? "View Dispatch Challan" : "Draft Dispatch Challan"}</h2>
                    <p className="text-sm text-slate-500">
                        {isSealed ? "This dispatch is sealed and locked." : "Draft data auto-generated from Job Card Snapshot."}
                    </p>
                </div>
                <div className="space-x-4">
                    <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
                    {!isSealed && (
                        <>
                            <Button variant="secondary" onClick={() => handleSave("DRAFT")} disabled={updateDispatch.isPending}>
                                Save Draft
                            </Button>
                            <Button onClick={() => handleSave("SEALED")} disabled={updateDispatch.isPending} className="bg-amber-600 hover:bg-amber-700 text-white">
                                Seal & Generate
                            </Button>
                        </>
                    )}
                    {isSealed && (
                        <Button onClick={() => router.push(`/logistics/dispatch/${jobCardId}/print`)} className="bg-slate-900 border-none outline-none">
                            Print Challan
                        </Button>
                    )}
                </div>
            </div>

            <DispatchDocument
                dispatchData={dispatchData}
                onChange={isSealed ? undefined : setDispatchData}
                printMode={false}
            />
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
