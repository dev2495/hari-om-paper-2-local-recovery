"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { NotchDiagramPanel } from "@/components/specs/NotchDiagramPanel"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useAdhesives,
  useCustomers,
  useMandrels,
  usePackagingBoxes,
  usePackagingFadda,
  usePackagingPlasticSheets,
  usePapers,
  useParchments,
  useTools,
  useTubeSizes,
} from "@/hooks/use-master-data"
import {
  useApproveSpec,
  useCloneSpecSheet,
  useCreateSpecSheet,
  useEnsureSpecSheetCatalog,
  useObsoleteSpec,
  useSpecConstants,
  useSpecFields,
  useSpecSheetPreview,
  useSpecSheetSuggestions,
  useSpecSheetDocument,
  useUpdateSpecSheet,
  useRecordTrial,
} from "@/hooks/use-specs"
import {
  AdhesiveComponent,
  AverageValues,
  buildAdhesiveComponentsPayload,
  buildDynamicFieldsPayload,
  buildGroupedRowLabel,
  clamp,
  DEFAULT_MOISTURE_AVG,
  DEFAULT_PROCESS_GUIDANCE,
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  DEFAULT_TOLERANCE_BANDS,
  deriveRanges,
  DynamicFieldValue,
  encodePlyPositions,
  GroupedRecipeRow,
  midpoint,
  parseAdhesiveComponents,
  parseDynamicFields,
  parseJsonField,
  parsePlyPositions,
  ProcessGuidanceRow,
  RecipeSuggestion,
  roundValue,
  SpecProfile,
  stringifyJsonField,
  thicknessFrom,
} from "@/lib/spec-sheet"

type Mode = "create" | "edit" | "view" | "print"

type SpecSheetDocumentProps = {
  mode: Mode
  specId?: string
}

type TrialForm = {
  actualWeight: string
  actualCs: string
  actualShrink: string
  remarks: string
  approved: boolean
}

type DiagramState = {
  title: string
}

type StageTemplate = {
  lineNo: string
  operatorName: string
  cycleTimeMin: string
  startTime: string
  endTime: string
  inputTarget: string
  outputTarget: string
  scrapTarget: string
  qcChecks: string
  remarks: string
}

type PackingTemplate = {
  bundleType: string
  qtyPerBundle: string
  packingPcs: string
  plasticRequired: string
  boxSize: string
  remarks: string
}

type FormState = {
  customerId: string
  variantTemplateKey: string
  tubeSizeId: string
  mandrelId: string
  averages: AverageValues
  shrinkPercent: string
  parchmentPercent: string
  parchmentColor: string
  adhesive20100: string
  adhesive30100: string
  adhesiveComponents: AdhesiveComponent[]
  notes: string
  recipeRows: GroupedRecipeRow[]
  dynamicValues: Record<string, string>
  processGuidance: ProcessGuidanceRow[]
  selectedGuidanceIndex: number
  notchDiagram: DiagramState
  winderTarget: StageTemplate
  ovenTarget: StageTemplate
  processTarget: StageTemplate
  packingTarget: PackingTemplate
  trial: TrialForm
}

const CANONICAL_VARIANT_KEY = "canonical"
let recipeRowSeed = 0

function nextRecipeRowSeed() {
  recipeRowSeed += 1
  return recipeRowSeed
}

function blankRecipeRow(seed: number): GroupedRecipeRow {
  return {
    id: `row-${seed}`,
    paper_id: "",
    code: "",
    variety: "",
    category: "",
    gsm: 0,
    bfPerPly: 0,
    thicknessPerPly: 0,
    plyBond: 0,
    plyCount: 1,
    adhesiveLabel: "TL-4",
    positionsText: "",
  }
}

function defaultFormState(): FormState {
  const baseStageTemplate: StageTemplate = {
    lineNo: "",
    operatorName: "",
    cycleTimeMin: "",
    startTime: "",
    endTime: "",
    inputTarget: "",
    outputTarget: "",
    scrapTarget: "",
    qcChecks: "",
    remarks: "",
  }
  return {
    customerId: "",
    variantTemplateKey: CANONICAL_VARIANT_KEY,
    tubeSizeId: "",
    mandrelId: "",
    averages: {
      id: 0,
      od: 0,
      length: 0,
      weight: 0,
      cs: 0,
      moisture: DEFAULT_MOISTURE_AVG,
    },
    shrinkPercent: "9.5",
    parchmentPercent: "1.5",
    parchmentColor: "",
    adhesive20100: "30",
    adhesive30100: "80",
    adhesiveComponents: [
      { name: "TL-4 (20100)", base_percent: 12, ratio_percent: 30 },
      { name: "Vinsol (30100)", base_percent: 12, ratio_percent: 80 },
    ],
    notes: "",
    recipeRows: [blankRecipeRow(nextRecipeRowSeed())],
    dynamicValues: {
      glue_mode: "standard",
      glue_base_percent: "15",
      drying_percent_override: "",
      fill_instructions_version: CANONICAL_VARIANT_KEY,
      notch_required: "false",
      top_paper_required: "false",
      winder_tool_required: "false",
      plastic_required: "false",
      bopp_required: "false",
      tube_direction: "OPPOSITE OF THE NOTCH",
      notch_type: "NONE",
      tochha_type: "NONE",
      wider_tool: "",
    },
    processGuidance: DEFAULT_PROCESS_GUIDANCE,
    selectedGuidanceIndex: 1,
    notchDiagram: {
      title: "Reference sketch",
    },
    winderTarget: { ...baseStageTemplate, lineNo: "WINDER-01" },
    ovenTarget: { ...baseStageTemplate, lineNo: "OVEN-01" },
    processTarget: { ...baseStageTemplate, lineNo: "PROCESS-01" },
    packingTarget: {
      bundleType: "",
      qtyPerBundle: "",
      packingPcs: "",
      plasticRequired: "false",
      boxSize: "",
      remarks: "",
    },
    trial: {
      actualWeight: "",
      actualCs: "",
      actualShrink: "",
      remarks: "",
      approved: false,
    },
  }
}

const WIZARD_STEPS = [
  { key: "base", label: "Client + Spec Base", target: "sheet-client" },
  { key: "dimensions", label: "Dimensions + Tolerances", target: "sheet-client" },
  { key: "recipe", label: "Recipe + Glue", target: "sheet-recipe" },
  { key: "tooling", label: "Notch + Tooling", target: "sheet-notch-tooling" },
  { key: "guidance", label: "Process + Packing", target: "sheet-packing" },
  { key: "preview", label: "Validation + Print", target: "sheet-validation" },
] as const

type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"]

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-slate-300 pb-2">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-700">{title}</h2>
      {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  )
}

function MasterLinkRow({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-white"
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</label>
}

function boolFromString(value: string | undefined) {
  return String(value || "false").toLowerCase() === "true"
}

function yesNoValue(value: string | undefined) {
  return boolFromString(value) ? "Yes" : "No"
}

function optionValue(value: string | number | undefined | null) {
  if (value === undefined || value === null) return ""
  return String(value)
}

function safeNumber(value: any, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function inputNumberValue(value: number | null | undefined, allowZero = false) {
  const numeric = safeNumber(value, 0)
  if (!allowZero && numeric <= 0) return ""
  return String(numeric)
}

function parseMmValue(value: string | number | undefined | null) {
  const raw = value == null ? "" : String(value)
  const parsed = Number(raw.replace(/[^0-9.+-]/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function buildMatrixRows(averages: AverageValues, ranges: ReturnType<typeof deriveRanges>) {
  const maxAvg = {
    id: Number(ranges.id_max_mm),
    od: Number(ranges.od_max_mm),
    length: Number(ranges.length_max_mm),
    weight: Number(ranges.weight_max_g),
    cs: Number(ranges.cs_max_n),
    moisture: Number(ranges.moisture_max_pct),
  }
  const minAvg = {
    id: Number(ranges.id_min_mm),
    od: Number(ranges.od_min_mm),
    length: Number(ranges.length_min_mm),
    weight: Number(ranges.weight_min_g),
    cs: Number(ranges.cs_min_n),
    moisture: Number(ranges.moisture_min_pct),
  }

  return [
    {
      label: "AVG",
      id: averages.id,
      od: averages.od,
      thick: thicknessFrom(averages.id, averages.od),
      length: averages.length,
      weight: averages.weight,
      cs: averages.cs,
      moisture: averages.moisture,
    },
    {
      label: "MAX",
      id: maxAvg.id,
      od: maxAvg.od,
      thick: thicknessFrom(maxAvg.id, maxAvg.od),
      length: maxAvg.length,
      weight: maxAvg.weight,
      cs: maxAvg.cs,
      moisture: maxAvg.moisture,
    },
    {
      label: "MIN",
      id: minAvg.id,
      od: minAvg.od,
      thick: thicknessFrom(minAvg.id, minAvg.od),
      length: minAvg.length,
      weight: minAvg.weight,
      cs: minAvg.cs,
      moisture: minAvg.moisture,
    },
  ]
}

function SpecMatrixTable({
  title,
  rows,
  emphasizeWeight,
  rightPanel,
}: {
  title: string
  rows: Array<Record<string, number | string>>
  emphasizeWeight?: boolean
  rightPanel?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-white">
      <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="border-b border-slate-300 bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
            {title}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                  <th className="border-b border-r border-slate-300 px-3 py-2 text-left">Parameters</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">ID</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">OD</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">Thick</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">LT / L</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">WGHT / W</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">CS</th>
                  <th className="border-b border-slate-300 px-3 py-2">Moist</th>
                </tr>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <th className="border-b border-r border-slate-200 px-3 py-1 text-left">Units</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">MM</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">MM</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">MM</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">MM</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">GMS</th>
                  <th className="border-b border-r border-slate-200 px-3 py-1">KGF</th>
                  <th className="border-b border-slate-200 px-3 py-1">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.label)} className="text-center text-slate-700">
                    <td className="border-r border-t border-slate-200 px-3 py-2 text-left font-semibold">{row.label}</td>
                    <td className="border-r border-t border-slate-200 px-3 py-2">{Number(row.id).toFixed(2)}</td>
                    <td className="border-r border-t border-slate-200 px-3 py-2">{Number(row.od).toFixed(2)}</td>
                    <td className="border-r border-t border-slate-200 px-3 py-2">{Number(row.thick).toFixed(2)}</td>
                    <td className="border-r border-t border-slate-200 px-3 py-2">{Number(row.length).toFixed(2)}</td>
                    <td className={`border-r border-t border-slate-200 px-3 py-2 ${emphasizeWeight ? "bg-emerald-50 font-semibold" : ""}`}>
                      {Number(row.weight).toFixed(2)}
                    </td>
                    <td className="border-r border-t border-slate-200 px-3 py-2">{Number(row.cs).toFixed(2)}</td>
                    <td className="border-t border-slate-200 px-3 py-2">{Number(row.moisture).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {rightPanel ? <div className="border-t border-slate-300 bg-slate-50 p-3 lg:border-l lg:border-t-0">{rightPanel}</div> : null}
      </div>
    </div>
  )
}

export function SpecSheetDocument({ mode, specId }: SpecSheetDocumentProps) {
  const router = useRouter()
  const { showToast } = useApp()
  const { user, activePlant } = useAuth()
  const isCreate = mode === "create"
  const isEditable = mode === "create" || mode === "edit"
  const isPrint = mode === "print"

  const [form, setForm] = useState<FormState>(() => defaultFormState())
  const [activeStep, setActiveStep] = useState<WizardStepKey>("base")
  const [loadedSpecId, setLoadedSpecId] = useState<string | null>(null)
  const [catalogBootstrapped, setCatalogBootstrapped] = useState(false)
  const [todayLabel, setTodayLabel] = useState("--/--/----")

  const { data: customers } = useCustomers()
  const { data: tubeSizes } = useTubeSizes()
  const { data: mandrels } = useMandrels()
  const { data: papers } = usePapers()
  const { data: adhesives } = useAdhesives()
  const { data: parchments } = useParchments()
  const { data: packagingBoxes } = usePackagingBoxes()
  const { data: packagingPlasticSheets } = usePackagingPlasticSheets()
  const { data: packagingFadda } = usePackagingFadda()
  const { data: tools } = useTools()
  const { data: specConstants } = useSpecConstants()
  const { data: specFields } = useSpecFields()
  const { data: specDocument, isLoading: isLoadingDocument } = useSpecSheetDocument(specId || "")

  const ensureCatalog = useEnsureSpecSheetCatalog()
  const createSpecSheet = useCreateSpecSheet()
  const updateSpecSheet = useUpdateSpecSheet()
  const approveSpec = useApproveSpec()
  const obsoleteSpec = useObsoleteSpec()
  const cloneSpec = useCloneSpecSheet()
  const recordTrial = useRecordTrial()

  const customerMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((customers || []) as any[]).map((item) => [String(item.id), item])),
    [customers],
  )
  const tubeSizeMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((tubeSizes || []) as any[]).map((item) => [String(item.id), item])),
    [tubeSizes],
  )
  const mandrelMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((mandrels || []) as any[]).map((item) => [String(item.id), item])),
    [mandrels],
  )
  const paperMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((papers || []) as any[]).map((item) => [String(item.id), item])),
    [papers],
  )
  const packagingBoxMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((packagingBoxes || []) as any[]).map((item) => [String(item.code || ""), item])),
    [packagingBoxes],
  )
  const fieldCatalogMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((specFields || []) as any[]).map((item) => [String(item.key), item])),
    [specFields],
  )
  const toolOptionsByCategory = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of (tools || []) as any[]) {
      const category = String(row?.category || "").trim().toUpperCase()
      const name = String(row?.name || row?.spec_text || "").trim()
      if (!category || !name) continue
      const current = map.get(category) || []
      if (!current.includes(name)) {
        current.push(name)
        map.set(category, current)
      }
    }
    return map
  }, [tools])

  const toolFieldCategoryMap: Record<string, string[]> = {
    notching_holder: ["NOTCHING_HOLDER"],
    notching_blade: ["NOTCHING_BLADE"],
    groove: ["GROOVE", "GURU"],
    punch: ["PUNCH"],
    die: ["DIE"],
    wider_tool: ["WIDER_TOOL"],
    tochha: ["TOCHHA"],
  }
  const externalSelectOptionsByField = useMemo<Record<string, string[]>>(
    () => ({
      box_code: ((packagingBoxes || []) as any[])
        .map((row) => String(row?.code || "").trim())
        .filter(Boolean),
      plastic_sku: ((packagingPlasticSheets || []) as any[])
        .map((row) => String(row?.sku || "").trim())
        .filter(Boolean),
      fadda_sku: ((packagingFadda || []) as any[])
        .map((row) => String(row?.sku || "").trim())
        .filter(Boolean),
    }),
    [packagingBoxes, packagingFadda, packagingPlasticSheets],
  )

  const selectedCustomer = customerMap.get(form.customerId)
  const selectedTube = tubeSizeMap.get(form.tubeSizeId)
  const selectedMandrel = mandrelMap.get(form.mandrelId)
  const parchmentFamilies = useMemo(
    () =>
      Array.from(
        new Set(
          ((parchments || []) as any[])
            .map((row) => String(row?.vendor_family || row?.vendor_name || "").trim().toUpperCase())
            .filter(Boolean),
        ),
      ),
    [parchments],
  )
  const selectedParchmentGroups = useMemo(
    () => parseJsonField<string[]>(form.dynamicValues.allowed_parchment_groups_json, []),
    [form.dynamicValues.allowed_parchment_groups_json],
  )

  useEffect(() => {
    const boxCode = optionValue(form.dynamicValues.box_code || form.dynamicValues.box)
    if (!boxCode) {
      if (optionValue(form.dynamicValues.box_size)) {
        setForm((current) => ({
          ...current,
          dynamicValues: { ...current.dynamicValues, box_size: "" },
        }))
      }
      return
    }

    const selectedBox = packagingBoxMap.get(boxCode)
    const nextSize = selectedBox?.size_label ? String(selectedBox.size_label) : optionValue(form.dynamicValues.box_size)
    if (!selectedBox || optionValue(form.dynamicValues.box_size) === nextSize) return

    setForm((current) => ({
      ...current,
      dynamicValues: {
        ...current.dynamicValues,
        box_code: boxCode,
        box: boxCode,
        box_size: nextSize,
      },
    }))
  }, [form.dynamicValues.box, form.dynamicValues.box_code, form.dynamicValues.box_size, packagingBoxMap])

  const clientRanges = useMemo(() => deriveRanges(form.averages, DEFAULT_TOLERANCE_BANDS), [form.averages])
  const clientRows = useMemo(() => buildMatrixRows(form.averages, clientRanges), [form.averages, clientRanges])

  const manufacturingAverages = useMemo(() => {
    const mandrelOd = Number(selectedMandrel?.outer_diameter_mm || 0)
    const mandrelAverageId = mandrelOd > 0 ? roundValue(mandrelOd + 0.1, 2) : roundValue(Number(form.averages.id || 0), 2)
    const usableLength = Number(specConstants?.bamboo_max_length_mm || 1560) - Number(specConstants?.cut_loss_mm || 40)
    const recoveryFactor = 1 - Number(form.shrinkPercent || 0) / 100
    const totalWall = form.recipeRows.reduce((sum, row) => sum + Number(row.thicknessPerPly || 0) * Math.max(1, Number(row.plyCount || 1)), 0)
    const tubeLength = Number(selectedTube?.length_mm || 0) || 1
    const targetWeight = Number(form.averages.weight || 0)

    return {
      id: mandrelAverageId,
      od: mandrelOd > 0 ? roundValue(mandrelAverageId + totalWall * 2, 2) : roundValue(Number(form.averages.od || 0), 2),
      length: roundValue(usableLength, 2),
      weight:
        targetWeight > 0
          ? roundValue((targetWeight / Math.max(recoveryFactor, 0.01)) * (usableLength / tubeLength), 2)
          : 0,
      cs: Number(specDocument?.spec?.approved_cs || form.averages.cs || 0),
      moisture: Number(form.averages.moisture || 0),
    }
  }, [form.averages, form.recipeRows, form.shrinkPercent, selectedMandrel, selectedTube, specConstants, specDocument?.spec?.approved_cs])

  const manufacturingRows = useMemo(() => {
    const avg = manufacturingAverages
    const max = {
      id: roundValue(avg.id + 0.1, 2),
      od: roundValue(avg.od + DEFAULT_TOLERANCE_BANDS.od, 2),
      length: roundValue(avg.length + 20, 2),
      weight: roundValue(avg.weight + 20, 2),
      cs: roundValue(avg.cs * 1.07, 2),
      moisture: roundValue(clamp(avg.moisture + DEFAULT_TOLERANCE_BANDS.moisture, 0, 100), 2),
    }
    const min = {
      id: roundValue(Math.max(avg.id - 0.1, 0), 2),
      od: roundValue(Math.max(avg.od - DEFAULT_TOLERANCE_BANDS.od, 0), 2),
      length: roundValue(Math.max(avg.length - 20, 0), 2),
      weight: roundValue(Math.max(avg.weight - 20, 0), 2),
      cs: roundValue(avg.cs * 0.93, 2),
      moisture: roundValue(clamp(avg.moisture - DEFAULT_TOLERANCE_BANDS.moisture, 0, 100), 2),
    }

    return [
      { label: "AVG", id: avg.id, od: avg.od, thick: thicknessFrom(avg.id, avg.od), length: avg.length, weight: avg.weight, cs: avg.cs, moisture: avg.moisture },
      { label: "MAX", id: max.id, od: max.od, thick: thicknessFrom(max.id, max.od), length: max.length, weight: max.weight, cs: max.cs, moisture: max.moisture },
      { label: "MIN", id: min.id, od: min.od, thick: thicknessFrom(min.id, min.od), length: min.length, weight: min.weight, cs: min.cs, moisture: min.moisture },
    ]
  }, [manufacturingAverages, selectedMandrel])

  const recipePreview = useMemo(() => {
    const usableLength = Math.max(0, Number(specConstants?.bamboo_max_length_mm || 1560) - Number(specConstants?.cut_loss_mm || 40))
    const tubeLength = Number(selectedTube?.length_mm || 0)
    const thicknessAvg = thicknessFrom(Number(form.averages.id || 0), Number(form.averages.od || 0))
    const circumferenceDiameter = Math.max(Number(form.averages.id || 0) + Number(thicknessAvg || 0), 1)
    const circumference = 3.14 * circumferenceDiameter
    const glueMode = "workbook"
    const glueBasePct = Number(form.dynamicValues.glue_base_percent || 15)
    const dryingLossPercent = Number(form.shrinkPercent || 9.5)
    const dryingDivisor = Math.max(0.01, 1 - dryingLossPercent / 100)
    const dryingPct = roundValue((1 - dryingDivisor) * 100, 2)

    const rows = form.recipeRows.map((row) => {
      const paper = paperMap.get(row.paper_id)
      const gsm = Number(paper?.gsm || 0)
      const positions = parsePlyPositions(row.positionsText, Number(row.plyCount || 1))
      const actualPlyCount = positions.length
      // Workbook parity: row weight at tube length scale, not bamboo scale.
      const rowWeightGPerPly = (circumference * Math.max(tubeLength, 1) * gsm) / 1_000_000
      const rowWeightG = rowWeightGPerPly * actualPlyCount

      return {
        ...row,
        gsm,
        positions,
        actualPlyCount,
        weightG: rowWeightG,
      }
    })

    const totalPlyCount = rows.reduce((sum, row) => sum + row.actualPlyCount, 0)
    const totalAllPlyGsm = rows.reduce((sum, row) => sum + row.gsm * row.actualPlyCount, 0)
    const totalAllPlyBf = rows.reduce((sum, row) => sum + Number(row.bfPerPly || 0) * row.actualPlyCount, 0)
    const totalAllPlyThickness = rows.reduce((sum, row) => sum + Number(row.thicknessPerPly || 0) * row.actualPlyCount, 0)
    const totalAllPlyBond = rows.reduce((sum, row) => sum + Number(row.plyBond || 0) * row.actualPlyCount, 0)
    const totalPaperWeightG = rows.reduce((sum, row) => sum + Number(row.weightG || 0), 0)
    const adhesiveComponents = buildAdhesiveComponentsPayload(form.adhesiveComponents, {
      tl4: Number(form.adhesive20100 || 0),
      vinsol: Number(form.adhesive30100 || 0),
      basePercent: glueBasePct,
    })
    const componentWeights = adhesiveComponents.map((component) => {
      const weightG = totalPaperWeightG * (Number(component.base_percent || 0) / 100) * (Number(component.ratio_percent || 0) / 100)
      return {
        ...component,
        weightG,
      }
    })
    const adhesiveWeightG = componentWeights.reduce((sum, component) => sum + Number(component.weightG || 0), 0)
    const tl4WeightG = componentWeights
      .filter((component) => component.name.toLowerCase().includes("tl-4") || component.name.toLowerCase().includes("20100"))
      .reduce((sum, component) => sum + Number(component.weightG || 0), 0)
    const vinsolWeightG = componentWeights
      .filter((component) => component.name.toLowerCase().includes("vinsol") || component.name.toLowerCase().includes("30100"))
      .reduce((sum, component) => sum + Number(component.weightG || 0), 0)
    const parchmentWeightG = totalPaperWeightG * (Number(form.parchmentPercent || 0) / 100)
    const wetWeightG = totalPaperWeightG + adhesiveWeightG + parchmentWeightG
    const dryWeightG = wetWeightG * dryingDivisor
    const tubesPerBamboo = tubeLength > 0 ? Math.floor(usableLength / tubeLength) : 0
    const perTubeWeightG = dryWeightG
    const preOvenTargetG = Number(form.averages.weight || 0) / dryingDivisor
    const weightPerMmG = tubeLength > 0 ? preOvenTargetG / tubeLength : 0
    const bambooRequiredWetG = weightPerMmG * usableLength
    const wetDeltaG = wetWeightG - preOvenTargetG
    const dryDeltaG = perTubeWeightG - Number(form.averages.weight || 0)

    return {
      rows,
      usableLength,
      tubeLength,
      circumferenceDiameter,
      tubesPerBamboo,
      totalPlyCount,
      totalAllPlyGsm,
      totalAllPlyBf,
      totalAllPlyThickness,
      totalAllPlyBond,
      totalPaperWeightG,
      tl4WeightG,
      vinsolWeightG,
      componentWeights,
      adhesiveWeightG,
      parchmentWeightG,
      wetWeightG,
      dryWeightG,
      dryingDivisor,
      dryingPct,
      preOvenTargetG,
      weightPerMmG,
      bambooRequiredWetG,
      wetDeltaG,
      dryDeltaG,
      perTubeWeightG,
      glueMode,
      glueBasePct,
    }
  }, [
    form.adhesiveComponents,
    form.adhesive20100,
    form.adhesive30100,
    form.averages.id,
    form.averages.od,
    form.averages.weight,
    form.shrinkPercent,
    form.dynamicValues.glue_base_percent,
    form.parchmentPercent,
    form.recipeRows,
    paperMap,
    selectedTube,
    specConstants,
  ])

  const weightBand = useMemo(
    () => ({
      min: Number(clientRanges.weight_min_g),
      max: Number(clientRanges.weight_max_g),
    }),
    [clientRanges.weight_min_g, clientRanges.weight_max_g],
  )

  const previewQuery = useSpecSheetPreview({
    tubeLengthMm: Number(selectedTube?.length_mm || form.averages.length || 0),
    tubeOdMm: Number(selectedTube?.outer_diameter_mm || form.averages.od || 0),
    tubeIdMm: Number(form.averages.id || selectedTube?.inner_diameter_mm || 0),
    targetDryWeightG: Number(form.averages.weight || 0),
    recipeRows: form.recipeRows.map((row) => ({
      paper_id: row.paper_id || "",
      code: row.code || "",
      variety: row.variety || "",
      category: row.category || "",
      gsm: Number(paperMap.get(row.paper_id)?.gsm || 0),
      bf_per_ply: Number(row.bfPerPly || 0),
      thickness_per_ply: Number(row.thicknessPerPly || 0),
      ply_bond: Number(row.plyBond || 0),
      ply_count: Number(row.plyCount || 1),
      positions_text: row.positionsText || "",
    })),
    adhesiveComponents: buildAdhesiveComponentsPayload(form.adhesiveComponents, {
      tl4: Number(form.adhesive20100 || 0),
      vinsol: Number(form.adhesive30100 || 0),
      basePercent: Number(form.dynamicValues.glue_base_percent || 15),
    }),
  })

  const latestApprovedTrial = useMemo(() => {
    const trials = specDocument?.trials || []
    return [...trials].sort((left, right) => new Date(right.tested_at).getTime() - new Date(left.tested_at).getTime())[0] || null
  }, [specDocument?.trials])

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    })
    setTodayLabel(formatter.format(new Date()))
  }, [])

  const suggestionsQuery = useSpecSheetSuggestions({
    recipeId: specDocument?.latestRecipe?.id || undefined,
    tubeLengthMm: Number(selectedTube?.length_mm || form.averages.length || 0),
    tubeOdMm: Number(selectedTube?.outer_diameter_mm || form.averages.od || 0),
    tubeIdMm: Number(form.averages.id || selectedTube?.inner_diameter_mm || 0),
    targetWetWeightG: Number(form.averages.weight || 0) / Math.max(0.01, 1 - Number(form.shrinkPercent || 9.5) / 100),
    paperCandidates: papers || [],
  })
  const recipeSuggestions = useMemo(
    () => ((suggestionsQuery.data?.suggestions || []) as RecipeSuggestion[]),
    [suggestionsQuery.data?.suggestions],
  )

  const notchDistanceMm = parseMmValue(form.dynamicValues.notch_distance_mm)
  const notchDepthMm = parseMmValue(form.dynamicValues.notch_depth_mm)
  const tubeLengthMm = safeNumber(selectedTube?.length_mm || form.averages.length || 0)
  const computedNotchDiagram = useMemo(() => {
    const distance = notchDistanceMm > 0 ? notchDistanceMm : roundValue(tubeLengthMm * 0.07, 2)
    const depth = notchDepthMm > 0 ? notchDepthMm : 0
    return {
      title: form.notchDiagram.title || "Reference sketch",
      tubeLengthMm,
      notchDistanceMm: distance,
      notchDepthMm: depth,
      notchType: String(form.dynamicValues.notch_type || ""),
      tubeDirection: String(form.dynamicValues.tube_direction || ""),
    }
  }, [form.dynamicValues.notch_type, form.dynamicValues.tube_direction, form.notchDiagram.title, notchDepthMm, notchDistanceMm, tubeLengthMm])

  const previewSummary = useMemo(() => (previewQuery.data?.summary || {}) as Record<string, any>, [previewQuery.data?.summary])

  const bridgeMetrics = useMemo(() => {
    const bridgeComponents = Array.isArray(previewSummary.adhesive_components) ? previewSummary.adhesive_components : []
    const bridgeAdhesiveTotal = bridgeComponents.reduce(
      (sum: number, component: any) => sum + Number(component?.weight_g || 0),
      0,
    )
    return {
      preMoistureTargetTubeG: Number(previewSummary.pre_moisture_target_tube_g ?? 0),
      weightPerMmG: Number(previewSummary.weight_per_mm_g ?? 0),
      bambooRequiredWetG: Number(previewSummary.bamboo_required_wet_g ?? 0),
      predictedWetTubeG: Number(previewSummary.predicted_wet_tube_g ?? 0),
      predictedDryTubeG: Number(previewSummary.predicted_dry_tube_g ?? 0),
      wetDeltaG: Number(previewSummary.wet_delta_g ?? 0),
      dryDeltaG: Number(previewSummary.dry_delta_g ?? 0),
      adhesiveComponents: bridgeComponents,
      adhesiveTotalG: bridgeAdhesiveTotal,
    }
  }, [previewSummary])

  const effectiveBalance = useMemo(() => {
    const perTubeWeightG = Number(previewSummary.predicted_dry_tube_g ?? 0)
    const base = {
      status:
        perTubeWeightG < Number(weightBand.min || 0)
          ? "Unbalanced - Underweight"
          : perTubeWeightG > Number(weightBand.max || 0)
            ? "Unbalanced - Overweight"
            : "Balanced (Predicted)",
      withinBand:
        perTubeWeightG >= Number(weightBand.min || 0) &&
        perTubeWeightG <= Number(weightBand.max || 0),
      perTubeWeightG,
    }
    if (
      latestApprovedTrial?.approved &&
      Number(latestApprovedTrial.actual_weight || 0) >= weightBand.min &&
      Number(latestApprovedTrial.actual_weight || 0) <= weightBand.max &&
      Number(latestApprovedTrial.actual_cs || 0) >= Number(form.averages.cs || 0)
    ) {
      return {
        ...base,
        status: "Balanced (Trial Validated)",
        withinBand: true,
      }
    }
    return base
  }, [form.averages.cs, latestApprovedTrial, previewSummary.predicted_dry_tube_g, weightBand.max, weightBand.min])

  const missingFieldDefinitions = useMemo(() => {
    const existingKeys = new Set((specFields || []).map((field: any) => field.key))
    return DEFAULT_SPEC_FIELD_DEFINITIONS.filter((field) => !existingKeys.has(field.field_key))
  }, [specFields])

  useEffect(() => {
    if (catalogBootstrapped || missingFieldDefinitions.length === 0 || ensureCatalog.isPending) return
    setCatalogBootstrapped(true)
    ensureCatalog.mutate(specFields || [])
  }, [catalogBootstrapped, ensureCatalog, missingFieldDefinitions.length, specFields])

  useEffect(() => {
    if (!isCreate || !selectedTube) return

    setForm((current) => {
      if (current.averages.id > 0 && current.tubeSizeId === selectedTube.id) {
        return current
      }

      const closestMandrel = ((mandrels || []) as any[])
        .map((mandrel) => ({
          ...mandrel,
          diff: Math.abs(Number(mandrel?.outer_diameter_mm || 0) - Number(selectedTube.inner_diameter_mm || 0)),
        }))
        .sort((left, right) => left.diff - right.diff)[0]
      const derivedWeight =
        Number(selectedTube.outer_diameter_mm || 0) > 0 && Number(selectedTube.length_mm || 0) > 0
          ? roundValue(
              ((Number(selectedTube.outer_diameter_mm || 0) + Number(selectedTube.inner_diameter_mm || 0)) / 2) *
                (Number(selectedTube.length_mm || 0) / 60),
              2,
            )
          : 0

      return {
        ...current,
        mandrelId: current.mandrelId || closestMandrel?.id || current.mandrelId,
        averages: {
          ...current.averages,
          id: Number(selectedTube.inner_diameter_mm || 0),
          od: Number(selectedTube.outer_diameter_mm || 0),
          length: Number(selectedTube.length_mm || 0),
          weight: current.averages.weight > 0 ? current.averages.weight : derivedWeight,
        },
      }
    })
  }, [isCreate, mandrels, selectedTube])

  useEffect(() => {
    if (!isCreate || !selectedCustomer) return
    setForm((current) => current)
  }, [isCreate, selectedCustomer])

  useEffect(() => {
    if (!specDocument?.spec || loadedSpecId === specDocument.spec.id) return

    const spec = specDocument.spec
    const dynamicMap = parseDynamicFields(spec.dynamic_fields as DynamicFieldValue[])
    const parsedAdhesiveComponents = parseAdhesiveComponents(
      dynamicMap.adhesive_components_json,
      Number(dynamicMap.glue_base_percent || 15),
    )
    const fallbackAdhesiveComponents = buildAdhesiveComponentsPayload(parsedAdhesiveComponents, {
      tl4: Number(spec.adhesive_20100_percent ?? 0),
      vinsol: Number(spec.adhesive_30100_percent ?? 0),
      basePercent: Number(dynamicMap.glue_base_percent || 15),
    })
    const recipeJson = parseJsonField<{ rows?: GroupedRecipeRow[] }>(dynamicMap.recipe_sheet_json, {})
    const processGuidance = parseJsonField<ProcessGuidanceRow[]>(dynamicMap.process_guidance_json, DEFAULT_PROCESS_GUIDANCE)
    const manufacturingOverride = parseJsonField<Record<string, any>>(dynamicMap.manufacturing_override_json, {})
    const defaultState = defaultFormState()
    const winderTarget = parseJsonField<StageTemplate>(dynamicMap.winder_target_json, defaultState.winderTarget)
    const ovenTarget = parseJsonField<StageTemplate>(dynamicMap.oven_target_json, defaultState.ovenTarget)
    const processTarget = parseJsonField<StageTemplate>(dynamicMap.process_target_json, defaultState.processTarget)
    const packingTarget = parseJsonField<PackingTemplate>(dynamicMap.packing_target_json, defaultState.packingTarget)
    const notchDiagram = parseJsonField<DiagramState>(dynamicMap.notch_diagram_json, {
      title: "Reference sketch",
    })

    let recipeRows = recipeJson.rows || []
    if ((!recipeRows || recipeRows.length === 0) && specDocument.latestRecipe?.layers?.length) {
      recipeRows = specDocument.latestRecipe.layers.map((layer, index) => {
        const paper = paperMap.get(layer.paper_id)
        const labels = buildGroupedRowLabel(paper)
        return {
          id: `existing-${index}-${layer.ply_no}`,
          paper_id: layer.paper_id,
          code: labels.code,
          variety: labels.variety,
          category: labels.category,
          gsm: Number(layer.gsm_snapshot || paper?.gsm || 0),
          bfPerPly: Number(layer.bf_snapshot || 0),
          thicknessPerPly: 0,
          plyBond: Number(spec.required_cs || 0),
          plyCount: 1,
          adhesiveLabel: index % 2 === 0 ? "TL-4" : "Vinsol",
          positionsText: String(layer.ply_no),
        }
      })
    }

    setForm({
      customerId: spec.customer_id,
      variantTemplateKey: CANONICAL_VARIANT_KEY,
      tubeSizeId: spec.tube_size_id,
      mandrelId: spec.mandrel_id,
      averages: {
        id: midpoint(spec.id_min_mm, spec.id_max_mm),
        od: midpoint(spec.od_min_mm, spec.od_max_mm),
        length: midpoint(spec.length_min_mm, spec.length_max_mm),
        weight: midpoint(spec.weight_min_g, spec.weight_max_g),
        cs: midpoint(spec.cs_min_n, spec.cs_max_n),
        moisture: midpoint(spec.moisture_min_pct, spec.moisture_max_pct),
      },
      shrinkPercent: optionValue(spec.shrink_percent),
      parchmentPercent: "1.5",
      parchmentColor: "",
      adhesive20100: optionValue(spec.adhesive_20100_percent ?? 0),
      adhesive30100: optionValue(spec.adhesive_30100_percent ?? 0),
      adhesiveComponents: fallbackAdhesiveComponents,
      notes: specDocument.latestRecipe?.notes || "",
      recipeRows: recipeRows.length ? recipeRows : [blankRecipeRow(nextRecipeRowSeed())],
      dynamicValues: {
        ...defaultState.dynamicValues,
        ...dynamicMap,
        groove: dynamicMap.groove || dynamicMap.guru || "",
        box_code: dynamicMap.box_code || dynamicMap.box || "",
        box: dynamicMap.box || dynamicMap.box_code || "",
      },
      processGuidance,
      selectedGuidanceIndex: clamp(
        processGuidance.findIndex((row) => row.dryingPercent === Number(spec.shrink_percent || 0)),
        0,
        Math.max(processGuidance.length - 1, 0),
      ),
      notchDiagram,
      winderTarget,
      ovenTarget,
      processTarget,
      packingTarget,
      trial: {
        actualWeight: optionValue(latestApprovedTrial?.actual_weight),
        actualCs: optionValue(latestApprovedTrial?.actual_cs),
        actualShrink: optionValue(latestApprovedTrial?.actual_shrink),
        remarks: latestApprovedTrial?.remarks || "",
        approved: Boolean(latestApprovedTrial?.approved),
      },
    })
    setLoadedSpecId(spec.id)

    if (mode === "edit" && spec.status !== "draft") {
      router.replace(`/specifications/${spec.id}`)
    }
  }, [loadedSpecId, mode, paperMap, router, specDocument, latestApprovedTrial])

  const footerFieldKeys = ["valid_upto", "prepared_by", "prepared_date", "sign_off_note"] as const
  const footerValidation = footerFieldKeys.map((key) => ({
    key,
    label: DEFAULT_SPEC_FIELD_DEFINITIONS.find((field) => field.field_key === key)?.label || key,
    filled: optionValue(form.dynamicValues[key]).trim().length > 0,
  }))
  const footerComplete = footerValidation.every((field) => field.filled)

  const canSubmit = isEditable && form.customerId && form.tubeSizeId && form.mandrelId
  const canApprove =
    !isCreate &&
    specDocument?.spec?.status === "draft" &&
    Boolean(specDocument?.latestRecipe?.id) &&
    Boolean(effectiveBalance.withinBand) &&
    footerComplete &&
    (!latestApprovedTrial?.approved ||
      (Number(latestApprovedTrial.actual_weight || 0) >= weightBand.min &&
        Number(latestApprovedTrial.actual_weight || 0) <= weightBand.max &&
        Number(latestApprovedTrial.actual_cs || 0) >= Number(form.averages.cs || 0)))

  const selectedGuidance = form.processGuidance[form.selectedGuidanceIndex]
  const weightDeltaG = Number(effectiveBalance.perTubeWeightG || 0) - Number(form.averages.weight || 0)
  const weightStatusMessage =
    Number(effectiveBalance.perTubeWeightG || 0) < Number(weightBand.min || 0)
      ? `Underweight by ${Math.abs(weightDeltaG).toFixed(2)} g`
      : Number(effectiveBalance.perTubeWeightG || 0) > Number(weightBand.max || 0)
        ? `Overweight by ${Math.abs(weightDeltaG).toFixed(2)} g`
        : `Balanced within band (${weightBand.min.toFixed(2)} - ${weightBand.max.toFixed(2)} g)`
  const csGateFailed = Boolean(
    latestApprovedTrial?.approved &&
      Number(latestApprovedTrial.actual_cs || 0) < Number(form.averages.cs || 0),
  )

  const headerTitle =
    mode === "create"
      ? "New Specification Sheet"
      : mode === "edit"
        ? `Edit Spec v${specDocument?.spec?.version || ""}`
        : mode === "print"
          ? `Print Specification ${specDocument?.spec?.version ? `v${specDocument.spec.version}` : ""}`
          : `Specification ${specDocument?.spec?.version ? `v${specDocument.spec.version}` : ""}`

  const previewMetrics = [
    { label: "Paper Weight", value: `${Number(previewSummary.paper_total_g || 0).toFixed(2)} g` },
    { label: "Adhesive Weight", value: `${bridgeMetrics.adhesiveTotalG.toFixed(2)} g` },
    { label: "Parchment Weight", value: `${Number(previewSummary.parchment_weight_g || 0).toFixed(2)} g` },
    { label: "Wet / Tube", value: `${bridgeMetrics.predictedWetTubeG.toFixed(2)} g` },
    { label: "Dry / Tube", value: `${bridgeMetrics.predictedDryTubeG.toFixed(2)} g` },
    { label: "Wet Delta", value: `${bridgeMetrics.wetDeltaG.toFixed(2)} g` },
    { label: "Dry Delta", value: `${bridgeMetrics.dryDeltaG.toFixed(2)} g` },
    { label: "Bamboo Wet", value: `${bridgeMetrics.bambooRequiredWetG.toFixed(2)} g` },
    { label: "Bamboo Dry", value: `${manufacturingAverages.weight.toFixed(2)} g` },
    { label: "Weight / mm", value: `${bridgeMetrics.weightPerMmG.toFixed(4)} g/mm` },
    { label: "Bamboo Length", value: `${Number(previewSummary.selected_bamboo_length_mm || 0).toFixed(0)} mm` },
    { label: "Tubes / Bamboo", value: `${Number(previewSummary.tubes_per_bamboo || 0)}` },
  ]
  const activeSuggestion = recipeSuggestions[0] || null
  const livePaperTotal = Number(previewSummary.paper_total_g || activeSuggestion?.predictedPaperWeightG || 0)
  const liveDryTube = Number(previewSummary.predicted_dry_tube_g || activeSuggestion?.predictedDryTubeG || 0)
  const liveWetTube = Number(previewSummary.predicted_wet_tube_g || activeSuggestion?.predictedWetTubeG || 0)
  const liveDryDelta = Number(previewSummary.dry_delta_g || activeSuggestion?.deltaDryG || 0)

  const updateDynamicValue = (key: string, value: string) => {
    setForm((current) => ({
      ...current,
      dynamicValues: {
        ...current.dynamicValues,
        [key]: value,
      },
    }))
  }

  const toggleParchmentGroup = (group: string) => {
    const next = selectedParchmentGroups.includes(group)
      ? selectedParchmentGroups.filter((item) => item !== group)
      : [...selectedParchmentGroups, group]
    updateDynamicValue("allowed_parchment_groups_json", stringifyJsonField(next))
  }

  const updateRecipeRow = (rowId: string, patch: Partial<GroupedRecipeRow>) => {
    setForm((current) => ({
      ...current,
      recipeRows: current.recipeRows.map((row) => {
        if (row.id !== rowId) return row
        const next = { ...row, ...patch }
        if (patch.paper_id) {
          const paper = paperMap.get(patch.paper_id)
          const labels = buildGroupedRowLabel(paper)
          next.code = labels.code
          next.variety = labels.variety
          next.category = labels.category
          next.bfPerPly = Number(paper?.bf ?? paper?.strength_value ?? next.bfPerPly ?? 0)
          next.thicknessPerPly = Number(
            paper?.thickness_mm ?? next.thicknessPerPly ?? roundValue(Number(paper?.gsm || 0) / 700, 4),
          )
          next.plyBond = Number(paper?.ply_bond ?? next.plyBond ?? 0)
        }
        return next
      }),
    }))
  }

  const addRecipeRow = () => {
    setForm((current) => ({
      ...current,
      recipeRows: [...current.recipeRows, blankRecipeRow(nextRecipeRowSeed())],
    }))
  }

  const removeRecipeRow = (rowId: string) => {
    setForm((current) => ({
      ...current,
      recipeRows: current.recipeRows.length === 1 ? current.recipeRows : current.recipeRows.filter((row) => row.id !== rowId),
    }))
  }

  const applyRecipeSuggestion = (suggestion: RecipeSuggestion) => {
    setForm((current) => ({
      ...current,
      recipeRows: suggestion.rows.map((row, index) => ({
        ...row,
        id: `row-${nextRecipeRowSeed()}-${index + 1}`,
      })),
    }))
  }

  const updateAdhesiveComponent = (index: number, patch: Partial<AdhesiveComponent>) => {
    setForm((current) => ({
      ...current,
      adhesiveComponents: current.adhesiveComponents.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    }))
  }

  const addAdhesiveComponent = () => {
    setForm((current) => {
      if (current.adhesiveComponents.length >= 3) return current
      return {
        ...current,
        adhesiveComponents: [
          ...current.adhesiveComponents,
          {
            name: `Adhesive ${current.adhesiveComponents.length + 1}`,
            base_percent: Number(current.dynamicValues.glue_base_percent || 15),
            ratio_percent: 10,
          },
        ],
      }
    })
  }

  const removeAdhesiveComponent = (index: number) => {
    setForm((current) => {
      if (current.adhesiveComponents.length <= 2) return current
      return {
        ...current,
        adhesiveComponents: current.adhesiveComponents.filter((_, componentIndex) => componentIndex !== index),
      }
    })
  }

  const buildSpecPayload = () => {
    const customer = customerMap.get(form.customerId)
    const ranges = clientRanges
    const adhesiveComponentsPayload = buildAdhesiveComponentsPayload(form.adhesiveComponents, {
      tl4: Number(form.adhesive20100 || 0),
      vinsol: Number(form.adhesive30100 || 0),
      basePercent: Number(form.dynamicValues.glue_base_percent || 15),
    })
    const legacyTl4Ratio = adhesiveComponentsPayload
      .filter((component) => {
        const name = component.name.toLowerCase()
        return name.includes("tl-4") || name.includes("20100")
      })
      .reduce((sum, component) => sum + Number(component.ratio_percent || 0), 0)
    const legacyVinsolRatio = adhesiveComponentsPayload
      .filter((component) => {
        const name = component.name.toLowerCase()
        return name.includes("vinsol") || name.includes("30100")
      })
      .reduce((sum, component) => sum + Number(component.ratio_percent || 0), 0)
    const dynamicValues = {
      ...form.dynamicValues,
      guru: form.dynamicValues.groove || form.dynamicValues.guru || "",
      box_code: form.dynamicValues.box_code || form.dynamicValues.box || "",
      box: form.dynamicValues.box_code || form.dynamicValues.box || "",
      allowed_parchment_groups_json: stringifyJsonField(selectedParchmentGroups),
      drying_percent_override: optionValue(form.shrinkPercent),
      fill_instructions_version: CANONICAL_VARIANT_KEY,
      adhesive_components_json: stringifyJsonField(adhesiveComponentsPayload),
      recipe_sheet_json: stringifyJsonField({ rows: form.recipeRows }),
      winder_target_json: stringifyJsonField(form.winderTarget),
      oven_target_json: stringifyJsonField(form.ovenTarget),
      process_target_json: stringifyJsonField(form.processTarget),
      packing_target_json: stringifyJsonField(form.packingTarget),
      process_guidance_json: stringifyJsonField(form.processGuidance),
      manufacturing_override_json: stringifyJsonField({
        enabled: true,
        averages: manufacturingAverages,
      }),
      notch_diagram_json: stringifyJsonField(form.notchDiagram),
    }
    const profilePayload: SpecProfile = {
      dimensions: {
        id_mm: { avg: form.averages.id, min: Number(ranges.id_min_mm), max: Number(ranges.id_max_mm) },
        od_mm: { avg: form.averages.od, min: Number(ranges.od_min_mm), max: Number(ranges.od_max_mm) },
        length_mm: { avg: form.averages.length, min: Number(ranges.length_min_mm), max: Number(ranges.length_max_mm) },
        thickness_mm: {
          avg: thicknessFrom(form.averages.id, form.averages.od),
          min: thicknessFrom(Number(ranges.id_min_mm), Number(ranges.od_min_mm)),
          max: thicknessFrom(Number(ranges.id_max_mm), Number(ranges.od_max_mm)),
        },
        bamboo: {
          max_length_mm: specConstants?.bamboo_max_length_mm || 1560,
          cut_loss_mm: specConstants?.cut_loss_mm || 40,
        },
      },
      quality_targets: {
        tube_weight_g: {
          avg: form.averages.weight,
          min: Number(ranges.weight_min_g),
          max: Number(ranges.weight_max_g),
        },
        cs_n: {
          avg: form.averages.cs,
          min: Number(ranges.cs_min_n),
          max: Number(ranges.cs_max_n),
        },
        moisture_pct: {
          avg: form.averages.moisture,
          min: Number(ranges.moisture_min_pct),
          max: Number(ranges.moisture_max_pct),
        },
        approved_cs: specDocument?.spec?.approved_cs ?? null,
      },
      recipe: {
        parchment_percent: 1.5,
        parchment_groups: selectedParchmentGroups,
        shrink_percent: Number(form.shrinkPercent || 0),
        adhesive_components: adhesiveComponentsPayload,
        recipe_rows: form.recipeRows,
      },
      notch_tooling: {
        notch_required: boolFromString(form.dynamicValues.notch_required),
        top_paper_required: boolFromString(form.dynamicValues.top_paper_required),
        notch_type: form.dynamicValues.notch_type || null,
        notch_distance_mm: parseMmValue(form.dynamicValues.notch_distance_mm),
        notch_depth_mm: parseMmValue(form.dynamicValues.notch_depth_mm),
        notching_holder: form.dynamicValues.notching_holder || null,
        notching_blade: form.dynamicValues.notching_blade || null,
        groove: form.dynamicValues.groove || form.dynamicValues.guru || null,
        punch: form.dynamicValues.punch || null,
        tochha: form.dynamicValues.tochha || null,
        tochha_type: form.dynamicValues.tochha_type || null,
        wider_tool: form.dynamicValues.wider_tool || null,
        height_gauge_go: safeNumber(form.dynamicValues.height_gauge_go || 0) || null,
        height_gauge_set: safeNumber(form.dynamicValues.height_gauge_set || 0) || null,
        height_gauge_no_go: safeNumber(form.dynamicValues.height_gauge_no_go || 0) || null,
        die: form.dynamicValues.die || null,
        diagram: form.notchDiagram,
      },
      process_guidance: {
        winder_target: form.winderTarget,
        oven_target: form.ovenTarget,
        process_target: form.processTarget,
      },
      packing_rules: {
        bundle_type: form.dynamicValues.bundle_type || null,
        bundle_code: form.dynamicValues.bundle_code || null,
        packing_ply: safeNumber(form.dynamicValues.packing_ply || 0) || null,
        qty_per_box: safeNumber(form.dynamicValues.qty_per_box || 0) || null,
        packing_pcs: safeNumber(form.dynamicValues.packing_pcs || 0) || null,
        box_code: form.dynamicValues.box_code || form.dynamicValues.box || null,
        box_size: form.dynamicValues.box_size || null,
        plastic_required: boolFromString(form.dynamicValues.plastic_required),
        plastic_sku: form.dynamicValues.plastic_sku || null,
        plastic_per_box: safeNumber(form.dynamicValues.plastic_per_box || 0) || null,
        fadda_sku: form.dynamicValues.fadda_sku || null,
        fadda_per_box: safeNumber(form.dynamicValues.fadda_per_box || 0) || null,
        bopp_required: boolFromString(form.dynamicValues.bopp_required),
        box: form.dynamicValues.box_code || form.dynamicValues.box || null,
        packing_target: form.packingTarget,
        instructions: form.dynamicValues.special_instructions || null,
      },
    }

    return {
      customer_id: form.customerId,
      customer_name_snapshot: customer?.name || customer?.customer_code || "",
      tube_size_id: form.tubeSizeId,
      mandrel_id: form.mandrelId,
      required_cs: Number(form.averages.cs || 0),
      target_tube_weight: Number(form.averages.weight || 0),
      id_min_mm: Number(ranges.id_min_mm),
      id_max_mm: Number(ranges.id_max_mm),
      od_min_mm: Number(ranges.od_min_mm),
      od_max_mm: Number(ranges.od_max_mm),
      length_min_mm: Number(ranges.length_min_mm),
      length_max_mm: Number(ranges.length_max_mm),
      weight_min_g: Number(ranges.weight_min_g),
      weight_max_g: Number(ranges.weight_max_g),
      cs_min_n: Number(ranges.cs_min_n),
      cs_max_n: Number(ranges.cs_max_n),
      moisture_min_pct: Number(ranges.moisture_min_pct),
      moisture_max_pct: Number(ranges.moisture_max_pct),
      parchment_percent: 1.5,
      adhesive_20100_percent: Number(legacyTl4Ratio || form.adhesive20100 || 0),
      adhesive_30100_percent: Number(legacyVinsolRatio || form.adhesive30100 || 0),
      shrink_percent: Number(form.shrinkPercent || 0),
      variant_template_key: CANONICAL_VARIANT_KEY,
      profile: profilePayload,
      dynamic_fields: buildDynamicFieldsPayload(dynamicValues),
    }
  }

  const buildRecipeLayers = () => {
    const layers: Array<{ ply_no: number; paper_id: string; gsm_snapshot: number; bf_snapshot: number }> = []
    const usedPlyNumbers = new Set<number>()
    let nextSequentialPly = 1

    for (const row of form.recipeRows) {
      if (!row.paper_id) continue
      const paper = paperMap.get(row.paper_id)
      const explicitPositions = (row.positionsText || "").trim().length > 0
      const positions = explicitPositions
        ? parsePlyPositions(row.positionsText, Number(row.plyCount || 1))
        : Array.from({ length: Math.max(1, Number(row.plyCount || 1)) }, () => {
            while (usedPlyNumbers.has(nextSequentialPly)) {
              nextSequentialPly += 1
            }
            const assigned = nextSequentialPly
            nextSequentialPly += 1
            return assigned
          })

      for (const plyNo of positions) {
        if (usedPlyNumbers.has(plyNo)) {
          throw new Error(`Duplicate ply number ${plyNo}. Adjust the ply positions before saving.`)
        }
        usedPlyNumbers.add(plyNo)
        layers.push({
          ply_no: plyNo,
          paper_id: row.paper_id,
          gsm_snapshot: Number(paper?.gsm || 0),
          bf_snapshot: Number(paper?.bf ?? paper?.strength_value ?? row.bfPerPly ?? 0),
        })
      }
    }

    return layers.sort((left, right) => left.ply_no - right.ply_no)
  }

  const buildTrialPayload = () => {
    if (!form.trial.actualWeight && !form.trial.actualCs && !form.trial.actualShrink && !form.trial.remarks) {
      return null
    }

    return {
      actual_weight: form.trial.actualWeight ? Number(form.trial.actualWeight) : null,
      actual_cs: form.trial.actualCs ? Number(form.trial.actualCs) : null,
      actual_shrink: form.trial.actualShrink ? Number(form.trial.actualShrink) : null,
      remarks: form.trial.remarks || null,
      approved: Boolean(form.trial.approved),
    }
  }

  const handleSave = async () => {
    if (!canSubmit) {
      showToast("Customer, tube size, mandrel, and the core averages are required.", "error")
      return
    }

    try {
      const specData = buildSpecPayload()
      const recipeLayers = buildRecipeLayers()
      const recipeData = { notes: form.notes || "Factory sheet recipe" }
      const trialData = isCreate ? null : buildTrialPayload()

      if (isCreate) {
        const result = await createSpecSheet.mutateAsync({
          specData,
          recipeData,
          recipeLayers,
        })
        showToast("Specification draft created.", "success")
        router.push(`/specifications/${result.spec.id}/edit`)
        return
      }

      const result = await updateSpecSheet.mutateAsync({
        specId: specId || "",
        specData,
        recipeData,
        recipeLayers,
        trialData,
      })
      showToast(result.recipe ? "Specification updated and a new recipe version was saved." : "Specification updated.", "success")
      router.push(`/specifications/${result.spec.id}`)
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to save the specification sheet."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleApprove = async () => {
    if (!specId || !canApprove) {
      showToast("This draft cannot be approved until the recipe is balanced and the current validations pass.", "error")
      return
    }

    try {
      await approveSpec.mutateAsync({ specId, data: {} })
      showToast("Specification approved.", "success")
      router.refresh()
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to approve specification."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleObsolete = async () => {
    if (!specId) return
    try {
      await obsoleteSpec.mutateAsync({ specId, data: {} })
      showToast("Specification marked obsolete.", "success")
      router.refresh()
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to obsolete specification."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleClone = async () => {
    if (!specId) return
    try {
      const result = await cloneSpec.mutateAsync({ specId })
      showToast("Draft version cloned.", "success")
      router.push(`/specifications/${result.spec.id}/edit`)
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to clone specification."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleRecordTrial = async () => {
    if (!specDocument?.latestRecipe?.id) {
      showToast("Save the sheet first so a recipe version exists before recording a trial.", "error")
      return
    }

    try {
      const trialData = buildTrialPayload()
      if (!trialData) {
        showToast("Enter trial data before saving a trial record.", "error")
        return
      }
      await recordTrial.mutateAsync({ recipeId: specDocument.latestRecipe.id, data: trialData })
      showToast("Trial result recorded.", "success")
      router.refresh()
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to record trial."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const renderScalarField = (
    key: string,
    label: string,
    type: "text" | "number" = "text",
    placeholder?: string,
  ) => {
    const definition = fieldCatalogMap.get(key) || DEFAULT_SPEC_FIELD_DEFINITIONS.find((field) => field.field_key === key)
    const staticOptions: string[] = Array.isArray(definition?.options) ? (definition.options as string[]) : []
    const toolCategories = toolFieldCategoryMap[key] || []
    const dynamicToolOptions = toolCategories.flatMap((category) => toolOptionsByCategory.get(category) || [])
    const externalOptions = externalSelectOptionsByField[key] || []
    const options = Array.from(new Set([...staticOptions, ...dynamicToolOptions, ...externalOptions]))
    const resolvedPlaceholder =
      placeholder ||
      (type === "number"
        ? `Expected ${label.toLowerCase()}`
        : options.length > 0
          ? `Select ${label.toLowerCase()}`
          : `Enter ${label.toLowerCase()}`)
    const inputType = key === "prepared_date" || key === "valid_upto" ? "date" : type

    if (key === "box_size") {
      return (
        <div className="space-y-1">
          <FieldLabel>{label}</FieldLabel>
          <input
            type="text"
            value={optionValue(form.dynamicValues[key])}
            readOnly
            disabled
            placeholder="Auto-filled from selected box"
            className="h-10 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm text-slate-600"
          />
        </div>
      )
    }

    if (definition?.field_type === "select" && options.length > 0) {
      return (
        <div className="space-y-1">
          <FieldLabel>{label}</FieldLabel>
          <select
            value={optionValue(form.dynamicValues[key])}
            onChange={(event) => updateDynamicValue(key, event.target.value)}
            disabled={!isEditable}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
          >
            <option value="">Select</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )
    }

    if (definition?.field_type === "boolean") {
      return (
        <div className="space-y-1">
          <FieldLabel>{label}</FieldLabel>
          <select
            value={yesNoValue(form.dynamicValues[key])}
            onChange={(event) => updateDynamicValue(key, event.target.value === "Yes" ? "true" : "false")}
            disabled={!isEditable}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
          >
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
      )
    }

    return (
      <div className="space-y-1">
        <FieldLabel>{label}</FieldLabel>
        <input
          type={inputType}
          value={optionValue(form.dynamicValues[key])}
          onChange={(event) => updateDynamicValue(key, event.target.value)}
          disabled={!isEditable}
          placeholder={resolvedPlaceholder}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
        />
      </div>
    )
  }

  if (!isCreate && isLoadingDocument) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Loading specification sheet...
      </div>
    )
  }

  const currentStatus = specDocument?.spec?.status || (isCreate ? "draft" : "")
  return (
    <div className={`${isPrint ? "mx-auto max-w-[1100px]" : ""}`}>
      {isPrint ? (
        <style jsx global>{`
          @media print {
            aside, header, [data-print-hidden="true"] {
              display: none !important;
            }
            main {
              padding: 0 !important;
            }
            body {
              background: white !important;
            }
          }
        `}</style>
      ) : null}
      <div className="min-w-0 space-y-6" data-testid="spec-sheet-page">
      <section className="page-hero" data-print-hidden="true" id="sheet-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100">Factory Specification Control</p>
            <h1 className="mt-2 page-title">{headerTitle}</h1>
            <p className="page-subtitle">
              Canonical factory specification control with master-linked tooling, recipe calibration, and print-ready output.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isEditable ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSubmit || createSpecSheet.isPending || updateSpecSheet.isPending}
                className="rounded-lg bg-cyan-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isCreate ? "Save Draft" : "Save Draft + Recipe"}
              </button>
            ) : null}
            {!isCreate && currentStatus === "draft" ? (
              <Link href={`/specifications/${specId}/edit`} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                Edit Draft
              </Link>
            ) : null}
            {!isCreate && currentStatus === "draft" ? (
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApprove || approveSpec.isPending}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-60"
              >
                Approve
              </button>
            ) : null}
            {!isCreate && currentStatus === "approved" ? (
              <button
                type="button"
                onClick={handleObsolete}
                disabled={obsoleteSpec.isPending}
                className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
              >
                Mark Obsolete
              </button>
            ) : null}
            {!isCreate ? (
              <button
                type="button"
                onClick={handleClone}
                disabled={cloneSpec.isPending}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                Clone Draft
              </button>
            ) : null}
            {!isPrint && specId ? (
              <Link href={`/specifications/${specId}/print`} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                Print View
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {false ? (
        <div />
      ) : null}

      <section
        className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm"
        data-print-hidden="true"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Guided Flow</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Build the canonical sheet in six steps</h2>
          </div>
          <p className="text-sm text-slate-500">
            Active step:{" "}
            <span className="font-semibold text-slate-900">
              {WIZARD_STEPS.find((step) => step.key === activeStep)?.label || WIZARD_STEPS[0].label}
            </span>
          </p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-6">
          {WIZARD_STEPS.map((step, index) => (
            <button
              key={step.key}
              type="button"
              onClick={() => {
                setActiveStep(step.key)
                document.getElementById(step.target)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                activeStep === step.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">Step {index + 1}</p>
              <p className="mt-1 text-sm font-semibold">{step.label}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" data-print-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected plant for write</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {activePlant === "ALL" ? "All visible plants selected. Pick one concrete plant before saving." : activePlant || user?.plant_id || "No plant selected"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            Preview math and paper suggestions stay live even before you save the draft.
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm xl:sticky xl:top-24" data-testid="spec-sheet-preview-rail">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Preview rail</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Live paper total, wet bridge, and bamboo yield</h2>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            One bamboo yield: {Number(previewSummary.tubes_per_bamboo || 0)} pcs
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {previewMetrics.map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
              <p className="mt-2 font-semibold text-slate-950">{metric.value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700">Live paper total</p>
            <p className="mt-2 font-semibold text-cyan-950">{livePaperTotal.toFixed(2)} g</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">One bamboo yield</p>
            <p className="mt-2 font-semibold text-emerald-950">{Number(previewSummary.tubes_per_bamboo || 0)} pcs</p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700">Suggested wet / dry</p>
            <p className="mt-2 font-semibold text-violet-950">{liveWetTube.toFixed(2)} / {liveDryTube.toFixed(2)} g</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">Suggested dry delta</p>
            <p className="mt-2 font-semibold text-amber-950">{liveDryDelta.toFixed(2)} g dry delta</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-lg shadow-slate-900/5" id="sheet-client">
        <div className="space-y-4">
          <div className="grid gap-4 border-b border-slate-300 pb-4 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {user?.name || "Hari Om Paper"}
              </p>
              <h2 className="mt-2 text-center text-xl font-black uppercase tracking-[0.18em] text-slate-900">
                Specification Sheet
              </h2>
            </div>
            <div className="grid gap-2 text-sm md:min-w-56">
              <div className="grid grid-cols-[90px_1fr] gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-500">Date</span>
                <span>{todayLabel}</span>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-500">Status</span>
                <span className="font-semibold uppercase">{currentStatus || "draft"}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2 space-y-1">
                <FieldLabel>Client / Party Name</FieldLabel>
                {isEditable ? (
                  <select
                    value={form.customerId}
                    onChange={(event) => {
                      const nextCustomer = customerMap.get(event.target.value)
                      setForm((current) => ({ ...current, customerId: event.target.value, dynamicValues: current.dynamicValues }))
                      if (nextCustomer) {
                        setForm((current) => ({ ...current, customerId: event.target.value }))
                      }
                    }}
                    className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  >
                    <option value="">Select customer</option>
                    {(customers || []).map((customer: any) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                    {selectedCustomer?.name || specDocument?.spec?.customer_name || "-"}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <FieldLabel>Version</FieldLabel>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                  v{specDocument?.spec?.version || 1}
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Sheet Logic</FieldLabel>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                  Canonical factory sheet
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-bold uppercase tracking-[0.14em] text-slate-500">Balance State</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{effectiveBalance.status}</p>
              <p className="mt-1">Per-tube dry weight: {Number(effectiveBalance.perTubeWeightG || 0).toFixed(2)} g</p>
              <p>Allowed band: {weightBand.min.toFixed(2)} - {weightBand.max.toFixed(2)} g</p>
            </div>
          </div>

          <MasterLinkRow
            links={[
              { href: "/masters/customers", label: "Customer master" },
              { href: "/masters/tube-sizes", label: "Tube sizes" },
              { href: "/masters/mandrels", label: "Mandrels" },
              { href: "/masters/parchments", label: "Parchments" },
            ]}
          />

          <div className="grid gap-2 md:grid-cols-8">
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2">
              <FieldLabel>Size</FieldLabel>
              <div className="mt-1 font-semibold">
                {selectedTube ? `${selectedTube.inner_diameter_mm} × ${selectedTube.outer_diameter_mm} × ${selectedTube.length_mm}` : "Select tube size"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>ID</FieldLabel>
              <div className="mt-1 font-semibold">{form.averages.id.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>OD</FieldLabel>
              <div className="mt-1 font-semibold">{form.averages.od.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>LT</FieldLabel>
              <div className="mt-1 font-semibold">{form.averages.length.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>Weight (Gms)</FieldLabel>
              <div className="mt-1 font-semibold">{form.averages.weight.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>C.S (KGF)</FieldLabel>
              <div className="mt-1 font-semibold">{form.averages.cs.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <FieldLabel>Notch / Top Paper</FieldLabel>
              <div className="mt-1 font-semibold">
                {boolFromString(form.dynamicValues.notch_required) ? "Yes" : "No"} / {boolFromString(form.dynamicValues.top_paper_required) ? "Yes" : "No"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <SectionLabel title="Client Specifications" subtitle="AVG / MAX / MIN rows mirror the factory sheet." />
          <MasterLinkRow links={[{ href: "/masters/tube-sizes", label: "Open tube sizes" }]} />
          {isEditable ? (
            <div className="flex flex-wrap gap-2">
              {((tubeSizes || []) as any[]).slice(0, 8).map((tube: any) => {
                const label = `${tube.inner_diameter_mm} × ${tube.outer_diameter_mm} × ${tube.length_mm}`
                return (
                  <button
                    key={tube.id}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, tubeSizeId: tube.id }))}
                    className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                      form.tubeSizeId === tube.id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : null}
          {isEditable ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <FieldLabel>Tube Size</FieldLabel>
                <select
                  data-testid="spec-sheet-tube-size"
                  value={form.tubeSizeId}
                  onChange={(event) => setForm((current) => ({ ...current, tubeSizeId: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">Select tube size</option>
                  {(tubeSizes || []).map((tube: any) => (
                    <option key={tube.id} value={tube.id}>
                      {tube.inner_diameter_mm} × {tube.outer_diameter_mm} × {tube.length_mm}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Target Weight</FieldLabel>
                <input
                  data-testid="spec-sheet-target-weight"
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.weight)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, weight: safeNumber(event.target.value || 0) },
                    }))
                  }
                  placeholder="Expected 230 g"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Required CS</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.cs)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, cs: safeNumber(event.target.value || 0) },
                    }))
                  }
                  placeholder="Expected 500+"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>ID Avg</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.id)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, id: safeNumber(event.target.value || 0) },
                    }))
                  }
                  placeholder="Expected ID mm"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>OD Avg</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.od)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, od: safeNumber(event.target.value || 0) },
                    }))
                  }
                  placeholder="Expected OD mm"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Length Avg</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.length)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, length: safeNumber(event.target.value || 0) },
                    }))
                  }
                  placeholder="Expected length mm"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Moisture Avg</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={inputNumberValue(form.averages.moisture)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      averages: { ...current.averages, moisture: clamp(safeNumber(event.target.value || 0), 0, 100) },
                    }))
                  }
                  placeholder="Expected moisture %"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Client specification</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Asked ID / OD / LT</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {form.averages.id.toFixed(2)} / {form.averages.od.toFixed(2)} / {form.averages.length.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Asked Weight</p>
                <p className="mt-1 font-semibold text-slate-900">{form.averages.weight.toFixed(2)} g</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Asked CS</p>
                <p className="mt-1 font-semibold text-slate-900">{form.averages.cs.toFixed(2)}</p>
              </div>
            </div>
          </div>
          <SpecMatrixTable title="Client Specification Matrix" rows={clientRows} />
        </div>

        <div className="space-y-3 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-manufacturing">
          <SectionLabel title="Manufacturing / Production & Consumption" subtitle="Mandrel-driven ID, recipe-driven OD, and bamboo planning from the canonical sheet." />
          <MasterLinkRow links={[{ href: "/masters/mandrels", label: "Open mandrels" }]} />
          {isEditable ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <FieldLabel>Mandrel</FieldLabel>
                <select
                  data-testid="spec-sheet-mandrel"
                  value={form.mandrelId}
                  onChange={(event) => setForm((current) => ({ ...current, mandrelId: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">Select mandrel</option>
                  {(mandrels || []).map((mandrel: any) => (
                    <option key={mandrel.id} value={mandrel.id}>
                      {mandrel.mandrel_code} | OD {mandrel.outer_diameter_mm}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Shrink / Drying %</FieldLabel>
                <input
                  type="number"
                  step="0.1"
                  value={form.shrinkPercent}
                  onChange={(event) => setForm((current) => ({ ...current, shrinkPercent: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Guidance Row</FieldLabel>
                <select
                  value={String(form.selectedGuidanceIndex)}
                  onChange={(event) => {
                    const nextIndex = Number(event.target.value || 0)
                    const row = form.processGuidance[nextIndex]
                    setForm((current) => ({
                      ...current,
                      selectedGuidanceIndex: nextIndex,
                      shrinkPercent: optionValue(row?.dryingPercent ?? current.shrinkPercent),
                    }))
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  {form.processGuidance.map((row, index) => (
                    <option key={`${row.rh}-${index}`} value={index}>
                      {row.rh} | Dry {row.dryingPercent}% | Moist {row.moistureBand}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Manufacturing specification</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Bamboo LT</p>
                <p className="mt-1 font-semibold text-slate-900">{Number(previewSummary.selected_bamboo_length_mm || 0).toFixed(0)} mm</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Mandrel driven ID</p>
                <p className="mt-1 font-semibold text-slate-900">{manufacturingAverages.id.toFixed(2)} mm</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">One bamboo yield</p>
                <p className="mt-1 font-semibold text-slate-900">{Number(previewSummary.tubes_per_bamboo || 0)} pcs</p>
              </div>
            </div>
          </div>
          <SpecMatrixTable
            title="Manufacturing Matrix"
            rows={manufacturingRows}
            emphasizeWeight
            rightPanel={
              <div className="grid gap-3 text-sm text-slate-700">
                <div className="rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">W / Mandrel</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{manufacturingAverages.id.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Oven Dry Wt</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">
                    {Number(bridgeMetrics.predictedDryTubeG || 0).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                  <p>Bamboo max: {specConstants?.bamboo_max_length_mm || 1560} mm</p>
                  <p>Cut loss: {specConstants?.cut_loss_mm || 40} mm</p>
                  <p>Selected bamboo: {Number(previewSummary.selected_bamboo_length_mm || 0).toFixed(0)} mm</p>
                  <p>Usable length: {Number(previewSummary.usable_length_mm || 0).toFixed(0)} mm</p>
                  <p>Guidance band: 1390 - 1560 mm</p>
                  <p>
                    Yield: floor(({Number(previewSummary.usable_length_mm || 0).toFixed(0)}) / {Number(previewSummary.tube_length_mm || 1).toFixed(0)}) ={" "}
                    {Number(previewSummary.tubes_per_bamboo || 0)}
                  </p>
                  <p>Pre-moisture target: {bridgeMetrics.preMoistureTargetTubeG.toFixed(2)} g</p>
                  <p>Wet delta: {bridgeMetrics.wetDeltaG.toFixed(2)} g</p>
                </div>
              </div>
            }
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-weight-bridge">
        <SectionLabel
          title="Weight Bridge"
          subtitle="Target dry -> wet divisor 0.905 -> pre-oven target -> predicted dry."
        />
        <div className="grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Target Dry / Tube</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{Number(form.averages.weight || 0).toFixed(2)} g</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Drying % Used</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{Number(previewSummary.drying_percent_used || 0).toFixed(2)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Pre-Oven Divisor</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{Number(previewSummary.pre_oven_divisor || 0).toFixed(4)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Pre-Oven Target</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{Number(previewSummary.pre_moisture_target_tube_g || 0).toFixed(2)} g</p>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700">Predicted Dry / Tube</p>
            <p className="mt-1 text-xl font-bold text-cyan-900">{Number(previewSummary.predicted_dry_tube_g || 0).toFixed(2)} g</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-4">
          <p>
            <span className="font-semibold">Delta vs target:</span>{" "}
            {(Number(previewSummary.predicted_dry_tube_g || 0) - Number(form.averages.weight || 0)).toFixed(2)} g
          </p>
          <p>
            <span className="font-semibold">Weight band:</span>{" "}
            {weightBand.min.toFixed(2)} - {weightBand.max.toFixed(2)} g
          </p>
          <p>
            <span className="font-semibold">Backend verified:</span>{" "}
            {Number(previewSummary.predicted_dry_tube_g || 0).toFixed(2)} g
          </p>
          <p>
            <span className="font-semibold">Bamboo yield:</span> {Number(previewSummary.tubes_per_bamboo || 0)} / bamboo
          </p>
        </div>
        <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm md:grid-cols-2">
          <p className="font-semibold text-slate-800">{weightStatusMessage}</p>
          <p className={csGateFailed ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
            {csGateFailed ? "CS gate failed: latest approved trial CS is below required." : "CS gate: pass (or no approved trial recorded)."}
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]" id="sheet-notch-tooling">
        <div className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <SectionLabel title="Notch + Tooling + Setup" subtitle="Master-linked tooling fields that carry into the job card and print sheet." />
          <MasterLinkRow links={[{ href: "/masters/tools", label: "Open tools" }, { href: "/masters/mandrels", label: "Mandrel setup" }]} />
          <div className="grid gap-3 md:grid-cols-3">
            {renderScalarField("tube_direction", "Tube Direction")}
            {renderScalarField("notch_type", "Notch Type")}
            {renderScalarField("notch_position", "Notch Position")}
            {renderScalarField("notch_distance_mm", "Notch Distance", "number", "Expected notch distance mm")}
            {renderScalarField("notch_depth_mm", "Notch Depth", "number", "Expected notch depth mm")}
            {renderScalarField("tochha", "Tochha")}
            {renderScalarField("tochha_type", "Tochha Type")}
            {renderScalarField("notching_holder", "Notching Holder")}
            {renderScalarField("notching_blade", "Notching Blade")}
            {renderScalarField("groove", "Groove")}
            {renderScalarField("punch", "Punch")}
            {renderScalarField("die", "Die")}
            {renderScalarField("wider_tool", "WIDER TOOL")}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderScalarField("height_gauge_go", "Height Gauge GO", "number")}
            {renderScalarField("height_gauge_no_go", "Height Gauge NO GO", "number")}
          </div>
        </div>
        <div className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <NotchDiagramPanel
            data={computedNotchDiagram}
            editable={isEditable}
            onNotchDistanceChange={(value) => updateDynamicValue("notch_distance_mm", String(roundValue(value, 2)))}
            onNotchDepthChange={(value) => updateDynamicValue("notch_depth_mm", String(roundValue(value, 2)))}
          />
          {isEditable ? (
            <div className="space-y-3" data-print-hidden="true">
              <div className="space-y-1">
                <FieldLabel>Diagram Title</FieldLabel>
                <input
                  type="text"
                  value={form.notchDiagram.title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notchDiagram: { ...current.notchDiagram, title: event.target.value },
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Tube Length</p>
                  <p className="mt-1 font-semibold text-slate-900">{tubeLengthMm.toFixed(2)} mm</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notch Distance</p>
                  <p className="mt-1 font-semibold text-slate-900">{computedNotchDiagram.notchDistanceMm.toFixed(2)} mm</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notch Depth</p>
                  <p className="mt-1 font-semibold text-slate-900">{computedNotchDiagram.notchDepthMm.toFixed(2)} mm</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]" id="sheet-packing">
        <div className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <SectionLabel title="Packing Division" subtitle="Packing references and labels that flow into the dispatch sheet." />
          <MasterLinkRow links={[{ href: "/masters/parchments", label: "Parchments" }, { href: "/masters/packaging", label: "Packaging master" }]} />
          <div className="grid gap-3 md:grid-cols-2">
            {renderScalarField("box_code", "Box Code")}
            {renderScalarField("box_size", "Box Size")}
            {renderScalarField("qty_per_box", "Qty / Box", "number")}
            {renderScalarField("plastic_required", "Plastic")}
            {renderScalarField("plastic_sku", "Plastic SKU")}
            {renderScalarField("plastic_per_box", "Plastic / Box", "number")}
            {renderScalarField("fadda_sku", "Fadda SKU")}
            {renderScalarField("fadda_per_box", "Fadda / Box", "number")}
            {renderScalarField("bopp_required", "BOPP")}
          </div>
          <div className="grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-3">
            <p><span className="font-semibold text-slate-900">Bundle Type:</span> {optionValue(form.dynamicValues.bundle_type) || "--"}</p>
            <p><span className="font-semibold text-slate-900">Bundle Code:</span> {optionValue(form.dynamicValues.bundle_code) || "--"}</p>
            <p><span className="font-semibold text-slate-900">Packing Pcs:</span> {optionValue(form.dynamicValues.packing_pcs) || "--"}</p>
          </div>
          <div className="space-y-1">
            <FieldLabel>Special Instructions</FieldLabel>
            <textarea
              value={optionValue(form.dynamicValues.special_instructions)}
              onChange={(event) => updateDynamicValue("special_instructions", event.target.value)}
              disabled={!isEditable}
              rows={4}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:bg-slate-100"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <SectionLabel title="Packing Snapshot" subtitle="Workbook fields only; execution detail is captured in job card entry." />
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <span className="font-semibold">Bundle Type:</span> {optionValue(form.dynamicValues.bundle_type) || "--"}
            </p>
            <p>
              <span className="font-semibold">Bundle Code:</span> {optionValue(form.dynamicValues.bundle_code) || "--"}
            </p>
            <p>
              <span className="font-semibold">Packing Ply:</span> {optionValue(form.dynamicValues.packing_ply) || "--"}
            </p>
            <p>
              <span className="font-semibold">Qty / Box:</span> {optionValue(form.dynamicValues.qty_per_box) || "--"}
            </p>
            <p>
              <span className="font-semibold">Packing Pcs:</span> {optionValue(form.dynamicValues.packing_pcs) || "--"}
            </p>
            <p>
              <span className="font-semibold">Box Code:</span> {optionValue(form.dynamicValues.box_code || form.dynamicValues.box) || "--"}
            </p>
            <p>
              <span className="font-semibold">Box Size:</span> {optionValue(form.dynamicValues.box_size) || "--"}
            </p>
            <p>
              <span className="font-semibold">Plastic:</span> {boolFromString(form.dynamicValues.plastic_required) ? "Yes" : "No"}
            </p>
            <p>
              <span className="font-semibold">Plastic SKU:</span> {optionValue(form.dynamicValues.plastic_sku) || "--"}
            </p>
            <p>
              <span className="font-semibold">Plastic / Box:</span> {optionValue(form.dynamicValues.plastic_per_box) || "--"}
            </p>
            <p>
              <span className="font-semibold">Fadda SKU:</span> {optionValue(form.dynamicValues.fadda_sku) || "--"}
            </p>
            <p>
              <span className="font-semibold">Fadda / Box:</span> {optionValue(form.dynamicValues.fadda_per_box) || "--"}
            </p>
            <p>
              <span className="font-semibold">BOPP:</span> {boolFromString(form.dynamicValues.bopp_required) ? "Yes" : "No"}
            </p>
          </div>
          <div className="space-y-1">
            <FieldLabel>Packing Remarks / Notes</FieldLabel>
            <textarea
              value={optionValue(form.dynamicValues.special_instructions)}
              onChange={(event) => updateDynamicValue("special_instructions", event.target.value)}
              disabled={!isEditable}
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:bg-slate-100"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-recipe">
        <SectionLabel title="Best Combination" subtitle="Recipe calibration workbench; rows expand into actual backend layers." />
        <MasterLinkRow links={[{ href: "/masters/papers", label: "Open papers" }, { href: "/masters/adhesives", label: "Open adhesives" }]} />
        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recipe to follow</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Weight / Tube</p>
                <p className="mt-1 font-semibold text-slate-900">{liveDryTube.toFixed(2)} g dry</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Wet / Dry</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {liveWetTube.toFixed(2)} / {liveDryTube.toFixed(2)} g
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Dry Delta</p>
                <p className="mt-1 font-semibold text-slate-900">{liveDryDelta.toFixed(2)} g</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">No recipe applied yet. Apply a suggestion or build a fresh recipe here.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="spec-sheet-live-builder">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Live builder</p>
            <p className="mt-2 text-sm text-slate-600">Apply a suggestion or build a fresh recipe here.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <p className="text-xs text-slate-500">Live paper total</p>
                <p className="mt-1 font-semibold text-slate-900">{livePaperTotal.toFixed(2)} g</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <p className="text-xs text-slate-500">One bamboo yield</p>
                <p className="mt-1 font-semibold text-slate-900">{Number(previewSummary.tubes_per_bamboo || 0)} pcs</p>
              </div>
            </div>
          </div>
        </section>
        <div className="overflow-x-auto rounded-2xl border border-slate-300">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-[11px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="border-b border-r border-slate-300 px-2 py-2 text-left">Code</th>
                <th className="border-b border-r border-slate-300 px-2 py-2 text-left">Variety</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">GSM</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Category</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">BF / Ply</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Thick / Ply</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Ply Bond</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Weight All Ply</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Ply</th>
                <th className="border-b border-r border-slate-300 px-2 py-2">Ply No.</th>
                {isEditable ? <th className="border-b border-slate-300 px-2 py-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {form.recipeRows.map((row, rowIndex) => {
                const previewRow = Array.isArray(previewSummary.ply_details) ? previewSummary.ply_details.find((item: any) => item.paper_id === row.paper_id && Number(item.gsm || 0) === Number(paperMap.get(row.paper_id)?.gsm || 0)) : null
                return (
                  <tr key={row.id}>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-xs font-semibold">{row.code || "-"}</td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 min-w-48">
                      {isEditable ? (
                        <select
                          value={row.paper_id}
                          onChange={(event) => updateRecipeRow(row.id, { paper_id: event.target.value })}
                          className="h-9 w-full rounded-lg border border-slate-300 px-2 text-xs"
                        >
                          <option value="">Select paper</option>
                          {(papers || []).map((paper: any) => (
                            <option key={paper.id} value={paper.id}>
                              {paper.code || "NO-CODE"} | {paper.variety || paper.category} | {paper.gsm} GSM | BF {paper.bf ?? paper.strength_value ?? 0}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span>{row.variety || "-"}</span>
                      )}
                    </td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">{previewRow?.gsm || 0}</td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">{row.category || "-"}</td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">
                      {isEditable ? (
                        <input
                          type="number"
                          step="0.01"
                          value={optionValue(row.bfPerPly)}
                          onChange={(event) => updateRecipeRow(row.id, { bfPerPly: Number(event.target.value || 0) })}
                          className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-xs"
                        />
                      ) : (
                        row.bfPerPly.toFixed(2)
                      )}
                    </td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">
                      {isEditable ? (
                        <input
                          type="number"
                          step="0.0001"
                          value={optionValue(row.thicknessPerPly)}
                          onChange={(event) => updateRecipeRow(row.id, { thicknessPerPly: Number(event.target.value || 0) })}
                          className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-xs"
                        />
                      ) : (
                        row.thicknessPerPly.toFixed(4)
                      )}
                    </td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">
                      {isEditable ? (
                        <input
                          type="number"
                          step="0.01"
                          value={optionValue(row.plyBond)}
                          onChange={(event) => updateRecipeRow(row.id, { plyBond: Number(event.target.value || 0) })}
                          className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-xs"
                        />
                      ) : (
                        row.plyBond.toFixed(2)
                      )}
                    </td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center font-semibold">{Number(previewRow?.weightG || 0).toFixed(2)}</td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">
                      {isEditable ? (
                        <input
                          data-testid={rowIndex === 0 ? "spec-sheet-recipe-ply-1" : undefined}
                          type="number"
                          min="1"
                          step="1"
                          value={optionValue(row.plyCount)}
                          onChange={(event) => updateRecipeRow(row.id, { plyCount: Math.max(1, Number(event.target.value || 1)) })}
                          className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-xs"
                        />
                      ) : (
                        row.plyCount
                      )}
                    </td>
                    <td className="border-r border-t border-slate-200 px-2 py-2 text-center">
                      {isEditable ? (
                        <input
                          type="text"
                          value={row.positionsText}
                          onChange={(event) => updateRecipeRow(row.id, { positionsText: event.target.value })}
                          placeholder={encodePlyPositions(parsePlyPositions(row.positionsText, row.plyCount))}
                          className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-xs"
                        />
                      ) : (
                        row.positionsText || encodePlyPositions(parsePlyPositions(row.positionsText, row.plyCount))
                      )}
                    </td>
                    {isEditable ? (
                      <td className="border-t border-slate-200 px-2 py-2 text-center">
                        <button type="button" onClick={() => removeRecipeRow(row.id)} className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700">
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold text-slate-800">
                <td className="border-t border-slate-300 px-2 py-2" colSpan={2}>TOTAL-ALL-PLY</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{recipePreview.totalAllPlyGsm}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">-</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{recipePreview.totalAllPlyBf.toFixed(2)}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{recipePreview.totalAllPlyThickness.toFixed(4)}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{recipePreview.totalAllPlyBond.toFixed(2)}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{Number(previewSummary.paper_total_g || 0).toFixed(2)}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">{recipePreview.totalPlyCount}</td>
                <td className="border-t border-slate-300 px-2 py-2 text-center">-</td>
                {isEditable ? <td className="border-t border-slate-300 px-2 py-2 text-center">-</td> : null}
              </tr>
            </tbody>
          </table>
        </div>
        {isEditable ? (
          <div className="flex justify-end" data-print-hidden="true">
            <button type="button" onClick={addRecipeRow} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">
              Add Recipe Row
            </button>
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-1">
            <FieldLabel>Recipe Notes</FieldLabel>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              disabled={!isEditable}
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-slate-300 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Paper Suggestions</p>
            <p className="text-xs text-slate-600">
              Suggestions are non-blocking. They use current paper master plus target wet weight math.
            </p>
            <div className="space-y-2">
              {recipeSuggestions.length === 0 ? (
                <p className="text-xs text-slate-500">Add tube dimensions and paper master data to generate suggestions.</p>
              ) : (
                recipeSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    data-testid={`spec-sheet-suggestion-${suggestion.id}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-xs"
                  >
                    <p className="font-semibold text-slate-800">{suggestion.title}</p>
                    <p className="mt-1 text-slate-600">
                      Paper target: {safeNumber(suggestion.predictedPaperWeightG).toFixed(2)} g
                    </p>
                    <p className={Math.abs(safeNumber(suggestion.deltaG)) <= 3 ? "text-emerald-700" : "text-amber-700"}>
                      Delta: {safeNumber(suggestion.deltaG) > 0 ? "+" : ""}
                      {safeNumber(suggestion.deltaG).toFixed(2)} g
                    </p>
                    <p className="text-slate-500">
                      Dry/Wet: {safeNumber(suggestion.predictedDryTubeG).toFixed(2)} g / {safeNumber(suggestion.predictedWetTubeG).toFixed(2)} g
                    </p>
                    {isEditable ? (
                      <button
                        type="button"
                        onClick={() => applyRecipeSuggestion(suggestion)}
                        className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800"
                      >
                        Apply Mix
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-glue">
        <SectionLabel title="Glue / Adhesive Mix" subtitle="2-3 components. Each component = paper × (base % / 100) × (ratio % / 100)." />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <FieldLabel>Glue Base % (Default)</FieldLabel>
            <input
              type="number"
              step="0.1"
              value="15"
              disabled
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Wet Divisor</FieldLabel>
            <input
              type="text"
              value={`1 - (${Number(form.shrinkPercent || 9.5).toFixed(1)} / 100) = ${(1 - Number(form.shrinkPercent || 9.5) / 100).toFixed(3)}`}
              disabled
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Parchment %</FieldLabel>
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              Fixed at 1.5% for recipe math. Sales order chooses the actual parchment vendor and pattern.
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <p>Name</p>
            <p>Base %</p>
            <p>Ratio %</p>
            <p className="text-right">Action</p>
          </div>
          {form.adhesiveComponents.map((component, index) => (
            <div key={`${component.name}-${index}`} className="grid grid-cols-[1.3fr_0.7fr_0.7fr_auto] gap-2">
              {isEditable ? (
                <select
                  value={component.name}
                  onChange={(event) => updateAdhesiveComponent(index, { name: event.target.value })}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select adhesive</option>
                  {Array.from(
                    new Set(
                      [
                        ...form.adhesiveComponents.map((row) => row.name).filter(Boolean),
                        ...((adhesives || []) as any[]).map((adhesive) =>
                          adhesive.internal_code ? `${adhesive.name} (${adhesive.internal_code})` : adhesive.name,
                        ),
                      ].filter(Boolean),
                    ),
                  ).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex h-10 items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800">
                  {component.name || "-"}
                </div>
              )}
              <input
                type="number"
                step="0.1"
                value={optionValue(form.dynamicValues.glue_base_percent || "15")}
                disabled
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
              />
              <input
                type="number"
                step="0.1"
                value={optionValue(component.ratio_percent)}
                onChange={(event) => updateAdhesiveComponent(index, { ratio_percent: Number(event.target.value || 0) })}
                disabled={!isEditable}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
              />
              <div className="flex items-center justify-end gap-2">
                {isEditable ? (
                  <button
                    type="button"
                    onClick={() => removeAdhesiveComponent(index)}
                    disabled={form.adhesiveComponents.length <= 2}
                    className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {isEditable ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addAdhesiveComponent}
                disabled={form.adhesiveComponents.length >= 3}
                className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 disabled:opacity-50"
              >
                Add Component
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 rounded-2xl border border-slate-300 bg-slate-50 p-4 md:grid-cols-3">
          <p><span className="font-semibold">Paper Weight:</span> {Number(previewSummary.paper_total_g || 0).toFixed(2)} g</p>
          <p><span className="font-semibold">Total Adhesive:</span> {bridgeMetrics.adhesiveTotalG.toFixed(2)} g</p>
          <p><span className="font-semibold">Parchment Weight:</span> {Number(previewSummary.parchment_weight_g || 0).toFixed(2)} g</p>
          {bridgeMetrics.adhesiveComponents.map((component: any, index: number) => (
            <p key={`${component.name || "component"}-${index}`}>
              <span className="font-semibold">{component.name || `Adhesive ${index + 1}`}:</span> {Number(component.weight_g || 0).toFixed(2)} g
            </p>
          ))}
          <p><span className="font-semibold">Predicted Wet / Tube:</span> {bridgeMetrics.predictedWetTubeG.toFixed(2)} g</p>
          <p><span className="font-semibold">Predicted Dry / Tube:</span> {bridgeMetrics.predictedDryTubeG.toFixed(2)} g</p>
          <p><span className="font-semibold">Weight / mm:</span> {bridgeMetrics.weightPerMmG.toFixed(4)} g/mm</p>
          <p><span className="font-semibold">Bamboo Wet Target:</span> {bridgeMetrics.bambooRequiredWetG.toFixed(2)} g</p>
          <p><span className="font-semibold">Wet Delta:</span> {bridgeMetrics.wetDeltaG.toFixed(2)} g</p>
          <p><span className="font-semibold">Dry Delta:</span> {bridgeMetrics.dryDeltaG.toFixed(2)} g</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-guidance">
        <SectionLabel title="Drying Reference" subtitle={`Default drying loss is 9.5%. Active guide row: ${selectedGuidance?.rh || "-"}`} />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Drying % Used</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{Number(form.shrinkPercent || 9.5).toFixed(1)}%</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Predicted Wet</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{bridgeMetrics.predictedWetTubeG.toFixed(2)} g</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Predicted Dry</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{bridgeMetrics.predictedDryTubeG.toFixed(2)} g</p>
          </div>
        </div>
        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Open RH / moisture reference table</summary>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-300 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="border-b border-r border-slate-300 px-3 py-2 text-left">RH %</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2">% Drying</th>
                  <th className="border-b border-slate-300 px-3 py-2">Moisture %</th>
                </tr>
              </thead>
              <tbody>
                {form.processGuidance.map((row, index) => (
                  <tr key={`${row.rh}-${index}`} className={index === form.selectedGuidanceIndex ? "bg-amber-50" : ""}>
                    <td className="border-r border-t border-slate-200 px-3 py-2 font-semibold">{row.rh}</td>
                    <td className="border-r border-t border-slate-200 px-3 py-2 text-center">{row.dryingPercent}%</td>
                    <td className="border-t border-slate-200 px-3 py-2 text-center">{row.moistureBand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-trials">
        <SectionLabel title="Trial Calibration" subtitle="Record floor trial feedback against the predicted output." />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <FieldLabel>Actual Weight</FieldLabel>
            <input
              type="number"
              step="0.01"
              value={form.trial.actualWeight}
              onChange={(event) => setForm((current) => ({ ...current, trial: { ...current.trial, actualWeight: event.target.value } }))}
              disabled={!isEditable}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Actual CS</FieldLabel>
            <input
              type="number"
              step="0.01"
              value={form.trial.actualCs}
              onChange={(event) => setForm((current) => ({ ...current, trial: { ...current.trial, actualCs: event.target.value } }))}
              disabled={!isEditable}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Actual Shrink</FieldLabel>
            <input
              type="number"
              step="0.01"
              value={form.trial.actualShrink}
              onChange={(event) => setForm((current) => ({ ...current, trial: { ...current.trial, actualShrink: event.target.value } }))}
              disabled={!isEditable}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.trial.approved}
              onChange={(event) => setForm((current) => ({ ...current, trial: { ...current.trial, approved: event.target.checked } }))}
              disabled={!isEditable}
              className="h-4 w-4 rounded border-slate-300"
            />
            Trial Approved
          </label>
        </div>
        <div className="mt-3 space-y-1">
          <FieldLabel>Remarks</FieldLabel>
          <textarea
            value={form.trial.remarks}
            onChange={(event) => setForm((current) => ({ ...current, trial: { ...current.trial, remarks: event.target.value } }))}
            disabled={!isEditable}
            rows={3}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:bg-slate-100"
          />
        </div>
        {isEditable ? (
          <div className="mt-3 flex flex-wrap gap-2" data-print-hidden="true">
            <button
              type="button"
              onClick={handleRecordTrial}
              disabled={recordTrial.isPending || !specDocument?.latestRecipe?.id}
              className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-60"
            >
              Record Trial
            </button>
            {form.trial.actualShrink ? (
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, shrinkPercent: current.trial.actualShrink }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Use Latest Trial Shrink
              </button>
            ) : null}
          </div>
        ) : null}
        {latestApprovedTrial ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold">Latest Trial</p>
            <p className="mt-1">Weight: {Number(latestApprovedTrial.actual_weight || 0).toFixed(2)} g</p>
            <p>CS: {Number(latestApprovedTrial.actual_cs || 0).toFixed(2)}</p>
            <p>Shrink: {Number(latestApprovedTrial.actual_shrink || 0).toFixed(2)}%</p>
            <p className="mt-1 text-xs text-slate-500">{new Date(latestApprovedTrial.tested_at).toLocaleString()}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm" id="sheet-validation">
        <SectionLabel title="Validation" subtitle="Footer block for print and controlled release." />
        <div className="grid gap-3 md:grid-cols-5">
          {renderScalarField("valid_upto", "Valid Upto")}
          {renderScalarField("prepared_by", "Prepared By")}
          {renderScalarField("prepared_date", "Prepared Date")}
          <div className="space-y-1">
            <FieldLabel>Version</FieldLabel>
            <div className="h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              v{specDocument?.spec?.version || 1}
            </div>
          </div>
          {renderScalarField("sign_off_note", "Sign")}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">Release checks</p>
            <p className={effectiveBalance.withinBand ? "mt-2 text-emerald-700" : "mt-2 text-rose-700"}>
              Weight: {weightStatusMessage}
            </p>
            <p className={csGateFailed ? "text-rose-700" : "text-emerald-700"}>
              CS: {csGateFailed ? "latest approved trial is below required CS" : "pass"}
            </p>
            <p className={footerComplete ? "text-emerald-700" : "text-amber-700"}>
              Footer: {footerComplete ? "complete" : "incomplete"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm md:col-span-2">
            <p className="font-semibold text-slate-900">Footer completeness</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {footerValidation.map((field) => (
                <div key={field.key} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                  <span className="text-slate-700">{field.label}</span>
                  <span className={field.filled ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                    {field.filled ? "Filled" : "Required"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
    </div>
  )
}
