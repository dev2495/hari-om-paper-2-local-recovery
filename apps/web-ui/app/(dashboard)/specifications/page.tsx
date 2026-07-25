"use client"

import Link from "next/link"
import { startTransition, useDeferredValue, useMemo, useState } from "react"
import { ArrowRight, Factory, FilePlus2, Printer, Search, ScrollText } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { resolveSpecTitle } from "@/components/specs/spec-sheet-utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { useCustomers, useMandrels, useTubeSizes } from "@/hooks/use-master-data"
import { specApi } from "@/lib/api"
import { formatSpecMeasure, resolveSpecSummary } from "@/lib/spec-summary"
import { cn } from "@/lib/utils"

const STATUS_FILTERS = ["all", "draft", "review", "trial", "approved", "obsolete"] as const

function formatDate(value: string | null | undefined) {
  if (!value) return "Recently updated"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Recently updated"
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}

function statusTone(status: string) {
  switch (String(status || "").toLowerCase()) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "review":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "obsolete":
      return "border-rose-200 bg-rose-50 text-rose-700"
    case "trial":
      return "border-sky-200 bg-sky-50 text-sky-700"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700"
  }
}

export default function SpecificationsIndexPage() {
  const { user } = useAuth()
  const [searchValue, setSearchValue] = useState("")
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all")
  const [versionView, setVersionView] = useState<"active" | "disabled">("active")
  const deferredSearchValue = useDeferredValue(searchValue.trim().toLowerCase())
  const canManageSpecs = Boolean(user?.roles?.some((role) => role === "Owner" || role === "Admin") || user?.role === "Owner" || user?.role === "Admin")

  const { data: specs = [], isLoading } = useQuery({
    queryKey: ["specs", "all-versions"],
    queryFn: async () => {
      const { data } = await specApi.getSpecs({ active_only: false })
      return Array.isArray(data) ? data : data?.items || []
    },
  })

  const { data: customers = [] } = useCustomers()
  const { data: tubeSizes = [] } = useTubeSizes()
  const { data: mandrels = [] } = useMandrels()

  const customerMap = useMemo(
    () => Object.fromEntries((Array.isArray(customers) ? customers : []).map((entry: any) => [String(entry.id), entry])),
    [customers],
  )
  const tubeSizeMap = useMemo(
    () => Object.fromEntries((Array.isArray(tubeSizes) ? tubeSizes : []).map((entry: any) => [String(entry.id), entry])),
    [tubeSizes],
  )
  const mandrelMap = useMemo(
    () => Object.fromEntries((Array.isArray(mandrels) ? mandrels : []).map((entry: any) => [String(entry.id), entry])),
    [mandrels],
  )

  const filteredSpecs = useMemo(() => {
    return specs.filter((spec: any) => {
      const disabledVersion = spec.active === false || String(spec.status || "").toLowerCase() === "obsolete"
      if (versionView === "active" && disabledVersion) return false
      if (versionView === "disabled" && !disabledVersion) return false
      const normalizedStatus = String(spec.status || "").toLowerCase()
      if (statusFilter !== "all" && normalizedStatus !== statusFilter) return false
      if (!deferredSearchValue) return true

      const tubeSize = tubeSizeMap[String(spec.tube_size_id)]
      const mandrel = mandrelMap[String(spec.mandrel_id)]
      const customer = customerMap[String(spec.customer_id)]

      const haystack = [
        resolveSpecTitle(spec),
        spec.customer_name_snapshot,
        spec.customer_name,
        customer?.name,
        customer?.customer_code,
        tubeSize?.name,
        tubeSize?.internal_code,
        mandrel?.name,
        mandrel?.mandrel_code,
        spec.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return haystack.includes(deferredSearchValue)
    })
  }, [customerMap, deferredSearchValue, mandrelMap, specs, statusFilter, tubeSizeMap, versionView])

  const statusCounts = useMemo(() => {
    const scopedSpecs = specs.filter((spec: any) => {
      const disabledVersion = spec.active === false || String(spec.status || "").toLowerCase() === "obsolete"
      return versionView === "disabled" ? disabledVersion : !disabledVersion
    })
    const counts: Record<string, number> = { all: scopedSpecs.length }
    for (const status of STATUS_FILTERS.slice(1)) {
      counts[status] = scopedSpecs.filter((spec: any) => String(spec.status || "").toLowerCase() === status).length
    }
    return counts
  }, [specs, versionView])

  const activeSpecCount = useMemo(
    () => specs.filter((spec: any) => spec.active !== false && String(spec.status || "").toLowerCase() !== "obsolete").length,
    [specs],
  )
  const disabledSpecCount = useMemo(
    () => specs.filter((spec: any) => spec.active === false || String(spec.status || "").toLowerCase() === "obsolete").length,
    [specs],
  )

  // Recipe-cascade health: spec is APPROVED but no recipe is approved yet.
  // Job-card creation will fail silently otherwise. Surface as a banner.
  const recipeCascadeIssues = useMemo(() => {
    return specs.filter((spec: any) => {
      if (spec.active === false) return false
      if (String(spec.status || "").toLowerCase() !== "approved") return false
      const recipes = Array.isArray(spec.recipes) ? spec.recipes : []
      if (recipes.length === 0) return true
      const anyApproved = recipes.some(
        (r: any) => String(r.status || "").toLowerCase() === "approved",
      )
      return !anyApproved
    })
  }, [specs])

  return (
    <div className="space-y-6">
      {recipeCascadeIssues.length > 0 ? (
        <section className="flex flex-wrap items-start gap-3 rounded-[1.6rem] border border-amber-200 bg-amber-50/80 px-5 py-4 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <ScrollText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">
              Recipe cascade bottleneck
            </p>
            <p className="mt-1 text-sm font-semibold text-amber-900">
              {recipeCascadeIssues.length} approved spec
              {recipeCascadeIssues.length === 1 ? "" : "s"} have no approved recipe — release-to-job will
              fail until at least one recipe is promoted from <strong>trial</strong> to <strong>approved</strong>.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recipeCascadeIssues.slice(0, 8).map((spec: any) => (
                <Link
                  key={spec.id}
                  href={`/specifications/${spec.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 hover:bg-amber-100"
                >
                  {String(spec.product_code || spec.id).slice(0, 14)}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
              {recipeCascadeIssues.length > 8 ? (
                <span className="text-[11px] font-semibold text-amber-700">+ {recipeCascadeIssues.length - 8} more</span>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white/80 shadow-premium">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] lg:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">Spec Control Room</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold text-slate-950">
              Commercial spec sheets, recipe truth, and printable release packets in one lane.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600">
              Start from the master-driven spec sheet, keep trial versions attached to the same record, and send the approved snapshot straight into planning and job-card execution.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {canManageSpecs ? (
                <Link href="/specifications/new">
                  <Button className="gap-2">
                    <FilePlus2 className="h-4 w-4" />
                    New Specification
                  </Button>
                </Link>
              ) : null}
              <Link href="/masters/papers">
                <Button variant="outline" className="gap-2">
                  <Factory className="h-4 w-4" />
                  Review Master Papers
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Active Specs</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{statusCounts.all}</p>
              <p className="mt-1 text-sm text-slate-500">All active draft, Owner review, trial, and live records in the current plant.</p>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Review Queue</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{statusCounts.review + statusCounts.trial}</p>
              <p className="mt-1 text-sm text-slate-500">Versions waiting for validation or Owner approval.</p>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Approved Live</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{statusCounts.approved}</p>
              <p className="mt-1 text-sm text-slate-500">Approved snapshots that planning and production can rely on.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white/80 px-5 py-5 shadow-premium">
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "active", label: "Active Sheets", count: activeSpecCount },
            { key: "disabled", label: "Disabled Versions", count: disabledSpecCount },
          ].map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => {
                setVersionView(view.key as "active" | "disabled")
                setStatusFilter("all")
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition",
                versionView === view.key
                  ? "border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {view.label} {view.count}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchValue}
              onChange={(event) => {
                const nextValue = event.target.value
                startTransition(() => setSearchValue(nextValue))
              }}
              placeholder="Search customer, tube size, mandrel, or status"
              className="h-12 rounded-full border-slate-200 bg-slate-50 pl-11"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition",
                  statusFilter === filter
                    ? "border-cyan-200 bg-cyan-50 text-cyan-800"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {filter} {statusCounts[filter]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {isLoading ? (
          <div className="rounded-[32px] border border-slate-200 bg-white/80 px-6 py-10 text-sm text-slate-500 shadow-premium">
            Loading specifications...
          </div>
        ) : filteredSpecs.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center shadow-premium">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <ScrollText className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">
              {searchValue || statusFilter !== "all" ? "No specifications match this filter." : "No specifications yet."}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
              {searchValue || statusFilter !== "all"
                ? "Adjust the search or status filter to surface the right spec record."
                : "Create the first spec sheet to rebuild the commercial-to-production flow from the master data."}
            </p>
            {!searchValue && statusFilter === "all" ? (
              <div className="mt-5">
                <Link href="/specifications/new">
                  <Button className="gap-2">
                    <FilePlus2 className="h-4 w-4" />
                    Create Specification
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          filteredSpecs.map((spec: any) => {
            const tubeSize = tubeSizeMap[String(spec.tube_size_id)]
            const mandrel = mandrelMap[String(spec.mandrel_id)]
            const customer = customerMap[String(spec.customer_id)]
            const profileRecipeRows = Array.isArray(spec.profile?.recipe?.recipe_rows) ? spec.profile.recipe.recipe_rows : []
            const summary = resolveSpecSummary(spec, tubeSize)

            return (
              <article
                key={String(spec.id)}
                className="rounded-[32px] border border-slate-200 bg-white/80 px-6 py-6 shadow-premium transition hover:-translate-y-0.5 hover:shadow-premium-hover"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Saved {formatDate(spec.created_at)}
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(spec.status)}`}>
                        {String(spec.status).toLowerCase() === "approved" ? "live" : spec.status}
                      </span>
                      {spec.active === false ? (
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          disabled version
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-950">{resolveSpecTitle(spec)}</h2>
                    <p className="mt-2 max-w-3xl text-sm text-slate-600">
                      {(customer?.name || spec.customer_name_snapshot || spec.customer_name || "Customer pending")} ·{" "}
                      {summary.tubeLabel} ·{" "}
                      {(mandrel?.mandrel_code || mandrel?.name || "Mandrel pending")}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Client Dimensions</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">
                          ID {formatSpecMeasure(summary.idMm)} / OD {formatSpecMeasure(summary.odMm)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500" data-testid={`spec-summary-height-${spec.id}`}>
                          Actual height {formatSpecMeasure(summary.actualHeightMm)} mm
                          {summary.actualHeightSource === "entered"
                            ? " · entered"
                            : summary.actualHeightSource === "tube-master"
                              ? " · tube master default"
                              : " · specification default"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Strength</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">CS {formatSpecMeasure(summary.requiredCs)}</p>
                        <p className="mt-1 text-xs text-slate-500">Target wt. {formatSpecMeasure(summary.targetWeightG)} g</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Recipe</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">{profileRecipeRows.length || 0} saved rows</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {spec.adhesive_components_json ? "Adhesive split stored" : "Adhesive split pending"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Packing</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">
                          {spec.profile?.packing?.box_code || spec.profile?.packing_rules?.packing_target?.box_code || "-"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Master-backed packing rules and print packet</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-3 xl:max-w-[320px] xl:justify-end">
                    <Link href={`/specifications/${spec.id}`}>
                      <Button className="gap-2">
                        Open Record
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    {canManageSpecs && spec.active !== false && !["obsolete", "review"].includes(String(spec.status || "").toLowerCase()) ? (
                      <Link href={`/specifications/${spec.id}/edit`}>
                        <Button variant="outline">Edit</Button>
                      </Link>
                    ) : null}
                    <Link href={`/specifications/${spec.id}/print`}>
                      <Button variant="outline" className="gap-2">
                        <Printer className="h-4 w-4" />
                        Print
                      </Button>
                    </Link>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}
