"use client"

import { useAuth } from "@/context/AuthContext"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, BellRing, CheckCircle2, ShoppingCart } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, ProcurementShell, StateBadge, SummaryCard, WorkPanel, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { purchaseApi } from "@/lib/api"

export default function StockAlertInboxPage() {
  const { activePlant } = useAuth()
  const client = useQueryClient(); const query = useQuery({ queryKey: ["purchase-v2", "stock-alerts", activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getStockAlerts() })
  const rows: any[] = query.data?.data?.items || []; const open = rows.filter((row) => row.status !== "RECOVERED"); const critical = open.filter((row) => row.severity === "CRITICAL").length
  const action = useMutation({ mutationFn: (id: string) => purchaseApi.actOnStockAlert(id, { action: "ACKNOWLEDGE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["purchase-v2"] }) })
  return <ProcurementShell eyebrow="Stock exception inbox" title="Act on one stock breach episode until it recovers."
    description="Acknowledging records ownership; it does not change stock. Each alert shows the effective policy version and links to existing PO coverage before new buying.">
    <RequestErrors errors={[action.error, query.error]} />
    <section className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Open episodes" value={open.length} detail="Warning, acknowledged or snoozed" icon={BellRing} tone="amber" /><SummaryCard label="Critical" value={critical} detail="At or below safety stock" icon={AlertTriangle} tone="rose" /><SummaryCard label="Recovered" value={rows.length - open.length} detail="Closed after recovery margin" icon={CheckCircle2} tone="emerald" /></section>
    <WorkPanel title="Alert episodes" description="A recovered item can create a new episode only after a new breach.">
      {query.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : rows.length ? <div className="grid gap-3 lg:grid-cols-2">{rows.map((row) => <article key={row.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-foreground">{row.item_code} · {row.item_name}</p><p className="mt-1 text-xs text-muted-foreground">Policy v{row.policy_version} · breached {new Date(row.breached_at).toLocaleString("en-IN")}</p></div><div className="flex gap-2"><StateBadge value={row.severity} /><StateBadge value={row.status} /></div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-muted p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Free stock</p><p className="mt-1 text-xl font-semibold tabular-nums">{row.stock_qty_kg.toLocaleString("en-IN")} kg</p></div><div className="rounded-lg bg-muted p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Breach threshold</p><p className="mt-1 text-xl font-semibold tabular-nums">{row.threshold_qty_kg.toLocaleString("en-IN")} kg</p></div></div>{row.status !== "RECOVERED" ? <div className="mt-4 flex flex-wrap gap-2"><button className={secondaryButton} disabled={action.isPending || row.status === "ACKNOWLEDGED"} onClick={() => action.mutate(row.id)}><CheckCircle2 className="h-4 w-4" /> Acknowledge</button><Link href={`/purchase?item=${row.item_id}`} className={primaryButton}><ShoppingCart className="h-4 w-4" /> Review PO coverage</Link></div> : null}</article>)}</div> : <EmptyState label="No stock alert episodes. Evaluate active policies after stock data is current." />}
    </WorkPanel>
  </ProcurementShell>
}
