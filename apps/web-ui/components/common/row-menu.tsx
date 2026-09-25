"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type RowMenuItem = {
  label: string
  icon?: LucideIcon
  href?: string
  onSelect?: () => void
  tone?: "default" | "warn" | "danger"
  testId?: string
  disabled?: boolean
}

/**
 * Compact "⋯" row action menu. Rendered in a portal so scroll containers and
 * transformed ancestors never clip it; flips upward near the viewport bottom.
 */
export function RowMenu({ items, label = "More actions" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const height = Math.min(320, items.length * 36 + 12)
      const up = rect.bottom + height + 8 > window.innerHeight && rect.top > height + 8
      setPosition({ top: up ? rect.top - height - 6 : rect.bottom + 6, left: Math.max(8, rect.right - 208), up })
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus() }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const nodes = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") || [])
        const index = nodes.indexOf(document.activeElement as HTMLElement)
        nodes[(index + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus()
      }
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey) }
  }, [open])

  useEffect(() => {
    if (open && position) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
  }, [open, position])

  const itemClass = (item: RowMenuItem) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-foreground/[.05] focus-visible:bg-foreground/[.06]",
      item.tone === "warn" && "text-signal-amber-ink",
      item.tone === "danger" && "text-destructive",
      item.disabled && "pointer-events-none opacity-40",
    )

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-foreground/[.06] hover:text-foreground aria-expanded:bg-foreground/[.06] aria-expanded:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              className="tube-popover fixed w-52 !min-w-0 !p-1"
              style={{ top: position.top, left: position.left, transformOrigin: position.up ? "bottom right" : "top right" }}
            >
              {items.map((item) => {
                const Icon = item.icon
                const content = (
                  <>
                    {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" /> : null}
                    <span className="truncate">{item.label}</span>
                  </>
                )
                return item.href ? (
                  <Link key={item.label} href={item.href} role="menuitem" data-testid={item.testId} aria-disabled={item.disabled || undefined} className={itemClass(item)} onClick={() => setOpen(false)}>
                    {content}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    data-testid={item.testId}
                    aria-disabled={item.disabled || undefined}
                    className={itemClass(item)}
                    onClick={() => { setOpen(false); item.onSelect?.() }}
                  >
                    {content}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
