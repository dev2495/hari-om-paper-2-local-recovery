export type ReleaseMachine = {
  id?: string
  code?: string
  name?: string
  department?: string
  status?: string
  is_active?: boolean
  active?: boolean
  capacity_value?: number
  capacity_unit?: string
  capacity_type?: string
  id_min_mm?: number
  id_max_mm?: number
  od_min_mm?: number
  od_max_mm?: number
  length_min_mm?: number
  length_max_mm?: number
}

function isActiveMachine(machine: ReleaseMachine) {
  return machine.is_active !== false && machine.active !== false
}

export function getActiveWinders(machines: unknown): ReleaseMachine[] {
  if (!Array.isArray(machines)) return []

  return (machines as ReleaseMachine[])
    .filter(isActiveMachine)
    .filter((machine) => String(machine.department || "").trim().toUpperCase() === "WINDER")
}

export function getEligibleReleaseWinders(machines: unknown): ReleaseMachine[] {
  return getActiveWinders(machines)
    .filter((machine) => String(machine.status || "UP").trim().toUpperCase() === "UP")
    .sort((left, right) =>
      String(left.code || left.name || "").localeCompare(String(right.code || right.name || "")),
    )
}

export function describeWinderAvailability(machines: unknown) {
  if (getActiveWinders(machines).length > 0) {
    return "Winder masters exist in this plant, but none is UP. Restore at least one winder before release."
  }

  return "No active WINDER master exists in this order's plant. Add or enable one in System → Machines."
}

/**
 * A line still has something to release when it has open qty, or a release lot saved in sales whose job
 * card was never made (a failed sync, or a lot saved before 28 Oct with no parchment colour). The release
 * dialog resumes such lots, so "Release lines" must stay open for them (checker 30 Oct).
 */
export function hasPendingReleaseLot(line: any): boolean {
  return (Array.isArray(line?.release_lots) ? line.release_lots : []).some(
    (lot: any) => !lot?.job_card_id && String(lot?.status || "").toLowerCase() !== "cancelled",
  )
}

export function lineHasReleaseWork(line: any): boolean {
  return Number(line?.release_remaining_qty ?? line?.remaining_qty ?? 0) > 0 || hasPendingReleaseLot(line)
}
