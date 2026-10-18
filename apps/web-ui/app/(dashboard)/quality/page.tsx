"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, ClipboardCheck, Factory, FlaskConical, LockKeyhole, RefreshCw, Ruler, ShieldCheck, Undo2 } from "lucide-react"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useCustomerRejections, useInventoryQualityInspections, usePendingInventoryQuality } from "@/hooks/use-inventory"
import { useInProcessQcDue, useQualityHolds, useQualityInspections, useQualitySummary } from "@/hooks/use-production"
import { seasonApi, seasonLabel } from "@/lib/season-api"
import { cn } from "@/lib/utils"

const stamp = (value?: string) => value ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
const asArray = (value: any) => (Array.isArray(value) ? value : [])

export default function QualityDeskPage() {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const incomingOnly = roles.has("InwardQC") && !["QC", "Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  const canInspect = ["QC", "InwardQC", "Owner", "Admin"].some((role) => roles.has(role))
  const sees = (allowed: string[]) => ["Owner", "Admin", ...allowed].some((role) => roles.has(role))
  const pending = usePendingInventoryQuality()
  const due = useInProcessQcDue(!incomingOnly && sees(["QC", "PlantManager"]))
  const holds = useQualityHolds({ limit: 150, status: "HOLD" })
  const summary = useQualitySummary(!incomingOnly)
  const returns = useCustomerRejections({ limit: 200 })
  const incoming = useInventoryQualityInspections({ limit: 100 })
  const production = useQualityInspections({ limit: 100 })
  const roy = useQuery({ queryKey: ["season-rules", "ROY"], queryFn: async () => (await seasonApi.rules("ROY")).data, enabled: !incomingOnly })
  const monsoon = useQuery({ queryKey: ["season-rules", "MONSOON"], queryFn: async () => (await seasonApi.rules("MONSOON")).data, enabled: !incomingOnly })

  const lots = asArray(pending.data)
  const awaiting = lots.filter((row: any) => !row.queue_state || row.queue_state === "AWAITING_INSPECTION")
  const overdue = awaiting.filter((row: any) => row.overdue)
  const heldLots = lots.filter((row: any) => ["FAILED", "REJECTED"].includes(String(row.queue_state || "")))
  const jobHolds = asArray(holds.data).filter((row: any) => String(row.status || "").toUpperCase() === "HOLD")
  const dueRows = asArray(due.data)
  const openReturns = asArray(returns.data).filter((row: any) => !row.closed_at && String(row.closure_status || "").toUpperCase() !== "CLOSED")
  const returnsToDecide = openReturns.filter((row: any) => !row.disposition || ["HOLD", "BLOCK"].includes(String(row.disposition).toUpperCase()))
  const recent = useMemo(() => [
    ...asArray(incoming.data).map((row: any) => ({ ...row, where: "Incoming", title: row.entity_label || "Material lot" })),
    ...asArray(production.data).map((row: any) => ({ ...row, where: ({ WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC" } as Record<string, string>)[row.stage_type] || "In-process", title: row.job_card_no || "Job card" })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [incoming.data, production.data])
  // Pass rate comes from the server aggregate over all production inspections, never from a loaded page.
  const passRate = summary.data?.pass_rate == null ? null : Number(summary.data.pass_rate)
  const refresh = () => [pending, due, holds, returns, incoming, production, summary].forEach((query) => void query.refetch())

  const tiles = [
    { href: "/quality/incoming", label: "Incoming lots to inspect", value: pending.isLoading ? "…" : awaiting.length, detail: overdue.length ? `${overdue.length} past the 24-hour deadline` : "Oldest first · 24-hour deadline", icon: FlaskConical, urgent: overdue.length > 0, show: true },
    { href: "/quality/stage", label: "Batches waiting for stage QC", value: due.isLoading ? "…" : dueRows.length, detail: "The next stage cannot take them until QC accepts", icon: Factory, urgent: dueRows.length > 0, show: !incomingOnly && sees(["QC", "PlantManager"]) },
    { href: "/quality/results", label: "On hold — decision needed", value: pending.isLoading || holds.isLoading ? "…" : heldLots.length + (incomingOnly ? 0 : jobHolds.length), detail: `${heldLots.length} inward lot${heldLots.length === 1 ? "" : "s"}${incomingOnly ? "" : ` · ${jobHolds.length} job card${jobHolds.length === 1 ? "" : "s"}`}`, icon: LockKeyhole, urgent: heldLots.length + jobHolds.length > 0, show: true },
    { href: "/quality/returns", label: "Customer returns open", value: returns.isLoading ? "…" : openReturns.length, detail: `${returnsToDecide.length} waiting for a QC decision`, icon: Undo2, urgent: returnsToDecide.length > 0, show: !incomingOnly && sees(["QC", "PlantManager", "Store", "Sales", "Dispatch"]) },
  ].filter((tile) => tile.show)

  return (
    <RoleGate allow={["QC", "InwardQC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-5" data-testid="quality:page">
        <PageHeader
          title="QC desk"
          description="What needs quality control right now. Work the queues left to right; everything held stays held until QC decides."
          actions={<button type="button" className="erp-btn-secondary" onClick={refresh}><RefreshCw className="h-4 w-4" />Refresh</button>}
        />
        <QualityDeskNav />

        <section aria-label="Needs action" className={cn("grid gap-3 sm:grid-cols-2", tiles.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href} className={cn("group flex min-h-[132px] flex-col justify-between rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tile.urgent ? "border-signal-amber-line" : "border-border")} data-testid={`qc-tile-${tile.href.split("/").pop()}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-semibold text-foreground/80">{tile.label}</p>
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tile.urgent ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-emerald-soft text-signal-emerald-ink")}><tile.icon className="h-4 w-4" aria-hidden="true" /></span>
              </div>
              <div>
                <p className="text-[32px] font-semibold leading-none tabular-nums tracking-tight">{tile.value}</p>
                <p className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">{tile.detail}<ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></p>
              </div>
            </Link>
          ))}
        </section>

        <div className={cn("grid items-start gap-4", !incomingOnly && sees(["QC", "PlantManager"]) ? "xl:grid-cols-2" : "")}>
          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="qc-incoming-queue">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">Incoming lots</h2><p className="text-[12.5px] text-muted-foreground">Inspect against the bands set in Masters · oldest due first</p></div>
              <Link href="/quality/incoming" className="text-[13px] font-semibold text-primary hover:underline">Open desk</Link>
            </header>
            {pending.isLoading ? <LoadingState label="Loading incoming lots…" /> : pending.isError ? <ErrorState message="Incoming queue unavailable. This is not an empty queue." onRetry={() => pending.refetch()} /> : awaiting.length ? (
              <ul className="divide-y divide-border">
                {awaiting.slice(0, 8).map((row: any) => (
                  <li key={`${row.entity_type}:${row.entity_id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{row.label}</p>
                      <p className="truncate text-[12px] text-muted-foreground">{[row.supplier_or_customer, row.grn_no, `${fmt(row.qty)} ${row.uom || "KG"}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", row.overdue ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-muted text-muted-foreground ring-border")}>{row.overdue ? "Overdue" : `Due ${stamp(row.due_at)}`}</span>
                    {canInspect ? <Link className="erp-btn-primary !h-9 shrink-0" href={`/quality/incoming?lot=${row.entity_type}:${row.entity_id}`}>Inspect</Link> : null}
                  </li>
                ))}
                {awaiting.length > 8 ? <li className="px-4 py-2.5 text-[12.5px] text-muted-foreground">+ {awaiting.length - 8} more on the incoming desk</li> : null}
              </ul>
            ) : <div className="px-6 py-8 text-center"><ShieldCheck className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" /><p className="font-semibold">Incoming queue is clear</p><p className="mt-1 text-[12.5px] text-muted-foreground">New GRN lots appear here automatically.</p></div>}
          </section>

          {!incomingOnly && sees(["QC", "PlantManager"]) ? (
            <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="qc-stage-queue">
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div><h2 className="font-semibold">Stage QC due</h2><p className="text-[12.5px] text-muted-foreground">Batches the next stage is waiting on · minimum 2 readings per check</p></div>
                <Link href="/quality/stage" className="text-[13px] font-semibold text-primary hover:underline">In-process QC</Link>
              </header>
              {due.isLoading ? <LoadingState label="Loading stage QC queue…" /> : due.isError ? <ErrorState message="Stage QC queue unavailable." onRetry={() => due.refetch()} /> : dueRows.length ? (
                <ul className="divide-y divide-border">
                  {dueRows.slice(0, 8).map((row: any) => (
                    <li key={row.entry_id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{row.job_card_no} · {row.stage_label} batch #{row.entry_no}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{[row.customer, `${fmt(row.accepted)} ${row.unit || ""}`, row.shift_code && `Shift ${String(row.shift_code).replace("SHIFT_", "")}`].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", row.state === "FAILED" ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line")}>
                        {row.state === "FAILED" ? "Failed — on hold" : row.state === "NO_READINGS" ? "No readings yet" : row.state === "MORE_READINGS" ? `More readings: ${asArray(row.readings_short).slice(0, 2).map((s: any) => s.label).join(", ")}` : "Readings incomplete"}
                      </span>
                      {canInspect || roles.has("PlantManager") ? <Link className="erp-btn-primary !h-9 shrink-0" href={`/production/job-cards/${row.job_card_id}?stage=${row.stage}`}>Add QC</Link> : null}
                    </li>
                  ))}
                  {dueRows.length > 8 ? <li className="px-4 py-2.5 text-[12.5px] text-muted-foreground">+ {dueRows.length - 8} more batches</li> : null}
                </ul>
              ) : <div className="px-6 py-8 text-center"><ClipboardCheck className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" /><p className="font-semibold">Every batch on the floor is QC-accepted</p><p className="mt-1 text-[12.5px] text-muted-foreground">New batches appear here as soon as the floor saves them.</p></div>}
            </section>
          ) : null}
        </div>

        <section className="grid gap-3 lg:grid-cols-3" aria-label="Standards and results">
          <Link href="/quality/material-standards" className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
            <p className="flex items-center gap-2 text-sm font-semibold"><Ruler className="h-4 w-4 text-primary" aria-hidden="true" />Material standards</p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">The checks done on every incoming material. Bands per line or group are set in Masters.</p>
          </Link>
          {!incomingOnly ? (
            <Link href="/quality/stage-rules" className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
              <p className="flex items-center gap-2 text-sm font-semibold"><Factory className="h-4 w-4 text-primary" aria-hidden="true" />Process stage rules</p>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                {seasonLabel("ROY")} v{roy.data?.published?.version ?? "—"} · {seasonLabel("MONSOON")} v{monsoon.data?.published?.version ?? "—"}. New job cards take the current version when released.
              </p>
            </Link>
          ) : null}
          <Link href="/quality/results" className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
            <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />Recent results</p>
            {passRate != null ? (
              <>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-signal-rose-soft" aria-hidden="true"><span className="bg-signal-emerald-ink" style={{ width: `${passRate}%` }} /></div>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">{passRate.toFixed(1)}% production pass rate · {summary.data?.measured_count ?? 0} measured · last result {stamp(recent[0]?.created_at)}</p>
              </>
            ) : <p className="mt-1 text-[12.5px] text-muted-foreground">{summary.isError ? "Pass rate unavailable" : "No data"} — no measured production inspections yet.</p>}
          </Link>
        </section>
      </div>
    </RoleGate>
  )
}
