"use client"

import { useEffect } from "react"

import { useApp } from "@/context/AppContext"

const SELECTOR = '[role="alert"],[role="status"]'

/**
 * Mirrors what a page tells the user into the bottom-right banner (client 2026-10-18: "errors at the
 * top need a scroll"). Any error that appears ([role=alert]) is shown; a result message
 * ([role=status]) is shown when it follows the user's own click or key press. Loading states,
 * hidden live regions and the banner itself are ignored; the same text is not repeated for 15 s.
 */
export function MessageMirror() {
  const { showToast } = useApp()
  useEffect(() => {
    let lastInteraction = 0
    const mark = () => { lastInteraction = Date.now() }
    const seen = new Map<string, number>()
    const consider = (el: Element | null) => {
      if (!el || el.closest(".tube-toast") || el.closest("[data-no-mirror]")) return
      if (!(el instanceof HTMLElement) || !el.getClientRects().length || el.classList.contains("sr-only")) return
      const role = el.getAttribute("role")
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").replace(/\bRetry\b/g, "").trim()
      if (text.length < 4 || /^loading\b/i.test(text) || /…$/.test(text)) return
      const error = role === "alert"
      if (!error && Date.now() - lastInteraction > 8000) return
      const now = Date.now()
      const key = `${role}:${text}`
      if ((seen.get(key) || 0) > now - 15000) return
      seen.set(key, now)
      const tone = error || /rose|destructive/.test(String(el.className)) ? "error" : /amber|cyan|blue/.test(String(el.className)) ? "info" : "success"
      showToast(text.length > 300 ? `${text.slice(0, 297)}…` : text, tone)
    }
    const observer = new MutationObserver((records) => {
      const found = new Set<Element>()
      for (const record of records) {
        const nodes = record.type === "characterData" ? [record.target.parentElement] : Array.from(record.addedNodes)
        for (const node of nodes) {
          if (!(node instanceof Element)) continue
          const owner = node.closest(SELECTOR)
          if (owner) found.add(owner)
          if (node.matches(SELECTOR)) found.add(node)
          node.querySelectorAll(SELECTOR).forEach((el) => found.add(el))
        }
      }
      // Let the page finish rendering the message before reading it.
      if (found.size) window.setTimeout(() => found.forEach(consider), 60)
    })
    document.addEventListener("pointerdown", mark, true)
    document.addEventListener("keydown", mark, true)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      document.removeEventListener("pointerdown", mark, true)
      document.removeEventListener("keydown", mark, true)
    }
  }, [showToast])
  return null
}
