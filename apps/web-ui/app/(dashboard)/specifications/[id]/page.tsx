"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"
import { resolveSpecTitle } from "@/components/specs/spec-sheet-utils"
import { Button } from "@/components/ui/button"
import { specApi } from "@/lib/api"

function statusTone(status: string) {
  switch (String(status || "").toLowerCase()) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "obsolete":
      return "border-rose-200 bg-rose-50 text-rose-700"
    case "trial":
      return "border-sky-200 bg-sky-50 text-sky-700"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700"
  }
}

export default function SpecificationDetailPage() {
  const params = useParams()
  const queryClient = useQueryClient()
  const specId = String(params.id || "")
  const [error, setError] = useState<string | null>(null)

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

  const preferredRecipe = useMemo(() => {
    const ordered = [...recipes].sort((left: any, right: any) => Number(right.version || 0) - Number(left.version || 0))
    return ordered.find((recipe: any) => String(recipe.status || "").toLowerCase() === "trial") || ordered[0]
  }, [recipes])

  const { data: preferredRecipeDetail } = useQuery({
    queryKey: ["recipe", preferredRecipe?.id],
    queryFn: async () => {
      const { data } = await specApi.getRecipe(preferredRecipe.id)
      return data
    },
    enabled: Boolean(preferredRecipe?.id),
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const payload = preferredRecipe?.id ? { recipe_id: preferredRecipe.id } : {}
      const { data } = await specApi.approveSpec(specId, payload)
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["spec", specId] }),
        queryClient.invalidateQueries({ queryKey: ["spec", specId, "recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["specs"] }),
      ])
    },
    onError: (mutationError: any) => {
      setError(String(mutationError?.response?.data?.detail || mutationError?.message || "Approval failed."))
    },
  })

  const obsoleteMutation = useMutation({
    mutationFn: async () => {
      const { data } = await specApi.obsoleteSpec(specId)
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["spec", specId] }),
        queryClient.invalidateQueries({ queryKey: ["specs"] }),
      ])
    },
    onError: (mutationError: any) => {
      setError(String(mutationError?.response?.data?.detail || mutationError?.message || "Failed to obsolete spec."))
    },
  })

  if (specLoading || recipesLoading) {
    return <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">Loading specification...</div>
  }

  if (!spec) {
    return <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-700">Specification not found.</div>
  }

  const canApprove = String(spec.status || "").toLowerCase() !== "approved" && Boolean(preferredRecipe?.id)
  const canObsolete = String(spec.status || "").toLowerCase() === "approved"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white/80 px-6 py-6 shadow-premium lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Specification Record</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-950">{resolveSpecTitle(spec)}</h1>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(spec.status)}`}>
              {spec.status}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            View the saved snapshot exactly as the planner and job-card services read it, then approve the latest trial recipe when it is ready.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/specifications">
            <Button variant="outline">Back</Button>
          </Link>
          <Link href={`/specifications/${specId}/edit`}>
            <Button variant="outline">Edit</Button>
          </Link>
          <Link href={`/specifications/${specId}/print`}>
            <Button variant="outline">Print</Button>
          </Link>
          {canApprove ? (
            <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              {approveMutation.isPending ? "Approving..." : "Approve"}
            </Button>
          ) : null}
          {canObsolete ? (
            <Button variant="destructive" onClick={() => obsoleteMutation.mutate()} disabled={obsoleteMutation.isPending}>
              {obsoleteMutation.isPending ? "Updating..." : "Mark Obsolete"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Recipe Versions</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{recipes.length}</p>
          <p className="mt-1 text-sm text-slate-500">Latest trial {preferredRecipe?.version ? `v${preferredRecipe.version}` : "not available"}.</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Weight</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{spec.target_tube_weight} g</p>
          <p className="mt-1 text-sm text-slate-500">Required CS {spec.required_cs}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Tube Range</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {spec.id_max_mm || spec.id_min_mm} / {spec.od_max_mm || spec.od_min_mm}
          </p>
          <p className="mt-1 text-sm text-slate-500">ID / OD mm · length {spec.length_max_mm || spec.length_min_mm}</p>
        </div>
      </div>

      <SpecSheetDocument initialSpec={spec} initialRecipe={preferredRecipeDetail} readOnly />
    </div>
  )
}
