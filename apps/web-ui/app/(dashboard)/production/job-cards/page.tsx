"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import dayjs from "dayjs"
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, Factory, GitBranch, PackageCheck, Printer, Search, ShieldCheck, ShoppingCart, TimerReset, Truck } from "lucide-react"
import { HoverCard } from "@/components/common/hover-card"
import { RowMenu } from "@/components/common/row-menu"
import { useDeferredValue, useMemo, useState } from "react"

import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { QuerySwitch } from "@/components/workspace/query-state"
import { useMachines, useJobCardAggregates, usePlanningJobCards } from "@/hooks/use-production"
import { productionApi } from "@/lib/api"
import { dueRiskLabel, overdueLabel } from "@/lib/due-risk"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { compactRef, jobCardRef } from "@/lib/job-card-display"

const STAGE_TILES = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]

/** Turn the planner gate's reason into plain language and the next action. */
function gateInfo(job: any): { blocked: boolean; short: string; reason: string; fix: string; cta: string; href?: string } {
  const reason = String(job.blocked_reason || job.planner_gate_reason || "").trim()
  const blocked = job.planner_gate_ready === false || Boolean(job.blocked_reason)
  if (!blocked) return { blocked: false, short: "", reason: "", fix: "", cta: "" }
  const text = reason.toLowerCase()
  if (text.includes("stale")) {
    return { blocked, short: "Planned slot has passed", reason: reason || "The planned slot is in the past.", fix: "Move this stage to a machine slot within the next 3 plant days. The floor can't record output against an expired plan.", cta: "Reschedule in planner" }
  }
  if (text.includes("open segment")) {
    return { blocked, short: reason.replace(" still need stage completion", " to finish"), reason, fix: "This stage was split. Record output for each open segment (or cancel unused ones in the planner) before the card moves on.", cta: "Record stage output", href: `/production/supervisor-entry?job_card_id=${job.id}` }
  }
  if (text.includes("hold") || text.includes("qc")) {
    return { blocked, short: "Quality hold", reason, fix: "QC must release or disposition the hold before work continues.", cta: "Open quality desk", href: "/quality/results" }
  }
  if (text.includes("material") || text.includes("reel") || text.includes("issue")) {
    return { blocked, short: "Material not issued", reason, fix: "Issue the required reels or paper to this card from stores.", cta: "Issue material", href: "/inventory/production-issue" }
  }
  if (text.includes("machine") || text.includes("assign") || text.includes("slot") || !reason) {
    return { blocked, short: reason ? "Needs a machine slot" : "Not scheduled", reason: reason || "No machine, date and shift are assigned for the current stage.", fix: "Assign a machine, date and shift for the current stage in the planner.", cta: "Schedule in planner" }
  }
  return { blocked, short: reason.length > 34 ? `${reason.slice(0, 34)}…` : reason, reason, fix: "Open the planner or the job card to resolve this gate.", cta: "Open planner" }
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function dueBucketLabel(bucket?: string | null) {
  if (bucket === "PRIORITY") return "Priority (3 plant days)"
  if (bucket === "OVERDUE") return "Overdue"
  return null
}

export default function JobCardsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const stageFilter = String(searchParams?.get("stage") || "").trim().toUpperCase()
  const dueFilter = String(searchParams?.get("due") || "").trim().toLowerCase()
  const dueRiskParam = dueFilter === "priority" ? "PRIORITY" : dueFilter === "overdue" ? "OVERDUE" : undefined
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const [gateFilter, setGateFilter] = useState<"all" | "blocked" | "ready">("all")
  const deferredSearch = useDeferredValue(search.trim())
  const machinesQuery = useMachines()
  const aggregatesQuery = useJobCardAggregates()

  const jobCardsQuery = usePlanningJobCards(
    {
      limit: 250,
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status !== "ALL" ? { status } : {}),
      ...(stageFilter ? { stage: stageFilter } : {}),
      ...(dueRiskParam ? { due_risk: dueRiskParam } : {}),
    },
    true,
  )

  const jobCards = useMemo(() => (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []), [jobCardsQuery.data])
  const aggregates = useMemo(() => (aggregatesQuery.data as Record<string, any>) || {}, [aggregatesQuery.data])
  const machineLabelMap = useMemo(
    () =>
      new Map(
        (Array.isArray(machinesQuery.data) ? machinesQuery.data : []).map((machine: any) => [
          String(machine.id),
          machine.code || machine.name || String(machine.id).slice(0, 8),
        ]),
      ),
    [machinesQuery.data],
  )

  const stageCounts = useMemo(() => {
    const fromServer = Array.isArray(aggregates.stage_counts) ? aggregates.stage_counts : []
    const byStage = new Map(fromServer.map((row: any) => [String(row.stage).toUpperCase(), Number(row.count || 0)]))
    return STAGE_TILES.map((stage) => ({ stage, count: Number(byStage.get(stage) || 0) }))
  }, [aggregates])

  const replaceQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams?.toString() || "")
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    const query = next.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const visibleCards = jobCards.length
  const blockedCount = jobCards.filter((job: any) => gateInfo(job).blocked).length
  const visibleJobCards = jobCards.filter((job: any) => gateFilter === "all" || (gateFilter === "blocked") === gateInfo(job).blocked)
  const priorityCount = Number(aggregates.due_priority || 0)
  const overdueCount = Number(aggregates.due_overdue || 0)
  const priorityDetail = aggregates.priority_label || dueRiskLabel()
  const overdueDetail = aggregates.overdue_label || overdueLabel()

  const exportCards = async () => {
    const response = await productionApi.exportJobCards({
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status !== "ALL" ? { status } : {}),
      ...(stageFilter ? { stage: stageFilter } : {}),
      ...(dueRiskParam ? { due_risk: dueRiskParam } : {}),
    })
    const blob = new Blob([response.data], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "job-cards.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.jobCards}
        badge="Job Card Truth"
        title="Job cards"
        description="Stage and due-risk tiles are server totals for the authorized plant, not a page-sized sample. Click a stage to open that exact set."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Open Cards</p>
              <p className="mt-2 text-3xl font-semibold" data-testid="job-cards:open-count">{Number(aggregates.open_cards ?? visibleCards)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Server aggregate across all job cards in plant scope</p>
            </div>
            <Link href="/planning/board?section=winder" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-card px-4 py-3 text-sm font-semibold text-foreground">
              <Factory className="h-4 w-4" />
              Open planning board
            </Link>
            <Link href="/production/job-cards/time-reconciliation" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 px-4 py-3 text-sm font-semibold text-white">
              <TimerReset className="h-4 w-4" />
              Card time reconciliation
            </Link>
          </div>
        }
      />

      <MetricRail className="2xl:grid-cols-5">
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: null, stage: null })}>
          <MetricCard label="Open Cards" value={Number(aggregates.open_cards ?? 0)} detail="Still active across production stages" icon={ClipboardCheck} tone="cyan" />
        </button>
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: dueFilter === "priority" ? null : "priority", stage: null })}>
          <MetricCard label="Priority (3 plant days)" value={priorityCount} detail={priorityDetail} icon={TimerReset} tone="amber" />
        </button>
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: dueFilter === "overdue" ? null : "overdue", stage: null })}>
          <MetricCard label="Overdue" value={overdueCount} detail={overdueDetail} icon={TimerReset} tone="rose" />
        </button>
        <MetricCard label="QC Holds" value={Number(aggregates.qc_holds ?? 0)} detail="Active holds attached to open job cards" icon={ShieldCheck} tone={aggregates.qc_holds ? "rose" : "emerald"} />
        <MetricCard label="Dispatch Ready" value={Number(aggregates.dispatch_ready ?? 0)} detail="Already at dispatch stage" icon={Truck} tone="emerald" />
      </MetricRail>

      <Panel
        title="WIP and QC Movement Snapshot"
        subtitle="Open production is grouped by current stage. Tile counts are a full-scope server aggregate; the list below uses the same stage filter."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/production-issue" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-signal-cyan-line hover:text-signal-cyan-ink">
              <PackageCheck className="h-3.5 w-3.5" />
              Issue to WIP
            </Link>
            <Link href="/quality" className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground hover:bg-primary/90">
              Quality desk <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {stageCounts.map((row) => {
            const active = stageFilter === row.stage
            const href = active ? "/production/job-cards" : `/production/job-cards?stage=${row.stage}`
            return (
              <Link
                key={row.stage}
                href={href}
                data-testid={`job-cards:stage-tile:${row.stage}`}
                className={`rounded-[1.15rem] border px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 ${
                  active ? "border-signal-cyan-line bg-signal-cyan-soft" : "border-border bg-muted"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{row.stage.replace(/_/g, " ")}</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{row.count}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.stage === "QC" ? "Final gate cards" : row.stage === "DISPATCH" ? "Ready for dispatch check" : "Open cards in this stage"}
                </p>
              </Link>
            )
          })}
        </div>
        {Number(aggregates.blocked || 0) ? (
          <div className="mt-4 rounded-[1.15rem] border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-sm text-signal-rose-ink">
            {aggregates.blocked} open card(s) have an active quality hold or final QC stage. Use the quality desk before dispatch.
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Job Card Queue"
        subtitle="Search across job card id, order id, product code, or customer snapshot. Stage and due-risk filters are URL-driven."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {stageFilter ? (
              <button type="button" onClick={() => replaceQuery({ stage: null })} className="rounded-full border border-signal-cyan-line bg-signal-cyan-soft px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal-cyan-ink">
                Stage {stageFilter} ×
              </button>
            ) : null}
            {dueRiskParam ? (
              <button type="button" onClick={() => replaceQuery({ due: null })} className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal-amber-ink">
                {dueRiskParam === "PRIORITY" ? "Priority 3-day" : "Overdue"} ×
              </button>
            ) : null}
            <div className="tube-segment" role="group" aria-label="Floor gate filter">
              {([["all", `All ${visibleCards}`], ["blocked", `Blocked ${blockedCount}`], ["ready", `Ready ${visibleCards - blockedCount}`]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={gateFilter === value} onClick={() => setGateFilter(value)}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={() => exportCards().catch(() => undefined)} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Export CSV
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                aria-label="Search job cards"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search job cards..."
                className="w-64 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="CREATED">Created</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        }
      >
        {jobCardsQuery.isLoading || jobCardsQuery.isError || jobCards.length === 0 ? (
          <QuerySwitch
            isLoading={jobCardsQuery.isLoading}
            isError={jobCardsQuery.isError}
            isEmpty={jobCards.length === 0}
            loadingLabel="Loading recovered job cards..."
            emptyTitle="No job cards matched this filter."
            emptyMessage="Clear the stage or due-risk filter, or wait for a sales release."
            errorMessage="Job cards could not be loaded. Counts on this page must not be treated as zero."
            onRetry={() => {
              void jobCardsQuery.refetch()
            }}
          >
            {null}
          </QuerySwitch>
        ) : (
          <div className="max-h-[calc(100dvh-220px)] overflow-auto rounded-xl border border-border">
            <table className="tube-grid" data-testid="job-cards:table">
              <thead>
                <tr>
                  <th>Job card</th>
                  <th className="hidden md:table-cell">Customer · order</th>
                  <th className="num">Qty</th>
                  <th>Stage</th>
                  <th className="hidden lg:table-cell">Plan</th>
                  <th>Due</th>
                  <th>Floor gate</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleJobCards.map((job: any) => {
                  const gate = gateInfo(job)
                  const stage = String(job.current_stage || "").toLowerCase()
                  const planHref = ["winder", "oven", "process", "slitting"].includes(stage) ? `/planning/${stage}?order_id=${job.sales_order_id}` : `/planning/board?order_id=${job.sales_order_id}`
                  const dueDays = job.due_date ? dayjs(job.due_date).startOf("day").diff(dayjs().startOf("day"), "day") : null
                  return (
                    <tr key={job.id} data-due-risk={job.due_risk_bucket || ""} data-state={gate.blocked ? undefined : undefined}>
                      <td className="max-w-[220px]">
                        <Link href={`/production/job-cards/${job.id}`} className="font-semibold text-foreground hover:text-primary">{jobCardRef(job)}</Link>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{job.product_size_label || job.product_code || "—"}{job.parchment_color ? ` · ${job.parchment_color}` : ""}</span>
                      </td>
                      <td className="hidden max-w-[240px] md:table-cell">
                        <span className="block truncate text-foreground/90">{job.customer_name || "—"}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">SO {job.sales_order_ref || compactRef(job.sales_order_id, "SO")} · {job.release_lot_id ? compactRef(job.release_lot_id, "LOT") : "no lot"}</span>
                      </td>
                      <td className="num">
                        <span className="font-semibold">{Number(job.planned_qty || 0).toLocaleString("en-IN")}</span>
                        {job.planned_weight_kg ? <span className="block text-[11px] text-muted-foreground">{Number(job.planned_weight_kg).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg</span> : null}
                      </td>
                      <td><div className="flex flex-col items-start gap-1"><StatusBadge value={job.current_stage} /><span className="text-[11px] text-muted-foreground">{String(job.status || "").replaceAll("_", " ").toLowerCase()}</span></div></td>
                      <td className="hidden whitespace-nowrap lg:table-cell">
                        <span className="block text-foreground/90">{job.current_machine_id ? machineLabelMap.get(String(job.current_machine_id)) || compactRef(job.current_machine_id, "MC") : <span className="text-muted-foreground">Unassigned</span>}</span>
                        <span className="block text-[11.5px] text-muted-foreground">{job.current_plan_date ? formatDate(job.current_plan_date) : "No date"}{job.current_shift_code ? ` · ${String(job.current_shift_code).replace("SHIFT_", "Shift ")}` : ""}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="block tabular-nums text-foreground/90">{formatDate(job.due_date)}</span>
                        {dueDays !== null ? <span className={`text-[11.5px] font-medium ${dueDays < 0 ? "text-signal-rose-ink" : dueDays <= 3 ? "text-signal-amber-ink" : "text-muted-foreground"}`}>{dueDays < 0 ? `${Math.abs(dueDays)}d late` : dueDays === 0 ? "Due today" : `in ${dueDays}d`}</span> : null}
                      </td>
                      <td className="max-w-[240px]">
                        {gate.blocked ? (
                          <HoverCard
                            label={`Why ${jobCardRef(job)} is blocked`}
                            trigger={
                              <button type="button" className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-signal-rose-line bg-signal-rose-soft px-2 py-0.5 text-left text-[11.5px] font-medium text-signal-rose-ink">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span className="truncate">{gate.short}</span>
                              </button>
                            }
                          >
                            <p className="font-semibold text-foreground">Why it&apos;s blocked</p>
                            <p className="mt-1 text-muted-foreground">{gate.reason}</p>
                            <p className="mt-2 font-semibold text-foreground">How to clear it</p>
                            <p className="mt-0.5 text-muted-foreground">{gate.fix}</p>
                            <Link href={gate.href || planHref} className="erp-btn-primary mt-3 !h-8 w-full">{gate.cta}<ArrowRight className="h-3.5 w-3.5" /></Link>
                          </HoverCard>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-emerald-line bg-signal-emerald-soft px-2 py-0.5 text-[11.5px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3 w-3" />Ready for floor</span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end">
                          <RowMenu
                            items={[
                              { label: "Open job card", href: `/production/job-cards/${job.id}`, icon: ClipboardCheck },
                              { label: "Plan / reschedule", href: planHref, icon: CalendarClock },
                              { label: "Stage entry", href: `/production/supervisor-entry?job_card_id=${job.id}`, icon: Factory },
                              { label: "Print card (A4)", href: `/production/job-cards/${job.id}/print`, icon: Printer },
                              { label: "Material genealogy", href: `/inventory/genealogy?job_card_id=${job.id}`, icon: GitBranch },
                              { label: "Sales order", href: `/sales-orders/${job.sales_order_id}`, icon: ShoppingCart },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Showing the loaded job-card window (up to 250). Stage tiles use the server aggregate, not this page size.</p>
      </Panel>
    </div>
  )
}
