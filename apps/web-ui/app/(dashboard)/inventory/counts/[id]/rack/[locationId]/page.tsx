"use client"

// Phone rack count (client 2026-10-28): open a rack, keep the camera on and scan label after label. Each
// read answers at once in colour and words (found / wrong place / issued / extra), the big counter moves,
// a lot asks for its quantity on a number pad, the last scan can be undone, and "Rack done" turns what was
// not found into "not found" lines. Typing works too (iPhone, handheld scanner).

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useMemo, useRef, useState } from "react"
import { ArrowLeft, CheckCircle2, ClipboardCheck, PackagePlus, RefreshCw, RotateCcw, Scale, Search, Undo2 } from "lucide-react"

import { ContinuousScanner } from "@/components/inventory/continuous-scanner"
import { QtyKeypad } from "@/components/inventory/qty-keypad"
import { BackLink, Chip, EmptyBlock, Field, Notice, PickPlant, SegmentBar, Sheet, TONE, fieldClass } from "@/components/inventory/stock-ui"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useInventoryItems } from "@/hooks/use-inventory"
import { usePeopleVersion } from "@/hooks/use-people"
import { usePatchRack, useRack, useRackAction, useSinglePlant } from "@/hooks/use-stock"
import { RACK_STATUS, clientRef, errorCode, errorText, isWholeUnit, plural, qtyText, stockApi, timeText, unitWord, type CountEntry, type ExpectedLot, type ScanResult, type Tone, who } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

type Banner = { tone: Tone; title: string; detail?: string; entryId?: string; action?: { label: string; href?: string; onClick?: () => void } }
type QtyAsk = { code: string; title: string; unit: string; whole: boolean; hint?: string; entryId?: string; loose?: boolean; reel?: boolean; value: string }
type Loose = { open: boolean; item: string; qty: string; note: string; code: string; search: string; ref: string }
const NO_LOOSE: Loose = { open: false, item: "", qty: "", note: "", code: "", search: "", ref: "" }

export default function RackCountPage() {
  // Names arrive with the people directory, sometimes after the page first shows: show them at once.
  usePeopleVersion()
  const params = useParams<{ id: string; locationId: string }>()
  const countId = String(params.id)
  const rackKey = String(params.locationId)
  const single = useSinglePlant()
  const rackQuery = useRack(countId, rackKey)
  const patchRack = usePatchRack(countId, rackKey)
  const rackAction = useRackAction()
  const itemsQuery = useInventoryItems()
  const [banner, setBanner] = useState<Banner | null>(null)
  const [flash, setFlash] = useState<{ tone: Tone; key: number } | null>(null)
  const [ask, setAsk] = useState<QtyAsk | null>(null)
  // One idempotency key per "stock without a label" sheet: a double tap or a retry never adds the stock twice.
  const [loose, setLoose] = useState<Loose>(NO_LOOSE)
  const [savingLoose, setSavingLoose] = useState(false)
  const openLoose = (code = "") => setLoose({ ...NO_LOOSE, open: true, code, ref: clientRef("loose") })
  const [finishing, setFinishing] = useState(false)
  const [checking, setChecking] = useState(false)
  // The server's answer is written into the page at once; when the refresh after it fails the page says so.
  const [stale, setStale] = useState(false)
  const [tab, setTab] = useState<"find" | "here">("find")
  const [working, setWorking] = useState(0)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const data = rackQuery.data
  const rack = data?.rack
  const counting = Boolean(data?.count.can.count) && rack?.status !== "DONE"
  const toFind: ExpectedLot[] = useMemo(() => (data?.expected || []).filter((row) => !row.entry_id && !row.arrived_during_count), [data])
  const arrivedNow: ExpectedLot[] = useMemo(() => (data?.expected || []).filter((row) => !row.entry_id && row.arrived_during_count), [data])
  const here: CountEntry[] = data?.entries || []

  const say = useCallback((next: Banner) => {
    setBanner(next)
    setFlash({ tone: next.tone, key: Date.now() })
  }, [])

  const { refetch } = rackQuery
  const refresh = useCallback(() => {
    void refetch().then((next) => setStale(next.isError)).catch(() => setStale(true))
  }, [refetch])

  const handleResult = useCallback((result: ScanResult, code: string) => {
    if (result.rack) patchRack({ rack: result.rack, entry: result.entry })
    if (result.needs_qty && result.lot) {
      const lot = result.lot
      setAsk({
        code, unit: unitWord(lot.uom), whole: isWholeUnit(lot.uom), value: "",
        title: `${lot.code} · ${lot.item_name}`,
        hint: lot.status === "WRONG_PLACE" ? `Belongs to ${lot.expected_location?.code || "no location"}; it will be moved here when approved.` : lot.status === "ISSUED_FOUND" ? "The system says this lot was issued. Count what is here; the Owner decides." : "Count what is really here.",
      })
      setFlash({ tone: "blue", key: Date.now() })
      return
    }
    if (result.entry && result.result) say({ tone: result.result.tone, title: result.result.title, detail: result.result.detail, entryId: result.replayed ? undefined : result.entry.id })
    refresh()
  }, [refresh, say, patchRack])

  const send = useCallback((code: string, countedQty?: number) => {
    const run = async () => {
      setWorking((value) => value + 1)
      try {
        const result = await stockApi.scan(countId, { rack: rackKey, code, counted_qty: countedQty, client_ref: clientRef("count") })
        handleResult(result, code)
      } catch (error: any) {
        const kind = errorCode(error)
        const detail = error?.response?.data?.detail
        if (kind === "UNKNOWN_LABEL") {
          say({ tone: "rose", title: "Not in the system", detail: errorText(error), action: { label: "Add as stock without a label", onClick: () => openLoose(code) } })
        } else if (kind === "RACK_LABEL") {
          const scanned = String(detail?.location_id || "").toLowerCase()
          const other = scanned && data?.other_racks.find((row) => row.key === scanned)
          const thisRack = data?.rack.label || "this rack"
          const label = /\(([^)]+)\)/.exec(String(detail?.message || ""))?.[1]
          say({
            tone: "amber", title: "That is a rack label",
            detail: scanned && scanned === rackKey ? `It is the label of ${thisRack} itself. Scan the reel, coil and lot labels on it.` : other ? `${other.label} is another rack of this count. Scan the labels on ${thisRack}, or count ${other.label} next.` : `${label || "That rack"} is not part of this count. Scan the labels on ${thisRack}.`,
            action: other ? { label: `Count ${other.label}`, href: `/inventory/counts/${countId}/rack/${other.key}` } : undefined,
          })
        } else {
          say({ tone: "rose", title: "Not counted", detail: errorText(error) })
        }
      } finally {
        setWorking((value) => value - 1)
      }
    }
    queue.current = queue.current.then(run, run)
  }, [countId, rackKey, handleResult, say, data]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveAsk = async () => {
    if (!ask || ask.value === "" || !Number.isFinite(Number(ask.value))) return
    const qty = Number(ask.value)
    if (ask.entryId) {
      try {
        const entry = await stockApi.updateEntry(countId, ask.entryId, { counted_qty: qty })
        patchRack({ entry })
        say({ tone: "emerald", title: ask.reel ? "Weight saved" : "Count changed", detail: `${qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${ask.unit} on ${ask.title}` })
        refresh()
      } catch (error) {
        say({ tone: "rose", title: "Not changed", detail: errorText(error) })
      }
    } else {
      send(ask.code, qty)
    }
    setAsk(null)
  }

  const undo = async (entryId: string) => {
    try {
      const result = await stockApi.undoEntry(countId, entryId)
      patchRack({ rack: result.rack, removedEntryId: entryId })
      say({ tone: "slate", title: "Taken back", detail: "That scan is removed from the count." })
      refresh()
    } catch (error) {
      say({ tone: "rose", title: "Could not take it back", detail: errorText(error) })
    }
  }

  const items: any[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data : []).filter((item: any) => !["FINISHED_GOOD", "TOOL"].includes(String(item.type))), [itemsQuery.data])
  const scope = useMemo(() => data?.count.scope_item_ids || [], [data])
  const looseItems = useMemo(() => {
    const needle = loose.search.trim().toLowerCase()
    return items.filter((item) => (!scope.length || scope.includes(String(item.id))) && (!needle || `${item.item_code} ${item.name}`.toLowerCase().includes(needle))).slice(0, 40)
  }, [items, loose.search, scope])
  const looseItem = items.find((item) => String(item.id) === loose.item)
  const saveLoose = async () => {
    if (!looseItem || !(Number(loose.qty) > 0) || savingLoose) return
    setSavingLoose(true)
    try {
      // The sheet's key: tapping twice, or retrying after a slow answer, returns the same line.
      const result = await stockApi.addLoose(countId, { rack: rackKey, item_id: loose.item, counted_qty: Number(loose.qty), client_ref: loose.ref || clientRef("loose"), scan_code: loose.code || undefined, note: loose.note || undefined })
      if (result.rack) patchRack({ rack: result.rack, entry: result.entry })
      if (result.result && result.entry) say({ tone: "blue", title: result.result.title, detail: result.result.detail, entryId: result.entry.id })
      setLoose(NO_LOOSE)
      refresh()
    } catch (error) {
      say({ tone: "rose", title: "Not added", detail: errorText(error) })
    } finally {
      setSavingLoose(false)
    }
  }

  // "Rack done" lists what the server expects right now, never a list that may be out of date.
  const askDone = async () => {
    setFinishing(true)
    setChecking(true)
    try {
      const next = await refetch()
      setStale(next.isError)
    } finally {
      setChecking(false)
    }
  }

  const finish = async () => {
    try {
      const result = await rackAction.mutateAsync({ id: countId, rack: rackKey, action: "done" })
      setFinishing(false)
      const missing = result.marked_missing || 0
      const arrived = result.marked_arrived || 0
      say({
        tone: missing ? "amber" : "emerald", title: "Rack done",
        detail: `${missing ? `${plural(missing, "lot")} not found on this rack. The Owner sees them when the count is sent.` : "Everything expected here was found."}${arrived ? ` ${plural(arrived, "lot")} came here after counting started: left out, not missing.` : ""}`,
      })
    } catch (error) {
      say({ tone: "rose", title: "Rack not marked done", detail: errorText(error) })
    }
  }
  const reopen = async () => {
    try {
      await rackAction.mutateAsync({ id: countId, rack: rackKey, action: "reopen" })
      say({ tone: "blue", title: "Counting this rack again", detail: "The not-found lines are taken back until you mark it done again." })
    } catch (error) {
      say({ tone: "rose", title: "Could not re-open the rack", detail: errorText(error) })
    }
  }

  if (!single) return <PickPlant what="a stock count" />
  if (rackQuery.isLoading) return <LoadingState label="Opening the rack…" />
  if (!data && (rackQuery.error as any)?.response?.status === 404 && errorCode(rackQuery.error) === "COUNT_NOT_FOUND") {
    // The count itself is not there: never blame the rack.
    return (
      <div className="mx-auto max-w-xl space-y-3" data-testid="rack-count-not-found">
        <BackLink href="/inventory/stock-control?tab=counts">Stock counts & book</BackLink>
        <EmptyBlock icon={Search} title="This count does not exist in this plant" message="It may belong to another plant: check the plant at the top. Otherwise open the list of counts and pick it from there."
          action={<Link href="/inventory/stock-control?tab=counts" className="erp-btn-primary !h-11">Back to Stock counts & book</Link>} />
      </div>
    )
  }
  if (!data && (rackQuery.error as any)?.response?.status === 404) {
    // Not a connection problem: retrying cannot help, so the way out is back to the count.
    return (
      <div className="mx-auto max-w-xl space-y-3" data-testid="rack-not-in-count">
        <BackLink href={`/inventory/counts/${countId}`}>Back to the count</BackLink>
        <EmptyBlock icon={Search} title="This rack is not part of this count" message={rackKey === "unassigned" ? "This count has no bucket for stock without a location. Open the count to see its racks." : "Open the count to see its racks, or open the rack to count it in a spot count of its own."}
          action={<>
            <Link href={`/inventory/counts/${countId}`} className="erp-btn-primary !h-11">Back to the count</Link>
            {rackKey !== "unassigned" ? <Link href={`/inventory/locations/${rackKey}`} className="erp-btn-secondary !h-11">Open the rack to start a spot count</Link> : null}
          </>} />
      </div>
    )
  }
  // A failed refresh keeps the page (with the "not up to date" chip); only a rack never loaded shows the error.
  if (!data || !rack) return <ErrorState title="This rack could not be opened" message={errorText(rackQuery.error, "Check the connection and try again.")} onRetry={refresh} />

  const p = rack.progress
  const foundHere = p.found
  const total = Math.max(p.expected, foundHere)
  const status = RACK_STATUS[rack.status]
  const lastEntryId = banner?.entryId

  return (
    <div className="mx-auto max-w-5xl" data-testid="rack-count" data-no-mirror>
      <div className="sticky top-0 z-20 -mx-3 border-b border-border bg-background/90 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-b-2xl sm:border-x">
        <div className="flex items-center gap-2">
          <Link href={`/inventory/counts/${countId}`} className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to the count" data-testid="rack-back">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{data.count.kind_word} · {data.count.count_no}</p>
            <h1 className="truncate text-[20px] font-bold leading-tight tracking-tight text-foreground" data-testid="rack-code">{rack.label}{rack.name && rack.name !== rack.label ? <><span className="sr-only"> · </span><span className="ml-2 text-[14px] font-medium text-muted-foreground">{rack.name}</span></> : null}</h1>
          </div>
          <Chip tone={status.tone} testId="rack-status">{status.word}</Chip>
        </div>
        {stale || (rackQuery.isError && Boolean(data)) ? (
          <button type="button" onClick={refresh} className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-signal-amber-line bg-signal-amber-soft px-3 text-[12px] font-semibold text-signal-amber-ink" data-testid="rack-stale">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Not up to date · tap to refresh
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="space-y-3">
          <section className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-premium)]" aria-live="polite" data-testid="rack-counter">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-semibold text-muted-foreground">Found on this rack</p>
                <p className="mt-1 flex items-baseline gap-2 tabular-nums">
                  <span key={foundHere} className="text-[56px] font-bold leading-none tracking-tight text-foreground motion-safe:animate-scale-in" data-testid="rack-found">{foundHere}</span>
                  <span className="text-[20px] font-semibold text-muted-foreground">of {total}</span>
                </p>
              </div>
              {working > 0 ? <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold text-muted-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />Checking…</span> : null}
            </div>
            <SegmentBar className="mt-4 h-2.5" label={`${p.found} found, ${p.missing} not found, ${p.to_find} still to find`}
              parts={[{ value: p.found, tone: "emerald" }, { value: p.missing, tone: "rose" }, { value: p.to_find, tone: "slate" }]} />
            <dl className="mt-3 grid grid-cols-4 gap-1 text-center">
              {[["Wrong place", p.wrong_place, "amber"], ["Extra", p.extra + p.issued_found, "blue"], [rack.status === "DONE" ? "Not found" : "To find", rack.status === "DONE" ? p.missing : p.to_find, rack.status === "DONE" ? "rose" : "slate"], ["Arrived", p.arrived + arrivedNow.length, "slate"]].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-lg px-1 py-1.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
                  <dd className={cn("text-[18px] font-bold tabular-nums", TONE[tone as Tone].ink)}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {rack.status === "RECOUNT" && rack.recount_note ? <Notice tone="amber" title="The Owner asked to count this rack again">{rack.recount_note}</Notice> : null}
          {data.count.status === "SUBMITTED" ? <Notice tone="blue" title="Counting is locked">This count is waiting for the Owner. Nothing more can be scanned.</Notice> : null}
          {data.count.status !== "DRAFT" && data.count.status !== "SUBMITTED" ? <Notice tone="slate" title={`This count is ${data.count.status_word.toLowerCase()}`}>Nothing more can be counted on it.</Notice> : null}
          {rack.status === "DONE" && data.count.can.count ? (
            <Notice tone="emerald" title={`Rack done${rack.done_by ? ` by ${who(rack.done_by)}` : ""}`} action={<button type="button" className="erp-btn-secondary !h-11" onClick={reopen} disabled={rackAction.isPending} data-testid="rack-reopen"><RotateCcw className="h-4 w-4" aria-hidden="true" />Look again</button>}>
              {p.missing ? `${p.missing} not found here.` : "Everything expected here was found."} To count more on it, look again.
            </Notice>
          ) : null}

          {counting ? <ContinuousScanner onCode={(code) => send(code)} paused={Boolean(ask) || loose.open || finishing} flash={flash} testId="rack-scanner" /> : null}

          {banner ? (
            <div key={flash?.key} role="status" className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 motion-safe:animate-enter-up", TONE[banner.tone].panel)} data-testid="rack-result" data-tone={banner.tone}>
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-semibold leading-snug">{banner.title}</p>
                {banner.detail ? <p className="mt-0.5 text-[13px] leading-5 opacity-90">{banner.detail}</p> : null}
                {banner.action ? (banner.action.href
                  ? <Link href={banner.action.href} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{banner.action.label}</Link>
                  : <button type="button" onClick={banner.action.onClick} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4" data-testid="rack-result-action">{banner.action.label}</button>) : null}
              </div>
              {lastEntryId && counting ? (
                <button type="button" onClick={() => { void undo(lastEntryId); setBanner(null) }} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-foreground text-[13px] font-semibold" data-testid="rack-undo">
                  <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo
                </button>
              ) : null}
            </div>
          ) : counting ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-[13px] leading-5 text-muted-foreground">Scan each reel, coil or lot label on <b className="text-foreground">{rack.label}</b>. Reels count at their label weight (tap the weight of a reel to re-weigh it); a lot asks for the quantity you see.</p>
          ) : null}
        </div>

        <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-premium)]" data-testid="rack-lists">
          <div className="border-b border-border p-2"><div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Rack lists">
            {([["find", rack.status === "DONE" ? "Not found" : "Still to find", rack.status === "DONE" ? p.missing : toFind.length], ["here", "Counted here", here.filter((entry) => !entry.auto).length]] as const).map(([key, label, value]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition-colors", tab === key ? "bg-card text-foreground shadow-[var(--shadow-sm),0_0_0_1px_hsl(var(--border))]" : "bg-transparent text-muted-foreground hover:text-foreground")} data-testid={`rack-tab-${key}`}>
                {label}<span className={cn("rounded-full px-1.5 text-[12px] tabular-nums", tab === key ? "bg-primary/10 text-primary" : "bg-card ring-1 ring-border")}>{value}</span>
              </button>
            ))}
          </div></div>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto lg:max-h-[calc(100vh-14rem)]">
            {tab === "find" ? (
              rack.status === "DONE" ? (
                here.filter((entry) => entry.status === "MISSING").length ? here.filter((entry) => entry.status === "MISSING").map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE.rose.dot)} aria-hidden="true" />
                    <div className="min-w-0 flex-1"><p className="truncate font-mono text-[13.5px] font-semibold text-foreground">{entry.code}</p><p className="truncate text-[12.5px] text-muted-foreground">{entry.item_name}</p></div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-signal-rose-ink">{qtyText(entry.expected_qty, entry.uom)}</span>
                  </li>
                )) : <li className="p-4"><EmptyBlock icon={CheckCircle2} title="Nothing missing" message="Everything expected on this rack was found." /></li>
              ) : toFind.length || arrivedNow.length ? [...toFind, ...arrivedNow].map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid={row.arrived_during_count ? "rack-arrived-row" : "rack-expected-row"}>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", row.held ? TONE.amber.dot : TONE.slate.dot)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13.5px] font-semibold text-foreground">{row.code}</p>
                    <p className="truncate text-[12.5px] text-muted-foreground">{row.item_name}{row.held ? ` · ${row.qc_word}` : ""}</p>
                    {row.arrived_during_count ? <p className="mt-1"><Chip tone="slate">Came here after counting started · scan it if you see it</Chip></p> : null}
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{row.entity_type === "REEL" ? qtyText(row.qty, row.uom) : "Count it"}</span>
                </li>
              )) : <li className="p-4"><EmptyBlock icon={CheckCircle2} title={p.expected ? "All found" : "Nothing expected here"} message={p.expected ? "Every lot the book expects here is counted. Add anything extra, then mark the rack done." : "The book has no stock on this rack. Scan anything you see, or mark it done if it is empty."} /></li>
            ) : here.filter((entry) => !entry.auto).length ? here.filter((entry) => !entry.auto).map((entry) => (
              <li key={entry.id} className={cn("flex items-start gap-3 px-4 py-3", entry.id === lastEntryId && "bg-muted/60")} data-testid="rack-counted-row">
                <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", TONE[entry.tone].dot)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {/* The code has the whole line (a counter must read which lot it was); the result sits under it. */}
                  <p className="break-all font-mono text-[13.5px] font-semibold leading-5 text-foreground" data-testid="rack-counted-code">{entry.code || entry.item_name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><Chip tone={entry.tone}>{entry.result_word}</Chip>{entry.movement_word ? <Chip tone="violet">{entry.movement_word}</Chip> : null}</p>
                  <p className="mt-1 truncate text-[12.5px] text-muted-foreground">{entry.item_name} · {who(entry.counted_by)} · {timeText(entry.counted_at)}</p>
                </div>
                {counting && entry.status !== "MISSING" ? (
                  // A lot asks for what is there; a reel can be re-weighed (it counts at its label weight until then).
                  <button type="button" onClick={() => setAsk({
                    code: entry.code || "", title: `${entry.code || entry.item_name}`, unit: unitWord(entry.uom), whole: isWholeUnit(entry.uom), entryId: entry.id,
                    loose: entry.entity_type === "LOOSE", reel: entry.entity_type === "REEL", value: entry.entity_type === "REEL" ? "" : String(entry.counted_qty ?? ""),
                    hint: entry.entity_type === "REEL" ? `The book says ${qtyText(entry.expected_qty, entry.uom)}. Put the reel on the scale and enter what it weighs.` : undefined,
                  })} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold tabular-nums text-primary underline-offset-2 hover:underline" aria-label={entry.entity_type === "REEL" ? `Re-weigh ${entry.code}` : `Change the count of ${entry.code || entry.item_name}`} data-testid="rack-entry-qty">
                    {entry.entity_type === "REEL" ? <Scale className="h-3.5 w-3.5" aria-hidden="true" /> : null}{qtyText(entry.counted_qty, entry.uom)}
                  </button>
                ) : <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{qtyText(entry.counted_qty, entry.uom)}</span>}
                {counting ? <button type="button" onClick={() => undo(entry.id)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Take back ${entry.code || entry.item_name}`}><Undo2 className="h-4 w-4" aria-hidden="true" /></button> : null}
              </li>
            )) : <li className="p-4"><EmptyBlock icon={Search} title="Nothing counted yet" message="Scanned labels show here, newest first." /></li>}
          </ul>
        </section>
      </div>

      {counting ? (
        // Sticky, not fixed: the page wrapper animates in with a transform, which would pin a fixed bar to the page end.
        <div className="sticky bottom-0 z-30 -mx-3 mt-4 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-[var(--shadow-pop)] lg:ml-auto lg:w-fit lg:px-3">
          <div className="mx-auto flex max-w-5xl gap-2">
            <button type="button" className="erp-btn-secondary !h-12 flex-1 !rounded-xl lg:flex-none" onClick={() => openLoose()} data-testid="rack-add-loose">
              <PackagePlus className="h-4 w-4" aria-hidden="true" /> No label
            </button>
            <button type="button" className="erp-btn-primary !h-12 flex-[2] !rounded-xl lg:flex-none" onClick={() => void askDone()} data-testid="rack-done">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Rack done
            </button>
          </div>
        </div>
      ) : null}

      <Sheet open={Boolean(ask)} onOpenChange={(open) => !open && setAsk(null)} title={ask?.reel ? "Re-weigh the reel" : ask?.entryId ? "Change the count" : "How much is here?"} description={ask?.title} testId="rack-qty-sheet"
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setAsk(null)}>Cancel</button><button type="button" className="erp-btn-primary !h-11 min-w-32" disabled={!ask?.value || (Boolean(ask?.loose || ask?.reel) && !(Number(ask?.value) > 0))} onClick={saveAsk} data-testid="rack-qty-save">{ask?.reel ? "Save weight" : "Save count"}</button></>}>
        {(ask?.loose || ask?.reel) && ask.value !== "" && !(Number(ask.value) > 0) ? <Notice tone="amber" className="mb-3">{ask.reel ? "A reel on the rack weighs more than zero. If it is not here, take the scan back with Undo." : "Stock without a label needs a quantity above zero. To take the line back, use Undo."}</Notice> : null}
        {ask ? <QtyKeypad value={ask.value} onChange={(value) => setAsk({ ...ask, value })} unit={ask.unit} wholeOnly={ask.whole} hint={ask.hint} /> : null}
      </Sheet>

      <Sheet open={loose.open} onOpenChange={(open) => (open ? setLoose((current) => ({ ...current, open })) : setLoose(NO_LOOSE))} title="Stock without a label" description={loose.code ? `Label ${loose.code} is not in the system. Add what it is and how much; it is added on QC hold when the Owner approves.` : "Choose the material and enter how much is here. It is added as new stock on QC hold when the Owner approves."} testId="rack-loose-sheet" wide
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setLoose(NO_LOOSE)}>Cancel</button><button type="button" className="erp-btn-primary !h-11 min-w-32" disabled={!looseItem || !(Number(loose.qty) > 0) || savingLoose} onClick={saveLoose} data-testid="rack-loose-save">{savingLoose ? "Adding…" : "Add to the count"}</button></>}>
        <div className="space-y-3">
          <Field label="Material">
            <input className={fieldClass} placeholder="Search by name or code" value={loose.search} onChange={(event) => setLoose({ ...loose, search: event.target.value })} data-testid="rack-loose-search" />
          </Field>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-1" role="listbox" aria-label="Materials">
            {looseItems.map((item: any) => (
              <button key={item.id} type="button" role="option" aria-selected={loose.item === String(item.id)} onClick={() => setLoose({ ...loose, item: String(item.id) })}
                className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[13.5px]", loose.item === String(item.id) ? "bg-primary/10 font-semibold text-foreground ring-1 ring-primary/40" : "hover:bg-muted")}>
                <span className="min-w-0 truncate">{item.name}</span><span className="shrink-0 font-mono text-[12px] text-muted-foreground">{item.item_code}</span>
              </button>
            ))}
            {!looseItems.length ? <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">No material matches.</p> : null}
          </div>
          {looseItem ? <QtyKeypad value={loose.qty} onChange={(qty) => setLoose({ ...loose, qty })} unit={unitWord(looseItem.uom)} wholeOnly={isWholeUnit(looseItem.uom)} testId="loose-keypad" /> : null}
          <Field label="Note (optional)"><input className={fieldClass} value={loose.note} onChange={(event) => setLoose({ ...loose, note: event.target.value })} placeholder="e.g. drum without label behind the rack" /></Field>
        </div>
      </Sheet>

      <Sheet open={finishing} onOpenChange={setFinishing} title={`Mark ${rack.label} done?`} description={checking ? "Checking what the book expects on this rack now…" : toFind.length ? `${plural(toFind.length, "lot")} ${toFind.length === 1 ? "is" : "are"} not found yet. Look again, or mark ${toFind.length === 1 ? "it" : "them"} not found.` : "Everything the book expects here is counted."} testId="rack-done-sheet"
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setFinishing(false)} data-testid="rack-look-again">Look again</button><button type="button" className="erp-btn-primary !h-11" onClick={finish} disabled={rackAction.isPending || checking || stale} data-testid="rack-done-confirm">{checking ? "Checking…" : toFind.length ? `Mark ${toFind.length} not found` : "Rack done"}</button></>}>
        {stale && !checking ? <Notice tone="amber" className="mb-3" action={<button type="button" className="erp-btn-secondary !h-11" onClick={() => void askDone()}>Try again</button>}>The latest list could not be loaded. Check the connection before marking the rack done.</Notice> : null}
        {arrivedNow.length && !checking ? <Notice tone="slate" className="mb-3" title={`${plural(arrivedNow.length, "lot")} came here after counting started`}>They are left out of this rack, never marked not found.</Notice> : null}
        {checking ? <LoadingState label="Checking…" /> : toFind.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {toFind.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE.rose.dot)} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate"><b className="font-mono text-[13px]">{row.code}</b> <span className="text-[12.5px] text-muted-foreground">{row.item_name}</span></span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">{qtyText(row.qty, row.uom)}</span>
              </li>
            ))}
          </ul>
        ) : <Notice tone="emerald" title="All found">Nothing will be marked not found.</Notice>}
      </Sheet>
    </div>
  )
}
