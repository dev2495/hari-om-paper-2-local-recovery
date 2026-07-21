"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { NotchDiagramPanel } from "@/components/specs/NotchDiagramPanel"
import { SpecSheetPrint } from "@/components/specs/print/SpecSheetPrint"
import { SpecSheetWorkspace } from "@/components/specs/SpecSheetWorkspace"
import { ClientReqCard } from "@/components/specs/sections/ClientReqCard"
import { NotchingCard } from "@/components/specs/sections/NotchingCard"
import { PackingCard } from "@/components/specs/sections/PackingCard"
import { RecipeMixCard } from "@/components/specs/sections/RecipeMixCard"
import { TubeCalcCard } from "@/components/specs/sections/TubeCalcCard"
import { ValidationFooter } from "@/components/specs/sections/ValidationFooter"
import { NumericInput } from "@/components/specs/shared/NumericInput"
import { PaperPicker } from "@/components/specs/shared/PaperPicker"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { displayPlantScope } from "@/lib/plant-scope"
import { DELTA_ABS_G, RECIPE_MAX_PAPERS, RECIPE_MAX_PLIES, RECIPE_MIN_PAPERS } from "@/lib/spec-math"
import {
  useAdhesives,
  useCustomers,
  useMandrels,
  usePackagingBoxes,
  usePackagingFadda,
  usePackagingPlasticSheets,
  usePapers,
  useParchments,
  useLogToolUsage,
  useToolOptions,
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
  useSpecDefaults,
  useSpecFields,
  useSpecSheetPreview,
  useSpecSheetDocument,
  useSubmitSpecForReview,
  useUpdateSpecSheet,
} from "@/hooks/use-specs"
import {
  AdhesiveComponent,
  AverageValues,
  adhesiveRatioTotal,
  applyPaperMasterToRecipeRow,
  buildAdhesiveComponentsPayload,
  buildDynamicFieldsPayload,
  buildGroupedRowLabel,
  clamp,
  DEFAULT_MOISTURE_AVG,
  DEFAULT_PROCESS_GUIDANCE,
  DEFAULT_SPEC_FIELD_DEFINITIONS,
  DEFAULT_TOLERANCE_BANDS,
  NOTCH_TOOL_FIELD_CATEGORY_MAP,
  deriveRanges,
  DynamicFieldValue,
  encodePlyPositions,
  formatRecipeRowsTitle,
  GroupedRecipeRow,
  isAdhesiveRatioBalanced,
  isMasterOptionActive,
  isTubeWithinMandrelBand,
  midpoint,
  parseAdhesiveComponents,
  parseDynamicFields,
  parseJsonField,
  parsePlyPositions,
  ProcessGuidanceRow,
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
  parchmentAllowed: boolean
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
    parchmentAllowed: true,
    averages: {
      id: 0,
      od: 0,
      length: 0,
      weight: 0,
      cs: 0,
      moisture: DEFAULT_MOISTURE_AVG,
    },
    shrinkPercent: "9.0",
    parchmentPercent: "1.5",
    parchmentColor: "",
    adhesive20100: "30",
    adhesive30100: "70",
    adhesiveComponents: [
      { name: "TL-4 (20100)", base_percent: 12.5, ratio_percent: 30 },
      { name: "Vinsol (30100)", base_percent: 12.5, ratio_percent: 70 },
    ],
    notes: "",
    recipeRows: [blankRecipeRow(nextRecipeRowSeed())],
    dynamicValues: {
      glue_mode: "standard",
      glue_base_percent: "12.5",
      measured_finished_dry_g: "",
      drying_percent_override: "",
      fill_instructions_version: CANONICAL_VARIANT_KEY,
      winder_tool_required: "false",
      plastic_required: "false",
      bopp_required: "false",
      notch_direction: "",
      notch_type: "",
      notching_blade: "",
      notching_holder: "",
      v_flat: "",
      punch: "",
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

function adhesiveMasterLabel(master: any) {
  const name = String(master?.name || master?.variety || "").trim()
  const code = String(master?.internal_code || "").trim()
  return code ? `${name} (${code})` : name
}

function normalizeRecipeRows(rows: GroupedRecipeRow[]) {
  return (rows || []).map((row, index) => ({
    ...row,
    id: `recipe-row-${nextRecipeRowSeed()}-${index + 1}`,
    plyCount: Math.max(1, Number(row?.plyCount || 1)),
    positionsText: String(row?.positionsText || ""),
  }))
}

function adhesiveReferenceTokens(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .match(/[A-Z]+|\d{4,}/g) || []
}

function findAdhesiveMaster(component: AdhesiveComponent, masters: any[]) {
  const byId = masters.find((master) => String(master?.id || "") === String(component.adhesive_id || ""))
  if (byId) return byId
  const componentTokens = new Set(adhesiveReferenceTokens(component.name))
  return masters.find((master) => {
    const label = adhesiveMasterLabel(master)
    if (label.toUpperCase() === String(component.name || "").toUpperCase()) return true
    return adhesiveReferenceTokens(`${master?.name || master?.variety || ""} ${master?.internal_code || ""}`)
      .some((token) => /^\d{4,}$/.test(token) && componentTokens.has(token))
  })
}

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-[#dfe7e4] pb-2">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#173b47]">{title}</h2>
      {subtitle ? <p className="text-[11px] text-slate-500">{subtitle}</p> : null}
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
          className="rounded-md border border-[#d6dfdc] bg-[#f8faf9] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 transition hover:border-[#9db7b0] hover:bg-white"
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{children}</label>
}

type SmartSelectOption = {
  value: string
  label: string
  meta?: string
  search?: string
}

function SmartSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
  testId,
  emptyLabel = "No active options found.",
}: {
  value: string
  options: SmartSelectOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
  testId?: string
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value])
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      [option.label, option.meta, option.search].filter(Boolean).join(" ").toLowerCase().includes(needle),
    )
  }, [options, query])

  return (
    <div className="relative">
      <button
        data-testid={testId}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-[#ccd8d5] bg-white px-3 text-left text-sm font-medium text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-[#8eaaa3] disabled:cursor-not-allowed disabled:bg-[#f2f5f4] disabled:text-slate-500"
      >
        <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
        <span className="shrink-0 text-xs font-semibold text-slate-400">v</span>
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[min(460px,92vw)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false)
              }}
              placeholder={`Search ${placeholder.toLowerCase()}`}
              className="h-10 w-full rounded-lg border border-[#cfd9e6] bg-slate-50 px-3 text-sm outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">{emptyLabel}</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setQuery("")
                    setOpen(false)
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-emerald-50 hover:text-emerald-900"
                >
                  <span className="block font-semibold">{option.label}</span>
                  {option.meta ? <span className="block text-xs text-slate-500">{option.meta}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string
  value: string
  detail?: string
  tone?: "default" | "accent" | "success"
}) {
  const toneClass =
    tone === "accent"
      ? "border-[#ead39b] bg-[#fbf1d9]"
      : tone === "success"
        ? "border-[#b9e4d1] bg-[#e4f6ed]"
        : "border-[#dce4e1] bg-white"

  return (
    <div className={`min-w-0 rounded-xl border px-3 py-3 ${toneClass}`}>
      <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-1.5 break-words text-xl font-black tracking-[-0.035em] text-[#102832]">{value}</p>
      {detail ? <p className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</p> : null}
    </div>
  )
}

function boolFromString(value: string | undefined) {
  const normalized = String(value || "false").trim().toLowerCase()
  return ["true", "yes", "y", "1"].includes(normalized)
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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, value])

  return debouncedValue
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

function ParameterTableCard({
  title,
  subtitle,
  columns,
  rows,
}: {
  title: string
  subtitle?: string
  columns: string[]
  rows: Array<{ label: string; values: Array<string | number> }>
}) {
  return (
    <div className="overflow-hidden rounded-[30px] border border-[#d9e2ef] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className="border-b border-[#d9e2ef] px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{title}</p>
        {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#d8dde6] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
            <tr>
              <th className="border-b border-[#d9e2ef] px-6 py-4 text-left">Parameter</th>
              {columns.map((column) => (
                <th key={column} className="border-b border-[#d9e2ef] px-6 py-4 text-right">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-[#edf2f7] last:border-b-0">
                <td className="px-6 py-4 font-semibold text-slate-900">{row.label}</td>
                {row.values.map((value, index) => (
                  <td
                    key={`${row.label}-${index}`}
                    className={`px-6 py-4 text-right text-slate-700 ${index === 1 ? "font-black text-slate-950" : ""}`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SpecSheetDocument({ mode, specId }: SpecSheetDocumentProps) {
  const router = useRouter()
  const { showToast } = useApp()
  const { user, activePlant } = useAuth()
  const isCreate = mode === "create"
  const userRoles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean)), [user?.role, user?.roles])
  const canManageSpec = userRoles.has("Owner") || userRoles.has("Admin")
  const canApproveAsSuperUser = userRoles.has("Owner") || userRoles.has("Admin")
  const hasConcreteWritePlant = Boolean(activePlant && activePlant !== "ALL")
  const editBlockReason = !canManageSpec
    ? "Only Owner and Admin can edit specification sheets."
    : !hasConcreteWritePlant
      ? "Pick one plant in the top switcher before creating or editing a specification."
      : null
  const isPrint = mode === "print"

  const [form, setForm] = useState<FormState>(() => defaultFormState())
  const [loadedSpecSignature, setLoadedSpecSignature] = useState<string | null>(null)
  const [catalogBootstrapped, setCatalogBootstrapped] = useState(false)
  const [defaultsBootstrappedForPlant, setDefaultsBootstrappedForPlant] = useState<string | null>(null)
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
  const { data: toolMasterOptions } = useToolOptions()
  const { data: specConstants } = useSpecConstants()
  const { data: specDefaults } = useSpecDefaults(hasConcreteWritePlant ? activePlant : null)
  const { data: specFields, isSuccess: specFieldsLoaded } = useSpecFields()
  const { data: specDocument, isLoading: isLoadingDocument } = useSpecSheetDocument(specId || "")
  const isEditable =
    (mode === "create" || mode === "edit") &&
    !editBlockReason &&
    specDocument?.spec?.status !== "review"

  const ensureCatalog = useEnsureSpecSheetCatalog()
  const createSpecSheet = useCreateSpecSheet()
  const updateSpecSheet = useUpdateSpecSheet()
  const logToolUsage = useLogToolUsage()
  const approveSpec = useApproveSpec()
  const submitSpecForReview = useSubmitSpecForReview()
  const obsoleteSpec = useObsoleteSpec()
  const cloneSpec = useCloneSpecSheet()

  const activeCustomers = useMemo(() => ((customers || []) as any[]).filter(isMasterOptionActive), [customers])
  const activeTubeSizes = useMemo(() => ((tubeSizes || []) as any[]).filter(isMasterOptionActive), [tubeSizes])
  const activeMandrels = useMemo(() => ((mandrels || []) as any[]).filter(isMasterOptionActive), [mandrels])
  const activePapers = useMemo(() => ((papers || []) as any[]).filter(isMasterOptionActive), [papers])
  const activeAdhesives = useMemo(() => ((adhesives || []) as any[]).filter(isMasterOptionActive), [adhesives])
  const activeParchments = useMemo(() => ((parchments || []) as any[]).filter(isMasterOptionActive), [parchments])
  const activePackagingBoxes = useMemo(() => ((packagingBoxes || []) as any[]).filter(isMasterOptionActive), [packagingBoxes])
  const activePackagingPlasticSheets = useMemo(
    () => ((packagingPlasticSheets || []) as any[]).filter(isMasterOptionActive),
    [packagingPlasticSheets],
  )
  const activePackagingFadda = useMemo(() => ((packagingFadda || []) as any[]).filter(isMasterOptionActive), [packagingFadda])
  const activeTools = useMemo(() => ((tools || []) as any[]).filter(isMasterOptionActive), [tools])

  const resolvedAdhesiveComponents = useMemo(
    () =>
      form.adhesiveComponents.map((component) => {
        const master = findAdhesiveMaster(component, activeAdhesives)
        if (!master) return component
        return {
          ...component,
          adhesive_id: String(master.id || "") || undefined,
          name: adhesiveMasterLabel(master),
          solid_content_percent:
            master.solid_content_percent === null || master.solid_content_percent === undefined
              ? null
              : Number(master.solid_content_percent),
        }
      }),
    [activeAdhesives, form.adhesiveComponents],
  )

  useEffect(() => {
    if (!activeAdhesives.length) return
    const changed = resolvedAdhesiveComponents.some((component, index) => {
      const current = form.adhesiveComponents[index]
      return (
        component.adhesive_id !== current?.adhesive_id ||
        component.name !== current?.name ||
        component.solid_content_percent !== current?.solid_content_percent
      )
    })
    if (!changed) return
    setForm((current) => ({ ...current, adhesiveComponents: resolvedAdhesiveComponents }))
  }, [activeAdhesives.length, form.adhesiveComponents, resolvedAdhesiveComponents])

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
    () => new Map<string, any>(activePackagingBoxes.map((item) => [String(item.code || ""), item])),
    [activePackagingBoxes],
  )
  const packagingPlasticMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(activePackagingPlasticSheets.map((item) => [String(item.sku || ""), item])),
    [activePackagingPlasticSheets],
  )
  const packagingFaddaMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(activePackagingFadda.map((item) => [String(item.sku || ""), item])),
    [activePackagingFadda],
  )
  const fieldCatalogMap = useMemo<Map<string, any>>(
    () => new Map<string, any>(((specFields || []) as any[]).map((item) => [String(item.key), item])),
    [specFields],
  )
  const toolOptionsByCategory = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of activeTools) {
      const category = String(row?.category || "").trim().toUpperCase()
      const status = String(row?.status || "ACTIVE").trim().toUpperCase()
      const name = String(row?.name || row?.spec_text || "").trim()
      if (row?.active === false || status !== "ACTIVE") continue
      if (!category || !name) continue
      const current = map.get(category) || []
      if (!current.includes(name)) {
        current.push(name)
        map.set(category, current)
      }
    }
    return map
  }, [activeTools])

  const toolLookupByCategoryName = useMemo(() => {
    const map = new Map<string, any>()
    for (const row of activeTools) {
      const category = String(row?.category || "").trim().toUpperCase()
      const name = String(row?.name || row?.spec_text || "").trim()
      if (!category || !name) continue
      map.set(`${category}::${name.toLowerCase()}`, row)
    }
    return map
  }, [activeTools])

  const selectedNotchToolEntries = useMemo(() => {
    const entries: Array<{
      field_key: string
      label: string
      category: string
      tool_name: string
      tool_id?: string
      status?: string
    }> = []
    for (const [fieldKey, categories] of Object.entries(NOTCH_TOOL_FIELD_CATEGORY_MAP)) {
      const selectedValue = String(form.dynamicValues[fieldKey] || "").trim()
      if (!selectedValue) continue
      const definition = DEFAULT_SPEC_FIELD_DEFINITIONS.find((field) => field.field_key === fieldKey)
      for (const category of categories) {
        const normalizedCategory = String(category).trim().toUpperCase()
        const tool = toolLookupByCategoryName.get(`${normalizedCategory}::${selectedValue.toLowerCase()}`)
        entries.push({
          field_key: fieldKey,
          label: definition?.label || fieldKey,
          category: normalizedCategory,
          tool_name: selectedValue,
          tool_id: tool?.id ? String(tool.id) : undefined,
          status: tool?.status,
        })
      }
    }
    return entries
  }, [form.dynamicValues, toolLookupByCategoryName])

  const externalSelectOptionsByField = useMemo<Record<string, string[]>>(
    () => {
      const options: Record<string, string[]> = {
        box_code: activePackagingBoxes
        .map((row) => String(row?.code || "").trim())
        .filter(Boolean),
        plastic_sku: activePackagingPlasticSheets
        .map((row) => String(row?.sku || "").trim())
        .filter(Boolean),
        fadda_sku: activePackagingFadda
        .map((row) => String(row?.sku || "").trim())
        .filter(Boolean),
      }
      for (const row of (toolMasterOptions || []) as any[]) {
        const key = String(row?.field_key || "").trim()
        const value = String(row?.value || "").trim()
        if (!key || !value || row?.active === false) continue
        options[key] = Array.from(new Set([...(options[key] || []), value]))
      }
      return options
    },
    [activePackagingBoxes, activePackagingFadda, activePackagingPlasticSheets, toolMasterOptions],
  )

  const selectedCustomer = customerMap.get(form.customerId)
  const selectedTube = tubeSizeMap.get(form.tubeSizeId)
  const selectedMandrel = mandrelMap.get(form.mandrelId)
  const selectedPackagingBox = packagingBoxMap.get(optionValue(form.dynamicValues.box_code || form.dynamicValues.box))
  const selectedPackagingPlastic = packagingPlasticMap.get(optionValue(form.dynamicValues.plastic_sku))
  const selectedPackagingFadda = packagingFaddaMap.get(optionValue(form.dynamicValues.fadda_sku))
  const filteredTubeSizes = useMemo(
    () => activeTubeSizes.filter((tube) => isTubeWithinMandrelBand(tube, selectedMandrel)),
    [activeTubeSizes, selectedMandrel],
  )
  const customerOptions = useMemo<SmartSelectOption[]>(
    () =>
      activeCustomers.map((customer) => ({
        value: String(customer.id),
        label: String(customer.name || customer.customer_code || "Unnamed customer"),
        meta: customer.customer_code ? `Code ${customer.customer_code}` : undefined,
      })),
    [activeCustomers],
  )
  const mandrelOptions = useMemo<SmartSelectOption[]>(
    () =>
      activeMandrels.map((mandrel) => ({
        value: String(mandrel.id),
        label: `${mandrel.mandrel_code || mandrel.name || "Mandrel"} | OD ${Number(mandrel.outer_diameter_mm || 0)}`,
        meta: mandrel.length_mm ? `Length ${mandrel.length_mm} mm` : undefined,
        search: `${mandrel.mandrel_code || ""} ${mandrel.name || ""} ${mandrel.outer_diameter_mm || ""}`,
      })),
    [activeMandrels],
  )
  const tubeSizeOptions = useMemo<SmartSelectOption[]>(
    () =>
      filteredTubeSizes.map((tube) => ({
        value: String(tube.id),
        label: `${Number(tube.inner_diameter_mm || 0)} x ${Number(tube.outer_diameter_mm || 0)} x ${Number(tube.length_mm || 0)}`,
        meta: tube.internal_code || tube.name || undefined,
        search: `${tube.inner_diameter_mm || ""} ${tube.outer_diameter_mm || ""} ${tube.length_mm || ""} ${tube.internal_code || ""}`,
      })),
    [filteredTubeSizes],
  )
  const parchmentAllowedOptions = useMemo<SmartSelectOption[]>(
    () => [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    [],
  )
  const parchmentFamilies = useMemo(
    () =>
      Array.from(
        new Set(
          activeParchments
            .map((row) => String(row?.vendor_family || row?.vendor_name || "").trim().toUpperCase())
            .filter(Boolean),
        ),
      ),
    [activeParchments],
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
    const nextWeight = selectedBox?.weight_kg === null || selectedBox?.weight_kg === undefined ? "" : String(selectedBox.weight_kg)
    if (
      !selectedBox ||
      (optionValue(form.dynamicValues.box_size) === nextSize &&
        optionValue(form.dynamicValues.box_unit_weight_kg) === nextWeight)
    ) return

    setForm((current) => ({
      ...current,
      dynamicValues: {
        ...current.dynamicValues,
        box_code: boxCode,
        box: boxCode,
        box_size: nextSize,
        box_unit_weight_kg: nextWeight,
      },
    }))
  }, [form.dynamicValues.box, form.dynamicValues.box_code, form.dynamicValues.box_size, form.dynamicValues.box_unit_weight_kg, packagingBoxMap])

  useEffect(() => {
    const sku = optionValue(form.dynamicValues.plastic_sku)
    const selected = packagingPlasticMap.get(sku)
    const size = selected?.size_label ? String(selected.size_label) : ""
    const unitWeight = selected?.weight_kg === null || selected?.weight_kg === undefined ? "" : String(selected.weight_kg)
    const perBox = Number(form.dynamicValues.plastic_per_box || 0)
    const perBoxWeight = perBox > 0 && Number(unitWeight) >= 0 ? String(roundValue(perBox * Number(unitWeight), 4)) : ""
    const plasticRequired = Boolean(sku && perBox > 0)
    if (
      optionValue(form.dynamicValues.plastic_size) === size &&
      optionValue(form.dynamicValues.plastic_unit_weight_kg) === unitWeight &&
      optionValue(form.dynamicValues.plastic_weight_per_box_kg) === perBoxWeight &&
      boolFromString(form.dynamicValues.plastic_required) === plasticRequired
    ) return
    setForm((current) => ({
      ...current,
      dynamicValues: {
        ...current.dynamicValues,
        plastic_size: size,
        plastic_unit_weight_kg: unitWeight,
        plastic_weight_per_box_kg: perBoxWeight,
        plastic_required: plasticRequired ? "true" : "false",
      },
    }))
  }, [form.dynamicValues.plastic_per_box, form.dynamicValues.plastic_required, form.dynamicValues.plastic_size, form.dynamicValues.plastic_sku, form.dynamicValues.plastic_unit_weight_kg, form.dynamicValues.plastic_weight_per_box_kg, packagingPlasticMap])

  useEffect(() => {
    const sku = optionValue(form.dynamicValues.fadda_sku)
    const selected = packagingFaddaMap.get(sku)
    const unitWeight = selected?.weight_kg === null || selected?.weight_kg === undefined ? "" : String(selected.weight_kg)
    const perBox = Number(form.dynamicValues.fadda_per_box || 0)
    const perBoxWeight = perBox > 0 && Number(unitWeight) >= 0 ? String(roundValue(perBox * Number(unitWeight), 4)) : ""
    if (
      optionValue(form.dynamicValues.fadda_unit_weight_kg) === unitWeight &&
      optionValue(form.dynamicValues.fadda_weight_per_box_kg) === perBoxWeight
    ) return
    setForm((current) => ({
      ...current,
      dynamicValues: {
        ...current.dynamicValues,
        fadda_unit_weight_kg: unitWeight,
        fadda_weight_per_box_kg: perBoxWeight,
      },
    }))
  }, [form.dynamicValues.fadda_per_box, form.dynamicValues.fadda_sku, form.dynamicValues.fadda_unit_weight_kg, form.dynamicValues.fadda_weight_per_box_kg, packagingFaddaMap])

  const clientRanges = useMemo(() => deriveRanges(form.averages, DEFAULT_TOLERANCE_BANDS), [form.averages])
  const clientRows = useMemo(() => buildMatrixRows(form.averages, clientRanges), [form.averages, clientRanges])

  const recipeTotalWallThickness = useMemo(
    () =>
      form.recipeRows.reduce(
        (sum, row) =>
          sum +
          Number(row.thicknessPerPly || 0) *
            Math.max(1, parsePlyPositions(row.positionsText, Number(row.plyCount || 1)).length),
        0,
      ),
    [form.recipeRows],
  )

  const manufacturingAverages = useMemo(() => {
    const mandrelOd = Number(selectedMandrel?.outer_diameter_mm || 0)
    const mandrelAverageId =
      mandrelOd > 0 ? roundValue(mandrelOd, 2) : roundValue(Number(form.averages.id || 0), 2)
    const usableLength = Number(specConstants?.bamboo_max_length_mm || 1560) - Number(specConstants?.cut_loss_mm || 40)
    const recoveryFactor = 1 - Number(form.shrinkPercent || 0) / 100
    const tubeLength = Number(selectedTube?.length_mm || 0) || 1
    const targetWeight = Number(form.averages.weight || 0)

    return {
      id: mandrelAverageId,
      od:
        mandrelOd > 0
          ? roundValue(mandrelAverageId + recipeTotalWallThickness * 2, 2)
          : roundValue(Number(form.averages.od || 0), 2),
      length: roundValue(usableLength, 2),
      weight:
        targetWeight > 0
          ? roundValue((targetWeight / Math.max(recoveryFactor, 0.01)) * (usableLength / tubeLength), 2)
          : 0,
      cs: Number(specDocument?.spec?.approved_cs || form.averages.cs || 0),
      moisture: Number(form.averages.moisture || 0),
    }
  }, [form.averages, form.shrinkPercent, recipeTotalWallThickness, selectedMandrel, selectedTube, specConstants, specDocument?.spec?.approved_cs])

  const manufacturingRows = useMemo(() => {
    const avg = manufacturingAverages
    const mandrelOd = Number(selectedMandrel?.outer_diameter_mm || 0)
    const minId = mandrelOd > 0 ? roundValue(Math.max(mandrelOd - 0.1, 0), 2) : roundValue(Math.max(avg.id - 0.1, 0), 2)
    const maxId = mandrelOd > 0 ? roundValue(mandrelOd + 0.1, 2) : roundValue(avg.id + 0.1, 2)
    const max = {
      id: maxId,
      od: roundValue(maxId + recipeTotalWallThickness * 2, 2),
      length: roundValue(avg.length + 20, 2),
      weight: roundValue(avg.weight + 20, 2),
      cs: roundValue(avg.cs * 1.07, 2),
      moisture: roundValue(clamp(avg.moisture + DEFAULT_TOLERANCE_BANDS.moisture, 0, 100), 2),
    }
    const min = {
      id: minId,
      od: roundValue(minId + recipeTotalWallThickness * 2, 2),
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
  }, [manufacturingAverages, recipeTotalWallThickness, selectedMandrel])

  const recipePreview = useMemo(() => {
    const usableLength = Math.max(0, Number(specConstants?.bamboo_max_length_mm || 1560) - Number(specConstants?.cut_loss_mm || 40))
    const tubeLength = Number(selectedTube?.length_mm || 0)
    const thicknessAvg = thicknessFrom(Number(manufacturingAverages.id || 0), Number(manufacturingAverages.od || 0))
    const circumferenceDiameter = Math.max(Number(manufacturingAverages.id || 0) + Number(thicknessAvg || 0), 1)
    const circumference = 3.14 * circumferenceDiameter
    const glueMode = "workbook"
    const glueBasePct = Number(form.dynamicValues.glue_base_percent || 12.5)
    const dryingLossPercent = Number(form.shrinkPercent || 9.0)
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
    const adhesiveComponents = buildAdhesiveComponentsPayload(resolvedAdhesiveComponents, {
      tl4: Number(form.adhesive20100 || 0),
      vinsol: Number(form.adhesive30100 || 0),
      basePercent: glueBasePct,
    })
    const adhesiveRatioTotal = adhesiveComponents.reduce(
      (sum, component) => sum + Number(component.ratio_percent || 0),
      0,
    )
    const totalAdhesiveWeightG = Number(form.averages.weight || 0) *
      (Math.max(glueBasePct - (form.parchmentAllowed ? Number(form.parchmentPercent || 0) : 0), 0) / 100)
    const componentWeights = adhesiveComponents.map((component) => {
      const weightG = adhesiveRatioTotal > 0
        ? totalAdhesiveWeightG * (Number(component.ratio_percent || 0) / adhesiveRatioTotal)
        : 0
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
    const parchmentWeightG = form.parchmentAllowed
      ? Number(form.averages.weight || 0) * (Number(form.parchmentPercent || 0) / 100)
      : 0
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
    resolvedAdhesiveComponents,
    form.adhesive20100,
    form.adhesive30100,
    form.averages.weight,
    form.shrinkPercent,
    form.dynamicValues.glue_base_percent,
    form.parchmentAllowed,
    form.parchmentPercent,
    form.recipeRows,
    manufacturingAverages.id,
    manufacturingAverages.od,
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

  const previewTubeLengthMm = Number(selectedTube?.length_mm || form.averages.length || 0)
  const previewTubeOdMm = Number(manufacturingAverages.od || selectedTube?.outer_diameter_mm || form.averages.od || 0)
  const previewTubeIdMm = Number(manufacturingAverages.id || form.averages.id || selectedTube?.inner_diameter_mm || 0)
  const targetDryWeightG = Number(form.averages.weight || 0)
  const dryingPercent = Number(form.shrinkPercent || 9.0)
  const parchmentPercent = Number(form.parchmentPercent || 1.5)
  const adhesivePercent = Number(form.dynamicValues.glue_base_percent || 12.5)
  const previewRecipeRows = useMemo(
    () =>
      form.recipeRows.map((row) => ({
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
    [form.recipeRows, paperMap],
  )
  const previewAdhesiveComponents = useMemo(
    () =>
      buildAdhesiveComponentsPayload(resolvedAdhesiveComponents, {
        tl4: Number(form.adhesive20100 || 0),
        vinsol: Number(form.adhesive30100 || 0),
        basePercent: adhesivePercent,
      }),
    [adhesivePercent, form.adhesive20100, form.adhesive30100, resolvedAdhesiveComponents],
  )
  const previewRequest = useMemo(
    () => ({
      tubeLengthMm: previewTubeLengthMm,
      tubeOdMm: previewTubeOdMm,
      tubeIdMm: previewTubeIdMm,
      targetDryWeightG,
      dryingPercent,
      parchmentPercent,
      parchmentAllowed: form.parchmentAllowed,
      adhesivePercent,
      recipeRows: previewRecipeRows,
      adhesiveComponents: previewAdhesiveComponents,
    }),
    [
      adhesivePercent,
      dryingPercent,
      form.parchmentAllowed,
      parchmentPercent,
      previewAdhesiveComponents,
      previewRecipeRows,
      previewTubeIdMm,
      previewTubeLengthMm,
      previewTubeOdMm,
      targetDryWeightG,
    ],
  )
  const debouncedPreviewRequest = useDebouncedValue(previewRequest, 250)
  const previewQuery = useSpecSheetPreview(debouncedPreviewRequest)
  const previewDegraded = Boolean(previewQuery.data?.degraded)
  const previewDegradedReason = previewQuery.data?.degraded_reason || "The service preview failed, so this panel is using local math until the service responds."

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

  const isSpecMathUpdating = previewQuery.isFetching || previewRequest !== debouncedPreviewRequest

  const notchDistanceMm = parseMmValue(form.dynamicValues.notch_distance_mm)
  const notchDepthMm = parseMmValue(form.dynamicValues.notch_depth_mm)
  const tubeLengthMm = safeNumber(selectedTube?.length_mm || form.averages.length || 0)
  const notchSetupRequested = Boolean(
    selectedNotchToolEntries.length > 0 ||
      notchDistanceMm > 0 ||
      notchDepthMm > 0 ||
      String(form.dynamicValues.notch_direction || "").trim(),
  )
  const notchGeometryValid = Boolean(
    !notchSetupRequested ||
      (tubeLengthMm > 0 &&
        notchDistanceMm > 0 &&
        notchDistanceMm <= tubeLengthMm &&
        notchDepthMm > 0 &&
        String(form.dynamicValues.notch_direction || "").trim()),
  )
  const notchToolsLinked = selectedNotchToolEntries.every((entry) => Boolean(entry.tool_id))
  const computedNotchDiagram = useMemo(() => {
    const distance = clamp(
      notchDistanceMm,
      0,
      Math.max(tubeLengthMm, 0),
    )
    const depth = notchDepthMm > 0 ? notchDepthMm : 0
    return {
      title: form.notchDiagram.title || "Reference sketch",
      tubeLengthMm,
      notchDistanceMm: distance,
      notchDepthMm: depth,
      notchType: String(form.dynamicValues.notch_type || ""),
      tubeDirection: String(form.dynamicValues.notch_direction || ""),
    }
  }, [form.dynamicValues.notch_direction, form.dynamicValues.notch_type, form.notchDiagram.title, notchDepthMm, notchDistanceMm, tubeLengthMm])

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
      bambooTrimWetG: Number(previewSummary.bamboo_trim_wet_g ?? 0),
      wholeBambooWetG: Number(previewSummary.whole_bamboo_wet_g ?? 0),
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
    if (!specFieldsLoaded) return []
    const existingKeys = new Set((specFields || []).map((field: any) => field.key))
    return DEFAULT_SPEC_FIELD_DEFINITIONS.filter((field) => !existingKeys.has(field.field_key))
  }, [specFields, specFieldsLoaded])

  useEffect(() => {
    if (
      !specFieldsLoaded ||
      !hasConcreteWritePlant ||
      catalogBootstrapped ||
      missingFieldDefinitions.length === 0 ||
      ensureCatalog.isPending
    ) {
      return
    }
    setCatalogBootstrapped(true)
    ensureCatalog.mutate({ existingFields: specFields || [], plantId: activePlant || undefined })
  }, [
    activePlant,
    catalogBootstrapped,
    ensureCatalog,
    hasConcreteWritePlant,
    missingFieldDefinitions.length,
    specFields,
    specFieldsLoaded,
  ])

  useEffect(() => {
    if (!isEditable || !form.tubeSizeId || !selectedMandrel || !selectedTube) return
    if (isTubeWithinMandrelBand(selectedTube, selectedMandrel)) return
    setForm((current) => ({
      ...current,
      tubeSizeId: "",
    }))
  }, [form.tubeSizeId, isEditable, selectedMandrel, selectedTube])

  useEffect(() => {
    if (!isCreate || !selectedTube) return

    setForm((current) => {
      if (current.averages.id > 0 && current.tubeSizeId === selectedTube.id) {
        return current
      }

      const closestMandrel = activeMandrels
        .map((mandrel) => ({
          ...mandrel,
          diff: Math.abs(Number(mandrel?.outer_diameter_mm || 0) - Number(selectedTube.inner_diameter_mm || 0)),
        }))
        .sort((left, right) => left.diff - right.diff)[0]

      return {
        ...current,
        mandrelId: current.mandrelId || closestMandrel?.id || current.mandrelId,
        averages: {
          ...current.averages,
          id: Number(selectedTube.inner_diameter_mm || 0),
          od: Number(selectedTube.outer_diameter_mm || 0),
          length: Number(selectedTube.length_mm || 0),
        },
      }
    })
  }, [activeMandrels, isCreate, selectedTube])

  useEffect(() => {
    if (!isCreate || !selectedCustomer) return
    setForm((current) => current)
  }, [isCreate, selectedCustomer])

  const specHydrationSignature = useMemo(() => {
    if (!specDocument?.spec) return null
    return JSON.stringify({
      mode,
      spec: specDocument.spec,
      latestRecipe: specDocument.latestRecipe,
      latestApprovedTrial,
    })
  }, [latestApprovedTrial, mode, specDocument])

  useEffect(() => {
    if (!specDocument?.spec || !specHydrationSignature || loadedSpecSignature === specHydrationSignature) return

    const spec = specDocument.spec
    const dynamicMap = parseDynamicFields(spec.dynamic_fields as DynamicFieldValue[])
    const parsedAdhesiveComponents = parseAdhesiveComponents(
      dynamicMap.adhesive_components_json,
      Number(dynamicMap.glue_base_percent || 12.5),
    )
    const fallbackAdhesiveComponents = buildAdhesiveComponentsPayload(parsedAdhesiveComponents, {
      tl4: Number(spec.adhesive_20100_percent ?? 0),
      vinsol: Number(spec.adhesive_30100_percent ?? 0),
      basePercent: Number(dynamicMap.glue_base_percent || 12.5),
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
      parchmentAllowed: spec.parchment_allowed ?? true,
      averages: {
        id: midpoint(spec.id_min_mm, spec.id_max_mm),
        od: midpoint(spec.od_min_mm, spec.od_max_mm),
        length: midpoint(spec.length_min_mm, spec.length_max_mm),
        weight: midpoint(spec.weight_min_g, spec.weight_max_g),
        cs: midpoint(spec.cs_min_n, spec.cs_max_n),
        moisture: midpoint(spec.moisture_min_pct, spec.moisture_max_pct),
      },
      shrinkPercent: optionValue(spec.moisture_loss_percent ?? spec.shrink_percent ?? 9),
      parchmentPercent: optionValue(spec.parchment_percent ?? 1.5),
      parchmentColor: "",
      adhesive20100: optionValue(spec.adhesive_20100_percent ?? 0),
      adhesive30100: optionValue(spec.adhesive_30100_percent ?? 0),
      adhesiveComponents: fallbackAdhesiveComponents,
      notes: specDocument.latestRecipe?.notes || "",
      recipeRows: recipeRows.length ? normalizeRecipeRows(recipeRows) : [blankRecipeRow(nextRecipeRowSeed())],
      dynamicValues: {
        ...defaultState.dynamicValues,
        ...dynamicMap,
        notch_direction: dynamicMap.notch_direction || dynamicMap.tube_direction || defaultState.dynamicValues.notch_direction,
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
    setLoadedSpecSignature(specHydrationSignature)

    if (mode === "edit" && (spec.active === false || spec.status === "obsolete" || spec.status === "review")) {
      showToast(
        spec.status === "review"
          ? "This specification is locked while an Owner or Admin reviews it."
          : "Inactive specification versions are read-only. Open the active version to create the next revision.",
        "error",
      )
      router.replace(`/specifications/${spec.id}`)
    }
  }, [loadedSpecSignature, mode, paperMap, router, showToast, specDocument, specHydrationSignature, latestApprovedTrial])

  const footerFieldKeys = ["valid_upto", "prepared_by", "prepared_date", "sign_off_note"] as const
  const footerValidation = footerFieldKeys.map((key) => ({
    key,
    label: DEFAULT_SPEC_FIELD_DEFINITIONS.find((field) => field.field_key === key)?.label || key,
    filled: optionValue(form.dynamicValues[key]).trim().length > 0,
  }))
  const footerComplete = footerValidation.every((field) => field.filled)

  const hasRecipeSelection = form.recipeRows.some((row) => String(row.paper_id || "").trim().length > 0 && Number(row.plyCount || 0) > 0)
  const recipeDistinctPaperCount = new Set(
    form.recipeRows
      .filter((row) => String(row.paper_id || "").trim() && Number(row.plyCount || 0) > 0)
      .map((row) => String(row.paper_id)),
  ).size
  const recipeTotalPlyCount = form.recipeRows.reduce(
    (sum, row) =>
      sum +
      (String(row.paper_id || "").trim()
        ? parsePlyPositions(row.positionsText, Number(row.plyCount || 1)).length
        : 0),
    0,
  )
  const recipePaperCountValid =
    recipeDistinctPaperCount >= RECIPE_MIN_PAPERS && recipeDistinctPaperCount <= RECIPE_MAX_PAPERS
  const recipePlyCountValid = recipeTotalPlyCount >= 1 && recipeTotalPlyCount <= RECIPE_MAX_PLIES
  const recipeStructureValid = recipePaperCountValid && recipePlyCountValid
  const adhesiveRatioTotalValue = adhesiveRatioTotal(form.adhesiveComponents)
  const adhesiveRatioBalanced = isAdhesiveRatioBalanced(form.adhesiveComponents)
  const materialAllowancePercent = Number(form.dynamicValues.glue_base_percent || 12.5)
  const parchmentSharePercent = form.parchmentAllowed ? Number(form.parchmentPercent || 0) : 0
  const materialSplitValid = materialAllowancePercent > 0 && parchmentSharePercent <= materialAllowancePercent
  const selectedTubeMatchesMandrel =
    !selectedTube || !selectedMandrel || isTubeWithinMandrelBand(selectedTube, selectedMandrel)
  const csGateFailed = Boolean(
    latestApprovedTrial?.approved &&
      Number(latestApprovedTrial.actual_cs || 0) < Number(form.averages.cs || 0),
  )
  const canSaveDraft = Boolean(
    isEditable &&
      form.customerId &&
      form.tubeSizeId &&
      form.mandrelId &&
      selectedTubeMatchesMandrel,
  )
  const canSubmitReview = Boolean(
    !isCreate &&
      specDocument?.spec?.status === "draft" &&
      adhesiveRatioBalanced &&
      materialSplitValid &&
      recipeStructureValid &&
      notchGeometryValid &&
      notchToolsLinked &&
      selectedTubeMatchesMandrel &&
      effectiveBalance.withinBand &&
      footerComplete &&
      !csGateFailed,
  )
  const canApprove =
    !isCreate &&
    canApproveAsSuperUser &&
    hasConcreteWritePlant &&
    specDocument?.spec?.status === "review" &&
    Boolean(specDocument?.latestRecipe?.id) &&
    Boolean(effectiveBalance.withinBand)

  const selectedGuidance = form.processGuidance[form.selectedGuidanceIndex]
  const weightDeltaG = Number(effectiveBalance.perTubeWeightG || 0) - Number(form.averages.weight || 0)
  const weightStatusMessage =
    Number(effectiveBalance.perTubeWeightG || 0) < Number(weightBand.min || 0)
      ? `Underweight by ${Math.abs(weightDeltaG).toFixed(2)} g`
      : Number(effectiveBalance.perTubeWeightG || 0) > Number(weightBand.max || 0)
        ? `Overweight by ${Math.abs(weightDeltaG).toFixed(2)} g`
        : `Balanced within band (${weightBand.min.toFixed(2)} - ${weightBand.max.toFixed(2)} g)`
  const headerTitle =
    mode === "create"
      ? "New Specification Sheet"
      : mode === "edit"
        ? specDocument?.spec?.status === "draft"
          ? `Edit Draft v${specDocument?.spec?.version || ""}`
          : `New Version from Spec v${specDocument?.spec?.version || ""}`
        : mode === "print"
          ? `Print Specification ${specDocument?.spec?.version ? `v${specDocument.spec.version}` : ""}`
          : `Specification ${specDocument?.spec?.version ? `v${specDocument.spec.version}` : ""}`

  const previewMetrics = [
    { label: "Paper", value: `${Number(previewSummary.paper_total_g || 0).toFixed(2)} g` },
    { label: "Adhesive", value: `${bridgeMetrics.adhesiveTotalG.toFixed(2)} g` },
    { label: "Parchment", value: `${Number(previewSummary.parchment_weight_g || 0).toFixed(2)} g` },
    { label: "Wet / Tube", value: `${bridgeMetrics.predictedWetTubeG.toFixed(2)} g` },
    { label: "Dry / Tube", value: `${bridgeMetrics.predictedDryTubeG.toFixed(2)} g` },
    { label: "Bamboo Length", value: `${Number(previewSummary.selected_bamboo_length_mm || 0).toFixed(0)} mm` },
    { label: "Finished Tubes Wet", value: `${bridgeMetrics.bambooRequiredWetG.toFixed(2)} g` },
    { label: "Trim Wet", value: `${bridgeMetrics.bambooTrimWetG.toFixed(2)} g` },
    { label: "Whole Bamboo Wet", value: `${bridgeMetrics.wholeBambooWetG.toFixed(2)} g` },
    { label: "Tubes / Bamboo", value: `${Number(previewSummary.tubes_per_bamboo || 0)}` },
  ]
  const livePaperTotal = Number(previewSummary.paper_total_g || 0)
  const liveDryTube = Number(previewSummary.predicted_dry_tube_g || 0)
  const liveWetTube = Number(previewSummary.predicted_wet_tube_g || 0)
  const liveDryDelta = Number(previewSummary.dry_delta_g || 0)
  const targetDryTube = Number(form.averages.weight || 0)
  const liveIdDeltaMm = Number(manufacturingAverages.id || 0) - Number(form.averages.id || 0)
  const liveOdDeltaMm = Number(manufacturingAverages.od || 0) - Number(form.averages.od || 0)
  const wetBambooThicknessMm = thicknessFrom(manufacturingAverages.id, manufacturingAverages.od)
  const mainPaperGsmGuide = wetBambooThicknessMm > 0 ? wetBambooThicknessMm / 0.142 : 0
  const targetWetTube = Number(bridgeMetrics.preMoistureTargetTubeG || 0)
  const totalMaterialPercent = materialAllowancePercent
  const targetTotalAdditionsWeight = targetDryTube * (totalMaterialPercent / 100)
  const targetParchmentWeight = form.parchmentAllowed ? targetDryTube * (Number(form.parchmentPercent || 1.5) / 100) : 0
  const targetAdhesiveWeight = Math.max(targetTotalAdditionsWeight - targetParchmentWeight, 0)
  const targetPaperWeight = Math.max(targetWetTube - targetTotalAdditionsWeight, 0)
  const targetAdhesiveComponents = (() => {
    const totalCents = Math.round(targetAdhesiveWeight * 100)
    let allocatedCents = 0
    return previewAdhesiveComponents.map((component, index, components) => {
      const weightCents =
        adhesiveRatioTotalValue <= 0
          ? 0
          : index === components.length - 1
            ? Math.max(totalCents - allocatedCents, 0)
            : Math.round(totalCents * (Number(component.ratio_percent || 0) / adhesiveRatioTotalValue))
      allocatedCents += weightCents
      return { ...component, weight_g: weightCents / 100 }
    })
  })()
  const measuredDryTube = Number(form.dynamicValues.measured_finished_dry_g || latestApprovedTrial?.actual_weight || 0)
  const measuredDryGap = measuredDryTube > 0 ? measuredDryTube - liveDryTube : 0
  const effectiveDryingLossPercent = measuredDryTube > 0 && liveWetTube > 0
    ? (1 - measuredDryTube / liveWetTube) * 100
    : 0
  const inferredPaperAtConfiguredDivisor = measuredDryTube > 0
    ? measuredDryTube / Math.max(1 - Number(form.shrinkPercent || 9) / 100, 0.01) - targetTotalAdditionsWeight
    : 0
  const adhesiveComponentSummary = targetAdhesiveComponents
    .map((component: any) => `${String(component?.name || "Adhesive").replace(/\s*\([^)]*\)\s*$/, "")} ${Number(component?.weight_g || 0).toFixed(2)} g`)
    .join(" · ")
  const writePlantLabel =
    activePlant === "ALL"
      ? "Pick one plant before writing."
      : displayPlantScope(activePlant || user?.plant_id, "No plant selected")
  const writePlantAlertMessage =
    activePlant === "ALL"
      ? "Global scope is read-only here. Specification create, edit, and approval only work on one selected plant."
      : "This plant is the only write scope used for save, approval, recipe truth, and downstream job-card handoff."

  useEffect(() => {
    if (!isCreate || !specDefaults || defaultsBootstrappedForPlant === activePlant) return
    setForm((current) => {
      const adhesive = Number(specDefaults.adhesive_percent ?? 12.5)
      const parchment = Number(specDefaults.parchment_percent ?? 1.5)
      const moisture = Number(specDefaults.moisture_loss_percent ?? 9)
      return {
        ...current,
        parchmentPercent: String(parchment),
        shrinkPercent: String(moisture),
        dynamicValues: { ...current.dynamicValues, glue_base_percent: String(adhesive) },
        adhesiveComponents: current.adhesiveComponents.map((component) => ({
          ...component,
          base_percent: adhesive,
        })),
      }
    })
    setDefaultsBootstrappedForPlant(activePlant || null)
  }, [activePlant, defaultsBootstrappedForPlant, isCreate, specDefaults])
  const manufacturingIdBand = {
    min: manufacturingRows.find((row) => row.label === "MIN")?.id || 0,
    avg: manufacturingRows.find((row) => row.label === "AVG")?.id || 0,
    max: manufacturingRows.find((row) => row.label === "MAX")?.id || 0,
  }
  const selectedBambooLengthMm = Number(previewSummary.selected_bamboo_length_mm || 0)
  const usableBambooLengthMm = Number(previewSummary.usable_length_mm || recipePreview.usableLength || 0)
  const finishedBambooLengthMm = Number(previewSummary.finished_length_mm || usableBambooLengthMm || 0)
  const totalTrimMm = Number(previewSummary.total_trim_mm || Math.max(selectedBambooLengthMm - finishedBambooLengthMm, 0))
  const fixedEndTrimMm = Number(previewSummary.fixed_end_trim_mm || Math.min(totalTrimMm, 40))
  const residualOffcutMm = Number(previewSummary.residual_offcut_mm || Math.max(totalTrimMm - fixedEndTrimMm, 0))
  const tubesPerBamboo = Number(previewSummary.tubes_per_bamboo || 0)
  const bambooDryWeightG =
    Number(previewSummary.bamboo_required_dry_g || 0) ||
    liveDryTube * tubesPerBamboo
  const bambooWetWeightG =
    Number(previewSummary.bamboo_required_wet_g || 0) ||
    liveWetTube * tubesPerBamboo
  const bambooTrimWetWeightG = Number(previewSummary.bamboo_trim_wet_g || 0)
  const bambooTrimDryWeightG = Number(previewSummary.bamboo_trim_dry_g || 0)
  const wholeBambooWetWeightG = Number(previewSummary.whole_bamboo_wet_g || 0) || bambooWetWeightG + bambooTrimWetWeightG
  const wholeBambooDryWeightG = Number(previewSummary.whole_bamboo_dry_g || 0) || bambooDryWeightG + bambooTrimDryWeightG
  const sheetReference =
    selectedMandrel?.mandrel_code && selectedTube
      ? `${selectedMandrel.mandrel_code}-${Number(selectedTube.inner_diameter_mm || 0).toFixed(0)}X${Number(selectedTube.outer_diameter_mm || 0).toFixed(0)}X${Number(selectedTube.length_mm || 0).toFixed(0)}`
      : selectedMandrel?.mandrel_code || "Sheet reference pending"
  const currentRecipeRuleTitle = formatRecipeRowsTitle(form.recipeRows)
  const comboRuleTitle =
    currentRecipeRuleTitle ||
    "Build the live recipe from approved paper, adhesive, and parchment masters."
  const clientSpecRows = [
    { label: "I.D", values: [`${Number(selectedTube?.inner_diameter_mm || 0).toFixed(2)} mm`] },
    { label: "O.D", values: [`${Number(selectedTube?.outer_diameter_mm || 0).toFixed(2)} mm`] },
    { label: "Thickness", values: [`${thicknessFrom(Number(selectedTube?.inner_diameter_mm || 0), Number(selectedTube?.outer_diameter_mm || 0)).toFixed(2)} mm`] },
    { label: "Length", values: [`${Number(selectedTube?.length_mm || form.averages.length || 0).toFixed(0)} mm`] },
    { label: "Weight", values: [`${Number(form.averages.weight || 0).toFixed(2)} g`] },
    { label: "CS", values: [`${Number(form.averages.cs || 0).toFixed(2)} kgf`] },
  ]
  const weightTolerance = Math.max(
    Number(form.averages.weight || 0) - Number(weightBand.min || 0),
    Number(weightBand.max || 0) - Number(form.averages.weight || 0),
    0,
  )
  const manufacturingSpecRows = [
    {
      label: "I.D",
      values: [
        `${manufacturingIdBand.min.toFixed(2)} mm`,
        `${manufacturingIdBand.avg.toFixed(2)} mm`,
        `${manufacturingIdBand.max.toFixed(2)} mm`,
      ],
    },
    {
      label: "O.D",
      values: [
        `${Number(manufacturingRows.find((row) => row.label === "MIN")?.od || 0).toFixed(2)} mm`,
        `${Number(manufacturingRows.find((row) => row.label === "AVG")?.od || 0).toFixed(2)} mm`,
        `${Number(manufacturingRows.find((row) => row.label === "MAX")?.od || 0).toFixed(2)} mm`,
      ],
    },
    {
      label: "Thickness",
      values: [
        `${Number(manufacturingRows.find((row) => row.label === "MIN")?.thick || 0).toFixed(2)} mm`,
        `${Number(manufacturingRows.find((row) => row.label === "AVG")?.thick || 0).toFixed(2)} mm`,
        `${Number(manufacturingRows.find((row) => row.label === "MAX")?.thick || 0).toFixed(2)} mm`,
      ],
    },
    {
      label: "Bamboo LT",
      values: [
        `${Math.max(selectedBambooLengthMm - 10, 0).toFixed(0)} mm`,
        `${selectedBambooLengthMm.toFixed(0)} mm`,
        `${(selectedBambooLengthMm + 10).toFixed(0)} mm`,
      ],
    },
    {
      label: "Tube Dry",
      values: [
        `${Math.max(Number(form.averages.weight || 0) - weightTolerance, 0).toFixed(0)} g`,
        `${Number(form.averages.weight || 0).toFixed(0)} g`,
        `${(Number(form.averages.weight || 0) + weightTolerance).toFixed(0)} g`,
      ],
    },
    {
      label: "Tube Wet",
      values: [
        `${(Math.max(Number(form.averages.weight || 0) - weightTolerance, 0) / Math.max(0.01, 1 - Number(form.shrinkPercent || 9.0) / 100)).toFixed(0)} g`,
        `${bridgeMetrics.preMoistureTargetTubeG.toFixed(0)} g`,
        `${((Number(form.averages.weight || 0) + weightTolerance) / Math.max(0.01, 1 - Number(form.shrinkPercent || 9.0) / 100)).toFixed(0)} g`,
      ],
    },
  ]

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
          return applyPaperMasterToRecipeRow(next, paper)
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
      if (current.adhesiveComponents.length >= 6) return current
      return {
        ...current,
        adhesiveComponents: [
          ...current.adhesiveComponents,
          {
            name: `Adhesive ${current.adhesiveComponents.length + 1}`,
            base_percent: Number(current.dynamicValues.glue_base_percent || 12.5),
            ratio_percent: 10,
          },
        ],
      }
    })
  }

  const removeAdhesiveComponent = (index: number) => {
    setForm((current) => {
      if (current.adhesiveComponents.length <= 1) return current
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
      basePercent: Number(form.dynamicValues.glue_base_percent || 12.5),
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
        parchment_percent: Number(form.parchmentPercent || 1.5),
        parchment_groups: selectedParchmentGroups,
        shrink_percent: Number(form.shrinkPercent || 0),
        adhesive_components: adhesiveComponentsPayload,
        recipe_rows: form.recipeRows,
      },
      notch_tooling: {
        notch_type: form.dynamicValues.notch_type || null,
        notch_distance_mm: parseMmValue(form.dynamicValues.notch_distance_mm),
        notch_depth_mm: parseMmValue(form.dynamicValues.notch_depth_mm),
        notching_holder: form.dynamicValues.notching_holder || null,
        notching_blade: form.dynamicValues.notching_blade || null,
        v_flat: form.dynamicValues.v_flat || null,
        punch: form.dynamicValues.punch || null,
        notch_direction: form.dynamicValues.notch_direction || null,
        diagram: form.notchDiagram,
        tooling_usage: selectedNotchToolEntries,
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
        box_unit_weight_kg: safeNumber(form.dynamicValues.box_unit_weight_kg || 0) || null,
        plastic_required: boolFromString(form.dynamicValues.plastic_required),
        plastic_sku: form.dynamicValues.plastic_sku || null,
        plastic_size: form.dynamicValues.plastic_size || null,
        plastic_unit_weight_kg: safeNumber(form.dynamicValues.plastic_unit_weight_kg || 0) || null,
        plastic_weight_per_box_kg: safeNumber(form.dynamicValues.plastic_weight_per_box_kg || 0) || null,
        plastic_per_box: safeNumber(form.dynamicValues.plastic_per_box || 0) || null,
        fadda_sku: form.dynamicValues.fadda_sku || null,
        fadda_unit_weight_kg: safeNumber(form.dynamicValues.fadda_unit_weight_kg || 0) || null,
        fadda_weight_per_box_kg: safeNumber(form.dynamicValues.fadda_weight_per_box_kg || 0) || null,
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
      parchment_percent: Number(form.parchmentPercent || 1.5),
      parchment_allowed: form.parchmentAllowed,
      adhesive_percent: Number(form.dynamicValues.glue_base_percent || 12.5),
      moisture_loss_percent: Number(form.shrinkPercent || 9),
      adhesive_20100_percent: Number(legacyTl4Ratio || form.adhesive20100 || 0),
      adhesive_30100_percent: Number(legacyVinsolRatio || form.adhesive30100 || 0),
      shrink_percent: Number(form.shrinkPercent || 0),
      variant_template_key: CANONICAL_VARIANT_KEY,
      profile: profilePayload,
      dynamic_fields: buildDynamicFieldsPayload(dynamicValues),
    }
  }

  const buildRecipeLayers = () => {
    const layers: Array<{ ply_no: number; paper_id: string; gsm_snapshot: number; bf_snapshot: number; bulk_snapshot?: number }> = []
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
          bulk_snapshot: Number(paper?.bulk_factor || row.bulkFactor || 1),
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
    if (editBlockReason) {
      showToast(editBlockReason, "error")
      return
    }
    if (!form.customerId || !form.tubeSizeId || !form.mandrelId) {
      showToast("Customer, mandrel, and matching tube size are required before saving.", "error")
      return
    }
    if (!selectedTubeMatchesMandrel) {
      showToast("Tube size must be within +/- 1 mm of the selected mandrel ID.", "error")
      return
    }
    if (!canSaveDraft) {
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
        const toolLogResults = await Promise.allSettled(
          selectedNotchToolEntries.map((entry) =>
            logToolUsage.mutateAsync({
              tool_id: entry.tool_id,
              category: entry.category,
              tool_name: entry.tool_name,
              event_type: "SPEC_SELECTED",
              source_type: "SPEC_SHEET",
              source_id: result?.spec?.id,
              source_ref: result?.spec?.spec_reference,
              metadata_json: {
                field_key: entry.field_key,
                field_label: entry.label,
                customer_name: selectedCustomer?.name || specDocument?.spec?.customer_name_snapshot || specDocument?.spec?.customer_name || "",
              },
            }),
          ),
        )
        const toolLogFailures = toolLogResults.filter((entry) => entry.status === "rejected").length
        showToast(
          toolLogFailures
            ? `Specification draft created, but ${toolLogFailures} tooling trace entr${toolLogFailures === 1 ? "y" : "ies"} could not be logged. Save once more after checking connectivity.`
            : "Specification draft created.",
          toolLogFailures ? "error" : "success",
        )
        router.push(`/specifications/${result.spec.id}`)
        return
      }

      const result = await updateSpecSheet.mutateAsync({
        specId: specId || "",
        recipeId: specDocument?.latestRecipe?.id,
        specData,
        recipeData,
        recipeLayers,
        trialData,
      })
      const toolLogResults = await Promise.allSettled(
        selectedNotchToolEntries.map((entry) =>
          logToolUsage.mutateAsync({
            tool_id: entry.tool_id,
            category: entry.category,
            tool_name: entry.tool_name,
            event_type: "SPEC_SELECTED",
            source_type: "SPEC_SHEET",
            source_id: result?.spec?.id || specId,
            source_ref: result?.spec?.spec_reference || specDocument?.spec?.spec_reference,
            metadata_json: {
              field_key: entry.field_key,
              field_label: entry.label,
              customer_name: selectedCustomer?.name || specDocument?.spec?.customer_name_snapshot || specDocument?.spec?.customer_name || "",
            },
          }),
        ),
      )
      const toolLogFailures = toolLogResults.filter((entry) => entry.status === "rejected").length
      showToast(
        toolLogFailures
          ? `Specification saved, but ${toolLogFailures} tooling trace entr${toolLogFailures === 1 ? "y" : "ies"} could not be logged. Save once more after checking connectivity.`
          : result.recipe
            ? `Draft v${result.spec.version || 1} saved with its updated recipe.`
            : `Draft v${result.spec.version || 1} saved.`,
        toolLogFailures ? "error" : "success",
      )
      router.push(`/specifications/${result.spec.id}`)
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to save the specification sheet."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleSubmitReview = async () => {
    if (!specId || !canSubmitReview) {
      showToast("Resolve the visible release blockers before sending this draft to the Owner.", "error")
      return
    }
    try {
      await submitSpecForReview.mutateAsync({ specId })
      showToast("Draft submitted for approval review. It is now locked against edits.", "success")
      router.refresh()
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || "Failed to submit specification for review."
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  const handleApprove = async () => {
    if (editBlockReason) {
      showToast(editBlockReason, "error")
      return
    }
    if (!specId || !canApprove) {
      showToast("Only the Owner can approve a specification after it has passed review.", "error")
      return
    }

    try {
      await approveSpec.mutateAsync({ specId, data: {} })
      showToast("Specification approved and live for production.", "success")
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

  const renderScalarField = (
    key: string,
    label: string,
    type: "text" | "number" = "text",
    placeholder?: string,
  ) => {
    const defaultDefinition = DEFAULT_SPEC_FIELD_DEFINITIONS.find((field) => field.field_key === key)
    const shouldPreferDefaultDefinition =
      Boolean(NOTCH_TOOL_FIELD_CATEGORY_MAP[key]) ||
      (defaultDefinition?.field_type === "select" && Array.isArray(defaultDefinition.options) && defaultDefinition.options.length > 0)
    const definition = shouldPreferDefaultDefinition ? defaultDefinition || fieldCatalogMap.get(key) : fieldCatalogMap.get(key) || defaultDefinition
    const catalogOptions = fieldCatalogMap.get(key)?.options
    const defaultOptions = defaultDefinition?.options
    const staticOptions: string[] = [
      ...(Array.isArray(defaultOptions) ? (defaultOptions as string[]) : []),
      ...(Array.isArray(catalogOptions) ? (catalogOptions as string[]) : []),
    ]
    const toolCategories = NOTCH_TOOL_FIELD_CATEGORY_MAP[key] || []
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

    if (type !== "number" && definition?.field_type === "select" && (options.length > 0 || toolCategories.length > 0)) {
      return (
        <div className="space-y-1">
          <FieldLabel>{label}</FieldLabel>
          <SmartSelect
            value={optionValue(form.dynamicValues[key])}
            disabled={!isEditable}
            placeholder={`Select ${label.toLowerCase()}`}
            emptyLabel="No active master option is available for this field."
            options={options.map((option) => ({ value: option, label: option }))}
            onChange={(nextValue) => updateDynamicValue(key, nextValue)}
          />
        </div>
      )
    }

    if (definition?.field_type === "boolean") {
      return (
        <div className="space-y-1">
          <FieldLabel>{label}</FieldLabel>
          <SmartSelect
            value={yesNoValue(form.dynamicValues[key])}
            disabled={!isEditable}
            placeholder="Select"
            options={[
              { value: "No", label: "No" },
              { value: "Yes", label: "Yes" },
            ]}
            onChange={(nextValue) => updateDynamicValue(key, nextValue === "Yes" ? "true" : "false")}
          />
        </div>
      )
    }

    return (
      <div className="space-y-1">
        <FieldLabel>{label}</FieldLabel>
        <input
          data-testid={`spec-field-${key}`}
          type={inputType}
          min={inputType === "number" ? "0" : undefined}
          max={key === "notch_distance_mm" && tubeLengthMm > 0 ? String(tubeLengthMm) : undefined}
          step={inputType === "number" ? "0.01" : undefined}
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
  const draftSaved = !isCreate && Boolean(specDocument?.spec?.id)
  const releaseBlockers = [
    !form.customerId ? "Customer" : null,
    !form.mandrelId || !form.tubeSizeId || !selectedTubeMatchesMandrel ? "Tube / mandrel" : null,
    !recipeStructureValid ? `Paper recipe (${RECIPE_MIN_PAPERS}-${RECIPE_MAX_PAPERS} papers, max ${RECIPE_MAX_PLIES} plies)` : null,
    !adhesiveRatioBalanced ? `Adhesive split ${adhesiveRatioTotalValue.toFixed(0)}%` : null,
    !materialSplitValid ? "Additions / parchment" : null,
    !notchGeometryValid || !notchToolsLinked ? "Notch / tooling" : null,
    !effectiveBalance.withinBand ? `Weight outside ±${DELTA_ABS_G} g` : null,
    !footerComplete ? "Release footer" : null,
    csGateFailed ? "CS trial" : null,
  ].filter(Boolean) as string[]
  const reviewChecksPass = Boolean(
    draftSaved &&
      adhesiveRatioBalanced &&
      materialSplitValid &&
      selectedTubeMatchesMandrel &&
      hasRecipeSelection &&
      recipeStructureValid &&
      notchGeometryValid &&
      notchToolsLinked &&
      effectiveBalance.withinBand &&
      footerComplete &&
      !csGateFailed,
  )
  const approvalComplete = String(currentStatus || "").toLowerCase() === "approved"
  if (isPrint) {
    const printRecipe = form.recipeRows
      .filter((row) => String(row.paper_id || "").trim())
      .map((row) => {
        const previewRow = Array.isArray(previewSummary.ply_details)
          ? previewSummary.ply_details.find(
              (item: any) =>
                item.paper_id === row.paper_id &&
                Number(item.gsm || 0) === Number(paperMap.get(row.paper_id)?.gsm || row.gsm || 0),
            )
          : null
        return {
          code: row.code,
          variety: row.variety,
          gsm: Number(previewRow?.gsm || row.gsm || 0),
          bf: Number(row.bfPerPly || 0),
          thickness: Number(row.thicknessPerPly || 0),
          weight: Number(previewRow?.weightG || 0),
          plies: Number(row.plyCount || 0),
          positions: row.positionsText || encodePlyPositions(parsePlyPositions(row.positionsText, row.plyCount)),
        }
      })
    const actualHeight = Number(form.dynamicValues.actual_tube_height_mm || selectedTube?.length_mm || form.averages.length || 0)
    const printData = {
      company: "Hari Om Paper",
      customer: selectedCustomer?.name || specDocument?.spec?.customer_name || "",
      reference: sheetReference,
      version: `v${specDocument?.spec?.version || 1}`,
      status: approvalComplete ? "LIVE / APPROVED" : String(currentStatus || "DRAFT").toUpperCase(),
      preparedDate: optionValue(form.dynamicValues.prepared_date) || todayLabel,
      validUntil: optionValue(form.dynamicValues.valid_upto),
      preparedBy: optionValue(form.dynamicValues.prepared_by),
      geometry: [
        { label: "Mandrel / ID", value: `${selectedMandrel?.mandrel_code || ""} · ${Number(form.averages.id || 0).toFixed(2)} mm` },
        { label: "OD", value: `${Number(form.averages.od || 0).toFixed(2)} mm` },
        { label: "Wall", value: `${thicknessFrom(Number(form.averages.id || 0), Number(form.averages.od || 0)).toFixed(3)} mm` },
        { label: "Actual height", value: `${actualHeight.toFixed(2)} mm` },
        { label: "Dry target", value: `${targetDryTube.toFixed(2)} g` },
        { label: "Tolerance", value: `±${DELTA_ABS_G.toFixed(0)} g` },
        { label: "CS", value: `${Number(form.averages.cs || 0).toFixed(2)} kgf` },
        { label: "Moisture loss", value: `${Number(form.shrinkPercent || 9).toFixed(2)}%` },
      ],
      recipe: printRecipe,
      adhesive: targetAdhesiveComponents.map((component: any) => ({
        name: String(component?.name || "Adhesive"),
        ratio: Number(component?.ratio_percent || 0),
        weight: Number(component?.weight_g || 0),
      })),
      totals: {
        paper: livePaperTotal,
        adhesive: targetAdhesiveWeight,
        parchment: targetParchmentWeight,
        wet: liveWetTube,
        dry: liveDryTube,
        targetDry: targetDryTube,
        variance: measuredDryTube > 0 ? measuredDryTube - targetDryTube : liveDryDelta,
        idDelta: liveIdDeltaMm,
        odDelta: liveOdDeltaMm,
      },
      process: [
        { label: "Wet tube target", value: `${targetWetTube.toFixed(2)} g` },
        { label: "Combined additions", value: `${targetTotalAdditionsWeight.toFixed(2)} g (${totalMaterialPercent.toFixed(2)}%)` },
        { label: "Wet paper target", value: `${targetPaperWeight.toFixed(2)} g` },
        { label: "Geometric paper", value: `${livePaperTotal.toFixed(2)} g` },
        { label: "Bamboo wet / dry", value: `${bambooWetWeightG.toFixed(2)} / ${bambooDryWeightG.toFixed(2)} g` },
        { label: "Trim wet / dry", value: `${bambooTrimWetWeightG.toFixed(2)} / ${bambooTrimDryWeightG.toFixed(2)} g` },
        { label: "Whole bamboo wet / dry", value: `${wholeBambooWetWeightG.toFixed(2)} / ${wholeBambooDryWeightG.toFixed(2)} g` },
        { label: "Tubes / bamboo", value: `${tubesPerBamboo.toFixed(0)} pcs` },
        { label: "Bamboo / usable", value: `${selectedBambooLengthMm.toFixed(0)} / ${usableBambooLengthMm.toFixed(0)} mm` },
        { label: "Finished / trim", value: `${finishedBambooLengthMm.toFixed(0)} / ${totalTrimMm.toFixed(0)} mm` },
        { label: "Main GSM helper", value: `${mainPaperGsmGuide.toFixed(0)} ±50 GSM` },
        { label: "Measured finished dry", value: measuredDryTube > 0 ? `${measuredDryTube.toFixed(2)} g` : "Not recorded" },
      ],
      tooling: [
        { label: "Notch type", value: optionValue(form.dynamicValues.notch_type) },
        { label: "Direction", value: optionValue(form.dynamicValues.notch_direction) },
        { label: "Distance", value: `${computedNotchDiagram.notchDistanceMm.toFixed(2)} mm` },
        { label: "Depth", value: `${computedNotchDiagram.notchDepthMm.toFixed(2)} mm` },
        ...selectedNotchToolEntries.map((entry) => ({ label: entry.label, value: entry.tool_name })),
      ],
      packing: [
        { label: "Box", value: `${optionValue(form.dynamicValues.box_code || form.dynamicValues.box)} · ${optionValue(form.dynamicValues.box_size || selectedPackagingBox?.size_label)}` },
        { label: "Qty / box", value: `${Number(form.dynamicValues.qty_per_box || 0)} pcs` },
        { label: "Plastic", value: `${optionValue(form.dynamicValues.plastic_sku)} · ${optionValue(form.dynamicValues.plastic_size || selectedPackagingPlastic?.size_label)}` },
        { label: "Plastic / box", value: `${Number(form.dynamicValues.plastic_per_box || 0)} pcs · ${Number(form.dynamicValues.plastic_weight_per_box_kg || 0).toFixed(4)} kg` },
        { label: "Fadda", value: `${optionValue(form.dynamicValues.fadda_sku)} · ${Number(form.dynamicValues.fadda_per_box || 0)} pcs` },
        { label: "BOPP", value: boolFromString(form.dynamicValues.bopp_required) ? "Yes" : "No" },
      ],
      blockers: releaseBlockers,
      notes: form.notes,
      signOff: optionValue(form.dynamicValues.sign_off_note),
    }
    return <SpecSheetPrint enabled data={printData} />
  }
  return (
    <SpecSheetWorkspace printMode={isPrint}>
      <div className="min-w-0 space-y-3" data-testid="spec-sheet-page">
        <section
          className="scroll-mt-24"
          data-print-hidden="true"
          id="sheet-header"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1e765e]">{headerTitle}</p>
              <h2 className="mt-1 truncate text-2xl font-black tracking-[-0.04em] text-[#102832] sm:text-[2rem]">
                {selectedCustomer?.name || specDocument?.spec?.customer_name || "New tube specification"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {sheetReference} {selectedTube ? `· ${selectedTube.inner_diameter_mm} × ${selectedTube.outer_diameter_mm} × ${selectedTube.length_mm} mm` : "· select client, mandrel and tube"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-[#ead39b] bg-[#fbf1d9] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.11em] text-[#805a09]">
                  {currentStatus === "approved" ? "Live" : currentStatus || "Draft"}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.11em] ${effectiveBalance.withinBand ? "border-[#b9e4d1] bg-[#e4f6ed] text-[#166b51]" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                  {effectiveBalance.withinBand ? "Weight within target band" : "Weight outside target band"}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.11em] ${reviewChecksPass ? "border-[#b9e4d1] bg-[#e4f6ed] text-[#166b51]" : "border-slate-200 bg-white text-slate-600"}`}>
                  {reviewChecksPass ? "All checks pass" : "Review pending"}
                </span>
                <span className="rounded-full border border-[#d7dfdc] bg-white px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.11em] text-slate-600">
                  {targetDryTube.toFixed(2)} g dry target
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[600px] lg:justify-end">
              {isEditable ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSaveDraft || createSpecSheet.isPending || updateSpecSheet.isPending}
                  className="rounded-lg bg-[#102832] px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#183946] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Draft
                </button>
              ) : null}
              {!isCreate && specDocument?.spec?.active !== false && currentStatus !== "obsolete" && currentStatus !== "review" && !isEditable ? (
                <Link href={`/specifications/${specId}/edit`} className="rounded-lg border border-[#d7dfdc] bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[#9db7b0]">
                  {currentStatus === "draft" ? "Edit Draft" : "Create New Version"}
                </Link>
              ) : null}
              {!isCreate && currentStatus === "draft" && !isEditable ? (
                <button
                  type="button"
                  onClick={handleSubmitReview}
                  disabled={!canSubmitReview || submitSpecForReview.isPending || isEditable}
                  className="rounded-lg border border-[#ead39b] bg-[#fbf1d9] px-3.5 py-2 text-sm font-bold text-[#805a09] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit for Owner Review
                </button>
              ) : null}
              {!isCreate && currentStatus === "review" && canApproveAsSuperUser ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={!canApprove || approveSpec.isPending}
                  className="rounded-lg border border-[#b9e4d1] bg-[#e4f6ed] px-3.5 py-2 text-sm font-bold text-[#166b51] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve &amp; Go Live
                </button>
              ) : null}
              {!isCreate && currentStatus === "approved" ? (
                <button
                  type="button"
                  onClick={handleObsolete}
                  disabled={obsoleteSpec.isPending}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"
                >
                  Mark Obsolete
                </button>
              ) : null}
              {!isCreate ? (
                <button
                  type="button"
                  onClick={handleClone}
                  disabled={cloneSpec.isPending}
                  className="rounded-lg border border-[#d7dfdc] bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-50"
                >
                  Clone Draft
                </button>
              ) : null}
              {!isPrint && specId ? (
                <Link href={`/specifications/${specId}/print`} className="rounded-lg border border-[#d7dfdc] bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm">
                  Print View
                </Link>
              ) : null}
              {isPrint ? (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg border border-[#d7dfdc] bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm"
                >
                  Print / Save PDF
                </button>
              ) : null}
            </div>
          </div>

          <nav className="sticky top-[5.15rem] z-20 mt-3 flex min-h-11 items-center gap-1 overflow-x-auto rounded-xl border border-[#d7dfdc] bg-white/95 p-1 shadow-[0_8px_24px_rgba(28,54,60,0.05)] backdrop-blur" aria-label="Specification sections">
            <a href="#sheet-client" className="whitespace-nowrap rounded-lg bg-[#e8f2f4] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#102832]">01 Requirement</a>
            <a href="#sheet-recipe" className="whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:bg-[#eef4f3] hover:text-[#102832]">02 Recipe</a>
            <a href="#sheet-manufacturing" className="whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:bg-[#eef4f3] hover:text-[#102832]">03 Manufacturing</a>
            {!isCreate ? <a href="#review-approve" className="whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:bg-[#eef4f3] hover:text-[#102832]">04 Review</a> : null}
            <span className="ml-auto hidden whitespace-nowrap px-3 text-[10px] text-slate-500 lg:block">Total additions {Number(form.dynamicValues.glue_base_percent || 12.5).toFixed(1)}% · includes parchment {form.parchmentAllowed ? `${Number(form.parchmentPercent || 1.5).toFixed(1)}%` : "off"}</span>
          </nav>

          {editBlockReason ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{editBlockReason}</div>
          ) : null}
          {previewDegraded ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900">Preview service degraded: {previewDegradedReason}</div>
          ) : null}

        </section>

        <div className="space-y-3">
          <ClientReqCard>
            <div className="space-y-4">
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4ebe8] pb-3">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1e765e]">01 · Client requirement</p>
                    <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#102832]">Lock the commercial inputs first</h3>
                    <p className="mt-1 text-xs text-slate-500">Everything below derives from these client-controlled fields.</p>
                  </div>
                  <MasterLinkRow
                    links={[
                      { href: "/masters/customers", label: "Customer master" },
                      { href: "/masters/tube-sizes", label: "Tube sizes" },
                      { href: "/masters/mandrels", label: "Mandrels" },
                    ]}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_0.68fr_1.05fr_0.72fr_0.68fr_0.68fr]">
                  <div className="space-y-1">
                    <FieldLabel>Client / Party Name</FieldLabel>
                    {isEditable ? (
                      <SmartSelect
                        value={form.customerId}
                        options={customerOptions}
                        placeholder="Select customer"
                        emptyLabel="No active customer is available."
                        onChange={(nextValue) => setForm((current) => ({ ...current, customerId: nextValue }))}
                      />
                    ) : (
                      <div className="flex h-10 items-center rounded-lg border border-[#ccd8d5] bg-[#f2f5f4] px-3 text-sm font-semibold text-slate-800">
                        {selectedCustomer?.name || specDocument?.spec?.customer_name || "-"}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Mandrel</FieldLabel>
                    <SmartSelect
                      testId="spec-sheet-mandrel"
                      value={form.mandrelId}
                      options={mandrelOptions}
                      placeholder="Select mandrel"
                      disabled={!isEditable}
                      emptyLabel="No active mandrel is available."
                      onChange={(nextValue) =>
                        setForm((current) => {
                          const nextMandrel = mandrelMap.get(nextValue)
                          const currentTube = tubeSizeMap.get(current.tubeSizeId)
                          const keepTube = currentTube ? isTubeWithinMandrelBand(currentTube, nextMandrel) : false
                          return {
                            ...current,
                            mandrelId: nextValue,
                            tubeSizeId: keepTube ? current.tubeSizeId : "",
                          }
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Parchment Allowed</FieldLabel>
                    <SmartSelect
                      value={form.parchmentAllowed ? "true" : "false"}
                      options={parchmentAllowedOptions}
                      placeholder="Select"
                      disabled={!isEditable}
                      onChange={(nextValue) => setForm((current) => ({ ...current, parchmentAllowed: nextValue === "true" }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Tube Size</FieldLabel>
                    <SmartSelect
                      testId="spec-sheet-tube-size"
                      value={form.tubeSizeId}
                      options={tubeSizeOptions}
                      placeholder={form.mandrelId ? "Select matching tube size" : "Select tube size"}
                      disabled={!isEditable || !form.mandrelId}
                      emptyLabel="No active tube size is within +/- 1 mm of this mandrel."
                      onChange={(nextValue) => setForm((current) => ({ ...current, tubeSizeId: nextValue }))}
                    />
                    <p className="text-xs text-slate-500">
                      {form.mandrelId
                        ? "Only tube IDs within +/- 1 mm of the selected mandrel are shown."
                        : "Pick mandrel first to narrow tube sizes."}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Actual Tube Height</FieldLabel>
                    <NumericInput
                      data-testid="spec-sheet-actual-height"
                      step="0.01"
                      unit="mm"
                      value={optionValue(form.dynamicValues.actual_tube_height_mm)}
                      disabled={!isEditable}
                      placeholder={selectedTube?.length_mm ? String(selectedTube.length_mm) : "Master length"}
                      onChange={(event) => updateDynamicValue("actual_tube_height_mm", event.target.value)}
                      className="h-10 rounded-lg"
                    />
                    <p className="text-[10px] leading-4 text-slate-500">Job-card display only; blank uses the tube master.</p>
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Target Dry Weight</FieldLabel>
                    <NumericInput
                      data-testid="spec-sheet-target-weight"
                      step="0.01"
                      unit="g"
                      value={inputNumberValue(form.averages.weight)}
                      disabled={!isEditable}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          averages: { ...current.averages, weight: safeNumber(event.target.value || 0) },
                        }))
                      }
                      className="h-10 rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Required CS</FieldLabel>
                    <NumericInput
                      step="0.01"
                      unit="kgf"
                      value={inputNumberValue(form.averages.cs)}
                      disabled={!isEditable}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          averages: { ...current.averages, cs: safeNumber(event.target.value || 0) },
                        }))
                      }
                      className="h-10 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <SummaryMetric
                    label="Sheet reference"
                    value={sheetReference}
                    detail={selectedCustomer?.name || "Pick customer + tube + mandrel"}
                    tone="accent"
                  />
                  <SummaryMetric
                    label="Mandrel ID band"
                    value={`${manufacturingIdBand.avg.toFixed(2)} mm`}
                    detail={`Min ${manufacturingIdBand.min.toFixed(2)} · Max ${manufacturingIdBand.max.toFixed(2)}`}
                  />
                  <SummaryMetric
                    label="Recipe-led OD"
                    value={`${manufacturingRows.find((row) => row.label === "AVG")?.od.toFixed(2)} mm`}
                    detail={`Wall ${recipePreview.totalAllPlyThickness.toFixed(4)} mm`}
                  />
                  <SummaryMetric
                    label="Wet divisor"
                    value={(1 - Number(form.shrinkPercent || 9.0) / 100).toFixed(3)}
                    detail="Default 0.91 from 9% moisture loss"
                  />
                </div>
              </div>

              <details
                className="group rounded-xl border border-[#d7dfdc] bg-[#f8faf9]"
                open={isPrint || isEditable || undefined}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Fixed material assumptions</p>
                    <p className="mt-1 text-sm font-bold text-[#102832]">{targetTotalAdditionsWeight.toFixed(2)} g total additions · {targetAdhesiveWeight.toFixed(2)} g adhesive · {targetParchmentWeight.toFixed(2)} g parchment</p>
                  </div>
                  <span className="rounded-md border border-[#d7dfdc] bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#1e765e] group-open:hidden">Show material split</span>
                  <span className="hidden rounded-md border border-[#d7dfdc] bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#1e765e] group-open:inline-flex">Hide material split</span>
                </summary>
                <div className="space-y-4 border-t border-[#e4ebe8] p-4">
                <div className="border-b border-[#e4ebe8] pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500">Material rule sheet</p>
                      <h3 className="mt-1 text-base font-bold text-[#102832]">One formula, one parchment gate, one adhesive split.</h3>
                    </div>
                    <MasterLinkRow
                      links={[
                        { href: "/masters/adhesives", label: "Adhesives" },
                        { href: "/masters/parchments", label: "Parchments" },
                      ]}
                    />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Wet target = dry target ÷ {(1 - Number(form.shrinkPercent || 9.0) / 100).toFixed(3)}. The {totalMaterialPercent.toFixed(1)}% allowance covers parchment and adhesive together; it is never added twice.
                    {form.parchmentAllowed ? ` Parchment uses ${Number(form.parchmentPercent || 1.5).toFixed(1)}% and adhesive receives the remaining ${Math.max(totalMaterialPercent - Number(form.parchmentPercent || 1.5), 0).toFixed(1)}%.` : ` Parchment is off, so adhesive receives the full ${totalMaterialPercent.toFixed(1)}%.`}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryMetric
                    label="Target wet / dry"
                    value={`${targetWetTube.toFixed(2)} / ${targetDryTube.toFixed(2)} g`}
                    detail={`Dry target ${targetDryTube.toFixed(2)} g with divisor ${(1 - Number(form.shrinkPercent || 9.0) / 100).toFixed(3)}`}
                  />
                  <SummaryMetric
                    label={`${totalMaterialPercent.toFixed(1)}% material allowance`}
                    value={`${targetTotalAdditionsWeight.toFixed(2)} g total`}
                    detail={`${targetAdhesiveWeight.toFixed(2)} g adhesive + ${targetParchmentWeight.toFixed(2)} g parchment · ${targetPaperWeight.toFixed(2)} g wet paper target`}
                  />
                  <SummaryMetric
                    label="Recipe winding / model dry"
                    value={`${liveWetTube.toFixed(2)} / ${liveDryTube.toFixed(2)} g`}
                    detail={hasRecipeSelection ? `${livePaperTotal.toFixed(2)} g geometric paper · ${Number(form.shrinkPercent || 9).toFixed(1)}% model loss` : "No recipe applied yet"}
                  />
                  <SummaryMetric
                    label={measuredDryTube > 0 ? "Measured dry / target" : "Modeled dry band"}
                    value={measuredDryTube > 0 ? `${measuredDryTube.toFixed(2)} / ${targetDryTube.toFixed(2)} g` : `${weightBand.min.toFixed(2)} - ${weightBand.max.toFixed(2)} g`}
                    detail={
                      measuredDryTube > 0
                        ? `${measuredDryTube.toFixed(2)} g measured · ${measuredDryTube - targetDryTube > 0 ? "+" : ""}${(measuredDryTube - targetDryTube).toFixed(2)} g to target`
                        : hasRecipeSelection
                        ? `${liveDryTube.toFixed(2)} g modeled (${liveDryDelta > 0 ? "+" : ""}${liveDryDelta.toFixed(2)} g to target)`
                        : "Apply a recipe to compare against the min/max band"
                    }
                    tone={Math.abs(measuredDryTube > 0 ? measuredDryTube - targetDryTube : liveDryDelta) <= DELTA_ABS_G ? "success" : "accent"}
                  />
                </div>

                <div className="grid gap-3 rounded-xl border border-[#dfe7e3] bg-[#fbfcfb] p-3 lg:grid-cols-[220px_1fr] lg:items-center">
                  <div>
                    <FieldLabel>Measured finished dry weight</FieldLabel>
                    <NumericInput
                      min="0"
                      step="0.01"
                      unit="g"
                      value={inputNumberValue(Number(form.dynamicValues.measured_finished_dry_g || 0))}
                      disabled={!isEditable}
                      onChange={(event) => updateDynamicValue("measured_finished_dry_g", event.target.value)}
                    />
                  </div>
                  <div className="text-xs leading-5 text-slate-600">
                    {measuredDryTube > 0 ? (
                      <>
                        Plant measurement {measuredDryTube.toFixed(2)} g is {measuredDryGap > 0 ? "+" : ""}{measuredDryGap.toFixed(2)} g versus the configured 9% model. It implies {effectiveDryingLossPercent.toFixed(2)}% effective total loss, or {inferredPaperAtConfiguredDivisor.toFixed(2)} g paper at the configured divisor ({inferredPaperAtConfiguredDivisor - livePaperTotal > 0 ? "+" : ""}{(inferredPaperAtConfiguredDivisor - livePaperTotal).toFixed(2)} g versus geometry).
                      </>
                    ) : (
                      <>Optional but recommended: enter the scale reading after drying. The sheet will reconcile measured weight against the geometric paper calculation and configured drying divisor without changing master GSM.</>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#dfe7e3] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Allowed parchment families</p>
                      <p className="mt-1 text-sm text-slate-600">Choose the family pool once. Vendor and color stay downstream.</p>
                    </div>
                    <span className="rounded-full border border-[#dfe7f1] bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {form.parchmentAllowed ? `${selectedParchmentGroups.length || 0} selected` : "Disabled"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!form.parchmentAllowed ? (
                      <p className="text-sm text-slate-500">Parchment is off for this sheet, so no family is applied.</p>
                    ) : parchmentFamilies.length === 0 ? (
                      <p className="text-sm text-slate-500">No parchment families found in master data.</p>
                    ) : (
                      parchmentFamilies.map((group) => {
                        const active = selectedParchmentGroups.includes(group)
                        return (
                          <button
                            key={group}
                            type="button"
                            onClick={() => toggleParchmentGroup(group)}
                            disabled={!isEditable}
                            className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                              active
                                ? "border-[#f0ca74] bg-[#f8ebc7] text-[#83512d]"
                                : "border-[#d6dfeb] bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                            }`}
                          >
                            {group}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#dfe7e3] bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Adhesive breakdown</p>
                      <p className="mt-1 text-sm text-slate-600">Use up to 6 adhesive masters. Their split must total exactly 100% of the fixed adhesive weight.</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                        adhesiveRatioBalanced
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      Ratio {adhesiveRatioTotalValue.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {form.adhesiveComponents.map((component, index) => {
                      const targetComponent = targetAdhesiveComponents[index]
                      return (
                        <div
                          key={`${component.name}-${index}`}
                          className="grid gap-2 rounded-lg border border-[#e4ebe8] bg-[#f8faf9] p-2.5 md:grid-cols-[1.4fr_0.65fr_0.8fr_auto]"
                        >
                          <SmartSelect
                            value={component.name}
                            placeholder="Select adhesive"
                            disabled={!isEditable}
                            emptyLabel="No active adhesive master is available."
                            options={Array.from(
                              new Set(
                                [
                                  ...form.adhesiveComponents.map((row) => row.name).filter(Boolean),
                                  ...activeAdhesives.map(adhesiveMasterLabel),
                                ].filter(Boolean),
                              ),
                            ).map((option) => ({ value: String(option), label: String(option) }))}
                            onChange={(nextValue) => {
                              const master = activeAdhesives.find((item) => adhesiveMasterLabel(item) === nextValue)
                              updateAdhesiveComponent(index, {
                                name: nextValue,
                                adhesive_id: master?.id ? String(master.id) : undefined,
                                solid_content_percent:
                                  master?.solid_content_percent === null || master?.solid_content_percent === undefined
                                    ? null
                                    : Number(master.solid_content_percent),
                              })
                            }}
                          />
                          <input
                            aria-label={`${component.name || `Adhesive ${index + 1}`} split percentage`}
                            type="number"
                            step="0.1"
                            value={optionValue(component.ratio_percent)}
                            disabled={!isEditable}
                            onChange={(event) => updateAdhesiveComponent(index, { ratio_percent: Number(event.target.value || 0) })}
                            className="h-10 rounded-lg border border-[#ccd8d5] bg-white px-3 text-sm disabled:bg-[#f2f5f4]"
                          />
                          <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-[#ccd8d5] bg-white px-3 py-2 text-sm font-semibold text-slate-950">
                            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Applied live</span>
                            <span className="text-right">
                              {Number(targetComponent?.weight_g || 0).toFixed(2)} g
                              <span className="block text-[9px] font-medium text-slate-400">Master solid {component.solid_content_percent ?? "—"}%</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-end">
                            {isEditable ? (
                              <button
                                type="button"
                                onClick={() => removeAdhesiveComponent(index)}
                                disabled={form.adhesiveComponents.length <= 1}
                                className="rounded-full border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {isEditable ? (
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">Combined additions stay {targetTotalAdditionsWeight.toFixed(2)} g: {targetAdhesiveWeight.toFixed(2)} g adhesive + {targetParchmentWeight.toFixed(2)} g parchment. Every adhesive component updates live from its split.</p>
                      <button
                        type="button"
                        onClick={addAdhesiveComponent}
                        disabled={form.adhesiveComponents.length >= 6}
                        className="rounded-full border border-[#d6dfeb] bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Add Component
                      </button>
                    </div>
                  ) : null}
                </div>
                </div>
              </details>
            </div>
          </ClientReqCard>

          <RecipeMixCard>
            <div id="recipe-mix" className="scroll-mt-24" />
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4ebe8] pb-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1e765e]">02 · Recipe mix</p>
                <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#102832]">Paper selection, ply order and actual mass</h3>
                <p className="mt-1 text-xs text-slate-500">Master GSM and geometry stay unchanged; compare the selected recipe directly with the client target.</p>
              </div>
              <MasterLinkRow links={[{ href: "/masters/papers", label: "Papers" }]} />
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl bg-[#102832] text-white" data-testid="spec-sheet-live-builder">
                  <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#86d2bb]">Applied paper recipe</p>
                      <p className="mt-1.5 text-base font-black leading-snug tracking-[-0.02em] sm:text-lg">{comboRuleTitle}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <span className={`rounded-md border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${recipePaperCountValid ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-amber-300/20 bg-amber-300/10 text-amber-200"}`}>
                        {recipeDistinctPaperCount} papers
                      </span>
                      <span className={`rounded-md border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${recipePlyCountValid ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-rose-300/20 bg-rose-300/10 text-rose-200"}`}>
                        {recipeTotalPlyCount} / {RECIPE_MAX_PLIES} plies
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#9bb7bd]">
                    Use up to {RECIPE_MAX_PAPERS} distinct paper masters · maximum {RECIPE_MAX_PLIES} total plies
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-300">
                    Each paper weight comes directly from its master GSM, bulk, tube geometry, and ply count. The client wet target is a benchmark only; selected papers are never scaled to force a match.
                  </p>
                  </div>
                  <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-5" data-testid="spec-sheet-preview-rail">
                    <div className="border-white/10 px-4 py-3 xl:border-r">
                      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Paper total</p>
                      <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-white">{livePaperTotal.toFixed(2)} g</p>
                      <p className="mt-1 text-[10px] text-slate-400">Actual selected papers</p>
                    </div>
                    <div className="border-t border-white/10 px-4 py-3 sm:border-l sm:border-t-0 xl:border-l-0 xl:border-r">
                      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">ID / OD delta</p>
                      <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-white">
                        {liveIdDeltaMm >= 0 ? "+" : ""}{liveIdDeltaMm.toFixed(2)} / {liveOdDeltaMm >= 0 ? "+" : ""}{liveOdDeltaMm.toFixed(2)} mm
                      </p>
                      <p className="mt-1 text-[10px] text-emerald-300">Modeled geometry vs client ID / OD</p>
                    </div>
                    <div className="border-t border-white/10 px-4 py-3 xl:border-r xl:border-t-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Main paper GSM helper</p>
                      <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-white">{mainPaperGsmGuide.toFixed(0)} GSM <span className="text-sm text-[#86d2bb]">±50</span></p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-400">{wetBambooThicknessMm.toFixed(3)} mm ÷ 0.142 · display guide only</p>
                    </div>
                    <div className="border-t border-white/10 bg-[#173b47] px-4 py-3 sm:border-l xl:border-l-0 xl:border-r xl:border-t-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-cyan-100/70">{measuredDryTube > 0 ? "Measured dry" : "Dry model variance"}</p>
                      <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-cyan-100">{measuredDryTube > 0 ? measuredDryTube.toFixed(2) : `${liveDryDelta > 0 ? "+" : ""}${liveDryDelta.toFixed(2)}`} g</p>
                      <p className="mt-1 text-[10px] text-cyan-100/70">{measuredDryTube > 0 ? `Model gap ${measuredDryGap > 0 ? "+" : ""}${measuredDryGap.toFixed(2)} g` : `Target ${targetDryTube.toFixed(2)} g · model ${liveDryTube.toFixed(2)} g`}</p>
                    </div>
                    <div className="border-t border-white/10 bg-[#173b47] px-4 py-3 xl:border-t-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-cyan-100/70">Wet / dry model</p>
                      <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-cyan-100">{liveWetTube.toFixed(2)} / {liveDryTube.toFixed(2)} g</p>
                      <p className="mt-1 text-[10px] text-cyan-100/70">Winding mass / modeled finished dry</p>
                    </div>
                  </div>
                  {hasRecipeSelection ? <p className="border-t border-white/10 px-4 py-2.5 text-[10px] leading-4 text-slate-400">Wet target {targetWetTube.toFixed(2)} g − combined additions {targetTotalAdditionsWeight.toFixed(2)} g = wet paper target {targetPaperWeight.toFixed(2)} g. Current geometric paper is {livePaperTotal.toFixed(2)} g; weights are never auto-scaled.</p> : null}
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#d7dfdc]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#e8efed] text-[9px] uppercase tracking-[0.13em] text-slate-600">
                      <tr>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3 text-left">Code</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3 text-left">Variety</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">GSM</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">BF / Ply</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">Thick / Ply</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">Actual Paper Weight</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">Ply</th>
                        <th className="border-b border-r border-[#d9e2ef] px-3 py-3">Ply No.</th>
                        {isEditable ? <th className="border-b border-[#d9e2ef] px-3 py-3">Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {form.recipeRows.map((row, rowIndex) => {
                        const previewRow = Array.isArray(previewSummary.ply_details)
                          ? previewSummary.ply_details.find((item: any) => item.paper_id === row.paper_id && Number(item.gsm || 0) === Number(paperMap.get(row.paper_id)?.gsm || 0))
                          : null
                        return (
                          <tr key={row.id} className="border-b border-[#edf2f7] last:border-b-0">
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-xs font-semibold text-slate-900">{row.code || "-"}</td>
                            <td className="min-w-64 border-r border-[#edf2f7] px-3 py-3">
                              <PaperPicker
                                value={row.paper_id}
                                papers={activePapers}
                                disabled={!isEditable}
                                onChange={(paperId) => updateRecipeRow(row.id, { paper_id: paperId })}
                              />
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center font-semibold text-slate-800">
                              {Number(previewRow?.gsm || row.gsm || 0).toFixed(0)}
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center">
                              <div className="font-semibold text-slate-800">{Number(row.bfPerPly || 0).toFixed(2)}</div>
                              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Locked</div>
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center">
                              <div className="font-semibold text-slate-800">{Number(row.thicknessPerPly || 0).toFixed(4)} mm</div>
                              <div className="text-[10px] text-slate-400">
                                Bulk {Number(row.bulkFactor || 0).toFixed(2)} - Ply bond {Number(row.plyBond || 0).toFixed(2)}
                              </div>
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center">
                              <div className="font-semibold text-slate-950">{Number(previewRow?.weightG || 0).toFixed(2)} g</div>
                              <div className="mt-1 text-[10px] text-slate-400">From master + geometry</div>
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center">
                              <NumericInput
                                data-testid={rowIndex === 0 ? "spec-sheet-recipe-ply-1" : undefined}
                                min="1"
                                max={String(RECIPE_MAX_PLIES)}
                                step="1"
                                value={optionValue(row.plyCount)}
                                disabled={!isEditable}
                                onChange={(event) => updateRecipeRow(row.id, { plyCount: Math.max(1, Number(event.target.value || 1)) })}
                                className="w-16 px-2 text-xs"
                              />
                            </td>
                            <td className="border-r border-[#edf2f7] px-3 py-3 text-center">
                              <input
                                type="text"
                                value={row.positionsText}
                                onChange={(event) => updateRecipeRow(row.id, { positionsText: event.target.value })}
                                disabled={!isEditable}
                                placeholder={encodePlyPositions(parsePlyPositions(row.positionsText, row.plyCount))}
                                className="h-10 w-24 rounded-lg border border-[#ccd8d5] bg-white px-2 text-xs disabled:bg-[#f2f5f4]"
                              />
                            </td>
                            {isEditable ? (
                              <td className="px-3 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeRecipeRow(row.id)}
                                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                                >
                                  Remove
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        )
                      })}
                      <tr className="bg-[#f8fafc] font-semibold text-slate-800">
                        <td className="px-3 py-3" colSpan={2}>
                          TOTAL-ALL-PLY
                        </td>
                        <td className="px-3 py-3 text-center">{recipePreview.totalAllPlyGsm}</td>
                        <td className="px-3 py-3 text-center">{recipePreview.totalAllPlyBf.toFixed(2)}</td>
                        <td className="px-3 py-3 text-center">{recipePreview.totalAllPlyThickness.toFixed(4)}</td>
                        <td className="px-3 py-3 text-center">{Number(previewSummary.paper_total_g || 0).toFixed(2)}</td>
                        <td className="px-3 py-3 text-center">{recipePreview.totalPlyCount}</td>
                        <td className="px-3 py-3 text-center">-</td>
                        {isEditable ? <td className="px-3 py-3 text-center">-</td> : null}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="grid overflow-hidden rounded-xl border border-[#d7dfdc] bg-white sm:grid-cols-2 xl:grid-cols-5" aria-label="Selected recipe total compared with client target">
                  <SummaryMetric label="Selected paper" value={`${livePaperTotal.toFixed(2)} g`} detail="Actual master + geometry total" />
                  <SummaryMetric label="Combined additions" value={`${targetTotalAdditionsWeight.toFixed(2)} g`} detail={`${targetAdhesiveWeight.toFixed(2)} adhesive + ${targetParchmentWeight.toFixed(2)} parchment`} />
                  <SummaryMetric label="Winding mass" value={`${liveWetTube.toFixed(2)} g`} detail={`Paper + combined ${totalMaterialPercent.toFixed(1)}% allowance`} />
                  <SummaryMetric label="Modeled finished dry" value={`${liveDryTube.toFixed(2)} g`} detail={`${Number(form.shrinkPercent || 9).toFixed(1)}% configured loss · target ${targetDryTube.toFixed(2)} g`} />
                  <SummaryMetric label={measuredDryTube > 0 ? "Measured dry gap" : "Dry model variance"} value={`${(measuredDryTube > 0 ? measuredDryGap : liveDryDelta) > 0 ? "+" : ""}${(measuredDryTube > 0 ? measuredDryGap : liveDryDelta).toFixed(2)} g`} detail={measuredDryTube > 0 ? `${measuredDryTube.toFixed(2)} measured vs ${liveDryTube.toFixed(2)} model` : `${liveDryTube.toFixed(2)} model vs ${targetDryTube.toFixed(2)} target`} tone={Math.abs(measuredDryTube > 0 ? measuredDryGap : liveDryDelta) <= DELTA_ABS_G ? "success" : "accent"} />
                </div>
                {isEditable ? (
                  <div className="flex justify-between gap-3">
                    <p className="text-sm text-slate-500">Paper rows drive wall thickness, tube paper weight, and the manufacturing output.</p>
                    <button
                      type="button"
                      onClick={addRecipeRow}
                      disabled={recipeTotalPlyCount >= RECIPE_MAX_PLIES || form.recipeRows.length >= RECIPE_MAX_PAPERS}
                      className="rounded-lg border border-[#d7dfdc] bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add recipe row
                    </button>
                  </div>
                ) : null}
              </div>

              {isSpecMathUpdating ? (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-800">
                  Recalculating recipe math after input settles. You can keep typing.
                </div>
              ) : null}
            </div>
          </RecipeMixCard>

          <TubeCalcCard>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4ebe8] pb-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1e765e]">03 · Manufacturing handoff</p>
                <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#102832]">Finished goods and process consumption stay separate</h3>
                <p className="mt-1 text-xs text-slate-500">ID comes from the mandrel, OD comes from the wall, and bamboo output follows the live recipe.</p>
              </div>
              <span className="rounded-md border border-[#b9e4d1] bg-[#e4f6ed] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#166b51]">Ready for job card</span>
            </div>
            <div className="mt-4 space-y-4">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <SummaryMetric
                  label="Mandrel ID band"
                  value={`${manufacturingIdBand.avg.toFixed(2)} mm`}
                  detail={`Min ${manufacturingIdBand.min.toFixed(2)} · Max ${manufacturingIdBand.max.toFixed(2)}`}
                />
                <SummaryMetric
                  label="Wall / OD"
                  value={`${recipePreview.totalAllPlyThickness.toFixed(4)} / ${manufacturingRows.find((row) => row.label === "AVG")?.od.toFixed(2)} mm`}
                  detail="OD = ID + 2 × wall"
                />
                <SummaryMetric
                  label="Winding / modeled dry"
                  value={`${liveWetTube.toFixed(2)} / ${liveDryTube.toFixed(2)} g`}
                  detail={`Process / ${Number(form.shrinkPercent || 9).toFixed(1)}% loss model · ${livePaperTotal.toFixed(2)} g paper · trim excluded`}
                />
                <SummaryMetric
                  label="Whole wound bamboo"
                  value={`${wholeBambooWetWeightG.toFixed(2)} / ${wholeBambooDryWeightG.toFixed(2)} g`}
                  detail={`${finishedBambooLengthMm.toFixed(0)} mm finished + ${totalTrimMm.toFixed(0)} mm trim`}
                />
              </div>

              <div className="rounded-xl border border-[#bed4d7] bg-[#f8faf9] p-3" data-testid="bamboo-weight-bridge">
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#d7dfdc] pb-2.5">
                  <div>
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#1e765e]">Bamboo weight bridge</p>
                    <h4 className="mt-1 text-sm font-bold text-[#102832]">Finished tubes + trim / offcut = whole bamboo</h4>
                  </div>
                  <p className="text-xs text-slate-500">All values show wet / dry weight.</p>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto_0.72fr_auto_1fr] lg:items-stretch">
                  <div className="rounded-xl border border-[#b9e4d1] bg-[#e4f6ed] p-3">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#166b51]">Finished goods only</p>
                    <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-[#102832]">{bambooWetWeightG.toFixed(2)} / {bambooDryWeightG.toFixed(2)} g</p>
                    <p className="mt-1 text-xs text-slate-500">{tubesPerBamboo} × {Number(selectedTube?.length_mm || form.averages.length || 0).toFixed(0)} mm = {finishedBambooLengthMm.toFixed(0)} mm</p>
                  </div>
                  <div className="flex items-center justify-center text-2xl font-light text-slate-400">+</div>
                  <div className="rounded-xl border border-[#ead39b] bg-[#fbf1d9] p-3">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#805a09]">Trim / offcut · not FG</p>
                    <p className="mt-1.5 text-xl font-black tracking-[-0.035em] text-[#102832]">{bambooTrimWetWeightG.toFixed(2)} / {bambooTrimDryWeightG.toFixed(2)} g</p>
                    <p className="mt-1 text-xs text-slate-500">{fixedEndTrimMm.toFixed(0)} mm end trim{residualOffcutMm > 0 ? ` + ${residualOffcutMm.toFixed(0)} mm residual` : ""}</p>
                  </div>
                  <div className="flex items-center justify-center text-2xl font-light text-slate-400">=</div>
                  <div className="rounded-xl border border-[#102832] bg-[#102832] p-3 text-white">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#afc4c8]">Whole wound bamboo</p>
                    <p className="mt-1.5 text-xl font-black tracking-[-0.035em]">{wholeBambooWetWeightG.toFixed(2)} / {wholeBambooDryWeightG.toFixed(2)} g</p>
                    <p className="mt-1 text-xs text-cyan-100/70">Full {selectedBambooLengthMm.toFixed(0)} mm before trim removal</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  Finished tube weight never includes trim. Whole bamboo weight is used only for total wound material and consumption planning, so stock and finished-goods weights no longer mix.
                </p>
              </div>

              <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
                <div className="overflow-hidden rounded-xl border border-[#dfe7e3] bg-[#fbfcfb]">
                  <div className="border-b border-[#e4ebe8] px-4 py-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Manufacturing specification</p>
                    <p className="mt-1 text-xs text-slate-600">Average is the live working size. Min/max stay tied to mandrel tolerance and recipe wall.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#e8efed] text-[9px] uppercase tracking-[0.13em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Parameter</th>
                          <th className="px-4 py-3 text-right">Min</th>
                          <th className="px-4 py-3 text-right">Avg</th>
                          <th className="px-4 py-3 text-right">Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manufacturingSpecRows.map((row) => (
                          <tr key={row.label} className="border-t border-[#e4ebf3]">
                            <td className="px-4 py-3 font-semibold text-slate-700">{row.label}</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.values[0]}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-950">{row.values[1]}</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.values[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-[#dfe7e3] bg-[#f8faf9] p-3">
                  <SectionLabel title="Bamboo and output logic" subtitle="This block is what moves downstream into the job card." />
                  <SummaryMetric label="Selected bamboo" value={`${selectedBambooLengthMm.toFixed(0)} mm`} detail={`${finishedBambooLengthMm.toFixed(0)} mm finished · ${totalTrimMm.toFixed(0)} mm trim`} />
                  <SummaryMetric label="Tubes / bamboo" value={`${tubesPerBamboo} pcs`} detail={`${Number(selectedTube?.length_mm || form.averages.length || 0).toFixed(0)} mm finished length each`} />
                  <SummaryMetric label="Actual wet / mm" value={`${Number(previewSummary.weight_per_mm_g || 0).toFixed(4)} g`} detail={`${Number(previewSummary.paper_required_g || 0).toFixed(2)} g target paper / tube`} />
                </div>
              </div>
            </div>
          </TubeCalcCard>
        </div>
      </div>

      <NotchingCard forceOpen={isPrint}>
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4 rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
            <SectionLabel title="Notch + Tooling + Setup" subtitle="Master-linked tooling and measured geometry that carry into the job card and print sheet." />
            <MasterLinkRow links={[{ href: "/masters/tools", label: "Open tools" }, { href: "/masters/mandrels", label: "Mandrel setup" }]} />
            <div className="grid gap-2 sm:grid-cols-3">
              <SummaryMetric
                label="Tools master"
                value={selectedNotchToolEntries.length ? `${selectedNotchToolEntries.filter((entry) => entry.tool_id).length} / ${selectedNotchToolEntries.length} linked` : notchSetupRequested ? "Tool required" : "Not configured"}
                detail={selectedNotchToolEntries.length ? "Every selected tool must be active" : notchSetupRequested ? "Choose an active tool from Tools master" : "Leave blank when the tube has no notch"}
                tone={notchToolsLinked ? "success" : "accent"}
              />
              <SummaryMetric
                label="Notch distance"
                value={notchSetupRequested ? `${computedNotchDiagram.notchDistanceMm.toFixed(2)} mm` : "Not configured"}
                detail={notchSetupRequested ? `From start edge · tube ${tubeLengthMm.toFixed(2)} mm` : `Tube ${tubeLengthMm.toFixed(2)} mm`}
                tone={notchGeometryValid ? "success" : "accent"}
              />
              <SummaryMetric
                label="Notch depth"
                value={notchSetupRequested ? `${computedNotchDiagram.notchDepthMm.toFixed(2)} mm` : "Not configured"}
                detail={notchSetupRequested ? (form.dynamicValues.notch_direction ? String(form.dynamicValues.notch_direction) : "Direction not selected") : "No notch geometry saved"}
                tone={notchGeometryValid ? "success" : "accent"}
              />
            </div>
            {notchSetupRequested && (!notchGeometryValid || !notchToolsLinked) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Complete master-linked tools, direction, distance and depth. Distance must be greater than zero and no longer than the finished tube.
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-4">
              {renderScalarField("notch_type", "Notch")}
              {renderScalarField("notching_blade", "Blade")}
              {renderScalarField("notching_holder", "Holder")}
              {renderScalarField("v_flat", "V + Flat")}
              {renderScalarField("punch", "Punch")}
              {renderScalarField("notch_direction", "Direction")}
              {renderScalarField("notch_distance_mm", "Notch Distance", "number", "Distance")}
              {renderScalarField("notch_depth_mm", "Notch Depth", "number", "Depth")}
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
        </div>
      </NotchingCard>

      <PackingCard forceOpen={isPrint}>
        <SectionLabel title="Packing" subtitle="Master-backed floor quantities in PCS with inward-weight equivalents." />
        <MasterLinkRow links={[{ href: "/masters/packaging", label: "Packaging master" }]} />
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <div className="rounded-xl border border-[#d7dfdc] bg-[#f8faf9] p-3">
            <FieldLabel>Box Master</FieldLabel>
            <div className="mt-1">
              <SmartSelect
                value={optionValue(form.dynamicValues.box_code || form.dynamicValues.box)}
                disabled={!isEditable}
                placeholder="Select box"
                emptyLabel="No active box master is available."
                options={activePackagingBoxes.map((box) => ({
                  value: String(box.code || ""),
                  label: String(box.code || "Unnamed box"),
                  meta: `${box.size_label || "Size pending"} · ${Number(box.length_mm || 0)} × ${Number(box.width_mm || 0)} × ${Number(box.height_mm || 0)} mm`,
                }))}
                onChange={(value) => updateDynamicValue("box_code", value)}
              />
            </div>
            <p className="mt-2 text-xs font-bold text-[#102832]">{selectedPackagingBox?.size_label || "Select a box to see its size"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {selectedPackagingBox
                ? `${Number(selectedPackagingBox.length_mm || 0)} × ${Number(selectedPackagingBox.width_mm || 0)} × ${Number(selectedPackagingBox.height_mm || 0)} mm · ${Number(selectedPackagingBox.weight_kg || 0).toFixed(4)} kg/pc`
                : "Dimensions and unit weight come from Packaging Master."}
            </p>
          </div>
          <div className="rounded-xl border border-[#d7dfdc] bg-[#f8faf9] p-3">
            <FieldLabel>Plastic SKU</FieldLabel>
            <div className="mt-1">
              <SmartSelect
                value={optionValue(form.dynamicValues.plastic_sku)}
                disabled={!isEditable}
                placeholder="Select plastic SKU"
                emptyLabel="No active plastic master is available."
                options={activePackagingPlasticSheets.map((plastic) => ({
                  value: String(plastic.sku || ""),
                  label: String(plastic.sku || "Unnamed plastic"),
                  meta: `${plastic.size_label || "Size pending"} · ${Number(plastic.weight_kg || 0).toFixed(4)} kg/pc`,
                }))}
                onChange={(value) => updateDynamicValue("plastic_sku", value)}
              />
            </div>
            <p className="mt-2 text-xs font-bold text-[#102832]">{selectedPackagingPlastic?.size_label || "Select plastic to see its detail"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{selectedPackagingPlastic ? `${Number(selectedPackagingPlastic.weight_kg || 0).toFixed(4)} kg per pc · floor issue in PCS` : "Per-piece weight converts PCS use back to inward kg."}</p>
          </div>
          <div className="rounded-xl border border-[#d7dfdc] bg-[#f8faf9] p-3">
            <FieldLabel>Fadda SKU</FieldLabel>
            <div className="mt-1">
              <SmartSelect
                value={optionValue(form.dynamicValues.fadda_sku)}
                disabled={!isEditable}
                placeholder="Select fadda SKU"
                emptyLabel="No active fadda master is available."
                options={activePackagingFadda.map((fadda) => ({
                  value: String(fadda.sku || ""),
                  label: String(fadda.sku || "Unnamed fadda"),
                  meta: `${Number(fadda.weight_kg || 0).toFixed(4)} kg/pc`,
                }))}
                onChange={(value) => updateDynamicValue("fadda_sku", value)}
              />
            </div>
            <p className="mt-2 text-xs font-bold text-[#102832]">{selectedPackagingFadda?.sku || "Select fadda to see its detail"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{selectedPackagingFadda ? `${Number(selectedPackagingFadda.weight_kg || 0).toFixed(4)} kg per pc · floor issue in PCS` : "Per-piece weight converts PCS use back to inward kg."}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {renderScalarField("qty_per_box", "Qty / Box", "number")}
          {renderScalarField("bopp_required", "BOPP Required")}
          {renderScalarField("plastic_per_box", "Plastic PCS / Box", "number")}
          {renderScalarField("fadda_per_box", "Fadda PCS / Box", "number")}
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
          <div className="space-y-1">
            <FieldLabel>Special Instructions</FieldLabel>
            <textarea
              value={optionValue(form.dynamicValues.special_instructions)}
              onChange={(event) => updateDynamicValue("special_instructions", event.target.value)}
              disabled={!isEditable}
              rows={2}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[#d7dfdc] bg-white text-xs">
            <div className="border-r border-[#d7dfdc] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Plastic / box</p>
              <p className="mt-1 font-black text-[#102832]">{Number(form.dynamicValues.plastic_per_box || 0)} pcs · {Number(form.dynamicValues.plastic_weight_per_box_kg || 0).toFixed(4)} kg</p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Fadda / box</p>
              <p className="mt-1 font-black text-[#102832]">{Number(form.dynamicValues.fadda_per_box || 0)} pcs · {Number(form.dynamicValues.fadda_weight_per_box_kg || 0).toFixed(4)} kg</p>
            </div>
          </div>
        </div>
      </PackingCard>

      {!isCreate ? (
        <section
          id="review-approve"
          data-print-hidden="true"
          className="scroll-mt-36 rounded-2xl border border-[#b9e4d1] bg-[#f4fbf7] p-4 shadow-[0_12px_35px_rgba(25,51,57,0.06)]"
        >
          <SectionLabel title="04 · Review & Approve" subtitle="One final release gate for the selected plant." />
          <div className="grid gap-px overflow-hidden rounded-xl border border-[#b9e4d1] bg-[#b9e4d1] lg:grid-cols-[0.85fr_1.3fr_0.95fr_0.85fr]">
            <div className={`min-h-32 p-3.5 ${draftSaved ? "bg-white text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em]">Step 1 · {draftSaved ? "Complete" : "Pending"}</p>
              <h3 className="mt-1 text-sm font-bold text-[#102832]">Draft saved</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                {draftSaved ? `Spec v${specDocument?.spec?.version || 1} is stored as a draft/revision record.` : "Save the sheet first to create a draft record."}
              </p>
            </div>
            <div className={`min-h-32 p-3.5 ${reviewChecksPass ? "bg-white text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em]">Step 2 · {reviewChecksPass ? "Complete" : "Check"}</p>
              <h3 className="mt-1 text-sm font-bold text-[#102832]">Business checks</h3>
              <div className="mt-2 grid gap-1 text-[10px] sm:grid-cols-2">
                <p className={adhesiveRatioBalanced ? "text-emerald-700" : "text-rose-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{adhesiveRatioBalanced ? "Pass" : "Fix"}</span>Adhesive {adhesiveRatioTotalValue.toFixed(0)}%</p>
                <p className={materialSplitValid ? "text-emerald-700" : "text-rose-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{materialSplitValid ? "Pass" : "Fix"}</span>Additions include parchment</p>
                <p className={selectedTubeMatchesMandrel ? "text-emerald-700" : "text-rose-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{selectedTubeMatchesMandrel ? "Pass" : "Fix"}</span>Mandrel band</p>
                <p className={hasRecipeSelection ? "text-emerald-700" : "text-rose-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{hasRecipeSelection ? "Pass" : "Fix"}</span>Recipe selected</p>
                <p className={footerComplete ? "text-emerald-700" : "text-amber-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{footerComplete ? "Pass" : "Fix"}</span>Footer</p>
                <p className={effectiveBalance.withinBand ? "text-emerald-700" : "text-rose-700"}><span className="mr-1 rounded bg-[#1e765e] px-1 py-0.5 text-[8px] font-bold uppercase text-white">{effectiveBalance.withinBand ? "Pass" : "Fix"}</span>Weight band</p>
              </div>
            </div>
            <div className="min-h-32 bg-white p-3.5 text-slate-700">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#805a09]">Step 3 · {currentStatus === "review" ? "With Owner" : approvalComplete ? "Complete" : reviewChecksPass ? "Ready" : "Pending"}</p>
              <h3 className="mt-1 text-sm font-bold text-[#102832]">Owner / Admin review</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                {approvalComplete
                  ? "Owner approval is complete."
                  : currentStatus === "review"
                    ? `Locked and waiting for an Owner or Admin in ${writePlantLabel}.`
                    : "Submit the checked draft to lock it for approval review."}
              </p>
              {currentStatus === "draft" ? (
                <button
                  type="button"
                  onClick={handleSubmitReview}
                  disabled={!canSubmitReview || submitSpecForReview.isPending || isEditable}
                  className="mt-2 rounded-lg border border-[#ead39b] bg-[#fbf1d9] px-3 py-2 text-xs font-bold text-[#805a09] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit for Review
                </button>
              ) : null}
              {currentStatus === "review" && canApproveAsSuperUser ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={!canApprove || approveSpec.isPending}
                  className="mt-2 rounded-lg border border-[#b9e4d1] bg-[#e4f6ed] px-3 py-2 text-xs font-bold text-[#166b51] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve &amp; Go Live
                </button>
              ) : null}
              {specDocument?.spec?.active === false || currentStatus === "obsolete" ? (
                <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600">
                  This version is disabled/read-only. Edit creates a new active version instead of overwriting history.
                </p>
              ) : null}
            </div>
            <div className={`min-h-32 p-3.5 ${approvalComplete ? "bg-[#e4f6ed] text-[#166b51]" : "bg-white text-slate-600"}`}>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em]">Step 4 · {approvalComplete ? "Live" : "Pending"}</p>
              <h3 className="mt-1 text-sm font-bold text-[#102832]">Production release</h3>
              <p className="mt-1 text-[11px] leading-4">
                {approvalComplete ? "Live for planning, job cards and floor execution." : "Owner or Admin approval releases this version downstream."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <ValidationFooter forceOpen={isPrint}>
        <SectionLabel title="Validation" subtitle="Footer block for print and controlled release." />
        <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
          <div className="space-y-1">
            <FieldLabel>Total additions %</FieldLabel>
            <input
              type="number"
              step="0.1"
              value={optionValue(form.dynamicValues.glue_base_percent || "12.5")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dynamicValues: { ...current.dynamicValues, glue_base_percent: event.target.value },
                  adhesiveComponents: current.adhesiveComponents.map((component) => ({
                    ...component,
                    base_percent: Number(event.target.value || 0),
                  })),
                }))
              }
              disabled={!isEditable}
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Parchment share of dry %</FieldLabel>
            <input
              type="number"
              step="0.1"
              value={optionValue(form.parchmentPercent || "1.5")}
              onChange={(event) => setForm((current) => ({ ...current, parchmentPercent: event.target.value }))}
              disabled={!isEditable}
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Moisture Loss %</FieldLabel>
            <input
              type="number"
              step="0.1"
              value={form.shrinkPercent}
              onChange={(event) => setForm((current) => ({ ...current, shrinkPercent: event.target.value }))}
              disabled={!isEditable}
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="flex items-end">
            {isEditable ? (
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    parchmentPercent: String(specDefaults?.parchment_percent ?? 1.5),
                    shrinkPercent: String(specDefaults?.moisture_loss_percent ?? 9),
                    dynamicValues: { ...current.dynamicValues, glue_base_percent: String(specDefaults?.adhesive_percent ?? 12.5) },
                    adhesiveComponents: current.adhesiveComponents.map((component) => ({
                      ...component,
                      base_percent: Number(specDefaults?.adhesive_percent ?? 12.5),
                    })),
                  }))
                }
                className="h-10 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                Reset Defaults
              </button>
            ) : null}
          </div>
        </div>
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
            <p className={adhesiveRatioBalanced ? "text-emerald-700" : "text-rose-700"}>
              Adhesive: {adhesiveRatioBalanced ? "100% split" : `${adhesiveRatioTotalValue.toFixed(0)}% split`}
            </p>
            <p className={selectedTubeMatchesMandrel ? "text-emerald-700" : "text-rose-700"}>
              Mandrel/tube: {selectedTubeMatchesMandrel ? "pass" : "outside +/- 1 mm"}
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
      </ValidationFooter>
      {!isPrint ? (
        <div data-print-hidden="true" className="sticky bottom-3 z-40 mx-auto flex w-[min(100%,1180px)] items-center gap-2 overflow-x-auto rounded-xl border border-[#294953] bg-[#102832]/95 px-2.5 py-2 text-white shadow-[0_16px_45px_rgba(10,34,43,0.28)] backdrop-blur">
          <span className={`shrink-0 rounded-md px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] ${releaseBlockers.length ? "bg-amber-300/15 text-amber-200" : "bg-emerald-300/15 text-emerald-200"}`}>
            {releaseBlockers.length ? `${releaseBlockers.length} blocker${releaseBlockers.length === 1 ? "" : "s"}` : "Release ready"}
          </span>
          <p className="min-w-[180px] flex-1 truncate text-[10px] text-slate-300">
            {releaseBlockers.length ? releaseBlockers.join(" · ") : currentStatus === "approved" ? "Owner approved · live for production" : "All business checks pass"}
          </p>
          <div className="flex shrink-0 items-center gap-3 border-l border-white/10 pl-3 text-[10px]">
            <span><span className="text-slate-400">Paper</span> <strong>{livePaperTotal.toFixed(2)} g</strong></span>
            <span><span className="text-slate-400">Wet / dry</span> <strong>{liveWetTube.toFixed(2)} / {liveDryTube.toFixed(2)} g</strong></span>
            <span className={Math.abs(liveDryDelta) <= DELTA_ABS_G ? "text-emerald-300" : "text-rose-300"}><span className="text-slate-400">Variance</span> <strong>{liveDryDelta >= 0 ? "+" : ""}{liveDryDelta.toFixed(2)} g</strong></span>
            <span className="rounded bg-white/10 px-2 py-1 font-bold">±{DELTA_ABS_G} g</span>
          </div>
        </div>
      ) : null}
    </SpecSheetWorkspace>
	  )
	}
