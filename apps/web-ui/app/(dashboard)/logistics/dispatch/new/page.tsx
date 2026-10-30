"use client"

import { businessDate } from "@/lib/business-date"

import { Suspense, useState, useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Building2, CheckCircle2, Eye, ExternalLink, RefreshCw, Scale, UserRound } from "lucide-react"
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

/** Plain words when the challan's details do not load (no axios wording such as "timeout of 30000ms exceeded"). */
function challanLoadError(error: any): string {
    const code = String(error?.code || "")
    const message = String(error?.message || "")
    if (code === "ECONNABORTED" || /timeout/i.test(message)) return "The challan took too long to load. Press Retry."
    if (!error?.response) return "The challan could not load: the connection to the server dropped. Press Retry."
    if (Number(error.response.status) >= 500) return "The challan could not load because the server had a problem. Press Retry."
    return `The challan could not load: ${errorText(error)}`
}
import {
    challanGaps,
    challanNotes,
    customerChallanParty,
    customerMasterHref,
    formatGrams,
    formatKg,
    gapsFromServerMessage,
    netWeightKg,
    plantChallanParty,
    plantMasterHref,
    tubeWeightFromSpec,
    type ChallanGap,
} from "@/lib/dispatch-challan"

const sameParty = (a: any, b: any) => JSON.stringify(a || {}) === JSON.stringify(b || {})

function MasterCard({ icon, title, rows, ok, fixHref, fixLabel, canFix, testId }: {
    icon: ReactNode
    title: string
    rows: { label: string; value?: string; missing?: boolean; optional?: boolean }[]
    ok: boolean
    fixHref: string
    fixLabel: string
    canFix: boolean
    testId: string
}) {
    return (
        <section className={`min-w-0 rounded-xl border p-4 ${ok ? "border-border bg-card" : "border-signal-amber-line bg-signal-amber-soft"}`} data-testid={testId}>
            <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</h3>
                {ok
                    ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-signal-emerald-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Ready</span>
                    : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-signal-amber-ink"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Details missing</span>}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
                {rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className={`min-w-0 break-words ${row.value ? "text-foreground" : row.optional ? "text-muted-foreground" : "font-semibold text-signal-amber-ink"}`}>
                            {row.value || (row.optional ? "Not given (optional)" : "Missing")}
                        </dd>
                    </div>
                ))}
            </dl>
            {canFix ? (
                <Link href={fixHref} target="_blank" rel="noopener" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted sm:min-h-9">
                    {fixLabel}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
                </Link>
            ) : !ok ? (
                <p className="mt-3 text-xs text-muted-foreground">Ask an Owner or Admin to fill these in the master.</p>
            ) : null}
        </section>
    )
}

function NewDispatchForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const jobCardId = searchParams?.get("job_card_id")

    const { activePlant, user } = useAuth()
    const jobQuery = usePlanningJobCard(jobCardId || "")
    const { data: jobCard, isLoading: loadingJob } = jobQuery
    const dispatchQuery = useDispatchByJobCard(jobCardId || "", true, activePlant)
    const { data: existingDispatch, isLoading: loadingDispatch } = dispatchQuery
    const customersQuery = useCustomers({ include_inactive: true })
    const { data: customers, isLoading: loadingCustomers } = customersQuery
    const plantsQuery = usePlants()
    const { data: plants = [], isLoading: loadingPlants } = plantsQuery
    const handoffsQuery = useReadyJobs(jobCard?.plant_id || activePlant)
    const handoff = handoffsQuery.data?.find((job: any) => job.id === jobCardId)
    const maxShipQty = Number(handoff?.max_ship_qty || 0)
    const updateDispatch = useCreateOrUpdateDispatch(jobCard?.plant_id)
    const roles = [user?.role, ...(user?.roles || [])]
    const canSeal = roles.some(role => ["Owner", "Admin", "Dispatch"].includes(role || ""))
    const canEditMasters = roles.some(role => ["Owner", "Admin"].includes(role || ""))
    // Sales looks at challans only (role matrix "view"); the server refuses its drafts too.
    const canPrepare = roles.some(role => ["Owner", "Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"].includes(role || ""))

    const [dispatchData, setDispatchData] = useState<any>(null)
    const [saveError, setSaveError] = useState("")
    const [sealGaps, setSealGaps] = useState<ChallanGap[]>([])
    const [confirming, setConfirming] = useState(false)
    // Set the moment the server accepts the seal: the page locks at once, before the print page has loaded, so a
    // slow network can never offer a second Seal for the same stock (checker round 4, 28 Oct).
    const [sealedId, setSealedId] = useState<string | null>(null)
    const initializedJob = useRef<string | null>(null)
    const recoveredRequest = useRef<string | null>(null)
    const gapsRef = useRef<HTMLDivElement | null>(null)
    const recovering = ["FAILED", "PENDING"].includes(existingDispatch?.dispatch_snapshot?.orchestration_state)
    const isSealed = existingDispatch?.status === "SEALED" || Boolean(sealedId)

    const customerRow = (customers || []).find((c: any) => String(c.id) === String(jobCard?.sales_order?.customer_id || ""))
    const plantRow = plants.find((candidate: any) => String(candidate.id) === String(jobCard?.plant_id) || String(candidate.code) === String(jobCard?.plant_id))
    const tube = tubeWeightFromSpec(jobCard?.spec_snapshot)

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
        const spec = jobCard.spec_snapshot || {}
        const description = spec.name || jobCard.product_code || jobCardRef(jobCard)
        const weight = tubeWeightFromSpec(spec)

        const packingStage = jobCard.stages?.find((s: any) => s.stage_type === "PACKING")
        const totalPcs = Number(handoff.max_ship_qty || 0)
        const pcsPerUnit = packingStage?.entry_snapshot?.pcs_per_bundle || totalPcs
        const _qtyUnits = pcsPerUnit ? Math.ceil(totalPcs / pcsPerUnit) : 1

        const initialData = {
            company: plantChallanParty(plantRow),
            job_card_no: jobCardRef(jobCard),
            date: businessDate(),
            customer: customerChallanParty(customerRow),
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
                    // Net weight = pcs × finished tube weight per piece from the spec (client 2026-10-28).
                    net_weight: weight ? netWeightKg(totalPcs, weight.grams) : "",
                    net_weight_source: weight ? "SPEC" : "TYPED",
                    tube_weight_g: weight?.grams ?? null,
                    remarks: ""
                }
            ],
            remarks: ""
        }
        if (!existingDispatch) {
            setDispatchData(initialData)
            return
        }
        const saved = existingDispatch.dispatch_snapshot || {}
        if (recovering) {
            setDispatchData(saved)
            return
        }
        // A saved draft keeps its typed values; the plant and customer come fresh from the masters, and the
        // net weight is worked out again unless it was typed by hand.
        const savedItems = Array.isArray(saved.items) && saved.items.length ? saved.items : initialData.items
        const first = { ...savedItems[0] }
        if (weight && first.net_weight_source !== "TYPED") {
            first.net_weight = netWeightKg(Number(first.total_pcs) || 0, weight.grams)
            first.net_weight_source = "SPEC"
            first.tube_weight_g = weight.grams
        }
        setDispatchData({
            ...saved,
            company: { ...(saved.company || {}), ...initialData.company },
            customer: { ...(saved.customer || {}), ...initialData.customer },
            items: [first, ...savedItems.slice(1)],
        })
    }, [jobCard, customers, existingDispatch, loadingDispatch, loadingPlants, plants, jobCardId, handoff, handoffsQuery.isFetching, recovering, plantRow, customerRow])

    // Plant and customer details always come from their masters until the challan is sealed: after a fix in
    // the master (another tab), the challan picks it up without retyping anything.
    useEffect(() => {
        if (!dispatchData || isSealed || recovering) return
        const company = plantChallanParty(plantRow)
        const customer = customerChallanParty(customerRow)
        if (sameParty(dispatchData.company, company) && sameParty(dispatchData.customer, customer)) return
        setDispatchData((current: any) => current ? { ...current, company, customer } : current)
    }, [plantRow, customerRow, dispatchData, isSealed, recovering])

    // Coming back to this tab (after fixing a master) reloads the plant and customer details.
    const { refetch: refetchPlants } = plantsQuery
    const { refetch: refetchCustomers } = customersQuery
    useEffect(() => {
        const reload = () => {
            if (document.visibilityState !== "visible") return
            void refetchPlants()
            void refetchCustomers()
        }
        window.addEventListener("focus", reload)
        document.addEventListener("visibilitychange", reload)
        return () => {
            window.removeEventListener("focus", reload)
            document.removeEventListener("visibilitychange", reload)
        }
    }, [refetchPlants, refetchCustomers])

    // Gaps that were reported on Seal disappear as soon as they are fixed.
    // The server's own refusal (keys "server_…") came because this page's copy of the masters was stale, so it is
    // kept until the reloaded masters change; then the page's own check takes over.
    const serverGapsSeenWith = useRef<string | null>(null)
    useEffect(() => {
        if (!sealGaps.length || !dispatchData) return
        const ids = { plantId: plantRow?.id, customerId: customerRow?.id || jobCard?.sales_order?.customer_id }
        if (sealGaps[0].key.startsWith("server_")) {
            const masters = JSON.stringify([dispatchData.company || {}, dispatchData.customer || {}])
            if (serverGapsSeenWith.current === null) serverGapsSeenWith.current = masters
            else if (serverGapsSeenWith.current !== masters) {
                serverGapsSeenWith.current = null
                setSealGaps(challanGaps(dispatchData, ids))
            }
            return
        }
        const now = challanGaps(dispatchData, ids)
        if (now.length !== sealGaps.length) setSealGaps(now)
    }, [dispatchData, sealGaps, plantRow, customerRow, jobCard])

    if (!jobCardId) {
        return <div className="p-6">No Job Card selected.</div>
    }

    const failedQuery = [jobQuery, dispatchQuery, customersQuery, plantsQuery, handoffsQuery].find(query => query.isError)
    if (failedQuery) {
        const denied = (failedQuery.error as any)?.response?.status === 403
        return (
            // Shown once, on the page (data-no-mirror: the corner banner would repeat the same words).
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-6" data-no-mirror>
                <p role="alert" className={denied ? "text-foreground" : "text-destructive"}>{denied ? "This challan is not open to your role, or the card belongs to a plant you cannot see." : challanLoadError(failedQuery.error)}</p>
                <div className="flex flex-wrap gap-2">
                    {!denied && <Button variant="outline" className="min-h-11" onClick={() => failedQuery.refetch()}>Retry</Button>}
                    <Button variant="ghost" className="min-h-11" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button>
                </div>
            </div>
        )
    }
    if (loadingJob || loadingDispatch || loadingCustomers || loadingPlants || handoffsQuery.isLoading) {
        return <div className="p-6">Loading dispatch details...</div>
    }
    if (!jobCard || (!handoffsQuery.isFetching && !handoff)) return <div className="space-y-3 p-4 sm:p-6"><p>This job card has not reached packing, or is outside your selected plant scope.</p><Button variant="outline" className="min-h-11" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button></div>
    if (handoff?.handoff_state === "REJECTED_QC") return <div className="space-y-3 rounded-xl border border-border bg-card p-6"><h2 className="text-xl font-semibold">No accepted finished goods after Process QC</h2><p className="text-sm text-muted-foreground">Packed {handoff.packed_qty} pcs · QC rejected {handoff.qc_rejected_qty} pcs · unused / uninspected {handoff.qc_uninspected_qty || 0} pcs · accepted FG 0 pcs. This card has no quantity eligible for shipment or surplus retention.</p><div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button><Button variant="ghost" className="min-h-11" onClick={() => router.push(`/quality/results?job_card_id=${jobCardId}`)}>Review QC results</Button></div></div>
    if (!dispatchData) return <div className="p-6">Loading dispatch details...</div>

    const ids = { plantId: plantRow?.id || jobCard.plant_id, customerId: customerRow?.id || jobCard.sales_order?.customer_id }
    const company = dispatchData.company || {}
    const customer = dispatchData.customer || {}
    const notes = challanNotes(dispatchData)
    const plantReady = Boolean((company.legal_name || company.name) && company.address && company.gstin)
    const customerReady = Boolean(customer.name && customer.address)
    const item = dispatchData.items?.[0] || {}

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

    const showGaps = (gaps: ChallanGap[]) => {
        serverGapsSeenWith.current = null
        setSealGaps(gaps)
        window.requestAnimationFrame(() => gapsRef.current?.focus())
    }

    const handleSave = (status: "DRAFT" | "SEALED", confirmed = false) => {
        if (sealedId) return
        setSaveError("")
        setSealGaps([])
        if (status === "SEALED") {
            const qty = Number(dispatchData.items?.[0]?.total_pcs || dispatchData.dispatch_qty || dispatchData.qty)
            if (!Number.isInteger(qty) || qty <= 0 || qty > maxShipQty) {
                setSaveError(maxShipQty > 0 ? `Shipment quantity must be a whole number from 1 to ${maxShipQty.toLocaleString("en-IN")} pcs.` : "No quantity remains within this card's shipment allowance. Refresh the dispatch register before continuing.")
                return
            }
            if (!recovering && (!Number.isInteger(Number(dispatchData.items?.[0]?.pcs_per_unit)) || Number(dispatchData.items?.[0]?.pcs_per_unit) <= 0)) {
                setSaveError("Pieces per bundle must be a whole number of 1 or more.")
                return
            }
            if (recovering && !existingDispatch?.dispatch_snapshot?.seal_request) {
                setSaveError("This older interrupted shipment requires its original request before it can be resumed. Do not create another shipment for the same stock.")
                return
            }
            const gaps = challanGaps(dispatchData, ids)
            if (gaps.length) {
                showGaps(gaps)
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
                // A failed / pending dispatch is finished with its own request ID (the server refuses a new one).
                dispatch_request_id: status === "SEALED" ? (recovering && existingDispatch?.dispatch_snapshot?.dispatch_request_id) || getDispatchRequestId() : undefined
            },
            {
                onSuccess: (response: any) => {
                    if (status === "SEALED") {
                        setConfirming(false)
                        setSealedId(String(response.data.id))
                        window.sessionStorage.removeItem(`dispatch-request:${jobCardId}`)
                        router.push(`/logistics/dispatch/${jobCardId}/print?dispatch_id=${response.data.id}`)
                    } else {
                        router.push(`/logistics/dispatch`)
                    }
                },
                onError: (err: any) => {
                    const message = errorText(err)
                    // The server's own seal refusal ("The challan cannot be sealed yet: a; b.") comes when this page's
                    // copy of the masters was stale: show it as the same list, each with a link to where it is fixed,
                    // and reload the masters so the cards below show what the server saw.
                    const serverGaps = gapsFromServerMessage(message, ids)
                    if (serverGaps.length) {
                        void plantsQuery.refetch()
                        void customersQuery.refetch()
                        showGaps(serverGaps)
                        return
                    }
                    setSaveError(`${status === "SEALED" ? "The challan was not sealed" : "The draft was not saved"}: ${message}`)
                }
            }
        )
    }

    const updateShipment = (field: "total_pcs" | "pcs_per_unit" | "net_weight", value: string) => {
        const items = [...dispatchData.items]
        const row = { ...items[0], [field]: value === "" ? "" : Number(value) }
        if (field === "total_pcs") {
            const pcs = Number(value) || 0
            row.pcs_per_unit = Math.min(Number(row.pcs_per_unit) || pcs, pcs) || row.pcs_per_unit
            // Net weight follows the pcs while the spec has a tube weight; it stays editable.
            if (tube) {
                row.net_weight = netWeightKg(pcs, tube.grams)
                row.net_weight_source = "SPEC"
                row.tube_weight_g = tube.grams
            }
        }
        if (field === "net_weight") row.net_weight_source = "TYPED"
        row.qty_units = Number(row.pcs_per_unit) > 0 ? Math.ceil((Number(row.total_pcs) || 0) / Number(row.pcs_per_unit)) : 0
        items[0] = row
        const { qty, dispatch_qty, quantity, total_qty, packed_qty, summary, ...snapshot } = dispatchData
        setDispatchData({ ...snapshot, items })
    }

    const resetNetWeight = () => {
        if (!tube) return
        const items = [...dispatchData.items]
        items[0] = { ...items[0], net_weight: netWeightKg(Number(items[0].total_pcs) || 0, tube.grams), net_weight_source: "SPEC", tube_weight_g: tube.grams }
        setDispatchData({ ...dispatchData, items })
    }

    const typedWeight = item.net_weight_source === "TYPED" && tube
    const workedOut = tube ? netWeightKg(Number(item.total_pcs) || 0, tube.grams) : 0
    // Sales (and any role outside the dispatch list) can look at the challan but not change it.
    const viewOnly = !isSealed && !canPrepare
    const locked = recovering || updateDispatch.isPending || viewOnly || Boolean(sealedId)
    const printHref = `/logistics/dispatch/${jobCardId}/print${sealedId ? `?dispatch_id=${sealedId}` : ""}`

    return (
        <div className="mx-auto min-w-0 max-w-5xl space-y-5 pb-12">
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                    <h2 className="text-xl font-bold">{isSealed ? "Sealed delivery challan" : "Delivery challan (draft)"}</h2>
                    <p className="text-sm text-muted-foreground">
                        {sealedId ? "Sealed and locked. Opening the challan to print…" : isSealed ? "This challan is sealed and locked." : `Job card ${jobCardRef(jobCard)}. Plant and customer details come from their masters.`}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">Accepted FG {handoff?.dispatchable_qty || 0} pcs · QC rejected {handoff?.qc_rejected_qty || 0} pcs · unused / uninspected {handoff?.qc_uninspected_qty || 0} pcs · gross packed {handoff?.packed_qty || 0} pcs</p>
                    <p className="mt-1 text-sm text-muted-foreground">Shipped {handoff?.dispatched_qty || 0} pcs · available to ship {maxShipQty} pcs · accepted FG remaining {handoff?.remaining_qty || 0} pcs{handoff?.retained_qty > 0 ? ` · retained FG ${handoff.retained_qty} pcs` : ""}</p>
                    {maxShipQty === 0 && handoff?.handoff_state === "UNSEALED" && handoff?.remaining_qty > 0 && <p className="mt-1 text-sm text-signal-amber-ink">The shipment allowance for this card has been fulfilled. Return to the dispatch register to review retention of the accepted surplus.</p>}
                    {handoff && !["UNSEALED", "SEALED"].includes(handoff.handoff_state) && <p className="mt-1 text-sm text-signal-amber-ink">Close Process (packing and its two QC readings close with it), post FG, and resolve any QC hold before sealing.</p>}
                    {recovering && <p className="mt-1 text-sm text-signal-amber-ink">This shipment was interrupted. Retry its original command to finish stock and sales posting once. Its saved details remain locked.</p>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-nowrap sm:items-center sm:justify-end">
                    <Button variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-0" disabled={updateDispatch.isPending} onClick={() => router.back()}>{isSealed ? "Back" : "Cancel"}</Button>
                    {!isSealed && canPrepare && (
                        <>
                            <Button variant="secondary" className="min-h-11 whitespace-nowrap sm:min-h-0" onClick={() => handleSave("DRAFT")} disabled={updateDispatch.isPending || recovering || maxShipQty <= 0}>
                                Save draft
                            </Button>
                            {canSeal && <Button className="col-span-2 min-h-11 whitespace-nowrap sm:min-h-0" data-testid="challan-seal" onClick={() => handleSave("SEALED")} disabled={updateDispatch.isPending || maxShipQty <= 0 || handoff?.handoff_state !== "UNSEALED"} >
                                {recovering ? "Retry shipment" : "Seal & print challan"}
                            </Button>}
                        </>
                    )}
                    {isSealed && (
                        <Button className="min-h-11 whitespace-nowrap sm:min-h-0" data-testid="challan-print" onClick={() => router.push(printHref)} >
                            Print challan
                        </Button>
                    )}
                </div>
            </div>

            {viewOnly && (
                <p className="flex items-start gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground" data-testid="challan-view-only">
                    <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>View only. Your role can look at challans but not change them. Dispatch, Stores, Supervisor, Plant manager, Owner or Admin save a draft; Dispatch, Owner or Admin seal it.</span>
                </p>
            )}
            {!viewOnly && !isSealed && canPrepare && !canSeal && (
                <p className="text-xs text-muted-foreground" data-testid="challan-seal-roles">You can save this as a draft. Dispatch, Owner or Admin seal it.</p>
            )}
            {sealGaps.length > 0 && (
                <div ref={gapsRef} tabIndex={-1} role="alert" aria-labelledby="seal-gaps-title" data-no-mirror className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-4 text-sm text-signal-rose-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="challan-gaps">
                    <h3 id="seal-gaps-title" className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />The challan cannot be sealed yet. Fill {sealGaps.length === 1 ? "this" : `these ${sealGaps.length}`} first:</h3>
                    <ul className="mt-2 space-y-2">
                        {sealGaps.map((gap) => (
                            <li key={gap.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <span className="text-foreground">{gap.text}</span>
                                {!gap.fixLabel ? null : gap.place === "challan" ? (
                                    <a href={gap.href} data-no-mirror className="inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-2 sm:min-h-0">{gap.fixLabel}</a>
                                ) : canEditMasters ? (
                                    <Link href={gap.href || "#"} target="_blank" rel="noopener" data-no-mirror className="inline-flex min-h-11 shrink-0 items-center gap-1 font-semibold underline underline-offset-2 sm:min-h-0">{gap.fixLabel}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></Link>
                                ) : (
                                    <span data-no-mirror className="shrink-0 text-xs">Ask an Owner or Admin to add it in {gap.place === "plant" ? "Plants" : "Customers"}.</span>
                                )}
                            </li>
                        ))}
                    </ul>
                    {sealGaps.some((gap) => gap.place !== "challan") && <p data-no-mirror className="mt-3 text-xs text-muted-foreground">After saving the master, come back to this tab: the challan reloads the details by itself.</p>}
                </div>
            )}
            {saveError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="challan-error">{saveError}</p>}

            {!isSealed && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">Details from the masters</h3>
                        <Button variant="ghost" className="min-h-11 sm:min-h-0" onClick={() => { void plantsQuery.refetch(); void customersQuery.refetch() }} disabled={plantsQuery.isFetching || customersQuery.isFetching}>
                            <RefreshCw className={`h-4 w-4 ${plantsQuery.isFetching || customersQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />Reload
                        </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <MasterCard
                            icon={<Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                            title={`Plant · ${company.legal_name || company.name || "not found"}`}
                            rows={[
                                { label: "Legal name", value: company.legal_name || company.name },
                                { label: "Address", value: company.address },
                                { label: "GSTIN", value: company.gstin ? `${company.gstin}${company.state ? ` · ${company.state}` : ""}` : "" },
                            ]}
                            ok={plantReady}
                            fixHref={plantMasterHref(ids.plantId)}
                            fixLabel={plantReady ? "Edit in Plants" : "Fill in Plants"}
                            canFix={canEditMasters}
                            testId="challan-plant-card"
                        />
                        <MasterCard
                            icon={<UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                            title={`Customer · ${customer.name || "not found"}`}
                            rows={[
                                { label: "GSTIN", value: customer.gstin ? `${customer.gstin}${customer.state ? ` · ${customer.state}` : ""}` : "", optional: true },
                                { label: "Billing", value: customer.billing_address, optional: true },
                                { label: "Dispatch to", value: customer.address },
                            ]}
                            ok={customerReady}
                            fixHref={customerMasterHref(ids.customerId)}
                            fixLabel={customerReady ? "Edit in Customers" : "Fill in Customers"}
                            canFix={canEditMasters}
                            testId="challan-customer-card"
                        />
                    </div>
                    {notes.map((note) => <p key={note} className="flex items-start gap-2 text-xs text-signal-amber-ink"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{note}</p>)}
                </div>
            )}

            {!isSealed && (
                <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
                    <label className="text-sm font-medium" htmlFor="challan-qty">Shipment quantity (pcs)
                        <Input id="challan-qty" className="mt-1 min-h-11 text-base sm:min-h-0 sm:text-[13px]" type="number" inputMode="numeric" min="1" max={maxShipQty} step="1" value={item.total_pcs ?? ""} disabled={locked} onChange={e => updateShipment("total_pcs", e.target.value)} />
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">Up to {maxShipQty.toLocaleString("en-IN")} pcs</span>
                    </label>
                    <label className="text-sm font-medium" htmlFor="challan-ppu">Pieces per bundle
                        <Input id="challan-ppu" className="mt-1 min-h-11 text-base sm:min-h-0 sm:text-[13px]" type="number" inputMode="numeric" min="1" step="1" value={item.pcs_per_unit ?? ""} disabled={locked} onChange={e => updateShipment("pcs_per_unit", e.target.value)} />
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">{Number(item.qty_units) || 0} bundle{Number(item.qty_units) === 1 ? "" : "s"}; the last one may hold fewer</span>
                    </label>
                    <label className="text-sm font-medium" htmlFor="challan-weight">Net weight (kg)
                        <Input id="challan-weight" data-testid="challan-net-weight" className="mt-1 min-h-11 text-base sm:min-h-0 sm:text-[13px]" type="number" inputMode="decimal" min="0" step="0.001" value={item.net_weight ?? ""} disabled={locked} placeholder={tube ? undefined : "Type the net weight"} aria-invalid={sealGaps.some((gap) => gap.key === "net_weight") || undefined} onChange={e => updateShipment("net_weight", e.target.value)} />
                    </label>
                    <div className="sm:col-span-3" data-testid="challan-weight-hint">
                        {tube ? (
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{Number(item.total_pcs || 0).toLocaleString("en-IN")} pcs × {formatGrams(tube.grams)} g ({tube.source}) = <strong className="text-foreground">{formatKg(workedOut)} kg</strong>.{typedWeight ? (String(item.net_weight ?? "").trim() === "" ? " The net weight field is empty; the challan cannot be sealed without it." : ` You typed ${formatKg(item.net_weight)} kg; it is worked out again when the pcs change.`) : viewOnly ? "" : " Worked out again when the pcs change; you can still change it."}</span>
                                {typedWeight && !locked ? <button type="button" onClick={resetNetWeight} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2 sm:min-h-0">Use {formatKg(workedOut)} kg</button> : null}
                            </p>
                        ) : (
                            <p className="flex items-start gap-2 text-xs text-signal-amber-ink"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />The spec sheet of this card has no tube weight, so the net weight cannot be worked out.{viewOnly ? "" : " Type it in (kg)."}</p>
                        )}
                    </div>
                </div>
            )}

            <DispatchDocument
                dispatchData={dispatchData}
                onChange={isSealed || locked ? undefined : setDispatchData}
                printMode={false}
            />
            <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>{recovering ? "Resume shipment" : "Seal this challan?"}</DialogTitle><DialogDescription>Sealing locks the challan and records stock going out and the sales order delivery for this shipment. The card completes after all accepted finished goods are shipped or the surplus is retained.</DialogDescription></DialogHeader><dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Quantity</dt><dd>{Number(item.total_pcs || dispatchData.dispatch_qty || 0).toLocaleString("en-IN")} pcs · {formatKg(item.net_weight)} kg</dd><dt className="text-muted-foreground">Customer</dt><dd className="break-words">{customer.name}</dd><dt className="text-muted-foreground">Dispatch to</dt><dd className="break-words">{customer.address}</dd><dt className="text-muted-foreground">Vehicle</dt><dd>{dispatchData.transporter?.vehicle_no} · {dispatchData.transporter?.name}</dd><dt className="text-muted-foreground">Job card</dt><dd>{jobCardRef(jobCard)}</dd></dl><DialogFooter><Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setConfirming(false)}>Keep editing</Button><Button className="min-h-11 sm:min-h-0" data-testid="challan-confirm-seal" disabled={updateDispatch.isPending} onClick={() => { setConfirming(false); handleSave("SEALED", true) }}>Confirm and seal</Button></DialogFooter></DialogContent></Dialog>
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
