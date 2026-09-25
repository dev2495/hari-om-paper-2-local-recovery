"use client"
import { QRCodeSVG } from "qrcode.react"

export function LotLabels({ lots }: { lots: any[] }) {
  return <div className="label-print-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lots.map((lot) => <article key={lot.id} className="break-inside-avoid rounded-lg border border-border bg-card p-4 text-foreground">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest">Amigo · material lot</p><p className="mt-2 break-all font-mono text-sm font-bold">{lot.at_no}</p><p className="mt-1 text-xs">{lot.label?.item_code} · {lot.label?.item_name}</p></div>{lot.label?.qr_value ? <QRCodeSVG value={lot.label.qr_value} size={84} level="M" /> : null}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><p>Vendor lot <strong>{lot.source_reel_no}</strong></p><p>{lot.physical_form} · <strong>{Number(lot.net_weight_kg).toLocaleString("en-IN")} kg</strong></p><p>Width <strong>{lot.width_mm || lot.label?.width_mm || lot.label?.metadata?.width_mm} mm</strong></p><p>{lot.label?.inward_date}</p><p className="col-span-2">PO <strong>{lot.label?.po_no || "Manual receipt"}</strong></p></div>
  </article>)}</div>
}
