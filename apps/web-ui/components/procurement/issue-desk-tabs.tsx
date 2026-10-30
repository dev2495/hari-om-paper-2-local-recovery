"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

/** The two stores issue screens are one desk. Everything goes to the floor by shift (client rule 2026-10-18). */
export function IssueDeskTabs() {
  const pathname = usePathname() || ""
  const tabs = [
    { href: "/inventory/reels/issue", label: "Reels & coils → floor", hint: "Scan the AT label; a reel goes to the slitter, a coil to the winders, by shift." },
    { href: "/inventory/production-issue", label: "Adhesive / parchment / packing → floor", hint: "Issue by the Amigo inward number to the floor, by shift." },
  ]
  return (
    <nav aria-label="Issue desk" className="flex flex-wrap gap-2" data-testid="issue-desk-tabs">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} title={tab.hint} className={cn("inline-flex min-h-11 items-center rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition sm:min-h-9", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </Link>
        )
      })}
      <span className="self-center text-[11.5px] text-muted-foreground">Issued material is consumed in full on the floor; the job card records production and the stock count settles consumption.</span>
    </nav>
  )
}
