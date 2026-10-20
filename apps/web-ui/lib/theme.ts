/**
 * Light / dark theme (client 2026-10-20: "system mode by default but can toggle easily").
 *
 * The choice is saved on this device only. "system" follows the Windows/macOS setting live;
 * the top-bar sun/moon button flips to the other theme in one click and remembers it, and
 * Appearance › System goes back to following the device.
 */
"use client"

import { useEffect, useState } from "react"

import { THEME_KEY } from "@/lib/theme-boot"

export type ThemeChoice = "system" | "light" | "dark"
export type Theme = "light" | "dark"

const THEME_EVENT = "hariom-theme-change"

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === "light" || saved === "dark" ? saved : "system"
  } catch {
    return "system"
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === "system" ? systemTheme() : choice
}

/** Swap the theme with a cross-fade (View Transitions) or a short colour tween as fallback. */
function applyTheme(next: Theme, choice: ThemeChoice, animate: boolean) {
  const root = document.documentElement
  root.dataset.themeChoice = choice
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

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch { /* Session-only preference. */ }
  applyTheme(resolveTheme(choice), choice, true)
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** Current choice and the theme on screen; every control using it stays in step. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system")
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const read = () => {
      const current = readThemeChoice()
      const next = resolveTheme(current)
      setChoice(current)
      setTheme(next)
      return { current, next }
    }
    // The device theme changed, or another tab saved a choice: apply it here too.
    const follow = () => {
      const { current, next } = read()
      applyTheme(next, current, true)
    }
    follow()
    media.addEventListener("change", follow)
    window.addEventListener("storage", follow)
    // This tab already applied (and is animating) the new theme; only refresh the controls.
    window.addEventListener(THEME_EVENT, read)
    return () => {
      media.removeEventListener("change", follow)
      window.removeEventListener("storage", follow)
      window.removeEventListener(THEME_EVENT, read)
    }
  }, [])

  return {
    choice,
    theme,
    choose: setThemeChoice,
    /** One click: switch to the other theme and remember it on this device. */
    toggle: () => setThemeChoice(theme === "dark" ? "light" : "dark"),
  }
}
