"use client"

import { OwnerIntelligenceSuite } from "@/components/analytics/OwnerIntelligenceSuite"

export default function OwnerReportsPage() {
  return (
    <main className="px-6 pb-8 pt-2" data-testid="analytics-owner-pack-page">
      <OwnerIntelligenceSuite mode="report" />
    </main>
  )
}
