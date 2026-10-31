import { HelpPageClient } from "@/components/workspace/help-page-client"

type Param = string | string[] | undefined
const first = (value: Param) => (Array.isArray(value) ? value[0] : value)

export default function HelpPage({ searchParams }: { searchParams?: { route?: Param; tab?: Param; chapter?: Param } }) {
  const route = first(searchParams?.route)
  const tab = first(searchParams?.tab) || (route ? "guide" : "handbook")
  return <HelpPageClient route={route || "/dashboard"} hasRoute={Boolean(route)} tab={tab} chapter={first(searchParams?.chapter)} />
}
