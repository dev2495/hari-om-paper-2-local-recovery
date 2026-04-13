"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SpecSheetDocument, type SpecSheetSubmission } from "@/components/specs/SpecSheetDocument"
import { Button } from "@/components/ui/button"
import { specApi } from "@/lib/api"

export default function EditSpecificationPage() {
  const params = useParams()
  const router = useRouter()
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

  const latestRecipe = useMemo(() => {
    return [...recipes].sort((left: any, right: any) => Number(right.version || 0) - Number(left.version || 0))[0]
  }, [recipes])

  const { data: latestRecipeDetail } = useQuery({
    queryKey: ["recipe", latestRecipe?.id],
    queryFn: async () => {
      const { data } = await specApi.getRecipe(latestRecipe.id)
      return data
    },
    enabled: Boolean(latestRecipe?.id),
  })

  const saveMutation = useMutation({
    mutationFn: async ({ specPayload, recipeLayers }: SpecSheetSubmission) => {
      const { data: updated } = await specApi.updateSpec(specId, specPayload)
      if (recipeLayers.length > 0) {
        const { data: recipe } = await specApi.createRecipe(specId, { notes: "Updated TubeOS spec recipe" })
        await Promise.all(recipeLayers.map((layer) => specApi.addRecipeLayer(recipe.id, layer)))
      }
      return updated
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["spec", specId] }),
        queryClient.invalidateQueries({ queryKey: ["spec", specId, "recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["specs"] }),
      ])
      router.push(`/specifications/${specId}`)
    },
    onError: (mutationError: any) => {
      const detail =
        mutationError?.response?.data?.detail ||
        mutationError?.message ||
        "Failed to update specification."
      setError(String(detail))
    },
  })

  const handleSave = async (submission: SpecSheetSubmission) => {
    setError(null)
    await saveMutation.mutateAsync(submission)
  }

  if (specLoading || recipesLoading) {
    return <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">Loading specification...</div>
  }

  if (!spec) {
    return <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-700">Specification not found.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white/80 px-6 py-6 shadow-premium sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Design Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Edit Specification</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Saving creates a fresh trial recipe version while preserving the approved history already attached to this spec.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href={`/specifications/${specId}`}>
            <Button variant="outline">Cancel</Button>
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <SpecSheetDocument
        initialSpec={spec}
        initialRecipe={latestRecipeDetail}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />
    </div>
  )
}
