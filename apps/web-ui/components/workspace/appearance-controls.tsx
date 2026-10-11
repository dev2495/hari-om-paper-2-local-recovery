"use client"

import { useEffect, useRef, useState } from "react"
import { Rows3, Rows4 } from "lucide-react"

const DENSITY_KEY = "hariom_density_v1"

/**
 * Table density only. The ERP is deliberately light-only: following a dark OS theme made
 * labels white while many panels stayed light, so the theme choice was removed.
 */
export function AppearanceControls() {
  const [compact, setCompact] = useState(false)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const sync = () => {
      try {
        setCompact(localStorage.getItem(DENSITY_KEY) === "compact")
      } catch { /* Display preferences work without persistent storage. */ }
      setReady(true)
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])

  useEffect(() => { if (ready) document.documentElement.dataset.density = compact ? "compact" : "comfortable" }, [compact, ready])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey) }
  }, [open])

  const toggleDensity = (next: boolean) => {
    setCompact(next)
    try { localStorage.setItem(DENSITY_KEY, next ? "compact" : "comfortable") } catch { /* Session-only preference. */ }
  }

  const TriggerIcon = compact ? Rows4 : Rows3
  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        className="tube-icon-button"
        aria-label="Table density"
        title="Table density"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <TriggerIcon />
      </button>
      {open ? (
        <div role="dialog" aria-label="Table density" className="tube-popover right-0 top-[calc(100%+8px)] w-[272px]">
          <div className="px-2 pb-2 pt-1.5">
            <p className="text-[13px] font-semibold">Table density</p>
            <p className="text-xs text-muted-foreground">Saved on this device only.</p>
          </div>
          <div className="tube-segment w-full" role="group" aria-label="Table density">
            <button type="button" className="flex-1 justify-center" aria-pressed={!compact} aria-label="Comfortable table density" onClick={() => toggleDensity(false)}>
              <Rows3 size={14} aria-hidden="true" />
              Comfortable
            </button>
            <button type="button" className="flex-1 justify-center" aria-pressed={compact} aria-label="Compact table density" onClick={() => toggleDensity(true)}>
              <Rows4 size={14} aria-hidden="true" />
              Compact
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
