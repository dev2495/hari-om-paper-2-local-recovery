"use client"

// Stock alerts (review 3 Nov 2026): materials at or below their reorder level, from the Reorder rules.
// "I'll handle it" records who took it; it never changes stock. An alert closes on its own when stock is
// back above the level.
import { useMemo } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, Hand, ShoppingCart } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { Chip, EmptyBlock, Notice, Panel, PickPlant, Stat } from "@/components/inventory/stock-ui"
import { purchaseApi } from "@/lib/api"

const qty = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
const when = (value?: string) => (value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")

export default function StockAlertsPage() {
  const { activePlant } = useAuth()
  const single = Boolean(activePlant && activePlant !== "ALL")
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["purchase-v2", "stock-alerts", activePlant], enabled: single, queryFn: () => purchaseApi.getStockAlerts() })
  const policies = useQuery({ queryKey: ["purchase-v2", "policies", activePlant], enabled: single, queryFn: () => purchaseApi.getStockPolicies() })
  const rows: any[] = query.data?.data?.items || []
  const rulesOn = (policies.data?.data?.items || []).filter((row: any) => row.status === "ACTIVE").length
  const take = useMutation({ mutationFn: (id: string) => purchaseApi.actOnStockAlert(id, { action: "ACKNOWLEDGE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["purchase-v2"] }) })
  const open = useMemo(() => rows.filter((row) => row.status !== "RECOVERED").sort((a, b) => Number(b.severity === "CRITICAL") - Number(a.severity === "CRITICAL")), [rows])
  const normal = rows.filter((row) => row.status === "RECOVERED")
  const critical = open.filter((row) => row.severity === "CRITICAL").length

  if (!single) return <PickPlant what="stock alerts" />

  return (
    <div className="space-y-4" data-testid="stock-alerts-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">Stock alerts</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-6 text-muted-foreground">Materials at or below their reorder level. An alert closes on its own once stock is back above the level.</p>
        </div>
        <Link href="/inventory/stock-alert-policies" className="erp-btn-secondary !h-11">Reorder rules <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </header>

      {take.error ? <Notice tone="rose" icon={AlertTriangle}>{String((take.error as any)?.response?.data?.detail || (take.error as any)?.message || "Could not save that.")}</Notice> : null}

      <section className="grid grid-cols-3 gap-2" aria-label="Stock alerts at a glance">
        <Stat label="Low now" value={open.length} icon={BellRing} tone={open.length ? "amber" : "slate"} />
        <Stat label="Critical" value={critical} detail="at or below safety" icon={AlertTriangle} tone={critical ? "rose" : "slate"} />
        <Stat label="Back to normal" value={normal.length} icon={CheckCircle2} tone="emerald" />
      </section>

      <Panel title="Low now" bodyClassName={open.length ? "!p-0" : undefined}>
        {query.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading alerts">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-16 rounded-lg" />)}</div>
        ) : !open.length ? (
          <EmptyBlock icon={CheckCircle2} title="Nothing is low"
            message={rulesOn ? `${rulesOn === 1 ? "1 material is" : `${rulesOn} materials are`} watched. Alerts appear here when stock drops to the reorder level.` : "No material has a reorder rule yet, so nothing can raise an alert."}
            action={rulesOn ? undefined : <Link href="/inventory/stock-alert-policies" className="erp-btn-primary !h-11">Set reorder rules</Link>} />
        ) : (
          <ul className="divide-y divide-border">
            {open.map((row) => {
              const isCritical = row.severity === "CRITICAL"
              const taken = row.status === "ACKNOWLEDGED"
              return (
                <li key={row.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                      {row.item_code} <span className="font-normal text-muted-foreground">· {row.item_name}</span>
                      {isCritical ? <Chip tone="rose" icon={AlertTriangle}>Critical</Chip> : <Chip tone="amber">Low</Chip>}
                      {taken ? <Chip tone="blue" icon={Hand}>Handled by {row.acknowledged_by || "someone"}</Chip> : null}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      <span className="font-semibold tabular-nums text-foreground">{qty(row.stock_qty_kg)}</span> in stock, alert at {qty(row.threshold_qty_kg)} · since {when(row.breached_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!taken ? <button type="button" className="erp-btn-secondary !h-11" disabled={take.isPending} onClick={() => take.mutate(row.id)} aria-label={`I'll handle ${row.item_code}`}><Hand className="h-4 w-4" aria-hidden="true" />I&apos;ll handle it</button> : null}
                    <Link href={`/purchase?item=${encodeURIComponent(row.item_id)}`} className="erp-btn-primary !h-11" aria-label={`Open purchase orders for ${row.item_code}`}><ShoppingCart className="h-4 w-4" aria-hidden="true" />Open POs</Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
