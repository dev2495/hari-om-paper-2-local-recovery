"use client"

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { useApp } from "@/context/AppContext"

/** The server's own words for a failed request (FastAPI detail, validation list or message). */
export function errorMessage(error: any): string {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  if (detail && typeof detail === "object") return String(detail.message || detail.detail || JSON.stringify(detail))
  return String(error?.message || "Something went wrong")
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useApp()
  const [client] = useState(
    () =>
      new QueryClient({
        // Every failed action shows in the bottom-right banner (client 2026-10-18), whatever the
        // page does inline. A signed-out session is handled by the login redirect instead.
        mutationCache: new MutationCache({
          onError: (error: any, _variables, _context, mutation) => {
            if (error?.response?.status === 401 || (mutation?.meta as any)?.silentError) return
            showToast(errorMessage(error), "error")
          },
        }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
