"use client"

import { useEffect } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useDispatchByJobCard, useDispatch } from "@/hooks/use-dispatch"
import { DispatchDocument } from "@/components/dispatch/dispatch-document"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { errorText } from "@/lib/season-api"
import { useBreadcrumbLabel } from "@/components/workspace/breadcrumb-label"

export default function PrintDispatchPage() {
    const params = useParams()
    const router = useRouter()
    const jobCardId = params?.job_card_id as string

    const searchParams = useSearchParams()
    const dispatchId = searchParams?.get("dispatch_id") || null
    const { activePlant } = useAuth()
    const byId = useDispatch(dispatchId, activePlant)
    const byJob = useDispatchByJobCard(dispatchId ? null : jobCardId, false, activePlant)
    const query = dispatchId ? byId : byJob
    const { data: dispatchRecord, isLoading } = query
    // The last crumb names the challan ("Challan DC/…"), not the URL word "Print".
    const challanNo = dispatchRecord?.dispatch_snapshot?.challan_no || dispatchRecord?.dispatch_snapshot?.dispatch_ref
    useBreadcrumbLabel(challanNo ? `Challan ${challanNo}` : "Challan")

    useEffect(() => {
        // Optional auto-print trigger
        // if (dispatchRecord) {
        //   window.print()
        // }
    }, [dispatchRecord])

    if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading the challan…</div>
    if (query.isError) return <div className="space-y-3 p-4 text-center sm:p-8"><p role="alert" className="text-destructive">Could not load this challan: {errorText(query.error)}</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" className="min-h-11" onClick={() => query.refetch()}>Retry</Button><Button variant="ghost" className="min-h-11" onClick={() => router.push("/logistics/dispatch")}>Back to dispatch</Button></div></div>

    if (!dispatchRecord) {
        return (
            <div className="p-8 text-center">
                <h2 className="mb-4 text-xl font-semibold text-destructive">No challan found for this job card</h2>
                <Button className="min-h-11" onClick={() => router.back()}>Go back</Button>
            </div>
        )
    }

    return (
        <div className="min-h-screen min-w-0 bg-background p-2 sm:p-6 print:p-0 print:bg-white text-foreground">
            <div className="max-w-4xl mx-auto bg-card p-3 sm:p-8 lg:p-12 min-h-[10in] rounded-xl print:rounded-none print:p-0 print:shadow-none print:m-0 print:w-full border print:border-none">
                <div className="mb-8 grid grid-cols-2 gap-2 print:hidden sm:flex sm:justify-end">
                    <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => router.push("/logistics/dispatch")}>
                        Back to Dispatch
                    </Button>
                    <Button onClick={() => window.print()} className="flex min-h-11 gap-2 sm:min-h-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                        Print
                    </Button>
                </div>
                <DispatchDocument dispatchData={dispatchRecord.dispatch_snapshot} printMode={true} />
            </div>
        </div>
    )
}
