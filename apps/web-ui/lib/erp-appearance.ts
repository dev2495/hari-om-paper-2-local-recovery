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
    accent: "from-slate-950 via-indigo-800 to-sky-500",
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
    accent: "from-slate-950 via-violet-800 to-cyan-500",
    surface: "from-violet-50 via-white to-sky-50",
    icon: Factory,
  },
  dispatch: {
    title: "Dispatch Readiness",
    eyebrow: "Customer Handoff",
    description: "Seal dispatch only after QC truth, FG lot allocation, and finished-good readiness are aligned.",
    accent: "from-slate-950 via-cyan-800 to-sky-500",
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
    accent: "from-slate-950 via-slate-700 to-emerald-500",
    surface: "from-slate-50 via-white to-emerald-50",
    icon: ClipboardCheck,
  },
}

export const MODULE_NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": BarChart3,
  "/reports": ReceiptText,
  "/sales-orders": ShoppingCart,
  "/planning": Factory,
  "/job-cards": ClipboardCheck,
  "/production/job-cards": ClipboardCheck,
  "/production/supervisor-entry": Wrench,
  "/production/reconciliation": ScrollText,
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
    className: "border-cyan-200 bg-cyan-50 text-cyan-900",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Wrench,
  },
  OVEN: {
    label: "Oven",
    className: "border-orange-200 bg-orange-50 text-orange-900",
    accentClassName: "from-orange-500/20 via-orange-500/10 to-transparent",
    dotClassName: "bg-orange-500",
    icon: FlaskConical,
  },
  PROCESS: {
    label: "Process",
    className: "border-indigo-200 bg-indigo-50 text-indigo-900",
    accentClassName: "from-indigo-500/20 via-indigo-500/10 to-transparent",
    dotClassName: "bg-indigo-500",
    icon: Factory,
  },
  PACKING: {
    label: "Packing",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: PackageCheck,
  },
  QC: {
    label: "QC",
    className: "border-amber-200 bg-amber-50 text-amber-900",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: ShieldCheck,
  },
  DISPATCH: {
    label: "Dispatch",
    className: "border-sky-200 bg-sky-50 text-sky-900",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: Truck,
  },
  DONE: {
    label: "Done",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
}

export const STATUS_APPEARANCES: Record<string, StatusAppearance> = {
  APPROVED: {
    label: "Approved",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  RELEASED: {
    label: "Released",
    className: "border-sky-200 bg-sky-50 text-sky-900",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: ArrowRightLeft,
  },
  PARTIALLY_DISPATCHED: {
    label: "Partially Dispatched",
    className: "border-cyan-200 bg-cyan-50 text-cyan-900",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Truck,
  },
  CLOSED: {
    label: "Closed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  DRAFT: {
    label: "Draft",
    className: "border-slate-200 bg-slate-100 text-slate-800",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: CircleDashed,
  },
  SUBMITTED: {
    label: "Submitted",
    className: "border-violet-200 bg-violet-50 text-violet-900",
    accentClassName: "from-violet-500/20 via-violet-500/10 to-transparent",
    dotClassName: "bg-violet-500",
    icon: ReceiptText,
  },
  PLANNED: {
    label: "Planned",
    className: "border-indigo-200 bg-indigo-50 text-indigo-900",
    accentClassName: "from-indigo-500/20 via-indigo-500/10 to-transparent",
    dotClassName: "bg-indigo-500",
    icon: Factory,
  },
  ASSIGNED: {
    label: "Assigned",
    className: "border-cyan-200 bg-cyan-50 text-cyan-900",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: Wrench,
  },
  IN_PROGRESS: {
    label: "In Progress",
    className: "border-amber-200 bg-amber-50 text-amber-900",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: CircleDashed,
  },
  COMPLETED: {
    label: "Completed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  HOLD: {
    label: "QC Hold",
    className: "border-rose-200 bg-rose-50 text-rose-900",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: ShieldAlert,
  },
  QC_HOLD: {
    label: "QC Hold",
    className: "border-rose-200 bg-rose-50 text-rose-900",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: ShieldAlert,
  },
  RELEASED_HOLD: {
    label: "Hold Released",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: ShieldCheck,
  },
  BLOCKED: {
    label: "Blocked",
    className: "border-rose-200 bg-rose-50 text-rose-900",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: AlertTriangle,
  },
  ACTIVE: {
    label: "Active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  CONSUMED: {
    label: "Consumed",
    className: "border-slate-200 bg-slate-100 text-slate-800",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: Layers3,
  },
  SEALED: {
    label: "Sealed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: Truck,
  },
  READY: {
    label: "Ready",
    className: "border-cyan-200 bg-cyan-50 text-cyan-900",
    accentClassName: "from-cyan-500/20 via-cyan-500/10 to-transparent",
    dotClassName: "bg-cyan-500",
    icon: PackageCheck,
  },
  UNRESTRICTED: {
    label: "Unrestricted",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    accentClassName: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  WIP: {
    label: "WIP",
    className: "border-amber-200 bg-amber-50 text-amber-900",
    accentClassName: "from-amber-500/20 via-amber-500/10 to-transparent",
    dotClassName: "bg-amber-500",
    icon: Layers3,
  },
  DISPATCH_STAGING: {
    label: "Dispatch Staging",
    className: "border-sky-200 bg-sky-50 text-sky-900",
    accentClassName: "from-sky-500/20 via-sky-500/10 to-transparent",
    dotClassName: "bg-sky-500",
    icon: Truck,
  },
  SCRAP: {
    label: "Scrap",
    className: "border-rose-200 bg-rose-50 text-rose-900",
    accentClassName: "from-rose-500/20 via-rose-500/10 to-transparent",
    dotClassName: "bg-rose-500",
    icon: AlertTriangle,
  },
}

export const ERP_CHART_THEME: ChartTheme = {
  grid: "#d6dee8",
  axis: "#698091",
  text: "#102031",
  mutedText: "#5f7285",
  tooltipClassName:
    "rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-xl backdrop-blur",
  palette: ["#0284c7", "#0f766e", "#7c3aed", "#ea580c", "#dc2626", "#ca8a04", "#1d4ed8", "#047857"],
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
    className: "border-slate-200 bg-slate-100 text-slate-800",
    accentClassName: "from-slate-400/20 via-slate-300/10 to-transparent",
    dotClassName: "bg-slate-400",
    icon: CircleDashed,
  }
}
