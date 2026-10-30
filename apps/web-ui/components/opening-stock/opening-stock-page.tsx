"use client"

// Go-live opening stock (client 2026-10-30). Owner / Admin enter the stock already on the racks, in batches on the
// plant's go-live date (rack by rack over a few days, until that month is closed): reels / coils by weight, bulk
// lots by quantity, typed or pasted from Excel. The page checks every row with the server before posting, shows
// totals per item and unit, and posts once. Each reel / lot gets a new number and a QR label; it is cleared for
// the issue desks at once unless it is put on hold. Other roles see what was posted.

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle, CalendarCheck2, CheckCircle2, ClipboardPaste, Copy, Layers, Lock, PackagePlus, PauseCircle, Plus, Printer, Scale, Tags, Trash2,
} from "lucide-react"

import { BackLink, Chip, EmptyBlock, Field, Notice, Panel, PickPlant, Sheet, Stat, fieldClass } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { usePeopleVersion } from "@/hooks/use-people"
import { useLocationsOverview } from "@/hooks/use-stock"
import { dayText, errorCode, errorText, isWholeUnit, plural, qtyText, rupees, timeText, unitTotalsText, unitWord } from "@/lib/api-stock"
import { businessDate } from "@/lib/business-date"
import { personLabel } from "@/lib/people"
import { cn } from "@/lib/utils"

import { openingApi, useOpeningOverview, usePostOpening, type CheckedLine, type OpeningBatch, type OpeningOverview, type OpeningPreview } from "./api"
import { blankRow, duplicateRow, isBlank, kindOf, matchProblems, parsePaste, rowProblems, toLine, type DraftRow, type ItemOption, type PlaceOption, type RowKind } from "./rows"

const NOT_OPENING = new Set(["FINISHED_GOOD", "TOOL"])
// Places opening stock may not go (the server refuses them too): the floor, a dispatch bay, a scrap bay.
const NOT_STORE = new Set(["WIP", "DISPATCH", "SCRAP"])
/** "kg", "piece", "litre": the unit after "Rate ₹ per". */
const RATE_UNIT: Record<string, string> = { KG: "kg", PCS: "piece", NOS: "piece", L: "litre", LTR: "litre", BOX: "box", ROLL: "roll", SET: "set", PKT: "packet", BAG: "bag", DRUM: "drum" }
const rateUnit = (uom: string) => RATE_UNIT[String(uom || "").toUpperCase()] || (uom ? unitWord(uom) : "unit")
const DRAFT_KEY = (plant: string) => `hariom.opening-stock.draft.v1.${plant}`

/** The batch's request key (a UUID): a double click or a retry posts the batch once. */
function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16)
  })
}

/** "October 2026" for a YYYY-MM-DD day. */
function monthWords(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "that month"
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))
}

export function OpeningStockPage() {
  const { activePlant } = useAuth()
  const single = Boolean(activePlant && activePlant !== "ALL")
  const overview = useOpeningOverview()
  usePeopleVersion()

  if (!single) return <PickPlant what="opening stock" />
  return (
    <div className="space-y-5" data-testid="opening-stock-page">
      <BackLink href="/inventory/stock-control?tab=book">Stock counts &amp; book</BackLink>
      <PageHeader
        badge="Stores · go-live"
        title="Opening stock"
        description="The reels, coils and lots already in the plant on the day it starts on TubeOS. Each one gets a new number and a QR label, and is cleared for the floor at once unless you put it on hold."
      />
      {overview.isLoading ? <LoadingState label="Opening the go-live stock…" />
        : overview.isError || !overview.data ? <ErrorState title="Opening stock could not be loaded" message={errorText(overview.error)} onRetry={() => void overview.refetch()} />
        : <Loaded data={overview.data} plant={String(activePlant)} />}
    </div>
  )
}

function Loaded({ data, plant }: { data: OpeningOverview; plant: string }) {
  const [posted, setPosted] = useState<OpeningBatch | null>(null)
  return (
    <>
      <GoLiveStrip data={data} />
      {data.opening.state === "CLOSED" ? (
        <Notice tone="slate" icon={Lock} title="Opening stock is closed. Use a stock count to correct stock." testId="opening-closed"
          action={<Link href="/inventory/stock-control?tab=counts" className="erp-btn-secondary !h-11">Stock counts</Link>}>
          {data.opening.closed_reason || `${data.opening.month_label} is closed, so the go-live stock of ${data.opening.go_live_label} can no longer change.`} A count or a correction fixes stock from here on.
        </Notice>
      ) : null}
      {posted ? <PostedNotice batch={posted} onNext={() => setPosted(null)} /> : null}
      {data.can_post && !posted ? <EntryPanel data={data} plant={plant} onPosted={setPosted} /> : null}
      {!data.can_post && data.opening.state !== "CLOSED" ? (
        <Notice tone="blue" testId="opening-view-only">The Owner or Admin enter and post opening stock. You can see what is posted and print labels.</Notice>
      ) : null}
      <BatchList data={data} />
    </>
  )
}

function GoLiveStrip({ data }: { data: OpeningOverview }) {
  const { opening, totals } = data
  const tone = opening.state === "OPEN" ? "emerald" : opening.state === "CLOSED" ? "slate" : "blue"
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="opening-strip">
      <div className="min-w-0 rounded-xl border border-border bg-card px-3.5 py-3 sm:col-span-2 xl:col-span-1">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground"><CalendarCheck2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Go-live date</p>
        <p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground" data-testid="opening-go-live">{opening.go_live_label || (opening.state === "CLOSED" ? "Not used" : "Not set yet")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Chip tone={tone} icon={opening.state === "CLOSED" ? Lock : opening.state === "OPEN" ? CheckCircle2 : undefined} testId="opening-state">
            {opening.state === "OPEN" ? "Open for more batches" : opening.state === "CLOSED" ? "Closed" : "No batch posted yet"}
          </Chip>
        </div>
        <p className="mt-1.5 text-[12px] leading-4 text-muted-foreground">{opening.state === "NOT_STARTED" ? "The first batch you post fixes the go-live date for this plant." : opening.message}</p>
      </div>
      <Stat label="Batches posted" value={totals.batches.toLocaleString("en-IN")} icon={Layers} tone="blue" detail={totals.value > 0 ? `Value ${rupees(totals.value)}` : "No rate entered yet"} />
      <Stat label="Reels and lots" value={`${totals.reels.toLocaleString("en-IN")} · ${totals.lots.toLocaleString("en-IN")}`} icon={PackagePlus} tone="emerald" detail={`${plural(totals.reels, "reel / coil", "reels / coils")}, ${plural(totals.lots, "bulk lot")}${totals.held ? ` · ${totals.held} on hold` : ""}`} />
      <Stat label="Posted at go-live" value={totals.units.length ? unitTotalsText(totals.units) : "—"} icon={Scale} tone="violet" detail="As posted, before any issue. Kg and pieces are never added together." />
    </section>
  )
}

// ---------------------------------------------------------------- entry

type LiveCheck = { body: { effective_date: string | null; lines: ReturnType<typeof toLine>[] }; keys: string[] }

function EntryPanel({ data, plant, onPosted }: { data: OpeningOverview; plant: string; onPosted: (batch: OpeningBatch) => void }) {
  const { refetch: overviewRefetch } = useOpeningOverview()
  const itemsQuery = useInventoryItems()
  const placesQuery = useLocationsOverview()
  const post = usePostOpening()
  const fixedDay = data.opening.go_live_date
  const [day, setDay] = useState(fixedDay || data.today || businessDate())
  const [rows, setRows] = useState<DraftRow[]>(() => [blankRow("REEL")])
  const [restored, setRestored] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [postError, setPostError] = useState("")
  const [postErrorTitle, setPostErrorTitle] = useState("")
  const requestKey = useRef<string>(newKey())

  const items: ItemOption[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data : [])
    .filter((row: any) => !NOT_OPENING.has(String(row.type)) && String(row.active ?? "true") !== "false")
    .map((row: any) => ({ id: String(row.id), item_code: String(row.item_code || ""), name: String(row.name || row.item_code || ""), type: String(row.type || ""), tracking_mode: String(row.tracking_mode || "BULK"), uom: String(row.uom || "KG"), unit_cost: row.unit_cost ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name)), [itemsQuery.data])
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const places: PlaceOption[] = useMemo(() => (placesQuery.data?.items || [])
    // The production floor, dispatch and scrap bays are refused (not usable store stock).
    .filter((row) => row.active && !NOT_STORE.has(String(row.purpose || "").toUpperCase()))
    .map((row) => ({ id: row.id, code: row.code, name: row.name, active: row.active, purpose: row.purpose, is_receiving_default: row.is_receiving_default })), [placesQuery.data])
  const defaultPlace = data.default_location

  // Rows typed but not posted stay on this device (a refresh or a dropped connection loses nothing).
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY(plant)) || "null")
      if (saved && Array.isArray(saved.rows) && saved.rows.length && saved.rows.some((row: DraftRow) => !isBlank(row))) {
        setRows(saved.rows)
        if (!fixedDay && typeof saved.day === "string") setDay(saved.day)
        setRestored(true)
      }
    } catch { /* private window: nothing to restore */ }
  }, [plant, fixedDay])
  useEffect(() => {
    try {
      if (rows.some((row) => !isBlank(row))) window.localStorage.setItem(DRAFT_KEY(plant), JSON.stringify({ day, rows }))
      else window.localStorage.removeItem(DRAFT_KEY(plant))
    } catch { /* optional */ }
  }, [rows, day, plant])

  const filled = rows.filter((row) => !isBlank(row))
  // The server check runs a moment after typing stops.
  const [check, setCheck] = useState<LiveCheck | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ready = filled.filter((row) => row.item_id)
      setCheck(ready.length ? { body: { effective_date: day || null, lines: ready.map(toLine) }, keys: ready.map((row) => row.key) } : null)
    }, 450)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, day])
  const previewQuery = useQuery({
    queryKey: ["opening-stock", plant, "preview", check?.body],
    queryFn: () => openingApi.preview(check!.body),
    enabled: Boolean(check),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  })
  const preview: OpeningPreview | undefined = check ? previewQuery.data : undefined
  const checkedByKey = useMemo(() => {
    const map = new Map<string, CheckedLine>()
    if (preview && check) check.keys.forEach((key, index) => { const line = preview.lines[index]; if (line) map.set(key, line) })
    return map
  }, [preview, check])

  const localProblems = filled.map((row, index) => ({ row, index, problems: [...rowProblems(row, itemById.get(row.item_id)?.uom), ...(!row.item_id && !row.item_text ? [{ field: "item", message: "Choose the material." }] : []), ...(!row.qty.trim() ? [{ field: "qty", message: row.kind === "REEL" ? "Enter the weight in kg." : "Enter the quantity." }] : []), ...(row.on_hold && !row.hold_reason.trim() ? [{ field: "hold_reason", message: "Say why this lot is on hold." }] : [])] }))
  const errorRows = localProblems.map(({ row, index, problems }) => {
    const server = checkedByKey.get(row.key)?.errors || []
    const all = [...problems]
    for (const error of server) if (!all.some((item) => item.field === error.field)) all.push(error)
    return { row, index, problems: all }
  }).filter((entry) => entry.problems.length)
  const warnings = filled.flatMap((row, index) => [...(row.note ? [row.note] : []), ...(checkedByKey.get(row.key)?.warnings || [])].map((text) => ({ index, text })))
  const checking = Boolean(check) && (previewQuery.isFetching || !preview)
  const dateProblem = preview && !preview.date.ok ? preview.date.message : ""
  const dateWarning = preview?.date.ok ? preview.date.warning || "" : ""
  const canPost = filled.length > 0 && !errorRows.length && !dateProblem && Boolean(preview?.can_post) && !checking && filled.length === (check?.keys.length || 0)

  const update = (key: string, patch: Partial<DraftRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const remove = (key: string) => setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : [blankRow(current[0]?.kind || "REEL")]))
  // A lone empty row is replaced, so "Add bulk lot" on a fresh page does not leave an empty reel row behind.
  const add = (kind: RowKind) => setRows((current) => (current.length === 1 && isBlank(current[0]) ? [blankRow(kind)] : [...current, blankRow(kind)]))
  const duplicate = (key: string) => setRows((current) => current.flatMap((row) => (row.key === key ? [row, duplicateRow(row)] : [row])))
  const startOver = () => { setRows([blankRow("REEL")]); setRestored(false); setPostError(""); setPostErrorTitle("") }

  const doPost = async () => {
    setPostError("")
    setPostErrorTitle("")
    try {
      const batch = await post.mutateAsync({ effective_date: day, request_id: requestKey.current, notes: "Go-live opening stock", lines: filled.map(toLine) })
      requestKey.current = newKey()
      setConfirmOpen(false)
      setRows([blankRow("REEL")])
      setRestored(false)
      try { window.localStorage.removeItem(DRAFT_KEY(plant)) } catch { /* optional */ }
      onPosted(batch)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (cause) {
      if (errorCode(cause) === "OPENING_REQUEST_CHANGED") {
        // An earlier try went through (its answer was lost) and the rows changed since: nothing of these rows
        // posted. The rows stay, the posted batches reload, and the next post is a new batch with a new key.
        requestKey.current = newKey()
        setPostErrorTitle("An earlier post already went through")
        setConfirmOpen(false)  // so a second tap cannot post the same reels again before the user has looked
        void overviewRefetch()
      }
      setPostError(errorText(cause))
    }
  }

  return (
    <>
      <Panel
        testId="opening-entry"
        icon={PackagePlus}
        title={data.batches.length ? `New batch · batch ${data.batches.length + 1}` : "First batch"}
        description="One row per reel or coil (weight in kg) and one row per bulk lot (quantity in its own unit). Location is the RM store unless you choose another rack."
        action={<>
          <button type="button" className="erp-btn-secondary !h-11" onClick={() => setPasteOpen(true)} data-testid="opening-paste-open"><ClipboardPaste className="h-4 w-4" aria-hidden="true" />Paste from Excel</button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:items-end">
            {fixedDay ? (
              <div>
                <span className="text-[12.5px] font-semibold text-foreground">Go-live date</span>
                <p className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border border-border bg-muted px-3 text-[14px] font-semibold text-foreground" data-testid="opening-day-fixed"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{dayText(fixedDay)}</p>
              </div>
            ) : (
              <Field label="Go-live date" hint="The day the plant starts on TubeOS. It cannot change after the first batch.">
                <input type="date" className={fieldClass} value={day} max={data.today} onChange={(event) => setDay(event.target.value)} data-testid="opening-day" />
              </Field>
            )}
            <p className="text-[12.5px] leading-5 text-muted-foreground">{fixedDay ? `Batch 1 fixed the go-live date. More racks can be added on ${dayText(fixedDay)} until ${data.opening.month_label} is closed.` : "Enter rack by rack: post what you have, and add the next rack later as another batch on the same date."}</p>
          </div>
          {dateProblem ? <Notice tone="rose" testId="opening-date-problem">{dateProblem}</Notice> : null}
          {dateWarning ? <Notice tone="amber" testId="opening-date-warning">{dateWarning}</Notice> : null}
          {postError && postErrorTitle ? (
            <Notice tone="rose" title={postErrorTitle} testId="opening-post-changed"
              action={<a href="#opening-batches-list" className="erp-btn-secondary !h-11">See posted batches</a>}>
              {postError}
            </Notice>
          ) : null}
          {restored ? (
            <Notice tone="blue" testId="opening-restored" action={<button type="button" className="erp-btn-secondary !h-11" onClick={startOver}>Discard</button>}>
              Rows you typed earlier on this device are back. Nothing was posted yet.
            </Notice>
          ) : null}

          <RowsEditor rows={rows} items={items} itemById={itemById} places={places} defaultPlace={defaultPlace?.name || "RM store"} checked={checkedByKey}
            onChange={update} onRemove={remove} onDuplicate={duplicate} loading={itemsQuery.isLoading || placesQuery.isLoading} />

          <div className="flex flex-wrap gap-2">
            <button type="button" className="erp-btn-secondary !h-11" onClick={() => add("REEL")} data-testid="opening-add-reel"><Plus className="h-4 w-4" aria-hidden="true" />Add reel / coil</button>
            <button type="button" className="erp-btn-secondary !h-11" onClick={() => add("BULK")} data-testid="opening-add-bulk"><Plus className="h-4 w-4" aria-hidden="true" />Add bulk lot</button>
            {filled.length ? <button type="button" className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground" onClick={startOver}>Clear all rows</button> : null}
          </div>
        </div>
      </Panel>

      <ReviewPanel filled={filled} preview={preview} checking={checking} errorRows={errorRows} warnings={warnings} day={day}
        canPost={canPost} onPost={() => { setPostError(""); setConfirmOpen(true) }} />

      <PasteSheet open={pasteOpen} onOpenChange={setPasteOpen} items={items} places={places} loading={itemsQuery.isLoading || placesQuery.isLoading}
        onAdd={(pasted, replace) => { setRows((current) => [...(replace ? [] : current.filter((row) => !isBlank(row))), ...pasted]); setPasteOpen(false) }} />

      <Sheet open={confirmOpen} onOpenChange={(open) => { if (!post.isPending) setConfirmOpen(open) }} title="Post opening stock?" testId="opening-confirm"
        description={`${plural(filled.length, "row")} dated ${dayText(day)}. Posting puts them in stock at once and cannot be undone; a stock count corrects stock afterwards.`}
        footer={<>
          <button type="button" className="erp-btn-secondary !h-11" disabled={post.isPending} onClick={() => setConfirmOpen(false)}>Back</button>
          <button type="button" className="erp-btn-primary !h-11" disabled={post.isPending} onClick={doPost} data-testid="opening-confirm-post">{post.isPending ? "Posting…" : "Post opening stock"}</button>
        </>}>
        <div className="space-y-3 text-[13px]">
          {!fixedDay ? <Notice tone="amber" title={`This fixes the go-live date: ${dayText(day)}`}>Every later batch must use this date, until {monthWords(day)} is closed.</Notice> : null}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(preview?.totals.items || []).map((item) => (
              <li key={`${item.item_id}-${item.uom}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0"><b className="text-foreground">{item.item_name}</b> <span className="text-muted-foreground">· {item.reels ? plural(item.reels, "reel") : plural(item.lots, "lot")}</span></span>
                <span className="shrink-0 font-semibold tabular-nums">{qtyText(item.qty, item.uom)}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{preview ? `${plural(preview.totals.reels, "reel / coil", "reels / coils")}, ${plural(preview.totals.lots, "bulk lot")}${preview.totals.held ? `; ${preview.totals.held} on hold` : "; all cleared for the floor"}.` : null}</p>
          {postError && !postErrorTitle ? <Notice tone="rose" testId="opening-post-error">{postError}</Notice> : null}
        </div>
      </Sheet>
    </>
  )
}

/** "CK2-R2 · Checker2 rack 2": the code first, so a narrow box still shows which rack it is. */
function placeText(place: PlaceOption): string {
  const name = String(place.name || "").trim()
  return name && name !== place.code ? `${place.code} · ${name}` : place.code
}

function RowsEditor({ rows, items, itemById, places, defaultPlace, checked, onChange, onRemove, onDuplicate, loading }: {
  rows: DraftRow[]; items: ItemOption[]; itemById: Map<string, ItemOption>; places: PlaceOption[]; defaultPlace: string; checked: Map<string, CheckedLine>
  onChange: (key: string, patch: Partial<DraftRow>) => void; onRemove: (key: string) => void; onDuplicate: (key: string) => void; loading: boolean
}) {
  const reelItems = items.filter((item) => kindOf(item) === "REEL")
  const bulkItems = items.filter((item) => kindOf(item) === "BULK")
  const head = "text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground"
  // Desktop is the main use: the first line keeps what decides the stock (type, material, weight, place,
  // status) wide enough to read at 1280 with the sidebar open; marks, rate and vendor sit on the second line.
  const grid = "lg:grid-cols-[24px_120px_minmax(0,3fr)_112px_minmax(0,2fr)_104px]"
  const label = "text-[12px] font-semibold text-foreground lg:sr-only"
  // Second-line fields have no header row: their captions stay visible on desktop too, so a filled box
  // ("42") still says what it is (rate, mark, vendor).
  const caption = "text-[12px] font-semibold text-foreground lg:text-[11px] lg:font-medium lg:text-muted-foreground"
  return (
    <div className="space-y-2" data-testid="opening-rows">
      <div className={cn("hidden gap-2 px-3 lg:grid", grid)} aria-hidden="true">
        <span className={head}>#</span><span className={head}>Type</span><span className={head}>Material</span><span className={head}>Weight / qty</span>
        <span className={head}>Location</span><span className={head}>Status</span>
      </div>
      {rows.map((row, index) => {
        const item = itemById.get(row.item_id)
        const uom = row.kind === "REEL" ? "KG" : item?.uom || ""
        const server = checked.get(row.key)
        const local = rowProblems(row, uom)
        const fieldsWithError = new Set([...local, ...(server?.errors || [])].map((error) => error.field))
        const bad = (field: string) => fieldsWithError.has(field)
        const errorCls = "!border-signal-rose-line !bg-signal-rose-soft focus:!ring-signal-rose-line/40"
        const options = row.kind === "REEL" ? reelItems : bulkItems
        // A pasted name that fits several materials lists those first, so the pick is quick.
        const fits = !row.item_id && row.item_matches?.length ? items.filter((option) => row.item_matches!.includes(option.item_code || option.name)) : []
        const placeFits = !row.location_id && row.location_matches?.length ? places.filter((place) => row.location_matches!.includes(place.code)) : []
        const messages = [...local, ...(server?.errors || []).filter((error) => !local.some((item) => item.field === error.field))]
        const unitText = rateUnit(uom)
        const whole = row.kind === "BULK" && isWholeUnit(uom)
        return (
          <div key={row.key} id={`opening-row-${index + 1}`} data-testid="opening-row" className={cn("scroll-mt-24 rounded-xl border bg-card p-3", messages.length ? "border-signal-rose-line" : row.on_hold ? "border-signal-amber-line" : "border-border")}>
            <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4 lg:items-start", grid)}>
              <div className="col-span-2 flex items-center justify-between sm:col-span-4 lg:col-span-1 lg:h-11 lg:justify-start">
                <span className="text-[13px] font-bold tabular-nums text-muted-foreground">{index + 1}</span>
                <div className="flex gap-1 lg:hidden">
                  <RowActions onDuplicate={() => onDuplicate(row.key)} onRemove={() => onRemove(row.key)} index={index} />
                </div>
              </div>
              <label className="col-span-1 block">
                <span className={label}>Type</span>
                <select className={cn(fieldClass, "mt-1 lg:mt-0", bad("kind") && errorCls)} value={row.kind} aria-label={`Row ${index + 1} type`}
                  onChange={(event) => onChange(row.key, { kind: event.target.value as RowKind, item_id: item && kindOf(item) !== event.target.value ? "" : row.item_id, note: "" })}>
                  <option value="REEL">Reel / coil</option>
                  <option value="BULK">Bulk lot</option>
                </select>
              </label>
              <label className="col-span-2 block sm:col-span-3 lg:col-span-1">
                <span className={label}>Material</span>
                <select className={cn(fieldClass, "mt-1 lg:mt-0", bad("item") && errorCls)} value={row.item_id} aria-label={`Row ${index + 1} material`} aria-invalid={bad("item") || undefined} data-testid="opening-row-item"
                  title={item ? `${item.name} · ${item.item_code}` : undefined}
                  onChange={(event) => { const next = itemById.get(event.target.value); onChange(row.key, { item_id: event.target.value, item_text: "", item_matches: undefined, kind: next ? kindOf(next) : row.kind, note: "" }) }}>
                  <option value="">{loading ? "Loading materials…" : row.item_text ? `Pick for "${row.item_text}"` : "Choose material"}</option>
                  {fits.length ? (
                    <optgroup label={`Fits "${row.item_text}"`}>
                      {fits.map((option) => <option key={`fit-${option.id}`} value={option.id}>{option.name} · {option.item_code}</option>)}
                    </optgroup>
                  ) : null}
                  {(item && !options.includes(item) ? [item, ...options] : options).map((option) => <option key={option.id} value={option.id}>{option.name} · {option.item_code}</option>)}
                </select>
              </label>
              <label className="col-span-1 block">
                <span className={label}>{row.kind === "REEL" ? "Weight" : "Quantity"}</span>
                <span className="relative mt-1 block lg:mt-0">
                  <input className={cn(fieldClass, "pr-11 tabular-nums", bad("qty") && errorCls)} inputMode={whole ? "numeric" : "decimal"} value={row.qty} placeholder={row.kind === "REEL" ? "Weight" : "Qty"} aria-label={`Row ${index + 1} ${row.kind === "REEL" ? "weight in kg" : "quantity"}`} data-testid="opening-row-qty"
                    onChange={(event) => onChange(row.key, { qty: event.target.value.replace(/[^\d.]/g, "") })} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12.5px] text-muted-foreground">{uom ? unitWord(uom) : ""}</span>
                </span>
              </label>
              <label className="col-span-2 block sm:col-span-2 lg:col-span-1">
                <span className={label}>Location</span>
                <select className={cn(fieldClass, "mt-1 lg:mt-0", bad("location") && errorCls)} value={row.location_id} aria-label={`Row ${index + 1} location`} aria-invalid={bad("location") || undefined}
                  onChange={(event) => onChange(row.key, { location_id: event.target.value, location_text: "", location_matches: undefined })}>
                  <option value="">{row.location_text ? `Pick for "${row.location_text}"` : `${defaultPlace} (default)`}</option>
                  {placeFits.length ? (
                    <optgroup label={`Fits "${row.location_text}"`}>
                      {placeFits.map((place) => <option key={`fit-${place.id}`} value={place.id}>{placeText(place)}</option>)}
                    </optgroup>
                  ) : null}
                  {places.filter((place) => !place.is_receiving_default).map((place) => <option key={place.id} value={place.id}>{placeText(place)}</option>)}
                </select>
              </label>
              <div className="col-span-2 sm:col-span-2 lg:col-span-1">
                <span className={label}>Status</span>
                <button type="button" role="switch" aria-checked={row.on_hold} aria-label={`Row ${index + 1}: ${row.on_hold ? "on hold" : "cleared"}. Tap to ${row.on_hold ? "clear" : "put on hold"}.`} data-testid="opening-row-hold"
                  onClick={() => onChange(row.key, { on_hold: !row.on_hold })}
                  className={cn("mt-1 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border px-2 text-[13px] font-semibold transition-colors lg:mt-0", row.on_hold ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink")}>
                  {row.on_hold ? <PauseCircle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {row.on_hold ? "On hold" : "Cleared"}
                </button>
              </div>
            </div>
            <div className={cn("mt-2 grid grid-cols-2 gap-2 lg:pl-[32px]", row.on_hold
              ? "lg:grid-cols-[minmax(0,0.9fr)_120px_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_92px]"
              : "lg:grid-cols-[minmax(0,0.9fr)_120px_minmax(0,1.2fr)_minmax(0,1fr)_92px]")}>
              <label className="col-span-1 block">
                <span className={caption}>Old mark</span>
                <input className={cn(fieldClass, "mt-1 text-[13px] lg:mt-0.5")} value={row.old_mark} maxLength={120} placeholder="Old no. / mark" aria-label={`Row ${index + 1} old reel number or mark`} onChange={(event) => onChange(row.key, { old_mark: event.target.value })} />
              </label>
              <label className="col-span-1 block">
                <span className={caption}>Rate ₹ per {unitText}</span>
                <input className={cn(fieldClass, "mt-1 text-[13px] tabular-nums lg:mt-0.5", bad("rate") && errorCls)} inputMode="decimal" value={row.rate} placeholder={item?.unit_cost ? `₹${item.unit_cost} / ${unitText}` : `Rate ₹ / ${unitText}`} aria-label={`Row ${index + 1} rate per ${unitText}`} onChange={(event) => onChange(row.key, { rate: event.target.value.replace(/[^\d.]/g, "") })} />
              </label>
              <label className="col-span-2 block sm:col-span-1">
                <span className={caption}>Vendor</span>
                <input className={cn(fieldClass, "mt-1 text-[13px] lg:mt-0.5")} value={row.vendor_name} maxLength={200} placeholder="Vendor (optional)" aria-label={`Row ${index + 1} vendor`} onChange={(event) => onChange(row.key, { vendor_name: event.target.value })} />
              </label>
              <label className="col-span-2 block sm:col-span-1">
                <span className={caption}>Vendor ref</span>
                <input className={cn(fieldClass, "mt-1 text-[13px] lg:mt-0.5")} value={row.vendor_ref} maxLength={120} placeholder="Vendor ref / bill" aria-label={`Row ${index + 1} vendor reference`} onChange={(event) => onChange(row.key, { vendor_ref: event.target.value })} />
              </label>
              {row.on_hold ? (
                <label className="col-span-2 block lg:col-span-1">
                  <span className={caption}>Why on hold</span>
                  <input className={cn(fieldClass, "mt-1 text-[13px] lg:mt-0.5", bad("hold_reason") && errorCls)} value={row.hold_reason} maxLength={300} placeholder="Why on hold? (needed)" aria-label={`Row ${index + 1} reason for the hold`} aria-invalid={bad("hold_reason") || undefined} data-testid="opening-row-hold-reason" onChange={(event) => onChange(row.key, { hold_reason: event.target.value })} />
                </label>
              ) : null}
              {/* Duplicate / remove sit at the end of the second line on desktop, so the material gets the room. */}
              <div className="hidden items-end justify-end gap-1 lg:flex">
                <RowActions onDuplicate={() => onDuplicate(row.key)} onRemove={() => onRemove(row.key)} index={index} />
              </div>
            </div>
            {messages.length || row.note || server?.warnings.length ? (
              <ul className="mt-2 space-y-1 text-[12.5px] leading-5 lg:pl-[32px]">
                {messages.map((error) => <li key={`${error.field}-${error.message}`} className="flex gap-1.5 text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error.message}</li>)}
                {[...(row.note ? [row.note] : []), ...(server?.warnings || [])].map((text) => <li key={text} className="flex gap-1.5 text-signal-amber-ink"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{text}</li>)}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function RowActions({ onDuplicate, onRemove, index }: { onDuplicate: () => void; onRemove: () => void; index: number }) {
  const cls = "grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return <>
    <button type="button" className={cls} onClick={onDuplicate} aria-label={`Duplicate row ${index + 1}`} title="Duplicate row"><Copy className="h-4 w-4" aria-hidden="true" /></button>
    <button type="button" className={cls} onClick={onRemove} aria-label={`Remove row ${index + 1}`} title="Remove row"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
  </>
}

function ReviewPanel({ filled, preview, checking, errorRows, warnings, day, canPost, onPost }: {
  filled: DraftRow[]; preview: OpeningPreview | undefined; checking: boolean; errorRows: Array<{ row: DraftRow; index: number; problems: Array<{ field: string; message: string }> }>
  warnings: Array<{ index: number; text: string }>; day: string; canPost: boolean; onPost: () => void
}) {
  const totals = preview?.totals
  return (
    <Panel testId="opening-review" icon={Scale} title="Review before posting" description={`Totals of this batch, dated ${dayText(day) || "—"}. Kilograms and pieces are kept apart.`}>
      {!filled.length ? <EmptyBlock icon={PackagePlus} title="No rows yet" message="Add reels and lots above, or paste them from Excel." /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Reels / coils" value={(totals?.reels ?? 0).toLocaleString("en-IN")} icon={Layers} tone="blue" testId="opening-review-reels" />
            <Stat label="Bulk lots" value={(totals?.lots ?? 0).toLocaleString("en-IN")} icon={PackagePlus} tone="emerald" testId="opening-review-lots" />
            <Stat label="On hold" value={(totals?.held ?? 0).toLocaleString("en-IN")} icon={PauseCircle} tone={totals?.held ? "amber" : "slate"} detail={totals?.held ? "Incoming QC clears these before use." : "Everything is cleared for the floor."} testId="opening-review-held" />
          </div>
          {totals?.items.length ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]" data-testid="opening-review-items">
                <thead className="bg-muted text-left text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
                  <tr><th className="px-3 py-2">Material</th><th className="hidden px-3 py-2 sm:table-cell">Reels / lots</th><th className="px-3 py-2 text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {totals.items.map((item) => (
                    <tr key={`${item.item_id}-${item.uom}`}>
                      <td className="px-3 py-2"><span className="font-semibold text-foreground">{item.item_name}</span><span className="block text-[12px] text-muted-foreground">{item.item_code}<span className="sm:hidden"> · {item.reels ? plural(item.reels, "reel") : plural(item.lots, "lot")}</span></span></td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{item.reels ? plural(item.reels, "reel / coil", "reels / coils") : plural(item.lots, "lot")}{item.held ? ` · ${item.held} on hold` : ""}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{qtyText(item.qty, item.uom)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[hsl(var(--surface-2))]">
                  {totals.units.map((unit) => (
                    <tr key={unit.uom} data-testid={`opening-review-unit-${unit.uom}`}>
                      {/* Same visible columns as the rows above: one label cell on a phone, two on a wider screen. */}
                      <td className="px-3 py-2 font-semibold sm:hidden">Total in {unitWord(unit.uom)}</td>
                      <td className="hidden px-3 py-2 font-semibold sm:table-cell" colSpan={2}>Total in {unitWord(unit.uom)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{qtyText(unit.qty, unit.uom)}</td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          ) : checking ? <LoadingState label="Checking the rows…" /> : null}
          {errorRows.length ? (
            <div role="alert" tabIndex={-1} data-no-mirror="" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3.5 py-3 text-[13px] text-signal-rose-ink" data-testid="opening-review-errors">
              <p className="font-semibold">Fix {plural(errorRows.length, "row")} before posting</p>
              <ul className="mt-1 space-y-0.5">
                {errorRows.slice(0, 8).map(({ index, problems }) => <li key={index}><a href={`#opening-row-${index + 1}`} className="underline underline-offset-2">Row {index + 1}</a>: {problems.map((problem) => problem.message).join(" ")}</li>)}
              </ul>
            </div>
          ) : null}
          {warnings.length ? (
            <div data-no-mirror="" className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3.5 py-3 text-[13px] text-signal-amber-ink" data-testid="opening-review-warnings">
              <p className="font-semibold">{plural(warnings.length, "thing", "things")} to check (you can still post)</p>
              <ul className="mt-1 space-y-0.5">
                {warnings.slice(0, 10).map(({ index, text }) => <li key={`${index}-${text}`}><a href={`#opening-row-${index + 1}`} className="underline underline-offset-2">Row {index + 1}</a>: {text}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12.5px] text-muted-foreground">{checking ? "Checking the rows with the server…" : canPost ? "Everything is checked. Posting is all or nothing: every row posts, or none." : errorRows.length ? "Rows in red need a fix." : "Waiting for the check."}</p>
            <button type="button" className="erp-btn-primary !h-12 sm:min-w-[220px]" disabled={!canPost} onClick={onPost} data-testid="opening-post">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Post opening stock ({plural(filled.length, "row")})
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function PasteSheet({ open, onOpenChange, items, places, loading, onAdd }: {
  open: boolean; onOpenChange: (open: boolean) => void; items: ItemOption[]; places: PlaceOption[]; loading: boolean; onAdd: (rows: DraftRow[], replace: boolean) => void
}) {
  const [text, setText] = useState("")
  const parsed = useMemo(() => parsePaste(text, items, places), [text, items, places])
  const unmatched = parsed.filter((row) => matchProblems(row).length).length
  const badNumbers = parsed.filter((row) => !matchProblems(row).length && rowProblems(row).length).length
  useEffect(() => { if (!open) setText("") }, [open])
  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide title="Paste from Excel" testId="opening-paste"
      description="Copy the rows in Excel and paste them here. Columns in this order: item code or name, type (reel / coil / bulk), weight or qty, location, old mark, vendor, rate. A header row is skipped."
      footer={<>
        <button type="button" className="erp-btn-secondary !h-11" onClick={() => onAdd(parsed, true)} disabled={!parsed.length || loading}>Replace rows</button>
        <button type="button" className="erp-btn-primary !h-11" onClick={() => onAdd(parsed, false)} disabled={!parsed.length || loading} data-testid="opening-paste-add">{loading ? "Loading materials…" : `Add ${plural(parsed.length, "row")}`}</button>
      </>}>
      <div className="space-y-3">
        <textarea className={cn(fieldClass, "!h-48 py-2 font-mono text-[12.5px]")} value={text} onChange={(event) => setText(event.target.value)} aria-label="Rows copied from Excel" data-testid="opening-paste-text"
          placeholder={"KRAFT-120\treel\t812.5\tRM-A-01\tOLD-77\tShree Mills\t42\nGLUE-PVA\tbulk\t120\t\t\t\t85"} />
        {loading ? <Notice tone="blue" testId="opening-paste-loading">Loading the materials and locations of this plant, so the rows can be matched…</Notice> : parsed.length ? (
          <Notice tone={unmatched || badNumbers ? "amber" : "emerald"} testId="opening-paste-summary">
            {plural(parsed.length, "row")} read
            {unmatched ? `; ${plural(unmatched, "row")} with a material or location that matched nothing or several` : "; every material and location matched"}
            {badNumbers ? `; ${plural(badNumbers, "row")} with a quantity or rate to fix` : ""}
            {unmatched || badNumbers ? ". They come in red; pick or correct them before posting." : "."}
          </Notice>
        ) : null}
      </div>
    </Sheet>
  )
}

function PostedNotice({ batch, onNext }: { batch: OpeningBatch; onNext: () => void }) {
  const labels = batch.labels?.length ?? batch.line_count
  return (
    <Notice tone="emerald" title={`${batch.idempotent ? "Already posted" : "Posted"}: ${batch.batch_no ? `batch ${batch.batch_no} · ` : ""}${batch.document_no}`} testId="opening-posted"
      action={<>
        <Link href={`/inventory/opening-stock/labels?batch=${encodeURIComponent(batch.id)}`} className="erp-btn-primary !h-11" data-testid="opening-print-all"><Printer className="h-4 w-4" aria-hidden="true" />Print all {plural(labels, "label")}</Link>
        <button type="button" className="erp-btn-secondary !h-11" onClick={onNext} data-testid="opening-next-batch">Enter the next rack</button>
      </>}>
      {plural(batch.reel_count, "reel / coil", "reels / coils")} and {plural(batch.lot_count, "bulk lot")} are in stock from {dayText(batch.effective_date)} ({unitTotalsText(batch.units)}){batch.held_count ? `; ${batch.held_count} on hold for incoming QC` : ", cleared for the floor"}. Stick a label on each before it moves.
    </Notice>
  )
}

function BatchList({ data }: { data: OpeningOverview }) {
  return (
    <Panel testId="opening-batches" icon={Tags} title="Posted batches" description="What is already in stock from go-live, newest first. Labels can be printed again any time.">
      {!data.batches.length ? <EmptyBlock icon={Layers} title="Nothing posted yet" message="The first batch you post shows here with its labels." /> : (
        <ul className="scroll-mt-24 space-y-3" id="opening-batches-list">
          {data.batches.map((batch) => (
            <li key={batch.id} className="rounded-xl border border-border bg-card p-3.5" data-testid="opening-batch">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-foreground">Batch {batch.batch_no} <span className="font-mono text-[12.5px] font-medium text-muted-foreground">· {batch.document_no}</span></p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">Dated {dayText(batch.effective_date)} · posted by <b className="font-semibold text-foreground">{personLabel(batch.created_by)}</b>{batch.created_at ? ` on ${timeText(batch.created_at)}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {batch.reel_count ? <Chip tone="blue">{plural(batch.reel_count, "reel / coil", "reels / coils")}</Chip> : null}
                    {batch.lot_count ? <Chip tone="emerald">{plural(batch.lot_count, "bulk lot")}</Chip> : null}
                    {batch.held_count ? <Chip tone="amber" icon={PauseCircle}>{batch.held_count} on hold</Chip> : null}
                    <Chip tone="slate">{unitTotalsText(batch.units) || "—"}</Chip>
                    {batch.value > 0 ? <Chip tone="violet">{rupees(batch.value)}</Chip> : null}
                  </div>
                </div>
                <Link href={`/inventory/opening-stock/labels?batch=${encodeURIComponent(batch.id)}`} className="erp-btn-secondary !h-11 shrink-0" data-testid="opening-batch-labels"><Printer className="h-4 w-4" aria-hidden="true" />Labels ({batch.line_count})</Link>
              </div>
              {batch.items.length ? (
                <details className="group mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-[12.5px] font-semibold text-primary">Show {plural(batch.items.length, "material")}</summary>
                  <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-[13px]">
                    {batch.items.map((item) => (
                      <li key={`${item.item_id}-${item.uom}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0 truncate">{item.item_name} <span className="text-muted-foreground">· {item.reels ? plural(item.reels, "reel") : plural(item.lots, "lot")}</span></span>
                        <span className="shrink-0 font-semibold tabular-nums">{qtyText(item.qty, item.uom)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
