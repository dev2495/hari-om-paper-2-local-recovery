"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Download, Scissors } from "lucide-react"

import { Field, fieldClass } from "@/components/procurement/procurement-shell"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useSlittingReport } from "@/hooks/use-inventory"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

const kg = (value: any) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`
const pct = (value: any) => (value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`)
const monthStart = () => `${businessDate().slice(0, 8)}01`

/** Slitting: what each reel sent to the slitter turned into (client rule 2026-10-18). */
export default function SlittingReportPage() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(businessDate())
  const report = useSlittingReport({ date_from: from, date_to: to })
  const data = report.data
  const rows: any[] = useMemo(() => data?.rows || [], [data])
  const byDay = useMemo(() => {
    const map = new Map<string, { day: string; reels: number; kg: number; coils: number; wastage: number }>()
    rows.forEach((row) => {
      const entry = map.get(row.issue_date) || { day: row.issue_date, reels: 0, kg: 0, coils: 0, wastage: 0 }
      entry.reels += 1; entry.kg += Number(row.issued_weight_kg || 0)
      if (row.slitting_card) { entry.coils += Number(row.slitting_card.coils_made || 0); entry.wastage += Number(row.slitting_card.wastage_kg || 0) }
      map.set(row.issue_date, entry)
    })
    return [...map.values()].sort((a, b) => b.day.localeCompare(a.day))
  }, [rows])
  const maxKg = Math.max(1, ...byDay.map((entry) => entry.kg))

  const exportCsv = () => {
    const header = ["Issue date", "Shift", "Reel", "Paper", "GSM", "Issued kg", "Coils made", "Wastage kg", "Wastage %", "Kg per coil", "Card by", "Card status"]
    const lines = rows.map((row) => [row.issue_date, row.shift, row.reel_code, row.paper_code, row.gsm ?? "", row.issued_weight_kg, row.slitting_card?.coils_made ?? "", row.slitting_card?.wastage_kg ?? "", row.slitting_card?.wastage_pct ?? "", row.slitting_card?.kg_per_coil ?? "", row.slitting_card?.recorded_by ?? "", row.slitting_card ? "Written" : "Pending"])
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    link.download = `slitting-${from}-to-${to}.csv`
    link.click()
  }

  return (
    <RoleGate allow={["PlantManager", "Store", "Planner", "RMIssue"]}>
      <div className="space-y-5" data-testid="slitting-report">
        <PageHeader title="Slitting report" description="Every reel issued to the floor for slitting, with its slitting card: coils made and wastage. Wastage % is wastage kg over the reel's issued kg." actions={<button type="button" className="erp-btn-secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />Export CSV</button>} />
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
          <Field label="From"><input className={cn(fieldClass, "w-40")} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className={cn(fieldClass, "w-40")} type="date" value={to} min={from} max={businessDate()} onChange={(e) => setTo(e.target.value)} /></Field>
          <Link href="/inventory/reels/issue" className="ml-auto text-[13px] font-semibold text-primary hover:underline">Write pending slitting cards</Link>
        </div>
        {report.isLoading ? <LoadingState label="Loading slitting report…" /> : report.isError ? <ErrorState message="The slitting report could not be loaded." onRetry={() => report.refetch()} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                ["Reels to slitter", data?.summary?.reels_issued ?? 0, ""],
                ["Paper issued", kg(data?.summary?.issued_kg), ""],
                ["Coils made", data?.summary?.coils_made ?? 0, ""],
                ["Wastage", `${kg(data?.summary?.wastage_kg)} · ${pct(data?.summary?.wastage_pct)}`, ""],
                ["Cards pending", data?.summary?.cards_pending ?? 0, data?.summary?.cards_pending ? "text-signal-amber-ink" : ""],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-card p-3.5"><p className="text-[12px] font-semibold text-muted-foreground">{label}</p><p className={cn("mt-1.5 text-xl font-semibold tabular-nums", String(tone))}>{value}</p></div>
              ))}
            </div>
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <section className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="border-b border-border px-4 py-3"><h2 className="font-semibold">By paper</h2></header>
                {data?.by_paper?.length ? (
                  <table className="tube-grid w-full">
                    <thead><tr><th>Paper</th><th className="text-right">Reels</th><th className="text-right">Issued</th><th className="text-right">Coils</th><th className="text-right">Wastage</th></tr></thead>
                    <tbody>{data.by_paper.map((row: any) => <tr key={row.paper_code}><td className="font-medium">{row.paper_code}<span className="block text-[12px] font-normal text-muted-foreground">{row.paper_name}</span></td><td className="text-right tabular-nums">{row.reels}</td><td className="text-right tabular-nums">{kg(row.issued_kg)}</td><td className="text-right tabular-nums">{row.coils_made}</td><td className={cn("text-right tabular-nums", Number(row.wastage_pct) > 3 ? "text-signal-rose-ink" : "")}>{pct(row.wastage_pct)}</td></tr>)}</tbody>
                  </table>
                ) : <p className="px-4 py-6 text-sm text-muted-foreground">No slitting cards in this period.</p>}
              </section>
              <section className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="border-b border-border px-4 py-3"><h2 className="font-semibold">By day</h2><p className="text-[12.5px] text-muted-foreground">Bar = kg sent to the slitter</p></header>
                {byDay.length ? (
                  <ul className="divide-y divide-border">
                    {byDay.map((entry) => (
                      <li key={entry.day} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-[13px]">
                        <span className="text-muted-foreground">{new Date(entry.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        <span className="h-2 rounded-full bg-muted" aria-hidden="true"><span className="block h-2 rounded-full bg-primary" style={{ width: `${(100 * entry.kg) / maxKg}%` }} /></span>
                        <span className="tabular-nums">{entry.reels} reels · {entry.coils} coils · {kg(entry.wastage)} waste</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-4 py-6 text-sm text-muted-foreground">Nothing sent to the slitter in this period.</p>}
              </section>
            </div>
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="border-b border-border px-4 py-3"><h2 className="font-semibold">Every reel · {rows.length}</h2></header>
              {rows.length ? (
                <div className="overflow-x-auto">
                  <table className="tube-grid w-full min-w-[860px]">
                    <thead><tr><th>Date · shift</th><th>Reel</th><th>Paper</th><th className="text-right">Issued</th><th className="text-right">Coils</th><th className="text-right">Wastage</th><th className="text-right">Kg / coil</th><th>Card</th></tr></thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>{new Date(row.issue_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {row.shift}</td>
                          <td className="font-medium">{row.reel_code}</td>
                          <td>{row.paper_code || "—"}{row.gsm ? <span className="text-muted-foreground"> · {row.gsm} GSM</span> : null}</td>
                          <td className="text-right tabular-nums">{kg(row.issued_weight_kg)}</td>
                          <td className="text-right tabular-nums">{row.slitting_card?.coils_made ?? "—"}</td>
                          <td className="text-right tabular-nums">{row.slitting_card ? `${kg(row.slitting_card.wastage_kg)} · ${pct(row.slitting_card.wastage_pct)}` : "—"}</td>
                          <td className="text-right tabular-nums">{row.slitting_card?.kg_per_coil != null ? kg(row.slitting_card.kg_per_coil) : "—"}</td>
                          <td>{row.slitting_card ? <span className="text-[12.5px]">{row.slitting_card.recorded_by || "Written"}</span> : <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-signal-amber-ink"><Scissors className="h-3.5 w-3.5" aria-hidden="true" />Pending</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-4 py-6 text-sm text-muted-foreground">No reels were sent to the slitter in this period.</p>}
            </section>
          </>
        )}
      </div>
    </RoleGate>
  )
}
