"use client"

import { useEffect, useState } from "react"
import { ListFilter, SunMoon } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"

type Theme = "system" | "light" | "dark"
const THEME_KEY = "hariom_theme_v1"
const DENSITY_KEY = "hariom_density_v1"

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>("system")
  const [compact, setCompact] = useState(false)
  const [ready, setReady] = useState(false)
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
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme }
    apply(); media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme, ready])
  useEffect(() => { if (ready) document.documentElement.dataset.density = compact ? "compact" : "comfortable" }, [compact, ready])
  return <Dialog><DialogTrigger asChild><button className="tube-icon-button" aria-label="Appearance settings" title="Appearance settings"><SunMoon size={17} /></button></DialogTrigger><DialogContent><DialogTitle>Make this workspace yours</DialogTitle><DialogDescription>Display preferences stay on this device. Your role, plant and records are unchanged.</DialogDescription><label className="flex items-center justify-between gap-4 text-sm">Appearance
    <select aria-label="Appearance" className="tube-theme-select" value={theme} onChange={event => {
      const value = event.target.value as Theme; setTheme(value)
      try { localStorage.setItem(THEME_KEY, value) } catch { /* Session-only preference. */ }
    }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
    </label><button type="button" className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-3 text-sm" title={compact ? "Use comfortable table density" : "Use compact table density"} aria-label="Compact table density" aria-pressed={compact} onClick={() => {
      setCompact(!compact)
      try { localStorage.setItem(DENSITY_KEY, !compact ? "compact" : "comfortable") } catch { /* Session-only preference. */ }
    }}><ListFilter size={16} />{compact ? "Compact rows enabled" : "Comfortable rows enabled"}</button>
  </DialogContent></Dialog>
}
