"use client"
import { QRCodeSVG } from "qrcode.react"

import { ReelLabelFacts, hasReelFacts } from "@/components/inventory/reel-label-facts"
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

/** Reel / coil label as printed from now on (client 2026-10-30): AT number, the readable lines and the QR. */
function ReelLabelCard({ lot }: { lot: any }) {
  const label = lot.label || {}
  return <article className="break-inside-avoid rounded-lg border border-border bg-card p-4 text-foreground" data-testid="grn-reel-label">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest">{label.metadata?.legal_entity || "Amigo"} · {formWord(lot.physical_form || label.physical_form || "Reel")}</p>
        <p className="mt-1 break-all font-mono text-[19px] font-black leading-tight">{lot.at_no || label.amigo_no || label.code}</p>
        <ReelLabelFacts facts={label.facts} className="mt-2" />
      </div>
      {label.qr_value || lot.at_no ? <QRCodeSVG value={buildScanUrl(label.qr_value || lot.at_no)} size={104} level="M" className="shrink-0" bgColor="#ffffff" fgColor="#000000" includeMargin /> : null}
    </div>
    <p className="mt-2 text-[11px] text-muted-foreground">PO <strong>{label.po_no || "Manual receipt"}</strong>{label.grn_no ? <> · Inward <strong>{label.grn_no}</strong></> : null}</p>
  </article>
}

export function LotLabels({ lots }: { lots: any[] }) {
  return <div className="label-print-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lots.map((lot) => lot.entity_type !== "BATCH" && hasReelFacts(lot.label?.facts) ? <ReelLabelCard key={lot.id} lot={lot} /> : <article key={lot.id} className="break-inside-avoid rounded-lg border border-border bg-card p-4 text-foreground">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest">Amigo · material lot</p><p className="mt-2 break-all font-mono text-sm font-bold">{lot.at_no}</p><p className="mt-1 text-xs">{lot.label?.item_code} · {lot.label?.item_name}</p></div>{lot.label?.qr_value || lot.at_no ? <QRCodeSVG value={buildScanUrl(lot.label?.qr_value || lot.at_no)} size={112} level="M" className="shrink-0" /> : null}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><p>Vendor lot <strong>{lot.source_reel_no || lot.label?.batch_no}</strong></p><p>{formWord(lot.physical_form)} · <strong>{Number(lot.quantity ?? lot.net_weight_kg).toLocaleString("en-IN")} {unitWord(lot.uom || "KG")}</strong></p>{lot.entity_type !== "BATCH" ? <p>Width <strong>{lot.width_mm || lot.label?.width_mm || lot.label?.metadata?.width_mm} mm</strong></p> : null}<p>{indianDate(lot.label?.inward_date)}</p><p className="col-span-2">PO <strong>{lot.label?.po_no || "Manual receipt"}</strong>{lot.label?.grn_no ? <> · Inward <strong>{lot.label.grn_no}</strong></> : null}</p></div>
  </article>)}</div>
}
