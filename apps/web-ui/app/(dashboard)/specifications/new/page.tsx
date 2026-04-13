"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { SpecSheetDocument, type SpecSheetSubmission } from "@/components/specs/SpecSheetDocument"
import { specApi } from "@/lib/api"

export default function NewSpecificationPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async ({ specPayload, recipeLayers }: SpecSheetSubmission) => {
      const { data: spec } = await specApi.createSpec(specPayload)
      if (recipeLayers.length > 0) {
        const { data: recipe } = await specApi.createRecipe(spec.id, { notes: "TubeOS spec recipe" })
        await Promise.all(recipeLayers.map((layer) => specApi.addRecipeLayer(recipe.id, layer)))
      }
      return spec
    },
    onSuccess: async (spec) => {
      await queryClient.invalidateQueries({ queryKey: ["specs"] })
      router.push(`/specifications/${spec.id}`)
    },
    onError: (mutationError: any) => {
      const detail =
        mutationError?.response?.data?.detail ||
        mutationError?.message ||
        "Failed to create specification."
      setError(String(detail))
    },
  })

  const handleSave = async (submission: SpecSheetSubmission) => {
    setError(null)
    await createMutation.mutateAsync(submission)
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <SpecSheetDocument onSave={handleSave} isSaving={createMutation.isPending} />
    </div>
  )
}
