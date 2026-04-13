"use client"

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react"
import { Check, Factory, Layers, Package, Search, ScrollText, Sparkles, X } from "lucide-react"

import { NotchDiagramPanel } from "@/components/specs/NotchDiagramPanel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useAdhesives,
  useCustomers,
  useMandrels,
  usePackagingBoxes,
  usePackagingFadda,
  usePackagingPlasticSheets,
  usePapers,
  useParchments,
  useTubeSizes,
} from "@/hooks/use-master-data"
import { cn } from "@/lib/utils"
import {
  BAMBOO_CUT_LOSS_MM,
  BAMBOO_INCREMENT_MM,
  BAMBOO_MAX_LENGTH_MM,
  BAMBOO_MIN_LENGTH_MM,
  DEFAULT_ADHESIVE_PERCENT,
  DEFAULT_DRYING_LOSS_PERCENT,
  DEFAULT_PARCHMENT_PERCENT,
  buildBestMixSuggestions,
  buildRecipeLayers,
  buildSpecPayload,
  computePreviewMetrics,
  createDefaultAdhesiveRows,
  createEmptyState,
  createLocalId,
  normalizePaper,
  parseSpecState,
  resolveSpecTitle,
  type SpecEditorAdhesiveRow,
  type SpecEditorRecipeRow,
  type SpecEditorState,
} from "./spec-sheet-utils"

export type SpecSheetSubmission = {
  specPayload: Record<string, any>
  recipeLayers: Array<Record<string, any>>
}

type SpecSheetDocumentProps = {
  initialSpec?: any
  initialRecipe?: any
  readOnly?: boolean
  onSave?: (submission: SpecSheetSubmission) => Promise<void> | void
  isSaving?: boolean
}

function FieldBlock({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

function PaperChip({
  selected,
  label,
  onClick,
  disabled,
}: {
  selected: boolean
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-2 text-xs font-medium transition",
        selected
          ? "border-cyan-200 bg-cyan-50 text-cyan-900"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
        disabled ? "cursor-default hover:border-slate-200 hover:text-slate-600" : "",
      )}
    >
      {label}
    </button>
  )
}

function packagingBoxLabel(box: any) {
  if (!box) return "Box"
  const code = String(box.code || "").trim()
  const sizeLabel = String(box.size_label || "").trim()
  const dimensions =
    Number(box.length_mm || 0) > 0 && Number(box.width_mm || 0) > 0 && Number(box.height_mm || 0) > 0
      ? `${box.length_mm}x${box.width_mm}x${box.height_mm}`
      : ""
  return [code, sizeLabel, dimensions].filter(Boolean).join(" · ")
}

function plasticSheetLabel(plasticSheet: any) {
  if (!plasticSheet) return "Plastic sheet"
  return [plasticSheet.sku, plasticSheet.size_label].filter(Boolean).join(" · ")
}

function faddaLabel(fadda: any) {
  if (!fadda) return "Fadda"
  return [fadda.sku, Number(fadda.weight_kg || 0) > 0 ? `${fadda.weight_kg} kg` : ""].filter(Boolean).join(" · ")
}

function PreviewRail({
  state,
  preview,
  selectedCustomer,
  selectedTubeSize,
  selectedMandrel,
  selectedBox,
  selectedPlasticSheet,
  selectedFadda,
}: {
  state: SpecEditorState
  preview: ReturnType<typeof computePreviewMetrics>
  selectedCustomer: any
  selectedTubeSize: any
  selectedMandrel: any
  selectedBox: any
  selectedPlasticSheet: any
  selectedFadda: any
}) {
  return (
    <aside className="space-y-4 xl:sticky xl:top-24">
      <div className="erp-panel overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#0f172a,#164e63_55%,#0f766e)] px-5 py-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/70">Sticky Preview Rail</p>
          <h3 className="mt-2 text-xl font-semibold">{state.customerName || "Specification draft"}</h3>
          <p className="mt-2 max-w-[26ch] text-sm text-white/75">
            Commercial summary, recipe truth, and job-card handoff stay visible while editing.
          </p>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-3 text-sm text-slate-700">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Commercial</p>
              <p className="mt-2 font-medium text-slate-900">{selectedCustomer?.name || state.customerName || "-"}</p>
              <p className="mt-1 text-xs text-slate-500">{selectedCustomer?.customer_code || "Customer snapshot"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Client Matrix</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>ID {state.clientIdMm || "-"}</div>
                <div>OD {state.clientOdMm || "-"}</div>
                <div>Len {state.tubeLengthMm || "-"}</div>
                <div>CS {state.requiredCs || "-"}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Manufacturing</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>Mandrel {selectedMandrel?.mandrel_code || "-"}</div>
                <div>Wall {preview.wall_thickness_mm} mm</div>
                <div>OD {preview.manufacturing_od_mm} mm</div>
                <div>Wet {preview.wet_weight_g} g</div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Bamboo Plan</p>
              {preview.bamboo_plan ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>Length {preview.bamboo_plan.selected_bamboo_length_mm} mm</div>
                  <div>Usable {preview.bamboo_plan.usable_length_mm} mm</div>
                  <div>PCS/Bamboo {preview.bamboo_plan.tubes_per_bamboo}</div>
                  <div>Trim {preview.bamboo_plan.trim_waste_mm} mm</div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Tube length drives the manufacturing bamboo plan.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="erp-panel px-5 py-5">
        <div className="flex items-center gap-2 text-slate-900">
          <ScrollText className="h-4 w-4 text-cyan-700" />
          <h4 className="font-semibold">Recipe Snapshot</h4>
        </div>
        <div className="mt-4 space-y-3">
          {state.recipeRows.length > 0 ? (
            state.recipeRows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-900">{row.code || `${row.gsm} GSM`}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                    x{row.ply_count}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {row.variety || "Kraft paper"} · BF {row.bf_per_ply} · {row.thickness_per_ply} mm/ply
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Apply a best-mix suggestion or add manual recipe rows.</p>
          )}
        </div>
      </div>

      <div className="erp-panel px-5 py-5">
        <div className="flex items-center gap-2 text-slate-900">
          <Package className="h-4 w-4 text-cyan-700" />
          <h4 className="font-semibold">Packing Handoff</h4>
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate-600">
          <p>Box: <span className="font-medium text-slate-900">{packagingBoxLabel(selectedBox) || state.packing.box_code || "-"}</span></p>
          <p>Plastic: <span className="font-medium text-slate-900">{plasticSheetLabel(selectedPlasticSheet) || state.packing.plastic_sku || "-"}</span></p>
          <p>Fadda: <span className="font-medium text-slate-900">{faddaLabel(selectedFadda) || state.packing.fadda_sku || "-"}</span></p>
          <p>Qty/Box: <span className="font-medium text-slate-900">{state.packing.qty_per_box || "-"}</span></p>
          <p>Bundle: <span className="font-medium text-slate-900">{state.packing.bundle_type || "-"}</span></p>
        </div>
      </div>
    </aside>
  )
}

export function SpecSheetDocument({
  initialSpec,
  initialRecipe,
  readOnly,
  onSave,
  isSaving,
}: SpecSheetDocumentProps) {
  const { data: customers = [] } = useCustomers()
  const { data: tubeSizes = [] } = useTubeSizes()
  const { data: mandrels = [] } = useMandrels()
  const { data: papers = [] } = usePapers()
  const { data: adhesives = [] } = useAdhesives()
  const { data: parchments = [] } = useParchments()
  const { data: packagingBoxes = [] } = usePackagingBoxes()
  const { data: packagingPlasticSheets = [] } = usePackagingPlasticSheets()
  const { data: packagingFadda = [] } = usePackagingFadda()

  const normalizedPapers = useMemo(
    () => (Array.isArray(papers) ? papers : []).map(normalizePaper).sort((left, right) => left.gsm - right.gsm),
    [papers],
  )

  const paperById = useMemo(
    () =>
      Object.fromEntries(normalizedPapers.map((paper) => [paper.id, paper])) as Record<string, ReturnType<typeof normalizePaper>>,
    [normalizedPapers],
  )

  const normalizedAdhesives = useMemo(() => (Array.isArray(adhesives) ? adhesives : []), [adhesives])

  const [state, setState] = useState<SpecEditorState>(() => createEmptyState(normalizedAdhesives))
  const [paperSearch, setPaperSearch] = useState("")
  const deferredPaperSearch = useDeferredValue(paperSearch)

  useEffect(() => {
    if (initialSpec) {
      setState(parseSpecState(initialSpec, initialRecipe, normalizedAdhesives))
      return
    }
    setState((current) => {
      if (current.customerName || current.recipeRows.length > 0) return current
      return createEmptyState(normalizedAdhesives)
    })
  }, [initialSpec, initialRecipe, normalizedAdhesives])

  const selectedCustomer = useMemo(
    () => (Array.isArray(customers) ? customers : []).find((customer: any) => String(customer.id) === state.customerId),
    [customers, state.customerId],
  )
  const selectedTubeSize = useMemo(
    () => (Array.isArray(tubeSizes) ? tubeSizes : []).find((size: any) => String(size.id) === state.tubeSizeId),
    [tubeSizes, state.tubeSizeId],
  )
  const selectedMandrel = useMemo(
    () => (Array.isArray(mandrels) ? mandrels : []).find((mandrel: any) => String(mandrel.id) === state.mandrelId),
    [mandrels, state.mandrelId],
  )
  const selectedBox = useMemo(
    () =>
      (Array.isArray(packagingBoxes) ? packagingBoxes : []).find(
        (box: any) => String(box.code || box.id || "") === String(state.packing.box_code || ""),
      ) || null,
    [packagingBoxes, state.packing.box_code],
  )
  const selectedPlasticSheet = useMemo(
    () =>
      (Array.isArray(packagingPlasticSheets) ? packagingPlasticSheets : []).find(
        (plasticSheet: any) => String(plasticSheet.sku || plasticSheet.id || "") === String(state.packing.plastic_sku || ""),
      ) || null,
    [packagingPlasticSheets, state.packing.plastic_sku],
  )
  const selectedFadda = useMemo(
    () =>
      (Array.isArray(packagingFadda) ? packagingFadda : []).find(
        (fadda: any) => String(fadda.sku || fadda.id || "") === String(state.packing.fadda_sku || ""),
      ) || null,
    [packagingFadda, state.packing.fadda_sku],
  )

  const selectedCandidates = useMemo(
    () => normalizedPapers.filter((paper) => state.candidatePaperIds.includes(paper.id)),
    [normalizedPapers, state.candidatePaperIds],
  )

  const filteredPapers = useMemo(() => {
    const needle = deferredPaperSearch.trim().toLowerCase()
    if (!needle) return normalizedPapers
    return normalizedPapers.filter((paper) => {
      const haystack = `${paper.code} ${paper.variety} ${paper.category} ${paper.gsm} ${paper.bf}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [deferredPaperSearch, normalizedPapers])

  const preview = useMemo(() => computePreviewMetrics(state, selectedMandrel || null), [selectedMandrel, state])

  const suggestions = useMemo(
    () =>
      buildBestMixSuggestions(selectedCandidates, {
        tubeLengthMm: state.tubeLengthMm,
        tubeOdMm: state.clientOdMm,
        tubeIdMm: state.clientIdMm,
        targetWeightG: state.targetTubeWeight,
      }),
    [selectedCandidates, state.clientIdMm, state.clientOdMm, state.targetTubeWeight, state.tubeLengthMm],
  )

  const adhesiveRatioTotal = useMemo(
    () =>
      state.adhesives.reduce((total, row) => total + Number(row.ratio_percent || 0), 0),
    [state.adhesives],
  )

  const setField = <K extends keyof SpecEditorState>(key: K, value: SpecEditorState[K]) => {
    setState((current) => ({ ...current, [key]: value }))
  }

  const updateRecipeRow = (rowId: string, patch: Partial<SpecEditorRecipeRow>) => {
    setState((current) => ({
      ...current,
      recipeRows: current.recipeRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }))
  }

  const updateAdhesive = (rowId: string, patch: Partial<SpecEditorAdhesiveRow>) => {
    setState((current) => ({
      ...current,
      adhesives: current.adhesives.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }))
  }

  const toggleCandidatePaper = (paperId: string) => {
    if (readOnly) return
    setState((current) => {
      const exists = current.candidatePaperIds.includes(paperId)
      return {
        ...current,
        candidatePaperIds: exists
          ? current.candidatePaperIds.filter((id) => id !== paperId)
          : [...current.candidatePaperIds, paperId],
      }
    })
  }

  const addManualRecipeRow = () => {
    const firstPaper = selectedCandidates[0] || normalizedPapers[0]
    const paper = firstPaper ? normalizePaper(firstPaper) : null
    setState((current) => ({
      ...current,
      recipeRows: [
        ...current.recipeRows,
        {
          id: createLocalId("recipe"),
          paper_id: paper?.id || "",
          code: paper?.code || "",
          variety: paper?.variety || "",
          category: paper?.category || "",
          gsm: Number(paper?.gsm || 0),
          bf_per_ply: Number(paper?.bf || 0),
          thickness_per_ply: Number(paper?.thickness_mm || 0),
          ply_bond: Number(paper?.ply_bond || 0),
          ply_count: 1,
          positions_text: `Layer ${current.recipeRows.length + 1}`,
        },
      ],
    }))
  }

  const applySuggestion = (rows: SpecEditorRecipeRow[]) => {
    startTransition(() => {
      setState((current) => ({
        ...current,
        recipeRows: rows.map((row, index) => ({
          ...row,
          id: createLocalId("recipe"),
          positions_text: row.positions_text || `Layer ${index + 1}`,
        })),
      }))
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!onSave || readOnly) return

    const specPayload = buildSpecPayload(state, selectedCandidates, preview)
    const recipeLayers = buildRecipeLayers(state)
    await onSave({ specPayload, recipeLayers })
  }

  const paperSearchPlaceholder = readOnly ? "Selected paper pool" : "Search paper masters..."

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_332px]">
      <div className="space-y-5">
        <section className="erp-panel animate-enter-up overflow-hidden rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(186,230,253,0.32),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,252,0.96))] px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Spec Sheet Workspace</p>
              <h2 className="mt-2 text-[2rem] font-semibold tracking-tight text-slate-950">{resolveSpecTitle(initialSpec)}</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Master-led specification flow with paper-pool selection, recipe suggestion, adhesive split, and manufacturing preview in one surface.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-cyan-100 bg-cyan-50/90 px-4 py-3 text-right text-sm text-cyan-900 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">Global Rules</p>
              <p className="mt-2">Adhesive {DEFAULT_ADHESIVE_PERCENT}%</p>
              <p>Parchment {DEFAULT_PARCHMENT_PERCENT}%</p>
              <p>Drying loss {state.shrinkPercent}%</p>
            </div>
          </div>
        </section>

        <section className="erp-panel rounded-[2rem] border border-white/70 px-5 py-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Factory className="h-4 w-4 text-cyan-700" />
            <h3 className="text-lg font-semibold">Commercial and size basis</h3>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FieldBlock label="Customer">
              <select
                value={state.customerId}
                onChange={(event) => {
                  const nextCustomer = (customers as any[]).find((customer) => String(customer.id) === event.target.value)
                  setState((current) => ({
                    ...current,
                    customerId: event.target.value,
                    customerName: nextCustomer?.name || current.customerName,
                  }))
                }}
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="">Select customer</option>
                {(customers as any[]).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Customer Snapshot">
              <Input
                value={state.customerName}
                onChange={(event) => setField("customerName", event.target.value)}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Tube Size">
              <select
                value={state.tubeSizeId}
                onChange={(event) => {
                  const nextSize = (tubeSizes as any[]).find((size) => String(size.id) === event.target.value)
                  setState((current) => ({
                    ...current,
                    tubeSizeId: event.target.value,
                    clientIdMm: Number(nextSize?.inner_diameter_mm || current.clientIdMm),
                    clientOdMm: Number(nextSize?.outer_diameter_mm || current.clientOdMm),
                    tubeLengthMm: Number(nextSize?.length_mm || current.tubeLengthMm),
                  }))
                }}
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="">Select tube size</option>
                {(tubeSizes as any[]).map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.inner_diameter_mm} x {size.outer_diameter_mm} x {size.length_mm}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Mandrel">
              <select
                value={state.mandrelId}
                onChange={(event) => setField("mandrelId", event.target.value)}
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="">Select mandrel</option>
                {(mandrels as any[]).map((mandrel) => (
                  <option key={mandrel.id} value={mandrel.id}>
                    {mandrel.mandrel_code}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Client ID (mm)">
              <Input
                type="number"
                value={state.clientIdMm}
                onChange={(event) => setField("clientIdMm", Number(event.target.value || 0))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Client OD (mm)">
              <Input
                type="number"
                value={state.clientOdMm}
                onChange={(event) => setField("clientOdMm", Number(event.target.value || 0))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Tube Length (mm)">
              <Input
                type="number"
                value={state.tubeLengthMm}
                onChange={(event) => setField("tubeLengthMm", Number(event.target.value || 0))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Required CS">
              <Input
                type="number"
                value={state.requiredCs}
                onChange={(event) => setField("requiredCs", Number(event.target.value || 0))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Dry Tube Weight (g)">
              <Input
                type="number"
                value={state.targetTubeWeight}
                onChange={(event) => setField("targetTubeWeight", Number(event.target.value || 0))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Parchment Color">
              <select
                value={state.parchmentColor}
                onChange={(event) => setField("parchmentColor", event.target.value)}
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="">Without parchment</option>
                {(parchments as any[]).map((parchment) => (
                  <option key={parchment.id} value={`${parchment.vendor_name} · ${parchment.color_name}`}>
                    {parchment.vendor_name} · {parchment.color_name}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Drying Loss (%)">
              <Input
                type="number"
                step="0.1"
                value={state.shrinkPercent}
                onChange={(event) => setField("shrinkPercent", Number(event.target.value || DEFAULT_DRYING_LOSS_PERCENT))}
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
          </div>
        </section>

        <section className="erp-panel rounded-[2rem] border border-white/70 px-5 py-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Sparkles className="h-4 w-4 text-cyan-700" />
            <h3 className="text-lg font-semibold">Manufacturing math and preview</h3>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Live theory values stay attached to the spec so the same sheet drives manufacturing, bamboo planning, and packing handoff.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Paper</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{preview.paper_weight_g} g</p>
              <p className="mt-1 text-xs text-slate-500">Recipe stack theory</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Adhesive</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{preview.adhesive_weight_g} g</p>
              <p className="mt-1 text-xs text-slate-500">Fixed {DEFAULT_ADHESIVE_PERCENT}% base</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Parchment</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{preview.parchment_weight_g} g</p>
              <p className="mt-1 text-xs text-slate-500">{state.parchmentColor || "Without parchment"}</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Wet Weight</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{preview.wet_weight_g} g</p>
              <p className="mt-1 text-xs text-slate-500">After drying-loss reverse math</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Wall</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{preview.wall_thickness_mm} mm</p>
              <p className="mt-1 text-xs text-slate-500">Ply thickness sum</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Bamboo</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">
                {preview.bamboo_plan?.selected_bamboo_length_mm || "-"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {preview.bamboo_plan
                  ? `${preview.bamboo_plan.tubes_per_bamboo} tubes · ${preview.bamboo_plan.trim_waste_mm} mm trim`
                  : "Length not set"}
              </p>
            </div>
          </div>
        </section>

        <section className="erp-panel rounded-[2rem] border border-white/70 px-5 py-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Layers className="h-4 w-4 text-cyan-700" />
            <h3 className="text-lg font-semibold">Candidate paper pool and best-mix</h3>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Select candidate masters first. The sheet applies a best-mix into the saved recipe rows instead of starting from free-typed plies.
          </p>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={paperSearch}
                  onChange={(event) => setPaperSearch(event.target.value)}
                  placeholder={paperSearchPlaceholder}
                  disabled={readOnly}
                  className="h-11 rounded-2xl border-slate-200 bg-white pl-10"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {filteredPapers.slice(0, 20).map((paper) => (
                  <PaperChip
                    key={paper.id}
                    selected={state.candidatePaperIds.includes(paper.id)}
                    label={`${paper.gsm}gsm · ${paper.bf}${paper.strength_type}`}
                    onClick={() => toggleCandidatePaper(paper.id)}
                    disabled={readOnly}
                  />
                ))}
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Selected Pool</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCandidates.length > 0 ? (
                    selectedCandidates.map((paper) => (
                      <PaperChip
                        key={paper.id}
                        selected
                        label={`${paper.code} · ${paper.gsm}gsm`}
                        onClick={() => toggleCandidatePaper(paper.id)}
                        disabled={readOnly}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No candidate papers selected yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ecfeff,#f8fafc_55%,#ffffff)] p-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <Sparkles className="h-4 w-4 text-cyan-700" />
                  <p className="font-semibold">Best-mix suggestions</p>
                </div>
                <div className="mt-4 space-y-3">
                  {suggestions.length > 0 ? (
                    suggestions.map((suggestion) => (
                      <div key={suggestion.id} className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-slate-900">{suggestion.label}</p>
                            <p className="mt-1 text-xs text-slate-500">{suggestion.rationale}</p>
                          </div>
                          {!readOnly ? (
                            <Button type="button" size="sm" onClick={() => applySuggestion(suggestion.rows)}>
                              Apply
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {suggestion.rows.map((row) => (
                            <span
                              key={row.id}
                              className="rounded-full border border-cyan-100 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-900"
                            >
                              {row.code || `${row.gsm}gsm`} x{row.ply_count}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                          <div>Paper {suggestion.predicted_paper_weight_g} g</div>
                          <div>Dry {suggestion.predicted_dry_weight_g} g</div>
                          <div>Delta {suggestion.delta_dry_g} g</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      Add papers including 250gsm, 300gsm, and a 350gsm+ option to unlock suggestions.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-white/80 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Saved Recipe Rows</p>
                <p className="mt-1 text-sm text-slate-600">Persisted into the spec snapshot and the trial recipe version.</p>
              </div>
              {!readOnly ? (
                <Button type="button" variant="outline" onClick={addManualRecipeRow}>
                  Add row
                </Button>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    <th className="pb-3 pr-4">Paper</th>
                    <th className="pb-3 pr-4">Ply Count</th>
                    <th className="pb-3 pr-4">BF/Ply</th>
                    <th className="pb-3 pr-4">Thickness</th>
                    <th className="pb-3 pr-4">Positions</th>
                    {!readOnly ? <th className="pb-3">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {state.recipeRows.length > 0 ? (
                    state.recipeRows.map((row) => {
                      const selectedPaper = paperById[row.paper_id]
                      return (
                        <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="py-3 pr-4">
                            <select
                              value={row.paper_id}
                              onChange={(event) => {
                                const paper = paperById[event.target.value]
                                updateRecipeRow(row.id, {
                                  paper_id: event.target.value,
                                  code: paper?.code || "",
                                  variety: paper?.variety || "",
                                  category: paper?.category || "",
                                  gsm: Number(paper?.gsm || 0),
                                  bf_per_ply: Number(paper?.bf || 0),
                                  thickness_per_ply: Number(paper?.thickness_mm || 0),
                                  ply_bond: Number(paper?.ply_bond || 0),
                                })
                              }}
                              disabled={readOnly}
                              className="h-10 min-w-[220px] rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                            >
                              <option value="">Select paper</option>
                              {normalizedPapers.map((paper) => (
                                <option key={paper.id} value={paper.id}>
                                  {paper.code} · {paper.gsm}gsm
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-slate-500">
                              {selectedPaper?.variety || row.variety || "Paper master"}
                            </p>
                          </td>
                          <td className="py-3 pr-4">
                            <Input
                              type="number"
                              value={row.ply_count}
                              onChange={(event) => updateRecipeRow(row.id, { ply_count: Number(event.target.value || 0) })}
                              disabled={readOnly}
                              className="h-10 w-24 rounded-2xl border-slate-200 bg-white"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <Input
                              type="number"
                              value={row.bf_per_ply}
                              onChange={(event) => updateRecipeRow(row.id, { bf_per_ply: Number(event.target.value || 0) })}
                              disabled={readOnly}
                              className="h-10 w-28 rounded-2xl border-slate-200 bg-white"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <Input
                              type="number"
                              step="0.001"
                              value={row.thickness_per_ply}
                              onChange={(event) => updateRecipeRow(row.id, { thickness_per_ply: Number(event.target.value || 0) })}
                              disabled={readOnly}
                              className="h-10 w-28 rounded-2xl border-slate-200 bg-white"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <Input
                              value={row.positions_text}
                              onChange={(event) => updateRecipeRow(row.id, { positions_text: event.target.value })}
                              disabled={readOnly}
                              className="h-10 min-w-[180px] rounded-2xl border-slate-200 bg-white"
                            />
                          </td>
                          {!readOnly ? (
                            <td className="py-3">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setState((current) => ({
                                    ...current,
                                    recipeRows: current.recipeRows.filter((candidate) => candidate.id !== row.id),
                                  }))
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={readOnly ? 5 : 6} className="py-8 text-center text-slate-500">
                        No recipe rows saved yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="erp-panel px-5 py-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Sparkles className="h-4 w-4 text-cyan-700" />
            <h3 className="text-lg font-semibold">Adhesive split and parchment</h3>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              {state.adhesives.map((row) => (
                <div key={row.id} className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 md:grid-cols-[minmax(0,1fr)_120px]">
                  <div>
                    <FieldBlock label="Adhesive Master">
                      <select
                        value={row.adhesive_id}
                        onChange={(event) => {
                          const selected = normalizedAdhesives.find((adhesive: any) => String(adhesive.id) === event.target.value)
                          updateAdhesive(row.id, {
                            adhesive_id: event.target.value,
                            label: selected?.name || selected?.internal_code || row.label,
                          })
                        }}
                        disabled={readOnly}
                        className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                      >
                        <option value="">Select adhesive</option>
                        {normalizedAdhesives.map((adhesive: any) => (
                          <option key={adhesive.id} value={adhesive.id}>
                            {adhesive.name} · {adhesive.internal_code}
                          </option>
                        ))}
                      </select>
                    </FieldBlock>
                  </div>
                  <div>
                    <FieldBlock label="Ratio %">
                      <Input
                        type="number"
                        value={row.ratio_percent}
                        onChange={(event) => updateAdhesive(row.id, { ratio_percent: Number(event.target.value || 0) })}
                        disabled={readOnly}
                        className="h-10 rounded-2xl border-slate-200 bg-white"
                      />
                    </FieldBlock>
                  </div>
                </div>
              ))}
              {!readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      adhesives: [
                        ...current.adhesives,
                        {
                          id: createLocalId("adh"),
                          adhesive_id: "",
                          label: "Adhesive",
                          ratio_percent: 0,
                          base_percent: DEFAULT_ADHESIVE_PERCENT,
                        },
                      ],
                    }))
                  }
                >
                  Add adhesive
                </Button>
              ) : null}
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Derived Materials</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-slate-500">Adhesive fixed base</p>
                  <p className="mt-1 font-medium text-slate-900">{DEFAULT_ADHESIVE_PERCENT}% of dry tube weight</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-slate-500">Ratio total</p>
                  <p className={cn("mt-1 font-medium", adhesiveRatioTotal === 100 ? "text-emerald-700" : "text-amber-700")}>
                    {adhesiveRatioTotal}%{adhesiveRatioTotal === 100 ? " aligned" : " needs 100%"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-slate-500">Parchment fixed base</p>
                  <p className="mt-1 font-medium text-slate-900">{DEFAULT_PARCHMENT_PERCENT}% of dry tube weight</p>
                  <p className="mt-1 text-xs text-slate-500">{state.parchmentColor || "Without parchment"}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <NotchDiagramPanel
          value={state.notch}
          readOnly={readOnly}
          onChange={(patch) => setState((current) => ({ ...current, notch: { ...current.notch, ...patch } }))}
        />

        <section className="erp-panel px-5 py-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Package className="h-4 w-4 text-cyan-700" />
            <h3 className="text-lg font-semibold">Packing and dispatch cues</h3>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FieldBlock label="Box Master">
              <select
                value={state.packing.box_code || "__NONE__"}
                onChange={(event) => {
                  const nextCode = event.target.value === "__NONE__" ? "" : event.target.value
                  const nextBox = (packagingBoxes as any[]).find(
                    (box: any) => String(box.code || box.id || "") === nextCode,
                  )
                  setState((current) => ({
                    ...current,
                    packing: {
                      ...current.packing,
                      box_code: nextCode,
                      box_size: nextBox?.size_label || "",
                    },
                  }))
                }}
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="__NONE__">Select box master</option>
                {(packagingBoxes as any[]).map((box: any) => (
                  <option key={String(box.id || box.code)} value={String(box.code || box.id || "")}>
                    {packagingBoxLabel(box)}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Box Snapshot">
              <Input
                value={selectedBox ? packagingBoxLabel(selectedBox) : state.packing.box_size}
                disabled
                className="h-11 rounded-2xl border-slate-200 bg-slate-50"
              />
            </FieldBlock>
            <FieldBlock label="Bundle Type">
              <select
                value={state.packing.bundle_type || "__NONE__"}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: {
                      ...current.packing,
                      bundle_type: event.target.value === "__NONE__" ? "" : event.target.value,
                    },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="__NONE__">Select bundle type</option>
                <option value="BOX">BOX</option>
                <option value="BUNDLE">BUNDLE</option>
                <option value="LOOSE">LOOSE</option>
              </select>
            </FieldBlock>
            <FieldBlock label="Bundle Code">
              <Input
                value={state.packing.bundle_code}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, bundle_code: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Packing Ply">
              <Input
                value={state.packing.packing_ply}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, packing_ply: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Qty per Box">
              <Input
                value={state.packing.qty_per_box}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, qty_per_box: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Packing PCS">
              <Input
                value={state.packing.packing_pcs}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, packing_pcs: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Master links</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>Box {state.packing.box_code || "-"}</p>
                <p>Plastic {state.packing.plastic_sku || "-"}</p>
                <p>Fadda {state.packing.fadda_sku || "-"}</p>
              </div>
            </div>
            <FieldBlock label="Plastic Master">
              <select
                value={state.packing.plastic_sku || "__NONE__"}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: {
                      ...current.packing,
                      plastic_sku: event.target.value === "__NONE__" ? "" : event.target.value,
                    },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="__NONE__">Select plastic master</option>
                {(packagingPlasticSheets as any[]).map((plasticSheet: any) => (
                  <option key={String(plasticSheet.id || plasticSheet.sku)} value={String(plasticSheet.sku || plasticSheet.id || "")}>
                    {plasticSheetLabel(plasticSheet)}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Plastic per Box">
              <Input
                value={state.packing.plastic_per_box}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, plastic_per_box: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
            <FieldBlock label="Fadda Master">
              <select
                value={state.packing.fadda_sku || "__NONE__"}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: {
                      ...current.packing,
                      fadda_sku: event.target.value === "__NONE__" ? "" : event.target.value,
                    },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              >
                <option value="__NONE__">Select fadda master</option>
                {(packagingFadda as any[]).map((fadda: any) => (
                  <option key={String(fadda.id || fadda.sku)} value={String(fadda.sku || fadda.id || "")}>
                    {faddaLabel(fadda)}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Fadda per Box">
              <Input
                value={state.packing.fadda_per_box}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, fadda_per_box: event.target.value },
                  }))
                }
                disabled={readOnly}
                className="h-11 rounded-2xl border-slate-200 bg-white"
              />
            </FieldBlock>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={state.packing.plastic_required}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, plastic_required: event.target.checked },
                  }))
                }
                disabled={readOnly}
              />
              Plastic required
            </label>
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={state.packing.bopp_required}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    packing: { ...current.packing, bopp_required: event.target.checked },
                  }))
                }
                disabled={readOnly}
              />
              BOPP required
            </label>
          </div>

          <FieldBlock label="Special Instructions">
            <textarea
              value={state.packing.special_instructions}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  packing: { ...current.packing, special_instructions: event.target.value },
                }))
              }
              disabled={readOnly}
              className="min-h-[110px] w-full rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
            />
          </FieldBlock>
        </section>

        {!readOnly && onSave ? (
          <section className="erp-panel px-5 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Commit Draft</p>
                <p className="mt-1 text-sm text-slate-600">
                  Saving writes the enriched snapshot into the spec service and creates a fresh trial recipe version.
                </p>
              </div>
              <Button type="submit" disabled={isSaving || adhesiveRatioTotal <= 0} className="min-w-[180px]">
                {isSaving ? "Saving..." : "Save Specification"}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <PreviewRail
        state={state}
        preview={preview}
        selectedCustomer={selectedCustomer}
        selectedTubeSize={selectedTubeSize}
        selectedMandrel={selectedMandrel}
        selectedBox={selectedBox}
        selectedPlasticSheet={selectedPlasticSheet}
        selectedFadda={selectedFadda}
      />
    </form>
  )
}
