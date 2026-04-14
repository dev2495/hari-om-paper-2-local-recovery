"use client"

import Link from "next/link"
import { AlertTriangle, ClipboardCheck, Factory, ShoppingCart, Truck, Warehouse } from "lucide-react"

import { EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { useReadyJobs } from "@/hooks/use-dispatch"
import { useInventoryHealthSummary } from "@/hooks/use-inventory"
import { usePlanningBoard, usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrders } from "@/hooks/use-sales"

function ActionLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </Link>
  )
}

export function OperationalDashboard({ roles }: { roles: string[] }) {
  const { activePlant } = useAuth()
  const { data: salesOrders } = useSalesOrders()
  const { data: board } = usePlanningBoard(undefined, undefined, true, activePlant || undefined, Boolean(activePlant))
  const { data: jobCards } = usePlanningJobCards()
  const { data: inventoryHealth } = useInventoryHealthSummary()
  const { data: readyJobs } = useReadyJobs()

  const orderRows = Array.isArray(salesOrders) ? salesOrders : []
  const jobCardRows = Array.isArray(jobCards) ? jobCards : []
  const readyDispatchRows = Array.isArray(readyJobs) ? readyJobs : []
  const plannerSummary = (board as any)?.summary || {}
  const activeStageViews = Array.isArray((board as any)?.stages) ? (board as any).stages : []
  const unscheduledJobs = activeStageViews.reduce((sum: number, stage: any) => {
    const lanes = Array.isArray(stage?.lanes) ? stage.lanes : []
    const unscheduledLane = lanes.find((lane: any) => lane.machine_id === null)
    return sum + Number(unscheduledLane?.jobs?.length || 0)
  }, 0)
  const blockedJobs = jobCardRows.filter((card: any) => String(card.status || "").toUpperCase().includes("BLOCK")).length
  const approvedOrders = orderRows.filter((order: any) => order.status === "approved").length
  const draftOrders = orderRows.filter((order: any) => ["draft", "submitted"].includes(order.status)).length
  const lowStockItems = Number((inventoryHealth as any)?.summary?.low_stock_items || (inventoryHealth as any)?.low_stock_items || 0)
  const plannerRoles = ["Owner", "Admin", "Planner", "PlantManager"]
  const plannerView = plannerRoles.some((role) => roles.includes(role))

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-white/70 bg-white/90 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operational Dashboard</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              {plannerView ? "Today’s queues, bottlenecks, and release handoff" : "Role-first action queues and floor visibility"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              This dashboard stays operational. It shows what needs action now instead of repeating the executive reports suite.
            </p>
          </div>
          <StatusBadge value={unscheduledJobs > 0 || blockedJobs > 0 ? "BLOCKED" : "ACTIVE"} label={`${unscheduledJobs} unscheduled · ${blockedJobs} blocked`} />
        </div>
      </section>

      <MetricRail>
        <MetricCard label="Approved Orders" value={approvedOrders} detail="Ready to release into planning" icon={ShoppingCart} tone="cyan" />
        <MetricCard label="Unscheduled Jobs" value={unscheduledJobs} detail="Jobs still waiting for machine and shift placement" icon={Factory} tone="amber" />
        <MetricCard label="Ready Dispatches" value={readyDispatchRows.length} detail="Packed jobs available for challan creation" icon={Truck} tone="emerald" />
        <MetricCard label="Low-stock Items" value={lowStockItems} detail="Store actions required before release or issue" icon={Warehouse} tone="rose" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title="Action Queue" subtitle="Only the next operational actions.">
          <div className="grid gap-3 md:grid-cols-2">
            <ActionLink href="/sales-orders" title="Approve / release sales orders" detail={`${draftOrders} still waiting on maker-checker or release.`} />
            <ActionLink href="/planning" title="Schedule route stages" detail={`${plannerSummary.jobs || 0} jobs on today’s planning board.`} />
            <ActionLink href="/production/job-cards" title="Review job card truth" detail={`${jobCardRows.length} active cards with stage-level actuals.`} />
            <ActionLink href="/dispatch" title="Seal dispatches" detail={`${readyDispatchRows.length} finished jobs available for customer handoff.`} />
          </div>
        </Panel>

        <Panel title="Operational Exceptions" subtitle="Only exception counts that drive a workflow.">
          <div className="space-y-3">
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Planning</p>
                  <p className="mt-1 text-base font-semibold text-slate-950">Unscheduled or blocked execution</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-950">{unscheduledJobs + blockedJobs}</p>
                  <p className="text-xs text-slate-500">cards</p>
                </div>
              </div>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stores</p>
                  <p className="mt-1 text-base font-semibold text-slate-950">Low-stock or dispatch-readiness pressure</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-950">{lowStockItems}</p>
                  <p className="text-xs text-slate-500">items</p>
                </div>
              </div>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dispatch</p>
                  <p className="mt-1 text-base font-semibold text-slate-950">Ready for sealing</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-950">{readyDispatchRows.length}</p>
                  <p className="text-xs text-slate-500">jobs</p>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Role Links" subtitle="Jump straight into the transactional work areas.">
        <div className="grid gap-3 md:grid-cols-4">
          <ActionLink href="/sales-orders/new" title="New Order" detail="Create commercial demand against an approved spec." />
          <ActionLink href="/supervisor-entry" title="Supervisor Entry" detail="Record WINDER, OVEN, PROCESS, PACKING, QC, and dispatch truth." />
          <ActionLink href="/inventory" title="Inventory" detail="Review health, issue stock, and trace materials." />
          <ActionLink href="/reports" title="Reports" detail="Open the full KPI suite only when analysis is needed." />
        </div>
      </Panel>

      {!plannerView && readyDispatchRows.length === 0 && lowStockItems === 0 ? (
        <EmptyState label="No urgent operational exceptions are currently flagged for this role." />
      ) : null}
    </div>
  )
}