/**
 * Planning overview payload (GET /api/production/planning/overview).
 * Planning is only the plan; the job card log is the truth. Every planned slot is matched by the
 * service to what the floor logged for that card and stage on the same date and shift.
 */
export type Stage = "SLITTING" | "WINDER" | "OVEN" | "PROCESS"
export type ShiftCode = "SHIFT_A" | "SHIFT_B"
export type SlotResult = "UPCOMING" | "IN_PROGRESS" | "DONE" | "PARTLY" | "MOVED" | "NOT_RUN" | "NOT_NEEDED" | "FLOOR_PLACED"
export type RunMatch = "ON_PLAN" | "OTHER_MACHINE" | "OTHER_SHIFT" | "EARLY" | "LATE" | "UNPLANNED"
export type AttentionKind = "SILENT_SLOT" | "ORDER" | "AFTER_DUE" | "OVERLOAD" | "QUEUE_DUE"
export type Severity = "high" | "medium" | "low"

export type OverviewMachine = {
  id: string
  code: string
  name: string
  stage: Stage
  capacity_per_shift: number | null
  capacity_unit: string | null
}

export type OverviewShift = { code: ShiftCode; label: string; start: string; end: string }

export type OverviewSlot = {
  id: string
  job_card_id: string
  job_card_no: string
  split_kind?: string | null
  parent_job_card_id?: string | null
  customer_id?: string | null
  customer_name?: string | null
  customer_code?: string | null
  sales_order_no?: string | null
  po_number?: string | null
  product_size_label?: string | null
  parchment_color?: string | null
  is_emergency?: boolean
  due_date?: string | null
  stage: Stage
  machine_id: string
  plan_date: string
  shift_code: ShiftCode
  window_start?: string | null
  window_end?: string | null
  part_no: number
  parts: number
  planned_qty: number
  planned_pcs: number
  unit: string
  required_capacity?: number | null
  segment_status?: string | null
  card_status?: string | null
  current_stage?: string | null
  result: SlotResult
  result_label: string
  placed_by_floor?: boolean
  made_in_slot: number
  good_in_slot?: number
  made_elsewhere: number
  runs_in_slot: number
  requeue_at?: string | null
  hours_to_requeue?: number | null
  previous_stage?: string | null
  order_conflict?: boolean
}

export type OverviewLoad = {
  machine_id: string
  stage: Stage
  plan_date: string
  shift_code: ShiftCode
  load: number
  capacity: number | null
  pct: number | null
  slots: number
  planned_qty: number
  made_qty: number
  unit: string
  capacity_unit?: string | null
  /** Pieces planned on the slot, and winder slots whose spec has no tube length (metres unknown). */
  planned_pcs?: number
  length_missing_slots?: number
}

export type OverviewQueue = {
  stage: Stage
  label: string
  open_cards: number
  open_pcs: number
  due_3d: number
  overdue: number
  missed: number
  waiting_cards: number
  waiting_for: Stage | null
}

export type OverviewRun = {
  key: string
  job_card_id: string
  job_card_no: string
  stage: Stage
  date: string
  shift_code: ShiftCode
  machine_id: string
  made: number
  good: number
  unit: string
  slot_id: string | null
  match: RunMatch
  match_label: string
  days_off: number
  run: string
  operator?: string | null
  start?: string | null
  end?: string | null
}

export type OverviewMissed = {
  job_card_id: string
  job_card_no: string
  stage: Stage
  planned_date?: string | null
  planned_shift?: string | null
  planned_machine_id?: string | null
  requeued_at?: string | null
  customer?: string | null
  [key: string]: unknown
}

export type OverviewAttention = {
  kind: AttentionKind
  severity: Severity
  title: string
  detail: string
  job_card_id?: string | null
  job_card_no?: string | null
  stage?: Stage | null
  plan_date?: string | null
  shift_code?: ShiftCode | null
  machine_id?: string | null
}

export type ResultCounts = {
  slots: number
  cards: number
  planned_pcs: number
  done: number
  partly: number
  moved: number
  not_run: number
  in_progress: number
  upcoming: number
  not_needed: number
  floor_placed: number
  adherence_pct: number | null
}

export type OverviewSummary = ResultCounts & {
  unplanned_runs: number
  missed_slots: number
  queue_cards: number
  waiting_cards: number
  overloaded_shifts: number
}

export type OverviewStageSummary = ResultCounts & {
  stage: Stage
  label: string
  unit: string
  planned_qty: number
  made_in_slot: number
  avg_load_pct: number | null
  machines: number
}

export type PlanningOverview = {
  date_from: string
  date_to: string
  days: string[]
  closed_days: string[]
  today: string
  now: string
  stages: Stage[]
  stage_labels: Record<string, string>
  shifts: OverviewShift[]
  result_labels: Record<string, string>
  match_labels: Record<string, string>
  missed_slot_hours: number
  machines: OverviewMachine[]
  slots: OverviewSlot[]
  load: OverviewLoad[]
  queue: OverviewQueue[]
  runs: OverviewRun[]
  unplanned_runs: OverviewRun[]
  missed: OverviewMissed[]
  summary: OverviewSummary
  by_stage: OverviewStageSummary[]
  attention: OverviewAttention[]
}

/** Reports › Planning performance (GET /api/production/reports/planning). */
export type PlanningReportCard = {
  job_card_id: string
  job_card_no: string
  customer_name?: string | null
  stage: Stage
  slots: number
  planned_finish?: string | null
  finished_at?: string | null
  status: "ON_TIME" | "LATE" | "OPEN" | "OPEN_LATE"
  late_days: number
}

export type PlanningReport = {
  date_from: string
  date_to: string
  stages: Stage[]
  result_labels: Record<string, string>
  summary: ResultCounts & {
    missed_slots: number
    runs: number
    unplanned_runs: number
    unplanned_share_pct: number | null
    stages_finished: number
    finished_on_time: number
    on_time_pct: number | null
    avg_load_pct: number | null
  }
  by_stage: (ResultCounts & { stage: Stage; label: string; planned_qty: number; made_in_slot: number; made_elsewhere: number })[]
  by_machine: (ResultCounts & { machine_id: string; stage: Stage; planned_qty: number; made_in_slot: number; made_elsewhere: number; avg_load_pct: number | null })[]
  by_shift: (ResultCounts & { shift_code: ShiftCode; planned_qty: number; made_in_slot: number; made_elsewhere: number })[]
  trend: (ResultCounts & { date: string; planned_qty: number; made_in_slot: number; made_elsewhere: number })[]
  machines: OverviewMachine[]
  cards: PlanningReportCard[]
  missed: OverviewMissed[]
  unplanned_runs: OverviewRun[]
  slots: OverviewSlot[]
}
