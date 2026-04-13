"use client"

import { usePathname, useRouter } from "next/navigation"

export default function AnalyticsPage() {
  const router = useRouter()
  const pathname = usePathname()

  if (pathname === "/analytics") {
    if (typeof window !== 'undefined') {
      router.replace("/analytics/dashboard")
    }
  }

  return (
    <div className="p-8 text-center text-slate-500">
      Redirecting to Analytics Dashboard...
    </div>
  )
}
