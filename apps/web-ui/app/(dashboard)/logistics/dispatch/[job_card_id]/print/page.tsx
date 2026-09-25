"use client"

import { useEffect } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useDispatchByJobCard, useDispatch } from "@/hooks/use-dispatch"
import { DispatchDocument } from "@/components/dispatch/dispatch-document"
import { Button } from "@/components/ui/button"

export default function PrintDispatchPage() {
    const params = useParams()
    const router = useRouter()
    const jobCardId = params?.job_card_id as string

    const searchParams = useSearchParams()
    const dispatchId = searchParams?.get("dispatch_id") || null
    const byId = useDispatch(dispatchId)
    const byJob = useDispatchByJobCard(dispatchId ? null : jobCardId)
    const { data: dispatchRecord, isLoading } = dispatchId ? byId : byJob

    useEffect(() => {
        // Optional auto-print trigger
        // if (dispatchRecord) {
        //   window.print()
        // }
    }, [dispatchRecord])

    if (isLoading) return <div className="p-8 text-center text-slate-500">Loading Challan Print View...</div>

    if (!dispatchRecord) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-semibold mb-4 text-red-600">No Dispatch Found</h2>
                <Button onClick={() => router.back()}>Go Back</Button>
            </div>
        )
    }

    return (
        <div className="min-h-screen min-w-0 bg-background p-2 sm:p-6 print:p-0 print:bg-white text-foreground">
            <div className="max-w-4xl mx-auto bg-card p-3 sm:p-8 lg:p-12 min-h-[10in] rounded-xl print:rounded-none print:p-0 print:shadow-none print:m-0 print:w-full border print:border-none">
                <div className="mb-8 flex justify-end print:hidden">
                    <Button variant="outline" className="mr-4" onClick={() => router.push("/logistics/dispatch")}>
                        Back to Logistics
                    </Button>
                    <Button onClick={() => window.print()} className="flex gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                        Print
                    </Button>
                </div>
                <DispatchDocument dispatchData={dispatchRecord.dispatch_snapshot} printMode={true} />
            </div>
        </div>
    )
}
