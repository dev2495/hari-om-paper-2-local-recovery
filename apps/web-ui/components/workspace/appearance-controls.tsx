"use client"

import { useEffect, useRef, useState } from "react"
import { Laptop, Moon, Rows3, Rows4, SlidersHorizontal, Sun } from "lucide-react"

import { useTheme } from "@/lib/theme"

const DENSITY_KEY = "hariom_density_v1"

/** One-click light/dark switch for the top bar. Appearance › System follows the device again. */
export function ThemeToggle() {
  const { choice, theme, toggle } = useTheme()
  const next = theme === "dark" ? "light" : "dark"
  const label = `Switch to ${next} theme`
  const Icon = theme === "dark" ? Moon : Sun
  return (
    <button
      type="button"
      className="tube-icon-button"
      aria-label={label}
      title={`${label} (now ${theme}${choice === "system" ? ", following this device" : ""})`}
      data-testid="theme-toggle"
      onClick={toggle}
    >
      <Icon key={theme} className="animate-scale-in" />
    </button>
  )
}

/** Theme (System · Light · Dark) and table density, saved on this device only. */
export function AppearanceControls() {
  const { choice, choose } = useTheme()
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

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        className="tube-icon-button"
        aria-label="Appearance settings"
        title="Appearance settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal />
      </button>
      {open ? (
        <div role="dialog" aria-label="Appearance" className="tube-popover right-0 top-[calc(100%+8px)] w-[272px]">
          <div className="px-2 pb-2 pt-1.5">
            <p className="text-[13px] font-semibold">Appearance</p>
            <p className="text-xs text-muted-foreground">Saved on this device only.</p>
          </div>
          <div className="tube-segment w-full" role="group" aria-label="Theme">
            {([
              ["system", "System", Laptop],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" className="flex-1 justify-center" aria-pressed={choice === value} onClick={() => choose(value)}>
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 px-2 pb-1 text-xs font-medium text-muted-foreground">Table density</div>
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
