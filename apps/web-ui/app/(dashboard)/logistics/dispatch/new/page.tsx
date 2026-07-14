"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useDispatchByJobCard, useCreateOrUpdateDispatch } from "@/hooks/use-dispatch"
import { usePlanningJobCard } from "@/hooks/use-production"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlants } from "@/hooks/use-system"
import { useAuth } from "@/context/AuthContext"
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
    const { data: plants = [], isLoading: loadingPlants } = usePlants()
    const { activePlant } = useAuth()
    const updateDispatch = useCreateOrUpdateDispatch()

    const [dispatchData, setDispatchData] = useState<any>(null)

    useEffect(() => {
        if (!jobCard || !customers || loadingDispatch || loadingPlants) return

        if (existingDispatch) {
            setDispatchData(existingDispatch.dispatch_snapshot)
            return
        }

        // Generate initial snapshot from Job Card and Customers
        const customer = customers.find((c: any) => c.id === jobCard.sales_order?.customer_id) || {}
        const plant = plants.find((candidate: any) => String(candidate.id) === String(activePlant) || String(candidate.code) === String(activePlant)) || {}
        const spec = jobCard.spec_snapshot || {}
        const description = spec.name || jobCard.product_code || jobCardRef(jobCard)

        // Find packing/process stage to get quantities
        const packingStage = jobCard.stages?.find((s: any) => s.stage_type === "PACKING")
        const processStage = jobCard.stages?.find((s: any) => s.stage_type === "PROCESS")
        const latestStage = packingStage || processStage || {}

        const totalPcs = packingStage?.output_qty || packingStage?.entry_snapshot?.total_packed_qty || 0
        const netWeight = packingStage?.entry_snapshot?.net_weight || packingStage?.entry_snapshot?.total_weight_kg || 0
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
            date: new Date().toISOString().split("T")[0],
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

        setDispatchData(initialData)
    }, [jobCard, customers, existingDispatch, loadingDispatch, loadingPlants, plants, activePlant])

    if (!jobCardId) {
        return <div className="p-6">No Job Card selected.</div>
    }

    if (loadingJob || loadingDispatch || !dispatchData) {
        return <div className="p-6">Loading dispatch details...</div>
    }

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

    const handleSave = (status: "DRAFT" | "SEALED") => {
        if (status === "SEALED") {
            const requiredValues = [
                ["plant legal name", dispatchData.company?.legal_name || dispatchData.company?.name],
                ["plant address", dispatchData.company?.address],
                ["plant GSTIN", dispatchData.company?.gstin],
                ["customer name", dispatchData.customer?.name],
                ["customer dispatch address", dispatchData.customer?.address],
                ["customer GSTIN", dispatchData.customer?.gstin],
                ["vehicle number", dispatchData.transporter?.vehicle_no],
                ["transporter name", dispatchData.transporter?.name],
                ["actual packed quantity", dispatchData.items?.[0]?.total_pcs],
            ]
            const missing = requiredValues.filter(([, value]) => !String(value || "").trim()).map(([label]) => label)
            if (missing.length) {
                alert(`Complete the dispatch before sealing: ${missing.join(", ")}.`)
                return
            }
            if (!confirm("Are you sure you want to seal this dispatch? This will lock it from further edits and mark the Job Card as dispatched.")) {
                return
            }
        }

        updateDispatch.mutate(
            {
                job_card_id: jobCardId,
                dispatch_snapshot: dispatchData,
                status,
                dispatch_request_id: status === "SEALED" ? getDispatchRequestId() : undefined
            },
            {
                onSuccess: () => {
                    if (status === "SEALED") {
                        window.sessionStorage.removeItem(`dispatch-request:${jobCardId}`)
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
