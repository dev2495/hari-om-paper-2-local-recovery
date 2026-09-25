"use client"

import { Download, FileText } from "lucide-react"

import { ReportHero } from "@/components/reports/primitives"
import { CommandCenter } from "@/components/workspace/command-center"
import { RoleGate } from "@/components/workspace/role-gate"

export default function OwnerReportsPage() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <OwnerPackPage />
    </RoleGate>
  )
}

function OwnerPackPage() {
  return (
    <div className="space-y-5 pb-10" data-testid="analytics-owner-pack-page">
      <CommandCenter
        role="Owner"
        variant="analytics"
        testId="owner-pack-snapshot"
        header={
          <ReportHero
            eyebrow="Owner daily pack"
            title="The board pack, live"
            description="Order book, dispatch, OTIF, production, quality and stock for the selected period — the same figures the emailed owner pack uses."
            accent="cyan"
          >
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/api/analytics/reports/owner-pack/pdf?download=1" className="erp-btn-primary" rel="noopener" target="_blank">
                <Download className="h-4 w-4" />
                Export PDF
              </a>
              <a href="/api/analytics/reports/owner-pack/html" className="erp-btn-secondary" rel="noopener" target="_blank">
                <FileText className="h-4 w-4" />
                Open printable pack
              </a>
            </div>
          </ReportHero>
        }
      />
    </div>
  )
}
