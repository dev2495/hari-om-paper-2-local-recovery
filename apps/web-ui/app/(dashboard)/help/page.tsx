import { HelpPageClient } from "@/components/workspace/help-page-client"

export default function HelpPage({ searchParams }: { searchParams?: { route?: string | string[] } }) {
  const route = Array.isArray(searchParams?.route) ? searchParams?.route[0] : searchParams?.route
  return <HelpPageClient route={route || "/dashboard"} />
}
