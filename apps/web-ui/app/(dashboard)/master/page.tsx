"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

const links = [
  { href: "/master/papers", title: "Paper Master", description: "Maintain GSM/BF paper definitions used in recipes." },
  { href: "/master/tube-sizes", title: "Tube Sizes", description: "Add and edit tube dimensions used in specs and bamboo logic." },
  { href: "/master/mandrels", title: "Mandrels", description: "Manage mandrel setup for production and spec sheet." },
  { href: "/master/parchments", title: "Parchment Colors", description: "Manage parchment vendors/colors for sales order option." },
  { href: "/master/adhesives", title: "Adhesives", description: "Adhesive master for recipe and process setup." },
]

export default function MasterOverviewPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-6 text-white shadow-xl">
        <h1 className="text-3xl font-semibold">Master Data Center</h1>
        <p className="mt-2 max-w-3xl text-sm text-cyan-100">
          All add/edit master data functions are available here. Tube size add/edit is fully supported under Tube Sizes.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {links.map((item) => (
          <Link key={item.href} href={item.href} className="glass rounded-2xl border border-white/60 p-5 shadow-xl hover:shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{item.description}</p>
            <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cyan-900">
              Open <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
