"use client"

import { OwnerIntelligenceSuite } from "@/components/analytics/OwnerIntelligenceSuite"
import { useAuth } from "@/context/AuthContext"

export default function OwnerReportsPage() {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean))
  const canViewOwnerReports = roles.has("Owner") || roles.has("Admin")

  if (!canViewOwnerReports) {
    return (
      <div className="px-6 pb-8 pt-2" data-testid="analytics-owner-pack-page">
        <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-800">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Access denied</p>
          <h1 className="mt-3 text-2xl font-black text-rose-950">Owner reports are restricted.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6">
            This report includes cross-plant financial, exception, and executive metrics. Switch to an Owner or Admin role to view it.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="px-6 pb-8 pt-2" data-testid="analytics-owner-pack-page">
      <OwnerIntelligenceSuite mode="report" />
    </div>
  )
}
