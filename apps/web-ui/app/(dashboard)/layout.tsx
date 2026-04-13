"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell, ClipboardList, Factory, Gauge, Layers, LogOut, Menu, Package, ScrollText, Search, Truck, X, LineChart } from "lucide-react"
import { useState } from "react"

import { authApi } from "@/lib/api"
import { PlantSwitcher } from "@/components/PlantSwitcher"
import { useApp } from "@/context/AppContext"

const navigationUnits = [
  {
    title: "Core",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: Gauge },
    ]
  },
  {
    title: "Operations",
    items: [
      { name: "Sales Orders", href: "/sales-orders", icon: ClipboardList },
      { name: "Production Jobs", href: "/production/job-cards", icon: Factory },
      { name: "Planner", href: "/production/planner", icon: Search },
    ]
  },
  {
    title: "Intelligence",
    items: [
      {
        name: "Analytics",
        href: "/analytics",
        icon: LineChart,
        items: [
          { name: "Dashboard", href: "/analytics/dashboard" },
          { name: "Production", href: "/analytics/production" },
          { name: "Quality & Specs", href: "/analytics/quality" },
          { name: "Scrap & Loss", href: "/analytics/loss" },
          { name: "Inventory Insight", href: "/analytics/inventory" },
          { name: "Dispatch", href: "/analytics/dispatch" },
        ]
      }
    ]
  },
  {
    title: "Supply Chain",
    items: [
      {
        name: "Inventory",
        href: "/inventory",
        icon: Package,
        items: [
          { name: "Items", href: "/inventory/items" },
          { name: "RM Inward", href: "/inventory/raw-material-inward" },
          { name: "Reel Inward", href: "/inventory/reels/inward" },
          { name: "Reel Issue", href: "/inventory/reels/issue" },
          { name: "Production Issue", href: "/inventory/production-issue" },
          { name: "FG Reservations", href: "/inventory/reservations" },
        ]
      },
      { name: "Dispatch", href: "/logistics/dispatch", icon: Truck },
    ]
  },
  {
    title: "Design",
    items: [
      { name: "Specifications", href: "/specs", icon: ScrollText },
    ]
  },
  {
    title: "Settings",
    items: [
      {
        name: "Master Data",
        href: "/master",
        icon: Layers,
        items: [
          { name: "Papers", href: "/master/papers" },
          { name: "Adhesives", href: "/master/adhesives" },
          { name: "Parchments", href: "/master/parchments" },
          { name: "Tube Sizes", href: "/master/tube-sizes" },
          { name: "Mandrels", href: "/master/mandrels" },
          { name: "Machines", href: "/system/machines" },
          { name: "Customers", href: "/master/customers" },
        ]
      },
      {
        name: "System Settings",
        href: "/system",
        icon: Bell,
        items: [
          { name: "Users", href: "/system/users" },
          { name: "Plants", href: "/system/plants" },
        ]
      },
      { name: "Supervisor Entry", href: "/production/supervisor-entry", icon: Factory },
    ]
  }
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { toast, clearToast } = useApp()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const handleLogout = async () => {
    await authApi.logout()
    router.push("/login")
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-4 py-4 md:px-6">
        <aside className="erp-panel sticky top-4 hidden h-[calc(100vh-2rem)] w-72 flex-col bg-white/40 p-5 lg:flex">
          <div className="mb-8 rounded-2xl bg-gradient-to-br from-cyan-950 to-cyan-800 p-5 text-white shadow-lg shadow-cyan-950/20">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">Hari Om Paper</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">TubeOS</h1>
            <p className="mt-3 text-[10px] leading-relaxed text-cyan-200 opacity-80 uppercase tracking-widest font-medium">Textile tube manufacturing control room</p>
          </div>

          <nav className="space-y-6 overflow-y-auto pr-2 custom-scrollbar text-slate-700">
            {navigationUnits.map((unit) => (
              <div key={unit.title} className="space-y-1">
                <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-900/40">
                  {unit.title}
                </p>
                {unit.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href))
                  const Icon = item.icon
                  return (
                    <div key={item.name} className="space-y-1">
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-xs font-semibold tracking-wide transition-all duration-200 ${isActive
                          ? "bg-cyan-900 text-white shadow-lg shadow-cyan-900/10 translate-x-1"
                          : "text-slate-600 hover:bg-white hover:text-cyan-900 hover:translate-x-1"
                          }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? "text-cyan-300" : "text-slate-400"}`} />
                        {item.name}
                      </Link>
                      {item.items && (isActive || pathname?.startsWith(item.href)) && (
                        <div className="ml-9 space-y-1 border-l border-slate-200 pl-4 py-1">
                          {item.items.map((subItem) => {
                            const isSubActive = pathname === subItem.href
                            return (
                              <Link
                                key={subItem.name}
                                href={subItem.href}
                                className={`block py-1.5 text-[11px] font-medium transition ${isSubActive
                                  ? "text-cyan-700 font-bold"
                                  : "text-slate-500 hover:text-cyan-900"
                                  }`}
                              >
                                {subItem.name}
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="mt-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">Approval Inbox</p>
            <p className="mt-1">Track pending specs, SO approvals, and dispatch validations.</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="erp-panel sticky top-4 z-10 px-4 py-3 md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  placeholder="Search jobs, specs, sales orders..."
                  className="h-9 w-full rounded-lg border border-white/70 bg-white/90 pl-9 pr-3 text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileNavOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-slate-700 shadow-sm lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <button className="rounded-lg bg-white/90 p-2 text-slate-700 shadow-sm hover:text-cyan-900">
                  <Bell className="h-4 w-4" />
                </button>
                <PlantSwitcher />
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          </header>

          <main className="pb-6">{children}</main>
        </div>
      </div>
      {mobileNavOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-80 max-w-[90vw] overflow-y-auto bg-[#f5efe3] p-4 shadow-2xl lg:hidden">
            <div className="mb-4 flex items-start justify-between rounded-2xl bg-gradient-to-br from-cyan-950 to-cyan-800 p-4 text-white">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">Hari Om Paper</p>
                <p className="mt-1 text-xl font-bold">TubeOS</p>
              </div>
              <button onClick={() => setMobileNavOpen(false)} className="rounded-lg bg-white/15 p-1.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="space-y-5 pb-24">
              {navigationUnits.map((unit) => (
                <div key={unit.title} className="space-y-1">
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-900/40">
                    {unit.title}
                  </p>
                  {unit.items.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href))
                    const Icon = item.icon
                    return (
                      <div key={item.name} className="space-y-1">
                        <Link
                          href={item.href}
                          onClick={() => setMobileNavOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 ${isActive
                            ? "bg-cyan-900 text-white shadow-lg shadow-cyan-900/10"
                            : "bg-white/80 text-slate-600"
                            }`}
                        >
                          <Icon className={`h-4 w-4 ${isActive ? "text-cyan-300" : "text-slate-400"}`} />
                          {item.name}
                        </Link>
                        {item.items && (isActive || pathname?.startsWith(item.href)) && (
                          <div className="ml-9 space-y-1 border-l border-slate-200 pl-4 py-1">
                            {item.items.map((subItem) => {
                              const isSubActive = pathname === subItem.href
                              return (
                                <Link
                                  key={subItem.name}
                                  href={subItem.href}
                                  onClick={() => setMobileNavOpen(false)}
                                  className={`block py-1.5 text-xs font-medium transition ${isSubActive
                                    ? "text-cyan-700 font-bold"
                                    : "text-slate-500"
                                    }`}
                                >
                                  {subItem.name}
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </nav>
            <button
              onClick={handleLogout}
              className="erp-btn-secondary fixed bottom-4 left-4 right-4 flex items-center justify-center"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </aside>
        </>
      )}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50">
          <div
            className={`flex min-w-[280px] items-start gap-3 rounded-xl border px-4 py-3 shadow-xl ${toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
          >
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button onClick={clearToast} className="rounded p-1 opacity-70 transition hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
