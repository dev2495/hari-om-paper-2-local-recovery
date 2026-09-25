"use client"

import { CommandCenter } from "@/components/workspace/command-center"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useMemo } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  Factory,
  Gauge,
  Layers3,
  ShieldCheck,
  Truck,
  Users,
  Workflow,
  Wrench,
} from "lucide-react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"

import { AreaTrend, ChartCard, CompactTable, FilterChip, InsightStrip, KpiCard, MiniBarList, PageIntro, formatCompactCurrency, formatCompactNumber, formatPercent } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack } from "@/hooks/use-analytics"
import { useInventoryHealthSummary } from "@/hooks/use-inventory"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlanningBoard } from "@/hooks/use-production"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { useAuditEvents, useSystemHealth } from "@/hooks/use-workspace"
import { jobCardRef } from "@/lib/job-card-display"
import { displayPlantScope } from "@/lib/plant-scope"

function buildSparkline(values: number[]) {
  return values.map((value, index) => ({ label: `P${index + 1}`, value: Number(value || 0) }))
}

function safeSeries(raw: any[]) {
  return (Array.isArray(raw) ? raw : []).map((row: any, index: number) => ({
    label: row.bucket || row.date || row.label || `P${index + 1}`,
    winder: Number(row.winder_qty || 0),
    oven: Number(row.oven_qty || 0),
    process: Number(row.process_qty || 0),
    dispatch: Number(row.dispatch_qty || 0),
    otif: Number(row.otif_percent || row.otif || 0),
  }))
}

export function OwnerLandingPage() {
  return <CommandCenter role="Owner" testId="landing-owner-page" />
}

export function AdminLandingPage() {
  const { activePlant } = useAuth()
  const { data: systemHealth, isLoading: healthLoading, error: healthError } = useSystemHealth(true)
  const { data: auditEvents } = useAuditEvents({ since_hours: 72, limit: 8 })

  const services = Array.isArray(systemHealth?.services) ? systemHealth.services : []
  const summary = systemHealth?.summary || {}
  const runtime = systemHealth?.runtime || {}
  const schedulerJobs = Object.entries(systemHealth?.scheduler?.jobs || {}).map(([name, value]: [string, any]) => ({
    label: name.replaceAll("_", " "),
    value: ["OK", "SCHEDULED", "QUEUED", "DUPLICATE"].includes(String(value?.status || "").toUpperCase()) ? 100 : 0,
    hint: value?.last_error || systemHealth?.scheduler?.next_runs?.[name] || value?.status || "No run recorded",
  }))
  const auditRows = (Array.isArray(auditEvents?.items) ? auditEvents.items : []).slice(0, 8).map((row: any, index: number) => ({
    id: row.id || index,
    ts: row.occurred_at || "-",
    actor: row.actor_email || row.actor_role || row.source_service || "system",
    action: row.summary || row.event_type,
  }))
  const systemStatus = healthError ? "Unavailable" : healthLoading ? "Checking" : String(systemHealth?.status || "Unknown")
  const systemHealthy = systemStatus === "HEALTHY"
  const infrastructureRows = [
    runtime?.memory?.used_percent != null ? { label: "Memory used %", value: Number(runtime.memory.used_percent), hint: "Measured from the runtime cgroup" } : null,
    runtime?.storage?.used_percent != null ? { label: "Storage used %", value: Number(runtime.storage.used_percent), hint: "Measured from the application filesystem" } : null,
    runtime?.load_1m != null ? { label: "Load average 1m", value: Number(runtime.load_1m), hint: "Current process-host load" } : null,
  ].filter(Boolean) as Array<{ label: string; value: number; hint: string }>
  const integrityRows = [
    ...services.map((service: any) => ({
      check: `${service.name} health endpoint`,
      status: service.status,
      detail: service.status === "UP" ? `HTTP ${service.http_status} in ${service.latency_ms} ms` : service.detail || "Probe failed",
    })),
    {
      check: "Analytics scheduler",
      status: systemHealth?.scheduler?.enabled ? "UP" : "DOWN",
      detail: systemHealth?.scheduler ? `${Object.keys(systemHealth.scheduler.jobs || {}).length} jobs registered; queue ${systemHealth.scheduler.queue?.available === false ? "unavailable" : "available"}` : "Scheduler status unavailable",
    },
  ]

  return (
    <div className="space-y-5" data-testid="landing-admin-page">
      <PageIntro
        eyebrow="Admin Landing"
        title="System health"
        description="This is the admin control surface: service posture, data integrity, jobs, sessions, and the audit trail that proves what changed."
        actions={
          <>
            <FilterChip active>Last 1h</FilterChip>
            <FilterChip>{displayPlantScope(activePlant, "All plants")}</FilterChip>
          </>
        }
        aside={
          <div className="space-y-3">
            <p className="text-[12px] font-semibold text-muted-foreground">Status banner</p>
            <p className="text-2xl font-semibold tracking-tight">
              System {systemStatus.toLowerCase()}, {formatCompactNumber(Number(summary.services_up || 0))} of {formatCompactNumber(Number(summary.services_total || 0))} service probes passing.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Last measured {systemHealth?.checked_at ? new Date(systemHealth.checked_at).toLocaleString("en-IN") : "not yet"}; maximum current probe latency {formatCompactNumber(Number(summary.max_probe_latency_ms || 0))} ms.
            </p>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="System Status" value={systemStatus} detail={systemHealthy ? "All measured service probes pass" : "One or more measured checks need attention"} icon={ShieldCheck} tone={systemHealthy ? "emerald" : "rose"} />
        <KpiCard label="Max Probe Latency" value={`${formatCompactNumber(Number(summary.max_probe_latency_ms || 0))} ms`} detail="Slowest current service health probe" icon={Gauge} tone="cyan" />
        <KpiCard label="Failed Probes" value={formatCompactNumber(Number(summary.failed_probes || 0))} detail="Current dependency health failures" icon={AlertTriangle} tone={Number(summary.failed_probes || 0) ? "rose" : "emerald"} />
        <KpiCard label="Active Accounts" value={summary.active_accounts == null ? "Unknown" : formatCompactNumber(Number(summary.active_accounts))} detail="Enabled user accounts; live sessions are not inferred" icon={Users} tone="violet" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ChartCard eyebrow="Services" title="Service posture and runtime risk" description="Live summary of the core application surfaces.">
          <CompactTable
            columns={[
              { key: "name", label: "Service" },
              { key: "status", label: "Status" },
              { key: "latency_ms", label: "Probe ms" },
              { key: "http_status", label: "HTTP" },
            ]}
            rows={services}
          />
        </ChartCard>
        <ChartCard eyebrow="Infrastructure" title="Host and workload health" description="Foundational platform checks and integrity signals.">
          {infrastructureRows.length ? <MiniBarList rows={infrastructureRows} formatter={(value) => formatCompactNumber(value)} /> : <p className="text-sm text-muted-foreground">Runtime metrics are unavailable.</p>}
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ChartCard eyebrow="Dependency Integrity" title="Measured platform checks" description="Current health endpoints and scheduler state; no unmeasured database claims are shown.">
          <CompactTable
            columns={[
              { key: "check", label: "Check" },
              { key: "status", label: "Status" },
              { key: "detail", label: "Detail" },
            ]}
            rows={integrityRows}
          />
        </ChartCard>
        <ChartCard eyebrow="Audit Tail" title="Recent activity and admin actions" description="Recent workspace events from the notification trail.">
          <CompactTable
            columns={[
              { key: "ts", label: "Time" },
              { key: "actor", label: "Actor" },
              { key: "action", label: "Action" },
            ]}
            rows={auditRows}
            emptyLabel="No audit-like activity is currently available."
          />
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard eyebrow="Background Jobs" title="Job schedule posture" description="Operational jobs and platform recomputes.">
          {schedulerJobs.length ? <MiniBarList rows={schedulerJobs} formatter={(value) => `${formatCompactNumber(value)}%`} /> : <p className="text-sm text-muted-foreground">No scheduler job status was returned.</p>}
        </ChartCard>
        <ChartCard eyebrow="Accounts" title="Access visibility" description="Account data is measured separately from sessions.">
          <p className="text-3xl font-semibold text-foreground">{summary.active_accounts == null ? "Unknown" : formatCompactNumber(Number(summary.active_accounts))}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Enabled accounts reported by auth-service. The stack does not fabricate a current session count.</p>
        </ChartCard>
        <ChartCard eyebrow="Quick Actions" title="Admin control points" description="Navigate to the highest-value admin actions already present in the ERP.">
          <div className="space-y-3">
            {[
              { href: "/system/users", label: "Role matrix", icon: Users },
              { href: "/system/tolerances", label: "Variance tolerances", icon: Wrench },
              { href: "/system/scheduler", label: "Scheduler status", icon: Wrench },
              { href: "/masters/reason-codes", label: "Reason codes", icon: ClipboardCheck },
              { href: "/masters/employees", label: "Employees", icon: Users },
              { href: "/masters/shifts", label: "Shifts", icon: Wrench },
              { href: "/masters/holidays", label: "Plant calendar", icon: Wrench },
              { href: "/operations/control", label: "Operations control", icon: Wrench },
              { href: "/reports", label: "Report hub", icon: ClipboardCheck },
              { href: "/analytics", label: "Analytics", icon: BarChart3 },
              { href: "/planning/tracker", label: "Tracker", icon: Wrench },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[1.2rem] border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted">
                <span className="inline-flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-signal-cyan-ink" />
                  {item.label}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </ChartCard>
      </section>
    </div>
  )
}
