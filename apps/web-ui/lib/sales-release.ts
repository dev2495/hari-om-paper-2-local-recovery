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
