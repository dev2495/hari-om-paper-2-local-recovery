"use client"

import Link from "next/link"
import { startTransition, useDeferredValue, useMemo, useState } from "react"
import { ArrowRight, Factory, FilePlus2, Printer, Search, ScrollText } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { resolveSpecTitle } from "@/components/specs/spec-sheet-utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { useCustomers, useMandrels, useTubeSizes } from "@/hooks/use-master-data"
import { specApi } from "@/lib/api"
import { qcRowActions, qcSetupStatus } from "@/lib/qc-measurement"
import { formatSpecMeasure, resolveSpecSummary } from "@/lib/spec-summary"
import { PageHeader } from "@/components/workspace/page-header"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
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
      return "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    case "review":
      return "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
    case "obsolete":
      return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
    case "trial":
      return "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

export default function SpecificationsIndexPage() {
  const { user } = useAuth()
  const [searchValue, setSearchValue] = useState("")
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all")
  const [versionView, setVersionView] = useState<"active" | "disabled">("active")
  const deferredSearchValue = useDeferredValue(searchValue.trim().toLowerCase())
  const canManageSpecs = Boolean(user?.roles?.some((role) => role === "Owner" || role === "Admin") || user?.role === "Owner" || user?.role === "Admin")
  const canAuthorQc = Boolean(
    canManageSpecs || user?.roles?.some((role) => role === "QC") || user?.role === "QC",
  )
  const queryClient = useQueryClient()
  const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([])
  const [templateSpecId, setTemplateSpecId] = useState("")
  const [assignPreview, setAssignPreview] = useState<any>(null)
  const [assignError, setAssignError] = useState<string | null>(null)

  const previewAssign = useMutation({
    mutationFn: (data: any) => specApi.previewQcProfileAssign(data),
    onSuccess: (response) => {
      setAssignError(null)
      setAssignPreview(response.data)
    },
    onError: (error: any) => {
      setAssignPreview(null)
      setAssignError(error?.response?.data?.detail?.message || error?.response?.data?.detail || "Preview failed")
    },
  })
  const applyAssign = useMutation({
    mutationFn: (data: any) => specApi.applyQcProfileAssign(data),
    onSuccess: (response) => {
      setAssignError(null)
      setAssignPreview(response.data)
      queryClient.invalidateQueries({ queryKey: ["specs"] })
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail
      setAssignError(detail?.message || (typeof detail === "string" ? detail : "Apply failed"))
    },
  })

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
  const templateSpecs = useMemo(
    () =>
      specs.filter((spec: any) => {
        const status = String(spec.qc_setup_status || qcSetupStatus(spec.qc_profile) || "")
        return spec.active !== false && status && status !== "missing"
      }),
    [specs],
  )

  function toggleSelected(id: string) {
    setSelectedSpecIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

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
        <section className="flex flex-wrap items-start gap-3 rounded-[1.6rem] border border-signal-amber-line bg-signal-amber-soft/80 px-5 py-4 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-signal-amber-soft text-signal-amber-ink">
            <ScrollText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-signal-amber-ink">
              Recipe cascade bottleneck
            </p>
            <p className="mt-1 text-sm font-semibold text-signal-amber-ink">
              {recipeCascadeIssues.length} approved spec
              {recipeCascadeIssues.length === 1 ? "" : "s"} have no approved recipe — release-to-job will
              fail until at least one recipe is promoted from <strong>trial</strong> to <strong>approved</strong>.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recipeCascadeIssues.slice(0, 8).map((spec: any) => (
                <Link
                  key={spec.id}
                  href={`/specifications/${spec.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-signal-amber-line bg-card px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-signal-amber-ink hover:bg-signal-amber-soft"
                >
                  {String(spec.product_code || spec.id).slice(0, 14)}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
              {recipeCascadeIssues.length > 8 ? (
                <span className="text-[11px] font-semibold text-signal-amber-ink">+ {recipeCascadeIssues.length - 8} more</span>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <PageHeader
        variant="hero"
        appearance={MODULE_APPEARANCES.sales}
        badge="Spec Control Room"
        title="Commercial spec sheets, recipe truth, and printable release packets in one lane."
        description="Start from the master-driven spec sheet, keep trial versions attached to the same record, and send the approved snapshot straight into planning and job-card execution."
        actions={
          <div className="flex flex-wrap gap-3">
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
        }
      />

      <section className="grid gap-3 rounded-[32px] border border-border bg-card/80 p-5 shadow-premium sm:grid-cols-3">
            <div className="rounded-[28px] border border-border bg-muted px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Active Specs</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{statusCounts.all}</p>
              <p className="mt-1 text-sm text-muted-foreground">All active draft, Owner review, trial, and live records in the current plant.</p>
            </div>
            <div className="rounded-[28px] border border-border bg-muted px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Review Queue</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{statusCounts.review + statusCounts.trial}</p>
              <p className="mt-1 text-sm text-muted-foreground">Versions waiting for validation or Owner approval.</p>
            </div>
            <div className="rounded-[28px] border border-border bg-muted px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Approved Live</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{statusCounts.approved}</p>
              <p className="mt-1 text-sm text-muted-foreground">Approved snapshots that planning and production can rely on.</p>
            </div>
      </section>

      {canAuthorQc ? (
        <section
          data-testid="spec-assign-panel"
          className="space-y-4 rounded-[32px] border border-border bg-card/80 px-5 py-5 shadow-premium"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Assign profile</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Assign profile to selected specs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preview per-spec impact first. Apply writes draft QC only — it does not publish and it does not rewrite issued jobs.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px] flex-1 text-sm font-medium text-muted-foreground">
              Template
              <select
                data-testid="spec-assign-template"
                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm"
                value={templateSpecId}
                onChange={(event) => setTemplateSpecId(event.target.value)}
              >
                <option value="">Select a template spec</option>
                {templateSpecs.map((spec: any) => (
                  <option key={spec.id} value={spec.id}>
                    {resolveSpecTitle(spec)} ({qcSetupStatus(spec.qc_profile)})
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              data-testid="spec-assign-preview"
              disabled={!templateSpecId || selectedSpecIds.length === 0 || previewAssign.isPending}
              onClick={() =>
                previewAssign.mutate({
                  template_spec_id: templateSpecId,
                  spec_ids: selectedSpecIds,
                  publish: false,
                })
              }
            >
              Preview impact
            </Button>
            <Button
              type="button"
              data-testid="spec-assign-apply"
              disabled={!templateSpecId || selectedSpecIds.length === 0 || applyAssign.isPending}
              onClick={() =>
                applyAssign.mutate({
                  template_spec_id: templateSpecId,
                  spec_ids: selectedSpecIds,
                  publish: false,
                })
              }
            >
              Apply drafts
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="spec-assign-selected-count">
            {selectedSpecIds.length} spec{selectedSpecIds.length === 1 ? "" : "s"} selected
          </p>
          {assignError ? (
            <p className="text-sm font-medium text-signal-rose-ink" data-testid="spec-assign-error">
              {typeof assignError === "string" ? assignError : JSON.stringify(assignError)}
            </p>
          ) : null}
          {assignPreview?.results ? (
            <div className="overflow-x-auto rounded-2xl border border-border" data-testid="spec-assign-results">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Spec</th>
                    <th className="px-3 py-2">Applicable</th>
                    <th className="px-3 py-2">Impact</th>
                    <th className="px-3 py-2">Unresolved</th>
                    <th className="px-3 py-2">Published</th>
                    <th className="px-3 py-2">Issued jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {assignPreview.results.map((row: any) => (
                    <tr key={row.spec_id} data-testid={`spec-assign-row-${row.spec_id}`}>
                      <td className="px-3 py-2 font-medium text-foreground">{row.customer_name || row.spec_id}</td>
                      <td className="px-3 py-2">{row.applicable ? "Yes" : "No"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.error?.message || row.action || "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {(row.unresolved_fields || []).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2">{row.published ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{row.rewrites_issued_jobs ? "Rewritten" : "Unchanged"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[32px] border border-border bg-card/80 px-5 py-5 shadow-premium">
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
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {view.label} {view.count}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(event) => {
                const nextValue = event.target.value
                startTransition(() => setSearchValue(nextValue))
              }}
              placeholder="Search customer, tube size, mandrel, or status"
              className="h-12 rounded-full border-border bg-muted pl-11"
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
                    ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
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
          <div className="rounded-[32px] border border-border bg-card/80 px-6 py-10 text-sm text-muted-foreground shadow-premium">
            Loading specifications...
          </div>
        ) : filteredSpecs.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-border bg-card/70 px-6 py-12 text-center shadow-premium">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ScrollText className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              {searchValue || statusFilter !== "all" ? "No specifications match this filter." : "No specifications yet."}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
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
                className="rounded-[32px] border border-border bg-card/80 px-6 py-6 shadow-premium transition hover:-translate-y-0.5 hover:shadow-premium-hover"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      {canAuthorQc ? (
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          <input
                            type="checkbox"
                            data-testid={`spec-assign-select-${spec.id}`}
                            checked={selectedSpecIds.includes(String(spec.id))}
                            onChange={() => toggleSelected(String(spec.id))}
                          />
                          Select
                        </label>
                      ) : null}
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Saved {formatDate(spec.created_at)}
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(spec.status)}`}>
                        {String(spec.status).toLowerCase() === "approved" ? "live" : spec.status}
                      </span>
                      {(() => {
                        const qcStatus = qcSetupStatus(spec.qc_profile)
                        return (
                          <span
                            data-testid={`spec-qc-status-${spec.id}`}
                            data-qc-status={qcStatus}
                            className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-3 py-1 text-xs font-semibold text-signal-amber-ink"
                          >
                            {qcStatus === "draft" ? "Draft / Missing fields" : qcStatus === "missing" ? "Missing setup" : qcStatus}
                          </span>
                        )
                      })()}
                      {spec.active === false ? (
                        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                          disabled version
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold text-foreground">{resolveSpecTitle(spec)}</h2>
                    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                      {(customer?.name || spec.customer_name_snapshot || spec.customer_name || "Customer pending")} ·{" "}
                      {summary.tubeLabel} ·{" "}
                      {(mandrel?.mandrel_code || mandrel?.name || "Mandrel pending")}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Client Dimensions</p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          ID {formatSpecMeasure(summary.idMm)} / OD {formatSpecMeasure(summary.odMm)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground" data-testid={`spec-summary-height-${spec.id}`}>
                          Actual height {formatSpecMeasure(summary.actualHeightMm)} mm
                          {summary.actualHeightSource === "entered"
                            ? " · entered"
                            : summary.actualHeightSource === "tube-master"
                              ? " · tube master default"
                              : " · specification default"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Strength</p>
                        <p className="mt-2 text-sm font-medium text-foreground">CS {formatSpecMeasure(summary.requiredCs)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Target wt. {formatSpecMeasure(summary.targetWeightG)} g</p>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Recipe</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{profileRecipeRows.length || 0} saved rows</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {spec.adhesive_components_json ? "Adhesive split stored" : "Adhesive split pending"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Packing</p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {spec.profile?.packing?.box_code || spec.profile?.packing_rules?.packing_target?.box_code || "-"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Master-backed packing rules and print packet</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-3 xl:max-w-[360px] xl:justify-end">
                    <Link href={`/specifications/${spec.id}`}>
                      <Button className="gap-2">
                        Open Record
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    {(() => {
                      const qcStatus = qcSetupStatus(spec.qc_profile)
                      const actions = qcRowActions({
                        qcStatus,
                        specId: String(spec.id),
                        specStatus: spec.status,
                        active: spec.active,
                        canAuthor: canAuthorQc,
                        canApprove: canManageSpecs,
                      })
                      return actions.map((action) => (
                        <Link
                          key={`${action.kind}-${action.href}`}
                          href={action.href}
                          data-testid={`spec-qc-action-${spec.id}-${action.kind}`}
                          data-qc-action={action.kind}
                        >
                          <Button variant="outline">{action.label}</Button>
                        </Link>
                      ))
                    })()}
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
