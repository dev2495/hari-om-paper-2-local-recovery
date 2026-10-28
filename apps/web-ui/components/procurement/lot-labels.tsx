"use client"
import { QRCodeSVG } from "qrcode.react"

import { buildScanUrl } from "@/lib/app-url"

// Each QR is a /scan link around the lot's saved identity (client 2026-10-27): the phone camera opens the
// issue desk or incoming QC by role; in-app scan boxes read it and the older plain labels alike.

const indianDate = (value?: string | null) => {
  const date = value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : value || ""
}

export function LotLabels({ lots }: { lots: any[] }) {
  return <div className="label-print-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lots.map((lot) => <article key={lot.id} className="break-inside-avoid rounded-lg border border-border bg-card p-4 text-foreground">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest">Amigo · material lot</p><p className="mt-2 break-all font-mono text-sm font-bold">{lot.at_no}</p><p className="mt-1 text-xs">{lot.label?.item_code} · {lot.label?.item_name}</p></div>{lot.label?.qr_value || lot.at_no ? <QRCodeSVG value={buildScanUrl(lot.label?.qr_value || lot.at_no)} size={112} level="M" className="shrink-0" /> : null}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><p>Vendor lot <strong>{lot.source_reel_no || lot.label?.batch_no}</strong></p><p>{lot.physical_form || "Batch"} · <strong>{Number(lot.quantity ?? lot.net_weight_kg).toLocaleString("en-IN")} {lot.uom || "KG"}</strong></p>{lot.entity_type !== "BATCH" ? <p>Width <strong>{lot.width_mm || lot.label?.width_mm || lot.label?.metadata?.width_mm} mm</strong></p> : null}<p>{indianDate(lot.label?.inward_date)}</p><p className="col-span-2">PO <strong>{lot.label?.po_no || "Manual receipt"}</strong>{lot.label?.grn_no ? <> · Inward <strong>{lot.label.grn_no}</strong></> : null}</p></div>
  </article>)}</div>
}
