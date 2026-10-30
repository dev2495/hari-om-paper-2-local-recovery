"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarRange, ClipboardPen, Scissors, LockKeyhole, AlertTriangle, BarChart3, Boxes, CheckCircle2, Inbox, TrendingUp, Users, Wrench, ChevronRight, ClipboardList, Factory, FileText, Gauge, Info, Layers, LineChart, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, BookOpen, ScrollText, Search, ShieldCheck, Sparkles, Truck, X, CircleDot, CornerDownLeft, Undo2, CalendarCheck2, ClipboardCheck, CalendarClock, BookCheck } from "lucide-react"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { PlantSwitcher } from "@/components/PlantSwitcher"
import { BooksLockedChip } from "@/components/workspace/books-locked-chip"
import { SeasonChip } from "@/components/workspace/SeasonChip"
import { NotificationCenter } from "@/components/workspace/notification-center"
import { RoleSwitcher } from "@/components/workspace/role-switcher"
import { AppearanceControls, ThemeToggle } from "@/components/workspace/appearance-controls"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { MODULE_NAVIGATION, activeModuleLink, moduleLinkBase, moduleLinkCovers } from "@/lib/module-navigation"
import { canReadJobCardAggregates, roleLabel } from "@/lib/role-matrix"
import { searchWorkspaceJumps } from "@/lib/workspace-jump"
import { RouteProgress } from "@/components/workspace/route-progress"
import { SidebarNav } from "@/components/workspace/sidebar-nav"
import { BreadcrumbCapsule } from "@/components/workspace/breadcrumb-capsule"
import { BreadcrumbLabelProvider, useBreadcrumbLabelFor } from "@/components/workspace/breadcrumb-label"
import { useNotificationSummary } from "@/hooks/use-workspace"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { useJobCardAggregates } from "@/hooks/use-production"
import { usePeopleDirectory, usePeopleReady } from "@/hooks/use-people"
import { forgetPeople } from "@/lib/people"
import { MessageMirror } from "@/components/workspace/message-mirror"

type NavLink = {
  name: string
  href: string
  icon: any
  description: string
  roles?: string[]
  ownerOnly?: boolean
}

type NavGroup = {
  title: string
  items: NavLink[]
}

const SIDEBAR_STORAGE_KEY = "hariom_sidebar_pinned_v3"
const GROUPS_STORAGE_KEY = "hariom_sidebar_groups_v1"

const navigationUnits: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        name: "Dashboard",
        href: "/dashboard",
        icon: Gauge,
        description: "Control room overview, alerts, and operating posture.",
      },
      {
        name: "Inbox",
        href: "/inbox",
        icon: Inbox,
        description: "Your role's live work queue plus every handoff, hold and approval that involves you.",
      },
      {
        name: "Guide",
        href: "/help",
        icon: BookOpen,
        description: "Flow maps, field rules, and operator checklists for each workspace.",
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        name: "Orders",
        href: "/sales-orders",
        icon: ClipboardList,
        description: "Every sales order by status: fulfilment, job cards, deliveries and one history. Replaces the order tracker.",
        roles: ["Owner", "Admin", "Sales", "Planner", "PlantManager", "Dispatch"],
      },
      {
        name: "Job Cards",
        href: "/production/job-cards",
        icon: Factory,
        description: "Track every card: status, stage, plan, QC flags; open a card for its runs, QC, plan and history.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "QC", "InProcessQC", "Operator", "Sales", "Dispatch"],
      },
      {
        name: "Job card manager",
        href: "/production/job-cards/manage",
        icon: Scissors,
        description: "Split into a new card, edit qty / colour, force close, emergency insert, cancel — with a preview and a reason.",
        roles: ["Owner", "Admin", "Planner", "PlantManager"],
      },
      {
        name: "Planner",
        href: "/planning/board",
        icon: Sparkles,
        description: "Planning overview, machine queues, shift scheduling and Split plan.",
        roles: ["Owner", "Admin", "Planner", "PlantManager"],
      },
      {
        name: "Log output",
        href: "/production/entry",
        icon: ClipboardPen,
        description: "Scan or pick a card, choose the stage and log the run (phone or PC).",
        roles: ["Owner", "Admin", "PlantManager", "Operator", "Planner"],
      },
      {
        name: "Log QC",
        href: "/production/entry?mode=qc",
        icon: ShieldCheck,
        description: "Scan or pick a card, choose the stage and enter the QC readings (operators log QC too).",
        roles: ["Owner", "Admin", "PlantManager", "Operator", "QC", "InProcessQC"],
      },
      {
        name: "Month-end close",
        href: "/production/reconciliation",
        icon: BookCheck,
        description: "Count the store, check material use against spec, close the month. Usage limits live here too.",
        roles: ["Owner", "Admin", "PlantManager"],
      },
    ],
  },
  {
    title: "Quality",
    items: [
      {
        name: "QC desk",
        href: "/quality",
        icon: ShieldCheck,
        description: "What needs QC now: incoming lots, stage checks, holds and returns.",
        roles: ["Owner", "Admin", "PlantManager", "QC", "InwardQC", "InProcessQC", "Dispatch", "Store", "Sales"],
      },
      { name: "Incoming QC", href: "/quality/incoming", icon: ClipboardList, description: "Inspect GRN lots; out-of-band readings hold the lot.", roles: ["Owner", "Admin", "QC", "InwardQC"] },
      { name: "In-process QC", href: "/quality/stage", icon: Factory, description: "Flagged readings stage by stage, and runs still waiting for their 2 QC readings.", roles: ["Owner", "Admin", "QC", "InProcessQC", "PlantManager"] },
      { name: "Holds & inspections", href: "/quality/results", icon: LockKeyhole, description: "Held inward lots and job cards, with every inspection result.", roles: ["Owner", "Admin", "QC", "InwardQC", "InProcessQC", "PlantManager", "Store", "Sales", "Dispatch"] },
      { name: "Customer complaints", href: "/quality/returns", icon: Undo2, description: "Complaints and returns: batch, customer, size, qty, reason and status, followed to closure.", roles: ["Owner", "Admin", "QC", "PlantManager", "Store", "Sales", "Dispatch"] },
      { name: "Material standards", href: "/quality/material-standards", icon: ShieldCheck, description: "The checks QC does on each incoming material.", roles: ["Owner", "Admin", "QC", "InwardQC"] },
      { name: "Process stage rules", href: "/quality/stage-rules", icon: ShieldCheck, description: "Seasonal winding, oven and process tolerances, versioned.", roles: ["Owner", "Admin", "QC"] },
      { name: "Production season", href: "/settings/production-season", icon: Factory, description: "Global season and release readiness.", ownerOnly: true },
    ],
  },
  {
    title: "Purchasing",
    items: [
      {
        name: "Purchase orders",
        href: "/purchase",
        icon: FileText,
        description: "Scheduled drafts to send, POs waiting approval, sent and waiting delivery, and every PO.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "RM inward calendar",
        href: "/purchase/scheduler",
        icon: CalendarClock,
        description: "Forward RM demand against stock and arrivals, day by day. Propose arrivals; the Owner approves them into draft POs.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager", "GRN"],
      },
      { name: "Expected arrivals", href: "/purchase/supplier-deliveries", icon: Truck, description: "What vendors should deliver: overdue, today, this week and later, each with Make GRN.", roles: ["Owner", "Admin", "Store", "Planner", "PlantManager", "GRN"] },
      { name: "Create purchase order", href: "/purchase/new", icon: FileText, description: "Multi-item PO with automatic numbering and vendor terms.", roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"] },
      { name: "Purchase requisitions", href: "/purchase/requisitions", icon: FileText, description: "Request a tool or material for Owner approval." },
      // Owner and Admin decide POs (client 2026-10-30); RM arrivals and requisitions on the page stay Owner-only.
      { name: "PO approvals", href: "/purchase/approvals", icon: ShieldCheck, description: "Approve RM arrivals, requisitions and submitted PO revisions.", roles: ["Owner", "Admin"] },
      { name: "Invoice differences", href: "/purchase/discrepancies", icon: ScrollText, description: "Review rates, quantities and specifications.", roles: ["Owner", "Admin", "Store", "Accounts", "PlantManager"] },
      { name: "Debit notes", href: "/purchase/debit-notes", icon: FileText, description: "Vendor claims, approvals and settlements.", roles: ["Owner", "Admin", "Accounts", "PlantManager"] },
      { name: "Purchase reports", href: "/purchase/registers", icon: LineChart, description: "Excel exports and printable commercial registers.", roles: ["Owner", "Admin", "Store", "Accounts", "Planner", "PlantManager"] },
    ],
  },
  {
    title: "Stores & inventory",
    items: [
      { name: "Goods inward", href: "/purchase/inward", icon: Package, description: "Manual or approved-PO receipt with individual reel and coil labels.", roles: ["Owner", "Admin", "Store", "PlantManager", "GRN"] },
      { name: "GRN register & labels", href: "/purchase/receipts", icon: ClipboardList, description: "Saved receipts, pending invoices, QC and label reprints.", roles: ["Owner", "Admin", "Store", "PlantManager", "Accounts", "GRN", "InwardQC"] },
      { name: "Reel & coil issue", href: "/inventory/reels/issue", icon: Layers, description: "Issue reels and coils to the floor by shift; each reel gets a slitting card.", roles: ["Owner", "Admin", "Store", "PlantManager", "RMIssue"] },
      { name: "Material issue", href: "/inventory/production-issue", icon: Boxes, description: "Issue adhesive, parchment and packing to the floor by shift.", roles: ["Owner", "Admin", "Store", "PlantManager", "RMIssue"] },
      { name: "Issue history", href: "/inventory/issue-history", icon: ScrollText, description: "Every issue to the floor: shift, material, reel or lot, who issued it and the rack. CSV.", roles: ["Owner", "Admin", "Store", "PlantManager", "RMIssue", "Planner", "GRN"] },
      {
        // Every logged-in role may start a count and count (client 2026-10-28); only the Owner approves.
        name: "Stock counts & book",
        href: "/inventory/stock-control",
        icon: ClipboardCheck,
        description: "Spot and month-end counts, corrections, the stock book and locations with rack labels.",
      },
      // Go-live opening stock (client 2026-10-30): Owner and Admin enter it; the page is open to view for others.
      { name: "Opening stock", href: "/inventory/opening-stock", icon: Package, description: "Go-live stock already in the plant: reels and lots with new labels, in batches on the go-live date.", roles: ["Owner", "Admin"] },
      {
        name: "Inventory",
        href: "/inventory",
        icon: Package,
        description: "Raw material inward, reel issue, balances, and valuation.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager", "GRN", "RMIssue"],
      },
      {
        name: "Genealogy",
        href: "/inventory/genealogy",
        icon: Layers,
        description: "Reel lineage, slit children, issue scans, and trace exceptions.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager", "Dispatch", "GRN", "RMIssue"],
      },
      {
        name: "Manual FG",
        href: "/inventory/fg-inward",
        icon: Package,
        description: "Rework yield, returns, and adjustments — manual FG inward outside the job-close flow.",
        roles: ["Owner", "Admin", "Store", "PlantManager"],
      },
      { name: "Stock alert policies", href: "/inventory/stock-alert-policies", icon: ShieldCheck, description: "Set material stock thresholds, lead times and replenishment rules.", roles: ["Owner", "Admin", "PlantManager"] },
      {
        name: "Stock Alerts",
        href: "/inventory/stock-alerts",
        icon: ShieldCheck,
        description: "Policy-driven stock breach inbox, ownership, and recovery.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "RM Costing",
        href: "/inventory/rm-costing",
        icon: ScrollText,
        description: "Owner and Admin standard-cost versions, impact, and audit history.",
        roles: ["Owner", "Admin"],
      },
      {
        name: "Dispatch",
        href: "/logistics/dispatch",
        icon: Truck,
        description: "Packing handoff, challans, and finished-goods release.",
        roles: ["Owner", "Admin", "Dispatch", "Sales", "Store"],
      },
    ],
  },
  {
    title: "Design",
    items: [
      {
        name: "Specifications",
        href: "/specifications",
        icon: ScrollText,
        description: "Spec sheet workspace, recipe truth, and print-ready outputs.",
        roles: ["Owner", "Admin"],
      },
    ],
  },
  {
    title: "Reports",
    items: [
      { name: "Intelligence", href: "/analytics", icon: LineChart, description: "Live KPIs for the period and the full report catalog.", roles: ["Owner", "Admin", "Planner", "PlantManager", "Store", "Dispatch", "Sales", "QC"] },
      { name: "Owner daily pack", href: "/reports/owner", icon: Gauge, description: "Board pack: order book, dispatch, OTIF, production, stock.", roles: ["Owner", "Admin"] },
      { name: "Operations command", href: "/reports/operations", icon: Factory, description: "Stage throughput, adherence and blockers.", roles: ["PlantManager", "Planner"] },
      { name: "Throughput", href: "/reports/production", icon: BarChart3, description: "Per-stage and per-machine output.", roles: ["PlantManager", "Planner"] },
      { name: "Planning performance", href: "/reports/planning", icon: CalendarRange, description: "How well the plan held: slots done in their shift, machine load, missed slots and stages finished on time.", roles: ["PlantManager", "Planner"] },
      { name: "Plan vs actual", href: "/reports/plan-vs-actual", icon: CalendarCheck2, description: "Did each floor run happen on the planned day, shift and machine? Runs before planning and missed slots.", roles: ["PlantManager", "Planner"] },
      { name: "Sales pulse", href: "/reports/sales", icon: TrendingUp, description: "Order flow, OTIF, lead time and customers.", roles: ["Sales", "PlantManager"] },
      { name: "Customer 360", href: "/reports/customer-360", icon: Users, description: "Per-customer demand, delivery and risk.", roles: ["Sales"] },
      { name: "Inventory intelligence", href: "/reports/inventory", icon: Boxes, description: "Stock value, ageing and velocity.", roles: ["Store", "Planner", "PlantManager"] },
      { name: "Supplier & reels", href: "/reports/loss", icon: Package, description: "Supplier and reel performance, losses.", roles: ["Store", "PlantManager"] },
      { name: "Slitting report", href: "/reports/slitting", icon: Layers, description: "Reels to the slitter: coils made, wastage and pending slitting cards.", roles: ["Store", "PlantManager", "Planner", "RMIssue"] },
      { name: "Quality analytics", href: "/reports/quality", icon: BarChart3, description: "Pass rates by stage and material, flagged readings, holds and complaints.", roles: ["QC", "InwardQC", "InProcessQC", "PlantManager"] },
      { name: "Dispatch & SLA", href: "/reports/dispatch", icon: Truck, description: "Dispatch volume, readiness and SLA.", roles: ["Dispatch", "Sales"] },
      { name: "Tooling ledger", href: "/reports/tooling", icon: Wrench, description: "Tool assets, grinding and usage trail.", roles: ["PlantManager"] },
    ],
  },
  {
    title: "Foundation",
    items: [
      {
        name: "Masters",
        href: "/masters/papers",
        icon: Layers,
        description: "Papers, mandrels, parchments, customers, and supporting masters.",
        roles: ["Owner", "Admin"],
      },
      {
        name: "System",
        href: "/system/users",
        icon: ShieldCheck,
        description: "Users, roles, plants, machine setup and background jobs.",
        roles: ["Owner", "Admin"],
      },

      {
        name: "Audit",
        href: "/system/audit",
        icon: FileText,
        description: "Who did what — login, mutation, permission and report trail.",
        roles: ["Owner", "Admin"],
      },
    ],
  },
]

function canSeeLink(item: NavLink, roles: Set<string>) {
  if (item.ownerOnly) return roles.has("Owner")
  if (!item.roles?.length || roles.has("Owner") || roles.has("Admin")) return true
  return item.roles.some(role => roles.has(role))
}

// production-service serves the job-card counts (overdue cards, QC holds) to these roles only; asking for
// anyone else (QC, Operator) only fails with 403 on every page, so their badge simply does not show.

// The address query (?mode= for Log QC, ?tab= for the stock hub's tabs) marks the right menu entry.
function SearchWatcher({ onChange }: { onChange: (search: string) => void }) {
  const params = useSearchParams()
  const search = params?.toString() || ""
  useEffect(() => { onChange(search) }, [search, onChange])
  return null
}

// Pages may name their own last breadcrumb (useBreadcrumbLabel), so the provider wraps the whole shell.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <BreadcrumbLabelProvider><DashboardShell>{children}</DashboardShell></BreadcrumbLabelProvider>
}

// The last crumb for a record page (".../counts/<id>") when the page does not name itself.
const RECORD_CRUMB: Record<string, string> = {
  "/inventory/counts": "Count",
  "/inventory/locations": "Location",
  "/production/job-cards": "Job card",
  "/sales-orders": "Order",
  "/purchase": "Purchase order",
  "/logistics/dispatch": "Dispatch",
}
// Fixed sub-pages whose URL word is not the name people use.
const PAGE_CRUMB: Record<string, string> = {
  "/inventory/locations/labels": "Rack labels",
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/dashboard"
  const router = useRouter()
  const { toast, clearToast } = useApp()
  const { user, isLoading, logout, activeRole } = useAuth()
  // Names, not logins, wherever pages say who did something (client 2026-10-28).
  const peopleQuery = usePeopleDirectory(user)
  // Pages show people by name while they render, so a page waits (briefly) for the directory's first load.
  const namesReady = usePeopleReady(peopleQuery, Boolean(user?.email))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(true)
  // Only the current module's group opens by default, so a module's sub-pages fit on screen.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const userRoles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const groups = useMemo(() => {
    const seen = new Set<string>()
    return navigationUnits.map(group => ({ ...group, items: group.items.filter(item => {
      if (!canSeeLink(item, userRoles) || seen.has(item.href)) return false
      seen.add(item.href); return true
    }) })).filter(group => group.items.length)
  }, [userRoles])
  const flatLinks = useMemo(() => groups.flatMap(group => group.items), [groups])
  const visibleHrefs = useMemo(() => new Set(flatLinks.map(link => link.href)), [flatLinks])
  const inboxSummary = useNotificationSummary(Boolean(user))
  const salesBadge = useSalesOrderAggregates(Boolean(user) && visibleHrefs.has("/sales-orders"))
  const jobsBadge = useJobCardAggregates(Boolean(user) && canReadJobCardAggregates(Array.from(userRoles)) && (visibleHrefs.has("/production/job-cards") || visibleHrefs.has("/quality")))
  const navBadges = useMemo(() => ({
    "/inbox": inboxSummary.data?.unread ? { count: Number(inboxSummary.data.unread), tone: inboxSummary.data.by_priority?.critical ? "rose" as const : "primary" as const } : undefined,
    "/sales-orders": salesBadge.data?.draft_count ? { count: Number(salesBadge.data.draft_count), tone: "amber" as const } : undefined,
    "/production/job-cards": jobsBadge.data?.due_overdue ? { count: Number(jobsBadge.data.due_overdue), tone: "rose" as const } : undefined,
    "/quality": jobsBadge.data?.qc_holds ? { count: Number(jobsBadge.data.qc_holds), tone: "amber" as const } : undefined,
  }), [inboxSummary.data, salesBadge.data, jobsBadge.data])
  const navigationPath = pathname.startsWith("/landing/") ? "/dashboard" : pathname
  const [navSearch, setNavSearch] = useState("")
  const entryMode = useMemo(() => new URLSearchParams(navSearch).get("mode"), [navSearch])
  const current = useMemo(() => {
    // Log output and Log QC share /production/entry; the ?mode= query says which one is open.
    if (navigationPath === "/production/entry" || navigationPath.startsWith("/production/entry/")) {
      const wanted = entryMode === "qc" ? "/production/entry?mode=qc" : "/production/entry"
      const match = flatLinks.find(item => item.href === wanted)
      if (match) return match
    }
    return flatLinks.filter(item => navigationPath === item.href || navigationPath.startsWith(item.href + "/") || MODULE_NAVIGATION[item.href]?.some(child => moduleLinkCovers(child, pathname)))
      .sort((a,b) => b.href.length - a.href.length)[0]
  }, [pathname, navigationPath, flatLinks, entryMode])
  const groupName = groups.find(group => group.items.some(item => item.href === current?.href))?.title
  const pageCrumb = useBreadcrumbLabelFor(pathname)
  const crumbs = useMemo(() => {
    const list: Array<{ label: string; href?: string; icon?: any }> = []
    const group = groups.find(entry => entry.title === groupName)
    if (group) list.push({ label: group.title, href: group.items[0]?.href, icon: current?.icon })
    if (current) list.push({ label: current.name, href: current.href })
    const child = activeModuleLink(MODULE_NAVIGATION[current?.href || ""], pathname, navSearch)
    if (child && child.name !== current?.name) list.push({ label: child.name, href: child.href })
    const base = (child && moduleLinkBase(child, pathname)) || current?.href || ""
    const deeper = base && pathname.startsWith(base + "/") ? pathname.slice(base.length).split("/").filter(Boolean) : []
    if (current && deeper.length) {
      // One crumb per level below the module page: "<id>" is the record ("Count"), "rack/<id>" is a
      // "Rack", a plain word is its own page. Every level but the last links back to itself.
      const isId = (part: string) => /^[0-9a-f-]{20,}$/i.test(part) || part === "unassigned"
      const words = (part: string) => part.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
      let path = base
      for (let index = 0; index < deeper.length; index += 1) {
        const part = deeper[index]
        const next = deeper[index + 1]
        if (isId(part)) {
          path += `/${part}`
          // /logistics/dispatch/<job card>/print has no page at /logistics/dispatch/<job card>: no crumb for it.
          if (base === "/logistics/dispatch" && next) continue
          list.push({ label: RECORD_CRUMB[base] || "Detail", href: path })
        } else if (next && isId(next)) {
          path += `/${part}/${next}`
          index += 1
          list.push({ label: words(part), href: path })
        } else {
          path += `/${part}`
          list.push({ label: PAGE_CRUMB[path] || words(part), href: path })
        }
      }
      const tail = list[list.length - 1]
      list[list.length - 1] = { ...tail, href: undefined }
    }
    if (pageCrumb && list.length) list[list.length - 1] = { ...list[list.length - 1], label: pageCrumb, href: undefined }
    return list.length ? list : [{ label: "Workspace" }]
  }, [groups, groupName, current, pathname, navSearch, pageCrumb])
  const matches = useMemo(() => searchWorkspaceJumps(searchQuery, 100).filter(item => {
    const parent = navigationUnits.flatMap(group => group.items).filter(link => item.href === link.href || item.href.startsWith(link.href + "/") || MODULE_NAVIGATION[link.href]?.some(child => item.href === child.href || item.href.startsWith(child.href + "/"))).sort((a,b) => b.href.length-a.href.length)[0]
    return parent ? canSeeLink(parent, userRoles) : userRoles.has("Owner") || userRoles.has("Admin")
  }).slice(0, 16), [searchQuery, userRoles])
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY); if (saved !== null) setSidebarPinned(saved === "true")
      const savedGroups = JSON.parse(localStorage.getItem(GROUPS_STORAGE_KEY) || "null")
      if (Array.isArray(savedGroups)) setOpenGroups(new Set(savedGroups.map(String)))
    } catch { /* Session-only layout. */ }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(open => !open) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  // Signed out on a deep link (a scanned job card or label, an idle phone): login comes back to the
  // same page and query (client 2026-10-27). A deliberate Logout goes to a plain login page.
  const signingOut = useRef(false)
  useEffect(() => {
    if (isLoading || user) return
    forgetPeople()
    if (signingOut.current) { router.replace("/login"); return }
    router.replace(`/login?reason=session&next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
  }, [isLoading, user, router])
  useEffect(() => { setMobileNavOpen(false); setSearchOpen(false) }, [pathname])
  const toggleSidebar = () => {
    setSidebarPinned(!sidebarPinned)
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!sidebarPinned)) } catch { /* Session-only layout. */ }
  }
  const signOut = async () => { signingOut.current = true; await logout(); router.push("/login") }
  const navigate = (href: string) => { setSearchOpen(false); setSearchQuery(""); setMobileNavOpen(false); router.push(href) }
  const initials = (user?.name || "Hari Om").split(/\s+/).slice(0,2).map(word => word[0]).join("")
  const isGroupOpen = (title: string, mobile: boolean) => (mobile || !sidebarPinned) ? true : openGroups.has(title) || title === groupName
  const toggleGroup = (title: string) => setOpenGroups((currentGroups) => {
    const next = new Set(currentGroups)
    if (next.has(title) || title === groupName) next.delete(title)
    else next.add(title)
    try { localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(Array.from(next))) } catch { /* Session-only layout. */ }
    return next
  })
  const navigation = (mobile = false) => <SidebarNav
    groups={groups}
    currentHref={current?.href}
    pathname={pathname}
    mobile={mobile}
    compact={!sidebarPinned && !mobile}
    isOpen={(title) => isGroupOpen(title, mobile)}
    onToggle={toggleGroup}
    onNavigate={() => setMobileNavOpen(false)}
    subnav={MODULE_NAVIGATION}
    search={navSearch}
    badges={navBadges}
  />
  if (isLoading) return <div className="tube-shell" role="status" aria-label="Loading workspace">
    <aside className="tube-rail"><div className="tube-brand"><span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span><span className="tube-brand-label"><strong>Hari Om <span className="text-primary">TubeOS</span></strong><small>Paper tube manufacturing</small></span></div><div className="space-y-2 p-3">{Array.from({ length: 9 }, (_, n) => <div key={n} className="skeleton h-7" style={{ width: `${60 + ((n * 17) % 35)}%` }} />)}</div></aside>
    <div className="tube-workspace"><div className="tube-topbar"><div className="skeleton h-4 w-40" /></div><div className="tube-content space-y-5"><div className="skeleton h-8 w-72" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0,1,2,3].map(n => <div key={n} className="skeleton h-28 rounded-xl" />)}</div><div className="skeleton h-80 rounded-xl" /></div></div>
  </div>
  if (!user) return null
  return <div className="tube-shell" data-rail={sidebarPinned ? "expanded" : "compact"}>
    <Suspense fallback={null}><SearchWatcher onChange={setNavSearch} /></Suspense>
    <a href="#workspace-content" className="tube-skip">Skip to workspace</a>
    <aside className="tube-rail" aria-label="Workspace navigation">
      <Link href="/dashboard" className="tube-brand" aria-label="Hari Om TubeOS home"><span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span><span className="tube-brand-label"><strong>Hari Om <span className="text-primary">TubeOS</span></strong><small>Paper tube manufacturing</small></span></Link>
      {navigation()}
      <div className="tube-user"><span className="tube-avatar">{initials}</span><div className="tube-user-detail min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{roleLabel(String(activeRole || user.role || user.roles?.[0] || ""))}</p></div><button className="tube-user-detail" aria-label="Logout" title="Logout" onClick={signOut}><LogOut size={15} /></button></div>
    </aside>
    <div className="tube-workspace">
      <header className="tube-topbar">
        <button type="button" className="tube-icon-button tube-desktop-toggle" aria-label={sidebarPinned ? "Collapse navigation" : "Expand navigation"} title={sidebarPinned ? "Collapse navigation" : "Expand navigation"} aria-expanded={sidebarPinned} onClick={toggleSidebar}>{sidebarPinned ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogTrigger asChild><button className="tube-icon-button tube-mobile-trigger" aria-label="Open workspace navigation"><Menu size={18} /></button></DialogTrigger>
          <DialogContent className="tube-sheet !left-0 !top-0 !h-dvh !max-h-dvh !w-[min(86vw,320px)] !translate-x-0 !translate-y-0 !rounded-none !rounded-r-2xl !border-y-0 !border-l-0 !bg-[hsl(var(--surface-2))] !p-0 flex flex-col gap-0">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3"><span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span><div><DialogTitle className="!text-[15px]">Hari Om TubeOS</DialogTitle><DialogDescription className="!text-xs">Choose a workspace</DialogDescription></div></div>
            {navigation(true)}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><RoleSwitcher mobile /><button className="erp-btn-secondary" onClick={signOut}><LogOut size={16} />Logout</button></div>
          </DialogContent>
        </Dialog>
        <div className="tube-context"><BreadcrumbCapsule routeKey={pathname} crumbs={crumbs} backHref={current?.href && current.href !== pathname ? current.href : undefined} /></div>
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          <DialogTrigger asChild><button className="tube-command sm:ml-auto" aria-label="Jump to workspace"><Search size={16} /><span>Jump to workspace</span><kbd>⌘ K</kbd></button></DialogTrigger>
          <DialogContent className="!top-[14vh] !translate-y-0 gap-0 overflow-hidden !p-0 sm:max-w-xl">
            <div className="flex items-center gap-2 border-b border-border px-4"><Search size={16} className="shrink-0 text-muted-foreground" /><DialogTitle className="sr-only">Jump to workspace</DialogTitle><DialogDescription className="sr-only">Find an order register, inspection, calendar or guide.</DialogDescription>
            <Input autoFocus aria-label="Find workspace" placeholder="Jump to a workspace, register or guide…" className="h-12 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && matches[0]) {event.preventDefault();navigate(matches[0].href)}
              if (event.key === "ArrowDown") {event.preventDefault();document.getElementById("workspace-result-0")?.focus()}
            }} /><kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground sm:inline">esc</kbd></div>
            <div className="max-h-[55dvh] overflow-y-auto p-1.5" aria-label="Workspace results">
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{searchQuery ? `${matches.length} result${matches.length === 1 ? "" : "s"}` : "Quick jump"}</p>
              {(searchQuery ? matches : flatLinks.slice(0,10)).map((item,index) => <button key={item.href} id={`workspace-result-${index}`} className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-foreground/[.05] focus-visible:bg-accent focus-visible:outline-none" onClick={() => navigate(item.href)} onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault();document.getElementById(`workspace-result-${index+(event.key === "ArrowDown"?1:-1)}`)?.focus()}
              }}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground group-hover:text-primary group-focus-visible:text-primary">{"icon" in item && item.icon ? <item.icon size={15} /> : <CornerDownLeft size={14} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.description}</span></span><CornerDownLeft size={13} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></button>)}
              {searchQuery && !matches.length ? <p className="p-5 text-center text-sm text-muted-foreground">No matching workspace in your role. Try “inward”, “quality” or “calendar”.</p> : null}
            </div>
            <div className="flex items-center gap-3 border-t border-border bg-[hsl(var(--surface-2))] px-4 py-2 text-[11px] text-muted-foreground"><span><kbd className="rounded border border-border bg-card px-1">↑</kbd> <kbd className="rounded border border-border bg-card px-1">↓</kbd> navigate</span><span><kbd className="rounded border border-border bg-card px-1">↵</kbd> open</span><span className="ml-auto">⌘K anywhere</span></div>
          </DialogContent>
        </Dialog>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
          <SeasonChip /><ThemeToggle /><AppearanceControls /><BooksLockedChip compact /><RoleSwitcher compact /><NotificationCenter />
          {userRoles.has("Owner") || userRoles.has("Admin") ? <PlantSwitcher compact /> : null}
          <Link href={`/help?route=${encodeURIComponent(pathname)}`} className="tube-icon-button max-[400px]:!hidden" aria-label="Open page guide" title="Open page guide"><BookOpen size={17} /></Link>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className="tube-content focus:outline-none"><div key={pathname} className="tube-page">{namesReady ? children : <div className="space-y-5" role="status" aria-label="Loading page"><div className="skeleton h-8 w-72 max-w-full" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(n => <div key={n} className="skeleton h-28 rounded-xl" />)}</div><div className="skeleton h-80 rounded-xl" /></div>}</div></main>
    </div>
    <RouteProgress />
    <MessageMirror />
    {toast ? <div key={toast.message} className="tube-toast fixed bottom-4 right-4 z-[70] w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop" role={toast.type === "error" ? "alert" : "status"}><div className="flex items-start gap-3 p-3.5"><span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${toast.type === "error" ? "bg-signal-rose-soft text-signal-rose-ink" : toast.type === "success" ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-blue-soft text-signal-blue-ink"}`}>{toast.type === "error" ? <AlertTriangle size={13} /> : toast.type === "success" ? <CheckCircle2 size={13} /> : <Info size={13} />}</span><p className="flex-1 text-[13px] leading-5">{toast.message}</p><button className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground" aria-label="Dismiss notification" onClick={clearToast}><X size={14} /></button></div><div className={`h-0.5 ${toast.type === "error" ? "bg-signal-rose-ink/60" : toast.type === "success" ? "bg-signal-emerald-ink/60" : "bg-primary/60"}`} /></div> : null}
  </div>
}
