import { redirect } from "next/navigation"

const STAGE_MAP: Record<string, string> = {
  winder: "WINDER",
  oven: "OVEN",
  process: "PROCESS",
  packing: "PACKING",
  qc: "QC",
}

export default async function LegacyPlanningBoardSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const resolvedParams = await params
  const section = String(resolvedParams?.section || "").toLowerCase()
  const normalized = Object.keys(STAGE_MAP).includes(section) ? section : "winder"
  redirect(`/planning/board?section=${normalized}`)
}
