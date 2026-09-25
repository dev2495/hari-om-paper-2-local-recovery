"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"

/**
 * Thin top progress bar: starts on same-origin link clicks, ends when the route commits.
 * Pure perception — it never blocks navigation.
 */
function RouteProgressInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [active, setActive] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    setActive(false)
  }, [pathname, searchParams])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setActive(true), 80)
    }
    document.addEventListener("click", onClick, true)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener("click", onClick, true)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const safety = window.setTimeout(() => setActive(false), 10000)
    return () => window.clearTimeout(safety)
  }, [active])

  return active ? <div className="tube-progress" aria-hidden="true"><span /></div> : null
}

export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <RouteProgressInner />
    </Suspense>
  )
}
