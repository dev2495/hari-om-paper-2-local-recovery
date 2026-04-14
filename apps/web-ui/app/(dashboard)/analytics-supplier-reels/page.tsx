"use client"

import dayjs from "dayjs"
import { useMemo, useState } from "react"

import { analyticsApi } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

export default function AnalyticsSupplierReelsPage() {
  const [startDate, setStartDate] = useState(dayjs().subtract(30, "day").format("YYYY-MM-DD"))
  const [endDate, setEndDate] = useState(dayjs().format("YYYY-MM-DD"))

  const query = useQuery({
    queryKey: ["analytics-supplier-loss", startDate, endDate],
    queryFn: async () => {
      const { data } = await analyticsApi.getSupplierLoss(startDate, endDate)
      return data
    },
  })

  const rows = useMemo(() => {
    const data = query.data
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.items)) return data.items
    if (Array.isArray(data?.rows)) return data.rows
    return []
  }, [query.data])

  return (
    <div className="space-y-4">
      <section className="page-hero">
        <h1 className="page-title">Reel Loss by Supplier</h1>
        <p className="page-subtitle">Supplier-wise reel loss analytics for selected period.</p>
      </section>

      <section className="erp-panel p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <input className="h-10 rounded-lg border border-slate-300 px-3" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input className="h-10 rounded-lg border border-slate-300 px-3" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </section>

      <section className="erp-panel p-4">
        <div className="erp-table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Issued</th>
                <th>FG</th>
                <th>Scrap</th>
                <th>Loss</th>
                <th>Loss %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, idx: number) => (
                <tr key={row.supplier || row.supplier_name || idx}>
                  <td className="font-semibold">{row.supplier || row.supplier_name || "-"}</td>
                  <td>{row.issued_weight ?? row.issued ?? "-"}</td>
                  <td>{row.fg_weight ?? row.fg ?? "-"}</td>
                  <td>{row.scrap_weight ?? row.scrap ?? "-"}</td>
                  <td>{row.loss_weight ?? row.loss ?? "-"}</td>
                  <td>{row.loss_percentage ?? row.loss_pct ?? "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    No supplier loss rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

