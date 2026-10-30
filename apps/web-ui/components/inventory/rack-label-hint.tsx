"use client"

import Link from "next/link"
import { MapPin } from "lucide-react"

import { parseScanCode } from "@/lib/scan-code"
import { cn } from "@/lib/utils"

/** In-app scan boxes say "That is a rack label" instead of "not found" when a rack QR is scanned into them
 * (client 2026-10-28), with a link to the rack's page. Renders nothing for any other value. */
export function RackLabelHint({ value, expected, className }: { value: string; expected: string; className?: string }) {
  const parsed = parseScanCode(value)
  if (parsed.kind !== "LOCATION") return null
  return (
    <p role="status" data-testid="rack-label-hint" className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] leading-5 text-signal-amber-ink", className)}>
      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">That is a rack label ({parsed.code || "location"}). Scan the {expected}.</span>
      <Link href={`/inventory/locations/${parsed.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">See what is on {parsed.code || "the rack"}</Link>
    </p>
  )
}
