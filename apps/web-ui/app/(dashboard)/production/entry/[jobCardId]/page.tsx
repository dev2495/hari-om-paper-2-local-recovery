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
    <div data-testid="production-mobile-entry-page" className="min-h-screen bg-card px-3 py-4 sm:px-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-[1.6rem] border border-border/70 bg-card/90 px-5 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Mobile Stage Entry</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Scan, enter, save, and close the current stage fast.</h1>
            </div>
            <div className="rounded-full border border-border bg-muted px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {roles.join(" / ") || "Unknown role"}
            </div>
          </div>
        </section>

        <JobCardDocument jobCardId={jobCardId} mode="supervisor" />
      </div>
    </div>
  )
}
