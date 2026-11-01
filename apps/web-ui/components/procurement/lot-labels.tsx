"use client"
import { QRCodeSVG } from "qrcode.react"

import { PlantReelLabel, usePlantLabelContext } from "@/components/inventory/plant-reel-label"
import { isPlantReelFacts } from "@/lib/reel-label"
import { buildScanUrl } from "@/lib/app-url"
import { unitWord } from "@/lib/stock-format"

/** "Reel", "Coil" or "Batch": the physical form in words, never the REEL code. */
const formWord = (value?: string | null) => { const text = String(value || "Batch").toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1) }

// Each QR is a /scan link around the lot's saved identity (client 2026-10-27): the phone camera opens the
// issue desk or incoming QC by role; in-app scan boxes read it and the older plain labels alike.

const indianDate = (value?: string | null) => {
  const date = value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : value || ""
}

/** Reel / coil label (owner decision 6, 1 Nov 2026): exactly the plant's own layout plus the QR. */
function ReelLabelCard({ lot, heading, mill }: { lot: any; heading: string; mill: string }) {
  const label = lot.label || {}
  return <PlantReelLabel facts={label.facts} qrValue={label.qr_value || lot.at_no} heading={heading} mill={mill} />
}

export function LotLabels({ lots }: { lots: any[] }) {
  const context = usePlantLabelContext()
  return <div className="label-print-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="grn-lot-labels">{lots.map((lot) => lot.entity_type !== "BATCH" && isPlantReelFacts(lot.label?.facts) ? <ReelLabelCard key={lot.id} lot={lot} heading={context.heading} mill={context.millOf(lot.label.facts)} /> : <article key={lot.id} className="break-inside-avoid rounded-lg border border-border bg-card p-4 text-foreground">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest">Amigo · material lot</p><p className="mt-2 break-all font-mono text-sm font-bold">{lot.at_no}</p><p className="mt-1 text-xs">{lot.label?.item_code} · {lot.label?.item_name}</p></div>{lot.label?.qr_value || lot.at_no ? <QRCodeSVG value={buildScanUrl(lot.label?.qr_value || lot.at_no)} size={112} level="M" className="shrink-0" /> : null}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><p>Vendor lot <strong>{lot.source_reel_no || lot.label?.batch_no}</strong></p><p>{formWord(lot.physical_form)} · <strong>{Number(lot.quantity ?? lot.net_weight_kg).toLocaleString("en-IN")} {unitWord(lot.uom || "KG")}</strong></p>{lot.entity_type !== "BATCH" ? <p>Width <strong>{lot.width_mm || lot.label?.width_mm || lot.label?.metadata?.width_mm} mm</strong></p> : null}<p>{indianDate(lot.label?.inward_date)}</p><p className="col-span-2">PO <strong>{lot.label?.po_no || "Manual receipt"}</strong>{lot.label?.grn_no ? <> · Inward <strong>{lot.label.grn_no}</strong></> : null}</p></div>
  </article>)}</div>
}
