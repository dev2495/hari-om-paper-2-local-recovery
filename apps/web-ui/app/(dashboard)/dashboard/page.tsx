"use client"

import Link from "next/link"
import { BarChart3, ClipboardList, Factory, Gauge, Package, ScrollText, Shield, ShieldCheck, Truck } from "lucide-react"

import { useAuth } from "@/context/AuthContext"

const workspaces = [
  { title: "Specifications", href: "/specifications", icon: ScrollText, copy: "Spec sheet, recipe trials, approval, and print packet." },
  { title: "Sales Orders", href: "/sales-orders", icon: ClipboardList, copy: "Demand intake, release posture, and customer tracking." },
  { title: "Planning", href: "/production/planner", icon: Factory, copy: "Machine queues, plant load, and stage scheduling." },
  { title: "Production", href: "/production/job-cards", icon: Gauge, copy: "Job cards, EOD entry, reconciliation, and loss controls." },
  { title: "Inventory", href: "/inventory", icon: Package, copy: "Raw inward, production issue, reservations, and valuation." },
  { title: "Dispatch", href: "/logistics/dispatch", icon: Truck, copy: "Packing handoff, challans, and finished goods movement." },
  { title: "Analytics", href: "/analytics", icon: BarChart3, copy: "Charts, plant variance, quality drift, and board-pack trend views." },
  { title: "Masters", href: "/masters", icon: ShieldCheck, copy: "Paper, mandrel, parchment, customer, and packaging truth tables." },
  { title: "System", href: "/system/users", icon: Shield, copy: "Users, plants, machines, and platform governance surfaces." },
]

export default function DashboardPage() {
  const { user, activePlant } = useAuth()
  const landingRole = user?.role || user?.roles?.[0] || "Owner"

  return (
    <div className="space-y-7" data-testid="workspace-role-landing" data-role={landingRole}>
      <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-slate-950 via-cyan-950 to-amber-900 p-7 text-white shadow-2xl">
        <div className="max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-100">Hari Om Paper TubeOS</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-6xl">Manufacturing control room</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-50/78">
            Multi-plant ERP workspace for sales, specs, planning, production, stores, logistics, and owner intelligence.
          </p>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/70">User</p>
            <p className="mt-2 truncate text-lg font-semibold">{user?.name || user?.email || "Signed in"}</p>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/70">Role</p>
            <p className="mt-2 text-lg font-semibold">{landingRole}</p>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/70">Plant</p>
            <p className="mt-2 text-lg font-semibold">{activePlant || user?.plant_id || "PLANT_A"}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => (
          <Link
            key={workspace.href}
            href={workspace.href}
            className="group rounded-3xl border border-white/70 bg-white/85 p-5 shadow-xl shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{workspace.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{workspace.copy}</p>
              </div>
              <div className="rounded-2xl bg-cyan-950 p-3 text-white transition group-hover:bg-amber-700">
                <workspace.icon className="h-5 w-5" />
              </div>
            </div>
          </Link>
        ))}
      </section>

      <section className="rounded-3xl border border-cyan-100 bg-cyan-50/70 p-5 text-sm text-cyan-950 shadow-sm">
        Live runtime is using BFF `14000`, web `13000`, and direct service ports `18001-18008`.
      </section>
    </div>
  )
}
