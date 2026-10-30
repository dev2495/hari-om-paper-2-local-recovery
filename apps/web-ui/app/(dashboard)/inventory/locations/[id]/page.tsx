"use client"

// Location page (client 2026-10-28): where a rack QR lands for every role. The rack's stock (reels and lots
// with their QC state), and what this login may do here: move stock here by scanning, count this rack
// (joins an open count or starts a spot count), raise a correction, print the label, edit or switch off.

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"
import { ArrowRightLeft, ClipboardCheck, FlaskConical, MapPinOff, MoreHorizontal, PackageOpen, Pencil, Power, Printer, Truck, Warehouse, Wrench } from "lucide-react"

import { CorrectionSheet } from "@/components/inventory/correction-sheet"
import { LocationFormSheet } from "@/components/inventory/location-form-sheet"
import { MoveHere } from "@/components/inventory/move-here"
import { BackLink, Chip, EmptyBlock, Notice, PickPlant, Sheet } from "@/components/inventory/stock-ui"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useLocation, useSinglePlant, useStartCount, useUpdateLocation } from "@/hooks/use-stock"
import { PURPOSE_WORD, countedText, daysHere, errorText, qtyText, stockTotalsText, who, type LotRow } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

export default function LocationDetailPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening the location…" />}>
      <LocationDetail />
    </Suspense>
  )
}

function LocationDetail() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const single = useSinglePlant()
  const query = useLocation(params.id)
  const startCount = useStartCount()
  const update = useUpdateLocation()
  const [moving, setMoving] = useState(search.get("move") === "1")
  const [correcting, setCorrecting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [more, setMore] = useState(false)
  const [message, setMessage] = useState<{ tone: "emerald" | "rose"; text: string } | null>(null)
  const data = query.data
  const rows: LotRow[] = useMemo(() => [...(data?.stock.reels || []), ...(data?.stock.lots || [])], [data])
  const held = rows.filter((row) => row.held).length

  if (!single) return <PickPlant what="this location" />
  if (query.isLoading) return <LoadingState label="Opening the location…" />
  if (!data && [404, 422].includes((query.error as any)?.response?.status)) {
    // Not a connection problem (an unknown or mistyped link): retrying cannot help, so the way out is the list.
    return (
      <div className="mx-auto max-w-xl space-y-3" data-testid="location-not-found">
        <BackLink href="/inventory/locations">Locations</BackLink>
        <EmptyBlock icon={MapPinOff} title="This location does not exist" message="The link may be wrong, or the location belongs to another plant: check the plant at the top. Otherwise open Locations and pick it from the list."
          action={<Link href="/inventory/locations" className="erp-btn-primary !h-11">Back to Locations</Link>} />
      </div>
    )
  }
  if (!data) return <ErrorState title="This location could not be opened" message={errorText(query.error, "It may belong to another plant. Check the plant at the top.")} onRetry={() => void query.refetch()} />

  const { location, can } = data
  const openCount = data.open_counts.find((row) => row.status === "DRAFT")
  const countRack = async () => {
    try {
      const count = await startCount.mutateAsync({ kind: "SPOT", location_ids: [location.id], join_open: true })
      router.push(`/inventory/counts/${count.id}/rack/${location.id}`)
    } catch (error) {
      setMessage({ tone: "rose", text: errorText(error) })
    }
  }
  const toggleActive = async (active: boolean) => {
    try {
      await update.mutateAsync({ id: location.id, body: { active } })
      setMore(false)
      setMessage({ tone: "emerald", text: active ? `${location.code} is switched on.` : `${location.code} is switched off. It stays in history and can be switched on again.` })
    } catch (error) {
      setMore(false)
      setMessage({ tone: "rose", text: errorText(error) })
    }
  }
  const makeDefault = async () => {
    try {
      await update.mutateAsync({ id: location.id, body: { is_receiving_default: true } })
      setMore(false)
      setMessage({ tone: "emerald", text: `Goods inward now puts stock in ${location.code} by default.` })
    } catch (error) {
      setMore(false)
      setMessage({ tone: "rose", text: errorText(error) })
    }
  }
  const brief = { id: location.id, code: location.code, name: location.name, purpose: location.purpose, active: location.active, is_receiving_default: location.is_receiving_default }
  const canCount = location.active && location.purpose !== "WIP"
  const canMoveHere = can.move && location.active && location.purpose !== "WIP"
  const hasMore = can.manage || can.correct
  const canPrintLots = can.manage || can.move
  const movingNow = moving && canMoveHere
  const switchOffBlock = !location.active ? "" : location.is_receiving_default
    ? "Goods inward lands here. Make another rack the RM store first."
    : rows.length ? `Holds ${[data.stock.reels.length ? `${data.stock.reels.length} reel${data.stock.reels.length === 1 ? "" : "s"}` : "", data.stock.lots.length ? `${data.stock.lots.length} lot${data.stock.lots.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}. Move them to another rack first.` : ""

  return (
    <div className="space-y-4" data-testid="location-page">
      <BackLink href="/inventory/locations">Locations</BackLink>
      <header className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-premium)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{location.warehouse}</p>
            <h1 className="mt-0.5 break-all font-mono text-[34px] font-black leading-none tracking-tight text-foreground sm:text-[40px]" data-testid="location-code">{location.code}</h1>
            {location.name && location.name !== location.code ? <p className="mt-1.5 text-[16px] font-semibold text-foreground">{location.name}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone={location.purpose === "WIP" ? "violet" : location.purpose === "QC" ? "amber" : "slate"}>{PURPOSE_WORD[String(location.purpose)] || "Location"}</Chip>
              {location.is_receiving_default ? <Chip tone="blue" icon={Warehouse}>RM store · goods inward lands here</Chip> : null}
              {!location.active ? <Chip tone="slate">Switched off</Chip> : null}
            </div>
          </div>
          <div className="hidden flex-wrap gap-2 lg:flex">
            {canMoveHere && !movingNow ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setMoving(true)} data-testid="location-move"><ArrowRightLeft className="h-4 w-4" aria-hidden="true" />Move stock here</button> : null}
            {canCount ? <button type="button" className={cn(canMoveHere ? "erp-btn-secondary" : "erp-btn-primary", "!h-11")} onClick={countRack} disabled={startCount.isPending} data-testid="location-count"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Count this rack</button> : null}
            {can.correct ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setCorrecting(true)} data-testid="location-correct"><Wrench className="h-4 w-4" aria-hidden="true" />Raise correction</button> : null}
            {can.manage ? <Link href={`/inventory/locations/labels?ids=${location.id}`} className="erp-btn-secondary !h-11" data-testid="location-print"><Printer className="h-4 w-4" aria-hidden="true" />Print label</Link> : null}
            {can.manage ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => setMore(true)} aria-label="More actions"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></button> : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2"><dt className="text-[11.5px] font-semibold text-muted-foreground">Reels &amp; coils</dt><dd className="text-[20px] font-bold tabular-nums text-foreground">{data.stock.reels.length}</dd></div>
          <div className="rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2"><dt className="text-[11.5px] font-semibold text-muted-foreground">Lots</dt><dd className="text-[20px] font-bold tabular-nums text-foreground">{data.stock.lots.length}</dd></div>
          <div className="col-span-2 rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2"><dt className="text-[11.5px] font-semibold text-muted-foreground">On this {location.purpose === "STORAGE" ? "rack" : "location"}</dt><dd className="truncate text-[15px] font-bold tabular-nums text-foreground">{stockTotalsText(data.totals) || "Nothing"}</dd><dd className="text-[12px] text-muted-foreground">{countedText(data.last_counted_at, data.last_count_approved)}{held ? ` · ${held} on QC hold` : ""}</dd></div>
        </dl>
      </header>

      {message ? <Notice tone={message.tone} testId="location-message" mirror>{message.text}</Notice> : null}
      {data.open_counts.length ? (
        <Notice tone="blue" title={`In ${data.open_counts.length === 1 ? "a count" : `${data.open_counts.length} counts`} now`} testId="location-open-count"
          action={openCount ? <Link href={`/inventory/counts/${openCount.id}/rack/${location.id}`} className="erp-btn-secondary !h-11">Count this rack</Link> : <Link href={`/inventory/counts/${data.open_counts[0].id}`} className="erp-btn-secondary !h-11">Open the count</Link>}>
          {data.open_counts.map((row) => `${row.kind === "MONTH_END" ? "Month-end" : "Spot"} count ${row.count_no}: ${row.status === "SUBMITTED" ? "waiting for the Owner" : row.rack_status === "DONE" ? "this rack is done" : row.counted_by ? `counting by ${row.counted_by.split(", ").map(who).join(", ")}` : "not started on this rack"}`).join(" · ")}
        </Notice>
      ) : null}
      {location.purpose === "WIP" ? <Notice tone="violet" title="Production floor">Stock reaches the floor only through the issue desks and is used there. Nothing is moved here or back from here.</Notice> : null}
      {held && can.inspect ? <Notice tone="amber" icon={FlaskConical} title={`${held} lot${held === 1 ? "" : "s"} here waiting for QC`} action={<Link href="/quality/incoming" className="erp-btn-secondary !h-11">Open incoming QC</Link>}>QC status stays the same when a lot is moved.</Notice> : null}

      {movingNow ? <MoveHere location={brief} onClose={() => { setMoving(false); void query.refetch() }} /> : null}

      <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-premium)]" data-testid="location-stock">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[14.5px] font-semibold text-foreground">What is here</h2>
          {can.issue && rows.some((row) => row.qc_word === "Cleared") ? <Link href="/inventory/reels/issue" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-primary"><Truck className="h-4 w-4" aria-hidden="true" />Issue desk</Link> : null}
        </header>
        {rows.length ? (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid="location-lot">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", row.held ? "bg-signal-amber-ink" : row.stock_status === "UNRESTRICTED" ? "bg-signal-emerald-ink" : "bg-muted-foreground")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13.5px] font-semibold text-foreground">{row.code}</span><Chip tone={row.held ? "amber" : row.stock_status === "UNRESTRICTED" ? "emerald" : "slate"}>{row.qc_word}</Chip></p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{row.item_name}{row.physical_form ? ` · ${row.physical_form === "COIL" ? "coil" : "reel"}` : ""} · {daysHere(row.here_since || row.in_since)}</p>
                </div>
                <span className="shrink-0 text-[14px] font-bold tabular-nums text-foreground">{qtyText(row.qty, row.uom)}</span>
                {canPrintLots ? <Link href={`/inventory/locations/lot-labels?ids=${row.id}`} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Print the label of ${row.code}`} title="Print its label" data-testid="location-lot-print"><Printer className="h-4 w-4" aria-hidden="true" /></Link> : null}
              </li>
            ))}
          </ul>
        ) : <div className="p-4"><EmptyBlock icon={PackageOpen} title="Nothing here" message={can.move && location.purpose !== "WIP" ? "Tap Move stock here and scan the lots you put on this rack." : "The book shows no stock at this location."} /></div>}
      </section>

      {/* Phone action bar: hidden while moving (the move panel has its own Done), and only buttons this role can use. */}
      {!movingNow && (canMoveHere || canCount || hasMore) ? (
        <div className="sticky bottom-0 z-30 -mx-3 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border lg:hidden">
          <div className="flex gap-2">
            {canMoveHere ? <button type="button" className="erp-btn-primary !h-12 flex-1 !rounded-xl" onClick={() => setMoving(true)} data-testid="location-move-phone"><ArrowRightLeft className="h-4 w-4" aria-hidden="true" />Move here</button> : null}
            {canCount ? <button type="button" className={cn(canMoveHere ? "erp-btn-secondary" : "erp-btn-primary", "!h-12 flex-1 !rounded-xl")} onClick={countRack} disabled={startCount.isPending} data-testid="location-count-phone"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />{canMoveHere ? "Count" : "Count this rack"}</button> : null}
            {hasMore ? <button type="button" className="erp-btn-secondary !h-12 !w-12 shrink-0 !rounded-xl !px-0" onClick={() => setMore(true)} aria-label="More actions" data-testid="location-more-phone"><MoreHorizontal className="h-5 w-5" aria-hidden="true" /></button> : null}
          </div>
        </div>
      ) : null}

      <Sheet open={more} onOpenChange={setMore} title={location.code} description={location.name}>
        <div className="grid gap-2">
          {can.correct ? <button type="button" className="erp-btn-secondary !h-12 !justify-start" onClick={() => { setMore(false); setCorrecting(true) }}><Wrench className="h-4 w-4" aria-hidden="true" />Raise a correction</button> : null}
          {can.manage ? <Link href={`/inventory/locations/labels?ids=${location.id}`} className="erp-btn-secondary !h-12 !justify-start"><Printer className="h-4 w-4" aria-hidden="true" />Print label</Link> : null}
          {can.manage ? <button type="button" className="erp-btn-secondary !h-12 !justify-start" onClick={() => { setMore(false); setEditing(true) }} data-testid="location-edit"><Pencil className="h-4 w-4" aria-hidden="true" />Edit name or code</button> : null}
          {can.manage && location.active && !location.is_receiving_default && ["STORAGE", "QC"].includes(String(location.purpose || "STORAGE")) ? <button type="button" className="erp-btn-secondary !h-12 !justify-start" onClick={makeDefault}><Warehouse className="h-4 w-4" aria-hidden="true" />Make this the RM store (goods inward lands here)</button> : null}
          {can.manage ? (
            // A location holding stock (or the RM store) cannot be switched off: say why instead of a refusal later.
            <div>
              <button type="button" className="erp-btn-secondary !h-12 w-full !justify-start" onClick={() => toggleActive(!location.active)} disabled={Boolean(switchOffBlock)} aria-describedby={switchOffBlock ? "location-toggle-why" : undefined} data-testid="location-toggle"><Power className="h-4 w-4" aria-hidden="true" />{location.active ? "Switch off" : "Switch on"}</button>
              {switchOffBlock ? <p id="location-toggle-why" className="mt-1.5 px-1 text-[12.5px] leading-5 text-muted-foreground" data-testid="location-toggle-why">{switchOffBlock}</p> : null}
            </div>
          ) : null}
        </div>
      </Sheet>
      <CorrectionSheet open={correcting} onOpenChange={setCorrecting} location={brief} />
      <LocationFormSheet open={editing} onOpenChange={setEditing} location={location} onSaved={(row) => setMessage({ tone: "emerald", text: `${row.code} saved.` })} />
    </div>
  )
}
