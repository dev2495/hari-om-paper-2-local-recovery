"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { inventoryApi, productionApi } from "@/lib/api"

const STAGE_LABELS: Record<string, string> = { WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC" }

function isoDaysAgo(days: number) {
  const value = new Date()
  value.setDate(value.getDate() - days)
  return value.toISOString().slice(0, 10)
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Number(value).toFixed(1)}%`
}

function num(value: number | null | undefined, digits = 0) {
  return value == null ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function rateTone(value: number | null | undefined, good: "high" | "low") {
  if (value == null) return ""
  const bad = good === "high" ? value < 90 : value > 5
  return bad ? "text-signal-rose-ink font-semibold" : "text-signal-emerald-ink font-semibold"
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-muted text-[11.5px] font-semibold text-muted-foreground">
          <tr>{head.map((cell) => <th key={cell} className="px-3 py-2">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function QualityReportsPage() {
  const { activePlant } = useAuth()
  const [from, setFrom] = useState(isoDaysAgo(90))
  const [to, setTo] = useState(isoDaysAgo(0))
  const params = useMemo(() => ({ date_from: from, date_to: to }), [from, to])
  const production = useQuery({
    queryKey: ["quality-analytics", "production", activePlant, params],
    queryFn: async () => (await productionApi.getProductionQualityAnalytics(params)).data,
  })
  const incoming = useQuery({
    queryKey: ["quality-analytics", "incoming", activePlant, params],
    queryFn: async () => (await inventoryApi.getIncomingQualityAnalytics(params)).data,
  })
  const prod: any = production.data || {}
  const inc: any = incoming.data?.incoming || {}
  const returns: any = incoming.data?.customer_returns || {}
  const finalStage = (prod.by_stage || []).find((row: any) => row.stage === "QC")

  return (
    <RoleGate allow={["QC", "PlantManager", "Planner"]}>
      <div className="space-y-5" data-testid="quality-report-page">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">QUALITY</p>
            <h1 className="mt-1 text-2xl font-semibold">Quality analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">First-pass yield by stage, supplier quality and customer returns for the selected period.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3" /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">To</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3" /></label>
            <Link href="/reports/variance" className="erp-btn-secondary !h-10">Material variance →</Link>
          </div>
        </header>
        <QualityDeskNav />

        <div className="workspace-kpis">
          <div><small>Final QC first-pass yield</small><strong className={rateTone(finalStage?.first_pass_yield, "high")}>{production.isError ? "Unavailable" : pct(finalStage?.first_pass_yield)}</strong><small>{finalStage ? `${finalStage.job_cards} job cards` : "No final QC yet"}</small></div>
          <div><small>Incoming lots first-pass</small><strong className={rateTone(inc.first_pass_rate, "high")}>{incoming.isError ? "Unavailable" : pct(inc.first_pass_rate)}</strong><small>{num(inc.lots_inspected)} lots inspected</small></div>
          <div><small>Production holds</small><strong>{production.isError ? "—" : num(prod.holds?.opened)}</strong><small>{num(prod.holds?.still_open)} still open · avg {prod.holds?.avg_hours_to_release == null ? "—" : `${prod.holds.avg_hours_to_release} h`} to release</small></div>
          <div><small>Customer returns</small><strong className={returns.cases ? "text-signal-rose-ink" : ""}>{incoming.isError ? "—" : num(returns.cases)}</strong><small>{num(returns.qty)} pcs · {num(returns.open_cases)} open · ₹{num(returns.cost_impact)}</small></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="First-pass yield by stage" subtitle="Share of job cards whose first check at the stage passed. Later re-checks do not improve this number.">
            {production.isLoading ? <LoadingState label="Loading stage yield…" /> : production.isError ? <ErrorState message="Stage yield could not be loaded." onRetry={() => production.refetch()} /> : (
              <Table
                head={["Stage", "Job cards", "First pass", "FPY", "Checks", "Failed checks"]}
                empty="No stage inspections in this period."
                rows={(prod.by_stage || []).map((row: any) => [
                  STAGE_LABELS[row.stage] || row.stage,
                  num(row.job_cards),
                  num(row.first_pass),
                  <span key="fpy" className={rateTone(row.first_pass_yield, "high")}>{pct(row.first_pass_yield)}</span>,
                  num(row.checks),
                  num(row.failed_checks),
                ])}
              />
            )}
          </Panel>
          <Panel title="Top failing production parameters" subtitle="Parameters that failed on a job card's first check.">
            {production.isLoading ? <LoadingState label="Loading…" /> : (
              <Table
                head={["Stage", "Parameter", "Job cards"]}
                empty="No first-check failures in this period."
                rows={(prod.failing_parameters || []).map((row: any) => [STAGE_LABELS[row.stage] || row.stage, row.parameter, num(row.job_cards)])}
              />
            )}
          </Panel>
          <Panel title="Supplier quality" subtitle="Incoming lots by supplier: first-pass rate, rejections and returns. Worst reject rate first.">
            {incoming.isLoading ? <LoadingState label="Loading supplier quality…" /> : incoming.isError ? <ErrorState message="Supplier quality could not be loaded." onRetry={() => incoming.refetch()} /> : (
              <Table
                head={["Supplier", "Lots", "First pass", "Rejected", "Returned", "Reject rate", "Rejected qty"]}
                empty="No incoming inspections in this period."
                rows={(inc.by_supplier || []).map((row: any) => [
                  row.supplier,
                  num(row.lots),
                  pct(row.first_pass_rate),
                  num(row.rejected),
                  num(row.returned),
                  <span key="rate" className={rateTone(row.reject_rate, "low")}>{pct(row.reject_rate)}</span>,
                  num(row.rejected_qty, 2),
                ])}
              />
            )}
          </Panel>
          <Panel title="Incoming quality by material" subtitle="Which materials fail most often, and on which checks.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <div className="space-y-4">
                <Table
                  head={["Material", "Lots", "First pass", "Reject rate"]}
                  empty="No incoming inspections in this period."
                  rows={(inc.by_material || []).slice(0, 15).map((row: any) => [row.material, num(row.lots), pct(row.first_pass_rate), <span key="rate" className={rateTone(row.reject_rate, "low")}>{pct(row.reject_rate)}</span>])}
                />
                <Table
                  head={["Failing check", "Lots"]}
                  empty="No incoming check failed first time."
                  rows={(inc.failing_parameters || []).map((row: any) => [row.parameter, num(row.lots)])}
                />
              </div>
            )}
          </Panel>
          <Panel title="Customer returns by customer" subtitle="Quantity returned, open cases and cost impact.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <Table
                head={["Customer", "Cases", "Qty", "Open", "Cost impact"]}
                empty="No customer returns in this period."
                rows={(returns.by_customer || []).map((row: any) => [row.customer, num(row.cases), num(row.qty, 2), num(row.open), `₹${num(row.cost_impact)}`])}
              />
            )}
          </Panel>
          <Panel title="Customer returns by reason">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <Table
                head={["Reason", "Cases", "Qty"]}
                empty="No customer returns in this period."
                rows={(returns.by_reason || []).map((row: any) => [row.reason_code, num(row.cases), num(row.qty, 2)])}
              />
            )}
          </Panel>
        </div>
      </div>
    </RoleGate>
  )
}
