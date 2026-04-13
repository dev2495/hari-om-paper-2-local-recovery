"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Bell,
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
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PlantSwitcher } from "@/components/PlantSwitcher"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

type NavLink = {
  name: string
  href: string
  icon: any
  description: string
}

type NavGroup = {
  title: string
  items: NavLink[]
}

const SIDEBAR_STORAGE_KEY = "hariom_sidebar_pinned"

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
      },
      {
        name: "Job Cards",
        href: "/production/job-cards",
        icon: Factory,
        description: "Release truth, execution packets, and printable cards.",
      },
      {
        name: "Planner",
        href: "/production/planner",
        icon: Sparkles,
        description: "Machine queues, shift scheduling, and stage balancing.",
      },
      {
        name: "Tracker",
        href: "/planning/tracker",
        icon: LineChart,
        description: "Live segment posture and release-to-dispatch tracking.",
      },
      {
        name: "Reconciliation",
        href: "/production/reconciliation",
        icon: FileText,
        description: "Material retally, close posture, and monthly actuals.",
      },
    ],
  },
  {
    title: "Supply Chain",
    items: [
      {
        name: "Inventory",
        href: "/inventory",
        icon: Package,
        description: "Raw material inward, reel issue, balances, and valuation.",
      },
      {
        name: "Dispatch",
        href: "/logistics/dispatch",
        icon: Truck,
        description: "Packing handoff, challans, and finished-goods release.",
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
        description: "Spec sheet workspace, recipe truth, and approval flow.",
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
      },
      {
        name: "Reports",
        href: "/reports",
        icon: FileText,
        description: "Owner reporting, exceptions, and plant summaries.",
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
      },
      {
        name: "System",
        href: "/system/users",
        icon: ShieldCheck,
        description: "Users, plants, machine setup, and platform governance.",
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/dashboard"
  const router = useRouter()
  const { toast, clearToast } = useApp()
  const { user, isLoading, logout, activePlant } = useAuth()

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

  const sidebarExpanded = sidebarPinned || sidebarHovered

  const flatLinks = useMemo(() => navigationUnits.flatMap((group) => group.items), [])

  const pageLink = useMemo(() => {
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

  const layoutOffsetClass = sidebarExpanded ? "lg:pl-[20rem]" : "lg:pl-[7.5rem]"

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
          "erp-panel fixed inset-y-4 left-4 z-40 hidden flex-col overflow-hidden transition-all duration-300 lg:flex",
          sidebarExpanded ? "w-[18rem]" : "w-[5.75rem]",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/70 px-4 py-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-950 via-cyan-900 to-cyan-700 text-white shadow-lg shadow-cyan-950/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className={cn("min-w-0 transition-all duration-200", sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0")}>
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.32em] text-cyan-700/70">Hari Om Paper</p>
              <h1 className="truncate pt-1 text-xl font-semibold tracking-tight text-slate-950">TubeOS</h1>
              <p className="truncate pt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Manufacturing control room
              </p>
            </div>
          </Link>
          <button
            onClick={togglePinned}
            className={cn(
              "hidden rounded-full border border-slate-200 bg-white/90 p-2 text-slate-500 transition hover:border-cyan-200 hover:text-cyan-800 lg:inline-flex",
              !sidebarExpanded && "pointer-events-none opacity-0",
            )}
            title={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            {sidebarPinned ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        <nav className="erp-sidebar-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {navigationUnits.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className={cn("px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400 transition-all", sidebarExpanded ? "opacity-100" : "opacity-0")}>
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
                      "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200",
                      active
                        ? "bg-cyan-950 text-white shadow-lg shadow-cyan-950/15"
                        : "text-slate-600 hover:bg-white/90 hover:text-cyan-950 hover:shadow-sm",
                      !sidebarExpanded && "justify-center px-2",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-all",
                        active
                          ? "bg-white/15 text-white"
                          : "bg-white/75 text-slate-500 group-hover:bg-cyan-50 group-hover:text-cyan-900",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className={cn("min-w-0 flex-1 transition-all duration-200", sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0")}>
                      <div className="truncate text-sm font-semibold">{item.name}</div>
                      <div className={cn("truncate pt-0.5 text-[11px]", active ? "text-cyan-100/85" : "text-slate-400")}>
                        {item.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/70 px-3 py-3">
          <div className={cn("rounded-[1.6rem] bg-gradient-to-br from-amber-50 via-white to-cyan-50 px-3 py-3 shadow-inner transition-all", sidebarExpanded ? "opacity-100" : "opacity-0")}>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-700">Approval Inbox</div>
            <p className="pt-2 text-xs leading-5 text-slate-600">
              Track pending specs, release approvals, and reconciliation checkpoints from one rail.
            </p>
          </div>

          <div className={cn("mt-3 flex items-center gap-3 rounded-[1.4rem] border border-white/70 bg-white/85 px-3 py-3 shadow-sm transition-all", !sidebarExpanded && "justify-center px-2")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-bold text-white">
              {initialsFor(user.name)}
            </div>
            <div className={cn("min-w-0 flex-1 transition-all duration-200", sidebarExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0")}>
              <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
              <div className="truncate pt-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                {user.role || user.roles?.[0] || "System User"}
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
        <header className="sticky top-0 z-30 px-4 pb-3 pt-4 md:px-6">
          <div className="erp-panel mx-auto flex w-full max-w-[1740px] flex-col gap-4 px-4 py-4 md:px-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-800/60">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>TubeOS Workspace</span>
                </div>
                <h2 className="pt-2 text-2xl font-semibold tracking-tight text-slate-950">{pageLink?.name || "Workspace"}</h2>
                <p className="max-w-2xl pt-1 text-sm text-slate-500">{pageLink?.description || "Recovered ERP runtime workspace."}</p>
              </div>

              <div className="hidden items-center gap-2 lg:flex">
                <div className="rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
                  {user.role || user.roles?.[0] || "User"}
                </div>
                <PlantSwitcher />
                <Button variant="outline" className="rounded-full border-white/80 bg-white/90 px-4" onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2 lg:hidden">
                <button
                  onClick={() => setMobileNavOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-slate-700 shadow-sm"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex-1">
                  <PlantSwitcher />
                </div>
                <button className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-slate-700 shadow-sm">
                  <Bell className="h-4 w-4" />
                </button>
              </div>

              <div
                className="relative flex-1"
                onFocusCapture={() => setSearchOpen(true)}
                onBlurCapture={() => {
                  window.setTimeout(() => setSearchOpen(false), 120)
                }}
              >
                <form onSubmit={handleSearchSubmit} className="relative">
                  <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search pages, flows, and workspaces..."
                    className="h-11 rounded-2xl border-white/80 bg-white/90 pl-11 pr-4 shadow-sm"
                  />
                </form>

                {searchOpen && quickMatches.length > 0 ? (
                  <div className="absolute inset-x-0 top-[calc(100%+0.6rem)] z-40 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/95 p-2 shadow-2xl backdrop-blur">
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

              <div className="hidden items-center gap-2 md:flex">
                {flatLinks.slice(0, 3).map((item) => (
                  <button
                    key={`quick-${item.href}`}
                    onClick={() => navigateTo(item.href)}
                    className="rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm transition hover:border-cyan-200 hover:text-cyan-900"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 pb-8 md:px-6">
          <div className="mx-auto w-full max-w-[1740px]">
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
              {navigationUnits.map((group) => (
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
                    {user.role || user.roles?.[0] || "System User"}
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
