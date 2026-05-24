import { redirect } from "next/navigation"

export default async function DispatchJobCardRedirectPage({
  params,
}: {
  params: Promise<{ jobCardId: string }>
}) {
  const resolvedParams = await params
  redirect(`/logistics/dispatch/new?job_card_id=${resolvedParams.jobCardId}`)
}
