"use client"

import Link from "next/link"
import { CheckCircle2, ExternalLink, Printer, Save, Smartphone } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useIssueToolAsset, useReelIssues, useToolAssets } from "@/hooks/use-inventory"
import { useEmployees, useMandrels, useShifts } from "@/hooks/use-master-data"
import { displayPlantScope } from "@/lib/plant-scope"
import {
  useCompleteStageEntry,
  useMachines,
  usePlanningJobCard,
  useSaveStageDraft,
} from "@/hooks/use-production"

type DocumentMode = "view" | "print" | "supervisor"
type StageName = "SLITTING" | "WINDER" | "OVEN" | "PROCESS" | "PACKING" | "QC" | "DISPATCH"

const STAGES: StageName[] = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
const PLANNER_GATED_STAGES: StageName[] = ["SLITTING", "WINDER", "OVEN", "PROCESS"]
const STAGES_REQUIRING_SHIFT: StageName[] = ["WINDER", "PROCESS"]
const LATE_ENTRY_THRESHOLD_HOURS = 6

function computeHoursLate(endTimeValue: any): number {
  if (!endTimeValue) return 0
  const endDate = new Date(String(endTimeValue))
  if (!Number.isFinite(endDate.getTime())) return 0
  const diffMs = Date.now() - endDate.getTime()
  if (diffMs <= 0) return 0
  return diffMs / (1000 * 60 * 60)
}

type Props = {
  jobCardId?: string
  mode: DocumentMode
}

function buildProductionEntryUrl(jobCardId?: string) {
  if (typeof window !== "undefined" && window.location?.origin) {
    const id = jobCardId || ""
    return `${window.location.origin}/production/supervisor-entry?job_card_id=${encodeURIComponent(id)}`
  }
  return `/production/supervisor-entry?job_card_id=${encodeURIComponent(jobCardId || "")}`
}

function formatNumber(value: any, digits = 2) {
  if (value === null || value === undefined || value === "") return "-"
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(digits).replace(/\.?0+$/, "")
}

const printValue = formatNumber

function formatYesNo(value: any) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (["true", "1", "yes", "y"].includes(normalized)) return "Yes"
  if (["false", "0", "no", "n"].includes(normalized)) return "No"
  return value ? String(value) : ""
}

function statusChipClass(status: string) {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-700 border-emerald-200"
    case "ASSIGNED":
      return "bg-cyan-100 text-cyan-700 border-cyan-200"
    case "RUNNING":
      return "bg-amber-100 text-amber-700 border-amber-200"
    default:
      return "bg-slate-100 text-slate-700 border-slate-200"
  }
}

function blankWinderEntry() {
  return {
    winder_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    winding_meters_produced: "",
    accepted_winding_meters: "",
    reject_winding_meters: "",
    bamboo_count_produced: "",
    accepted_bamboo_count: "",
    reject_bamboo_count: "",
    reject_reason_code: "",
    dimension_readings: Array.from({ length: 4 }, () => ({
      length: "",
      id: "",
      od: "",
      weight: "",
      cs: "",
    })),
  }
}

function blankSlittingEntry() {
  return {
    slitter_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    parent_reel_id: "",
    child_reel_ids_text: "",
    slit_output_weight_kg: "",
    trim_wastage_weight_kg: "",
  }
}

function blankOvenEntry() {
  return {
    oven_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    bamboo_count_in: "",
    bamboo_count_out: "",
    pre_oven_weight_kg: "",
    post_oven_weight_kg: "",
    moisture_before: "",
    moisture_after: "",
  }
}

function blankProcessEntry() {
  return {
    process_line_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    process_qty: "",
    reject_qty: "",
    reject_reason: "",
    final_measurements: {
      id: "",
      od: "",
      length: "",
      weight: "",
      cs: "",
      notch_distance: "",
      notch_depth: "",
    },
  }
}

function blankPackingEntry() {
  return {
    packing_type: "",
    qty_per_bundle: "",
    total_packed_qty: "",
    fg_item_id: "",
    dispatch_date: "",
    dispatched_qty: "",
    pending_qty: "",
    supervisor_sign: "",
  }
}

function blankQcEntry() {
  return {
    inspector_name: "",
    qc_sign: "",
    sample_size: "",
    accepted_qty: "",
    hold_qty: "",
    disposition: "",
    release_reference: "",
  }
}

function blankDispatchEntry() {
  return {
    dispatch_request_id: "",
    dispatch_line_ref: "",
    dispatch_qty: "",
    vehicle_no: "",
    dispatch_date: "",
  }
}

function normalizeStageEntry(stage: StageName, entry: any) {
  const source = entry && typeof entry === "object" ? entry : {}
  if (stage === "SLITTING") {
    return { ...blankSlittingEntry(), ...source }
  }
  if (stage === "WINDER") {
    const base = blankWinderEntry()
    const rows = Array.isArray(source.dimension_readings) ? source.dimension_readings : []
    return {
      ...base,
      ...source,
      dimension_readings: Array.from({ length: Math.max(4, rows.length || 0) }, (_, index) => ({
        ...base.dimension_readings[0],
        ...(rows[index] || {}),
      })),
    }
  }
  if (stage === "OVEN") {
    return { ...blankOvenEntry(), ...source }
  }
  if (stage === "PROCESS") {
    return {
      ...blankProcessEntry(),
      ...source,
      final_measurements: {
        ...blankProcessEntry().final_measurements,
        ...(source.final_measurements || {}),
      },
    }
  }
  if (stage === "QC") {
    return { ...blankQcEntry(), ...source }
  }
  if (stage === "DISPATCH") {
    return { ...blankDispatchEntry(), ...source }
  }
  return { ...blankPackingEntry(), ...source }
}

function firstMachineId(stages: any[]) {
  return stages.find((stage) => stage.machine_id)?.machine_id || null
}

function firstOpenSegment(segments: any[], stage: StageName) {
  const rows = segments
    .filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
    .sort((a: any, b: any) => Number(a.segment_no || 1) - Number(b.segment_no || 1) || Number(a.sequence_no || 1) - Number(b.sequence_no || 1))
  return rows[0] || null
}

function stageMachineField(stage: StageName): string | null {
  if (stage === "SLITTING") return "slitter_no"
  if (stage === "WINDER") return "winder_no"
  if (stage === "OVEN") return "oven_no"
  if (stage === "PROCESS") return "process_line_no"
  return null
}

function parseStageForms(card: any, machineLabelMap: Map<string, string>, defaultShift: string = "") {
  const rows = Array.isArray(card?.stages) ? card.stages : []
  const segments = Array.isArray(card?.stage_segments) ? card.stage_segments : []
  const forms: Record<string, any> = {}
  for (const stageName of STAGES) {
    const row = rows.find((candidate: any) => candidate.stage_type === stageName)
    const segment = firstOpenSegment(segments, stageName)
    const machineField = stageMachineField(stageName)
    const machineId = row?.machine_id || segment?.machine_id
    const machineLabel =
      machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : ""
    const normalizedEntry = normalizeStageEntry(stageName, row?.entry_snapshot)
    const baseEntry = machineField && !normalizedEntry[machineField]
      ? { ...normalizedEntry, [machineField]: machineLabel }
      : { ...normalizedEntry }
    if (!baseEntry.shift_code) {
      const inheritedShift = row?.shift_code || segment?.shift_code || defaultShift || ""
      if (inheritedShift) {
        baseEntry.shift_code = String(inheritedShift)
      }
    }
    forms[stageName] = {
      segment_id: segment?.id || null,
      remarks: row?.remarks || "",
      override_reason: row?.actuals_snapshot?.override_reason || "",
      reel_issue_ids: Array.isArray(row?.reel_issue_ids) ? row.reel_issue_ids : [],
      entry_snapshot: baseEntry,
    }
  }
  return forms
}

function useMachineLabelMap() {
  const machinesQuery = useMachines()
  return useMemo(() => {
    const rows = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    return new Map(rows.map((row: any) => [String(row.id), row.name || row.code || row.id]))
  }, [machinesQuery.data])
}

function stageStatus(stages: any[], stage: StageName) {
  return stages.find((row: any) => row.stage_type === stage)?.status || "PLANNED"
}

function LabeledValue({
  label,
  value,
  className = "",
}: {
  label: string
  value: any
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 min-h-5 text-sm font-semibold text-slate-900">{value || "-"}</div>
    </div>
  )
}

function StageMetric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string
  value: any
  detail?: string
  tone?: "default" | "dark" | "soft"
}) {
  const toneClass =
    tone === "dark"
      ? "border-slate-900 bg-slate-950 text-white"
      : tone === "soft"
        ? "border-cyan-200 bg-cyan-50 text-slate-950"
        : "border-slate-200 bg-white text-slate-950"
  const labelClass = tone === "dark" ? "text-white/70" : "text-slate-500"
  const detailClass = tone === "dark" ? "text-white/75" : "text-slate-500"
  return (
    <div className={`rounded-[1.2rem] border px-4 py-3 shadow-sm ${toneClass}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${labelClass}`}>{label}</div>
      <div className="mt-2 text-lg font-semibold">{value || "-"}</div>
      {detail ? <div className={`mt-1 text-xs ${detailClass}`}>{detail}</div> : null}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  type = "text",
}: {
  value: any
  onChange: (value: string) => void
  type?: "text" | "number" | "date" | "datetime-local"
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-2xl border border-slate-300 bg-white/95 px-3 text-sm font-medium text-slate-900 shadow-sm"
    />
  )
}

function MatrixBlock({
  title,
  ranges,
}: {
  title: string
  ranges: any
}) {
  const rows = [
    { key: "id", label: "ID" },
    { key: "od", label: "OD" },
    { key: "length", label: "Length" },
    { key: "tube_weight", label: "Tube Weight" },
    { key: "cs", label: "CS" },
    { key: "moisture", label: "Moisture" },
    { key: "thickness", label: "Thickness" },
  ]

  return (
    <section className="border border-slate-800">
      <div className="border-b border-slate-800 bg-slate-100 px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-900">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="border border-slate-300 px-2 py-2">Parameter</th>
            <th className="border border-slate-300 px-2 py-2">Avg</th>
            <th className="border border-slate-300 px-2 py-2">Min</th>
            <th className="border border-slate-300 px-2 py-2">Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const current = ranges?.[row.key] || {}
            return (
              <tr key={row.key}>
                <td className="border border-slate-300 px-2 py-2 font-semibold">{row.label}</td>
                <td className="border border-slate-300 px-2 py-2">{formatNumber(current.avg)}</td>
                <td className="border border-slate-300 px-2 py-2">{formatNumber(current.min)}</td>
                <td className="border border-slate-300 px-2 py-2">{formatNumber(current.max)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export default function JobCardDocument({ jobCardId, mode }: Props) {
  const { showToast } = useApp()
  const { user } = useAuth()
  const jobCardQuery = usePlanningJobCard(jobCardId)
  const saveDraftMutation = useSaveStageDraft()
  const completeStageMutation = useCompleteStageEntry()
  const machineLabelMap = useMachineLabelMap()
  const mandrelsQuery = useMandrels()
  const shiftsQuery = useShifts()
  const employeesQuery = useEmployees()
  const [stageForms, setStageForms] = useState<Record<string, any>>({})
  const [toolSelection, setToolSelection] = useState<Record<string, string>>({})
  const toolAssetsQuery = useToolAssets({ limit: 1000 })
  const issueToolMutation = useIssueToolAsset()
  const activeEmployees = useMemo(() => {
    const rows = Array.isArray(employeesQuery.data) ? employeesQuery.data : []
    return rows.filter((row: any) => row && (row.id ?? null) !== null && row.is_active !== false && row.active !== false)
  }, [employeesQuery.data])
  const employeesLoadFailed = Boolean(employeesQuery.isError)
  const userDefaultShift = (user as any)?.default_shift || ""
  const shiftOptions = useMemo(() => {
    const rows = Array.isArray(shiftsQuery.data) ? shiftsQuery.data : []
    return rows
      .filter((row: any) => row && (row.code || row.shift_code))
      .map((row: any) => ({
        code: String(row.code || row.shift_code || ""),
        name: String(row.name || row.shift_name || row.code || row.shift_code || ""),
      }))
  }, [shiftsQuery.data])

  const card = jobCardQuery.data
  const documentSnapshot = card?.document_snapshot || {}
  const stages = Array.isArray(card?.stages) ? card.stages : []
  const stageSegments = Array.isArray(card?.stage_segments) ? card.stage_segments : []
  const winderStage = stages.find((stage: any) => stage.stage_type === "WINDER")
  const activeHoldCount = (card?.quality_holds || []).filter((hold: any) => String(hold?.status || "").toUpperCase() === "HOLD").length
  const carryForward = card?.carry_forward_suggestion || { suggested: false, remaining_qty: 0 }
  const incompleteUpstreamStages = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"].filter((stage) => {
    if (stage === "SLITTING" && !card?.requires_slitting) return false
    const status = stageStatus(stages, stage as StageName)
    return status !== "COMPLETED"
  })
  const dispatchGateBlocked = incompleteUpstreamStages.length > 0 || activeHoldCount > 0
  const wipQty = Math.max(
    0,
    Number(documentSnapshot?.material_truth?.planned_output_qty || card?.planned_qty || 0) -
      Number(documentSnapshot?.material_truth?.dispatched_qty || 0),
  )

  const reelIssuesQuery = useReelIssues(
    mode === "supervisor"
      ? {
          status: "OPEN",
          issue_section: "WINDER_SECTION",
          limit: 30,
        }
      : undefined,
  )

  const mandrelLabelMap = useMemo(() => {
    const rows = Array.isArray(mandrelsQuery.data) ? mandrelsQuery.data : []
    return new Map(
      rows.map((row: any) => [
        row.id,
        row.mandrel_code ||
          row.code ||
          row.name ||
          (row.outer_diameter_mm ? formatNumber(row.outer_diameter_mm) : row.id),
      ]),
    )
  }, [mandrelsQuery.data])

  useEffect(() => {
    if (card) {
      setStageForms(parseStageForms(card, machineLabelMap, userDefaultShift))
    }
  }, [card, machineLabelMap, userDefaultShift])

  const availableReelIssues = useMemo(() => {
    const rows = Array.isArray(reelIssuesQuery.data) ? reelIssuesQuery.data : []
    return rows
  }, [reelIssuesQuery.data])

  const lineMachineId = documentSnapshot?.header?.line_machine_id || firstMachineId(stages)
  const lineMachineLabel =
    documentSnapshot?.header?.line_machine_label ||
    (lineMachineId ? machineLabelMap.get(String(lineMachineId)) : null) ||
    "-"
  const mandrelId = documentSnapshot?.header?.mandrel_id || documentSnapshot?.setup_tooling?.mandrel
  const mandrelLabel =
    documentSnapshot?.header?.mandrel_label ||
    documentSnapshot?.setup_tooling?.mandrel_label ||
    (mandrelId ? mandrelLabelMap.get(mandrelId) : null) ||
    "-"
  const currentStage = (card?.current_stage || "WINDER") as StageName
  const plannerGateReady = Boolean(card?.planner_gate_ready ?? true)
  const plannerGateReason = card?.planner_gate_reason || ""
  const currentStageSegments = stageSegments.filter((segment: any) => segment.stage_type === currentStage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
  const selectedSegmentId = stageForms[currentStage]?.segment_id || card?.active_segment_id || currentStageSegments[0]?.id || null
  const activeSegment = currentStageSegments.find((segment: any) => segment.id === selectedSegmentId) || currentStageSegments[0] || null
  const clientSpec = documentSnapshot?.client_spec || {}
  const manufacturingSpec = documentSnapshot?.manufacturing_spec || {}
  const recipeSummary = documentSnapshot?.recipe_summary || {}
  const recipeRows = Array.isArray(recipeSummary?.rows) ? recipeSummary.rows : []
  const adhesiveComponents = Array.isArray(recipeSummary?.adhesive_components) ? recipeSummary.adhesive_components : []
  const toolingUsage = Array.isArray(documentSnapshot?.setup_tooling?.tooling_usage)
    ? documentSnapshot.setup_tooling.tooling_usage
    : Array.isArray(card?.spec_snapshot?.tooling_usage)
      ? card.spec_snapshot.tooling_usage
      : []
  const specReference =
    documentSnapshot?.header?.spec_reference ||
    documentSnapshot?.setup_tooling?.spec_reference ||
    card?.spec_snapshot?.spec_reference ||
    "-"
  const targetBambooCount = Number(documentSnapshot?.header?.target_bamboo_count || 0)
  const pcsPerBamboo = Number(documentSnapshot?.header?.pcs_per_bamboo || 0)
  const selectedBambooLength = Number(documentSnapshot?.header?.selected_bamboo_length_mm || 0)
  const usableBambooLength = Number(documentSnapshot?.header?.usable_length_mm || manufacturingSpec?.usable_length_mm || 0)
  const trimLossMm = Number(documentSnapshot?.header?.trim_loss_mm || manufacturingSpec?.trim_loss_mm || 0)
  const selectedBambooLengthM = selectedBambooLength > 0 ? selectedBambooLength / 1000 : 0
  const bambooToMeters = (value: any) => {
    const bamboo = Number(value || 0)
    if (!Number.isFinite(bamboo) || bamboo <= 0) return 0
    return selectedBambooLengthM > 0 ? bamboo * selectedBambooLengthM : bamboo
  }
  const metersToBamboo = (metersValue: any, bambooFallback?: any) => {
    const meters = Number(metersValue || 0)
    if (Number.isFinite(meters) && meters > 0 && selectedBambooLengthM > 0) {
      return Number((meters / selectedBambooLengthM).toFixed(4))
    }
    const fallback = Number(bambooFallback || 0)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  }
  const displayWinderMeters = (metersValue: any, bambooFallback?: any) => {
    const meters = Number(metersValue || 0)
    if (Number.isFinite(meters) && meters > 0) return formatNumber(meters, 2)
    const fallbackMeters = bambooToMeters(bambooFallback)
    return fallbackMeters > 0 ? formatNumber(fallbackMeters, 2) : ""
  }
  const normalizeWinderEntryForSubmit = (entry: any) => {
    const producedMeters = entry.winding_meters_produced !== "" && entry.winding_meters_produced != null ? Number(entry.winding_meters_produced) : bambooToMeters(entry.bamboo_count_produced)
    const acceptedMeters = entry.accepted_winding_meters !== "" && entry.accepted_winding_meters != null ? Number(entry.accepted_winding_meters) : bambooToMeters(entry.accepted_bamboo_count)
    const rejectMeters = entry.reject_winding_meters !== "" && entry.reject_winding_meters != null ? Number(entry.reject_winding_meters) : bambooToMeters(entry.reject_bamboo_count)
    return {
      ...entry,
      winding_meters_produced: Number.isFinite(producedMeters) && producedMeters > 0 ? producedMeters : "",
      accepted_winding_meters: Number.isFinite(acceptedMeters) && acceptedMeters > 0 ? acceptedMeters : "",
      reject_winding_meters: Number.isFinite(rejectMeters) && rejectMeters > 0 ? rejectMeters : "",
      bamboo_count_produced: metersToBamboo(producedMeters, entry.bamboo_count_produced) || "",
      accepted_bamboo_count: metersToBamboo(acceptedMeters, entry.accepted_bamboo_count) || "",
      reject_bamboo_count: metersToBamboo(rejectMeters, entry.reject_bamboo_count) || "",
    }
  }
  const parchmentFamily = documentSnapshot?.header?.parchment_family || "-"
  const parchmentPattern = documentSnapshot?.header?.parchment_pattern || documentSnapshot?.header?.color || "-"
  const tubeDryWeightG = Number(
    manufacturingSpec?.tube_dry_weight_g ??
      documentSnapshot?.header?.tube_dry_weight_g ??
      recipeSummary?.predicted_dry_tube_g ??
      0,
  )
  const tubeWetWeightG = Number(
    manufacturingSpec?.tube_wet_weight_g ??
      documentSnapshot?.header?.tube_wet_weight_g ??
      recipeSummary?.predicted_wet_tube_g ??
      0,
  )
  const bambooDryWeightG = Number(
    manufacturingSpec?.bamboo_dry_weight_g ??
      documentSnapshot?.header?.bamboo_dry_weight_g ??
      0,
  )
  const bambooWetWeightG = Number(
    manufacturingSpec?.bamboo_wet_weight_g ??
      documentSnapshot?.header?.bamboo_wet_weight_g ??
      recipeSummary?.bamboo_wet_weight_g ??
      0,
  )
  const weightPerMmG = Number(
    manufacturingSpec?.weight_per_mm_g ??
      documentSnapshot?.header?.weight_per_mm_g ??
      0,
  )
  const qrValue = documentSnapshot?.header?.qr_value || buildProductionEntryUrl(jobCardId)
  const assignedWinderMachineId = String(
    documentSnapshot?.header?.assigned_winder_machine_id ||
      documentSnapshot?.header?.winder_machine_id ||
      stageSegments.find((segment: any) => segment.stage_type === "WINDER" && segment.machine_id)?.machine_id ||
      "",
  )
  const selectedWinderLabel =
    (assignedWinderMachineId ? machineLabelMap.get(assignedWinderMachineId) : null) ||
    lineMachineLabel
  const currentMachineLabel =
    (activeSegment?.machine_id ? machineLabelMap.get(activeSegment.machine_id) : null) ||
    selectedWinderLabel
  const currentShiftLabel = [activeSegment?.shift_code || "--", activeSegment?.plan_date || "--"].join(" · ")
  const primaryStageAssignment = stageAssignment(card?.requires_slitting ? "SLITTING" : "WINDER")
  const parchmentLabel =
    documentSnapshot?.header?.color ||
    card?.sales_order?.lines?.[0]?.parchment_color ||
    card?.spec_snapshot?.parchment_color ||
    "-"
  const packagingSummary = [documentSnapshot?.setup_tooling?.box, documentSnapshot?.setup_tooling?.qty_per_box ? `${documentSnapshot.setup_tooling.qty_per_box} / box` : null]
    .filter(Boolean)
    .join(" · ")

  function updateStageForm(stage: StageName, updater: (current: any) => any) {
    setStageForms((current) => ({
      ...current,
      [stage]: updater(
        current[stage] || {
          remarks: "",
          override_reason: "",
          reel_issue_ids: [],
          entry_snapshot: normalizeStageEntry(stage, {}),
        },
      ),
    }))
  }

  function updateSnapshotField(stage: StageName, field: string, value: string) {
    updateStageForm(stage, (current) => ({
      ...current,
      entry_snapshot: {
        ...(current.entry_snapshot || {}),
        [field]: value,
      },
    }))
  }

  function updateNestedSnapshotField(stage: StageName, field: string, nestedField: string, value: string) {
    updateStageForm(stage, (current) => ({
      ...current,
      entry_snapshot: {
        ...(current.entry_snapshot || {}),
        [field]: {
          ...((current.entry_snapshot || {})[field] || {}),
          [nestedField]: value,
        },
      },
    }))
  }

  function updateDimensionReading(index: number, field: string, value: string) {
    updateStageForm("WINDER", (current) => {
      const rows = Array.isArray(current.entry_snapshot?.dimension_readings)
        ? [...current.entry_snapshot.dimension_readings]
        : blankWinderEntry().dimension_readings
      rows[index] = {
        ...(rows[index] || blankWinderEntry().dimension_readings[0]),
        [field]: value,
      }
      return {
        ...current,
        entry_snapshot: {
          ...(current.entry_snapshot || {}),
          dimension_readings: rows,
        },
      }
    })
  }

  function stageRow(stage: StageName) {
    return stages.find((row: any) => row.stage_type === stage) || null
  }

  function stageSegment(stage: StageName) {
    const selectedId = stageForms[stage]?.segment_id
    const rows = stageSegments
      .filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
      .sort((a: any, b: any) => Number(a.segment_no || 1) - Number(b.segment_no || 1) || Number(a.sequence_no || 1) - Number(b.sequence_no || 1))
    return rows.find((segment: any) => segment.id === selectedId) || rows[0] || null
  }

  function stageAssignment(stage: StageName) {
    const row = stageRow(stage)
    const segment = stageSegment(stage)
    const machineId = row?.machine_id || segment?.machine_id
    const shiftCode = row?.shift_code || segment?.shift_code
    const planDate = row?.plan_date || segment?.plan_date || ""
    const machineLabel = machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : ""
    const shiftLabel = shiftCode ? [String(shiftCode).replace("_", " "), planDate].filter(Boolean).join(" · ") : ""
    const needsPlannerAssignment = ["SLITTING", "WINDER", "OVEN", "PROCESS"].includes(stage)
    const missingRequiredAssignment = needsPlannerAssignment && (!machineId || !shiftCode)
    return { machineId, machineLabel, shiftCode, shiftLabel, planDate, missingRequiredAssignment }
  }

  function stageEditable(stage: StageName) {
    const row = stageRow(stage)
    if (stage === "DISPATCH") return false
    if (mode !== "supervisor" || row?.status === "COMPLETED" || stageAssignment(stage).missingRequiredAssignment) {
      return false
    }
    if (stage === currentStage && PLANNER_GATED_STAGES.includes(stage) && !plannerGateReady) {
      return false
    }
    return true
  }

  function draftPayload(stage: StageName) {
    const form = stageForms[stage] || {
      remarks: "",
      override_reason: "",
      reel_issue_ids: [],
      entry_snapshot: normalizeStageEntry(stage, {}),
    }
    const entry =
      stage === "WINDER"
        ? normalizeWinderEntryForSubmit({ ...(form.entry_snapshot || {}), winder_no: (form.entry_snapshot || {}).winder_no || lineMachineLabel })
        : form.entry_snapshot || {}
    const stageMeta = stageRow(stage)
    const payload: Record<string, any> = {
      stage,
      segment_id: form.segment_id || undefined,
      entry_snapshot: entry,
      remarks: form.remarks || null,
      override_reason: form.override_reason || null,
      reel_issue_ids: form.reel_issue_ids || [],
    }
    const assignment = stageAssignment(stage)
    if (assignment.machineId) {
      payload.machine_id = assignment.machineId
    } else if (stageMeta?.machine_id) {
      payload.machine_id = stageMeta.machine_id
    }
    const submittedShift = (entry.shift_code || "").toString().trim() || assignment.shiftCode || stageMeta?.shift_code || ""
    if (submittedShift) {
      payload.shift_code = submittedShift
    }
    if (stage === "SLITTING" && entry.slit_output_weight_kg !== "") {
      payload.input_qty = Number(entry.slit_output_weight_kg)
    }
    if (stage === "WINDER" && entry.bamboo_count_produced !== "") {
      payload.input_qty = Number(entry.bamboo_count_produced)
    }
    if (stage === "OVEN" && entry.bamboo_count_in !== "") {
      payload.input_qty = Number(entry.bamboo_count_in)
    }
    return payload
  }

  function completePayload(stage: StageName) {
    const base = draftPayload(stage)
    const entry = base.entry_snapshot || {}
    if (stage === "SLITTING") {
      return {
        ...base,
        input_qty: entry.slit_output_weight_kg !== "" ? Number(entry.slit_output_weight_kg) : base.input_qty,
        output_qty: entry.slit_output_weight_kg !== "" ? Number(entry.slit_output_weight_kg) : 0,
        scrap_qty: entry.trim_wastage_weight_kg !== "" ? Number(entry.trim_wastage_weight_kg) : 0,
      }
    }
    if (stage === "WINDER") {
      return {
        ...base,
        input_qty: entry.bamboo_count_produced !== "" ? Number(entry.bamboo_count_produced) : base.input_qty,
        output_qty: entry.accepted_bamboo_count !== "" ? Number(entry.accepted_bamboo_count) : 0,
        scrap_qty: entry.reject_bamboo_count !== "" ? Number(entry.reject_bamboo_count) : 0,
      }
    }
    if (stage === "OVEN") {
      return {
        ...base,
        input_qty: entry.bamboo_count_in !== "" ? Number(entry.bamboo_count_in) : base.input_qty,
        output_qty: entry.bamboo_count_out !== "" ? Number(entry.bamboo_count_out) : 0,
      }
    }
    if (stage === "PROCESS") {
      return {
        ...base,
        output_qty: entry.process_qty !== "" ? Number(entry.process_qty) : 0,
        scrap_qty: entry.reject_qty !== "" ? Number(entry.reject_qty) : 0,
      }
    }
    if (stage === "QC") {
      return {
        ...base,
        output_qty: entry.accepted_qty !== "" ? Number(entry.accepted_qty) : 0,
        scrap_qty: entry.hold_qty !== "" ? Number(entry.hold_qty) : 0,
        quality_checks: {
          accepted_qty: entry.accepted_qty !== "" ? Number(entry.accepted_qty) : 0,
          hold_qty: entry.hold_qty !== "" ? Number(entry.hold_qty) : 0,
          disposition: entry.disposition || "",
        },
      }
    }
    if (stage === "DISPATCH") {
      return {
        ...base,
        output_qty: entry.dispatch_qty !== "" ? Number(entry.dispatch_qty) : 0,
      }
    }
    return {
      ...base,
      output_qty: entry.total_packed_qty !== "" ? Number(entry.total_packed_qty) : 0,
    }
  }

  async function saveStage(stage: StageName, saveMode: "draft" | "complete") {
    if (!jobCardId) return
    const assignment = stageAssignment(stage)
    if (assignment.missingRequiredAssignment) {
      showToast("Planner must assign machine and shift before supervisor entry can continue.", "error")
      return
    }
    if (STAGES_REQUIRING_SHIFT.includes(stage)) {
      const formEntry = stageForms[stage]?.entry_snapshot || {}
      const stageShift = (formEntry.shift_code || "").toString().trim() || assignment.shiftCode || ""
      if (!stageShift) {
        showToast(`Shift selection is required before saving ${stage}.`, "error")
        return
      }
    }
    try {
      if (saveMode === "draft") {
        await saveDraftMutation.mutateAsync({
          jobCardId,
          data: draftPayload(stage),
        })
        showToast(`${stage} draft saved`, "success")
      } else {
        await completeStageMutation.mutateAsync({
          jobCardId,
          data: completePayload(stage),
        })
        showToast(`${stage} saved as completed`, "success")
      }
      jobCardQuery.refetch()
    } catch (error: any) {
      const message =
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        "Unable to save stage"
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  function sectionActions(stage: StageName) {
    if (mode !== "supervisor") return null
    const disabled = !stageEditable(stage) || saveDraftMutation.isPending || completeStageMutation.isPending
    return (
      <div className="mt-3 flex flex-wrap gap-2 no-print">
        <button
          type="button"
          onClick={() => saveStage(stage, "draft")}
          disabled={disabled}
          className="inline-flex items-center gap-2 border border-slate-900 px-3 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => saveStage(stage, "complete")}
          disabled={disabled}
          className="inline-flex items-center gap-2 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Complete Stage
        </button>
      </div>
    )
  }

  function renderSegmentSelector(stage: StageName) {
    const stageOpenSegments = stageSegments.filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
    if (mode !== "supervisor" || stage !== currentStage || stageOpenSegments.length <= 1) return null
    return (
      <div className="rounded-[1.1rem] border border-amber-200 bg-amber-50 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">Open Segments</div>
        <p className="mt-2 text-sm text-slate-700">This stage is split across multiple shifts. Pick the live segment before entering actuals.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {stageOpenSegments.map((segment: any) => {
            const selected = stageForms[stage]?.segment_id === segment.id
            return (
              <button
                key={segment.id}
                type="button"
                onClick={() =>
                  updateStageForm(stage, (current) => ({
                    ...current,
                    segment_id: segment.id,
                  }))
                }
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-800"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em]">
                  Segment {segment.segment_no}
                </div>
                <div className="mt-2 text-sm">
                  {Number(segment.planned_qty || 0).toFixed(0)} pcs · {segment.shift_code || "Open"} · {segment.plan_date || "Unscheduled"}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderCurrentStageSection(stage: StageName) {
    if (stage === "SLITTING") return renderSlittingSection()
    if (stage === "WINDER") return renderWinderSection()
    if (stage === "OVEN") return renderOvenSection()
    if (stage === "PROCESS") return renderProcessSection()
    if (stage === "PACKING") return renderPackingSection()
    if (stage === "QC") return renderQcSection()
    return renderDispatchSection()
  }

  function renderCompactExecutionLayout() {
    const previousStageRows = stages.filter((row: any) => row.stage_type !== currentStage && row.status === "COMPLETED")
    return (
      <div className="w-full space-y-4">
        {mode === "view" ? (
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              Snapshot Mode: <span className="font-semibold text-slate-900">{card?.snapshot_mode}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/production/job-cards/${jobCardId}/print`}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900"
              >
                <Printer className="h-4 w-4" />
                Print
              </Link>
              <Link
                href={`/production/supervisor-entry?job_card_id=${jobCardId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Open Supervisor Entry
              </Link>
              <a
                href={qrValue}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                <Smartphone className="h-4 w-4" />
                Open mobile link
              </a>
            </div>
          </div>
        ) : null}
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1.55fr)_24rem]">
            <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1f2937_60%,#334155_100%)] px-6 py-6 text-white lg:border-b-0 lg:border-r">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">Production Execution</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{card?.job_card_ref || card?.id}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200/80">
                Shop-floor view driven from the saved manufacturing matrix. Assigned winder, bamboo target, recipe path, and current stage logging stay on one card so the operator and supervisor are reading the same truth.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Customer</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.customer_name || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Product</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.product_code || card?.product_code || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Spec Ref</div><div className="mt-1 text-sm font-semibold">{specReference}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Size</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.product_size_label || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Current Stage</div><div className="mt-1 text-sm font-semibold">{currentStage}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Release Qty</div><div className="mt-1 text-sm font-semibold">{formatNumber(card?.released_qty || card?.planned_qty, 0)} pcs</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Assigned Winder</div><div className="mt-1 text-sm font-semibold">{selectedWinderLabel}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Pcs / Bamboo</div><div className="mt-1 text-sm font-semibold">{formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Bamboo Length</div><div className="mt-1 text-sm font-semibold">{formatNumber(selectedBambooLength, 0)} mm</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Parchment</div><div className="mt-1 text-sm font-semibold">{parchmentPattern}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Release Lot</div><div className="mt-1 text-sm font-semibold">{card?.release_lot_id ? String(card.release_lot_id).slice(0, 8) : "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Sales Line</div><div className="mt-1 text-sm font-semibold">{card?.sales_order_line_id ? String(card.sales_order_line_id).slice(0, 8) : "-"}</div></div>
              </div>
            </div>
            <div className="grid gap-3 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-6 py-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Target Bamboo</div><div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(targetBambooCount, 0)}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Open Segments</div><div className="mt-1 text-lg font-semibold text-slate-900">{card?.open_segment_count ?? currentStageSegments.length}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Current Machine</div><div className="mt-1 text-sm font-semibold text-slate-900">{currentMachineLabel}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Shift Slot</div><div className="mt-1 text-sm font-semibold text-slate-900">{currentShiftLabel}</div></div>
              </div>
              {PLANNER_GATED_STAGES.includes(currentStage) ? (
                <div className={`rounded-2xl border px-4 py-3 ${plannerGateReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Planner Gate</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {plannerGateReady ? "Ready for floor entry" : "Blocked until planner slot is valid"}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {plannerGateReady
                      ? `Scheduled ${card?.active_segment_plan_date || activeSegment?.plan_date || "-"} · ${currentMachineLabel}`
                      : plannerGateReason || "Planner must place this stage in the next 3 days before supervisor entry."}
                  </div>
                </div>
              ) : null}
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Execution Target</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {formatNumber(targetBambooCount, 0)} bamboo • {formatNumber(pcsPerBamboo, 0)} pcs/bamboo • {formatNumber(selectedBambooLength, 0)} mm
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Tube {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g • Bamboo {formatNumber(bambooDryWeightG)} / {formatNumber(bambooWetWeightG)} g
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusChipClass(
                      activeSegment?.status || card?.status || "PLANNED",
                    )}`}
                  >
                    {activeSegment?.status || card?.status || "PLANNED"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <QRCodeSVG value={qrValue} size={72} />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Scan Entry</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">Phone scan opens the live stage-entry screen for this exact job card on the running ERP host.</div>
                  <a href={qrValue} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-[11px] text-cyan-700 hover:text-cyan-800">
                    {qrValue}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_26rem]">
          <div className="space-y-4">
            {renderSegmentSelector(currentStage)}
            <section className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current stage logging</div>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">{currentStage} actual output capture</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Enter only the live output, rejects, timings, and measured dimensions for the active segment. Manufacturing recipe, bamboo math, and packaging truth stay readonly on the right.
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
                  {activeSegment?.shift_code || "Open segment"}
                </div>
              </div>
            </section>
            {renderCurrentStageSection(currentStage)}
          </div>
          <div className="space-y-4">
            <section className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Manufacturing Truth</div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Spec + Manufacturing Matrix</div>
                  <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Spec Ref</div>
                      <div className="mt-1 font-semibold text-slate-900">{specReference}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Mandrel</div>
                      <div className="mt-1 font-semibold text-slate-900">{mandrelLabel}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">ID Band</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(clientSpec?.id?.min)} / {formatNumber(clientSpec?.id?.avg)} / {formatNumber(clientSpec?.id?.max)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">OD Band</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(clientSpec?.od?.min)} / {formatNumber(clientSpec?.od?.avg)} / {formatNumber(clientSpec?.od?.max)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Wall Thickness</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(clientSpec?.thickness?.avg, 4)} mm
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Required CS</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(manufacturingSpec?.final_required_cs)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Notch Direction</div>
                      <div className="mt-1 font-semibold text-slate-900">{documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Wet Rule</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        Dry ÷ {Number(1 - Number(recipeSummary?.drying_percent || 0) / 100).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Tube Dry / Wet</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Weight / mm</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(weightPerMmG, 4)} g
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Paper Recipe to Follow</div>
                  {recipeRows.length === 0 ? (
                    <div className="mt-2 text-sm text-slate-500">Recipe rows were not captured on this snapshot.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {recipeRows.map((row: any, index: number) => (
                        <div key={`${row.paper_id || row.code || "recipe"}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">
                              {row.code || "PAPER"} · {row.variety || row.category || "Paper"}
                            </div>
                            <div className="text-xs font-medium text-slate-500">
                              {formatNumber(row.plyCount || row.actualPlyCount, 0)} plies
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatNumber(row.gsm, 0)} GSM · BF {formatNumber(row.bfPerPly, 0)} · Thickness {formatNumber(row.thicknessPerPly, 4)} mm · Weight / tube {formatNumber(row.weightAllPly || row.totalWeightG, 2)} g · Positions {row.positionsText || "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Bamboo to Be Made</div>
                  <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Target Bamboo</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatNumber(targetBambooCount, 0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Pcs / Bamboo</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatNumber(pcsPerBamboo, 0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Bamboo Length</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatNumber(selectedBambooLength, 0)} mm</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Usable / Trim</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(usableBambooLength, 0)} / {formatNumber(trimLossMm, 0)} mm
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Tube Dry / Wet</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Bamboo Dry / Wet</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(bambooDryWeightG)} / {formatNumber(bambooWetWeightG)} g
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Glue + Bridge</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    Base {formatNumber(recipeSummary?.glue_base_percent)}% · Parchment {formatNumber(recipeSummary?.parchment_percent)}% · Drying {formatNumber(recipeSummary?.drying_percent)}%
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Paper {formatNumber(recipeSummary?.paper_total_g)} g · Glue {formatNumber(recipeSummary?.adhesive_total_g)} g · Parchment {formatNumber(recipeSummary?.parchment_weight_g)} g · Delta {formatNumber(recipeSummary?.weight_match_delta_g)} g
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    {adhesiveComponents.length === 0 ? (
                      <div>No adhesive mix was captured on this snapshot.</div>
                    ) : (
                      adhesiveComponents.map((component: any, index: number) => (
                        <div key={`${component.name || "adhesive"}-${index}`}>
                          {component.name || "Adhesive"} · ratio {formatNumber(component.ratio_percent)}%
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Parchment Pattern</div><div className="mt-1 text-sm font-semibold text-slate-900">{parchmentPattern}</div><div className="mt-1 text-xs text-slate-500">{parchmentFamily} family</div></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Notch</div><div className="mt-1 text-sm font-semibold text-slate-900">{documentSnapshot?.setup_tooling?.notch_type || "No notch"}</div><div className="mt-1 text-xs text-slate-500">Distance {documentSnapshot?.setup_tooling?.notch_distance || "-"} · Depth {documentSnapshot?.setup_tooling?.notch_depth || "-"} · Direction {documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || "-"}</div><div className="mt-1 text-xs text-slate-500">Blade {documentSnapshot?.setup_tooling?.blade || "-"} · Holder {documentSnapshot?.setup_tooling?.notching_holder || documentSnapshot?.setup_tooling?.holder || "-"} · Punch {documentSnapshot?.setup_tooling?.punch || "-"}</div></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Packing</div><div className="mt-1 text-sm font-semibold text-slate-900">{documentSnapshot?.setup_tooling?.packing_instructions || "Packed by route stage when required"}</div><div className="mt-1 text-xs text-slate-500">{documentSnapshot?.setup_tooling?.box_code || "-"} · {documentSnapshot?.setup_tooling?.box_size || "-"} · {documentSnapshot?.setup_tooling?.qty_per_box || "-"} / box</div></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Bamboo Math</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatNumber(documentSnapshot?.header?.target_bamboo_count, 0)} bamboo target · {formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)} pcs/bamboo</div><div className="mt-1 text-xs text-slate-500">{formatNumber(selectedBambooLength, 0)} mm selected · {formatNumber(usableBambooLength, 0)} mm usable · {formatNumber(trimLossMm, 0)} mm trim</div></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Output Truth</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatNumber(wipQty, 0)} open pcs · {formatNumber(documentSnapshot?.material_truth?.produced_output_qty, 0)} produced · {formatNumber(documentSnapshot?.material_truth?.packed_qty, 0)} packed</div></div>
              </div>
            </section>

            <section className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Previous Stage Actuals</div>
              <div className="mt-4 space-y-3">
                {previousStageRows.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">No completed upstream stage is recorded yet.</div>
                ) : (
                  previousStageRows.map((row: any) => (
                    <div key={row.stage_type} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{row.stage_type}</div>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${statusChipClass(row.status || "COMPLETED")}`}>{row.status}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div>Output: {formatNumber(row.output_qty, 0)}</div>
                        <div>Scrap: {formatNumber(row.scrap_qty, 0)}</div>
                        <div>Start: {row.actual_start || "-"}</div>
                        <div>End: {row.actual_end || "-"}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    )
  }

  function renderAssignmentWarning(stage: StageName) {
    const assignment = stageAssignment(stage)
    const shouldShowPlannerGateWarning =
      stage === currentStage && PLANNER_GATED_STAGES.includes(stage) && !plannerGateReady
    if (!assignment.missingRequiredAssignment && !shouldShowPlannerGateWarning) return null
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900 no-print">
        {assignment.missingRequiredAssignment
          ? "Planner assignment is missing for this stage. Assign machine and shift on the planning board before supervisor entry."
          : plannerGateReason || "This stage is not yet scheduled inside the next-three-day planner window."}
      </div>
    )
  }

  function renderSlittingSection() {
    const stage = "SLITTING" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    if (!stageData && !card.requires_slitting) return null
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Slitting Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Slitter" value={entry.slitter_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time", "end_time", "datetime-local")}
          {renderSimpleField(stage, "Cycle Time", "cycle_time")}
          {renderSimpleField(stage, "Parent Reel ID", "parent_reel_id")}
          {renderSimpleField(stage, "Child Reel IDs", "child_reel_ids_text")}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-2">Slit Output Weight (kg)</th>
              <th className="border border-slate-300 px-2 py-2">Trim / Wastage (kg)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.slit_output_weight_kg} onChange={(next) => updateSnapshotField(stage, "slit_output_weight_kg", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.trim_wastage_weight_kg} onChange={(next) => updateSnapshotField(stage, "trim_wastage_weight_kg", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-slate-300 px-2 py-2">{entry.slit_output_weight_kg || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.trim_wastage_weight_kg || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderSimpleField(stage: StageName, label: string, field: string, type: "text" | "number" | "date" | "datetime-local" = "text") {
    const value = stageForms[stage]?.entry_snapshot?.[field] ?? ""
    if (!stageEditable(stage)) {
      return <LabeledValue label={label} value={value} />
    }
    return (
      <div className="border border-slate-300 px-2 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1">
          <TextInput type={type} value={value} onChange={(next) => updateSnapshotField(stage, field, next)} />
        </div>
      </div>
    )
  }

  function renderToolAssignment(stage: StageName) {
    const rows = Array.isArray(toolAssetsQuery.data) ? toolAssetsQuery.data : []
    const assigned = rows.filter(
      (asset: any) =>
        String(asset.current_job_card_id || "") === String(card?.id || "") &&
        String(asset.current_stage_type || "").toUpperCase() === stage,
    )
    const available = rows.filter((asset: any) => asset.status === "AVAILABLE")
    const selectedId = toolSelection[stage] || ""
    if (!stageEditable(stage)) {
      return <LabeledValue label="Physical Tools" value={assigned.map((asset: any) => asset.asset_no).join(", ") || "-"} />
    }
    const issueSelected = async () => {
      if (!selectedId || !card?.id) return
      try {
        await issueToolMutation.mutateAsync({ id: selectedId, data: { job_card_id: card.id, stage_type: stage } })
        const nextIds = Array.from(new Set([...assigned.map((asset: any) => asset.id), selectedId]))
        updateSnapshotField(stage, "tool_asset_ids", nextIds.join(","))
        setToolSelection((current) => ({ ...current, [stage]: "" }))
        showToast("Physical tool issued and linked to this stage", "success")
      } catch (error: any) {
        const detail = error?.response?.data?.detail || error?.message || "Physical tool could not be issued"
        showToast(String(detail), "error")
      }
    }
    return (
      <div className="border border-slate-300 px-2 py-2 md:col-span-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Physical Tool Issue</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedId}
            onChange={(event) => setToolSelection((current) => ({ ...current, [stage]: event.target.value }))}
            className="h-9 min-w-0 flex-1 border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="">Scan or select an available QR asset</option>
            {available.map((asset: any) => (
              <option key={asset.id} value={asset.id}>{asset.asset_no} · {asset.definition_name} · {asset.location_label || "Unlocated"}</option>
            ))}
          </select>
          <button type="button" onClick={issueSelected} disabled={!selectedId || issueToolMutation.isPending} className="h-9 bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Issue to {stage.toLowerCase()}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {assigned.map((asset: any) => <span key={asset.id} className="border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-900">{asset.asset_no} · {asset.definition_name}</span>)}
          {!assigned.length ? <span className="text-xs text-slate-500">No physical tool issued to this stage.</span> : null}
        </div>
      </div>
    )
  }

  function employeesForStage(stage: StageName) {
    const wanted = String(stage || "").toUpperCase()
    const matched = activeEmployees.filter((emp: any) => {
      const dept = String(emp.department || "").toUpperCase()
      if (dept && dept === wanted) return true
      const skills = String(emp.skills || "").toUpperCase()
      if (!skills) return false
      return skills
        .split(/[,;/|]/)
        .map((token: string) => token.trim())
        .filter(Boolean)
        .includes(wanted)
    })
    // Never show an empty dropdown — fall back to all active employees.
    return matched.length > 0 ? matched : activeEmployees
  }

  function renderOperatorPicker(
    stage: StageName,
    label: string,
    field: string = "operator_name",
    idField: string = "operator_employee_id",
  ) {
    const value = stageForms[stage]?.entry_snapshot?.[field] ?? ""
    if (!stageEditable(stage)) {
      return <LabeledValue label={label} value={value} />
    }
    // Graceful fallback: if the employee master failed to load, keep free-text entry so logging is never blocked.
    if (employeesLoadFailed) {
      return renderSimpleField(stage, label, field)
    }
    const selectedId = stageForms[stage]?.entry_snapshot?.[idField] ?? ""
    const options = employeesForStage(stage)
    // If the saved name isn't a known employee, keep it visible as a free-text legacy value.
    const hasLegacyName = Boolean(value) && !options.some((emp: any) => String(emp.name || "") === String(value))
    return (
      <div className="border border-slate-300 px-2 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1">
          <select
            value={selectedId ? String(selectedId) : ""}
            onChange={(event) => {
              const empId = event.target.value
              const emp = options.find((candidate: any) => String(candidate.id) === empId)
              updateStageForm(stage, (current) => ({
                ...current,
                entry_snapshot: {
                  ...(current.entry_snapshot || {}),
                  [field]: emp ? String(emp.name || "") : "",
                  [idField]: emp ? String(emp.id) : "",
                },
              }))
            }}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white/95 px-3 text-sm font-medium text-slate-900 shadow-sm"
          >
            <option value="">{hasLegacyName ? value : "Select operator…"}</option>
            {options.map((emp: any) => (
              <option key={String(emp.id)} value={String(emp.id)}>
                {emp.name}{emp.employee_code ? ` — ${emp.employee_code}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  function renderLateEntryWarning(stage: StageName) {
    const entry = stageForms[stage]?.entry_snapshot
    if (!entry) return null
    if (!stageEditable(stage)) return null
    const hoursLate = computeHoursLate(entry.end_time)
    if (hoursLate <= LATE_ENTRY_THRESHOLD_HOURS) return null
    const hoursLabel = hoursLate >= 24 ? `${Math.round(hoursLate / 24 * 10) / 10} days` : `${Math.round(hoursLate * 10) / 10} hours`
    return (
      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 no-print">
        Recording {hoursLabel} late — confirm shift selection below.
      </div>
    )
  }

  function renderShiftPicker(stage: StageName) {
    const currentValue = stageForms[stage]?.entry_snapshot?.shift_code ?? ""
    const isRequired = STAGES_REQUIRING_SHIFT.includes(stage)
    const label = `Shift${isRequired ? " *" : ""}`
    if (!stageEditable(stage)) {
      const display = currentValue || stageAssignment(stage).shiftCode || "-"
      return <LabeledValue label="Shift" value={display} />
    }
    const options = shiftOptions
    return (
      <div className={`border px-2 py-2 ${isRequired && !currentValue ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1">
          <select
            value={currentValue || ""}
            onChange={(event) => updateSnapshotField(stage, "shift_code", event.target.value)}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white/95 px-3 text-sm font-medium text-slate-900 shadow-sm"
          >
            <option value="">{isRequired ? "Select shift…" : "Optional"}</option>
            {options.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.code}{opt.name && opt.name !== opt.code ? ` — ${opt.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        {isRequired && !currentValue ? (
          <div className="mt-1 text-[10px] font-semibold text-amber-700">Shift selection is required for this stage.</div>
        ) : null}
      </div>
    )
  }

  function renderNotes(stage: StageName) {
    const value = stageForms[stage]?.remarks ?? ""
    const overrideReason = stageForms[stage]?.override_reason ?? ""
    if (!value && !overrideReason && !stageEditable(stage)) return null
    if (!stageEditable(stage)) {
      return (
        <div className="mt-3 border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notes</div>
          <div className="mt-1 whitespace-pre-wrap">{value || "-"}</div>
          {overrideReason ? (
            <>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Override Reason</div>
              <div className="mt-1 whitespace-pre-wrap">{overrideReason}</div>
            </>
          ) : null}
        </div>
      )
    }
    return (
      <div className="mt-3 border border-slate-300 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notes</div>
        <textarea
          value={value}
          onChange={(event) =>
            updateStageForm(stage, (current) => ({ ...current, remarks: event.target.value }))
          }
          rows={2}
          className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
        />
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Override Reason
        </div>
        <textarea
          value={stageForms[stage]?.override_reason ?? ""}
          onChange={(event) =>
            updateStageForm(stage, (current) => ({ ...current, override_reason: event.target.value }))
          }
          rows={2}
          className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
          placeholder="Required only when completing out of sequence or closing WINDER without linked reel issues."
        />
      </div>
    )
  }

  function renderWinderSection() {
    const stage = "WINDER" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Winder Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Winder" value={entry.winder_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time", "end_time", "datetime-local")}
          {renderSimpleField(stage, "Cycle Time", "cycle_time")}
          {renderToolAssignment(stage)}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-2">Meters Produced</th>
              <th className="border border-slate-300 px-2 py-2">Accepted Meters</th>
              <th className="border border-slate-300 px-2 py-2">Reject Meters</th>
              <th className="border border-slate-300 px-2 py-2">Reject Reason Code</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.winding_meters_produced, entry.bamboo_count_produced)} onChange={(next) => updateSnapshotField(stage, "winding_meters_produced", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.accepted_winding_meters, entry.accepted_bamboo_count)} onChange={(next) => updateSnapshotField(stage, "accepted_winding_meters", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.reject_winding_meters, entry.reject_bamboo_count)} onChange={(next) => updateSnapshotField(stage, "reject_winding_meters", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput value={entry.reject_reason_code} onChange={(next) => updateSnapshotField(stage, "reject_reason_code", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(entry.winding_meters_produced, entry.bamboo_count_produced)}</td>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(entry.accepted_winding_meters, entry.accepted_bamboo_count)}</td>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(entry.reject_winding_meters, entry.reject_bamboo_count)}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.reject_reason_code || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>
        <div className="mt-2 text-xs font-semibold text-slate-600">
          Bamboo equivalent: produced {formatNumber(metersToBamboo(entry.winding_meters_produced, entry.bamboo_count_produced), 2)} · accepted {formatNumber(metersToBamboo(entry.accepted_winding_meters, entry.accepted_bamboo_count), 2)} · reject {formatNumber(metersToBamboo(entry.reject_winding_meters, entry.reject_bamboo_count), 2)}
        </div>

        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dimension Readings</div>
        <table className="mt-1 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-2">Length</th>
              <th className="border border-slate-300 px-2 py-2">ID</th>
              <th className="border border-slate-300 px-2 py-2">OD</th>
              <th className="border border-slate-300 px-2 py-2">Weight</th>
              <th className="border border-slate-300 px-2 py-2">CS</th>
            </tr>
          </thead>
          <tbody>
            {(entry.dimension_readings || []).map((row: any, index: number) => (
              <tr key={`winder-row-${index}`}>
                {stageEditable(stage) ? (
                  <>
                    <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={row.length} onChange={(next) => updateDimensionReading(index, "length", next)} /></td>
                    <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={row.id} onChange={(next) => updateDimensionReading(index, "id", next)} /></td>
                    <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={row.od} onChange={(next) => updateDimensionReading(index, "od", next)} /></td>
                    <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={row.weight} onChange={(next) => updateDimensionReading(index, "weight", next)} /></td>
                    <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={row.cs} onChange={(next) => updateDimensionReading(index, "cs", next)} /></td>
                  </>
                ) : (
                  <>
                    <td className="border border-slate-300 px-2 py-2">{row.length || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.id || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.od || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.weight || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.cs || ""}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {mode === "supervisor" && (
          <div className="mt-3 border border-slate-300 px-3 py-2 no-print">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Linked Reel Issues (optional)</div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {availableReelIssues.map((issue: any) => {
                const checked = (stageForms[stage]?.reel_issue_ids || []).includes(issue.id)
                return (
                  <label key={issue.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{issue.id.slice(0, 8)} | Shift {issue.shift} | {formatNumber(issue.remaining_weight_kg)}kg</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        updateStageForm(stage, (current) => ({
                          ...current,
                          reel_issue_ids: event.target.checked
                            ? [...(current.reel_issue_ids || []), issue.id]
                            : (current.reel_issue_ids || []).filter((value: string) => value !== issue.id),
                        }))
                      }
                    />
                  </label>
                )
              })}
              {availableReelIssues.length === 0 && <div className="text-sm text-slate-500">No open reel issues.</div>}
            </div>
          </div>
        )}

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderOvenSection() {
    const stage = "OVEN" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Oven Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Oven" value={entry.oven_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time", "end_time", "datetime-local")}
          {renderSimpleField(stage, "Cycle Time", "cycle_time")}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-2">Bamboo Count In</th>
              <th className="border border-slate-300 px-2 py-2">Bamboo Count Out</th>
              <th className="border border-slate-300 px-2 py-2">Pre-Oven Weight (kg)</th>
              <th className="border border-slate-300 px-2 py-2">Post-Oven Weight (kg)</th>
              <th className="border border-slate-300 px-2 py-2">Moisture Before</th>
              <th className="border border-slate-300 px-2 py-2">Moisture After</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.bamboo_count_in} onChange={(next) => updateSnapshotField(stage, "bamboo_count_in", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.bamboo_count_out} onChange={(next) => updateSnapshotField(stage, "bamboo_count_out", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.pre_oven_weight_kg} onChange={(next) => updateSnapshotField(stage, "pre_oven_weight_kg", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.post_oven_weight_kg} onChange={(next) => updateSnapshotField(stage, "post_oven_weight_kg", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.moisture_before} onChange={(next) => updateSnapshotField(stage, "moisture_before", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.moisture_after} onChange={(next) => updateSnapshotField(stage, "moisture_after", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-slate-300 px-2 py-2">{entry.bamboo_count_in || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.bamboo_count_out || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.pre_oven_weight_kg || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.post_oven_weight_kg || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.moisture_before || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.moisture_after || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderProcessSection() {
    const stage = "PROCESS" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Process / Finishing Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Process Line" value={entry.process_line_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time", "end_time", "datetime-local")}
          {renderSimpleField(stage, "Cycle Time", "cycle_time")}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-2">Process Qty</th>
              <th className="border border-slate-300 px-2 py-2">Reject Qty</th>
              <th className="border border-slate-300 px-2 py-2">Reject Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.process_qty} onChange={(next) => updateSnapshotField(stage, "process_qty", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput type="number" value={entry.reject_qty} onChange={(next) => updateSnapshotField(stage, "reject_qty", next)} /></td>
                  <td className="border border-slate-300 px-2 py-2"><TextInput value={entry.reject_reason} onChange={(next) => updateSnapshotField(stage, "reject_reason", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-slate-300 px-2 py-2">{entry.process_qty || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.reject_qty || ""}</td>
                  <td className="border border-slate-300 px-2 py-2">{entry.reject_reason || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>

        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Final Measurements</div>
        <div className="mt-1 grid gap-2 md:grid-cols-4">
          {stageEditable(stage) ? (
            <>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">ID</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.id} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "id", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">OD</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.od} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "od", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Length</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.length} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "length", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Weight</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.weight} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "weight", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">CS</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.cs} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "cs", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notch Distance</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.notch_distance} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "notch_distance", next)} /></div></div>
              <div className="border border-slate-300 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notch Depth</div><div className="mt-1"><TextInput type="number" value={entry.final_measurements?.notch_depth} onChange={(next) => updateNestedSnapshotField(stage, "final_measurements", "notch_depth", next)} /></div></div>
            </>
          ) : (
            <>
              <LabeledValue label="ID" value={entry.final_measurements?.id || ""} />
              <LabeledValue label="OD" value={entry.final_measurements?.od || ""} />
              <LabeledValue label="Length" value={entry.final_measurements?.length || ""} />
              <LabeledValue label="Weight" value={entry.final_measurements?.weight || ""} />
              <LabeledValue label="CS" value={entry.final_measurements?.cs || ""} />
              <LabeledValue label="Notch Distance" value={entry.final_measurements?.notch_distance || ""} />
              <LabeledValue label="Notch Depth" value={entry.final_measurements?.notch_depth || ""} />
            </>
          )}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderToolAssignment(stage)}
        </div>

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderPackingSection() {
    const stage = "PACKING" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Packing / Dispatch Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderSimpleField(stage, "Packing Type", "packing_type")}
          {renderSimpleField(stage, "Qty per Bundle", "qty_per_bundle", "number")}
          {renderSimpleField(stage, "Total Packed Qty", "total_packed_qty", "number")}
          {renderSimpleField(stage, "FG Item ID", "fg_item_id")}
          {renderSimpleField(stage, "Dispatch Date", "dispatch_date", "date")}
          {renderSimpleField(stage, "Dispatched Qty", "dispatched_qty", "number")}
          {renderSimpleField(stage, "Pending Qty", "pending_qty", "number")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
        </div>

        {renderNotes(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderQcSection() {
    const stage = "QC" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">QC Gate</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderOperatorPicker(stage, "Inspector", "inspector_name", "inspector_employee_id")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Sample Size", "sample_size", "number")}
          {renderSimpleField(stage, "Accepted Qty", "accepted_qty", "number")}
          {renderSimpleField(stage, "Hold Qty", "hold_qty", "number")}
          {renderSimpleField(stage, "Disposition", "disposition")}
          {renderSimpleField(stage, "Release Ref", "release_reference")}
        </div>

        {renderNotes(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderDispatchSection() {
    const stage = "DISPATCH" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-slate-900">Dispatch Seal</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Dispatch Request ID" value={entry.dispatch_request_id || ""} />
          <LabeledValue label="Dispatch Line Ref" value={entry.dispatch_line_ref || ""} />
          <LabeledValue label="Dispatch Qty" value={entry.dispatch_qty || stageData?.output_qty || ""} />
          <LabeledValue label="Vehicle No" value={entry.vehicle_no || ""} />
          <LabeledValue label="Dispatch Date" value={entry.dispatch_date || ""} />
          <LabeledValue label="Status" value={stageData?.status || "PLANNED"} />
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Dispatch completion is sealed from the dispatch module so inventory and sales fulfillment stay synchronized.
        </div>
      </section>
    )
  }

  const winderPrintStage = stageRow("WINDER")
  const ovenPrintStage = stageRow("OVEN")
  const processPrintStage = stageRow("PROCESS")
  const packingPrintStage = stageRow("PACKING")
  const qcPrintStage = stageRow("QC")
  const dispatchPrintStage = stageRow("DISPATCH")
  const winderPrintEntry = normalizeStageEntry("WINDER", winderPrintStage?.entry_snapshot)
  const ovenPrintEntry = normalizeStageEntry("OVEN", ovenPrintStage?.entry_snapshot)
  const processPrintEntry = normalizeStageEntry("PROCESS", processPrintStage?.entry_snapshot)
  const packingPrintEntry = normalizeStageEntry("PACKING", packingPrintStage?.entry_snapshot)
  const qcPrintEntry = normalizeStageEntry("QC", qcPrintStage?.entry_snapshot)
  const dispatchPrintEntry = normalizeStageEntry("DISPATCH", dispatchPrintStage?.entry_snapshot)
  const plannedQty = Number(documentSnapshot?.material_truth?.planned_output_qty || card?.planned_qty || 0)
  const dispatchQty = Number(dispatchPrintEntry.dispatch_qty || dispatchPrintStage?.output_qty || packingPrintEntry.dispatched_qty || 0)
  const pendingQty = Number(
    packingPrintEntry.pending_qty ||
      (Number.isFinite(plannedQty - dispatchQty) ? Math.max(plannedQty - dispatchQty, 0) : 0),
  )

  function renderPrintLayout() {
    const customerName = documentSnapshot?.header?.customer_name || card?.sales_order?.customer_name || "-"
    const salesOrderNumber = card?.sales_order_ref || card?.sales_order?.order_no || "-"
    const jobCardNumber = card?.job_card_ref || card?.job_card_no || String(card?.id || "").slice(0, 8)
    const sizeLabel = documentSnapshot?.header?.product_size_label || "-"
    const parchmentColor = documentSnapshot?.header?.color || card?.spec_snapshot?.parchment_color || "-"
    const lotNumber = documentSnapshot?.header?.lot_number || String(card?.id || "").slice(0, 10)
    const winderShiftLabel = String(winderPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const ovenShiftLabel = String(ovenPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const processShiftLabel = String(processPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const winderMachineLabel = winderPrintEntry.winder_no || (winderPrintStage?.machine_id ? machineLabelMap.get(String(winderPrintStage.machine_id)) : "") || "-"
    const ovenMachineLabel = ovenPrintEntry.oven_no || (ovenPrintStage?.machine_id ? machineLabelMap.get(String(ovenPrintStage.machine_id)) : "") || "-"
    const processMachineLabel = processPrintEntry.process_line_no || (processPrintStage?.machine_id ? machineLabelMap.get(String(processPrintStage.machine_id)) : "") || "-"

    return (
      <div className="mx-auto max-w-[1100px] space-y-6 print:max-w-none">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Factory print layout aligned to the shop-floor AMIGO card and process continuation sheet.
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="h-4 w-4" />
            Print Job Card
          </button>
        </div>

        <section className="border-2 border-slate-900 bg-white p-5 print:p-4">
          <div className="border-b-2 border-slate-900 pb-3 text-center">
            <p className="text-2xl font-black uppercase tracking-wide text-slate-900">
              {documentSnapshot?.header?.company_name || "Hari Om Paper"}
            </p>
            <p className="mt-1 text-lg font-semibold uppercase tracking-[0.18em] text-slate-700">Job Card</p>
          </div>

          <div className="mt-4 grid gap-0 border border-slate-900 text-sm md:grid-cols-4">
            <LabeledValue label="Date" value={documentSnapshot?.header?.date || ""} />
            <LabeledValue label="Sales Order Number" value={salesOrderNumber} />
            <LabeledValue label="Customer Name" value={customerName} />
            <LabeledValue label="Mandrel" value={mandrelLabel} />
            <LabeledValue label="Size" value={sizeLabel} />
            <LabeledValue label="Color" value={parchmentColor} />
            <LabeledValue label="Order Quantity" value={printValue(documentSnapshot?.header?.order_quantity_pcs, 0)} />
            <LabeledValue label="Lot Number" value={lotNumber} />
            <LabeledValue label="Job Card Number" value={jobCardNumber} />
            <LabeledValue label="Parchment Paper" value={parchmentColor || "-"} />
            <LabeledValue label="Pcs / Bamboo" value={printValue(documentSnapshot?.header?.pcs_per_bamboo, 0)} />
            <LabeledValue label="Required C.S" value={printValue(documentSnapshot?.header?.required_cs)} />
          </div>

          <div className="mt-4 border border-slate-900">
            <div className="grid grid-cols-[1.2fr_180px] border-b border-slate-900">
              <div className="px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-slate-900">Winding (W1-W4)</div>
              <div className="border-l border-slate-900 px-3 py-2 text-sm font-semibold text-slate-700">Shift {winderShiftLabel}</div>
            </div>
            <div className="grid gap-0 text-sm md:grid-cols-4">
              <LabeledValue label="Winder No" value={winderMachineLabel} />
              <LabeledValue label="Operator Name" value={winderPrintEntry.operator_name} />
              <LabeledValue label="Supervisor Sign" value={winderPrintEntry.supervisor_sign} />
              <LabeledValue label="QC Sign" value={winderPrintEntry.qc_sign} />
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 px-2 py-2">Output Meters</th>
                  <th className="border border-slate-300 px-2 py-2">Accepted Meters</th>
                  <th className="border border-slate-300 px-2 py-2">Reject Meters</th>
                  <th className="border border-slate-300 px-2 py-2">Rejection Code</th>
                  <th className="border border-slate-300 px-2 py-2">Start</th>
                  <th className="border border-slate-300 px-2 py-2">End</th>
                  <th className="border border-slate-300 px-2 py-2">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(winderPrintEntry.winding_meters_produced, winderPrintEntry.bamboo_count_produced || winderPrintStage?.input_qty)}</td>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(winderPrintEntry.accepted_winding_meters, winderPrintEntry.accepted_bamboo_count || winderPrintStage?.output_qty)}</td>
                  <td className="border border-slate-300 px-2 py-2">{displayWinderMeters(winderPrintEntry.reject_winding_meters, winderPrintEntry.reject_bamboo_count || winderPrintStage?.scrap_qty)}</td>
                  <td className="border border-slate-300 px-2 py-2">{winderPrintEntry.reject_reason_code || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{winderPrintEntry.start_time || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{winderPrintEntry.end_time || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{winderPrintEntry.cycle_time || "-"}</td>
                </tr>
              </tbody>
            </table>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="border border-slate-300 px-2 py-2">Length</th>
                  <th className="border border-slate-300 px-2 py-2">I.D</th>
                  <th className="border border-slate-300 px-2 py-2">O.D</th>
                  <th className="border border-slate-300 px-2 py-2">Weight</th>
                  <th className="border border-slate-300 px-2 py-2">C.S</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(winderPrintEntry.dimension_readings) ? winderPrintEntry.dimension_readings : []).slice(0, 4).map((row: any, index: number) => (
                  <tr key={`winder-print-${index}`}>
                    <td className="border border-slate-300 px-2 py-2">{row.length || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.id || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.od || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.weight || ""}</td>
                    <td className="border border-slate-300 px-2 py-2">{row.cs || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border border-slate-900">
            <div className="grid grid-cols-[1.2fr_180px] border-b border-slate-900">
              <div className="px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-slate-900">Oven Curing (O1-O6)</div>
              <div className="border-l border-slate-900 px-3 py-2 text-sm font-semibold text-slate-700">Shift {ovenShiftLabel}</div>
            </div>
            <div className="grid gap-0 text-sm md:grid-cols-4">
              <LabeledValue label="Oven No" value={ovenMachineLabel} />
              <LabeledValue label="Operator Name" value={ovenPrintEntry.operator_name} />
              <LabeledValue label="Supervisor Sign" value={ovenPrintEntry.supervisor_sign} />
              <LabeledValue label="QC Sign" value={ovenPrintEntry.qc_sign} />
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 px-2 py-2">Winder OK Qty</th>
                  <th className="border border-slate-300 px-2 py-2">Output Qty</th>
                  <th className="border border-slate-300 px-2 py-2">Reject Qty</th>
                  <th className="border border-slate-300 px-2 py-2">Rejection Code</th>
                  <th className="border border-slate-300 px-2 py-2">Start</th>
                  <th className="border border-slate-300 px-2 py-2">End</th>
                  <th className="border border-slate-300 px-2 py-2">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-2 py-2">{ovenPrintEntry.bamboo_count_in || printValue(ovenPrintStage?.input_qty, 0)}</td>
                  <td className="border border-slate-300 px-2 py-2">{ovenPrintEntry.bamboo_count_out || printValue(ovenPrintStage?.output_qty, 0)}</td>
                  <td className="border border-slate-300 px-2 py-2">{printValue(ovenPrintStage?.scrap_qty, 0)}</td>
                  <td className="border border-slate-300 px-2 py-2">{winderPrintEntry.reject_reason_code || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{ovenPrintEntry.start_time || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{ovenPrintEntry.end_time || "-"}</td>
                  <td className="border border-slate-300 px-2 py-2">{ovenPrintEntry.cycle_time || "-"}</td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-0 text-sm md:grid-cols-4">
              <LabeledValue label="Pre Weight" value={ovenPrintEntry.pre_oven_weight_kg} />
              <LabeledValue label="Post Weight" value={ovenPrintEntry.post_oven_weight_kg} />
              <LabeledValue label="Pre Moisture" value={ovenPrintEntry.moisture_before} />
              <LabeledValue label="Post Moisture" value={ovenPrintEntry.moisture_after} />
            </div>
          </div>
        </section>

        <section className="border-2 border-slate-900 bg-white p-5 print:p-4">
          <div className="grid grid-cols-[1fr_160px] border-b border-slate-900 pb-3">
            <div className="text-center">
              <p className="text-lg font-bold uppercase tracking-wide text-slate-900">Process Line (P1-P11)</p>
            </div>
            <div className="text-right text-sm font-semibold text-slate-700">Shift {processShiftLabel}</div>
          </div>

          <div className="mt-3 grid gap-0 text-sm md:grid-cols-4">
            <LabeledValue label="Line No" value={processMachineLabel} />
            <LabeledValue label="Operator Name" value={processPrintEntry.operator_name} />
            <LabeledValue label="Packing Sign" value={packingPrintEntry.supervisor_sign || "-"} />
            <LabeledValue label="QC Sign" value={qcPrintEntry.qc_sign || processPrintEntry.qc_sign || "-"} />
          </div>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-2 py-2">Oven Qty</th>
                <th className="border border-slate-300 px-2 py-2">Process Qty</th>
                <th className="border border-slate-300 px-2 py-2">Reject Qty</th>
                <th className="border border-slate-300 px-2 py-2">Rejection Code</th>
                <th className="border border-slate-300 px-2 py-2">Start</th>
                <th className="border border-slate-300 px-2 py-2">End</th>
                <th className="border border-slate-300 px-2 py-2">Cycle Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-300 px-2 py-2">{printValue(ovenPrintStage?.output_qty, 0)}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.process_qty || printValue(processPrintStage?.output_qty, 0)}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.reject_qty || printValue(processPrintStage?.scrap_qty, 0)}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.reject_reason || "-"}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.start_time || "-"}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.end_time || "-"}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.cycle_time || "-"}</td>
              </tr>
            </tbody>
          </table>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="border border-slate-300 px-2 py-2">Length</th>
                <th className="border border-slate-300 px-2 py-2">I.D</th>
                <th className="border border-slate-300 px-2 py-2">O.D</th>
                <th className="border border-slate-300 px-2 py-2">Weight</th>
                <th className="border border-slate-300 px-2 py-2">C.S</th>
                <th className="border border-slate-300 px-2 py-2">Notch Distance</th>
                <th className="border border-slate-300 px-2 py-2">Notch Depth</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.length || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.id || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.od || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.weight || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.cs || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.notch_distance || documentSnapshot?.setup_tooling?.notch_distance || ""}</td>
                <td className="border border-slate-300 px-2 py-2">{processPrintEntry.final_measurements?.notch_depth || documentSnapshot?.setup_tooling?.notch_depth || ""}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 grid gap-0 text-sm md:grid-cols-4">
            <LabeledValue label="Dispatch Date" value={packingPrintEntry.dispatch_date || dispatchPrintEntry.dispatch_date || "-"} />
            <LabeledValue label="Dispatch Quantity" value={dispatchQty > 0 ? printValue(dispatchQty, 0) : "-" } />
            <LabeledValue label="Pending Quantity" value={pendingQty > 0 ? printValue(pendingQty, 0) : "-" } />
            <LabeledValue label="Supervisor Sign" value={packingPrintEntry.supervisor_sign || "-"} />
          </div>

          <div className="mt-4 border border-dashed border-slate-400 px-3 py-3 text-xs text-slate-600">
            Notes: {processPrintStage?.remarks || packingPrintStage?.remarks || qcPrintStage?.remarks || "-"}
          </div>
        </section>

        <style jsx global>{`
          @media print {
            .no-print {
              display: none !important;
            }

            header,
            aside,
            nav {
              display: none !important;
            }

            body {
              background: #fff !important;
            }
          }
        `}</style>
      </div>
    )
  }

  function renderReleasePrintLayout() {
    const customerName = documentSnapshot?.header?.customer_name || card?.sales_order?.customer_name || "-"
    const salesOrderNumber = card?.sales_order_ref || card?.sales_order?.order_no || "-"
    const jobCardNumber = card?.job_card_ref || card?.job_card_no || String(card?.id || "").slice(0, 8)
    const sizeLabel = documentSnapshot?.header?.product_size_label || "-"
    const parchmentColor = documentSnapshot?.header?.color || card?.spec_snapshot?.parchment_color || "-"
    const lotNumber = documentSnapshot?.header?.lot_number || String(card?.id || "").slice(0, 10)
    const releaseQty = Number(documentSnapshot?.header?.release_qty_pcs || card?.released_qty || card?.planned_qty || 0)
    const orderQty = Number(documentSnapshot?.header?.order_quantity_pcs || card?.sales_order?.order_qty || releaseQty || 0)
    const effectiveTargetBamboo = Number(targetBambooCount || (pcsPerBamboo ? Math.ceil(releaseQty / pcsPerBamboo) : 0))
    const setup = documentSnapshot?.setup_tooling || {}
    const requiredCs = documentSnapshot?.header?.required_cs ?? clientSpec?.cs?.avg
    const releaseWeightKg = tubeDryWeightG && releaseQty ? (tubeDryWeightG * releaseQty) / 1000 : null
    const packingType = [
      packingPrintEntry.packing_type || setup.bundle_type || setup.bundle_code,
      setup.box_code || setup.box,
      setup.qty_per_box ? `${setup.qty_per_box} / box` : null,
    ].filter(Boolean).join(" · ") || "-"

    function planFor(stage: StageName) {
      const row = stageRow(stage)
      const segment = stageSegment(stage)
      const releaseWinderId = stage === "WINDER" ? documentSnapshot?.header?.assigned_winder_machine_id : ""
      const machineId = row?.machine_id || segment?.machine_id || releaseWinderId || ""
      const shiftCode = row?.shift_code || segment?.shift_code || documentSnapshot?.header?.shift || ""
      const planDate = row?.plan_date || segment?.plan_date || documentSnapshot?.header?.date || ""
      return {
        machineId,
        machineLabel: machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : "-",
        shiftLabel: shiftCode ? String(shiftCode).replace("_", " ") : "-",
        planDate: planDate || "-",
      }
    }

    const winderPlan = planFor("WINDER")
    const ovenPlan = planFor("OVEN")
    const processPlan = planFor("PROCESS")
    const winderMachineLabel = winderPrintEntry.winder_no || winderPlan.machineLabel
    const ovenMachineLabel = ovenPrintEntry.oven_no || ovenPlan.machineLabel
    const processMachineLabel = processPrintEntry.process_line_no || processPlan.machineLabel
    const targetMeasure = {
      length: formatNumber(clientSpec?.length?.avg ?? documentSnapshot?.header?.tube_length_mm),
      id: formatNumber(clientSpec?.id?.avg),
      od: formatNumber(clientSpec?.od?.avg),
      weight: formatNumber(tubeDryWeightG || clientSpec?.tube_weight?.avg),
      cs: formatNumber(requiredCs),
      notch_distance: setup.notch_distance || "",
      notch_depth: setup.notch_depth || "",
    }
    const winderReadings = Array.isArray(winderPrintEntry.dimension_readings)
      ? winderPrintEntry.dimension_readings.filter((row: any) => Object.values(row || {}).some(Boolean))
      : []
    const winderRows = Array.from({ length: 4 }, (_, index) => winderReadings[index] || (index === 0 ? targetMeasure : {}))
    const processRows = Array.from({ length: 3 }, (_, index) => index === 0 ? {
      ...targetMeasure,
      ...(processPrintEntry.final_measurements || {}),
    } : {})
    const headerFields = [
      ["Date", documentSnapshot?.header?.date || ""],
      ["Customer Name", customerName],
      ["Sales Order", salesOrderNumber],
      ["Job Card No.", jobCardNumber],
      ["Size", sizeLabel],
      ["Shift", winderPlan.shiftLabel],
      ["Weight", `${formatNumber(tubeDryWeightG || clientSpec?.tube_weight?.avg)} g`],
      ["C.S.", formatNumber(requiredCs)],
      ["Job Card Qty", `${formatNumber(releaseQty, 0)} pcs`],
      ["Order Qty", `${formatNumber(orderQty, 0)} pcs`],
      ["Packing Type", packingType],
      ["Parchment Type", parchmentColor || "-"],
      ["Target Bamboo", `${formatNumber(effectiveTargetBamboo, 0)} pcs`],
      ["Pcs / Bamboo", formatNumber(pcsPerBamboo, 0)],
      ["Mandrel", mandrelLabel],
      ["Lot Number", lotNumber],
    ]

    const PrintField = ({ label, value, className = "" }: { label: string; value: any; className?: string }) => (
      <div className={`job-print-field ${className}`}>
        <div className="job-print-label">{label}</div>
        <div className="job-print-value">{value || "-"}</div>
      </div>
    )
    const SignatureLine = ({ label }: { label: string }) => (
      <div className="job-signature">
        <div className="job-signature-line" />
        <div className="job-print-label">{label}</div>
      </div>
    )
    const measuredDimensionRows = (rows: any[]) =>
      rows.map((row, index) => (
        <tr key={`dimension-row-${index}`}>
          <td>{row.length || ""}</td>
          <td>{row.id || ""}</td>
          <td>{row.od || ""}</td>
          <td>{row.weight || ""}</td>
          <td>{row.cs || ""}</td>
          <td>{row.notch_distance || ""}</td>
          <td>{row.notch_depth || ""}</td>
        </tr>
      ))

    return (
      <div className="job-print-root mx-auto max-w-[210mm] print:max-w-none">
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">Single-sheet job card for the scheduled release.</div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="h-4 w-4" />
            Print Job Card
          </button>
        </div>

        <section className="job-one-sheet">
          <div className="job-topbar">
            <div>
              <div className="job-company">{documentSnapshot?.header?.company_name || "Hari Om Paper"}</div>
              <div className="job-title">Job Card</div>
            </div>
            <div className="job-ref-box">
              <span>Date</span>
              <strong>{documentSnapshot?.header?.date || "-"}</strong>
            </div>
            <div className="job-ref-box">
              <span>Job Card No.</span>
              <strong>{jobCardNumber}</strong>
            </div>
            <QRCodeSVG value={qrValue} size={58} />
          </div>

          <section className="job-band job-summary-band">
            <div className="job-section-title">
              <span>Summary Box</span>
              <span>Release + spec truth</span>
            </div>
            <div className="job-hero-grid">
              {headerFields.map(([label, value]) => (
                <PrintField key={label} label={String(label)} value={value} />
              ))}
            </div>
          </section>

          <section className="job-band">
            <div className="job-section-title">
              <span>Winding (W1-W4)</span>
              <span>{winderPlan.machineLabel}</span>
            </div>
            <div className="job-mini-grid job-mini-grid-8">
              <PrintField label="Plan Date" value={winderPlan.planDate} />
              <PrintField label="Winder No." value={winderMachineLabel} />
              <PrintField label="Operator" value={winderPrintEntry.operator_name} />
              <PrintField label="Output Meters" value={displayWinderMeters(winderPrintEntry.winding_meters_produced, winderPrintEntry.bamboo_count_produced || winderPrintStage?.input_qty || effectiveTargetBamboo)} />
              <PrintField label="Accept / Reject Meters" value={`${displayWinderMeters(winderPrintEntry.accepted_winding_meters, winderPrintEntry.accepted_bamboo_count || winderPrintStage?.output_qty)} / ${displayWinderMeters(winderPrintEntry.reject_winding_meters, winderPrintEntry.reject_bamboo_count || winderPrintStage?.scrap_qty)}`} />
              <PrintField label="Start / End" value={`${winderPrintEntry.start_time || "-"} / ${winderPrintEntry.end_time || "-"}`} />
              <PrintField label="QC Sign" value={winderPrintEntry.qc_sign || ""} />
              <PrintField label="Supervisor" value={winderPrintEntry.supervisor_sign || ""} />
            </div>
            <table className="job-print-table job-dimension-table">
              <thead>
                <tr>
                  <th>Length</th>
                  <th>I.D</th>
                  <th>O.D</th>
                  <th>Weight</th>
                  <th>C.S</th>
                  <th>Notch Dist.</th>
                  <th>Notch Depth</th>
                </tr>
              </thead>
              <tbody>{measuredDimensionRows(winderRows)}</tbody>
            </table>
          </section>

          <section className="job-band job-oven-band">
            <div className="job-section-title">
              <span>Oven Curing (O1-O6)</span>
              <span>{ovenPlan.machineLabel}</span>
            </div>
            <div className="job-mini-grid job-mini-grid-8">
              <PrintField label="Plan Date" value={ovenPlan.planDate} />
              <PrintField label="Oven No." value={ovenMachineLabel} />
              <PrintField label="Operator" value={ovenPrintEntry.operator_name} />
              <PrintField label="Bamboo In / Out" value={`${ovenPrintEntry.bamboo_count_in || formatNumber(ovenPrintStage?.input_qty || effectiveTargetBamboo, 0)} / ${ovenPrintEntry.bamboo_count_out || formatNumber(ovenPrintStage?.output_qty, 0)}`} />
              <PrintField label="Wet / Dry Bamboo" value={`${formatNumber(bambooWetWeightG)} / ${formatNumber(bambooDryWeightG)} g`} />
              <PrintField label="Pre / Post Moisture" value={`${ovenPrintEntry.moisture_before || "-"} / ${ovenPrintEntry.moisture_after || "-"}`} />
              <PrintField label="Start / End" value={`${ovenPrintEntry.start_time || "-"} / ${ovenPrintEntry.end_time || "-"}`} />
              <PrintField label="Reject / Reason" value={`${formatNumber(ovenPrintStage?.scrap_qty, 0)} / ${ovenPrintEntry.rejection_code || "-"}`} />
            </div>
          </section>

          <section className="job-band">
            <div className="job-section-title">
              <span>Process Line (P1-P11)</span>
              <span>{processPlan.machineLabel}</span>
            </div>
            <div className="job-mini-grid job-mini-grid-8">
              <PrintField label="Plan Date" value={processPlan.planDate} />
              <PrintField label="Line No." value={processMachineLabel} />
              <PrintField label="Operator" value={processPrintEntry.operator_name} />
              <PrintField label="Oven Qty" value={formatNumber(ovenPrintStage?.output_qty || effectiveTargetBamboo, 0)} />
              <PrintField label="Process Qty" value={processPrintEntry.process_qty || formatNumber(processPrintStage?.output_qty || releaseQty, 0)} />
              <PrintField label="Reject / Reason" value={`${processPrintEntry.reject_qty || formatNumber(processPrintStage?.scrap_qty, 0)} / ${processPrintEntry.reject_reason || "-"}`} />
              <PrintField label="Start / End" value={`${processPrintEntry.start_time || "-"} / ${processPrintEntry.end_time || "-"}`} />
              <PrintField label="Cycle Time" value={processPrintEntry.cycle_time || "-"} />
            </div>
            <table className="job-print-table job-dimension-table">
              <thead>
                <tr>
                  <th>Length</th>
                  <th>I.D</th>
                  <th>O.D</th>
                  <th>Weight</th>
                  <th>C.S</th>
                  <th>Notch Dist.</th>
                  <th>Notch Depth</th>
                </tr>
              </thead>
              <tbody>{measuredDimensionRows(processRows)}</tbody>
            </table>
          </section>

          <section className="job-band job-pack-band">
            <div className="job-section-title">
              <span>Packing + Dispatch</span>
              <span>Release Close</span>
            </div>
            <div className="job-mini-grid job-mini-grid-8">
              <PrintField label="Box Packed" value={packingPrintEntry.total_packed_qty || ""} />
              <PrintField label="Tube / Box" value={setup.qty_per_box || ""} />
              <PrintField label="Dispatch Date" value={packingPrintEntry.dispatch_date || dispatchPrintEntry.dispatch_date || ""} />
              <PrintField label="Dispatch Qty" value={dispatchQty > 0 ? formatNumber(dispatchQty, 0) : ""} />
              <PrintField label="Pending Qty" value={pendingQty > 0 ? formatNumber(pendingQty, 0) : ""} />
              <PrintField label="QC Sign" value={qcPrintEntry.qc_sign || processPrintEntry.qc_sign || ""} />
              <PrintField label="Supervisor" value={packingPrintEntry.supervisor_sign || ""} />
              <PrintField label="Notes" value={processPrintStage?.remarks || packingPrintStage?.remarks || qcPrintStage?.remarks || ""} />
            </div>
            <div className="job-signature-row">
              <SignatureLine label="Winder Operator" />
              <SignatureLine label="Oven Operator" />
              <SignatureLine label="Process Operator" />
              <SignatureLine label="QC Inspector" />
              <SignatureLine label="Supervisor" />
            </div>
          </section>
        </section>

        <style jsx global>{`
          .job-print-root {
            color: #0f172a;
            width: min(100%, 210mm);
          }

          .job-one-sheet {
            box-sizing: border-box;
            border: 2px solid #0f172a;
            background: #fff;
            padding: 18px;
            min-height: 297mm;
            display: flex;
            flex-direction: column;
            box-shadow: 0 26px 80px rgba(15, 23, 42, 0.14);
          }

          .job-topbar {
            display: grid;
            grid-template-columns: 1fr 92px 118px 54px;
            align-items: center;
            gap: 7px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 7px;
          }

          .job-company {
            font-size: 21px;
            font-weight: 950;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }

          .job-title {
            margin-top: 2px;
            font-size: 12px;
            font-weight: 900;
            letter-spacing: 0.38em;
            text-transform: uppercase;
            color: #475569;
          }

          .job-ref-box {
            border: 1px solid #0f172a;
            padding: 5px 6px;
            min-height: 42px;
          }

          .job-ref-box span,
          .job-print-label {
            display: block;
            font-size: 7px;
            font-weight: 900;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: #64748b;
          }

          .job-ref-box strong,
          .job-print-value {
            display: block;
            margin-top: 3px;
            font-size: 9.5px;
            font-weight: 850;
            line-height: 1.15;
            color: #0f172a;
          }

          .job-hero-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            border-left: 1px solid #0f172a;
          }

          .job-print-field {
            min-height: 29px;
            border: 1px solid #0f172a;
            border-left: 0;
            border-top: 0;
            background: #fff;
            padding: 3px 5px;
            overflow: hidden;
          }

          .job-band {
            border: 1px solid #0f172a;
            border-top: 0;
            background: #fff;
          }

          .job-summary-band {
            margin-top: 8px;
          }

          .job-section-title {
            display: grid;
            grid-template-columns: 1fr 155px;
            border-bottom: 1px solid #0f172a;
            background: #f1f5f9;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #0f172a;
          }

          .job-section-title > span {
            padding: 5px 7px;
          }

          .job-section-title > span + span {
            border-left: 1px solid #0f172a;
            letter-spacing: 0.04em;
          }

          .job-mini-grid {
            display: grid;
            border-left: 1px solid #0f172a;
          }

          .job-mini-grid-8 {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .job-mini-grid .job-print-field {
            border-top: 0;
          }

          .job-print-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9px;
          }

          .job-print-table th,
          .job-print-table td {
            height: 7mm;
            border: 1px solid #0f172a;
            border-left: 0;
            padding: 2px 4px;
            text-align: left;
          }

          .job-print-table th {
            background: #f8fafc;
            font-size: 7px;
            font-weight: 950;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #334155;
          }

          .job-signature-row {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px;
            padding: 14mm 7px 5px;
          }

          .job-signature {
            padding-top: 18px;
          }

          .job-signature-line {
            height: 1px;
            border-top: 1px solid #0f172a;
            margin-bottom: 5px;
          }

          @media print {
            @page {
              size: A4 portrait;
              margin: 5mm;
            }

            .no-print {
              display: none !important;
            }

            header,
            aside,
            nav {
              display: none !important;
            }

            body {
              background: #fff !important;
            }

            .job-print-root {
              width: 200mm;
              max-width: none !important;
            }

            .job-one-sheet {
              min-height: 287mm;
              break-after: auto;
              padding: 6mm 7mm;
              box-shadow: none !important;
            }

            .job-summary-band {
              margin-top: 3mm;
            }

            .job-print-field {
              min-height: 8.8mm;
              padding: 1.2mm 1.8mm;
            }

            .job-ref-box {
              min-height: 13mm;
            }

            .job-print-table th,
            .job-print-table td {
              height: 6.8mm;
              padding: 1mm 1.4mm;
            }

            .job-signature-row {
              padding-top: 12mm;
              padding-bottom: 2mm;
            }
          }
        `}</style>
      </div>
    )

  }

  if (!jobCardId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
        Select a job card to load the document.
      </div>
    )
  }

  if (jobCardQuery.isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading job card...</div>
  }

  if (jobCardQuery.isError || !card) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-700">Unable to load job card.</div>
  }

  if (mode === "print") {
    return renderReleasePrintLayout()
  }

  if (mode === "view" || mode === "supervisor") {
    return renderCompactExecutionLayout()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 print:max-w-none">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Snapshot Mode: <span className="font-semibold text-slate-900">{card.snapshot_mode}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === "view" && (
            <>
              <Link
                href={`/production/job-cards/${jobCardId}/print`}
                className="inline-flex items-center gap-2 border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900"
              >
                <Printer className="h-4 w-4" />
                Print
              </Link>
              <Link
                href={`/production/supervisor-entry?job_card_id=${jobCardId}`}
                className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Open Supervisor Entry
              </Link>
            </>
          )}
        </div>
      </div>

      <section className="border-2 border-slate-900 bg-white p-4 print:p-3">
        <div className="grid gap-4 border-b border-slate-400 pb-4 md:grid-cols-[1.3fr_220px]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              {documentSnapshot?.header?.company_name || "Hari Om Paper"}
            </div>
            <h1 className="mt-2 text-3xl font-bold uppercase tracking-wide text-slate-900">Job Card</h1>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <LabeledValue label="Date" value={documentSnapshot?.header?.date || ""} />
              <LabeledValue label="Shift" value={documentSnapshot?.header?.shift || ""} />
              <LabeledValue label="Plant" value={displayPlantScope(documentSnapshot?.header?.plant_id, "")} />
            </div>
          </div>
          <div className="justify-self-end border border-slate-300 p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">QR Lookup</div>
            <div className="mt-2 inline-flex justify-center">
              <QRCodeSVG value={qrValue} size={108} />
            </div>
            <div className="mt-2 text-[11px] text-slate-600">{qrValue}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <LabeledValue label="Planned Machine" value={lineMachineLabel} />
          <LabeledValue label="Job Card Number" value={card.job_card_ref} />
          <LabeledValue label="Sales Order Number" value={card.sales_order_ref} />
          <LabeledValue label="Customer Name" value={documentSnapshot?.header?.customer_name || ""} />
          <LabeledValue label="Product Size" value={documentSnapshot?.header?.product_size_label || ""} />
          <LabeledValue label="Parchment" value={parchmentLabel} />
          <LabeledValue label="Mandrel Size" value={mandrelLabel} />
          <LabeledValue label="Planned Shift" value={primaryStageAssignment.shiftLabel || documentSnapshot?.header?.shift || ""} />
          <LabeledValue label="Order Quantity (pcs)" value={formatNumber(documentSnapshot?.header?.order_quantity_pcs, 0)} />
          <LabeledValue label="Required C.S" value={formatNumber(documentSnapshot?.header?.required_cs)} />
          <LabeledValue label="Pcs per Bamboo" value={formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)} />
          <LabeledValue label="Target Bamboo Count" value={formatNumber(documentSnapshot?.header?.target_bamboo_count, 0)} />
        </div>

        <section className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Execution Setup</p>
            <p className="mt-2 text-base font-semibold text-slate-900">{primaryStageAssignment.machineLabel || lineMachineLabel}</p>
            <p className="mt-1 text-xs text-slate-500">{primaryStageAssignment.shiftLabel || "Planner assignment pending"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mandrel + Size</p>
            <p className="mt-2 text-base font-semibold text-slate-900">{mandrelLabel}</p>
            <p className="mt-1 text-xs text-slate-500">{documentSnapshot?.header?.product_size_label || "-"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Parchment</p>
            <p className="mt-2 text-base font-semibold text-slate-900">{parchmentLabel}</p>
            <p className="mt-1 text-xs text-slate-500">Chosen on the sales order line</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Packaging</p>
            <p className="mt-2 text-base font-semibold text-slate-900">{packagingSummary || "-"}</p>
            <p className="mt-1 text-xs text-slate-500">{documentSnapshot?.setup_tooling?.packing_instructions || "No extra packing instructions"}</p>
          </div>
        </section>

        <section className="mt-4 border border-slate-800">
          <div className="border-b border-slate-800 bg-slate-100 px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-900">
            Material Truth
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-5">
            <LabeledValue label="Planned Output" value={formatNumber(documentSnapshot?.material_truth?.planned_output_qty, 0)} />
            <LabeledValue label="Issued to Winder" value={formatNumber(documentSnapshot?.material_truth?.issued_input_qty, 0)} />
            <LabeledValue label="Produced" value={formatNumber(documentSnapshot?.material_truth?.produced_output_qty, 0)} />
            <LabeledValue label="Packed" value={formatNumber(documentSnapshot?.material_truth?.packed_qty, 0)} />
            <LabeledValue label="Dispatched" value={formatNumber(documentSnapshot?.material_truth?.dispatched_qty, 0)} />
          </div>
        </section>

        <section className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-cyan-800">WIP</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(wipQty, 0)}</div>
            <div className="mt-1 text-sm text-slate-600">Open quantity still in process for this job card.</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Carry Forward</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(carryForward.remaining_qty || 0, 0)}</div>
            <div className="mt-1 text-sm text-slate-600">
              {carryForward.suggested ? carryForward.reason : "No remainder suggestion from completed stages yet."}
            </div>
          </div>
          <div className={`rounded-xl border p-4 ${dispatchGateBlocked ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${dispatchGateBlocked ? "text-rose-800" : "text-emerald-800"}`}>Dispatch Gate</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{dispatchGateBlocked ? "Blocked" : "Ready"}</div>
            <div className="mt-1 text-sm text-slate-600">
              {dispatchGateBlocked
                ? `Pending: ${incompleteUpstreamStages.join(", ")}${activeHoldCount > 0 ? ` | QC holds ${activeHoldCount}` : ""}`
                : "Packing and QC are complete with no active hold."}
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <MatrixBlock title="Client Specifications" ranges={documentSnapshot?.client_spec} />
          <section className="border border-slate-800">
            <div className="border-b border-slate-800 bg-slate-100 px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-900">
              Manufacturing Specifications
            </div>
            <div className="grid gap-2 p-3 md:grid-cols-2">
              <LabeledValue label="Oven Dry Weight" value={formatNumber(documentSnapshot?.manufacturing_spec?.oven_dry_weight)} />
              <LabeledValue label="With Mandrel Weight" value={formatNumber(documentSnapshot?.manufacturing_spec?.with_mandrel_weight)} />
              <LabeledValue label="Winder Pre-Dry C.S" value={formatNumber(documentSnapshot?.manufacturing_spec?.winder_pre_dry_cs)} />
              <LabeledValue label="Final Required C.S" value={formatNumber(documentSnapshot?.manufacturing_spec?.final_required_cs)} />
              <LabeledValue label="GSM (derived)" value={formatNumber(documentSnapshot?.manufacturing_spec?.gsm_derived)} />
            </div>
          </section>
        </div>

        <section className="mt-4 border border-slate-800">
          <div className="border-b border-slate-800 bg-slate-100 px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-900">
            Setup / Tooling
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-3">
            <LabeledValue label="Mandrel" value={mandrelLabel} />
            <LabeledValue label="Notch" value={documentSnapshot?.setup_tooling?.notch_type || ""} />
            <LabeledValue label="Blade" value={documentSnapshot?.setup_tooling?.blade || ""} />
            <LabeledValue label="Holder" value={documentSnapshot?.setup_tooling?.notching_holder || documentSnapshot?.setup_tooling?.holder || ""} />
            <LabeledValue label="V + Flat" value={documentSnapshot?.setup_tooling?.v_flat || ""} />
            <LabeledValue label="Punch" value={documentSnapshot?.setup_tooling?.punch || ""} />
            <LabeledValue label="Direction" value={documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || ""} />
            <LabeledValue label="Notch Distance" value={documentSnapshot?.setup_tooling?.notch_distance || ""} />
            <LabeledValue label="Notch Deep" value={documentSnapshot?.setup_tooling?.notch_depth || ""} />
            <LabeledValue label="Qty / Box" value={documentSnapshot?.setup_tooling?.qty_per_box || ""} />
            <LabeledValue label="Box" value={documentSnapshot?.setup_tooling?.box || ""} />
            <LabeledValue
              label="Tool Trail"
              value={toolingUsage.map((row: any) => `${row.label || row.category}: ${row.tool_name}`).filter(Boolean).join(" | ")}
              className="md:col-span-3"
            />
            <LabeledValue label="Special Instructions" value={documentSnapshot?.setup_tooling?.special_instructions || ""} className="md:col-span-3" />
            <LabeledValue label="Packing Instructions" value={documentSnapshot?.setup_tooling?.packing_instructions || ""} className="md:col-span-3" />
          </div>
        </section>

        <div className="mt-4 space-y-4">
          {renderSlittingSection()}
          {renderWinderSection()}
          {renderOvenSection()}
          {renderProcessSection()}
          {renderPackingSection()}
          {renderQcSection()}
          {renderDispatchSection()}
        </div>

        {(documentSnapshot?.sections_meta?.legacy_notes?.length > 0 || documentSnapshot?.sections_meta?.missing_fields?.length > 0) && (
          <section className="mt-4 border border-dashed border-slate-400 px-3 py-3 text-xs text-slate-600">
            {documentSnapshot?.sections_meta?.legacy_notes?.length > 0 && (
              <div>{documentSnapshot.sections_meta.legacy_notes.join(" ")}</div>
            )}
            {documentSnapshot?.sections_meta?.missing_fields?.length > 0 && (
              <div className="mt-1">
                Missing fields: {documentSnapshot.sections_meta.missing_fields.join(", ")}
              </div>
            )}
          </section>
        )}
      </section>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          header,
          aside,
          nav {
            display: none !important;
          }

          body {
            background: #fff !important;
          }

          section,
          table,
          tr {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}
