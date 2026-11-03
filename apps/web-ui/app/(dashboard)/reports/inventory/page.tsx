"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  DonutWithCenter,
  DrillLink,
  KpiRail,
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  VelocityMatrix,
  formatCurrency,
  formatNumber,
} from "@/components/reports/primitives"
import { reportLoadNote } from "@/components/reports/report-load"
import { useAuth } from "@/context/AuthContext"
import { useInventoryValuation, useItemVelocity } from "@/hooks/use-analytics"
import { api } from "@/lib/api"
import { useInwardStockAsOn } from "@/hooks/use-inventory"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"

export default function InventoryReportsWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Owner", "Admin"]}>
      <InventoryIntelligencePage />
    </RoleGate>
  )
}

function InventoryIntelligencePage() {
  const { activePlant } = useAuth()
  const activePlantLabel = usePlantScopeLabel(activePlant)

  const valuationQuery = useInventoryValuation(activePlant || undefined)
  const velocityQuery = useItemVelocity({ horizonDays: 30, plant: activePlant || undefined })
  const valuation = valuationQuery.data
  const velocity = velocityQuery.data
  const velLoading = velocityQuery.isLoading
  // Stock health comes from its own report, not the owner pack (Store does not hold analytics:view).
  const healthQuery = useQuery({
    queryKey: ["analytics", "reports-inventory-health", activePlant],
    queryFn: async () => (await api.get("/api/analytics/reports/inventory-health", { params: activePlant ? { plant: activePlant } : undefined })).data,
  })
  const inwardStockQuery = useInwardStockAsOn({ material: "ALL", limit: 20 })

  const inventory: any = healthQuery.data || {}
  const valueNote = reportLoadNote(healthQuery.error) && reportLoadNote(valuationQuery.error)
  const velocityNote = reportLoadNote(velocityQuery.error)
  const valuationNote = reportLoadNote(valuationQuery.error)

  const breakdown = useMemo(() => {
    const raw = (valuation as any)?.breakdown || []
    const colors: Record<string, string> = {
      RAW_MATERIAL: "hsl(var(--chart-1))",
      RM: "hsl(var(--chart-1))",
      RAW: "hsl(var(--chart-1))",
      WIP: "hsl(var(--chart-3))",
      FG: "hsl(var(--chart-7))",
      FINISHED_GOODS: "hsl(var(--chart-7))",
      ADHESIVE: "hsl(var(--chart-3))",
      PARCHMENT: "hsl(var(--chart-6))",
      PACKAGING: "hsl(var(--chart-5))",
    }
    return raw.map((row: any, i: number) => ({
      label: String(row.type || `Cat ${i + 1}`).replaceAll("_", " "),
      value: Number(row.value || 0),
      color: colors[String(row.type || "").toUpperCase()] || ["hsl(var(--chart-1))", "hsl(var(--chart-3))", "hsl(var(--chart-6))", "hsl(var(--chart-7))", "hsl(var(--chart-5))", "hsl(var(--chart-8))"][i % 6],
    }))
  }, [valuation])

  const breakdownTotal = breakdown.reduce((acc: number, b: any) => acc + b.value, 0) || 0

  const velRows: any[] = Array.isArray((velocity as any)?.rows) ? (velocity as any).rows : []
  const velSummary = (velocity as any)?.summary || {}

  const points = velRows.slice(0, 18).map((r: any) => ({
    code: r.item_code,
    daysOnHand: Number(r.days_on_hand || 0),
    valueINR: Number(r.value_inr || 0),
    burnRate: Number(r.burn_per_day || 0),
    tone: r.tone as any,
  }))

  const inventoryValue = Number(inventory.summary?.total_value || (valuation as any)?.total_value || 0)
  const lowStock = Number(inventory.summary?.low_stock_count ?? velSummary.critical ?? 0)
  const lowStockNote = reportLoadNote(healthQuery.error) && velocityNote
  const dead = Number(velSummary.dead || 0)
  const watch = Number(velSummary.watch || 0)
  const healthy = Number(velSummary.healthy || 0)
  const rmVelocityRows = velRows.filter((row) => String(row.type || "").toUpperCase() !== "FG")
  const inwardStockRows = Array.isArray((inwardStockQuery.data as any)?.items)
    ? (inwardStockQuery.data as any).items
    : Array.isArray((inwardStockQuery.data as any)?.rows)
      ? (inwardStockQuery.data as any).rows
      : []
  const rmDaysFromVelocity = rmVelocityRows.length
    ? rmVelocityRows.reduce((sum, row) => sum + Number(row.days_on_hand || 0), 0) / rmVelocityRows.length
    : null
  const rawRmDays = Number(inventory.summary?.days_on_hand_rm)
  const rmDays = Number.isFinite(rawRmDays) && rawRmDays > 0 ? rawRmDays : rmDaysFromVelocity

  // top movers from velocity (highest burn)
  const topMovers = [...velRows].sort((a, b) => Number(b.burn_per_day || 0) - Number(a.burn_per_day || 0)).slice(0, 8)
  // critical shortages
  const shortages = velRows.filter((r) => r.tone === "critical").slice(0, 8)

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-inventory-page">
      <ReportHero
        eyebrow="Inventory intelligence"
        title="Inventory intelligence"
        description="Same data spine as the close ritual. Click any row to drill into the underlying ledger, batches, reels."
        accent="amber"
        chips={[
          valueNote ? { label: `Value: ${valueNote}`, tone: "warn" } : { label: `${formatCurrency(inventoryValue)} value`, tone: "neutral" },
          ...(lowStockNote ? [] : [{ label: `${lowStock} critical`, tone: lowStock ? ("critical" as const) : ("ok" as const) }]),
          ...(velocityNote
            ? [{ label: `Item velocity: ${velocityNote}`, tone: "warn" as const }]
            : [
                { label: `${watch} watch`, tone: watch ? ("warn" as const) : ("neutral" as const) },
                { label: `${dead} dead stock`, tone: dead ? ("warn" as const) : ("neutral" as const) },
              ]),
        ]}
      />

      <ReportFilterBar>
        <FilterField label="As of">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-semibold text-muted-foreground">
            {new Date().toISOString().split("T")[0]}
          </span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-semibold text-muted-foreground">{activePlantLabel}</span>
        </FilterField>
      </ReportFilterBar>

      <KpiRail
        items={[
          { label: "Total stock value", value: valueNote ? "—" : formatCurrency(inventoryValue), tone: "violet", detail: valueNote || `${breakdown.length} categories` },
          { label: "Days on hand (RM)", value: rmDays === null ? "—" : `${formatNumber(rmDays)} d`, tone: "cyan", detail: rmDays === null ? velocityNote || "Needs ledger issue history" : "From ledger velocity" },
          { label: "Low stock items", value: lowStockNote ? "—" : formatNumber(lowStock), tone: lowStock ? "rose" : "emerald", detail: lowStockNote || (velocityNote ? `${lowStock} critical` : `${watch} watch · ${lowStock} critical`) },
          { label: "Dead stock SKUs", value: velocityNote ? "—" : formatNumber(dead), tone: dead ? "amber" : "emerald", detail: velocityNote || ">60 d on hand" },
          { label: "Healthy SKUs", value: velocityNote ? "—" : formatNumber(healthy), tone: "emerald", detail: velocityNote || "Within target band" },
          { label: "Tracked SKUs", value: velocityNote ? "—" : formatNumber(velRows.length), tone: "slate", detail: velocityNote || undefined },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Stock composition" title="Value mix by category" description="Click a wedge to filter the rest of the page.">
          {valuationNote ? (
            <NoteCallout tone="warn">{valuationNote}</NoteCallout>
          ) : breakdown.length ? (
            <DonutWithCenter
              slices={breakdown}
              centerTop={formatCurrency(breakdownTotal)}
              centerBottom="TOTAL"
            />
          ) : (
            <NoteCallout tone="neutral">No valuation breakdown available yet.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="Velocity matrix" title="Days-on-hand vs value — by SKU" description="Bottom-right = dead-stock; top-left = firefight zone. Reorder line at 10 days.">
          {velocityNote ? (
            <NoteCallout tone="warn">{velocityNote}</NoteCallout>
          ) : velLoading ? (
            <NoteCallout tone="neutral">Loading item velocity matrix…</NoteCallout>
          ) : points.length ? (
            <VelocityMatrix points={points} />
          ) : (
            <NoteCallout tone="neutral">No item movement data yet — wait for ledger entries.</NoteCallout>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Client stock-as-on" title="Amigo labels, source documents, locations, and QC status" description="Reel and batch rows use the same fields captured during inward. Use this for quick trace from Amigo no to bill/PO/location.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                {["Type", "Date", "Amigo no", "Party/Mill", "Item/Variety", "Qty", "PO", "Bill", "Rate", "Location", "QC"].map((head) => (
                  <th key={head} className="py-2 pr-3">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inwardStockRows.map((row: any) => (
                <tr key={`${row.entity_type}-${row.entity_id}`} className="border-b border-border">
                  <td className="py-2 pr-3">{row.entity_type || "-"}</td>
                  <td className="py-2 pr-3">{row.date || "-"}</td>
                  <td className="py-2 pr-3 font-semibold text-foreground">{row.amigo_no || "-"}</td>
                  <td className="py-2 pr-3">{row.mill || row.party_name || "-"}</td>
                  <td className="py-2 pr-3">{row.variety || row.item_name || "-"}</td>
                  <td className="py-2 pr-3">{formatNumber(row.reel_weight || row.tank_weight || row.current_qty, 2)}</td>
                  <td className="py-2 pr-3">{row.po || "-"}</td>
                  <td className="py-2 pr-3">{row.bill || "-"}</td>
                  <td className="py-2 pr-3">{formatNumber(row.rate, 2)}</td>
                  <td className="py-2 pr-3">{row.location || "-"}</td>
                  <td className="py-2 pr-3">{row.stock_status || "-"}</td>
                </tr>
              ))}
              {!inwardStockRows.length ? (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-muted-foreground">No inward stock rows available yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Top movers" title="Highest-velocity items (30d)" description="Burn rate × days-on-hand drives reorder pressure.">
          {velocityNote ? <NoteCallout tone="warn">{velocityNote}</NoteCallout> : topMovers.length ? (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Issued 30d</th>
                  <th className="py-2 pr-3 text-right">DOH</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {topMovers.map((row) => (
                  <tr key={row.item_code} className="border-b border-border">
                    <td className="py-2 pr-3 font-mono text-xs">{row.item_code}</td>
                    <td className="py-2 pr-3">{row.type}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.issued_30d || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.days_on_hand || 0), 1)} d</td>
                    <td className="py-2 pr-3">
                      <Pill tone={row.tone === "critical" ? "critical" : row.tone === "warn" ? "warn" : row.tone === "dead" ? "warn" : "ok"}>
                        {row.tone === "critical" ? "REORDER" : row.tone === "warn" ? "WATCH" : row.tone === "dead" ? "DEAD" : "OK"}
                      </Pill>
                    </td>
                    <td className="py-2 pr-3"><DrillLink href={`/inventory/items?code=${row.item_code}`}>Ledger</DrillLink></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <NoteCallout tone="neutral">No items in motion yet.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="Critical shortages" title="Items below reorder · top of the queue" description="Sorted by velocity-pressure (critical first).">
          {velocityNote ? <NoteCallout tone="warn">{velocityNote}</NoteCallout> : shortages.length ? (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Available</th>
                  <th className="py-2 pr-3 text-right">DOH</th>
                  <th className="py-2 pr-3 text-right">Burn/day</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {shortages.map((row) => (
                  <tr key={row.item_code} className="border-b border-border">
                    <td className="py-2 pr-3 font-mono text-xs">{row.item_code}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.available_qty || 0))}</td>
                    <td className="py-2 pr-3 text-right text-signal-rose-ink font-bold">{formatNumber(Number(row.days_on_hand || 0), 1)} d</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(row.burn_per_day || 0), 2)}</td>
                    <td className="py-2 pr-3"><DrillLink href="/purchase/scheduler?view=list">Demand and cover</DrillLink></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <NoteCallout tone="ok">No critical shortages — good signal.</NoteCallout>
          )}
        </Panel>
      </div>
    </div>
  )
}
