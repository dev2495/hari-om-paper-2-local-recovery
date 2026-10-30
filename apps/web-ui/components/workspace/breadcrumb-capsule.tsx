"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronRight, MoreHorizontal, type LucideIcon } from "lucide-react"

export type Crumb = { label: string; href?: string; icon?: LucideIcon }

// useLayoutEffect warns during server rendering; the measuring only matters in the browser.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * "Where am I" capsule: back, section › workspace › page. Segments animate in on
 * every route change; each earlier segment is a link one level up.
 *
 * Crumbs are never squeezed into a few letters. When the top bar is too narrow for all
 * of them, the earliest ones fold into a "…" menu (keyboard and touch operable) and the
 * current page always stays whole.
 */
export function BreadcrumbCapsule({ crumbs, routeKey, backHref }: { crumbs: Crumb[]; routeKey: string; backHref?: string }) {
  const router = useRouter()
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const measureRef = useRef<HTMLOListElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [folded, setFolded] = useState(0)
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null)
  const menuOpen = Boolean(menuAt)
  const setMenuOpen = (open: boolean) => {
    const rect = open ? moreRef.current?.getBoundingClientRect() : null
    setMenuAt(rect ? { top: rect.bottom + 8, left: Math.max(12, rect.left - 4) } : null)
  }
  const signature = crumbs.map((crumb) => crumb.label).join("\u0000")

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back()
    else if (backHref) router.push(backHref)
    else router.back()
  }

  // Fold the fewest leading crumbs that make the rest fit the space the top bar gives us.
  const fit = useCallback(() => {
    const nav = navRef.current
    const list = listRef.current
    const measure = measureRef.current
    const room = nav?.parentElement?.clientWidth || 0
    if (!nav || !list || !measure || !room) return
    const items = Array.from(measure.children) as HTMLElement[]
    const ellipsis = items[0]?.offsetWidth || 0
    const widths = items.slice(1).map((item) => item.offsetWidth)
    const chrome = nav.offsetWidth - list.offsetWidth
    const total = (from: number) => chrome + (from > 0 ? ellipsis : 0) + widths.slice(from).reduce((sum, width) => sum + width, 0)
    let next = 0
    // A few px of slack: sub-pixel widths and the bold current crumb must never clip the last letters.
    while (next < widths.length - 1 && total(next) > room - 6) next += 1
    setFolded((current) => (current === next ? current : next))
  }, [])

  useIsomorphicLayoutEffect(() => {
    setMenuAt(null)
    fit()
  }, [signature, routeKey, fit])

  useEffect(() => {
    const host = navRef.current?.parentElement
    if (!host || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => fit())
    observer.observe(host)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLElement>("a, [role=menuitem]")?.focus()
    const close = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !moreRef.current?.contains(target)) setMenuAt(null)
    }
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuAt(null)
        moreRef.current?.focus()
        return
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a[role=menuitem]") || [])
      if (!items.length) return
      event.preventDefault()
      const at = items.indexOf(document.activeElement as HTMLElement)
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
    }
    const away = () => setMenuAt(null)
    document.addEventListener("mousedown", close)
    document.addEventListener("touchstart", close)
    document.addEventListener("keydown", keys)
    window.addEventListener("resize", away)
    window.addEventListener("scroll", away, true)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("touchstart", close)
      document.removeEventListener("keydown", keys)
      window.removeEventListener("resize", away)
      window.removeEventListener("scroll", away, true)
    }
  }, [menuOpen])

  const LeadIcon = crumbs[0]?.icon
  const hidden = crumbs.slice(0, folded)
  const shown = crumbs.slice(folded)

  const crumbBody = (crumb: Crumb, index: number) => (
    <>
      {index === 0 && LeadIcon ? <LeadIcon aria-hidden="true" /> : null}
      {crumb.label}
    </>
  )

  return (
    <nav ref={navRef} aria-label="Breadcrumb" className="tube-crumbs">
      <button type="button" onClick={goBack} className="tube-crumbs-back" aria-label="Go back" title="Back">
        <ArrowLeft />
      </button>
      <ol ref={listRef} key={routeKey}>
        {hidden.length ? (
          <li style={{ ["--crumb-index" as any]: 0 }}>
            <div className="tube-crumbs-more">
              <button
                ref={moreRef}
                type="button"
                className="tube-crumbs-more-button"
                aria-label={`Show ${hidden.length} earlier ${hidden.length === 1 ? "page" : "pages"}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
              {menuAt && typeof document !== "undefined" ? createPortal(
                <div ref={menuRef} role="menu" aria-label="Earlier pages" className="tube-crumbs-menu" style={{ top: menuAt.top, left: menuAt.left }}>
                  {hidden.map((crumb, index) => crumb.href ? (
                    <Link key={`${crumb.label}-${index}`} role="menuitem" href={crumb.href} onClick={() => setMenuAt(null)} style={{ paddingLeft: 10 + index * 12 }}>
                      {crumbBody(crumb, index)}
                    </Link>
                  ) : (
                    <span key={`${crumb.label}-${index}`} role="menuitem" aria-disabled="true" style={{ paddingLeft: 10 + index * 12 }}>
                      {crumbBody(crumb, index)}
                    </span>
                  ))}
                </div>,
                document.body,
              ) : null}
            </div>
          </li>
        ) : null}
        {shown.map((crumb, offset) => {
          const index = folded + offset
          const last = index === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${index}`} style={{ ["--crumb-index" as any]: offset + (hidden.length ? 1 : 0) }}>
              {index > 0 ? <ChevronRight className="tube-crumbs-sep" aria-hidden="true" /> : null}
              {last || !crumb.href ? (
                <span aria-current={last ? "page" : undefined} className={last ? "is-current" : undefined} title={crumb.label}>
                  {crumbBody(crumb, index)}
                </span>
              ) : (
                <Link href={crumb.href} title={crumb.label}>
                  {crumbBody(crumb, index)}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
      {/* Invisible copy at natural width: the widths "fit" compares against the room available. */}
      <ol ref={measureRef} className="tube-crumbs-measure" aria-hidden="true">
        <li><span className="tube-crumbs-more-button"><MoreHorizontal /></span></li>
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`}>
            {index > 0 ? <ChevronRight className="tube-crumbs-sep" /> : null}
            <span className={index === crumbs.length - 1 ? "is-current" : undefined}>{crumbBody(crumb, index)}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
