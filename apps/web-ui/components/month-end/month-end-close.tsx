"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BookOpenText, Building2, CalendarClock, CalendarRange, ChevronLeft, ChevronRight, History, LayoutList, Link2Off, LockKeyhole, LockKeyholeOpen, Scale, Search, SlidersHorizontal, X } from "lucide-react"

import { EmptyQueryState, ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useMonthEndMonths, useMonthEndOverview } from "@/hooks/use-month-end"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"
import { usePlants } from "@/hooks/use-system"
import { dayText, istMonthKey, monthEndErrorText, monthText, personText, qty, shiftMonth, storeChangeWords, unitFloorWords, type MonthEndItem, type MonthEndOverview, type MonthEndUnitTotal } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

import { CloseBar, CloseChecklist, CloseDialog, ReopenDialog } from "./close-checklist"
import { FinancialYear } from "./financial-year"
import { ItemCard } from "./item-card"
import { ItemTable, type TableColumns } from "./item-table"
import { itemTone, Section, useWideScreen, type ItemTone } from "./parts"
import { PastMonths } from "./past-months"
import { SourcesDrawer } from "./sources-drawer"

type Tab = "month" | "past" | "year"
type Filter = "need" | "explained" | "ok" | "pending" | "use" | "nouse" | "all"
const TABS: Array<{ key: Tab; label: string; icon: typeof LayoutList }> = [
  { key: "month", label: "This month", icon: LayoutList },
  { key: "past", label: "Past months", icon: History },
  { key: "year", label: "Financial year", icon: CalendarRange },
]
const UNIT_WORDS: Record<string, string> = { KG: "Kilogram items", PCS: "Piece items", L: "Litre items" }

function unitHeading(uom: string, label: string) {
  return UNIT_WORDS[uom] || `Items in ${label}`
}

/** The three totals of one unit, in words (spec, issued, used per count). */
function UnitTotals({ unit, view }: { unit: MonthEndUnitTotal; view: MonthEndOverview }) {
  const label = unit.unit_label
  const floor = unitFloorWords(unit, label, view.running)
  const store = unit.store_gap === null ? null : storeChangeWords(unit.corrections, unit.count_variance, label)
  return (
    <div className="rounded-xl border border-border p-3" data-testid="month-end-unit-total" data-uom={unit.uom}>
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wide text-foreground">{label}</span>
        {unit.items_with_use} item{unit.items_with_use === 1 ? "" : "s"} used
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        <div className="min-w-0 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
          <dt className="text-[12px] text-muted-foreground">Spec allows</dt>
          <dd className="break-words text-[18px] font-semibold leading-tight">{qty(unit.expected, label)}</dd>
        </div>
        <div className="min-w-0 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
          <dt className="text-[12px] text-muted-foreground">Store issued to floor</dt>
          <dd className="break-words text-[18px] font-semibold leading-tight">{qty(unit.issued, label)}</dd>
        </div>
        <div className="min-w-0 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
          <dt className="text-[12px] text-muted-foreground">Used as per stock count</dt>
          <dd className={cn("break-words text-[18px] font-semibold leading-tight", unit.actual_used === null && "text-muted-foreground")}>{unit.actual_used === null ? "Not known yet" : qty(unit.actual_used, label)}</dd>
        </div>
      </dl>
      <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-5 text-muted-foreground" data-testid="month-end-unit-floor">
        {floor.outside ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-amber-ink" aria-hidden="true" /> : null}
        <span>
          <span className={floor.outside ? "font-medium text-foreground" : undefined}>{floor.sentence}</span>
          {store ? ` · ${store.sentence}` : ""}.
        </span>
      </p>
    </div>
  )
}

function filterOf(item: MonthEndItem, running: boolean): Filter {
  const tone: ItemTone = itemTone(item, running)
  return tone === "nouse" ? "nouse" : tone === "need" ? "need" : tone === "explained" ? "explained" : tone === "ok" ? "ok" : "pending"
}

function ThisMonth({ view, plantId, monthHref }: { view: MonthEndOverview; plantId: string; monthHref: (href: string) => string }) {
  const { user, activeRole } = useAuth()
  // Masters open only to the Owner and Admin: others get words instead of a link they cannot open.
  const viewerRoles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const canOpenMasters = viewerRoles.has("Owner") || viewerRoles.has("Admin")
  const [filter, setFilter] = useState<Filter | null>(null)
  const [search, setSearch] = useState("")
  const [sourceItem, setSourceItem] = useState<MonthEndItem | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [columns, setColumns] = useState<TableColumns>("use")
  // One close action on screen: the checklist's Next card holds it; the bottom bar appears only while
  // that card is scrolled out of view (r4: two "Close September 2026" plus "Close the month").
  const [nextVisible, setNextVisible] = useState(true)
  const wide = useWideScreen()

  useEffect(() => {
    const card = document.querySelector('[data-testid="month-end-next"]')
    if (!card || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => setNextVisible(entry.isIntersecting), { threshold: 0.4 })
    observer.observe(card)
    return () => observer.disconnect()
  }, [view.month, view.state])

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { need: 0, explained: 0, ok: 0, pending: 0, use: 0, nouse: 0, all: view.items.length }
    for (const item of view.items) {
      const key = filterOf(item, view.running)
      out[key] += 1
      if (item.has_use) out.use += 1
    }
    return out
  }, [view.items, view.running])
  // Open on what needs the Owner (items needing a note), else on the items used this month, with the
  // no-use rows folded behind one button; every item only when none has a no-use row.
  // A month with no use at all opens on All, never on a zero chip (checker #35, 2026-10-30).
  const activeFilter: Filter = filter || (counts.need ? "need" : counts.nouse && counts.use ? "use" : "all")

  useEffect(() => {
    setFilter(null)
  }, [view.month])
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#needs-note") setFilter("need")
    }
    onHash()
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const term = search.trim().toLowerCase()
  const visible = view.items.filter((item) => {
    const key = filterOf(item, view.running)
    const passes = activeFilter === "all" ? true : activeFilter === "use" ? item.has_use : key === activeFilter
    if (!passes) return false
    if (!term) return true
    return `${item.item_name} ${item.item_code} ${item.material_label}`.toLowerCase().includes(term)
  })
  const rank: Record<Filter, number> = { need: 0, explained: 1, pending: 2, ok: 3, use: 4, nouse: 5, all: 6 }
  const groups = (() => {
    const byUnit = new Map<string, MonthEndItem[]>()
    for (const item of visible) {
      const list = byUnit.get(item.uom) || []
      list.push(item)
      byUnit.set(item.uom, list)
    }
    const order = ["KG", "PCS", "L"]
    return Array.from(byUnit.entries())
      .sort(([a], [b]) => (order.indexOf(a) === -1 ? 9 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 9 : order.indexOf(b)) || a.localeCompare(b))
      .map(([uom, items]) => ({
        uom,
        label: items[0]?.unit_label || uom.toLowerCase(),
        items: items.sort((a, b) => {
          const gapA = Math.abs(Number((view.actual_known ? a.total_gap : a.floor_gap) || 0))
          const gapB = Math.abs(Number((view.actual_known ? b.total_gap : b.floor_gap) || 0))
          return rank[filterOf(a, view.running)] - rank[filterOf(b, view.running)] || gapB - gapA || a.item_name.localeCompare(b.item_name)
        }),
      }))
  })()

  // In a running month every used item is "so far", so that chip only repeats "Used so far": show it only
  // when the two differ (checker 2026-10-30).
  const pendingRepeatsUse = view.running && counts.pending === counts.use && activeFilter !== "pending"
  const chips: Array<{ key: Filter; label: string; count: number; hideWhenZero?: boolean; hidden?: boolean }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "need", label: "Needs a note", count: counts.need, hideWhenZero: !view.actual_known },
    { key: "explained", label: "Explained", count: counts.explained, hideWhenZero: !view.actual_known },
    { key: "ok", label: "Within limit", count: counts.ok, hideWhenZero: !view.actual_known },
    { key: "pending", label: view.running ? "So far" : "Waiting for count", count: counts.pending, hideWhenZero: view.actual_known, hidden: pendingRepeatsUse },
    { key: "use", label: view.running ? "Used so far" : "Used this month", count: counts.use, hideWhenZero: activeFilter !== "use" },
    { key: "nouse", label: "No use", count: counts.nouse, hideWhenZero: true },
  ]
  const usedUnits = view.units.filter((unit) => unit.items_with_use > 0)
  const closed = view.state === "CLOSED"

  return (
    <div className="space-y-4">
      {closed ? (
        <div className="flex flex-col gap-2 rounded-xl border border-signal-emerald-line bg-signal-emerald-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="month-end-closed-banner">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-signal-emerald-ink">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">{view.is_fy_close ? `Financial year close ${view.fy}` : `${view.month_label} closed`}</strong>
              {view.close?.closed_at ? ` on ${dayText(view.close.closed_at)} by ${personText(view.close.closed_by)}` : ""}
              {view.close && view.close.version > 1 ? ` (closed ${view.close.version} times)` : ""}.{" "}
              {view.frozen ? "These are the figures frozen at the close." : "Closed before figures were frozen; these figures are live."}
              {view.close?.close_note ? <span className="block text-foreground">“{view.close.close_note}”</span> : null}
            </span>
          </p>
          {view.changed_after_close && view.changed_after_close.length ? (
            <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-signal-amber-line bg-signal-amber-soft px-2.5 py-1 text-[12px] font-semibold text-signal-amber-ink" title={`Live store figures differ for ${view.changed_after_close.join(", ")}`} data-testid="month-end-changed-chip">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Changed after close · {view.changed_after_close.length}
            </span>
          ) : null}
        </div>
      ) : view.close?.reopened_at ? (
        <div className="flex items-start gap-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-[13px] leading-5 text-signal-amber-ink" data-testid="month-end-reopened-banner">
          <LockKeyholeOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">Re-opened {dayText(view.close.reopened_at)} by {personText(view.close.reopened_by)}.</strong>{" "}
            {view.close.reopen_reason ? `“${view.close.reopen_reason}”` : ""} Entries dated in {view.month_word} are allowed again until it is closed.
          </span>
        </div>
      ) : null}

      {closed && view.earlier_open_months?.length ? (
        // An earlier month is open again with entries (a count or GRN dated there after this close): it
        // moves this month's opening, which is why live figures can differ from the frozen ones.
        <div className="flex flex-col gap-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status" data-testid="month-end-earlier-open">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-signal-amber-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">
                {view.earlier_open_months.length === 1
                  ? `${monthText(view.earlier_open_months[0])} is still open and has entries.`
                  : `${view.earlier_open_months.map(monthText).join(", ")} are still open and have entries.`}
              </strong>{" "}
              Entries dated there change {view.month_word}’s opening stock, so the live figures can differ from the ones frozen at this close. Close {view.earlier_open_months.length === 1 ? "it" : "them"} in order.
            </span>
          </p>
          <Link href={monthHref(`?month=${view.earlier_open_months[0]}`)} className="erp-btn-secondary !h-11 shrink-0 self-start sm:!h-9 sm:self-auto" data-testid="month-end-earlier-open-link">
            Open {monthText(view.earlier_open_months[0])}
          </Link>
        </div>
      ) : null}

      <CloseChecklist view={view} onClose={() => setCloseOpen(true)} onReopen={() => setReopenOpen(true)} monthHref={monthHref} />

      {!view.figures_available ? (
        <div className="flex items-start gap-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-[13px] leading-5 text-signal-amber-ink" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Store figures for {view.month_label} are not available yet, so issued and used show as zero. The spec below is complete.</span>
        </div>
      ) : null}

      <Section
        id="material-use"
        testId="month-end-material"
        title={view.running ? `Material use so far in ${view.month_word}` : `Material use in ${view.month_word}`}
        subtitle={
          view.running
            ? "Spec = material in the good tubes made, plus the normal wastage. Issued is what the store gave the floor so far; actual use is known after the month-end count."
            : "Spec = material in the good tubes made, plus the normal wastage. Used is what the approved month-end count says. Every number is in the item's own unit."
        }
      >
        {usedUnits.length ? (
          <div className={cn("grid gap-2.5", usedUnits.length > 1 && "xl:grid-cols-2")}>
            {usedUnits.map((unit) => <UnitTotals key={unit.uom} unit={unit} view={view} />)}
          </div>
        ) : null}

        <div id="needs-note" className="mt-4 flex scroll-mt-24 flex-col gap-2.5 2xl:flex-row 2xl:items-center 2xl:justify-between">
          {/* Chips wrap on a phone: a sideways scroll hid "No use" with no hint (checker 2026-10-30). */}
          <div className="flex flex-wrap gap-1.5 pb-1" role="radiogroup" aria-label="Show items">
            {chips.filter((chip) => !chip.hidden && !(chip.hideWhenZero && chip.count === 0)).map((chip) => (
              <button
                key={chip.key}
                type="button"
                role="radio"
                aria-checked={activeFilter === chip.key}
                onClick={() => setFilter(chip.key)}
                data-testid={`month-end-filter-${chip.key}`}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-semibold transition sm:h-9",
                  activeFilter === chip.key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                {chip.label}
                <span className={cn("rounded-full px-1.5 text-[12px] tabular-nums", activeFilter === chip.key ? "bg-background/20" : "bg-muted text-muted-foreground")}>{chip.count}</span>
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2 lg:justify-between 2xl:justify-end">
          {wide ? (
            <div role="radiogroup" aria-label="Table columns" className="flex shrink-0 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-0.5" data-testid="month-end-columns">
              {([["use", "Use against spec", Scale], ["book", "Store book", BookOpenText]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={columns === key}
                  onClick={() => setColumns(key)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-semibold transition",
                    columns === key ? "bg-card text-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <label className="relative flex min-w-0 flex-1 items-center lg:w-72 lg:flex-none">
            <span className="sr-only">Search materials</span>
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search material or code"
              className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} className="absolute right-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          </div>
        </div>

        <div className="mt-3 space-y-5">
          {groups.length ? (
            groups.map((group) => (
              <div key={group.uom} data-testid="month-end-unit-group" data-uom={group.uom}>
                <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
                  {unitHeading(group.uom, group.label)}
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold uppercase text-foreground">{group.label}</span>
                  <span className="font-normal">· {group.items.length}</span>
                </h3>
                {wide ? (
                  <ItemTable items={group.items} view={view} plantId={plantId} columns={columns} onOpenSources={setSourceItem} />
                ) : (
                  <div className="grid gap-2.5">
                    {group.items.map((item) => (
                      <ItemCard key={item.item_code} item={item} view={view} plantId={plantId} onOpenSources={setSourceItem} />
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <EmptyQueryState
              title={term ? "No material matches the search" : activeFilter === "need" ? "No item needs a note" : activeFilter === "use" ? `No material was used in ${view.month_label}` : "Nothing here"}
              message={term ? "Try part of the name or the code." : activeFilter === "use" ? "No job card posted spec, nothing was issued and no count or correction changed stock." : view.items.length ? "Pick another filter above." : `No job card posted spec and the store issued nothing in ${view.month_label}.`}
            />
          )}
          {activeFilter === "use" && !term && counts.nouse ? (
            <button
              type="button"
              onClick={() => setFilter("nouse")}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-9"
              data-testid="month-end-show-nouse"
            >
              Show {counts.nouse === 1 ? "1 material" : `${counts.nouse} materials`} with no use
            </button>
          ) : null}
        </div>
      </Section>

      {view.unlinked.length ? (
        <Section
          testId="month-end-unlinked"
          title={`Spec items not linked to a stock item · ${view.unlinked.length}`}
          subtitle="Spec that cannot be compared with the store: no stock item has its code, or it was posted in another unit than the stock item counts in. It stays out of the totals until the link is fixed."
        >
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {view.unlinked.map((row) => (
              <li key={row.item_code} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="month-end-unlinked-row">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-signal-amber-ink" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-words text-[13.5px] font-semibold">{row.item_name || row.item_code}</p>
                    <p className="break-words text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{row.item_code} · {row.kind} · spec {qty(row.spec, row.unit_label)} from {row.job_cards === 1 ? "1 job card" : `${row.job_cards} job cards`}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                      <span className="inline-flex h-5 items-center rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 text-[12px] font-semibold text-signal-amber-ink">
                        {row.link === "UNIT_DIFFERS" ? "Unit differs" : "No stock item"}
                      </span>
                      {row.reason}
                    </p>
                  </div>
                </div>
                {row.fix_href && (canOpenMasters || !row.fix_href.startsWith("/masters")) ? (
                  <Link href={row.fix_href} className="erp-btn-secondary !h-11 shrink-0 sm:!h-9">{row.fix_label}</Link>
                ) : (
                  <p className="shrink-0 text-[12.5px] font-medium text-muted-foreground sm:max-w-[16rem] sm:text-right" data-testid="month-end-unlinked-ask">Ask the Owner to link it in Masters.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {nextVisible ? null : <CloseBar view={view} onClose={() => setCloseOpen(true)} />}

      <SourcesDrawer item={sourceItem} view={view} plantId={plantId} onClose={() => setSourceItem(null)} />
      <CloseDialog view={view} plantId={plantId} open={closeOpen} onOpenChange={setCloseOpen} />
      <ReopenDialog view={view} plantId={plantId} open={reopenOpen} onOpenChange={setReopenOpen} />
    </div>
  )
}

function PlantChooser() {
  const { user, setActivePlant } = useAuth()
  const plants = usePlants()
  const allowed = new Set([...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].map(String))
  const rows = (plants.data || []).filter((plant: any) => !allowed.size || allowed.has(String(plant.id)) || user?.is_owner_all_plants || (user?.roles || []).includes("Owner") || (user?.roles || []).includes("Admin"))
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-premium" data-testid="month-end-choose-plant">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Choose a plant</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Month-end close is kept per plant: each plant counts its own store and closes its own months.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map((plant: any) => (
          <button key={plant.id} type="button" className="erp-btn-secondary !h-11" onClick={() => setActivePlant(String(plant.id))}>
            {plant.name || plant.code}
          </button>
        ))}
      </div>
    </section>
  )
}

export function MonthEndClose() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { activePlant, user } = useAuth()
  const plantParam = params.get("plant") || ""
  const allowedPlants = useMemo(() => new Set([...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].map(String)), [user])
  const plantId = plantParam && plantParam !== "ALL" && (allowedPlants.has(plantParam) || (user?.roles || []).includes("Owner") || (user?.roles || []).includes("Admin")) ? plantParam : activePlant && activePlant !== "ALL" ? activePlant : ""
  // The plant's name once the plants list has it; never its id in the title (checker r2 saw the UUID
  // while a slow plants list was still loading).
  const plantLabel = usePlantScopeLabel(plantId || null, "")
  const plantName = plantLabel && plantLabel !== plantId ? plantLabel : ""
  const tab: Tab = params.get("tab") === "past" ? "past" : params.get("tab") === "year" ? "year" : "month"
  const months = useMonthEndMonths(plantId)
  const monthParam = /^\d{4}-\d{2}$/.test(params.get("month") || "") ? String(params.get("month")) : ""
  const month = monthParam || months.data?.default_month || ""
  // A month after the running one has nothing to read: no store call, no error, no picker entry.
  // (Before the months list arrives, the IST month on this device decides, so no request goes out.)
  const future = Boolean(month && month > (months.data?.current_month || istMonthKey()))
  const overview = useMonthEndOverview(tab === "month" && !future ? month : null, plantId)
  const fy = params.get("fy") || undefined

  const setQuery = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )
  /** Step links come from the server as "?month=…" or real paths; keep the page's plant and tab. */
  const monthHref = useCallback(
    (href: string) => {
      if (href.startsWith("?")) {
        const extra = new URLSearchParams(href.slice(1))
        const next = new URLSearchParams(params.toString())
        next.set("tab", "month")
        extra.forEach((value, key) => next.set(key, value))
        return `${pathname}?${next.toString()}`
      }
      return href
    },
    [params, pathname],
  )
  const monthLink = useCallback((key: string) => monthHref(`?month=${key}`), [monthHref])

  const first = months.data?.first_month || ""
  const current = months.data?.current_month || istMonthKey()
  const options = (months.data?.months || []).map((row) => row.month)
  const canPrev = Boolean(month && first && month > first)
  const canNext = Boolean(month && month < current)
  const monthRow = months.data?.months.find((row) => row.month === month)

  const view = overview.data
  const stateChip = !view ? null : view.state === "CLOSED" ? (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-signal-emerald-line bg-signal-emerald-soft px-2.5 text-[12px] font-semibold text-signal-emerald-ink"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />Closed</span>
  ) : view.state === "RUNNING" ? (
    <span className="inline-flex h-7 items-center rounded-full border border-border bg-muted px-2.5 text-[12px] font-semibold text-muted-foreground">Running · so far</span>
  ) : (
    <span className="inline-flex h-7 items-center rounded-full border border-signal-amber-line bg-signal-amber-soft px-2.5 text-[12px] font-semibold text-signal-amber-ink">Not closed</span>
  )

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 pb-4" data-testid="month-end-close-page">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <span className="tube-page-eyebrow">Operations · Month-end close</span>
          <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[clamp(20px,2.4vw,26px)] font-[650] leading-tight tracking-[-0.022em]">
            <span className="break-words">{tab === "month" ? (month ? monthText(month) : "Month-end close") : tab === "year" ? "Financial year" : "Past months"}{plantName ? ` · ${plantName}` : ""}</span>
            {tab === "month" && !future ? stateChip : null}
          </h1>
          <p className="mt-1.5 max-w-[72ch] text-[13.5px] leading-6 text-muted-foreground">Count the store, check material use against the spec, then close the month.</p>
        </div>
        <div className="flex w-full items-center gap-2 lg:w-auto">
          {tab === "month" && plantId ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 lg:flex-none" data-testid="month-end-month-picker">
              <button type="button" className="erp-btn-secondary !h-11 !w-11 !px-0 sm:!h-9 sm:!w-9" disabled={!canPrev} onClick={() => setQuery({ month: future ? current : shiftMonth(month, -1), tab: "month" })} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <label className="sr-only" htmlFor="month-end-month">Month</label>
              <select
                id="month-end-month"
                value={month}
                onChange={(event) => setQuery({ month: event.target.value, tab: "month" })}
                className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-[13.5px] font-semibold shadow-[var(--shadow-xs)] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 lg:w-auto lg:min-w-[14rem] lg:flex-none"
              >
                {!month ? <option value="" disabled>Finding the month…</option> : null}
                {future ? <option value={month} disabled>{monthText(month)} · not started</option> : null}
                {(options.includes(month) || !month || future ? options : [...options, month].sort().reverse()).map((key) => (
                  <option key={key} value={key}>{monthText(key)}{months.data?.months.find((row) => row.month === key)?.status === "CLOSED" ? " · closed" : ""}</option>
                ))}
              </select>
              <button type="button" className="erp-btn-secondary !h-11 !w-11 !px-0 sm:!h-9 sm:!w-9" disabled={!canNext} onClick={() => setQuery({ month: shiftMonth(month, 1), tab: "month" })} aria-label="Next month">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Link
            href={`/production/reconciliation/limits${plantId ? `?plant=${encodeURIComponent(plantId)}` : ""}`}
            className={cn("erp-btn-secondary !h-11 shrink-0 sm:!h-9", tab === "month" && plantId ? "max-sm:!w-11 max-sm:!px-0" : "")}
            aria-label="Usage limits"
            data-testid="month-end-limits-link"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className={tab === "month" && plantId ? "max-sm:sr-only" : ""}>Usage limits</span>
          </Link>
        </div>
      </header>

      <div role="tablist" aria-label="Month-end views" className="grid grid-cols-3 gap-1 rounded-xl sm:flex border border-border bg-card p-1 shadow-[var(--shadow-xs)]">
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`month-end-tab-${item.key}`}
              onClick={() => setQuery({ tab: item.key === "month" ? null : item.key })}
              className={cn(
                "inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-center text-[13px] font-semibold leading-tight transition sm:h-9 sm:flex-none sm:whitespace-nowrap sm:px-3",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
              {item.label}
            </button>
          )
        })}
      </div>

      {!plantId ? (
        <PlantChooser />
      ) : tab === "past" ? (
        months.isLoading ? <LoadingState label="Reading past months…" /> : months.isError || !months.data ? (
          <ErrorState title="Past months could not be loaded" message={monthEndErrorText(months.error)} onRetry={() => months.refetch()} />
        ) : (
          <PastMonths data={months.data} monthHref={monthLink} />
        )
      ) : tab === "year" ? (
        <FinancialYear plantId={plantId} fy={fy} onFy={(value) => setQuery({ fy: value, tab: "year" })} monthHref={monthLink} />
      ) : future ? (
        <section className="rounded-xl border border-border bg-card px-5 py-8 text-center shadow-premium" data-testid="month-end-not-started">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
            <CalendarClock className="h-5 w-5" />
          </span>
          <h2 className="mt-3 text-[15px] font-semibold">{monthText(month)} has not started yet</h2>
          <p className="mx-auto mt-1 max-w-[52ch] text-[13px] leading-5 text-muted-foreground">
            Nothing is posted in it yet. Its figures and close checklist appear here once the month begins.
          </p>
          <Link href={monthLink(current)} className="erp-btn-primary !h-11 mt-4 inline-flex" data-testid="month-end-go-current">
            Go to {monthText(current)}
          </Link>
        </section>
      ) : months.isLoading || (overview.isLoading && Boolean(month)) || (!month && !months.isError) ? (
        <LoadingState label={month ? `Reading ${monthText(month)}…` : "Finding the month to close…"} />
      ) : months.isError ? (
        <ErrorState title="Month-end close could not be loaded" message={monthEndErrorText(months.error)} onRetry={() => months.refetch()} />
      ) : overview.isError || !view ? (
        <ErrorState title={`${monthText(month)} could not be loaded`} message={monthEndErrorText(overview.error)} onRetry={() => overview.refetch()} />
      ) : (
        <>
          {monthRow && monthRow.status !== "CLOSED" && months.data && months.data.default_month !== month && months.data.default_month < month ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-[hsl(var(--surface-2))] px-4 py-2.5 text-[12.5px] text-muted-foreground">
              {monthText(months.data.default_month)} is the oldest month still open.
              <Link href={monthLink(months.data.default_month)} className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline sm:min-h-0">Go to {monthText(months.data.default_month)}</Link>
            </p>
          ) : null}
          <ThisMonth view={view} plantId={plantId} monthHref={monthHref} />
        </>
      )}
    </div>
  )
}
