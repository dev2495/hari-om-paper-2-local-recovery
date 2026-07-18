"use client"

import Link from "next/link"
import {
  AlertTriangle,
  Bell,
  ClipboardCheck,
  Factory,
  FlaskConical,
  PackageCheck,
  ReceiptText,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Warehouse,
  Wrench,
} from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartBox, ChartEmptyState, ChartPanel, ChartTooltip } from "@/components/erp/charts"
import { EmptyState, ExceptionList, ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { useNotifications } from "@/hooks/use-workspace"
import { useOwnerPack } from "@/hooks/use-analytics"
import { useReadyJobs } from "@/hooks/use-dispatch"
import { useInventoryHealthSummary } from "@/hooks/use-inventory"
import { usePlanningBoard, usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrders } from "@/hooks/use-sales"
import { ERP_CHART_THEME, MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { jobCardRef } from "@/lib/job-card-display"
import { LANDING_LABELS, LANDING_QUICK_ACTIONS, type LandingRole } from "@/lib/workspace"
import { formatMetric } from "@/lib/reporting"

type LandingCopy = {
  badge: string
  title: string
  description: string
}

type CountRow = {
  label: string
  value: number
}

const LANDING_COPY: Record<LandingRole, LandingCopy> = {
  Owner: {
    badge: "Owner Workspace",
    title: "Board-pack metrics, cross-role alerts, and intervention-ready manufacturing truth",
    description: "A daily close surface for production, stock, OTIF, variance, scrap exposure, and the role transitions that move the company.",
  },
  Admin: {
    badge: "Admin Workspace",
    title: "Access governance, cross-plant operations, and exception visibility in one workspace",
    description: "Role matrix, user access posture, and the same operational pulse owners use, without leaving the ERP shell.",
  },
  PlantManager: {
    badge: "Plant Manager Workspace",
    title: "Machine loading, route pressure, and floor exceptions for the current plant scope",
    description: "Schedule the route, clear bottlenecks, and keep the shop floor moving with real queue and exception signals.",
  },
  Planner: {
    badge: "Planner Workspace",
    title: "Order release, specification readiness, and schedule pressure across the execution spine",
    description: "A planner-first landing with release velocity, queue pressure, and the actions that convert demand into executable work.",
  },
  Store: {
    badge: "Store Workspace",
    title: "Inventory health, reservation pressure, and dispatch readiness in one operational surface",
    description: "Track stock posture, protect reservations, and keep finished goods flowing cleanly into dispatch.",
  },
  Sales: {
    badge: "Sales Workspace",
    title: "Commercial demand, backlog pressure, and customer handoff readiness",
    description: "See release health, delayed orders, and dispatch readiness without dropping into separate modules.",
  },
  Dispatch: {
    badge: "Dispatch Workspace",
    title: "Finished goods readiness, challan pressure, and handoff exceptions",
    description: "See newly created FG, pending challans, blocked dispatches, and what must leave next.",
  },
  Operator: {
    badge: "Operator Workspace",
    title: "QR scan work, assigned stages, and simple input actions for the floor",
    description: "A narrow landing for job-card scanning, stage entry, and work that needs operator input.",
  },
}

const ROLE_ICONS = {
  Owner: ReceiptText,
  Admin: ShieldAlert,
  PlantManager: Factory,
  Planner: ClipboardCheck,
  Store: Warehouse,
  Dispatch: Truck,
  Sales: ShoppingCart,
  Operator: Wrench,
} satisfies Record<LandingRole, any>

function statusCounts(rows: any[], key: string): CountRow[] {
  const map = new Map<string, number>()
  rows.forEach((row) => {
    const label = String(row?.[key] || "unknown")
    map.set(label, (map.get(label) || 0) + 1)
  })
  return Array.from(map.entries()).map(([label, value]) => ({ label, value }))
}

function buildStageLoadRows(board: any): CountRow[] {
  const stages = Array.isArray(board?.stages) ? board.stages : []
  return stages.map((stage: any) => {
    const lanes = Array.isArray(stage?.lanes) ? stage.lanes : []
    const jobs = lanes.reduce((sum: number, lane: any) => sum + Number(lane?.jobs?.length || 0), 0)
    return {
      label: String(stage?.stage || stage?.stage_type || "Stage").replaceAll("_", " "),
      value: jobs,
    }
  })
}

function buildExceptionCards(data: {
  delayedOrders: any[]
  blockedRows: any[]
  lowStockRows: any[]
  activeHolds: any[]
}) {
  return [
    ...data.delayedOrders.slice(0, 2).map((row: any) => ({
      id: `delay-${row.order_id}`,
      title: `${row.order_no || row.order_id} delayed`,
      detail: `${row.customer_name || "-"} due ${row.due_date || "-"}`,
      tone: "BLOCKED",
    })),
    ...data.blockedRows.slice(0, 2).map((row: any) => ({
      id: `blocked-${row.job_card_id}`,
      title: `${jobCardRef(row)} blocked`,
      detail: `${row.customer_name || "-"} at ${row.current_stage || "route"}`,
      tone: "QC_HOLD",
    })),
    ...data.lowStockRows.slice(0, 2).map((row: any) => ({
      id: `low-stock-${row.id}`,
      title: `${row.name || row.item_code || row.id} low stock`,
      detail: `${formatMetric(row.available_qty)} available against current demand`,
      tone: "READY",
    })),
    ...data.activeHolds.slice(0, 2).map((row: any, index: number) => ({
      id: `hold-${row.id || index}`,
      title: `QC hold ${jobCardRef(row)}`,
      detail: row.reason || row.hold_reason || "Active quality hold",
      tone: "QC_HOLD",
    })),
  ]
}

export function RoleLanding({ landingRole }: { landingRole: LandingRole }) {
  const copy = LANDING_COPY[landingRole]
  const Icon = ROLE_ICONS[landingRole]
  const canUseOwnerPack = landingRole === "Owner" || landingRole === "Admin"
  const { activePlant } = useAuth()
  const { data: ownerPack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, {
    enabled: canUseOwnerPack && Boolean(activePlant),
  })
  const { data: salesOrders } = useSalesOrders()
  const { data: planningBoard } = usePlanningBoard(undefined, undefined, true, activePlant || undefined, Boolean(activePlant))
  const { data: jobCards } = usePlanningJobCards()
  const { data: inventoryHealth } = useInventoryHealthSummary()
  const { data: readyJobs } = useReadyJobs(activePlant)
  const { data: notifications } = useNotifications(true)

  const orderRows = Array.isArray(salesOrders) ? salesOrders : []
  const jobCardRows = Array.isArray(jobCards) ? jobCards : []
  const readyDispatchRows = Array.isArray(readyJobs) ? readyJobs : []
  const stageLoadRows = buildStageLoadRows(planningBoard)
  const orderStatusRows = statusCounts(orderRows, "status")
  const blockedRows = Array.isArray(ownerPack?.production?.blocked_rows) ? ownerPack.production.blocked_rows : []
  const delayedOrders = Array.isArray(ownerPack?.sales?.delayed_rows) ? ownerPack.sales.delayed_rows : []
  const lowStockRows = Array.isArray(ownerPack?.inventory?.risk_items?.low_stock) ? ownerPack.inventory.risk_items.low_stock : []
  const activeHolds = Array.isArray(ownerPack?.exceptions?.active_holds) ? ownerPack.exceptions.active_holds : []
  const ownerSeries = Array.isArray(ownerPack?.production?.series) ? ownerPack.production.series : []
  const ownerHeadline: any = (ownerPack as any)?.headline || {}
  const inventorySummary: any = (inventoryHealth as any)?.summary || {}
  const notificationItems = Array.isArray(notifications?.items) ? notifications.items.slice(0, 5) : []

  const stageBacklog = stageLoadRows.reduce((sum: number, row: CountRow) => sum + row.value, 0)
  const blockedJobs = blockedRows.length || jobCardRows.filter((row: any) => String(row.status || "").toUpperCase().includes("BLOCK")).length
  const lowStockCount = Number(inventorySummary.low_stock_items || inventorySummary.low_stock_count || ownerHeadline.low_stock_items || lowStockRows.length || 0)
  const activeQcHolds = Number(ownerHeadline.active_qc_holds || activeHolds.length || 0)
  const backlogOrders = Number(
    ownerHeadline.backlog_orders ||
      orderRows.filter((row: any) => ["partially_released", "released", "partially_dispatched"].includes(row.status)).length ||
      0,
  )
  const delayedCount = Number(ownerHeadline.delayed_orders || delayedOrders.length || 0)
  const readyDispatchCount = readyDispatchRows.length || Number(ownerPack?.dispatch?.summary?.ready_job_count || 0)
  const exceptions = buildExceptionCards({ delayedOrders, blockedRows, lowStockRows, activeHolds })

  const commonMetrics = {
    backlogOrders,
    blockedJobs,
    lowStockCount,
    readyDispatchCount,
    activeQcHolds,
    dispatchQty: Number(ownerHeadline.dispatch_qty || 0),
    inventoryValue: Number(ownerHeadline.inventory_value || inventorySummary.total_value || 0),
    activeJobCards: Number(ownerHeadline.active_job_cards || jobCardRows.length || 0),
    otifPercent: Number(ownerHeadline.otif_percent || 0),
    scheduleAdherence: Number(ownerPack?.production?.summary?.schedule_adherence_percent || 0),
  }

  const metricsByRole: Record<LandingRole, Array<{ label: string; value: string; detail: string; icon: any; tone: "cyan" | "amber" | "rose" | "emerald" | "violet" | "slate" }>> = {
    Owner: [
      { label: "Active Job Cards", value: formatMetric(commonMetrics.activeJobCards), detail: "Cross-plant execution load", icon: Factory, tone: "cyan" },
      { label: "Backlog Orders", value: formatMetric(commonMetrics.backlogOrders), detail: "Partially released, released, or partially dispatched", icon: ReceiptText, tone: "amber" },
      { label: "Inventory Value", value: formatMetric(commonMetrics.inventoryValue), detail: "RM, WIP, and FG combined", icon: Warehouse, tone: "violet" },
      { label: "OTIF", value: formatMetric(commonMetrics.otifPercent, "%", 1), detail: "Closed on time and in full", icon: PackageCheck, tone: "emerald" },
    ],
    Admin: [
      { label: "Active Job Cards", value: formatMetric(commonMetrics.activeJobCards), detail: "Cross-plant execution load", icon: Factory, tone: "cyan" },
      { label: "Blocked Jobs", value: formatMetric(commonMetrics.blockedJobs), detail: "Role handoff or floor issues", icon: ShieldAlert, tone: "rose" },
      { label: "Low-stock Items", value: formatMetric(commonMetrics.lowStockCount), detail: "Inventory risk requiring admin visibility", icon: AlertTriangle, tone: "amber" },
      { label: "Ready Dispatches", value: formatMetric(commonMetrics.readyDispatchCount), detail: "Finished jobs ready for handoff", icon: Truck, tone: "emerald" },
    ],
    PlantManager: [
      { label: "Stage Backlog", value: formatMetric(stageBacklog), detail: "Jobs across planned route stages", icon: Factory, tone: "cyan" },
      { label: "Blocked Jobs", value: formatMetric(commonMetrics.blockedJobs), detail: "Cards held away from clean flow", icon: ShieldAlert, tone: "rose" },
      { label: "Schedule Adherence", value: formatMetric(commonMetrics.scheduleAdherence, "%", 1), detail: "Planned vs actual completion", icon: ClipboardCheck, tone: "amber" },
      { label: "Ready Dispatches", value: formatMetric(commonMetrics.readyDispatchCount), detail: "FG jobs waiting to move", icon: Truck, tone: "emerald" },
    ],
    Planner: [
      { label: "Backlog Orders", value: formatMetric(commonMetrics.backlogOrders), detail: "Released demand still moving through the system", icon: ShoppingCart, tone: "cyan" },
      { label: "Blocked Jobs", value: formatMetric(commonMetrics.blockedJobs), detail: "Plan-to-floor interruptions", icon: ShieldAlert, tone: "rose" },
      { label: "Low-stock Items", value: formatMetric(commonMetrics.lowStockCount), detail: "Material pressure against release", icon: AlertTriangle, tone: "amber" },
      { label: "Active Job Cards", value: formatMetric(commonMetrics.activeJobCards), detail: "Cards already on the execution spine", icon: ClipboardCheck, tone: "violet" },
    ],
    Store: [
      { label: "Low-stock Items", value: formatMetric(commonMetrics.lowStockCount), detail: "Immediate replenishment or release review", icon: Warehouse, tone: "rose" },
      { label: "Ready Dispatches", value: formatMetric(commonMetrics.readyDispatchCount), detail: "Jobs that can move into handoff", icon: Truck, tone: "emerald" },
      { label: "Inventory Value", value: formatMetric(commonMetrics.inventoryValue), detail: "Current stock value in scope", icon: PackageCheck, tone: "cyan" },
      { label: "QC Holds", value: formatMetric(commonMetrics.activeQcHolds), detail: "Stock blocked from issue or dispatch", icon: FlaskConical, tone: "amber" },
    ],
    Sales: [
      { label: "Backlog Orders", value: formatMetric(commonMetrics.backlogOrders), detail: "Released demand still open", icon: ReceiptText, tone: "amber" },
      { label: "Delayed Orders", value: formatMetric(delayedCount), detail: "Customer commitments already beyond due date", icon: AlertTriangle, tone: "rose" },
      { label: "Dispatch Qty", value: formatMetric(commonMetrics.dispatchQty), detail: "Commercial handoff captured in reports", icon: Truck, tone: "emerald" },
      { label: "OTIF", value: formatMetric(commonMetrics.otifPercent, "%", 1), detail: "On-time in-full performance", icon: PackageCheck, tone: "cyan" },
    ],
    Dispatch: [
      { label: "Ready Dispatches", value: formatMetric(commonMetrics.readyDispatchCount), detail: "FG jobs waiting for challan flow", icon: Truck, tone: "emerald" },
      { label: "Dispatch Qty", value: formatMetric(commonMetrics.dispatchQty), detail: "Quantity already moved in the window", icon: PackageCheck, tone: "cyan" },
      { label: "Blocked Jobs", value: formatMetric(commonMetrics.blockedJobs), detail: "Jobs stopping clean dispatch", icon: ShieldAlert, tone: "rose" },
      { label: "Backlog Orders", value: formatMetric(commonMetrics.backlogOrders), detail: "Commercial demand still open", icon: ReceiptText, tone: "amber" },
    ],
    Operator: [
      { label: "Open Job Cards", value: formatMetric(commonMetrics.activeJobCards), detail: "Cards available for floor action", icon: Factory, tone: "cyan" },
      { label: "Stage Backlog", value: formatMetric(stageBacklog), detail: "Work standing across stages", icon: ClipboardCheck, tone: "violet" },
      { label: "Blocked Jobs", value: formatMetric(commonMetrics.blockedJobs), detail: "Cards needing supervisor attention", icon: ShieldAlert, tone: "rose" },
      { label: "QC Holds", value: formatMetric(commonMetrics.activeQcHolds), detail: "Lots blocked from clean movement", icon: FlaskConical, tone: "amber" },
    ],
  }

  const focusChartData =
    landingRole === "Owner" || landingRole === "Admin"
      ? ownerSeries.slice(-6)
      : landingRole === "Sales"
      ? orderStatusRows
      : landingRole === "Store"
      ? [
          { label: "Low Stock", value: commonMetrics.lowStockCount },
          { label: "Blocked", value: Number(inventorySummary.blocked_qty || 0) },
          { label: "Awaiting Dispatch", value: readyDispatchCount },
          { label: "Ready Dispatch", value: commonMetrics.readyDispatchCount },
        ]
      : landingRole === "Dispatch"
      ? [
          { label: "Ready", value: commonMetrics.readyDispatchCount },
          { label: "Moved", value: commonMetrics.dispatchQty },
          { label: "Blocked", value: commonMetrics.blockedJobs },
        ]
      : stageLoadRows

  const focusChartTitle =
    landingRole === "Owner" || landingRole === "Admin"
      ? "Board Pack Throughput"
      : landingRole === "Sales"
      ? "Sales Order Mix"
      : landingRole === "Store"
      ? "Stock Pressure"
      : landingRole === "Dispatch"
      ? "Dispatch Pressure"
      : "Stage Load"

  const focusChartSubtitle =
    landingRole === "Owner" || landingRole === "Admin"
      ? "Recent production movement from the board pack."
      : landingRole === "Sales"
      ? "Live sales-order counts grouped by current status."
      : landingRole === "Store"
      ? "Inventory, section issue readiness, and dispatch pressure in the current workspace."
      : landingRole === "Dispatch"
      ? "Finished-goods handoff and dispatch exception counts."
      : "Active jobs grouped by the current planning board stages."

  return (
    <div className="space-y-6" data-testid="workspace-role-landing" data-role={landingRole}>
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.dashboard}
        badge={copy.badge}
        title={copy.title}
        description={copy.description}
        aside={
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100">{LANDING_LABELS[landingRole]}</p>
                <p className="mt-2 text-2xl font-semibold">{formatMetric(commonMetrics.activeJobCards)}</p>
                <p className="mt-2 text-xs text-slate-200">active cards</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100">Cross-role alerts</p>
                <p className="mt-2 text-2xl font-semibold">{notificationItems.length}</p>
                <p className="mt-2 text-xs text-slate-200">recent notifications</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge value={commonMetrics.blockedJobs > 0 ? "BLOCKED" : "ACTIVE"} label={`${formatMetric(commonMetrics.blockedJobs)} blocked jobs`} />
              <StatusBadge value={commonMetrics.lowStockCount > 0 ? "READY" : "ACTIVE"} label={`${formatMetric(commonMetrics.lowStockCount)} low-stock items`} />
              <StatusBadge value={commonMetrics.activeQcHolds > 0 ? "QC_HOLD" : "ACTIVE"} label={`${formatMetric(commonMetrics.activeQcHolds)} QC holds`} />
            </div>
          </div>
        }
        actions={
          <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white/90">
            <Icon className="h-4 w-4" />
            {LANDING_LABELS[landingRole]} landing
          </div>
        }
      />

      <MetricRail>
        {metricsByRole[landingRole].map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            icon={metric.icon}
            tone={metric.tone}
          />
        ))}
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Quick Actions" subtitle="Role-first entry points into the ERP workflow.">
          <div className="grid gap-3">
            {LANDING_QUICK_ACTIONS[landingRole].map((action) => (
              <Link
                key={`${action.href}:${action.label}`}
                href={action.href}
                className="rounded-[1.15rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{action.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{action.detail}</p>
                  </div>
                  <StatusBadge value="ACTIVE" label="Open" />
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Cross-app Notifications" subtitle="Recent alerts routed into this workspace from other ERP flows.">
          {notificationItems.length === 0 ? (
            <EmptyState label="No recent workflow notifications are available." />
          ) : (
            <div className="space-y-3">
              {notificationItems.map((item: any) => (
                <Link
                  key={item.id}
                  href={item.href || "/dashboard"}
                  className="block rounded-[1.15rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-slate-100 p-2 text-slate-600">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                        {item.role_context ? <StatusBadge value={item.role_context} label={item.role_context} /> : null}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartPanel title={focusChartTitle} subtitle={focusChartSubtitle}>
          {focusChartData.length > 0 ? (
            <ChartBox height={320}>
              {landingRole === "Owner" || landingRole === "Admin" ? (
                <AreaChart data={focusChartData}>
                  <defs>
                    <linearGradient id="workspaceThroughputPrimary" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ERP_CHART_THEME.palette[0]} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={ERP_CHART_THEME.palette[0]} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="workspaceThroughputSecondary" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ERP_CHART_THEME.palette[2]} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={ERP_CHART_THEME.palette[2]} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={ERP_CHART_THEME.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <ChartTooltip />
                  <Area type="monotone" dataKey="winder_qty" stroke={ERP_CHART_THEME.palette[0]} fill="url(#workspaceThroughputPrimary)" strokeWidth={2.5} name="Winder" />
                  <Area type="monotone" dataKey="process_qty" stroke={ERP_CHART_THEME.palette[2]} fill="url(#workspaceThroughputSecondary)" strokeWidth={2.5} name="Process" />
                  <Area type="monotone" dataKey="dispatch_qty" stroke={ERP_CHART_THEME.palette[4]} fillOpacity={0} strokeWidth={2.5} name="Dispatch" />
                </AreaChart>
              ) : (
                <BarChart data={focusChartData}>
                  <CartesianGrid stroke={ERP_CHART_THEME.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <ChartTooltip />
                  <Bar dataKey="value" fill={ERP_CHART_THEME.palette[0]} radius={[6, 6, 0, 0]} name="Count" />
                </BarChart>
              )}
            </ChartBox>
          ) : (
            <ChartEmptyState label="No chart-ready data is available for this landing yet." />
          )}
        </ChartPanel>

        <Panel title="Deep-link Queues" subtitle="Live counters tied directly to the ERP modules behind this landing.">
          <div className="space-y-3">
            <Link href="/sales-orders" className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
              <div>
                <p className="text-sm font-semibold text-slate-950">Sales Orders</p>
                <p className="text-xs text-slate-500">Demand and release posture</p>
              </div>
              <p className="text-lg font-semibold text-slate-950">{formatMetric(orderRows.length)}</p>
            </Link>
            <Link href="/planning/board?section=winder" className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
              <div>
                <p className="text-sm font-semibold text-slate-950">Planning Board</p>
                <p className="text-xs text-slate-500">Stage backlog and schedule load</p>
              </div>
              <p className="text-lg font-semibold text-slate-950">{formatMetric(stageBacklog)}</p>
            </Link>
            <Link href="/production/job-cards" className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
              <div>
                <p className="text-sm font-semibold text-slate-950">Job Cards</p>
                <p className="text-xs text-slate-500">Execution cards currently in play</p>
              </div>
              <p className="text-lg font-semibold text-slate-950">{formatMetric(jobCardRows.length)}</p>
            </Link>
            <Link href="/inventory" className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
              <div>
                <p className="text-sm font-semibold text-slate-950">Inventory</p>
                <p className="text-xs text-slate-500">Low-stock and dispatch-allocation posture</p>
              </div>
              <p className="text-lg font-semibold text-slate-950">{formatMetric(commonMetrics.lowStockCount)}</p>
            </Link>
          </div>
        </Panel>
      </div>

      <Panel title="Assigned Exceptions" subtitle="High-signal issues surfaced from the live owner pack and operational services.">
        {exceptions.length > 0 ? (
          <ExceptionList items={exceptions} emptyLabel="No active exceptions are currently assigned to this landing." />
        ) : (
          <EmptyState label="No active exceptions are currently assigned to this landing." />
        )}
      </Panel>
    </div>
  )
}
