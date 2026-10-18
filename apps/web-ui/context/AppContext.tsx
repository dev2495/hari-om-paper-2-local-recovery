"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"

type ToastTone = "success" | "error" | "info"

type ToastState = {
  message: string
  type: ToastTone
} | null

type AppContextValue = {
  toast: ToastState
  showToast: (message: string, tone?: ToastTone) => void
  clearToast: () => void
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<number | undefined>(undefined)

  // Bottom-right banner (client 2026-10-18): every message is visible without scrolling and
  // clears itself; errors stay longer than confirmations.
  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const text = String(message || "").trim()
    if (!text) return
    setToast({ message: text, type: tone })
    if (typeof window !== "undefined") {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(null), tone === "error" ? 12000 : 6000)
    }
  }, [])

  const clearToast = useCallback(() => {
    if (typeof window !== "undefined") window.clearTimeout(timer.current)
    setToast(null)
  }, [])

  const value = useMemo(
    () => ({
      toast,
      showToast,
      clearToast,
    }),
    [toast, showToast, clearToast],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useApp must be used within AppProvider")
  }
  return context
}
