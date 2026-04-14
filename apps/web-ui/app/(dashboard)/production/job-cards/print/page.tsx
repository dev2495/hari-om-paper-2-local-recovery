import { redirect } from "next/navigation"

export default function ProductionJobCardPrintAliasPage({
  searchParams,
}: {
  searchParams?: { jobId?: string }
}) {
  const jobId = (searchParams?.jobId || "").trim()
  if (!jobId) {
    redirect("/production/job-cards")
  }
  redirect(`/production/job-cards/${encodeURIComponent(jobId)}/print`)
}
