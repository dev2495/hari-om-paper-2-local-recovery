import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Factory,
  FlaskConical,
  Layers3,
  Package,
  PackageCheck,
  ReceiptText,
  ScrollText,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Warehouse,
  Wrench,
} from "lucide-react"

export type StatusAppearance = {
  label: string
  className: string
  accentClassName: string
  dotClassName: string
  icon: LucideIcon
}

export type ModuleAppearance = {
  title: string
  eyebrow: string
  description: string
  accent: string
  surface: string
  icon: LucideIcon
}

export type ChartTheme = {
  grid: string
  axis: string
  text: string
  mutedText: string
  tooltipClassName: string
  palette: string[]
}

export type ReportFilterState = {
  startDate: string
  endDate: string
  plant: string
  granularity: "day" | "week" | "month"
}

export type BoardPackSection = {
  id: string
  title: string
  description: string
}

export type ExportableReportDefinition = {
  id: string
  title: string
  description: string
  sections: BoardPackSection[]
}

export const MODULE_APPEARANCES: Record<string, ModuleAppearance> = {
  dashboard: {
    title: "Owner Command Center",
    eyebrow: "Executive Control",
    description: "Cross-plant manufacturing truth, delivery risk, and financial inventory posture in one surface.",
    accent: "from-cyan-950 via-sky-800 to-emerald-500",
    surface: "from-cyan-50 via-white to-emerald-50",
    icon: BarChart3,
  },
  analytics: {
    title: "Reports and KPI Suite",
    eyebrow: "Board Pack",
    description: "Interactive, export-ready analytics for production, quality, sales, dispatch, and exceptions.",
    accent: "from-foreground via-indigo-800 to-sky-500",
    surface: "from-indigo-50 via-white to-sky-50",
    icon: ReceiptText,
  },
  inventory: {
    title: "Inventory Health",
    eyebrow: "Stores Intelligence",
    description: "Raw, WIP, and FG readiness with aging, blocked stock, location pressure, and dispatch readiness risk.",
    accent: "from-amber-950 via-orange-700 to-cyan-500",
    surface: "from-amber-50 via-white to-orange-50",
    icon: Warehouse,
  },
  planning: {
    title: "Planning Control Tower",
    eyebrow: "Finite Capacity",
    description: "Shift-aware scheduling, machine allocation, and route visibility across the production flow.",
    accent: "from-foreground via-violet-800 to-cyan-500",
    surface: "from-violet-50 via-white to-sky-50",
    icon: Factory,
  },
  dispatch: {
    title: "Dispatch Readiness",
    eyebrow: "Customer Handoff",
    description: "Seal dispatch only after QC truth, FG lot allocation, and finished-good readiness are aligned.",
    accent: "from-foreground via-cyan-800 to-sky-500",
    surface: "from-sky-50 via-white to-cyan-50",
    icon: Truck,
  },
  sales: {
    title: "Sales Flow",
    eyebrow: "Commercial Execution",
    description: "Spec-driven orders, release discipline, planner handoff, and line-by-line delivery tracking.",
    accent: "from-emerald-950 via-teal-800 to-cyan-500",
    surface: "from-emerald-50 via-white to-cyan-50",
    icon: ShoppingCart,
  },
  jobCards: {
    title: "Job Card Truth",
    eyebrow: "Execution Spine",
    description: "Planned vs issued vs produced vs packed vs dispatched, with supervisor truth and audit-safe flow.",
    accent: "from-foreground via-foreground to-emerald-500",
    surface: "from-slate-50 via-white to-emerald-50",
    icon: ClipboardCheck,
  },
}

export const MODULE_NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": BarChart3,
  "/reports": ReceiptText,
  "/sales-orders": ShoppingCart,
  "/planning": Factory,
  "/planning/board": Factory,
  "/job-cards": ClipboardCheck,
  "/production/job-cards": ClipboardCheck,
  "/production/supervisor-entry": Wrench,
  "/production/reconciliation": ScrollText,
  "/logistics/dispatch": Truck,
  "/dispatch": Truck,
  "/supervisor-entry": Wrench,
  "/inventory": Warehouse,
  "/masters": ShieldCheck,
  "/inventory/items": Boxes,
  "/inventory/raw-material-inward": ArrowRightLeft,
  "/inventory/reels/inward": ScanLine,
  "/inventory/reels/issue": Package,
  "/inventory/production-issue": Layers3,
  "/inventory/ledger": ReceiptText,
  "/inventory/valuation": Building2,
}

export const STAGE_APPEARANCES: Record<string, StatusAppearance> = {
  WINDER: {
    label: "Winder",
    className: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Wrench,
  },
  OVEN: {
    label: "Oven",
    className: "border-signal-orange-line bg-signal-orange-soft text-signal-orange-ink",
    accentClassName: "from-orange-500/20 via-orange-500/10 to-transparent",
    dotClassName: "bg-orange-500",
    icon: FlaskConical,
  },
  PROCESS: {
    label: "Process",
    className: "border-signal-indigo-line bg-signal-indigo-soft text-signal-indigo-ink",
    accentClassName: "from-indigo-500/20 via-indigo-500/10 to-transparent",
    dotClassName: "bg-indigo-500",
    icon: Factory,
  },
  PACKING: {
    label: "Packing",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: PackageCheck,
  },
  QC: {
    label: "QC",
    className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: ShieldCheck,
  },
  DISPATCH: {
    label: "Dispatch",
    className: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: Truck,
  },
  DONE: {
    label: "Done",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
}

export const STATUS_APPEARANCES: Record<string, StatusAppearance> = {
  APPROVED: {
    label: "Approved",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  RELEASED: {
    label: "Released",
    className: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: ArrowRightLeft,
  },
  PARTIALLY_RELEASED: {
    label: "Partially Released",
    className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: ArrowRightLeft,
  },
  PARTIALLY_DISPATCHED: {
    label: "Partially Dispatched",
    className: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Truck,
  },
  CLOSED: {
    label: "Closed",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  DRAFT: {
    label: "Draft",
    className: "border-border bg-muted text-muted-foreground",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: CircleDashed,
  },
  SUBMITTED: {
    label: "Submitted",
    className: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink",
    accentClassName: "from-violet-500/20 via-violet-500/10 to-transparent",
    dotClassName: "bg-violet-500",
    icon: ReceiptText,
  },
  PLANNED: {
    label: "Planned",
    className: "border-signal-indigo-line bg-signal-indigo-soft text-signal-indigo-ink",
    accentClassName: "from-indigo-500/20 via-indigo-500/10 to-transparent",
    dotClassName: "bg-indigo-500",
    icon: Factory,
  },
  ASSIGNED: {
    label: "Assigned",
    className: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Wrench,
  },
  IN_PROGRESS: {
    label: "In Progress",
    className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: CircleDashed,
  },
  COMPLETED: {
    label: "Completed",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  HOLD: {
    label: "QC Hold",
    className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: ShieldAlert,
  },
  QC_HOLD: {
    label: "QC Hold",
    className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: ShieldAlert,
  },
  RELEASED_HOLD: {
    label: "Hold Released",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: ShieldCheck,
  },
  BLOCKED: {
    label: "Blocked",
    className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: AlertTriangle,
  },
  ACTIVE: {
    label: "Active",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  CONSUMED: {
    label: "Consumed",
    className: "border-border bg-muted text-muted-foreground",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: Layers3,
  },
  SEALED: {
    label: "Sealed",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: Truck,
  },
  READY: {
    label: "Ready",
    className: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: PackageCheck,
  },
  UNRESTRICTED: {
    label: "Unrestricted",
    className: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  WIP: {
    label: "WIP",
    className: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: Layers3,
  },
  DISPATCH_STAGING: {
    label: "Dispatch Staging",
    className: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: Truck,
  },
  SCRAP: {
    label: "Scrap",
    className: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: AlertTriangle,
  },
}

export const ERP_CHART_THEME: ChartTheme = {
  grid: "hsl(var(--chart-grid))",
  axis: "hsl(var(--chart-axis))",
  text: "hsl(var(--foreground))",
  mutedText: "hsl(var(--muted-foreground))",
  tooltipClassName:
    "min-w-[160px] rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-pop backdrop-blur",
  palette: [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--chart-6))",
    "hsl(var(--chart-7))",
    "hsl(var(--chart-8))",
  ],
}

export const REPORT_DEFINITIONS: ExportableReportDefinition[] = [
  {
    id: "owner-pack",
    title: "Owner Command Center",
    description: "Board-pack summary of production truth, commercial risk, inventory posture, and dispatch readiness.",
    sections: [
      { id: "headlines", title: "Headlines", description: "Top-line KPIs, throughput, backlog, and active risk." },
      { id: "operations", title: "Operations", description: "Machine and route-level flow, utilization, and stage readiness." },
      { id: "inventory", title: "Inventory", description: "RM, WIP, FG health, blocked stock, and dispatch readiness pressure." },
      { id: "exceptions", title: "Exceptions", description: "Delayed orders, quality holds, stockouts, and blocked jobs." },
    ],
  },
  {
    id: "plant-compare",
    title: "Plant Compare",
    description: "Cross-plant comparison of throughput, inventory value, delivery risk, and quality pressure.",
    sections: [
      { id: "compare", title: "Plant Compare", description: "Plant-by-plant scoreboard for throughput, WIP, and OTIF." },
    ],
  },
]

export function getAppearance(status?: string | null, fallbackLabel?: string): StatusAppearance {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized && STAGE_APPEARANCES[normalized]) return STAGE_APPEARANCES[normalized]
  if (normalized && STATUS_APPEARANCES[normalized]) return STATUS_APPEARANCES[normalized]
  return {
    label: fallbackLabel || status || "Unknown",
    className: "border-border bg-muted text-muted-foreground",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: CircleDashed,
  }
}
