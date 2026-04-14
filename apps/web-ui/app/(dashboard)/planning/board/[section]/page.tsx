import { redirect } from "next/navigation"

const STAGE_MAP: Record<string, string> = {
  winder: "WINDER",
  oven: "OVEN",
  process: "PROCESS",
  packing: "PACKING",
  qc: "QC",
}

export default function LegacyPlanningBoardSectionPage({
  params,
}: {
  params: { section: string }
}) {
  const section = String(params?.section || "").toLowerCase()
  const stage = STAGE_MAP[section] || "WINDER"
  redirect(`/production/planner?stage=${stage}`)
}
