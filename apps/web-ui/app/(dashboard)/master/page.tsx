"use client"

import Link from "next/link"
import { ArrowRight, Layers, ShieldCheck } from "lucide-react"

const workspaceGroups = [
  {
    title: "Master Data",
    icon: Layers,
    eyebrow: "Recovered downstream truth",
    description: "Every dropdown and logic surface used by specifications, sales, planning, and dispatch should be reachable from here.",
    links: [
      { href: "/masters/papers", title: "Paper Master", description: "Maintain GSM, BF, thickness, and commercial paper definitions used in recipe math." },
      { href: "/masters/tube-sizes", title: "Tube Sizes", description: "Restore tube dimensions that seed customer ask, bamboo yield, and manufacturing math." },
      { href: "/masters/mandrels", title: "Mandrels", description: "Manage mandrel setup that drives the manufacturing ID band and winder setup." },
      { href: "/masters/parchments", title: "Parchment Colors", description: "Control parchment families and options used across sales and spec selection." },
      { href: "/masters/adhesives", title: "Adhesives", description: "Keep adhesive chemistry and recipe options aligned with the fixed glue band logic." },
      { href: "/masters/customers", title: "Customers", description: "Restore customer commercial, tax, address, and dispatch-contact truth." },
      { href: "/masters/suppliers", title: "Suppliers", description: "Approved supplier dropdown used by RM inward, reel inward, and MRP purchase drafts." },
      { href: "/masters/packaging", title: "Packaging", description: "Boxes, plastic sheets, fadda, and counts used by packing handoff." },
      { href: "/masters/tools", title: "Tools", description: "Notch, punch, die, winder, and packing tooling linked into the spec sheet and job cards." },
    ],
  },
  {
    title: "System Setup",
    icon: ShieldCheck,
    eyebrow: "Plant-level governance",
    description: "Keep the global scope, user access, plants, and machine registry reachable in the same workspace instead of hiding them in a separate dead-end.",
    links: [
      { href: "/system/users", title: "Users", description: "Role, plant, and permissions management for the recovered operator model." },
      { href: "/system/plants", title: "Plants", description: "Plant code, name, and activation state that feeds the top scope switcher." },
      { href: "/system/machines", title: "Machines", description: "Machine registry and capacity fields used by the planner and production handoff." },
    ],
  },
]

export default function MasterOverviewPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-7 shadow-premium">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Foundation Workspace</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Master and system setup</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Use this as the clean switchboard for master truth and system setup. The goal is no dead routes, no hidden setup pages, and no need to bounce back through the sidebar just to move between papers, plants, or machines.
        </p>
      </section>

      {workspaceGroups.map((group) => {
        const Icon = group.icon
        return (
          <section key={group.title} className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-premium">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Icon className="h-3.5 w-3.5" />
                  {group.eyebrow}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{group.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{group.description}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.links.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white">
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-slate-900">
                    Open <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
