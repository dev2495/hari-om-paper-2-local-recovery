"use client"

import { useEffect, useRef, useState } from "react"
import { Laptop, Moon, Rows3, Rows4, Sun } from "lucide-react"

type Theme = "system" | "light" | "dark"
const THEME_KEY = "hariom_theme_v1"
const DENSITY_KEY = "hariom_density_v1"

function resolveTheme(theme: Theme) {
  if (theme !== "system") return theme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/** Swap the theme with a cross-fade (View Transitions) or a short colour tween as fallback. */
function applyTheme(next: "light" | "dark", animate: boolean) {
  const root = document.documentElement
  if (root.dataset.theme === next) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!animate || reduce) {
    root.dataset.theme = next
    return
  }
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => {
      root.dataset.theme = next
    })
    return
  }
  root.classList.add("theme-switching")
  root.dataset.theme = next
  window.setTimeout(() => root.classList.remove("theme-switching"), 320)
}

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>("system")
  const [compact, setCompact] = useState(false)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [effective, setEffective] = useState<"light" | "dark">("light")
  const wrapper = useRef<HTMLDivElement | null>(null)
  const firstApply = useRef(true)

  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem(THEME_KEY)
        setTheme(saved === "light" || saved === "dark" ? saved : "system")
        setCompact(localStorage.getItem(DENSITY_KEY) === "compact")
      } catch { /* Display preferences work without persistent storage. */ }
      setReady(true)
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])

  useEffect(() => {
    if (!ready) return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const next = resolveTheme(theme)
      applyTheme(next, !firstApply.current)
      firstApply.current = false
      setEffective(next)
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme, ready])

  useEffect(() => { if (ready) document.documentElement.dataset.density = compact ? "compact" : "comfortable" }, [compact, ready])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey) }
  }, [open])

  const choose = (value: Theme) => {
    setTheme(value)
    try { localStorage.setItem(THEME_KEY, value) } catch { /* Session-only preference. */ }
  }
  const toggleDensity = (next: boolean) => {
    setCompact(next)
    try { localStorage.setItem(DENSITY_KEY, next ? "compact" : "comfortable") } catch { /* Session-only preference. */ }
  }

  const TriggerIcon = effective === "dark" ? Moon : Sun
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
        <TriggerIcon key={effective} className="animate-scale-in" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Appearance" className="tube-popover right-0 top-[calc(100%+8px)] w-[272px]">
          <div className="px-2 pb-2 pt-1.5">
            <p className="text-[13px] font-semibold">Appearance</p>
            <p className="text-xs text-muted-foreground">Saved on this device only.</p>
          </div>
          <div className="tube-segment w-full" role="group" aria-label="Theme">
            {([
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
              ["system", "Auto", Laptop],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" className="flex-1 justify-center" aria-pressed={theme === value} onClick={() => choose(value)}>
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
