import { redirect } from "next/navigation"

export default async function DispatchPrintRedirectPage({
  params,
}: {
  params: Promise<{ jobCardId: string }>
}) {
  const resolvedParams = await params
  redirect(`/logistics/dispatch/${resolvedParams.jobCardId}/print`)
}
