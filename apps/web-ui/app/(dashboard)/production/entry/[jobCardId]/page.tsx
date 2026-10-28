"use client"

// The printed card's QR lands here: the card on a phone, stage tabs, Log output and Log QC.

import Link from "next/link"
import { Suspense, useEffect, useMemo } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"

import { PhoneEntry } from "@/components/production/card/PhoneEntry"
import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"

const ENTRY_ROLES = ["Operator", "Admin", "PlantManager", "Owner", "QC", "InProcessQC", "Planner"]

function MobileEntry() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams<{ jobCardId: string }>()
  const searchParams = useSearchParams()
  const jobCardId = String(params?.jobCardId || "")
  const { user, isLoading } = useAuth()
  const roles = useMemo(() => (Array.isArray(user?.roles) ? user.roles : []), [user?.roles])
  const canEnter = roles.some((role: string) => ENTRY_ROLES.includes(role))

  useEffect(() => {
    if (isLoading) return
    if (!user) router.replace(`/login?next=${encodeURIComponent(`${pathname || `/production/entry/${jobCardId}`}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`)}`)
  }, [isLoading, jobCardId, pathname, router, searchParams, user])

  if (isLoading && !user) return <LoadingState label="Opening the job card…" />
  if (user && !canEnter) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-signal-rose-line bg-card p-6">
        <p className="text-[12px] font-semibold text-signal-rose-ink">Access denied</p>
        <h1 className="mt-2 text-xl font-semibold">This account cannot open floor entry.</h1>
        <p className="mt-2 text-sm text-muted-foreground">Operator, plant-manager, QC, planner, owner or admin access is required for QR entry.</p>
        <Link href="/dashboard" className="erp-btn-secondary mt-4 !h-11">
          Back to dashboard
        </Link>
      </div>
    )
  }
  if (!user) return null
  return (
    <div className="mx-auto max-w-3xl" data-testid="production-mobile-entry-page">
      <PhoneEntry jobCardId={jobCardId} mode={searchParams?.get("mode")} stage={searchParams?.get("stage")} entryId={searchParams?.get("entry")} />
    </div>
  )
}

export default function ProductionMobileEntryPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening the job card…" />}>
      <MobileEntry />
    </Suspense>
  )
}
