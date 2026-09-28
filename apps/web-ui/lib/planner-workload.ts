export type WorkloadGrouping = "release" | "machine"
export type WorkloadJob = Record<string, any>
export type WorkloadRow = { id: string; label: string; parts: number; cards: number; pcs: number; load: number; unknown: number; ready: number; waiting: number }
const positive = (n: unknown) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0

export function workloadMachine(job: WorkloadJob, stage: string, grouping: WorkloadGrouping) {
  if (grouping === "release") return String(job.assigned_winder_machine_id || "unassigned")
  // A previous stage's current machine is never an assignment for this stage.
  return String(job.machine_id || (String(job.current_stage).toUpperCase() === stage.toUpperCase() ? job.current_machine_id : null) || "unassigned")
}

export function workloadUnit(stage: string) {
  return stage.toUpperCase() === "WINDER" ? "m" : stage.toUpperCase() === "OVEN" ? "bamboo" : "pcs"
}

export function workloadLoad(job: WorkloadJob, stage: string): number | null {
  const pcs = positive(job.segment_planned_qty ?? job.planned_qty)
  if (!pcs) return 0
  if (stage.toUpperCase() === "WINDER") {
    const metres = positive(job.required_capacity)
    if (metres) return metres
    const bamboo = positive(job.target_bamboo_count)
    const length = positive(job.selected_bamboo_length_mm)
    return bamboo && length ? bamboo * length / 1000 : null
  }
  if (stage.toUpperCase() === "OVEN") {
    const bamboo = positive(job.target_bamboo_count)
    const perBamboo = positive(job.pcs_per_bamboo)
    return bamboo || (perBamboo ? Math.ceil(pcs / perBamboo) : null)
  }
  return pcs
}

export function summarizeWorkload(jobs: WorkloadJob[], stage: string, grouping: WorkloadGrouping, label: (id: string) => string): WorkloadRow[] {
  const groups = new Map<string, WorkloadRow & { seen: Set<string> }>()
  const seenParts = new Set<string>()
  jobs.forEach((job, index) => {
    const identity = String(job.segment_id || job.active_segment_id || job.queue_id || job.job_card_id || job.id || `row-${index}`)
    if (seenParts.has(identity)) return
    seenParts.add(identity)
    const id = workloadMachine(job, stage, grouping)
    const row = groups.get(id) || { id, label: id === "unassigned" ? (grouping === "release" ? "No release winder" : "Machine not assigned") : label(id), parts: 0, cards: 0, pcs: 0, load: 0, unknown: 0, ready: 0, waiting: 0, seen: new Set<string>() }
    row.parts++
    row.seen.add(String(job.job_card_id || job.id || identity))
    row.cards = row.seen.size
    row.pcs += positive(job.segment_planned_qty ?? job.planned_qty)
    const load = workloadLoad(job, stage)
    row.load += load ?? 0
    if (load === null) row.unknown++
    if (String(job.current_stage).toUpperCase() === stage.toUpperCase()) row.ready++
    else row.waiting++
    groups.set(id, row)
  })
  return Array.from(groups.values()).map(({ seen, ...row }) => row).sort((a, b) => b.load - a.load || b.pcs - a.pcs || a.label.localeCompare(b.label))
}

export function clampWorkloadPosition(position: { x: number; y: number }, viewport: { width: number; height: number }, panel: { width: number; height: number }) {
  const maxX = Math.max(8, viewport.width - panel.width - 8)
  const maxY = Math.max(8, viewport.height - panel.height - 8)
  return { x: Math.max(8, Math.min(maxX, Number.isFinite(position.x) ? position.x : maxX)), y: Math.max(8, Math.min(maxY, Number.isFinite(position.y) ? position.y : 160)) }
}
