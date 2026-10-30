"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

/** One switcher for every master, grouped the way the plant thinks about them. */
export const MASTER_GROUPS = [
  {
    label: "Materials",
    links: [
      { href: "/masters/papers", label: "Papers" },
      { href: "/masters/parchments", label: "Parchments" },
      { href: "/masters/adhesives", label: "Adhesives" },
      { href: "/masters/packaging", label: "Packaging" },
      { href: "/masters/tube-sizes", label: "Tube sizes" },
      { href: "/masters/mandrels", label: "Mandrels" },
      { href: "/masters/tools", label: "Physical tools" },
    ],
  },
  {
    label: "Parties",
    links: [
      { href: "/masters/customers", label: "Customers" },
      { href: "/masters/vendors", label: "Vendors" },
      { href: "/masters/contact-directory", label: "Contacts" },
    ],
  },
  {
    label: "Shop floor",
    links: [
      { href: "/masters/employees", label: "Employees" },
      { href: "/masters/shifts", label: "Shifts" },
      { href: "/masters/holidays", label: "Holidays" },
      { href: "/masters/reason-codes", label: "Reason codes" },
      { href: "/masters/order-close-reasons", label: "Order close reasons" },
    ],
  },
  {
    label: "Quality",
    links: [{ href: "/masters/inward-qc", label: "Inward QC tolerances" }],
  },
] as const

export function MastersNav({ className }: { className?: string }) {
  const pathname = usePathname() || ""
  const navRef = useRef<HTMLElement | null>(null)
  // The strip scrolls sideways on a phone and at narrow widths: bring the open master's tab into view.
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active) return
    const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2)
    }
  }, [pathname])
  return (
    <nav ref={navRef} aria-label="Masters" className={cn("overflow-x-auto rounded-xl border border-border bg-card px-2 py-2", className)} data-testid="masters-nav">
      <div className="flex min-w-max items-center gap-1">
        {MASTER_GROUPS.map((group, index) => (
          <div key={group.label} className="flex items-center gap-1">
            {index ? <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" /> : null}
            <span className="px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</span>
            {group.links.map((link) => {
              const active = pathname === link.href || (link.href === "/masters/vendors" && pathname === "/masters/suppliers")
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-lg sm:min-h-8 px-2.5 text-[12.5px] font-semibold transition-colors duration-150",
                    active ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-muted hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
