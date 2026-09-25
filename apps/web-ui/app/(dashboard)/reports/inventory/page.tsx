"use client"

import { useMemo } from "react"

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
import { useAuth } from "@/context/AuthContext"
import { useInventoryValuation, useItemVelocity, useOwnerPack } from "@/hooks/use-analytics"
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

  const { data: valuation } = useInventoryValuation(activePlant || undefined)
  const { data: velocity, isLoading: velLoading } = useItemVelocity({ horizonDays: 30, plant: activePlant || undefined })
  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const inwardStockQuery = useInwardStockAsOn({ material: "ALL", limit: 20 })

  const p: any = pack || {}
  const inventory = p.inventory || {}
  const headline = p.headline || {}

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

  const inventoryValue = Number(headline.inventory_value || inventory.summary?.inventory_value || (valuation as any)?.total_value || 0)
  const lowStock = Number(headline.low_stock_items || velSummary.critical || 0)
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
          { label: `${formatCurrency(inventoryValue)} value`, tone: "neutral" },
          { label: `${lowStock} critical`, tone: lowStock ? "critical" : "ok" },
          { label: `${watch} watch`, tone: watch ? "warn" : "neutral" },
          { label: `${dead} dead stock`, tone: dead ? "warn" : "neutral" },
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
          { label: "Total stock value", value: formatCurrency(inventoryValue), tone: "violet", detail: `${breakdown.length} categories` },
          { label: "Days on hand (RM)", value: rmDays === null ? "—" : `${formatNumber(rmDays)} d`, tone: "cyan", detail: rmDays === null ? "Needs ledger issue history" : "From ledger velocity" },
          { label: "Low stock items", value: formatNumber(lowStock), tone: lowStock ? "rose" : "emerald", detail: `${watch} watch · ${lowStock} critical` },
          { label: "Dead stock SKUs", value: formatNumber(dead), tone: dead ? "amber" : "emerald", detail: ">60 d on hand" },
          { label: "Healthy SKUs", value: formatNumber(healthy), tone: "emerald", detail: "Within target band" },
          { label: "Tracked SKUs", value: formatNumber(velRows.length), tone: "slate" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Stock composition" title="Value mix by category" description="Click a wedge to filter the rest of the page.">
          {breakdown.length ? (
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
          {velLoading ? (
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
          {topMovers.length ? (
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
          {shortages.length ? (
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
                    <td className="py-2 pr-3"><DrillLink href={`/analytics/mrp?view=demand`}>Demand coverage</DrillLink></td>
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
