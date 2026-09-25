"use client"

import { CommandCenter } from "@/components/workspace/command-center"

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
import { useSalesOrderAggregates, useSalesOrders } from "@/hooks/use-sales"
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
  QC: {
    badge: "Quality Control Workspace",
    title: "Inspections, holds, and proposed dispositions for the authorized plant",
    description: "Read assigned item, spec, job, and receipt context. Sign inspections and create holds without user-admin, sales-approval, or stock-adjust powers.",
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
  QC: FlaskConical,
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
  return <CommandCenter role={landingRole} />
}
