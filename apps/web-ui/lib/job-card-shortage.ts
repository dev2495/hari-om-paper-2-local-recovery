export type ShortageDecision = "CARRY_FORWARD" | "SHORT_CLOSE_SO" | "HOLD"

export type ShortageRecord = {
  id: string
  job_card_id: string
  stage_type: string
  planned_qty: number
  produced_qty: number
  gap_qty: number
  reason_code: string
  decision: ShortageDecision
  notes?: string | null
  carry_forward_job_card_id?: string | null
  hold_status?: string | null
  created_at: string
  resolved_at?: string | null
  resolved_by?: string | null
  resolution_decision?: ShortageDecision | null
  resolution_note?: string | null
}

export type ShortageReview = {
  kind: "CREATE" | "RESOLVE"
  job_card_id: string
  short_close_id?: string
  planned_qty: number
  produced_qty: number
  gap_qty: number
  reason_code: string
  reason_label: string
  decision: ShortageDecision
  notes: string
}

const normalizedNote = (value?: string | null) => (value || "").trim()

// A timeout can follow a committed decision. Only the same reviewed action
// counts as recovered success; another manager's decision must remain visible.
export function matchesShortageReview(record: ShortageRecord | null | undefined, review: ShortageReview): boolean {
  if (!record || record.job_card_id !== review.job_card_id || record.stage_type !== "JOB_CARD") return false
  if (review.kind === "RESOLVE") return record.id === review.short_close_id
    && record.decision === "HOLD" && record.hold_status === "RESOLVED"
    && record.resolution_decision === review.decision
    && normalizedNote(record.resolution_note) === normalizedNote(review.notes)
  return record.decision === review.decision && record.reason_code === review.reason_code
    && Number(record.planned_qty) === review.planned_qty && Number(record.produced_qty) === review.produced_qty
    && Number(record.gap_qty) === review.gap_qty && normalizedNote(record.notes) === normalizedNote(review.notes)
}

// The original OPEN hold predates a resolution attempt. Seeing it again after
// a timeout does not establish the outcome of that attempt or permit a new one.
export function shortageRecoveryIsConclusive(record: ShortageRecord | null | undefined, review: ShortageReview, failureStatus: number): boolean {
  const sameCard = record?.job_card_id === review.job_card_id && record?.stage_type === "JOB_CARD"
  const savedOutcome = sameCard && (review.kind === "CREATE"
    || record?.id === review.short_close_id && record?.hold_status === "RESOLVED")
  return Boolean(savedOutcome) || [400, 403, 404, 409, 422].includes(failureStatus)
}
