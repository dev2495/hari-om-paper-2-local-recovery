"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/quality", label: "Desk", exact: true },
  { href: "/quality/incoming", label: "Incoming QC" },
  { href: "/quality/stage", label: "Stage QC" },
  { href: "/quality/results", label: "Results / holds" },
]

export function QualityDeskNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-wrap gap-2" data-testid="quality-desk-nav">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ${
              active ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink" : "border-border bg-card text-muted-foreground"
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
