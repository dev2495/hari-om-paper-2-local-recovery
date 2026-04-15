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
  const normalized = Object.keys(STAGE_MAP).includes(section) ? section : "winder"
  redirect(`/planning/board?section=${normalized}`)
}
