"use client"

import { Printer, QrCode } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

type InventoryLabel = {
  entity_type?: string
  entity_id?: string
  code?: string
  batch_no?: string
  reel_code?: string
  amigo_no?: string
  human_label?: string
  qr_value?: string
  item_code?: string
  item_name?: string
  supplier_name?: string | null
  inward_date?: string | null
  qty?: number | string | null
  inward_qty?: number | string | null
  uom?: string | null
  stock_status?: string | null
  gsm?: number | string | null
  bf?: number | string | null
  ply_bond?: number | string | null
  po_no?: string | null
  bill_no?: string | null
  bill_date?: string | null
  rate?: number | string | null
  location_code?: string | null
  metadata?: Record<string, any> | null
}

type Props = {
  label?: InventoryLabel | null
  title?: string
}

function formatQty(value: unknown, uom?: string | null) {
  const numberValue = Number(value || 0)
  if (!Number.isFinite(numberValue)) return "-"
  return `${numberValue.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""}`
}

export function InventoryLabelPrint({ label, title = "Inventory Label Preview" }: Props) {
  if (!label) return null
  const code = label.human_label || label.amigo_no || label.code || label.reel_code || label.batch_no || label.entity_id || ""
  if (!code) return null
  const qrValue = label.qr_value || code
  const entityType = String(label.entity_type || (label.reel_code ? "REEL" : "BATCH")).toUpperCase()

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border print:border-slate-800 print:shadow-none">
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-800">
            <QrCode className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            <p className="text-xs text-slate-500">{entityType} · {label.stock_status || "status pending"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>

      <div className="mx-auto grid max-w-[460px] grid-cols-[1fr_auto] gap-4 border border-slate-900 bg-white p-4 print:max-w-none">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Hari Om Paper</p>
          <h3 className="mt-1 break-words text-xl font-bold leading-tight text-slate-950">{code}</h3>
          <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Item</dt>
              <dd className="text-right">{label.item_code || "-"}{label.item_name ? ` · ${label.item_name}` : ""}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Vendor</dt>
              <dd className="text-right">{label.supplier_name || "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Date</dt>
              <dd>{label.inward_date || "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Qty</dt>
              <dd>{formatQty(label.qty ?? label.inward_qty, label.uom)}</dd>
            </div>
            {label.gsm || label.bf ? (
              <div className="flex justify-between gap-3">
                <dt className="font-medium">GSM / BF</dt>
                <dd>{label.gsm || "-"} / {label.bf || "-"}</dd>
              </div>
            ) : null}
            {label.ply_bond ? (
              <div className="flex justify-between gap-3">
                <dt className="font-medium">Plybond</dt>
                <dd>{label.ply_bond}</dd>
              </div>
            ) : null}
            {label.po_no || label.bill_no ? (
              <div className="flex justify-between gap-3">
                <dt className="font-medium">PO / Bill</dt>
                <dd className="text-right">{label.po_no || "-"} / {label.bill_no || "-"}</dd>
              </div>
            ) : null}
            {label.location_code ? (
              <div className="flex justify-between gap-3">
                <dt className="font-medium">Location</dt>
                <dd>{label.location_code}</dd>
              </div>
            ) : null}
            {label.rate ? (
              <div className="flex justify-between gap-3">
                <dt className="font-medium">Rate</dt>
                <dd>{label.rate}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="flex items-center justify-center border border-slate-300 p-2">
          <QRCodeSVG value={qrValue} size={128} level="M" includeMargin />
        </div>
      </div>
    </section>
  )
}
