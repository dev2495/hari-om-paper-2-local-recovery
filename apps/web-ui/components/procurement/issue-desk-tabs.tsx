"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

/** The two stores issue screens are one desk: paper reels go by AT number to a winder, every other material goes to a job card. */
export function IssueDeskTabs() {
  const pathname = usePathname() || ""
  const tabs = [
    { href: "/inventory/reels/issue", label: "Paper reels → winder", hint: "Scan the AT label; the reel is issued to a winder and shift." },
    { href: "/inventory/production-issue", label: "Adhesive / parchment / packing → job card", hint: "Issue by the Amigo inward number against a job card." },
  ]
  return (
    <nav aria-label="Issue desk" className="flex flex-wrap gap-2" data-testid="issue-desk-tabs">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} title={tab.hint} className={cn("rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </Link>
        )
      })}
      <span className="self-center text-[11.5px] text-muted-foreground">Paper is tracked per reel (kg returned to store after the run); other materials are consumed by quantity.</span>
    </nav>
  )
}
