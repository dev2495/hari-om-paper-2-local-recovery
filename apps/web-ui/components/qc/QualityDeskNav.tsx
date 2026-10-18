"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useAuth } from "@/context/AuthContext"

// "incoming" links are the whole desk for Inward QC; the rest belong to the full QC team.
const LINKS = [
  { href: "/quality", label: "QC desk", exact: true, incoming: true },
  { href: "/quality/incoming", label: "Incoming QC", incoming: true },
  { href: "/quality/stage", label: "In-process QC" },
  { href: "/quality/results", label: "Holds & inspections", incoming: true },
  { href: "/quality/returns", label: "Customer returns" },
  { href: "/quality/material-standards", label: "Material standards", incoming: true },
  { href: "/quality/stage-rules", label: "Process stage rules" },
]

export function QualityDeskNav() {
  const pathname = usePathname()
  const { user, activeRole } = useAuth()
  const roles = new Set([activeRole, user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const incomingOnly = roles.has("InwardQC") && !["QC", "Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  return (
    <nav aria-label="Quality" className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1.5" data-testid="quality-desk-nav">
      {LINKS.filter((link) => !incomingOnly || link.incoming).map((link) => {
        const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors duration-150 ${
              active ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-muted hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
