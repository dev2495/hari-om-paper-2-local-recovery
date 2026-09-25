"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Hover / focus card rendered in a portal so table scroll containers never clip it.
 * Opens after a short intent delay, stays open while the pointer is over the card.
 */
export function HoverCard({ trigger, children, width = 300, label }: { trigger: ReactNode; children: ReactNode; width?: number; label?: string }) {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), 120) }
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 140) }

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const rect = anchor.current.getBoundingClientRect()
    const above = rect.bottom + 180 > window.innerHeight && rect.top > 200
    setPosition({ top: above ? window.innerHeight - rect.top + 8 : rect.bottom + 8, left: Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8), above })
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener("scroll", close, true)
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", onKey) }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <>
      <span ref={anchor} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} aria-label={label}>
        {trigger}
      </span>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              onMouseEnter={show}
              onMouseLeave={hide}
              className="tube-popover fixed !min-w-0 !p-3 text-[12.5px] leading-5"
              style={{ ...(position.above ? { bottom: position.top } : { top: position.top }), left: position.left, width, transformOrigin: position.above ? "bottom center" : "top center" }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
