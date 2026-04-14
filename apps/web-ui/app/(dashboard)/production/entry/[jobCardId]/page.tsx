"use client"

import Link from "next/link"
import { useEffect, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"

import JobCardDocument from "@/components/production/JobCardDocument"
import { useAuth } from "@/context/AuthContext"

export default function ProductionMobileEntryPage({ params }: { params: { jobCardId: string } }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading } = useAuth()
  const roles = useMemo(() => (Array.isArray(user?.roles) ? user.roles : []), [user?.roles])
  const canEnter =
    roles.includes("Operator") ||
    roles.includes("SupervisorEntry") ||
    roles.includes("Production") ||
    roles.includes("Admin") ||
    roles.includes("PlantManager") ||
    roles.includes("Owner")

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || `/production/entry/${params.jobCardId}`)}`)
      return
    }
    if (!canEnter) {
      router.replace("/dashboard")
    }
  }, [canEnter, isLoading, params.jobCardId, pathname, router, user])

  if (isLoading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="rounded-[1.6rem] border border-slate-200 bg-white/90 px-6 py-5 text-sm text-slate-600 shadow-lg">
          Opening secure mobile stage entry...
        </div>
      </div>
    )
  }

  if (!canEnter) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg rounded-[1.8rem] border border-rose-200 bg-white/95 p-7 shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-600">Access denied</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">This account cannot open mobile production entry.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Operator, supervisor-entry, production, plant-manager, owner, or admin access is required for QR stage entry.
          </p>
          <div className="mt-5">
            <Link href="/dashboard" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="production-mobile-entry-page" className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.1),_transparent_32%),linear-gradient(180deg,_#f6f3eb_0%,_#ebe5d6_100%)] px-3 py-4 sm:px-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-[1.6rem] border border-white/70 bg-white/90 px-5 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mobile Stage Entry</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Scan, enter, save, and close the current stage fast.</h1>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              {roles.join(" / ") || "Unknown role"}
            </div>
          </div>
        </section>

        <JobCardDocument jobCardId={params.jobCardId} mode="supervisor" />
      </div>
    </div>
  )
}
