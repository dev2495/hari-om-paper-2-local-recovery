"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

/**
 * Lets a page name its own last breadcrumb ("Count CNT-20261028-011 · RM-A-01", "Rack labels")
 * instead of the name the shell derives from the URL. The label is kept per path and cleared
 * when the page unmounts, so it never leaks onto the next page.
 */
type LabelStore = { labels: Record<string, string>; setLabel: (path: string, label: string | null) => void }

const BreadcrumbLabelContext = createContext<LabelStore | null>(null)

export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({})
  // Stable setter: pages re-run their effect only when their own label changes.
  const setLabel = useCallback((path: string, label: string | null) => setLabels((current) => {
    if (label ? current[path] === label : !(path in current)) return current
    const next = { ...current }
    if (label) next[path] = label
    else delete next[path]
    return next
  }), [])
  const store = useMemo<LabelStore>(() => ({ labels, setLabel }), [labels, setLabel])
  return <BreadcrumbLabelContext.Provider value={store}>{children}</BreadcrumbLabelContext.Provider>
}

/** The label a page set for ``path``, if any (used by the shell). */
export function useBreadcrumbLabelFor(path: string) {
  return useContext(BreadcrumbLabelContext)?.labels[path]
}

/** Call from a page: ``useBreadcrumbLabel(count ? `Count ${count.count_no}` : null)``. */
export function useBreadcrumbLabel(label: string | null | undefined) {
  const pathname = usePathname()
  const store = useContext(BreadcrumbLabelContext)
  const setLabel = store?.setLabel
  const text = label?.trim() || null
  useEffect(() => {
    if (!setLabel || !pathname) return
    setLabel(pathname, text)
    return () => setLabel(pathname, null)
  }, [setLabel, pathname, text])
}
