"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, ClipboardList, Factory, FileText, Gauge, Layers, LineChart, LogOut, Menu, Package, BookOpen, ScrollText, Search, ShieldCheck, Sparkles, Truck, X, CircleDot } from "lucide-react"
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
        {(sidebarPinned || mobile) && current?.href === item.href && MODULE_NAVIGATION[item.href] ? <div className="ml-5 border-l border-border pl-3">
          {MODULE_NAVIGATION[item.href].map(child => <Link key={child.href} href={child.href} className="tube-nav-link !min-h-8 !py-2 !text-xs" aria-current={pathname === child.href ? "page" : undefined} onClick={() => setMobileNavOpen(false)}>{child.name}</Link>)}
        </div> : null}
      </div>)}
    </details>)}
  </nav>
  if (isLoading) return <div className="min-h-screen bg-background p-8" role="status" aria-label="Loading workspace"><div className="h-16 animate-pulse rounded-xl bg-muted" /><div className="mt-6 grid gap-4 md:grid-cols-3">{[0,1,2].map(n => <div key={n} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div></div>
  if (!user) return null
  return <div className="tube-shell" data-rail={sidebarPinned ? "expanded" : "compact"}>
    <a href="#workspace-content" className="tube-skip">Skip to workspace</a>
    <aside className="tube-rail" aria-label="Workspace navigation">
      <Link href="/dashboard" className="tube-brand" aria-label="Hari Om TubeOS home"><span className="tube-mark"><CircleDot size={22} strokeWidth={1.5} /></span><span className="tube-brand-label"><strong>Hari Om <span className="text-primary">TubeOS</span></strong><small>Paper tube manufacturing</small></span></Link>
      {navigation()}
      <div className="tube-user"><span className="tube-avatar">{initials}</span><div className="tube-user-detail min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{activeRole || user.role || user.roles?.[0]}</p></div><button className="tube-user-detail" aria-label="Logout" title="Logout" onClick={signOut}><LogOut size={16} /></button></div>
    </aside>
    <div className="tube-workspace">
      <header className="tube-topbar">
        <button type="button" className="tube-icon-button tube-desktop-toggle" aria-label={sidebarPinned ? "Collapse navigation" : "Expand navigation"} aria-expanded={sidebarPinned} onClick={toggleSidebar}>{sidebarPinned ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}</button>
        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogTrigger asChild><button className="tube-icon-button tube-mobile-trigger" aria-label="Open workspace navigation"><Menu size={18} /></button></DialogTrigger>
          <DialogContent className="!left-0 !top-0 !h-dvh !max-h-dvh !w-[min(88vw,320px)] !translate-x-0 !translate-y-0 !rounded-none !p-0 flex flex-col gap-0">
            <div className="border-b border-border p-5"><DialogTitle>Hari Om TubeOS</DialogTitle><DialogDescription className="mt-1">Choose a workspace</DialogDescription></div>
            {navigation(true)}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><RoleSwitcher mobile /><button className="erp-btn-secondary" onClick={signOut}><LogOut size={16} />Logout</button></div>
          </DialogContent>
        </Dialog>
        <div className="tube-context"><span>{groupName || "Workspace"}</span><ChevronRight size={12} /><strong>{Object.values(MODULE_NAVIGATION).flat().find(item => item.href === pathname)?.name || current?.name || "Detail"}</strong></div>
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          <DialogTrigger asChild><button className="tube-command sm:ml-auto" aria-label="Jump to workspace"><Search size={16} /><span>Jump to workspace</span><kbd>⌘ K</kbd></button></DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogTitle>Jump to workspace</DialogTitle><DialogDescription>Find an order register, inspection, calendar or guide.</DialogDescription>
            <Input autoFocus aria-label="Find workspace" placeholder="Search workspaces…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && matches[0]) {event.preventDefault();navigate(matches[0].href)}
              if (event.key === "ArrowDown") {event.preventDefault();document.getElementById("workspace-result-0")?.focus()}
            }} />
            <div className="max-h-[55dvh] overflow-y-auto" aria-label="Workspace results">
              {(searchQuery ? matches : flatLinks.slice(0,10)).map((item,index) => <button key={item.href} id={`workspace-result-${index}`} className="flex w-full flex-col gap-1 rounded-lg p-3 text-left hover:bg-accent" onClick={() => navigate(item.href)} onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault();document.getElementById(`workspace-result-${index+(event.key === "ArrowDown"?1:-1)}`)?.focus()}
              }}><span className="text-sm font-semibold">{item.name}</span><span className="text-xs text-muted-foreground">{item.description}</span></button>)}
              {searchQuery && !matches.length ? <p className="p-5 text-sm text-muted-foreground">No matching workspace in your role. Try “inward”, “quality” or “calendar”.</p> : null}
            </div>
          </DialogContent>
        </Dialog>
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2 sm:ml-0">
          <AppearanceControls /><BooksLockedChip compact /><RoleSwitcher compact /><NotificationCenter />
          {userRoles.has("Owner") || userRoles.has("Admin") ? <PlantSwitcher compact /> : null}
          <Link href={`/help?route=${encodeURIComponent(pathname)}`} className="tube-icon-button" aria-label="Open page guide" title="Open page guide"><BookOpen size={17} /></Link>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className="tube-content focus:outline-none">{children}</main>
    </div>
    {toast ? <div className="fixed bottom-5 right-5 z-[70] w-[min(380px,calc(100vw-40px))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl" role={toast.type === "error" ? "alert" : "status"}><div className="flex items-start gap-3"><p className="flex-1 text-sm leading-6">{toast.message}</p><button aria-label="Dismiss notification" onClick={clearToast}><X size={16} /></button></div></div> : null}
  </div>
}
