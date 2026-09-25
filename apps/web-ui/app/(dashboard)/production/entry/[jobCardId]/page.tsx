"use client"

import Link from "next/link"
import { useEffect, useMemo } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"

import JobCardDocument from "@/components/production/JobCardDocument"
import { useAuth } from "@/context/AuthContext"

export default function ProductionMobileEntryPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams<{ jobCardId: string }>()
  const jobCardId = String(params?.jobCardId || "")
  const { user, isLoading } = useAuth()
  const roles = useMemo(() => (Array.isArray(user?.roles) ? user.roles : []), [user?.roles])
  const canEnter =
    roles.includes("Operator") ||
    roles.includes("Admin") ||
    roles.includes("PlantManager") ||
    roles.includes("Owner")

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || `/production/entry/${jobCardId}`)}`)
      return
    }
    if (!canEnter) {
      router.replace("/dashboard")
    }
  }, [canEnter, isLoading, jobCardId, pathname, router, user])

  if (isLoading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="rounded-[1.6rem] border border-border bg-card/90 px-6 py-5 text-sm text-muted-foreground shadow-lg">
          Opening secure mobile stage entry...
        </div>
      </div>
    )
  }

  if (!canEnter) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg rounded-[1.8rem] border border-signal-rose-line bg-card/95 p-7 shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal-rose-ink">Access denied</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">This account cannot open mobile production entry.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Operator, plant-manager, owner, or admin access is required for QR stage entry.
          </p>
          <div className="mt-5">
            <Link href="/dashboard" className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="production-mobile-entry-page" className="min-h-screen bg-background px-3 py-4 sm:px-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-premium)]">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Stage entry · scanned card</p>
            <h1 className="text-[20px] font-semibold tracking-tight">Enter today&apos;s run for this job card</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">{roles.join(" · ") || "—"}</span>
            <Link href="/production/supervisor-entry" className="erp-btn-secondary !h-8">Scan another</Link>
          </div>
        </section>

        <JobCardDocument jobCardId={jobCardId} mode="supervisor" />
      </div>
    </div>
  )
}
