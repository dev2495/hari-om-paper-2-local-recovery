"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, Factory, FileText, Gauge, Info, Layers, LineChart, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, BookOpen, ScrollText, Search, ShieldCheck, Sparkles, Truck, X, CircleDot, CornerDownLeft } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { PlantSwitcher } from "@/components/PlantSwitcher"
import { BooksLockedChip } from "@/components/workspace/books-locked-chip"
import { NotificationCenter } from "@/components/workspace/notification-center"
import { RoleSwitcher } from "@/components/workspace/role-switcher"
import { AppearanceControls } from "@/components/workspace/appearance-controls"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { MODULE_NAVIGATION } from "@/lib/module-navigation"
import { searchWorkspaceJumps } from "@/lib/workspace-jump"
import { RouteProgress } from "@/components/workspace/route-progress"

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
        name: "Sales Orders",
        href: "/sales-orders",
        icon: ClipboardList,
        description: "Commercial demand, releases, and customer intake.",
        roles: ["Owner", "Admin", "Sales", "Planner"],
      },
      {
        name: "Pending Orders",
        href: "/sales-orders/pending",
        icon: ClipboardList,
        description: "All in-scope pending demand with server totals and export.",
        roles: ["Owner", "Admin", "Sales", "Planner", "PlantManager"],
      },
      {
        name: "Job Cards",
        href: "/production/job-cards",
        icon: Factory,
        description: "Release truth, execution packets, and printable cards.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "QC", "Operator"],
      },
      {
        name: "Planner",
        href: "/planning/board",
        icon: Sparkles,
        description: "Machine queues, shift scheduling, and stage balancing.",
        roles: ["Owner", "Admin", "Planner", "PlantManager"],
      },
      {
        name: "Tracker",
        href: "/planning/tracker",
        icon: LineChart,
        description: "Live segment posture and release-to-dispatch tracking.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "Dispatch", "Operator"],
      },
      {
        name: "Quality",
        href: "/quality",
        icon: ShieldCheck,
        description: "Inspection lifecycle, holds, release decisions, and audit evidence.",
        roles: ["Owner", "Admin", "PlantManager", "QC", "Dispatch", "Store", "Sales"],
      },
      {
        name: "Reconciliation",
        href: "/production/reconciliation",
        icon: FileText,
        description: "Material retally, close posture, and monthly actuals.",
        roles: ["Owner", "Admin", "PlantManager"],
      },
    ],
  },
  {
    title: "Purchasing",
    items: [
      {
        name: "Purchase orders",
        href: "/purchase",
        icon: FileText,
        description: "PO revisions, inward, invoice differences, claims, scheduling, and exports.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "RM Schedule",
        href: "/purchase/scheduler",
        icon: ClipboardList,
        description: "Monthly kg calendar, workbook import, MRP run, and PO conversion.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      { name: "Supplier deliveries", href: "/purchase/supplier-deliveries", icon: Truck, description: "Confirmed arrivals, changed promises and partial receipts.", roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"] },
      { name: "Create purchase order", href: "/purchase/new", icon: FileText, description: "Multi-item PO with automatic numbering and vendor terms.", roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"] },
      { name: "PO approvals", href: "/purchase/approvals", icon: ShieldCheck, description: "Review submitted PO revisions before goods receipt.", roles: ["Owner", "Admin", "PlantManager"] },
      { name: "Invoice differences", href: "/purchase/discrepancies", icon: ScrollText, description: "Review rates, quantities and specifications.", roles: ["Owner", "Admin", "Store", "Accounts", "PlantManager"] },
      { name: "Debit notes", href: "/purchase/debit-notes", icon: FileText, description: "Vendor claims, approvals and settlements.", roles: ["Owner", "Admin", "Accounts", "PlantManager"] },
      { name: "Purchase reports", href: "/purchase/registers", icon: LineChart, description: "Excel exports and printable commercial registers.", roles: ["Owner", "Admin", "Store", "Accounts", "Planner", "PlantManager"] },
    ],
  },
  {
    title: "Stores & inventory",
    items: [
      { name: "Goods inward", href: "/purchase/inward", icon: Package, description: "Manual or approved-PO receipt with individual reel and coil labels.", roles: ["Owner", "Admin", "Store", "PlantManager"] },
      { name: "GRN register & labels", href: "/purchase/receipts", icon: ClipboardList, description: "Saved receipts, pending invoices, QC and label reprints.", roles: ["Owner", "Admin", "Store", "PlantManager", "Accounts"] },
      {
        name: "Stock Lifecycle",
        href: "/inventory/lifecycle",
        icon: Layers,
        description: "Opening → daily → cert → carry-forward → reco → lock. The flow hub.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "Inventory",
        href: "/inventory",
        icon: Package,
        description: "Raw material inward, reel issue, balances, and valuation.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "Purchase",
        href: "/purchase",
        icon: FileText,
        description: "Supplier purchase orders, GRN receipts, and delivery schedules.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager"],
      },
      {
        name: "Genealogy",
        href: "/inventory/genealogy",
        icon: Layers,
        description: "Reel lineage, slit children, issue scans, and trace exceptions.",
        roles: ["Owner", "Admin", "Store", "Planner", "PlantManager", "Dispatch"],
      },
      {
        name: "Manual FG",
        href: "/inventory/fg-inward",
        icon: Package,
        description: "Rework yield, returns, and adjustments — manual FG inward outside the job-close flow.",
        roles: ["Owner", "Admin", "Store", "PlantManager"],
      },
      {
        name: "MRP",
        href: "/analytics/mrp",
        icon: LineChart,
        description: "Reorder-policy review and demand/BOM coverage. Two separate measures.",
        roles: ["Owner", "Admin", "Store", "Planner"],
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
    title: "Intelligence",
    items: [
      {
        name: "Intelligence",
        href: "/analytics",
        icon: LineChart,
        description: "Live KPIs and finished reports in one home.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "Store", "Dispatch", "Sales", "QC"],
      },
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
        description: "Users, plants, machine setup, tolerance bands, and platform governance.",
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/dashboard"
  const router = useRouter()
  const { toast, clearToast } = useApp()
  const { user, isLoading, logout, activeRole } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(true)
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
  const navigationPath = pathname.startsWith("/landing/") ? "/dashboard" : pathname
  const current = useMemo(() => flatLinks.filter(item => navigationPath === item.href || navigationPath.startsWith(item.href + "/") || MODULE_NAVIGATION[item.href]?.some(child => pathname === child.href || pathname.startsWith(child.href + "/")))
    .sort((a,b) => b.href.length - a.href.length)[0], [pathname, navigationPath, flatLinks])
  const groupName = groups.find(group => group.items.some(item => item.href === current?.href))?.title
  const matches = useMemo(() => searchWorkspaceJumps(searchQuery, 100).filter(item => {
    const parent = navigationUnits.flatMap(group => group.items).filter(link => item.href === link.href || item.href.startsWith(link.href + "/") || MODULE_NAVIGATION[link.href]?.some(child => item.href === child.href || item.href.startsWith(child.href + "/"))).sort((a,b) => b.href.length-a.href.length)[0]
    return parent ? canSeeLink(parent, userRoles) : userRoles.has("Owner") || userRoles.has("Admin")
  }).slice(0, 16), [searchQuery, userRoles])
  useEffect(() => {
    try { const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY); if (saved !== null) setSidebarPinned(saved === "true") } catch { /* Session-only layout. */ }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(open => !open) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => { if (!isLoading && !user) router.replace("/login?reason=session") }, [isLoading, user, router])
  useEffect(() => { setMobileNavOpen(false); setSearchOpen(false) }, [pathname])
  const toggleSidebar = () => {
    setSidebarPinned(!sidebarPinned)
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!sidebarPinned)) } catch { /* Session-only layout. */ }
  }
  const signOut = async () => { await logout(); router.push("/login") }
  const navigate = (href: string) => { setSearchOpen(false); setSearchQuery(""); setMobileNavOpen(false); router.push(href) }
  const initials = (user?.name || "Hari Om").split(/\s+/).slice(0,2).map(word => word[0]).join("")
  const navigation = (mobile = false) => <nav className="tube-navigation" aria-label={mobile ? "Mobile workspaces" : "Workspaces"}>
    {groups.map(group => <details className="tube-nav-group" key={group.title} open={mobile || !sidebarPinned || group.title === groupName || group.title === "Overview"}>
      {sidebarPinned || mobile ? <summary>{group.title}<ChevronRight size={12} aria-hidden="true" /></summary> : null}
      {group.items.map(item => <div key={item.href}>
        <Link href={item.href} className="tube-nav-link" aria-label={item.name} title={`${item.name} · ${item.description}`} aria-current={current?.href === item.href ? "page" : undefined} onClick={() => setMobileNavOpen(false)}>
          <item.icon aria-hidden="true" /><span>{item.name}</span>
        </Link>
        {(sidebarPinned || mobile) && current?.href === item.href && MODULE_NAVIGATION[item.href] ? <div className="tube-subnav">
          {MODULE_NAVIGATION[item.href].map(child => <Link key={child.href} href={child.href} className="tube-nav-link" aria-current={pathname === child.href ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><span>{child.name}</span></Link>)}
        </div> : null}
      </div>)}
    </details>)}
  </nav>
  if (isLoading) return <div className="tube-shell" role="status" aria-label="Loading workspace">
    <aside className="tube-rail"><div className="tube-brand"><span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span><span className="tube-brand-label"><strong>Hari Om <span className="text-primary">TubeOS</span></strong><small>Paper tube manufacturing</small></span></div><div className="space-y-2 p-3">{Array.from({ length: 9 }, (_, n) => <div key={n} className="skeleton h-7" style={{ width: `${60 + ((n * 17) % 35)}%` }} />)}</div></aside>
    <div className="tube-workspace"><div className="tube-topbar"><div className="skeleton h-4 w-40" /></div><div className="tube-content space-y-5"><div className="skeleton h-8 w-72" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0,1,2,3].map(n => <div key={n} className="skeleton h-28 rounded-xl" />)}</div><div className="skeleton h-80 rounded-xl" /></div></div>
  </div>
  if (!user) return null
  return <div className="tube-shell" data-rail={sidebarPinned ? "expanded" : "compact"}>
    <a href="#workspace-content" className="tube-skip">Skip to workspace</a>
    <aside className="tube-rail" aria-label="Workspace navigation">
      <Link href="/dashboard" className="tube-brand" aria-label="Hari Om TubeOS home"><span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span><span className="tube-brand-label"><strong>Hari Om <span className="text-primary">TubeOS</span></strong><small>Paper tube manufacturing</small></span></Link>
      {navigation()}
      <div className="tube-user"><span className="tube-avatar">{initials}</span><div className="tube-user-detail min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{activeRole || user.role || user.roles?.[0]}</p></div><button className="tube-user-detail" aria-label="Logout" title="Logout" onClick={signOut}><LogOut size={15} /></button></div>
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
        <div className="tube-context"><span>{groupName || "Workspace"}</span><ChevronRight size={13} /><strong>{Object.values(MODULE_NAVIGATION).flat().find(item => item.href === pathname)?.name || current?.name || "Detail"}</strong></div>
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
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:ml-0">
          <AppearanceControls /><BooksLockedChip compact /><RoleSwitcher compact /><NotificationCenter />
          {userRoles.has("Owner") || userRoles.has("Admin") ? <PlantSwitcher compact /> : null}
          <Link href={`/help?route=${encodeURIComponent(pathname)}`} className="tube-icon-button" aria-label="Open page guide" title="Open page guide"><BookOpen size={17} /></Link>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className="tube-content focus:outline-none"><div key={pathname} className="tube-page">{children}</div></main>
    </div>
    <RouteProgress />
    {toast ? <div key={toast.message} className="tube-toast fixed bottom-4 right-4 z-[70] w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop" role={toast.type === "error" ? "alert" : "status"}><div className="flex items-start gap-3 p-3.5"><span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${toast.type === "error" ? "bg-signal-rose-soft text-signal-rose-ink" : toast.type === "success" ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-blue-soft text-signal-blue-ink"}`}>{toast.type === "error" ? <AlertTriangle size={13} /> : toast.type === "success" ? <CheckCircle2 size={13} /> : <Info size={13} />}</span><p className="flex-1 text-[13px] leading-5">{toast.message}</p><button className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground" aria-label="Dismiss notification" onClick={clearToast}><X size={14} /></button></div><div className={`h-0.5 ${toast.type === "error" ? "bg-signal-rose-ink/60" : toast.type === "success" ? "bg-signal-emerald-ink/60" : "bg-primary/60"}`} /></div> : null}
  </div>
}
