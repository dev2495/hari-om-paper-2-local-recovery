"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import dayjs from "dayjs"
import { BarChart3, Factory, FlaskConical, PackageCheck, ReceiptText, ShieldAlert, Truck, Warehouse } from "lucide-react"
import { usePathname } from "next/navigation"

import { StickyFilterBar, StatusBadge } from "@/components/erp/shell"
import { type AnalyticsPreset, useAnalyticsContext } from "@/components/providers/analytics-provider"
import { authApi } from "@/lib/api"
import { cn } from "@/lib/utils"

const REPORT_TABS = [
  { href: "/reports/owner", label: "Owner Pack", icon: BarChart3 },
  { href: "/reports/production", label: "Production", icon: Factory },
  { href: "/reports/sales", label: "Sales", icon: ReceiptText },
  { href: "/reports/inventory", label: "Inventory", icon: Warehouse },
  { href: "/reports/quality", label: "Quality", icon: FlaskConical },
  { href: "/reports/dispatch", label: "Dispatch", icon: Truck },
  { href: "/reports/plants", label: "Plant Compare", icon: PackageCheck },
  { href: "/reports/exceptions", label: "Exceptions", icon: ShieldAlert },
]

const PRESET_OPTIONS: Array<{ value: AnalyticsPreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
]

function rangeLabel(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) return "Live range"
  return `${dayjs(startDate).format("DD MMM YYYY")} to ${dayjs(endDate).format("DD MMM YYYY")}`
}

export function AnalyticsFilters() {
  const pathname = usePathname()
  const {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    plantScope,
    setPlantScope,
    granularity,
    setGranularity,
    isCrossPlantDefault,
    preset,
    setPreset,
    availableRange,
  } =
    useAnalyticsContext()

  const plantsQuery = useQuery({
    queryKey: ["analytics-plant-options"],
    queryFn: async () => {
      const { data } = await authApi.getPlants()
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.items)) return data.items
      return []
    },
  })

  return (
    <div className="space-y-4">
      <StickyFilterBar testId="analytics-filter-bar">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid={`analytics-filter:preset:${option.value}`}
                onClick={() => setPreset(option.value)}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm font-semibold transition",
                  preset === option.value
                    ? "border-cyan-200 bg-cyan-50 text-cyan-950 shadow-sm"
                    : "border-slate-200 bg-white/90 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block">Start date</label>
              <input
                data-testid="analytics-filter:start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="h-10 w-full px-3"
              />
            </div>
            <div>
              <label className="mb-1 block">End date</label>
              <input
                data-testid="analytics-filter:end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-10 w-full px-3"
              />
            </div>
            <div>
              <label className="mb-1 block">Plant scope</label>
              <select
                data-testid="analytics-filter:plant"
                value={plantScope}
                onChange={(event) => setPlantScope(event.target.value)}
                className="h-10 w-full px-3"
              >
                {isCrossPlantDefault ? <option value="ALL">All Visible Plants</option> : null}
                {(plantsQuery.data || []).map((plant: any) => (
                  <option key={plant.id} value={plant.id}>
                    {plant.code ? `${plant.code} - ${plant.name}` : plant.name || plant.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block">Granularity</label>
              <select
                data-testid="analytics-filter:granularity"
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as "day" | "week" | "month")}
                className="h-10 w-full px-3"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div data-testid="analytics-filter:active-preset">
            <StatusBadge value="ACTIVE" label={preset === "all" ? "All Time" : preset === "custom" ? "Custom Window" : `${preset} preset`} />
          </div>
          <StatusBadge value={plantScope === "ALL" ? "ACTIVE" : "READY"} label={plantScope === "ALL" ? "Cross Plant" : "Single Plant"} />
          <div data-testid="analytics-filter:available-range">
            <StatusBadge value="PLANNED" label={rangeLabel(availableRange?.start_date, availableRange?.end_date)} />
          </div>
        </div>
      </StickyFilterBar>

      <div className="flex flex-wrap gap-2">
        {REPORT_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-testid={`analytics-tab:${tab.href}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition",
                active
                  ? "border-cyan-200 bg-cyan-50 text-cyan-950 shadow-sm"
                  : "border-slate-200 bg-white/85 text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}