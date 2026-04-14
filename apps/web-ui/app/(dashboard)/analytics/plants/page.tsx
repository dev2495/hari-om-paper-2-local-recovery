"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { AnalyticsFilters } from "@/components/erp/analytics-filters"
import { ChartBox, ChartEmptyState, ChartPanel, ChartTooltip } from "@/components/erp/charts"
import { DataGrid } from "@/components/erp/data-grid"
import { ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { useSyncAnalyticsRange } from "@/hooks/use-analytics-range"
import { usePlantCompareReport } from "@/hooks/use-analytics"
import { ERP_CHART_THEME, MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { formatMetric } from "@/lib/reporting"

export default function PlantComparePage() {
  const { startDate, endDate, plantScope, granularity } = useAnalyticsContext()
  const plant = plantScope === "ALL" ? undefined : plantScope || undefined
  const { data } = usePlantCompareReport({ startDate, endDate, plant, granularity })
  useSyncAnalyticsRange(data?.available_range)

  const rows = Array.isArray((data as any)?.rows) ? (data as any).rows : []

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.analytics}
        badge="Plant Compare"
        testId="analytics-plants-hero"
        title="Cross-plant comparison for inventory value, delayed demand, and blocked stock"
        description="Owner and admin users can use this page to compare plants without losing transactional isolation on the operational screens."
        aside={<StatusBadge value="ACTIVE" label={`${rows.length} plants visible`} />}
      />

      <AnalyticsFilters />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ChartPanel title="Inventory Value by Plant" subtitle="Top-line stock value visible to the selected reporting scope.">
          {rows.length > 0 ? (
            <ChartBox height={320}>
              <BarChart data={rows}>
                <CartesianGrid stroke={ERP_CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="plant_code" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <ChartTooltip />
                <Bar dataKey="inventory_value" fill={ERP_CHART_THEME.palette[0]} radius={[6, 6, 0, 0]} name="Inventory Value" />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmptyState label="No plant comparison rows are available yet." />
          )}
        </ChartPanel>

        <ChartPanel title="Delayed Orders by Plant" subtitle="Plants currently carrying late commercial commitments.">
          {rows.length > 0 ? (
            <ChartBox height={320}>
              <BarChart data={rows}>
                <CartesianGrid stroke={ERP_CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="plant_code" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <ChartTooltip />
                <Bar dataKey="delayed_orders" fill={ERP_CHART_THEME.palette[4]} radius={[6, 6, 0, 0]} name="Delayed Orders" />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmptyState label="No delayed-order data is available for plant comparison." />
          )}
        </ChartPanel>
      </div>

      <Panel title="Plant Scoreboard" subtitle="Inventory, dispatch readiness, delayed demand, and active work by plant.">
        <DataGrid
          rows={rows}
          emptyLabel="No plants are available in the current scope."
          rowKey={(row: any) => row.plant_id}
          columns={[
            {
              key: "plant_name",
              label: "Plant",
              render: (row: any) => (
                <div>
                  <p className="font-semibold text-slate-900">{row.plant_name}</p>
                  <p className="text-xs text-slate-500">{row.plant_code}</p>
                </div>
              ),
            },
            { key: "job_cards", label: "Job Cards", align: "right", render: (row: any) => formatMetric(row.job_cards) },
            { key: "inventory_value", label: "Inventory", align: "right", render: (row: any) => formatMetric(row.inventory_value) },
            { key: "ready_job_count", label: "Ready Jobs", align: "right", render: (row: any) => formatMetric(row.ready_job_count) },
            { key: "blocked_qty", label: "Blocked", align: "right", render: (row: any) => formatMetric(row.blocked_qty) },
            { key: "delayed_orders", label: "Delayed", align: "right", render: (row: any) => formatMetric(row.delayed_orders) },
          ]}
        />
      </Panel>
    </div>
  )
}
