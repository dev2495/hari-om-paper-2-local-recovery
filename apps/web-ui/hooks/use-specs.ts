import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { specApi } from "@/lib/api"
import {
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  RecipeDetail,
  RecipeLayer,
  RecipeSummary,
  SpecRecord,
  TrialRecord,
  roundValue,
} from "@/lib/spec-sheet"
import { computePreview } from "@/lib/spec-math"

function getLatestRecipe(recipes: RecipeSummary[]) {
  return [...(recipes || [])].sort((left, right) => right.version - left.version)[0] || null
}

const DEFAULT_DRYING_PERCENT = 9.0
const DEFAULT_PARCHMENT_PERCENT = 1.5
const DEFAULT_GLUE_BASE_PERCENT = 15
const BAMBOO_MIN_LENGTH_MM = 1390
const BAMBOO_MAX_LENGTH_MM = 1560
const BAMBOO_STEP_MM = 10
const BAMBOO_CUT_LOSS_MM = 40

function perPlyWeightG(gsm: number, tubeLengthMm: number, tubeIdMm: number, tubeOdMm: number) {
  const effectiveDiameterMm = Math.max((Number(tubeIdMm || 0) + Number(tubeOdMm || 0)) / 2, 1)
  return (Math.PI * effectiveDiameterMm * Math.max(Number(tubeLengthMm || 0), 0) * Math.max(Number(gsm || 0), 0)) / 1_000_000
}

function pickBambooPlan(tubeLengthMm: number) {
  if (tubeLengthMm <= 0) {
    return {
      selected_bamboo_length_mm: 0,
      usable_length_mm: 0,
      tubes_per_bamboo: 0,
      trim_waste_mm: 0,
    }
  }

  let best = {
    selected_bamboo_length_mm: BAMBOO_MIN_LENGTH_MM,
    usable_length_mm: BAMBOO_MIN_LENGTH_MM - BAMBOO_CUT_LOSS_MM,
    tubes_per_bamboo: 0,
    trim_waste_mm: 0,
  }

  for (let bambooLength = BAMBOO_MIN_LENGTH_MM; bambooLength <= BAMBOO_MAX_LENGTH_MM; bambooLength += BAMBOO_STEP_MM) {
    const usable = bambooLength - BAMBOO_CUT_LOSS_MM
    const tubes = Math.floor(usable / tubeLengthMm)
    if (tubes <= 0) continue
    const trim = roundValue(usable - tubes * tubeLengthMm, 2)
    if (
      tubes > best.tubes_per_bamboo ||
      (tubes === best.tubes_per_bamboo && trim < best.trim_waste_mm) ||
      (tubes === best.tubes_per_bamboo && trim === best.trim_waste_mm && bambooLength < best.selected_bamboo_length_mm)
    ) {
      best = {
        selected_bamboo_length_mm: bambooLength,
        usable_length_mm: usable,
        tubes_per_bamboo: tubes,
        trim_waste_mm: trim,
      }
    }
  }

  return best
}

function buildPreviewSummaryFallback(payload: {
  tubeLengthMm?: number
  tubeOdMm?: number
  tubeIdMm?: number
  targetDryWeightG?: number
  dryingPercent?: number
  parchmentPercent?: number
  parchmentAllowed?: boolean
  adhesivePercent?: number
  recipeRows?: any[]
  adhesiveComponents?: any[]
}) {
  const tubeLengthMm = Number(payload.tubeLengthMm || 0)
  const tubeOdMm = Number(payload.tubeOdMm || 0)
  const tubeIdMm = Number(payload.tubeIdMm || 0)
  const targetDryWeightG = Number(payload.targetDryWeightG || 0)
  const dryingPercent = Number(payload.dryingPercent ?? DEFAULT_DRYING_PERCENT)
  const parchmentPercent = Number(payload.parchmentPercent ?? DEFAULT_PARCHMENT_PERCENT)
  const parchmentAllowed = payload.parchmentAllowed ?? true

  const recipeRows = (payload.recipeRows || []).map((row: any) => ({
    paper_id: String(row?.paper_id || row?.paperId || ""),
    code: String(row?.code || ""),
    variety: String(row?.variety || ""),
    category: String(row?.category || ""),
    gsm: Number(row?.gsm || 0),
    ply_count: Math.max(1, Number(row?.ply_count ?? row?.plyCount ?? 1)),
    bf_per_ply: Number(row?.bf_per_ply ?? row?.bfPerPly ?? row?.bf ?? 0),
    thickness_per_ply: Number(row?.thickness_per_ply ?? row?.thicknessPerPly ?? row?.thickness_mm ?? 0),
    ply_bond: Number(row?.ply_bond ?? row?.plyBond ?? 0),
    positions_text: String(row?.positions_text ?? row?.positionsText ?? ""),
  }))
  const components = Array.isArray(payload.adhesiveComponents) ? payload.adhesiveComponents : []
  const glueBasePercent =
    Number(payload.adhesivePercent ?? components?.[0]?.base_percent ?? components?.[0]?.basePercent ?? DEFAULT_GLUE_BASE_PERCENT)

  const preview = computePreview({
    mandrel_od_mm: tubeIdMm,
    tube_length_mm: tubeLengthMm,
    papers: recipeRows.map((row: any) => {
      const gsm = Number(row.gsm || 0)
      const thicknessPerPly = Number(row.thickness_per_ply || 0)
      const bulk = gsm > 0 ? (thicknessPerPly * 1000) / gsm : 0
      return {
        paper_id: row.paper_id,
        gsm,
        bulk,
        ply_count: Math.max(1, Number(row.ply_count || 1)),
        code: row.code,
      }
    }),
    target_dry_g: targetDryWeightG,
    adhesive_percent: glueBasePercent,
    parchment_percent: parchmentPercent,
    moisture_loss_percent: dryingPercent,
    parchment_allowed: parchmentAllowed,
  })

  let plyCursor = 0
  const plyDetails = recipeRows.map((row: any) => {
    const rowPlyCount = Math.max(1, Number(row.ply_count || 1))
    const rowNominalWeightPerMm = preview.per_ply_weight_per_mm_g
      .slice(plyCursor, plyCursor + rowPlyCount)
      .reduce((sum, value) => sum + Number(value || 0), 0)
    const rowTargetWeightPerMm = preview.target_per_ply_weight_per_mm_g
      .slice(plyCursor, plyCursor + rowPlyCount)
      .reduce((sum, value) => sum + Number(value || 0), 0)
    plyCursor += rowPlyCount
    return {
      paper_id: row.paper_id,
      code: row.code,
      variety: row.variety,
      gsm: row.gsm,
      ply_count: rowPlyCount,
      weightG: roundValue(rowTargetWeightPerMm * tubeLengthMm, 2),
      nominalWeightG: roundValue(rowNominalWeightPerMm * tubeLengthMm, 2),
    }
  })

  const ratioTotal = components.reduce((sum: number, row: any) => sum + Number(row?.ratio_percent ?? row?.ratioPercent ?? 0), 0)
  const adhesiveComponents = components.map((row: any, index: number) => {
    const ratio = Number(row?.ratio_percent ?? row?.ratioPercent ?? 0)
    const weight = ratioTotal > 0 ? (preview.tube.adhesive_g * ratio) / ratioTotal : 0
    return {
      id: String(row?.adhesive_id || row?.id || index + 1),
      name: String(row?.name || row?.label || `Adhesive ${index + 1}`),
      ratio_percent: ratio,
      base_percent: glueBasePercent,
      weight_g: roundValue(weight, 2),
    }
  })

  return {
    paper_total_g: roundValue(preview.tube.paper_g, 2),
    nominal_paper_total_g: roundValue(preview.nominal_tube.paper_g, 2),
    paper_calibration_factor: roundValue(preview.paper_calibration_factor, 6),
    parchment_weight_g: roundValue(preview.tube.parchment_g, 2),
    adhesive_total_g: roundValue(preview.tube.adhesive_g, 2),
    adhesive_components: adhesiveComponents,
    drying_percent_used: dryingPercent,
    pre_oven_divisor: roundValue(Math.max(1 - dryingPercent / 100, 0.01), 4),
    pre_moisture_target_tube_g: roundValue(targetDryWeightG / Math.max(1 - dryingPercent / 100, 0.01), 2),
    predicted_dry_tube_g: roundValue(preview.tube.dry_g, 2),
    predicted_wet_tube_g: roundValue(preview.tube.wet_g, 2),
    nominal_wet_tube_g: roundValue(preview.nominal_tube.wet_g, 2),
    nominal_dry_tube_g: roundValue(preview.nominal_tube.dry_g, 2),
    nominal_paper_delta_g: roundValue(preview.nominal_tube.paper_g - preview.paper_required_g, 2),
    dry_delta_g: roundValue(preview.validation.delta_g, 2),
    wet_delta_g: roundValue(preview.tube.wet_g - targetDryWeightG / Math.max(1 - dryingPercent / 100, 0.01), 2),
    weight_per_mm_g: roundValue(preview.tube.wet_g / Math.max(tubeLengthMm, 1), 4),
    paper_required_g: roundValue(preview.paper_required_g, 2),
    bamboo_required_wet_g: roundValue(preview.bamboo.wet_g, 2),
    bamboo_required_dry_g: roundValue(preview.bamboo.dry_g, 2),
    bamboo_required_paper_g: roundValue(preview.bamboo.paper_g, 2),
    bamboo_trim_wet_g: roundValue(preview.bamboo_trim.wet_g, 2),
    bamboo_trim_dry_g: roundValue(preview.bamboo_trim.dry_g, 2),
    bamboo_trim_paper_g: roundValue(preview.bamboo_trim.paper_g, 2),
    whole_bamboo_wet_g: roundValue(preview.whole_bamboo.wet_g, 2),
    whole_bamboo_dry_g: roundValue(preview.whole_bamboo.dry_g, 2),
    whole_bamboo_paper_g: roundValue(preview.whole_bamboo.paper_g, 2),
    selected_bamboo_length_mm: Number(preview.bamboo_plan.bamboo_length_mm || 0),
    usable_length_mm: Number(preview.bamboo_plan.usable_length_mm || 0),
    finished_length_mm: Number(preview.bamboo_plan.finished_length_mm || 0),
    fixed_end_trim_mm: Number(preview.bamboo_plan.fixed_end_trim_mm || 0),
    residual_offcut_mm: Number(preview.bamboo_plan.residual_offcut_mm || 0),
    total_trim_mm: Number(preview.bamboo_plan.total_trim_mm || 0),
    tube_length_mm: tubeLengthMm,
    tubes_per_bamboo: Number(preview.bamboo_plan.tubes_per_bamboo || 0),
    ply_details: plyDetails,
  }
}

export function useSpecs(filters?: Record<string, any>) {
  return useQuery({
    queryKey: ["specs", filters || {}],
    queryFn: async () => {
      const { data } = await specApi.getSpecs(filters)
      return (data || []) as SpecRecord[]
    },
  })
}

export function useCreateSpec() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => specApi.createSpec(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
    },
  })
}

export function useUpdateSpec() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ specId, data }: { specId: string; data: any }) => specApi.updateSpec(specId, data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec", variables.specId] })
    },
  })
}

export function useCreateRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ specId, data }: { specId: string; data: any }) => specApi.createRecipe(specId, data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["recipes", variables.specId] })
    },
  })
}

export function useAddRecipeLayer() {
  return useMutation({
    mutationFn: ({ recipeId, data }: { recipeId: string; data: any }) => specApi.addRecipeLayer(recipeId, data),
  })
}

export function useCreateTrial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, data }: { recipeId: string; data: any }) => specApi.createTrial(recipeId, data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["trials", variables.recipeId] })
    },
  })
}

export function useRecordTrial() {
  return useCreateTrial()
}

export function useApproveSpec() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ specId, data, plantId }: { specId: string; data?: any; plantId?: string }) =>
      specApi.approveSpec(specId, data ?? {}, plantId),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec", variables.specId] })
      queryClient.invalidateQueries({ queryKey: ["spec-sheet-document", variables.specId] })
    },
  })
}

export function useObsoleteSpec() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ specId, data, plantId }: { specId: string; data?: any; plantId?: string }) =>
      specApi.obsoleteSpec(specId, data ?? {}, plantId),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec", variables.specId] })
      queryClient.invalidateQueries({ queryKey: ["spec-sheet-document", variables.specId] })
    },
  })
}

export function useSpec(id: string) {
  return useQuery({
    queryKey: ["spec", id],
    queryFn: async () => {
      const { data } = await specApi.getSpec(id)
      return data as SpecRecord
    },
    enabled: !!id,
  })
}

export function useRecipe(recipeId: string) {
  return useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: async () => {
      const { data } = await specApi.getRecipe(recipeId)
      return data as RecipeDetail
    },
    enabled: !!recipeId,
  })
}

export function useTrials(recipeId: string) {
  return useQuery({
    queryKey: ["trials", recipeId],
    queryFn: async () => {
      const { data } = await specApi.getTrials(recipeId)
      return (data || []) as TrialRecord[]
    },
    enabled: !!recipeId,
  })
}

export function useRecipesForSpec(specId: string, status?: string) {
  return useQuery({
    queryKey: ["recipes", specId, status || "all"],
    queryFn: async () => {
      const { data } = await specApi.getRecipesForSpec(specId)
      const recipes = (data || []) as RecipeSummary[]
      if (!status) return recipes
      return recipes.filter((recipe) => recipe.status === status)
    },
    enabled: !!specId,
  })
}

export function useSpecConstants() {
  return useQuery({
    queryKey: ["spec", "constants"],
    queryFn: async () => {
      const { data } = await specApi.getConstants()
      return data
    },
  })
}

export function useSpecDefaults(plantId?: string | null) {
  return useQuery({
    queryKey: ["spec", "defaults", plantId || "none"],
    queryFn: async () => {
      const { data } = await specApi.getDefaults(plantId || undefined)
      return data
    },
    enabled: Boolean(plantId && plantId !== "ALL"),
  })
}

export function useSpecFields() {
  return useQuery({
    queryKey: ["spec-fields"],
    queryFn: async () => {
      const { data } = await specApi.getSpecFields()
      return data || []
    },
  })
}

export function useSpecYield(specId: string, tubeLengthMm?: number) {
  return useQuery({
    queryKey: ["spec", "yield", specId, tubeLengthMm || 0],
    queryFn: async () => {
      const { data } = await specApi.calculateYield(specId, Number(tubeLengthMm))
      return data
    },
    enabled: !!specId && !!tubeLengthMm && Number(tubeLengthMm) > 0,
  })
}

export function useSpecBom(recipeId: string, tubeLengthMm?: number, tubeOdMm?: number) {
  return useQuery({
    queryKey: ["spec", "bom", recipeId, tubeLengthMm || 0, tubeOdMm || 0],
    queryFn: async () => {
      const { data } = await specApi.calculateBom(recipeId, Number(tubeLengthMm), Number(tubeOdMm))
      return data
    },
    enabled: !!recipeId && !!tubeLengthMm && !!tubeOdMm && Number(tubeLengthMm) > 0 && Number(tubeOdMm) > 0,
  })
}

export function useSpecSheetDocument(specId: string) {
  return useQuery({
    queryKey: ["spec-sheet-document", specId],
    queryFn: async () => {
      const { data: spec } = await specApi.getSpec(specId)
      const { data: recipeList } = await specApi.getRecipesForSpec(specId)
      const recipes = (recipeList || []) as RecipeSummary[]
      const latestRecipe = getLatestRecipe(recipes)
      let latestRecipeDetail: RecipeDetail | null = null
      let trials: TrialRecord[] = []

      if (latestRecipe?.id) {
        const { data: recipeDetail } = await specApi.getRecipe(latestRecipe.id)
        latestRecipeDetail = recipeDetail as RecipeDetail
        const { data: trialList } = await specApi.getTrials(latestRecipe.id)
        trials = (trialList || []) as TrialRecord[]
      }

      return {
        spec: spec as SpecRecord,
        recipes,
        latestRecipe: latestRecipeDetail,
        trials,
      }
    },
    enabled: !!specId,
  })
}

export function useEnsureSpecSheetCatalog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      existingFields = [],
      plantId,
    }: {
      existingFields?: Array<{ key: string }>
      plantId?: string
    } = {}) => {
      let currentFields = existingFields || []
      try {
        const { data } = await specApi.getSpecFields()
        if (Array.isArray(data)) {
          currentFields = [...currentFields, ...data]
        }
      } catch {
        // If the refresh fails, fall back to the fields already loaded by the page.
      }

      const existingKeys = new Set(currentFields.map((field) => field.key))
      const created: string[] = []

      for (const definition of DEFAULT_SPEC_FIELD_DEFINITIONS) {
        if (existingKeys.has(definition.field_key)) continue
        try {
          await specApi.createSpecField({
            key: definition.field_key,
            label: definition.label,
            field_type: definition.field_type,
            required: Boolean(definition.required),
            options: definition.options,
          }, plantId)
          created.push(definition.field_key)
        } catch (error: any) {
          const detail = error?.response?.data?.detail
          if (typeof detail === "string" && detail.toLowerCase().includes("already exists")) {
            continue
          }
          throw error
        }
      }

      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spec-fields"] })
    },
  })
}

export function useCreateSpecSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      specData,
      recipeData,
      recipeLayers,
      trialData,
      plantId,
    }: {
      specData: any
      recipeData: any
      recipeLayers: RecipeLayer[]
      trialData?: any
      plantId?: string
    }) => {
      const specResponse = await specApi.createSpec(specData, plantId)
      const spec = specResponse.data as SpecRecord
      const recipeResponse = await specApi.createRecipe(spec.id, recipeData || {}, plantId)
      const recipe = recipeResponse.data as RecipeSummary

      for (const layer of recipeLayers || []) {
        await specApi.addRecipeLayer(recipe.id, layer, plantId)
      }

      let trial = null
      if (trialData) {
        const trialResponse = await specApi.createTrial(recipe.id, trialData, plantId)
        trial = trialResponse.data as TrialRecord
      }

      return { spec, recipe, trial }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec-sheet-document", result.spec.id] })
    },
  })
}

export function useUpdateSpecSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      specId,
      specData,
      recipeData,
      recipeLayers,
      trialData,
      plantId,
    }: {
      specId: string
      specData: any
      recipeData: any
      recipeLayers: RecipeLayer[]
      trialData?: any
      plantId?: string
    }) => {
      const specResponse = await specApi.updateSpec(specId, specData, plantId)
      const spec = specResponse.data as SpecRecord
      let recipe: RecipeSummary | null = null

      if ((recipeLayers || []).length > 0) {
        // There is no recipe update API in the backend. A fresh recipe version is the safe additive path.
        const recipeResponse = await specApi.createRecipe(spec.id, recipeData || {}, plantId)
        recipe = recipeResponse.data as RecipeSummary
        for (const layer of recipeLayers || []) {
          await specApi.addRecipeLayer(recipe.id, layer, plantId)
        }
      }

      let trial = null
      if (trialData && recipe?.id) {
        const trialResponse = await specApi.createTrial(recipe.id, trialData, plantId)
        trial = trialResponse.data as TrialRecord
      }

      return { spec, recipe, trial }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec", result.spec.id] })
      queryClient.invalidateQueries({ queryKey: ["spec-sheet-document", result.spec.id] })
    },
  })
}

export function useCloneSpecSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ specId, plantId }: { specId: string; plantId?: string }) => {
      const { data: sourceSpec } = await specApi.getSpec(specId)
      const { data: recipeList } = await specApi.getRecipesForSpec(specId)
      const recipes = (recipeList || []) as RecipeSummary[]
      const latestRecipe = getLatestRecipe(recipes)
      let latestRecipeDetail: RecipeDetail | null = null
      if (latestRecipe?.id) {
        const { data } = await specApi.getRecipe(latestRecipe.id)
        latestRecipeDetail = data as RecipeDetail
      }

      const specPayload = {
        customer_id: sourceSpec.customer_id,
        customer_name_snapshot: sourceSpec.customer_name_snapshot || sourceSpec.customer_name,
        tube_size_id: sourceSpec.tube_size_id,
        mandrel_id: sourceSpec.mandrel_id,
        required_cs: sourceSpec.required_cs,
        target_tube_weight: sourceSpec.target_tube_weight,
        id_min_mm: sourceSpec.id_min_mm,
        id_max_mm: sourceSpec.id_max_mm,
        od_min_mm: sourceSpec.od_min_mm,
        od_max_mm: sourceSpec.od_max_mm,
        length_min_mm: sourceSpec.length_min_mm,
        length_max_mm: sourceSpec.length_max_mm,
        weight_min_g: sourceSpec.weight_min_g,
        weight_max_g: sourceSpec.weight_max_g,
        cs_min_n: sourceSpec.cs_min_n,
        cs_max_n: sourceSpec.cs_max_n,
        moisture_min_pct: sourceSpec.moisture_min_pct,
        moisture_max_pct: sourceSpec.moisture_max_pct,
        parchment_percent: sourceSpec.parchment_percent,
        parchment_color: sourceSpec.parchment_color,
        adhesive_20100_percent: sourceSpec.adhesive_20100_percent,
        adhesive_30100_percent: sourceSpec.adhesive_30100_percent,
        shrink_percent: sourceSpec.shrink_percent,
        variant_template_key: sourceSpec.variant_template_key,
        profile: sourceSpec.profile,
        dynamic_fields: sourceSpec.dynamic_fields?.map((field: any) => ({
          field_key: field.field_key,
          value: field.value,
        })),
      }

      const specResponse = await specApi.createSpec(specPayload, plantId)
      const spec = specResponse.data as SpecRecord
      let recipe: RecipeSummary | null = null
      if (latestRecipeDetail) {
        const recipeResponse = await specApi.createRecipe(spec.id, {
          notes: latestRecipeDetail.notes || `Cloned from spec ${sourceSpec.id}`,
        }, plantId)
        recipe = recipeResponse.data as RecipeSummary

        for (const layer of latestRecipeDetail.layers || []) {
          await specApi.addRecipeLayer(recipe.id, {
            ply_no: layer.ply_no,
            paper_id: layer.paper_id,
            gsm_snapshot: layer.gsm_snapshot,
            bf_snapshot: layer.bf_snapshot,
            bulk_snapshot: layer.bulk_snapshot,
          }, plantId)
        }
      }

      return { spec, recipe }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["specs"] })
      queryClient.invalidateQueries({ queryKey: ["spec-sheet-document", result.spec.id] })
    },
  })
}

export function useSpecSheetBalance(
  recipeId: string,
  tubeLengthMm?: number,
  tubeOdMm?: number,
  weightBand?: { min?: number; max?: number },
) {
  return useQuery({
    queryKey: ["spec-sheet-balance", recipeId, tubeLengthMm || 0, tubeOdMm || 0, weightBand?.min || 0, weightBand?.max || 0],
    queryFn: async () => {
      const { data } = await specApi.calculateBom(recipeId, Number(tubeLengthMm), Number(tubeOdMm))
      const bridge = data?.weight_bridge || {}
      const perTubeWeightG = bridge?.predicted_dry_tube_g != null
        ? Number(bridge.predicted_dry_tube_g || 0)
        : bridge?.predicted_per_tube_weight_g != null
          ? Number(bridge.predicted_per_tube_weight_g || 0)
          : Number(data?.expected_output?.per_tube_weight_kg || 0) * 1000
      let status = "unknown"

      if (weightBand) {
        if (perTubeWeightG < Number(weightBand.min || 0)) {
          status = "Unbalanced - Underweight"
        } else if (perTubeWeightG > Number(weightBand.max || 0)) {
          status = "Unbalanced - Overweight"
        } else {
          status = "Balanced (Predicted)"
        }
      }

      return {
        bom: data,
        perTubeWeightG,
        status,
        withinBand:
          weightBand != null
            ? perTubeWeightG >= Number(weightBand.min || 0) && perTubeWeightG <= Number(weightBand.max || 0)
            : false,
      }
    },
    enabled: !!recipeId && !!tubeLengthMm && !!tubeOdMm,
  })
}

export function useSpecSheetPreview(
  payload: {
    tubeLengthMm?: number
    tubeOdMm?: number
    tubeIdMm?: number
    targetDryWeightG?: number
    dryingPercent?: number
    parchmentPercent?: number
    parchmentAllowed?: boolean
    adhesivePercent?: number
    recipeRows?: any[]
    adhesiveComponents?: any[]
  },
) {
  const {
    tubeLengthMm,
    tubeOdMm,
    tubeIdMm,
    targetDryWeightG,
    dryingPercent,
    parchmentPercent,
    parchmentAllowed,
    adhesivePercent,
    recipeRows,
    adhesiveComponents,
  } = payload || {}

  return useQuery({
    queryKey: [
      "spec-sheet-preview",
      Number(tubeLengthMm || 0),
      Number(tubeOdMm || 0),
      Number(tubeIdMm || 0),
      Number(targetDryWeightG || 0),
      Number(dryingPercent || 0),
      Number(parchmentPercent || 0),
      Boolean(parchmentAllowed),
      Number(adhesivePercent || 0),
      JSON.stringify(recipeRows || []),
      JSON.stringify(adhesiveComponents || []),
    ],
    queryFn: async () => {
      const normalizedRecipeRows = (recipeRows || []).map((row: any) => ({
        paper_id: row?.paper_id || row?.paperId || "",
        code: row?.code || "",
        variety: row?.variety || "",
        category: row?.category || "",
        gsm: Number(row?.gsm || 0),
        bf_per_ply: Number(row?.bf_per_ply ?? row?.bfPerPly ?? row?.bf ?? 0),
        thickness_per_ply: Number(row?.thickness_per_ply ?? row?.thicknessPerPly ?? row?.thickness_mm ?? 0),
        ply_bond: Number(row?.ply_bond ?? row?.plyBond ?? 0),
        ply_count: Math.max(1, Number(row?.ply_count ?? row?.plyCount ?? 1)),
        positions_text: row?.positions_text ?? row?.positionsText ?? "",
      }))
      let data: any = null
      try {
        const response = await specApi.calculatePreview({
          tube_length_mm: Number(tubeLengthMm || 0),
          tube_od_mm: Number(tubeOdMm || 0),
          tube_id_mm: Number(tubeIdMm || 0),
          target_dry_weight_g: Number(targetDryWeightG || 0),
          drying_percent: Number(dryingPercent || 0),
          parchment_percent: Number(parchmentPercent || 0),
          parchment_allowed: Boolean(parchmentAllowed ?? true),
          adhesive_percent: Number(adhesivePercent || DEFAULT_GLUE_BASE_PERCENT),
          recipe_rows: normalizedRecipeRows,
          adhesive_components: adhesiveComponents || [],
        })
        data = response?.data
      } catch (error: any) {
        data = {
          degraded: true,
          degraded_reason: error?.response?.data?.detail || error?.message || "Spec preview service unavailable.",
          summary: buildPreviewSummaryFallback({
            tubeLengthMm: Number(tubeLengthMm || 0),
            tubeOdMm: Number(tubeOdMm || 0),
            tubeIdMm: Number(tubeIdMm || 0),
            targetDryWeightG: Number(targetDryWeightG || 0),
            dryingPercent: Number(dryingPercent || DEFAULT_DRYING_PERCENT),
            parchmentPercent: Number(parchmentPercent || DEFAULT_PARCHMENT_PERCENT),
            parchmentAllowed: Boolean(parchmentAllowed ?? true),
            adhesivePercent: Number(adhesivePercent || DEFAULT_GLUE_BASE_PERCENT),
            recipeRows: normalizedRecipeRows,
            adhesiveComponents: adhesiveComponents || [],
          }),
          validation: {},
        }
      }
      return {
        summary: data?.summary || {},
        validation: data?.validation || {},
        degraded: Boolean(data?.degraded),
        degraded_reason: data?.degraded_reason || data?.detail || "",
      }
    },
    enabled:
      Number(tubeLengthMm || 0) > 0 &&
      Number(tubeOdMm || 0) > 0 &&
      Number(tubeIdMm || 0) > 0 &&
      Number(targetDryWeightG || 0) > 0,
    placeholderData: (previousData) => previousData,
  })
}
