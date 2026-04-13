"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

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

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, type: tone })
  }, [])

  const clearToast = useCallback(() => {
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
