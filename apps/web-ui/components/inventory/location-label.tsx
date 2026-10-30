"use client"

import { QRCodeSVG } from "qrcode.react"

import { PURPOSE_WORD, type LocationBrief } from "@/lib/api-stock"
import { buildScanUrl } from "@/lib/app-url"
import { locationScanPayload } from "@/lib/scan-code"
import { cn } from "@/lib/utils"

/**
 * A rack label: the code big enough to read from the aisle (its own full-width line), the plain name, and a
 * QR that the phone camera opens as /scan?c=HARIOM|LOC|<plant>|<location id>|<CODE> (the location page,
 * actions by role).
 */
export function LocationLabel({ location, plantId, plantName, size = "sheet", className }: {
  location: Pick<LocationBrief, "id" | "code" | "name" | "purpose">; plantId: string; plantName?: string; size?: "sheet" | "card"; className?: string
}) {
  const url = buildScanUrl(locationScanPayload(plantId, location.id, location.code))
  const sheet = size === "sheet"
  // Long codes step down so they stay on one line; short rack codes print as big as the label allows.
  const codeSize = !sheet ? "text-[24px]" : location.code.length > 12 ? "text-[34px]" : location.code.length > 9 ? "text-[40px]" : "text-[48px]"
  return (
    <article className={cn("tube-paper flex break-inside-avoid flex-col rounded-xl border-2 border-foreground/80 bg-card text-foreground", sheet ? "gap-2 p-4" : "gap-1.5 border border-border p-3", className)} data-testid="location-label">
      <p className="text-[11px] font-bold uppercase tracking-[.16em] text-muted-foreground">{plantName ? `${plantName} · ` : ""}{PURPOSE_WORD[String(location.purpose)] || "Location"}</p>
      <p className={cn("break-all font-mono font-black leading-none tracking-tight", codeSize)} data-testid="location-label-code">{location.code}</p>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold leading-tight [text-wrap:balance]", sheet ? "text-[18px]" : "text-[13px]")}>{location.name}</p>
          <p className={cn("mt-1.5 leading-snug text-muted-foreground [text-wrap:pretty]", sheet ? "text-[12px]" : "text-[11px]")}>Scan to see what is here, move stock or count this rack.</p>
        </div>
        <QRCodeSVG value={url} size={sheet ? 118 : 88} level="M" className="shrink-0" bgColor="#ffffff" fgColor="#000000" includeMargin />
      </div>
    </article>
  )
}
