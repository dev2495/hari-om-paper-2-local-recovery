"use client"

/**
 * In-process QC (client 2026-10-27: "allow QC entry above tolerance but flag it everywhere; no hold
 * for now; we should be able to trace all flagged QC easily, stage-wise").
 *
 * Operators log runs and QC on the job card / floor entry page; this page is the register:
 *   Flagged readings      every reading outside its band, stage by stage (never held)
 *   Waiting for readings  runs on running cards whose QC is not done yet, with what is missing
 *   Instruments           the calibrated instrument register
 * `?job=<id>` opens the old-form inspection for a card released before batch entry, or this
 * register filtered to that card for a batch-entry card.
 */

import Link from "next/link"
import { Suspense, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Flag, Gauge, ListChecks, RefreshCw } from "lucide-react"

import { InstrumentRegister } from "@/components/qc/InstrumentRegister"
import { LegacyStageInspection, isBatchEntryCard } from "@/components/qc/LegacyStageInspection"
import { QcFlagsRegister, daysAgo, isoDay } from "@/components/qc/QcFlagsRegister"
import { QcWaitingList } from "@/components/qc/QcWaitingList"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useInProcessQcDue, usePlanningJobCard } from "@/hooks/use-production"
import { productionApi } from "@/lib/api"
import { STAGE_LABEL, logQcHref, type QcDueRow, type QcFlagRow } from "@/lib/qc-flags"

const TABS = [
  { key: "flags", label: "Flagged readings", icon: Flag },
  { key: "waiting", label: "Waiting for readings", icon: ListChecks },
  { key: "instruments", label: "Instruments", icon: Gauge },
] as const
type TabKey = (typeof TABS)[number]["key"]

export default function InProcessQcPage() {
  return (
    <RoleGate allow={["QC", "InProcessQC", "PlantManager"]}>
      <Suspense fallback={<LoadingState label="Opening in-process QC…" />}>
        <InProcessQc />
      </Suspense>
    </RoleGate>
  )
}

function InProcessQc() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const jobId = params.get("job") || ""
  const cardQuery = usePlanningJobCard(jobId || undefined)
  const card: any = cardQuery.data

  // An old-form card keeps its own stage / final QC form; a batch-entry card logs QC on the floor page.
  if (jobId && cardQuery.isLoading) return <LoadingState label="Opening the job card…" />
  if (jobId && card && !isBatchEntryCard(card)) return <LegacyStageInspection backHref={pathname} />

  const requestedTab = params.get("tab")
  const tab: TabKey = TABS.some((item) => item.key === requestedTab) ? (requestedTab as TabKey) : "flags"
  const setParams = (values: Record<string, string>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(values).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false })
  }
  return <Register tab={tab} setParams={setParams} card={jobId && card ? card : null} stage={String(params.get("stage") || "").toUpperCase()} />
}

function Register({ tab, setParams, card, stage }: { tab: TabKey; setParams: (values: Record<string, string>) => void; card: any; stage: string }) {
  const { user, activePlant, activeRole } = useAuth()
  const roles = new Set([activeRole, user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canLog = ["Owner", "Admin", "PlantManager", "QC", "InProcessQC", "Operator", "Production"].some((role) => roles.has(role))
  const canEditInstruments = ["Owner", "Admin", "QC"].some((role) => roles.has(role))
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(isoDay(new Date()))
  const cardId = card?.id ? String(card.id) : ""

  const flags = useQuery({
    queryKey: ["qc-flags", cardId || `${from}:${to}`],
    queryFn: async () => (await productionApi.getQcFlags(cardId ? { job_card_id: cardId } : { date_from: from, date_to: to })).data,
    refetchInterval: 60000,
  })
  const due = useInProcessQcDue(true)
  const flagRows: QcFlagRow[] = Array.isArray(flags.data?.rows) ? flags.data.rows : []
  const allDue: QcDueRow[] = Array.isArray(due.data) ? due.data : []
  const dueRows = cardId ? allDue.filter((row) => String(row.job_card_id) === cardId) : allDue
  const counts: Record<TabKey, string> = {
    flags: flags.isLoading ? "…" : String(flagRows.length),
    waiting: due.isLoading ? "…" : String(dueRows.length),
    instruments: "",
  }
  const plantId = card?.plant_id ? String(card.plant_id) : activePlant && activePlant.toUpperCase() !== "ALL" ? activePlant : undefined
  const cardStage = ["WINDER", "OVEN", "PROCESS"].includes(stage) ? stage : String(card?.current_stage || "WINDER").toUpperCase()
  const logStage = ["WINDER", "OVEN", "PROCESS"].includes(cardStage) ? cardStage : "WINDER"

  return (
    <div className="space-y-4" data-testid="in-process-qc">
      <PageHeader
        badge="Quality"
        title="In-process QC"
        description="Operators log QC on the job card or floor entry page. A reading outside its band is saved and flagged, never held. Trace every flag here stage by stage, and see which runs still need readings."
        actions={<button type="button" className="erp-btn-secondary" onClick={() => { void flags.refetch(); void due.refetch() }}><RefreshCw className="h-4 w-4" />Refresh</button>}
      />
      <QualityDeskNav />

      {card ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-signal-cyan-line bg-signal-cyan-soft px-4 py-3 text-sm text-signal-cyan-ink" data-testid="in-process-qc-card">
          <p><strong>{card.job_card_no || "This card"}</strong> uses batch entry: its QC is logged on the floor entry page, run by run. Below are this card&apos;s flags and runs waiting for readings.</p>
          <div className="flex flex-wrap gap-2">
            {canLog ? <Link href={logQcHref(String(card.id), logStage)} className="erp-btn-primary !h-9">Log QC · {STAGE_LABEL[logStage]}<ArrowRight className="h-4 w-4" /></Link> : null}
            <Link href={`/production/job-cards/${card.id}`} className="erp-btn-secondary !h-9">Open job card</Link>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1.5" role="tablist" aria-label="In-process QC" data-testid="in-process-qc-tabs">
        {TABS.map((item) => {
          const active = tab === item.key
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams({ tab: item.key === "flags" ? "" : item.key })}
              data-testid={`in-process-qc-tab-${item.key}`}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors duration-150 ${active ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-muted hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
              {counts[item.key] ? <span className={`rounded-full px-1.5 text-[11.5px] tabular-nums ${active ? "bg-primary-foreground/20" : counts[item.key] !== "0" ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-muted text-muted-foreground"}`}>{counts[item.key]}</span> : null}
            </button>
          )
        })}
      </div>

      {tab === "flags" ? (
        <QcFlagsRegister
          rows={flagRows}
          isLoading={flags.isLoading}
          isError={flags.isError}
          onRetry={() => void flags.refetch()}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          cardFilter={card ? { id: String(card.id), no: card.job_card_no } : null}
          onClearCard={() => setParams({ job: "", stage: "" })}
        />
      ) : tab === "waiting" ? (
        <QcWaitingList rows={dueRows} isLoading={due.isLoading} isError={due.isError} onRetry={() => void due.refetch()} canLog={canLog} />
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="in-process-qc-instruments">
          <header className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Calibrated instrument register</h2>
            <p className="text-[12.5px] text-muted-foreground">Gauges, balances, C.S. tester and moisture meters with their calibration due dates. An expired instrument cannot back a check that needs one.</p>
          </header>
          <div className="p-4"><InstrumentRegister plantId={plantId} canEdit={canEditInstruments} /></div>
        </section>
      )}
    </div>
  )
}
