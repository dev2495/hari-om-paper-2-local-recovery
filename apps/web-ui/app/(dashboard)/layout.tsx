"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Factory,
  FileText,
  Gauge,
  Layers,
  LineChart,
  LogOut,
  Menu,
  Package,
  BookOpen,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PlantSwitcher } from "@/components/PlantSwitcher"
import { BooksLockedChip } from "@/components/workspace/books-locked-chip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NotificationCenter } from "@/components/workspace/notification-center"
import { RoleSwitcher } from "@/components/workspace/role-switcher"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"

type NavLink = {
  name: string
  href: string
  icon: any
  description: string
  roles?: string[]
}

type NavGroup = {
  title: string
  items: NavLink[]
}

const SIDEBAR_STORAGE_KEY = "hariom_sidebar_pinned_v2"

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
        name: "Job Cards",
        href: "/production/job-cards",
        icon: Factory,
        description: "Release truth, execution packets, and printable cards.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "Operator"],
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
        roles: ["Owner", "Admin", "PlantManager", "Dispatch", "Store", "Sales"],
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
    title: "Supply Chain",
    items: [
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
        description: "Material shortage planning and purchase draft generation.",
        roles: ["Owner", "Admin", "Store", "Planner"],
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
        name: "Analytics",
        href: "/analytics",
        icon: LineChart,
        description: "Shared KPI and production intelligence hub.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "Store", "Dispatch", "Sales"],
      },
      {
        name: "Reports",
        href: "/reports",
        icon: FileText,
        description: "Owner reporting, exceptions, and plant summaries.",
        roles: ["Owner", "Admin", "Planner", "PlantManager", "Store", "Dispatch", "Sales"],
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

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true
  if (href === "/dashboard") return pathname === "/dashboard"
  return pathname.startsWith(`${href}/`)
}

function initialsFor(name: string | null | undefined) {
  const value = String(name || "").trim()
  if (!value) return "HO"
  const words = value.split(/\s+/).slice(0, 2)
  const joined = words.map((word) => word[0] || "").join("")
  return (joined || value.slice(0, 2)).toUpperCase()
}

function compactIdentity(value: string | null | undefined) {
  const identity = String(value || "").trim()
  if (!identity) return "Plant A"
  const label = displayPlantScope(identity, identity)
  if (label !== identity) return label
  if (identity.length <= 22) return identity
  return `${identity.slice(0, 18)}...`
}

function canSeeLink(item: NavLink, roles: Set<string>) {
  if (!item.roles || item.roles.length === 0) return true
  if (roles.has("Owner") || roles.has("Admin")) return true
  return item.roles.some((role) => roles.has(role))
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/dashboard"
  const router = useRouter()
  const { toast, clearToast } = useApp()
  const { user, isLoading, logout, activePlant, activeRole } = useAuth()

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (storedValue !== null) {
        setSidebarPinned(storedValue === "true")
      }
    } catch {
      // Ignore storage access errors on hydration.
    }
  }, [])

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login")
    }
  }, [isLoading, router, user])

  const wideWorkspace = pathname.startsWith("/planning/board")
  const sidebarExpanded = sidebarPinned || sidebarHovered

  const userRoles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const visibleNavigationUnits = useMemo(
    () =>
      navigationUnits
        .map((group) => ({ ...group, items: group.items.filter((item) => canSeeLink(item, userRoles)) }))
        .filter((group) => group.items.length > 0),
    [userRoles],
  )
  const flatLinks = useMemo(() => visibleNavigationUnits.flatMap((group) => group.items), [visibleNavigationUnits])

  const pageLink = useMemo(() => {
    if (pathname.startsWith("/masters")) {
      return {
        name: "Masters",
        href: "/masters/papers",
        icon: Layers,
        description: "Plant-scoped papers, mandrels, parchments, customers, and supporting masters.",
      }
    }
    if (pathname.startsWith("/system")) {
      return {
        name: "System",
        href: "/system/users",
        icon: ShieldCheck,
        description: "User, plant, machine, tolerance, and governance surfaces for the recovered ERP.",
      }
    }
    const exact = flatLinks.find((item) => pathname === item.href)
    if (exact) return exact
    const nested = flatLinks
      .filter((item) => pathname.startsWith(`${item.href}/`))
      .sort((left, right) => right.href.length - left.href.length)[0]
    return nested || flatLinks[0]
  }, [flatLinks, pathname])

  const quickMatches = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    if (!needle) return []
    return flatLinks
      .filter((item) => {
        const haystack = `${item.name} ${item.href} ${item.description}`.toLowerCase()
        return haystack.includes(needle)
      })
      .slice(0, 6)
  }, [flatLinks, searchQuery])

  const currentGroup = useMemo(
    () => visibleNavigationUnits.find((group) => group.items.some((item) => pageLink && item.href === pageLink.href)),
    [pageLink, visibleNavigationUnits],
  )
  const pathTrail = useMemo(
    () =>
      pathname
        .split("/")
        .filter(Boolean)
        .slice(0, 3)
        .map((segment) => segment.replace(/-/g, " ")),
    [pathname],
  )

  const layoutOffsetClass = sidebarExpanded ? "lg:pl-[18.5rem]" : "lg:pl-[6.5rem]"
  const shellMaxWidthClass = wideWorkspace ? "max-w-none" : "max-w-[1680px]"
  const showAdminControls = userRoles.has("Owner") || userRoles.has("Admin")
  const PageIcon = pageLink?.icon
  const helpHref = `/help?route=${encodeURIComponent(pathname)}`

  const handleLogout = async () => {
    await logout()
    router.push("/login")
  }

  const navigateTo = (href: string) => {
    setMobileNavOpen(false)
    setSearchQuery("")
    setSearchOpen(false)
    router.push(href)
  }

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (quickMatches[0]) {
      navigateTo(quickMatches[0].href)
    }
  }

  const togglePinned = () => {
    const nextValue = !sidebarPinned
    setSidebarPinned(nextValue)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue))
    } catch {
      // Ignore storage failures.
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dashboard-mesh">
        <div className="mx-auto flex max-w-[1800px] gap-4 px-4 py-4 md:px-6">
          <div className="hidden h-[calc(100vh-2rem)] w-[18rem] animate-pulse rounded-[2rem] bg-white/65 shadow-premium lg:block" />
          <div className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col gap-4">
            <div className="h-28 animate-pulse rounded-[2rem] bg-white/70 shadow-premium" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`dashboard-shell-skeleton-${index}`} className="h-40 animate-pulse rounded-[2rem] bg-white/70 shadow-premium" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-dashboard-mesh text-slate-900">
      <aside
        data-expanded={sidebarExpanded}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        className={cn(
          "erp-panel fixed bottom-5 left-5 top-5 z-40 hidden flex-col overflow-visible rounded-[2rem] transition-all duration-300 lg:flex",
          sidebarExpanded ? "w-[16.75rem]" : "w-[4.5rem]",
        )}
      >
        <div
          className={cn(
            "relative flex min-h-[5.5rem] border-b border-slate-200/80",
            sidebarExpanded ? "items-center justify-between px-4" : "items-center justify-center px-0",
          )}
        >
          <Link href="/dashboard" className={cn("flex min-w-0 items-center", sidebarExpanded ? "gap-3" : "justify-center")}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.15rem] bg-gradient-to-br from-slate-900 via-cyan-950 to-cyan-800 text-white shadow-lg shadow-cyan-950/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div
              className={cn(
                "min-w-0 transition-all duration-200",
                sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0",
              )}
            >
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-700/70">Hari Om Paper</p>
              <h1 className="truncate pt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950">TubeOS</h1>
              <p className="truncate pt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Textile tube manufacturing control room
              </p>
            </div>
          </Link>
          <button
            onClick={togglePinned}
            className={cn(
              "absolute -right-3 top-5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white text-slate-500 shadow-lg transition hover:border-cyan-200 hover:text-cyan-800",
            )}
            title={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            {sidebarPinned ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        <nav className={cn("erp-sidebar-scroll flex-1 space-y-5 overflow-y-auto py-5", sidebarExpanded ? "px-3" : "px-2")}>
          {visibleNavigationUnits.map((group) => (
            <div key={group.title} className="space-y-1">
              <div
                className={cn(
                  "px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400 transition-all",
                  sidebarExpanded ? "opacity-100" : "pointer-events-none h-0 overflow-hidden opacity-0",
                )}
              >
                {group.title}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActivePath(pathname, item.href)
                return (
                  <button
                    key={item.href}
                    onClick={() => navigateTo(item.href)}
                    title={!sidebarExpanded ? item.name : undefined}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-[1.15rem] text-left transition-all duration-200",
                      active
                        ? "bg-slate-100 text-slate-950 shadow-sm"
                        : "text-slate-500 hover:bg-slate-100/80 hover:text-cyan-950",
                      sidebarExpanded ? "px-3 py-3" : "justify-center px-0 py-2.5",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[1rem] transition-all",
                        active
                          ? "bg-white text-slate-950 shadow-sm"
                          : "bg-transparent text-slate-400 group-hover:bg-white group-hover:text-cyan-900",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div
                      className={cn(
                        "min-w-0 flex-1 transition-all duration-200",
                        sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0",
                      )}
                    >
                      <div className="truncate text-sm font-semibold">{item.name}</div>
                      <div className={cn("truncate pt-0.5 text-[11px]", active ? "text-slate-500" : "text-slate-400")}>
                        {item.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className={cn("border-t border-slate-200/80 py-3", sidebarExpanded ? "px-3" : "px-2")}>
          <div
            className={cn(
              "flex items-center gap-3 rounded-[1.2rem] border border-white/80 bg-white/88 py-2.5 shadow-sm transition-all",
              sidebarExpanded ? "px-3" : "justify-center px-0",
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white">
              {initialsFor(user.name)}
            </div>
            <div
              className={cn(
                "min-w-0 flex-1 transition-all duration-200",
                sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0",
              )}
            >
              <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
              <div className="truncate pt-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                {activeRole || user.role || user.roles?.[0] || "System User"}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className={cn(
                "rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-rose-200 hover:text-rose-600",
                !sidebarExpanded && "hidden",
              )}
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className={cn("min-h-screen transition-all duration-300", layoutOffsetClass)}>
        <header className={cn("sticky top-0 z-30 px-4 pb-3 pt-5 md:px-6", wideWorkspace && "px-3 pb-2 pt-3 md:px-4")}>
          <div
            className={cn(
              "erp-panel mx-auto flex w-full items-center gap-3 rounded-[1.6rem] px-4 py-3 md:px-5",
              wideWorkspace && "rounded-[1.35rem] px-3 py-2.5 md:px-4",
              shellMaxWidthClass,
            )}
          >
            <button
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-slate-700 shadow-sm lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] bg-gradient-to-br from-slate-900 via-cyan-950 to-cyan-800 text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-800/55">TubeOS Workspace</p>
                <p className="truncate text-sm font-semibold text-slate-950">{pageLink?.name || "Workspace"}</p>
              </div>
            </div>

            <div
              className="relative min-w-0 flex-1"
              onFocusCapture={() => setSearchOpen(true)}
              onBlurCapture={() => {
                window.setTimeout(() => setSearchOpen(false), 120)
              }}
            >
              <form onSubmit={handleSearchSubmit} className="relative">
                <Search className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search pages, flows, and workspaces..."
                  className="h-10 rounded-full border-white/80 bg-white/90 pl-11 pr-4 shadow-sm"
                />
              </form>

              {searchOpen && quickMatches.length > 0 ? (
                <div className="absolute inset-x-0 top-[calc(100%+0.55rem)] z-40 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/95 p-2 shadow-2xl backdrop-blur">
                  {quickMatches.map((item) => (
                    <button
                      key={item.href}
                      onClick={() => navigateTo(item.href)}
                      className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-900">
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{item.name}</span>
                        <span className="block truncate pt-0.5 text-[11px] text-slate-500">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="hidden min-w-0 xl:flex">
              <button
                type="button"
                onClick={() => pageLink?.href && navigateTo(pageLink.href)}
                className="group flex max-w-[25rem] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40"
                title={pageLink?.description}
              >
                {PageIcon ? (
                  <PageIcon className="h-3.5 w-3.5 shrink-0 text-cyan-900" />
                ) : null}
                <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {currentGroup?.title || "Workspace"}
                </span>
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
                <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.15em] text-slate-900">
                  {pageLink?.name || pathTrail[pathTrail.length - 1] || "Dashboard"}
                </span>
                {pathTrail.length > 1 ? (
                  <span className="hidden min-w-0 truncate rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 2xl:block">
                    {pathTrail.join(" / ")}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href={helpHref}
                className="hidden h-10 items-center gap-2 rounded-full border border-cyan-100 bg-cyan-50 px-3 text-xs font-semibold text-cyan-950 shadow-sm transition hover:border-cyan-200 hover:bg-white sm:inline-flex"
                title="Open page guide"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Guide
              </Link>
              <BooksLockedChip />
              <RoleSwitcher compact />
              <NotificationCenter />
              {showAdminControls ? <PlantSwitcher compact /> : null}
              <Button variant="outline" className="rounded-full border-slate-200 bg-white px-3.5 text-xs" onClick={handleLogout}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        <main className={cn("px-4 pb-8 md:px-6", wideWorkspace && "px-3 pb-4 md:px-4")}>
          <div className={cn("mx-auto w-full", shellMaxWidthClass)}>
            {children}
          </div>
        </main>
      </div>

      {mobileNavOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />
          <aside className="erp-panel fixed inset-y-4 left-4 z-50 flex w-[min(90vw,22rem)] flex-col overflow-hidden lg:hidden">
            <div className="flex items-center justify-between border-b border-white/70 px-4 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-cyan-700/70">Hari Om Paper</p>
                <h1 className="pt-1 text-xl font-semibold tracking-tight text-slate-950">TubeOS</h1>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="erp-sidebar-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
              {visibleNavigationUnits.map((group) => (
                <div key={`mobile-${group.title}`} className="space-y-1">
                  <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                    {group.title}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={`mobile-${item.href}`}
                      onClick={() => navigateTo(item.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200",
                        isActivePath(pathname, item.href)
                          ? "bg-cyan-950 text-white shadow-lg shadow-cyan-950/15"
                          : "text-slate-600 hover:bg-white/90",
                      )}
                    >
                      <span className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                        isActivePath(pathname, item.href) ? "bg-white/15" : "bg-white/80 text-slate-500",
                      )}>
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{item.name}</span>
                        <span className={cn(
                          "block truncate pt-0.5 text-[11px]",
                          isActivePath(pathname, item.href) ? "text-cyan-100/85" : "text-slate-400",
                        )}>
                          {item.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="border-t border-white/70 px-3 py-3">
              <div className="flex items-center gap-3 rounded-[1.4rem] border border-white/70 bg-white/85 px-3 py-3 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-bold text-white">
                  {initialsFor(user.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
                  <div className="truncate pt-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    {activeRole || user.role || user.roles?.[0] || "System User"}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {toast ? (
        <div className="fixed bottom-5 right-5 z-[60] max-w-sm">
          <div
            className={cn(
              "animate-enter-up flex items-start gap-3 rounded-[1.4rem] border px-4 py-3 shadow-2xl backdrop-blur",
              toast.type === "success" && "border-emerald-200 bg-emerald-50/95 text-emerald-900",
              toast.type === "error" && "border-rose-200 bg-rose-50/95 text-rose-900",
              toast.type === "info" && "border-cyan-200 bg-cyan-50/95 text-cyan-950",
            )}
          >
            <p className="flex-1 text-sm font-medium leading-6">{toast.message}</p>
            <button onClick={clearToast} className="rounded-full p-1 opacity-70 transition hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
