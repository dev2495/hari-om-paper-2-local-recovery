"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useAuth } from "@/context/AuthContext"

// "incoming" links are the whole desk for Inward QC; the rest belong to the full QC team.
const LINKS = [
  { href: "/quality", label: "Desk", exact: true, incoming: true },
  { href: "/quality/incoming", label: "Incoming QC", incoming: true },
  { href: "/quality/material-standards", label: "Material standards", incoming: true },
  { href: "/quality/stage-rules", label: "Seasonal stage rules" },
  { href: "/quality/stage", label: "Stage & final QC" },
  { href: "/specifications", label: "Process standards" },
  { href: "/quality/results", label: "Results / holds", incoming: true },
]

export function QualityDeskNav() {
  const pathname = usePathname()
  const { user, activeRole } = useAuth()
  const roles = new Set([activeRole, user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const incomingOnly = roles.has("InwardQC") && !["QC", "Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  return (
    <nav className="flex flex-wrap gap-2" data-testid="quality-desk-nav">
      {LINKS.filter((link) => !incomingOnly || link.incoming).map((link) => {
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
