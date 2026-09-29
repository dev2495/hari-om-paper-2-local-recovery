"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowUpRight, ClipboardCheck, FlaskConical, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { usePendingInventoryQuality, useInventoryQualityInspections } from "@/hooks/use-inventory"
import { useQualitySummary, useQualityHolds, useQualityInspections } from "@/hooks/use-production"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

const stamp = (s?: string) => s ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`).toLocaleString("en-IN", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "—"
const fmt = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits:2 })
const tone = (s: string) => s === "PASS" ? "text-signal-emerald-ink bg-signal-emerald-soft" : s === "FAIL" ? "text-signal-rose-ink bg-signal-rose-soft" : "text-signal-amber-ink bg-signal-amber-soft"

export default function QualityDeskHubPage() {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  // Incoming desk: QC/Owner/Admin inspect; Store and Plant Manager view and record returns.
  const lotAction = ["QC", "Owner", "Admin"].some((role) => roles.has(role)) ? "Inspect" : ["Store", "PlantManager"].some((role) => roles.has(role)) ? "View" : null
  const summary = useQualitySummary()
  const pending = usePendingInventoryQuality()
  const incoming = useInventoryQualityInspections({ limit:100 })
  const production = useQualityInspections({ limit:100 })
  const holds = useQualityHolds({ limit:100, status:"HOLD" })
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [page, setPage] = useState(0)
  const queries = [summary, pending, incoming, production, holds]
  const refresh = () => queries.forEach(query => { void query.refetch() })
  const lots: any[] = pending.data || []
  const overdue = lots.filter(row => row.overdue)
  const activeHolds: any[] = (holds.data || []).filter((row: any) => row.status === "HOLD")
  const history = useMemo(() => [
    ...(incoming.data || []).map((row:any) => ({...row, desk:"Incoming", label:row.entity_label || `${row.material_type || row.entity_type} · ${String(row.entity_id).slice(0,8)}`, href:"/quality/results"})),
    ...(production.data || []).map((row:any) => ({...row, desk:row.stage_type || "Production", label:row.job_card_no || `Job ${String(row.job_card_id || "").slice(0,8)}`, href:"/quality/results"})),
  ].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))), [incoming.data, production.data])
  const measured = history.filter(row => ["PASS","FAIL"].includes(row.status))
  const pass = measured.filter(row => row.status === "PASS").length
  const analyticsReady = !incoming.isLoading && !production.isLoading && !incoming.isError && !production.isError
  const filtered = lots.filter(row => (filter !== "overdue" || row.overdue) && (filter !== "setup" || !row.quality_profile?.parameters?.length) && `${row.label} ${row.supplier_or_customer || ""} ${row.material_type}`.toLowerCase().includes(search.toLowerCase()))
  return <RoleGate allow={["QC", "PlantManager", "Store", "Dispatch", "Sales"]}>
    <div className="space-y-4" data-testid="quality:page">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">QUALITY</p><h1 className="mt-1 text-2xl font-semibold">Inspection workspace</h1><p className="mt-1 text-sm text-muted-foreground">Clear the incoming queue, review production checks and resolve holds.</p></div><div className="flex gap-2"><button className="erp-btn-secondary" onClick={refresh} disabled={queries.some(q=>q.isFetching)}><RefreshCw className="h-4 w-4" />Refresh</button><Link className="erp-btn-primary" href="/quality/stage"><ClipboardCheck className="h-4 w-4" />Record production QC</Link></div></header>
      <QualityDeskNav />
      <div className="workspace-kpis">
        <div><small>Incoming queue · loaded lots</small><strong>{pending.isError ? "Unavailable" : pending.isLoading ? "…" : lots.length}</strong></div>
        <div><small>Past 24-hour deadline</small><strong className={overdue.length ? "text-signal-rose-ink" : ""}>{pending.isError ? "—" : overdue.length}</strong></div>
        <div><small>Active production holds</small><strong>{summary.isError ? "Unavailable" : summary.isLoading ? "…" : summary.data?.active_holds ?? "—"}</strong></div>
        <div><small>Production pass rate · all inspections</small><strong>{summary.isError ? "Unavailable" : summary.data?.pass_rate == null ? "No data" : `${Number(summary.data.pass_rate).toFixed(1)}%`}</strong><small>{summary.data?.measured_count ?? 0} measured inspections</small></div>
        <div><small>Measured pass rate · recent sample</small><strong>{!analyticsReady ? "Unavailable" : measured.length ? `${(100*pass/measured.length).toFixed(1)}%` : "No measured checks"}</strong><small>{analyticsReady ? `${measured.length} PASS / FAIL inspections` : "Waiting for both quality sources"}</small></div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4"><div className="mr-auto"><h2 className="font-semibold">Incoming material</h2><p className="text-xs text-muted-foreground">Oldest due first · up to 200 lots per material source</p></div>{lotAction ? <Link href="/quality/incoming" className="erp-btn-secondary"><FlaskConical className="h-4 w-4" />Open inspection desk</Link> : null}</div>
          <div className="flex flex-wrap gap-2 border-b border-border p-3"><label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="h-4 w-4 text-muted-foreground" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Find lot, supplier or material…" aria-label="Search incoming queue" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} /></label><select aria-label="Filter incoming queue" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0)}} className="rounded-lg border border-input bg-card px-3 text-sm"><option value="all">All pending</option><option value="overdue">Overdue</option><option value="setup">Needs standards</option></select></div>
          {pending.isLoading ? <LoadingState label="Loading incoming material…" /> : pending.isError ? <ErrorState message="Incoming queue unavailable. This is not an empty queue." onRetry={()=>pending.refetch()} /> : filtered.length ? <div className="overflow-auto"><table className="tube-grid w-full"><thead><tr><th>Lot / material</th><th>Quantity</th><th>Inspection due</th><th>Next action</th></tr></thead><tbody>{filtered.slice(page*25,page*25+25).map(row=><tr key={`${row.entity_type}:${row.entity_id}`}><td><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{row.supplier_or_customer || row.material_type}</p></td><td className="whitespace-nowrap">{fmt(row.qty)} {row.uom || "KG"}</td><td className={row.overdue ? "text-signal-rose-ink" : ""}>{stamp(row.due_at)}{row.overdue ? <p className="text-xs font-semibold">Overdue</p> : null}</td><td>{lotAction ? <Link className="erp-btn-secondary !h-9" href={`/quality/incoming?lot=${row.entity_type}:${row.entity_id}`}>{row.queue_state && row.queue_state !== "AWAITING_INSPECTION" ? "Resolve" : lotAction} <ArrowUpRight className="h-3.5 w-3.5" /></Link> : <span className="text-xs text-muted-foreground">{String(row.queue_state || "AWAITING_INSPECTION").replace(/_/g, " ").toLowerCase()}</span>}</td></tr>)}</tbody></table></div> : <div className="px-6 py-10"><ShieldCheck className="mb-3 h-7 w-7 text-primary" /><h3 className="font-semibold">{lots.length ? "No matching lots" : "Incoming queue is clear"}</h3><p className="mt-1 max-w-lg text-sm text-muted-foreground">{lots.length ? "Try another supplier or remove the filter." : "New goods receipts appear here automatically with a 24-hour deadline. Prepare the material standards before the next inward."}</p><Link className="mt-3 inline-flex text-sm font-medium text-primary" href="/quality/material-standards">Review material standards →</Link></div>}
          {filtered.length > 25 ? <div className="flex justify-end gap-3 border-t border-border p-3 text-sm"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>{page*25+1}–{Math.min(page*25+25,filtered.length)} of {filtered.length}</span><button disabled={page*25+25>=filtered.length} onClick={()=>setPage(page+1)}>Next</button></div> : null}
        </section>
        <aside className="space-y-3">
          {[{href:"/quality/material-standards",title:"Material standards",detail:"Incoming RM/PM checks: set tolerances, approve revisions and review change history."},{href:"/specifications",title:"Process standards",detail:"Winding, oven, process and final tolerances on each spec: set, approve and attach to released job cards."},{href:"/quality/results",title:"Results & holds",detail:"Resolve production holds, review dispositions and record customer returns."},{href:"/reports/quality",title:"Quality analytics",detail:"Explore quality trends, failures and variance across production."}].map(item=><Link key={item.href} href={item.href} className="block rounded-xl border border-border bg-card p-4 hover:border-primary/40"><div className="flex justify-between text-sm font-semibold">{item.title}<ArrowUpRight className="h-4 w-4 text-primary" /></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></Link>)}
          <div className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Recent measured outcomes</h2><p className="mt-1 text-xs text-muted-foreground">Latest 100 incoming + 100 production inspections. Incomplete and held results are excluded from the pass rate.</p>{analyticsReady && measured.length ? <><div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted"><span className="bg-signal-emerald-ink" style={{width:`${100*pass/measured.length}%`}} /><span className="flex-1 bg-signal-rose-ink" /></div><p className="mt-2 text-xs">{pass} pass · {measured.length-pass} fail</p></> : <p className="mt-3 text-sm text-muted-foreground">{analyticsReady ? "No measured results yet" : "Results unavailable"}</p>}</div>
        </aside>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">Latest inspections</h2><Link href="/quality/results" className="text-sm font-medium text-primary">All results →</Link></div>{!analyticsReady ? <p className="p-4 text-sm text-muted-foreground">Loading or unavailable inspection sources. Refresh to try again.</p> : !history.length ? <p className="p-5 text-sm text-muted-foreground">Recorded inspections will appear here with their result and time.</p> : <div className="overflow-auto"><table className="tube-grid w-full"><thead><tr><th>Time</th><th>Material / job</th><th>Desk</th><th>Result</th><th>Inspector</th></tr></thead><tbody>{history.slice(0,12).map((row:any)=><tr key={`${row.desk}:${row.id}`}><td>{stamp(row.created_at)}</td><td><Link className="font-medium text-primary" href={row.href}>{row.label}</Link></td><td>{row.desk}</td><td><span className={cn("rounded-md px-2 py-1 text-xs font-semibold",tone(row.status))}>{row.status}</span></td><td>{row.inspected_by || row.created_by || "Recorded"}</td></tr>)}</tbody></table></div>}</section>
    </div>
  </RoleGate>
}
