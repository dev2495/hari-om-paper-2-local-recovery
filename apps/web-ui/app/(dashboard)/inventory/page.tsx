"use client"

import Link from "next/link"
import { ArrowRight, Boxes, ClipboardCheck, PackageCheck, Warehouse } from "lucide-react"

export default function InventoryOverviewPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-amber-200/60 bg-gradient-to-r from-slate-900 via-cyan-900 to-amber-800 p-6 text-white shadow-xl">
        <h1 className="text-3xl font-semibold">Inventory Control</h1>
        <p className="mt-2 max-w-3xl text-sm text-amber-100">
          Inventory is split by function for clean operations. Raw inward and production issue are store actions.
          Finished-good inward is auto-posted from production job close and is intentionally not a manual store screen.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/inventory/items" className="glass rounded-2xl border border-white/60 p-5 shadow-xl hover:shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Item Master</h2>
            <Boxes className="h-5 w-5 text-cyan-800" />
          </div>
          <p className="mt-2 text-sm text-slate-600">Create and maintain RM/FG items with UOM and category.</p>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-900">
            Open <ArrowRight className="h-4 w-4" />
          </div>
        </Link>

        <Link
          href="/inventory/raw-material-inward"
          className="glass rounded-2xl border border-white/60 p-5 shadow-xl hover:shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">RM Inward</h2>
            <Warehouse className="h-5 w-5 text-cyan-800" />
          </div>
          <p className="mt-2 text-sm text-slate-600">Post purchase/store inward for raw paper, adhesive, and parchment.</p>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-900">
            Open <ArrowRight className="h-4 w-4" />
          </div>
        </Link>

        <Link
          href="/inventory/production-issue"
          className="glass rounded-2xl border border-white/60 p-5 shadow-xl hover:shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Production Issue</h2>
            <PackageCheck className="h-5 w-5 text-cyan-800" />
          </div>
          <p className="mt-2 text-sm text-slate-600">Issue raw stock against job card references with lot traceability.</p>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-900">
            Open <ArrowRight className="h-4 w-4" />
          </div>
        </Link>

        <Link
          href="/inventory/reservations"
          className="glass rounded-2xl border border-white/60 p-5 shadow-xl hover:shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">FG Reservations</h2>
            <ClipboardCheck className="h-5 w-5 text-cyan-800" />
          </div>
          <p className="mt-2 text-sm text-slate-600">Reserve specific FG lots for released SO lines before dispatch.</p>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-900">
            Open <ArrowRight className="h-4 w-4" />
          </div>
        </Link>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-6 text-sm text-slate-700 shadow-xl">
        <p className="font-semibold text-slate-900">Why no manual FG inward screen?</p>
        <p className="mt-2">
          FG stock enters inventory only through <span className="font-medium">Production Job Close</span> to avoid mismatch
          between job-card truth and FG ledger. This keeps EOD reconciliation and bamboo-loss reporting consistent.
        </p>
      </section>
    </div>
  )
}
