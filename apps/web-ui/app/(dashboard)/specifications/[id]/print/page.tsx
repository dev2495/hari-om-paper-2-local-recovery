"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { computePreviewMetrics, parseSpecState, resolveSpecTitle } from "@/components/specs/spec-sheet-utils"
import { Button } from "@/components/ui/button"
import { useCustomers, useMandrels, useTubeSizes } from "@/hooks/use-master-data"
import { specApi } from "@/lib/api"

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}

function PrintSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 print:rounded-none print:border-slate-300 print:px-0 print:py-4">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function PrintSpecificationPage() {
  const params = useParams()
  const specId = String(params.id || "")

  const { data: spec, isLoading: specLoading } = useQuery({
    queryKey: ["spec", specId],
    queryFn: async () => {
      const { data } = await specApi.getSpec(specId)
      return data
    },
    enabled: Boolean(specId),
  })

  const { data: recipes = [], isLoading: recipesLoading } = useQuery({
    queryKey: ["spec", specId, "recipes"],
    queryFn: async () => {
      const { data } = await specApi.getRecipesForSpec(specId)
      return Array.isArray(data) ? data : data?.items || []
    },
    enabled: Boolean(specId),
  })

  const latestRecipe = useMemo(() => {
    const ordered = [...recipes].sort((left: any, right: any) => Number(right.version || 0) - Number(left.version || 0))
    return ordered.find((recipe: any) => String(recipe.status || "").toLowerCase() === "trial") || ordered[0]
  }, [recipes])

  const { data: recipeDetail } = useQuery({
    queryKey: ["recipe", latestRecipe?.id],
    queryFn: async () => {
      const { data } = await specApi.getRecipe(latestRecipe.id)
      return data
    },
    enabled: Boolean(latestRecipe?.id),
  })

  const { data: customers = [] } = useCustomers()
  const { data: tubeSizes = [] } = useTubeSizes()
  const { data: mandrels = [] } = useMandrels()

  const state = useMemo(() => parseSpecState(spec, recipeDetail), [recipeDetail, spec])
  const selectedCustomer = useMemo(
    () =>
      (Array.isArray(customers) ? customers : []).find(
        (entry: any) => String(entry.id) === String(spec?.customer_id || state.customerId),
      ),
    [customers, spec?.customer_id, state.customerId],
  )
  const selectedTubeSize = useMemo(
    () => (Array.isArray(tubeSizes) ? tubeSizes : []).find((entry: any) => String(entry.id) === state.tubeSizeId),
    [state.tubeSizeId, tubeSizes],
  )
  const selectedMandrel = useMemo(
    () => (Array.isArray(mandrels) ? mandrels : []).find((entry: any) => String(entry.id) === state.mandrelId),
    [mandrels, state.mandrelId],
  )
  const preview = useMemo(() => computePreviewMetrics(state, selectedMandrel || null), [selectedMandrel, state])

  if (specLoading || recipesLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading print packet...</div>
  }

  if (!spec) {
    return <div className="p-8 text-sm text-rose-700">Specification not found.</div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/specifications/${specId}`}>
          <Button variant="outline">Back</Button>
        </Link>
        <div className="flex gap-3">
          <Link href={`/specifications/${specId}/edit`}>
            <Button variant="outline">Edit</Button>
          </Link>
          <Button onClick={() => window.print()}>Print Specification</Button>
        </div>
      </div>

      <main className="space-y-4 rounded-[32px] border border-slate-200 bg-[#fcfaf6] p-6 shadow-premium print:rounded-none print:border-none print:bg-white print:p-0 print:shadow-none">
        <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white print:rounded-none">
          <div className="bg-[linear-gradient(135deg,#0f172a,#164e63_58%,#0f766e)] px-6 py-6 text-white print:bg-none print:px-0 print:py-0 print:text-slate-950">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/70 print:text-slate-400">
                  Hari Om Paper · Specification Packet
                </p>
                <h1 className="mt-3 text-3xl font-semibold">{resolveSpecTitle(spec)}</h1>
                <p className="mt-2 text-sm text-white/75 print:text-slate-600">
                  Approved print packet for planning, trial review, and shop-floor release.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/10 px-4 py-3 text-sm print:border-slate-200 print:bg-slate-50">
                <p>Spec ID: {String(spec.id).slice(0, 8).toUpperCase()}</p>
                <p className="mt-1">Status: {spec.status}</p>
                <p className="mt-1">Created: {formatDate(spec.created_at)}</p>
                <p className="mt-1">Recipe: {latestRecipe ? `v${latestRecipe.version}` : "Not linked"}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Customer</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {selectedCustomer?.name || state.customerName || spec.customer_name_snapshot || spec.customer_name}
            </p>
            <p className="mt-1 text-sm text-slate-500">{selectedCustomer?.customer_code || spec.customer_id || "-"}</p>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Tube Geometry</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              ID {state.clientIdMm} / OD {state.clientOdMm}
            </p>
            <p className="mt-1 text-sm text-slate-500">Length {state.tubeLengthMm} mm</p>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Strength & Weight</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">CS {state.requiredCs}</p>
            <p className="mt-1 text-sm text-slate-500">Target wt. {state.targetTubeWeight} g</p>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Mandrel & Size</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {selectedMandrel?.mandrel_code || selectedMandrel?.name || "-"}
            </p>
            <p className="mt-1 text-sm text-slate-500">{selectedTubeSize?.name || selectedTubeSize?.internal_code || "-"}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
          <PrintSection title="Recipe Architecture">
            {state.recipeRows.length > 0 ? (
              <div className="overflow-hidden rounded-[20px] border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Paper</th>
                      <th className="px-4 py-3">Variety</th>
                      <th className="px-4 py-3">GSM</th>
                      <th className="px-4 py-3">BF</th>
                      <th className="px-4 py-3">Ply Count</th>
                      <th className="px-4 py-3">Thickness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {state.recipeRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.code || row.paper_id || "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{row.variety || row.category || "Kraft paper"}</td>
                        <td className="px-4 py-3 text-slate-600">{row.gsm}</td>
                        <td className="px-4 py-3 text-slate-600">{row.bf_per_ply}</td>
                        <td className="px-4 py-3 text-slate-600">{row.ply_count}</td>
                        <td className="px-4 py-3 text-slate-600">{row.thickness_per_ply} mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No recipe rows are attached to this specification yet.</p>
            )}
          </PrintSection>

          <div className="space-y-4">
            <PrintSection title="Manufacturing Preview">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Wall Thickness</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{preview.wall_thickness_mm} mm</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Manufacturing OD</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{preview.manufacturing_od_mm} mm</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Wet Weight</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{preview.wet_weight_g} g</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Paper Weight</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{preview.paper_weight_g} g</p>
                </div>
              </div>
              {preview.bamboo_plan ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-900">Bamboo plan</p>
                  <p className="mt-2">
                    Use {preview.bamboo_plan.selected_bamboo_length_mm} mm bamboo with {preview.bamboo_plan.usable_length_mm} mm usable length.
                  </p>
                  <p className="mt-1">
                    {preview.bamboo_plan.tubes_per_bamboo} tubes per bamboo, trim waste {preview.bamboo_plan.trim_waste_mm} mm.
                  </p>
                </div>
              ) : null}
            </PrintSection>

            <PrintSection title="Adhesive Split">
              <div className="space-y-3">
                {state.adhesives.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-900">{row.label || row.adhesive_id || "Adhesive"}</p>
                      <p className="text-sm font-semibold text-slate-900">{row.ratio_percent}%</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Base adhesive allowance {row.base_percent}% of target tube weight.</p>
                  </div>
                ))}
              </div>
            </PrintSection>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PrintSection title="Notch Tooling">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Required</p>
                <p className="mt-2 font-medium text-slate-900">{state.notch.notch_required ? "Yes" : "No"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Type</p>
                <p className="mt-2 font-medium text-slate-900">{state.notch.notch_type || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Distance</p>
                <p className="mt-2 font-medium text-slate-900">{state.notch.notch_distance_mm || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Depth</p>
                <p className="mt-2 font-medium text-slate-900">{state.notch.notch_depth_mm || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Holder / Blade</p>
                <p className="mt-2 font-medium text-slate-900">
                  {state.notch.notching_holder || "-"} / {state.notch.notching_blade || "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tool Stack</p>
                <p className="mt-2 font-medium text-slate-900">
                  {state.notch.groove || "-"} · {state.notch.punch || "-"} · {state.notch.tochha || "-"}
                </p>
              </div>
            </div>
          </PrintSection>

          <PrintSection title="Packing Handoff">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Bundle</p>
                <p className="mt-2 font-medium text-slate-900">{state.packing.bundle_type || "-"}</p>
                <p className="mt-1 text-slate-500">{state.packing.bundle_code || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Box</p>
                <p className="mt-2 font-medium text-slate-900">{state.packing.box_code || "-"}</p>
                <p className="mt-1 text-slate-500">{state.packing.box_size || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Qty per Box</p>
                <p className="mt-2 font-medium text-slate-900">{state.packing.qty_per_box || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Plastic / Fadda</p>
                <p className="mt-2 font-medium text-slate-900">{state.packing.plastic_sku || "-"} / {state.packing.fadda_sku || "-"}</p>
              </div>
            </div>
            {state.packing.special_instructions ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Instructions</p>
                <p className="mt-2">{state.packing.special_instructions}</p>
              </div>
            ) : null}
          </PrintSection>
        </div>
      </main>
    </div>
  )
}
