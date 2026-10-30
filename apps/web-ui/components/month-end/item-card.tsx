"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ChevronRight, Flag, Link2Off, LoaderCircle } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useSaveMonthNote } from "@/hooks/use-month-end"
import { describeApiError } from "@/lib/api-error"
import { dayTimeText, gapWords, notePlaceholder, personText, qty, storeChangeWords, type MonthEndItem, type MonthEndOverview } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

import { Figure, GapMeter, SoFarLimit, StatusPill, itemTone, toneEdge } from "./parts"

/** The main sentence of a card, in the item's own unit. */
export function mainSentence(item: MonthEndItem, view: MonthEndOverview): { text: string; strong?: string; tail?: string } {
  const unit = item.unit_label
  const limit = qty(item.allowed_gap, unit)
  if (view.actual_known && item.total_gap !== null) {
    const { amount, direction } = gapWords(item.total_gap, unit)
    if (direction === "same") return { text: "Used exactly what the spec allows." }
    if (item.expected === 0 && item.spec_unlinked) return { text: "Used ", strong: `${amount}`, tail: ` with no spec to compare: the spec was posted in ${item.spec_unlinked.unit_label} (limit ${limit}).` }
    if (item.expected === 0) return { text: "Used ", strong: `${amount}`, tail: ` with no spec posted this month (limit ${limit}).` }
    if (item.status === "OK") return { text: `Used ${amount} ${direction} than the spec allows. Within the limit of ± ${limit}.` }
    return { text: "Used ", strong: `${amount} ${direction}`, tail: ` than the spec allows (limit ± ${limit}).` }
  }
  if (view.running) {
    const { amount, direction } = gapWords(item.floor_gap, unit)
    if (direction === "same") return { text: "So far the floor has taken exactly the spec + wastage." }
    return { text: "So far the floor took ", strong: `${amount} ${direction}`, tail: " than the spec + wastage. Actual use is known after the month-end count." }
  }
  const cards = item.job_cards === 1 ? "1 job card" : `${item.job_cards} job cards`
  if (!item.spec && item.spec_unlinked) return { text: `${view.month_word} is not counted yet, so actual use is not known. Its spec was posted in ${item.spec_unlinked.unit_label}, so it is not compared.` }
  if (!item.spec) return { text: `${view.month_word} is not counted yet, so actual use is not known. No spec was posted for this item this month.` }
  return {
    text: `${view.month_word} is not counted yet, so actual use is not known. The spec allows ${qty(item.expected, unit)} (${qty(item.spec, unit)} in good tubes${item.normal_wastage_pct ? ` + ${qty(item.normal_wastage_pct)}% wastage` : ""}) for ${cards}.`,
  }
}

/** "Floor took 6.24 kg more than spec · store count is 0.70 kg short of the books." */
export function splitSentence(item: MonthEndItem, view: MonthEndOverview): string | null {
  if (!view.actual_known || item.store_gap === null) return null
  const unit = item.unit_label
  const floor = gapWords(item.floor_gap, unit)
  const floorText = floor.direction === "same" ? "Floor took exactly the spec + wastage" : `Floor took ${floor.amount} ${floor.direction} than spec + wastage`
  return `${floorText} · ${storeChangeWords(item.corrections, item.count_variance, unit).sentence}.`
}

/** The small line under "Spec allows": the spec and wastage it is made of, or why there is none. */
export function specHint(item: MonthEndItem): string {
  const unit = item.unit_label
  if (!item.spec && item.spec_unlinked) return `Spec not linked (unit differs: ${qty(item.spec_unlinked.spec, item.spec_unlinked.unit_label)})`
  if (!item.spec) return "No spec this month"
  if (item.normal_wastage_pct) return `${qty(item.spec, unit)} + ${qty(item.normal_wastage_pct)}% wastage`
  return item.job_cards ? `${item.job_cards} job card${item.job_cards === 1 ? "" : "s"}` : "No wastage allowed"
}

/** The small line under "Used per count". */
export function usedHint(item: MonthEndItem, view: MonthEndOverview): string {
  if (!view.actual_known) return "After the count"
  return storeChangeWords(item.corrections, item.count_variance, item.unit_label).short
}

/**
 * The note of one item: shown once saved, a box to write it while the item needs one (Owner and plant
 * head only, once the month-end count is approved). Used by the phone card and the desktop table row.
 */
export function ItemNote({ item, view, plantId, idPrefix, className }: { item: MonthEndItem; view: MonthEndOverview; plantId: string; idPrefix: string; className?: string }) {
  const { showToast } = useApp()
  const outside = item.status === "OVER" || item.status === "UNDER"
  const canNote = view.can.note && (outside || Boolean(item.note))
  const [draft, setDraft] = useState(item.note?.note || "")
  const [editing, setEditing] = useState(!item.note && item.needs_note)
  const save = useSaveMonthNote(plantId)
  const savedNote = item.note?.note || ""
  const savedAt = item.note?.noted_at || ""
  useEffect(() => {
    // A saved (or removed) note from the server resets the box; a refetch with the same note does not.
    setDraft(savedNote)
    setEditing(!savedNote && item.needs_note)
  }, [savedNote, savedAt, item.needs_note])

  const noteId = `${idPrefix}-note-${item.item_code}`
  const submit = () => {
    const text = draft.trim()
    if (!text && !item.note) return
    save.mutate(
      { month: view.month, item_code: item.item_code, item_id: item.item_id, item_name: item.item_name, note: text },
      {
        onSuccess: () => {
          showToast(text ? `Note saved on ${item.item_name}.` : `Note removed from ${item.item_name}.`, "success")
          setEditing(false)
        },
        onError: (error) => showToast(describeApiError(error, "The note could not be saved"), "error"),
      },
    )
  }
  if (!(item.note && !editing) && !(canNote && editing)) return null

  return (
    <div className={className}>
      {item.note && !editing ? (
        <div className="rounded-lg border border-signal-blue-line bg-signal-blue-soft/60 px-3 py-2">
          <p className="break-words text-[13px] leading-5 text-foreground">“{item.note.note}”</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">
              {personText(item.note.noted_by)} · {dayTimeText(item.note.noted_at)}
            </p>
            {canNote ? (
              <button type="button" className="min-h-11 px-1 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-9" onClick={() => setEditing(true)}>
                Change note
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {canNote && editing ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label htmlFor={noteId} className="sr-only">
            Why was more or less {item.item_name} used?
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={draft}
            maxLength={1000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={notePlaceholder(item)}
            className="min-h-[68px] w-full min-w-0 flex-1 resize-y rounded-lg border border-signal-amber-line bg-card px-3 py-2.5 text-[13.5px] leading-5 outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-[44px]"
          />
          <div className="flex gap-2">
            {item.note ? (
              <button type="button" className="erp-btn-secondary !h-11 flex-1 sm:flex-none" onClick={() => { setDraft(item.note?.note || ""); setEditing(false) }}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="erp-btn-primary !h-11 flex-1 sm:flex-none" disabled={save.isPending || (!draft.trim() && !item.note)}>
              {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save note
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

/** "Spec from 2 cards closed in a closed month is counted here (posted after close)." */
export function PostedAfterClose({ count, className }: { count: number; className?: string }) {
  if (!count) return null
  return (
    <p className={cn("inline-flex items-center gap-1.5 rounded-md bg-signal-amber-soft px-2 py-1 text-[12px] font-medium text-signal-amber-ink", className)}>
      <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Spec from {count === 1 ? "1 card" : `${count} cards`} closed in a closed month is counted here (posted after close).
    </p>
  )
}

/**
 * Flags that need the reader's eye beside the numbers: the store book does not add up, or the closing
 * changed after the month-end count was approved.
 */
export function ItemFlags({ item, className }: { item: MonthEndItem; className?: string }) {
  const unit = item.unit_label
  if (!item.book_problem && !item.changed_since_count && !item.spec_unlinked) return null
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {item.book_problem ? (
        <p className="inline-flex items-start gap-1.5 self-start rounded-md bg-signal-rose-soft px-2 py-1 text-[12px] font-medium leading-5 text-signal-rose-ink" data-testid="month-end-item-book-problem">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Store book: {item.book_problem.charAt(0).toLowerCase() + item.book_problem.slice(1)} (closing {qty(item.closing, unit)}).</span>
        </p>
      ) : null}
      {item.changed_since_count ? (
        <p className="inline-flex items-start gap-1.5 self-start rounded-md bg-signal-amber-soft px-2 py-1 text-[12px] font-medium leading-5 text-signal-amber-ink" data-testid="month-end-item-count-changed">
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Changed after the count: counted {qty(item.changed_since_count.counted, unit)}, closing now {qty(item.changed_since_count.closing, unit)}.</span>
        </p>
      ) : null}
      {item.spec_unlinked ? (
        <p className="inline-flex items-start gap-1.5 self-start rounded-md bg-muted px-2 py-1 text-[12px] font-medium leading-5 text-muted-foreground">
          <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Spec of {qty(item.spec_unlinked.spec, item.spec_unlinked.unit_label)} is in {item.spec_unlinked.unit_label}, but this item counts in {unit}. See “Spec items not linked” below.</span>
        </p>
      ) : null}
    </div>
  )
}

export function sourcesLabel(item: MonthEndItem) {
  return item.job_cards
    ? `See the ${item.job_cards === 1 ? "job card" : `${item.job_cards} job cards`}, issues and count lines`
    : "See the issues and count lines"
}

export function ItemCard({
  item,
  view,
  plantId,
  onOpenSources,
}: {
  item: MonthEndItem
  view: MonthEndOverview
  plantId: string
  onOpenSources: (item: MonthEndItem) => void
}) {
  const tone = itemTone(item, view.running)
  const unit = item.unit_label
  const sentence = mainSentence(item, view)
  const split = splitSentence(item, view)
  const gapValue = view.actual_known && item.total_gap !== null ? item.total_gap : item.floor_gap

  return (
    <article
      data-testid="month-end-item"
      data-item-code={item.item_code}
      data-tone={tone}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-3.5 pl-4 transition-shadow hover:shadow-premium sm:p-4 sm:pl-5",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        toneEdge(tone),
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[14.5px] font-semibold leading-snug text-foreground">{item.item_name}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
            {item.item_code} · {item.material_label} · limit ± {qty(item.allowed_gap, unit)}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill tone={tone} />
          {item.has_use ? <SoFarLimit tone={tone} gap={gapValue} allowed={item.allowed_gap} /> : null}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-4">
        <Figure label="Spec allows" value={qty(item.expected, unit)} hint={specHint(item)} />
        <Figure label="Issued to floor" value={qty(item.issued, unit)} hint={view.running ? "So far this month" : undefined} />
        <Figure
          label="Used per count"
          value={view.actual_known && item.actual_used !== null ? qty(item.actual_used, unit) : "Not known yet"}
          muted={!view.actual_known}
          hint={usedHint(item, view)}
        />
        <div className="col-span-3 flex min-w-0 flex-col justify-center rounded-lg px-1 pt-1 lg:col-span-1 lg:pt-0">
          <GapMeter gap={gapValue} allowed={item.allowed_gap} unit={unit} label={view.actual_known ? "Used against spec + wastage" : "Floor so far against spec + wastage"} />
        </div>
      </div>

      <p className="mt-3 text-[13.5px] leading-6 text-foreground">
        {sentence.text}
        {sentence.strong ? <strong className="font-semibold">{sentence.strong}</strong> : null}
        {sentence.tail || ""}
      </p>
      {split ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{split}</p> : null}
      <PostedAfterClose count={item.posted_after_close} className="mt-1.5" />
      <ItemFlags item={item} className="mt-1.5" />

      <ItemNote item={item} view={view} plantId={plantId} idPrefix="card" className="mt-3" />

      <button
        type="button"
        onClick={() => onOpenSources(item)}
        className="mt-2 inline-flex min-h-11 items-center gap-0.5 text-[12.5px] font-semibold text-primary hover:underline"
        data-testid="month-end-sources-link"
      >
        {sourcesLabel(item)}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </article>
  )
}
