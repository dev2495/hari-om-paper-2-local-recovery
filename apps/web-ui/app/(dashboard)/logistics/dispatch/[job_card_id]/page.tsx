"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

// Old dispatch notification links (/logistics/dispatch/<job card>) open that card on the dispatch register.
export default function DispatchCardRedirect() {
    const params = useParams()
    const router = useRouter()
    const jobCardId = String(params?.job_card_id || "")
    useEffect(() => {
        router.replace(jobCardId ? `/logistics/dispatch?card=${encodeURIComponent(jobCardId)}` : "/logistics/dispatch")
    }, [jobCardId, router])
    return <div className="p-6 text-muted-foreground">Opening this job card&apos;s dispatch…</div>
}
