"use client"

import { QRCodeSVG } from "qrcode.react"

import { ReelLabelFacts, hasReelFacts, type ReelFacts } from "@/components/inventory/reel-label-facts"
import { dayText, qtyText, type LotRow } from "@/lib/api-stock"
import { buildScanUrl } from "@/lib/app-url"
import { cn } from "@/lib/utils"

/**
 * A reel or lot label (e.g. stock a count added on QC hold): the AT / lot number big, the material, the
 * quantity in its own unit, where it is and its QC state, and a QR that the phone camera opens as
 * /scan?c=HARIOM|REEL|<plant>|<id>|<code> (or BATCH) — the same payload as a GRN label.
 */
export function LotLabel({ lot, plantId, plantName, className, note }: {
  /** ``facts``: the readable reel / coil lines (GSM, BF, Polybond, width, weight, vendor, received, reel no). */
  lot: LotRow & { facts?: ReelFacts | null }; plantId: string; plantName?: string; className?: string
  /** Optional extra line (opening stock prints its old mark and source); other callers leave it out. */
  note?: string
}) {
  const url = buildScanUrl(`HARIOM|${lot.entity_type}|${plantId}|${lot.id}|${lot.code}`)
  return (
    <article className={cn("tube-paper flex break-inside-avoid flex-col gap-2 rounded-xl border-2 border-foreground/80 bg-card p-4 text-foreground", className)} data-testid="lot-label">
      <p className="text-[11px] font-bold uppercase tracking-[.16em] text-muted-foreground">{plantName ? `${plantName} · ` : ""}{lot.entity_type === "REEL" ? (lot.physical_form === "COIL" ? "Coil" : "Reel") : "Lot"}</p>
      {/* Long system numbers (a lot a count added) step down so the number stays on one line. */}
      <p className={cn("break-all font-mono font-black leading-none tracking-tight", lot.code.length > 22 ? "text-[19px]" : lot.code.length > 16 ? "text-[23px]" : "text-[30px]")} data-testid="lot-label-code">{lot.code}</p>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {lot.entity_type === "REEL" && hasReelFacts(lot.facts) ? (
            <ReelLabelFacts facts={lot.facts} />
          ) : (
            <>
              <p className="text-[16px] font-semibold leading-tight">{lot.item_name}</p>
              <p className="text-[12px] text-muted-foreground">{lot.item_code}</p>
              <p className="text-[18px] font-bold tabular-nums">{qtyText(lot.qty, lot.uom)}</p>
            </>
          )}
          <p className="text-[12px] leading-snug">
            <b>{lot.held ? "On QC hold" : lot.qc_word}</b>
            {lot.held ? " · incoming QC clears it before use" : ""}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {lot.location_code ? <>{lot.location_name || lot.location_code} · <span className="whitespace-nowrap">{lot.location_code}</span></> : "No location yet"}
            {lot.created_at ? <> · <span className="whitespace-nowrap">{dayText(lot.created_at)}</span></> : null}
          </p>
          {note ? <p className="text-[12px] font-semibold leading-snug" data-testid="lot-label-note">{note}</p> : null}
        </div>
        <QRCodeSVG value={url} size={112} level="M" className="shrink-0" bgColor="#ffffff" fgColor="#000000" includeMargin />
      </div>
    </article>
  )
}
