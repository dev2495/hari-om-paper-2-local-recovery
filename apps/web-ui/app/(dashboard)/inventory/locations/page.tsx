"use client"

// Locations (client 2026-10-28): every rack, bay and area with what sits on it, the stock not in any
// location yet (put it away by scanning, or the Owner puts it all in the RM store), create / edit / switch
// off, and label printing (select racks → sheet). Everyone may view; Store, plant head, Owner and Admin manage.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ArchiveRestore, Boxes, CheckSquare, ChevronRight, Inbox, MapPin, PackageSearch, Plus, Printer, ScanLine, Square, Warehouse } from "lucide-react"

import { LocationFormSheet } from "@/components/inventory/location-form-sheet"
import { Chip, EmptyBlock, Notice, PickPlant, Segmented, Sheet, fieldClass } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useLocationsOverview, usePutAwayAll, useSinglePlant } from "@/hooks/use-stock"
import { PURPOSE_WORD, countedText, errorText, plural, stockTotalsText, type LocationRow } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

type Filter = "ALL" | "STORAGE" | "QC" | "SCRAP" | "DISPATCH" | "WIP"
const PLURAL: Record<string, string> = { STORAGE: "Store racks", QC: "QC bays", SCRAP: "Scrap areas", DISPATCH: "Dispatch bays", WIP: "Production floor" }

/** "2 reels and 1 lot", "2 lots", "3 reels": only the parts there are. */
function reelsAndLots(reels: number, lots: number): string {
  return [reels ? plural(reels, "reel") : "", lots ? plural(lots, "lot") : ""].filter(Boolean).join(" and ") || "Nothing"
}

export default function LocationsPage() {
  const router = useRouter()
  const single = useSinglePlant()
  const query = useLocationsOverview()
  const putAway = usePutAwayAll()
  const [filter, setFilter] = useState<Filter>("ALL")
  const [search, setSearch] = useState("")
  const [showOff, setShowOff] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [editing, setEditing] = useState<LocationRow | null | undefined>(undefined)
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const [chooseRack, setChooseRack] = useState(false)
  const [message, setMessage] = useState<{ tone: "emerald" | "rose"; text: string } | null>(null)
  const data = query.data
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.items || [])
      .filter((row) => showOff || row.active)
      .filter((row) => filter === "ALL" || String(row.purpose) === filter)
      .filter((row) => !needle || `${row.code} ${row.name} ${row.warehouse}`.toLowerCase().includes(needle))
  }, [data, filter, search, showOff])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const row of data?.items || []) if (row.active) out[String(row.purpose)] = (out[String(row.purpose)] || 0) + 1
    return out
  }, [data])
  const unassigned = data?.unassigned_materials
  const unassignedCount = (unassigned?.reels || 0) + (unassigned?.lots || 0)
  const finishedLots = data?.unassigned_finished_lots || 0
  const receiving = data?.items.find((row) => row.is_receiving_default)

  if (!single) return <PickPlant what="the locations list" />

  return (
    <div className="space-y-4" data-testid="locations-page">
      <PageHeader
        badge="Stores"
        title="Locations"
        description="Racks, bays and areas, and what sits on each. Print a rack's label and scan it to see, move or count its stock."
        actions={data ? <>
          {selecting ? (
            <>
              <button type="button" className="erp-btn-secondary !h-11" onClick={() => { setSelecting(false); setPicked([]) }}>Cancel</button>
              <Link href={`/inventory/locations/labels${picked.length ? `?ids=${picked.join(",")}` : ""}`} className="erp-btn-primary !h-11" data-testid="locations-print-picked"><Printer className="h-4 w-4" aria-hidden="true" />{picked.length ? `Print ${picked.length} label${picked.length === 1 ? "" : "s"}` : "Print all labels"}</Link>
            </>
          ) : (
            <>
              {data.can.manage ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setSelecting(true)} data-testid="locations-select"><Printer className="h-4 w-4" aria-hidden="true" />Print labels</button> : null}
              {data.can.manage ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setEditing(null)} data-testid="locations-new"><Plus className="h-4 w-4" aria-hidden="true" />New location</button> : null}
            </>
          )}
        </> : null}
      />

      {query.isLoading ? <LoadingState label="Loading locations…" /> : query.isError || !data ? <ErrorState title="Locations could not be loaded" message={errorText(query.error)} onRetry={() => void query.refetch()} /> : (
        <>
          {message ? <Notice tone={message.tone} testId="locations-message" mirror>{message.text}</Notice> : null}
          {unassignedCount ? (
            <Notice tone="amber" icon={Inbox} testId="locations-unassigned" title={`Not in any location yet: ${reelsAndLots(unassigned?.reels || 0, unassigned?.lots || 0)}`}
              action={<>
                {data.can.move ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setChooseRack(true)} data-testid="locations-put-away"><ScanLine className="h-4 w-4" aria-hidden="true" />Put away by scan</button> : null}
                {data.can.put_away_all ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setPutAwayOpen(true)} data-testid="locations-put-all"><ArchiveRestore className="h-4 w-4" aria-hidden="true" />Put all in {receiving?.name || "the RM store"}</button> : null}
              </>}>
              {stockTotalsText(unassigned?.totals) ? `In all ${stockTotalsText(unassigned?.totals)}. ` : ""}Scan a rack, then the lots on it, to file them.{finishedLots ? ` ${finishedLots} finished-goods lot${finishedLots === 1 ? "" : "s"} also have no location; dispatch files them in a dispatch bay.` : ""}
            </Notice>
          ) : finishedLots ? (
            // Material is all placed, but finished goods are not: an open job, never the green "all good".
            <Notice tone="amber" icon={Inbox} testId="locations-fg-unassigned" title={`${finishedLots} finished-goods lot${finishedLots === 1 ? "" : "s"} not in any location`}
              action={counts.DISPATCH ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setFilter("DISPATCH")} data-testid="locations-show-dispatch"><PackageSearch className="h-4 w-4" aria-hidden="true" />Show dispatch bays</button> : null}>
              Every reel and lot of material in store has a location. Dispatch files finished goods in a dispatch bay: open the bay and scan the lots on it.
            </Notice>
          ) : <Notice tone="emerald" testId="locations-all-placed">Every reel and lot in store has a location.</Notice>}

          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Filter> label="Filter by kind" value={filter} onChange={setFilter} className="min-w-0" wrap
              options={[{ value: "ALL", label: "All" }, ...(["STORAGE", "QC", "SCRAP", "DISPATCH", "WIP"] as Filter[]).filter((key) => counts[key]).map((key) => ({ value: key, label: PLURAL[key] }))]} />
            <input className={cn(fieldClass, "!h-11 w-full sm:w-60")} placeholder="Search code or name" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="locations-search" />
            <label className="inline-flex min-h-11 items-center gap-2 text-[13px] text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={showOff} onChange={(event) => setShowOff(event.target.checked)} />Show switched off</label>
          </div>

          {rows.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="locations-grid">
              {rows.map((row) => {
                const lots = row.stock.reels + row.stock.lots
                const chosen = picked.includes(row.id)
                const card = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[20px] font-black tracking-tight text-foreground">{row.code}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{row.name}</p>
                      </div>
                      {selecting ? (chosen ? <CheckSquare className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <Square className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />) : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip tone={row.purpose === "WIP" ? "violet" : row.purpose === "QC" ? "amber" : "slate"}>{PURPOSE_WORD[String(row.purpose)] || "Location"}</Chip>
                      {row.is_receiving_default ? <Chip tone="blue" icon={Warehouse}>RM store · goods inward lands here</Chip> : null}
                      {!row.active ? <Chip tone="slate">Switched off</Chip> : null}
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 text-[13px] text-foreground">
                      <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {lots ? <><b className="tabular-nums">{row.stock.reels}</b> reel{row.stock.reels === 1 ? "" : "s"} · <b className="tabular-nums">{row.stock.lots}</b> lot{row.stock.lots === 1 ? "" : "s"}</> : <span className="text-muted-foreground">Empty</span>}
                    </p>
                    {lots ? <p className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">{stockTotalsText(row.stock.totals)}{row.stock.held ? ` · ${row.stock.held} on QC hold` : ""}</p> : null}
                    <p className="mt-1 text-[12px] text-muted-foreground">{countedText(row.last_counted_at, row.last_count_approved)}</p>
                  </>
                )
                return (
                  <li key={row.id}>
                    {selecting ? (
                      <button type="button" onClick={() => setPicked(chosen ? picked.filter((id) => id !== row.id) : [...picked, row.id])} aria-pressed={chosen}
                        className={cn("block w-full rounded-2xl border bg-card p-4 text-left transition-colors", chosen ? "border-primary/60 ring-2 ring-primary/30" : "border-border hover:border-primary/40")} data-testid={`location-pick-${row.code}`}>{card}</button>
                    ) : (
                      <Link href={`/inventory/locations/${row.id}`} className={cn("block rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[var(--shadow-premium-hover)]", row.active ? "border-border" : "border-dashed border-border opacity-80")} data-testid={`location-card-${row.code}`}>{card}</Link>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : <EmptyBlock icon={MapPin} title={search || filter !== "ALL" ? "No location matches" : "No locations yet"} message={data.can.manage ? "Add the racks and areas of the store, then print their labels." : "The store has not set up its racks yet."} action={data.can.manage ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setEditing(null)}>New location</button> : null} />}

          <LocationFormSheet open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)} location={editing} onSaved={(row) => setMessage({ tone: "emerald", text: `${row.code} saved. Print its label from the location page.` })} />

          <Sheet open={putAwayOpen} onOpenChange={setPutAwayOpen} title={`Put all unplaced stock in ${receiving?.name || "the RM store"}?`} description={`${reelsAndLots(unassigned?.reels || 0, unassigned?.lots || 0)} of material with no location move to ${receiving?.name || "the RM store"}${receiving && receiving.name !== receiving.code ? ` (${receiving.code})` : ""}. QC status does not change. Finished goods stay where they are.`}
            footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setPutAwayOpen(false)}>Cancel</button><button type="button" className="erp-btn-primary !h-11" disabled={putAway.isPending} onClick={() => putAway.mutateAsync(undefined).then((result) => { setPutAwayOpen(false); setMessage({ tone: "emerald", text: result.message }) }).catch((error) => setMessage({ tone: "rose", text: errorText(error) }))} data-testid="locations-put-all-confirm">Put all away</button></>}>
            <p className="text-[13px] text-muted-foreground">Owner only. Every move is recorded with who and when; racks can be corrected later by scanning.</p>
          </Sheet>

          <Sheet open={chooseRack} onOpenChange={setChooseRack} title="Which rack are you at?" description="Open the rack, then scan the lots you put on it." testId="locations-choose-rack">
            <ul className="grid gap-2 sm:grid-cols-2">
              {(data.items || []).filter((row) => row.active && row.purpose !== "WIP" && row.purpose !== "DISPATCH").map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => router.push(`/inventory/locations/${row.id}?move=1`)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border px-3 text-left hover:border-primary/40" data-testid={`choose-rack-${row.code}`}>
                    <span className="min-w-0"><span className="block font-mono text-[15px] font-bold text-foreground">{row.code}</span><span className="block truncate text-[12px] text-muted-foreground">{row.name}</span></span>
                    <PackageSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-muted-foreground">Or scan the rack label with the phone camera: it opens the same page.</p>
          </Sheet>
        </>
      )}
    </div>
  )
}
