"use client"

import { Printer } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

type ReelLabelPrintProps = {
  reelCode: string
  qrValue?: string
  supplierName?: string | null
  inwardDate?: string | null
  paperLabel?: string | null
  weightKg?: number | null
}

export function ReelLabelPrint({
  reelCode,
  qrValue,
  supplierName,
  inwardDate,
  paperLabel,
  weightKg,
}: ReelLabelPrintProps) {
  if (!reelCode) return null

  return (
    <section className="erp-panel p-5 shadow-xl print:border print:border-slate-800 print:shadow-none">
      <div className="no-print mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Reel Label Preview</h2>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" />
          Print Reel Label
        </button>
      </div>

      <div className="mx-auto grid max-w-[420px] grid-cols-[1fr_auto] gap-4 border border-slate-900 bg-white p-4 print:max-w-none">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Hari Om Paper</p>
          <h3 className="text-xl font-bold text-slate-900">{reelCode}</h3>
          <dl className="mt-3 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Supplier</dt>
              <dd>{supplierName || "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Paper</dt>
              <dd className="text-right">{paperLabel || "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Inward Date</dt>
              <dd>{inwardDate || "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Weight (kg)</dt>
              <dd>{weightKg != null ? Number(weightKg).toFixed(2) : "-"}</dd>
            </div>
          </dl>
        </div>
        <div className="flex items-center justify-center border border-slate-300 p-2">
          <QRCodeSVG value={qrValue || reelCode} size={128} level="M" includeMargin />
        </div>
      </div>
    </section>
  )
}

