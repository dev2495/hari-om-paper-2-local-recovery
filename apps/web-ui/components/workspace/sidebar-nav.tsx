"use client"

import Link from "next/link"
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"

import type { ModuleLink } from "@/lib/module-navigation"
import { cn } from "@/lib/utils"

export type SidebarItem = { name: string; href: string; icon: LucideIcon; description: string }
export type SidebarGroup = { title: string; items: SidebarItem[] }

/** One accent per group so the rail reads as sections at a glance. */
const GROUP_ACCENT: Record<string, string> = {
  Overview: "var(--chart-2)",
  Operations: "var(--chart-1)",
  Purchasing: "var(--chart-4)",
  "Stores & inventory": "var(--chart-6)",
  Design: "var(--chart-3)",
  Reports: "var(--chart-8)",
  Foundation: "var(--muted-foreground)",
}

type Box = { top: number; height: number } | null

export function SidebarNav({
  groups,
  currentHref,
  pathname,
  mobile = false,
  compact = false,
  isOpen,
  onToggle,
  onNavigate,
  subnav,
  badges,
}: {
  groups: SidebarGroup[]
  currentHref?: string
  pathname: string
  mobile?: boolean
  compact?: boolean
  isOpen: (title: string) => boolean
  onToggle: (title: string) => void
  onNavigate?: () => void
  subnav: Record<string, ModuleLink[]>
  badges: Record<string, { count: number; tone?: "rose" | "amber" | "primary" } | undefined>
}) {
  const canvas = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<Box>(null)
  const [hover, setHover] = useState<Box>(null)

  const measure = useCallback((element: Element | null): Box => {
    if (!element || !canvas.current) return null
    const host = canvas.current.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    if (!rect.height) return null
    return { top: rect.top - host.top, height: rect.height }
  }, [])

  // Re-measure the active item whenever the route, grouping or width changes, and while groups animate.
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const update = () => setActive(measure(element.querySelector('[data-level="top"][aria-current="page"]')))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    element.addEventListener("transitionend", update)
    return () => {
      observer.disconnect()
      element.removeEventListener("transitionend", update)
    }
  }, [currentHref, pathname, compact, groups, measure])

  const style = (box: Box): CSSProperties | undefined => (box ? { transform: `translateY(${box.top}px)`, height: box.height } : undefined)

  return (
    <nav className="tube-navigation" aria-label={mobile ? "Mobile workspaces" : "Workspaces"} onMouseLeave={() => setHover(null)}>
      <div ref={canvas} className="tube-nav-canvas">
        <span className="tube-nav-spotlight" data-visible={Boolean(hover)} style={style(hover)} aria-hidden="true" />
        <span className="tube-nav-active" data-visible={Boolean(active)} style={style(active)} aria-hidden="true" />
        {groups.map((group, groupIndex) => {
          const open = isOpen(group.title)
          const groupId = `nav-group-${group.title.replace(/[^a-z]+/gi, "-").toLowerCase()}${mobile ? "-m" : ""}`
          const accent = GROUP_ACCENT[group.title] || "var(--primary)"
          const hasActive = group.items.some((item) => item.href === currentHref)
          return (
            <div className="tube-nav-group" key={group.title} data-open={open} data-active={hasActive} style={{ ["--group-accent" as any]: `hsl(${accent})`, ["--group-index" as any]: groupIndex }}>
              <button type="button" className="tube-nav-group-toggle" aria-expanded={open} aria-controls={groupId} onClick={() => onToggle(group.title)}>
                <span className="tube-nav-group-dot" aria-hidden="true" />
                <span className="tube-nav-group-title">{group.title}</span>
                <span className="tube-nav-group-count" aria-hidden="true">{group.items.length}</span>
                <ChevronRight size={12} aria-hidden="true" />
              </button>
              <div className="tube-nav-items" id={groupId}>
                <div>
                  {group.items.map((item, itemIndex) => {
                    const isCurrent = item.href === currentHref
                    const badge = badges[item.href]
                    return (
                      <div key={item.href} style={{ ["--item-index" as any]: itemIndex }}>
                        <Link
                          href={item.href}
                          className="tube-nav-link"
                          data-level="top"
                          aria-label={badge?.count ? `${item.name}, ${badge.count}` : item.name}
                          title={compact ? item.name : undefined}
                          aria-current={isCurrent ? "page" : undefined}
                          onMouseEnter={(event) => setHover(measure(event.currentTarget))}
                          onFocus={(event) => setHover(measure(event.currentTarget))}
                          onClick={onNavigate}
                        >
                          <item.icon aria-hidden="true" />
                          <span className="tube-nav-label">{item.name}</span>
                          {badge?.count ? (
                            <em className={cn("tube-nav-badge", badge.tone && `is-${badge.tone}`)} key={badge.count}>
                              {badge.count > 99 ? "99+" : badge.count}
                            </em>
                          ) : null}
                        </Link>
                        {isCurrent && subnav[item.href] ? (
                          <div className="tube-subnav">
                            {subnav[item.href].map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
                                className="tube-nav-link"
                                data-level="sub"
                                aria-current={pathname === child.href ? "page" : undefined}
                                onMouseEnter={(event) => setHover(measure(event.currentTarget))}
                                onClick={onNavigate}
                              >
                                <span className="tube-nav-label">{child.name}</span>
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
