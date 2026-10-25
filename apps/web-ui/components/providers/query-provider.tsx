"use client"

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { useApp } from "@/context/AppContext"
import { describeApiError } from "@/lib/api-error"

/** The server's own words for a failed request (FastAPI detail, validation list or message). */
export function errorMessage(error: any): string {
  return describeApiError(error)
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
