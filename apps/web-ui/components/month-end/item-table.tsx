"use client"

import { Fragment } from "react"
import { ChevronRight } from "lucide-react"

import { gapWords, qty, signedQty, type MonthEndItem, type MonthEndOverview } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

import { ItemFlags, ItemNote, PostedAfterClose, mainSentence, specHint, splitSentence, usedHint } from "./item-card"
import { GapMeter, SoFarLimit, StatusPill, itemTone, toneEdge } from "./parts"

export type TableColumns = "use" | "book"

/** "56 kg more" / "3 kg less" / "exactly", for the gap column. */
function gapText(gap: number, unit: string) {
  const { amount, direction } = gapWords(gap, unit)
  return direction === "same" ? "Exactly" : `${amount} ${direction}`
}

/**
 * Desktop items of one unit as a table (spec 4: desktop table, phone cards). "Use against spec" shows
 * spec + wastage, issued, used per count and the gap with its status; "Store book" shows the identity of each item
 * (opening + received − sent back − issued ± count and corrections = closing). An item outside its
 * limit, with a note or with spec posted after a close opens a line below its row with the sentence and
 * the note, so nothing that the phone card says is lost.
 */
export function ItemTable({
  items,
  view,
  plantId,
  columns,
  onOpenSources,
}: {
  items: MonthEndItem[]
  view: MonthEndOverview
  plantId: string
  columns: TableColumns
  onOpenSources: (item: MonthEndItem) => void
}) {
  const span = columns === "use" ? 6 : 8
  const wrap = "!whitespace-normal !leading-tight"
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-testid="month-end-item-table" data-columns={columns}>
      <table className="tube-grid table-fixed">
        <colgroup>
          <col />
          {columns === "use" ? (
            <>
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[30%]" />
            </>
          ) : (
            <>
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
            </>
          )}
          <col className="w-[52px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Material</th>
            {columns === "use" ? (
              <>
                <th scope="col" className="num">Spec allows</th>
                <th scope="col" className={cn("num", wrap)}>Issued to floor</th>
                <th scope="col" className={cn("num", wrap)}>Used per count</th>
                <th scope="col" className={wrap}>{view.actual_known ? "Used against spec + wastage" : "Floor so far against spec + wastage"}</th>
              </>
            ) : (
              <>
                <th scope="col" className="num">Opening</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Sent back</th>
                <th scope="col" className="num">Issued</th>
                <th scope="col" className={cn("num", wrap)}>Count and corrections</th>
                <th scope="col" className="num">Closing</th>
              </>
            )}
            <th scope="col"><span className="sr-only">Where the numbers come from</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const tone = itemTone(item, view.running)
            const unit = item.unit_label
            const gap = view.actual_known && item.total_gap !== null ? item.total_gap : item.floor_gap
            const outside = item.status === "OVER" || item.status === "UNDER"
            const detail = outside || Boolean(item.note) || Boolean(item.posted_after_close) || Boolean(item.book_problem || item.changed_since_count || item.spec_unlinked)
            const sentence = mainSentence(item, view)
            const split = splitSentence(item, view)
            return (
              <Fragment key={item.item_code}>
                <tr data-testid="month-end-item-row" data-item-code={item.item_code} data-tone={tone} data-expanded={detail ? "true" : undefined}>
                  <td className={cn("relative before:absolute before:inset-y-0 before:left-0 before:w-1", toneEdge(tone))}>
                    <button
                      type="button"
                      onClick={() => onOpenSources(item)}
                      className="block min-h-9 max-w-full text-left text-[13.5px] font-semibold leading-snug text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <span className="break-words">{item.item_name}</span>
                    </button>
                    <p className="text-[12px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                      {item.item_code} · {item.material_label} · limit ± {qty(item.allowed_gap, unit)}
                    </p>
                    {columns === "book" ? <StatusPill tone={tone} className="mt-1" /> : null}
                  </td>
                  {columns === "use" ? (
                    <>
                      <td className="num">
                        <span className="font-semibold">{qty(item.expected, unit)}</span>
                        <span className="block whitespace-normal text-[12px] font-normal leading-4 text-muted-foreground [overflow-wrap:anywhere]">{specHint(item)}</span>
                      </td>
                      <td className="num">
                        <span className="font-semibold">{qty(item.issued, unit)}</span>
                        {view.running ? <span className="block text-[12px] text-muted-foreground">So far</span> : null}
                      </td>
                      <td className="num">
                        <span className={cn("font-semibold", !view.actual_known && "font-medium text-muted-foreground")}>
                          {view.actual_known && item.actual_used !== null ? qty(item.actual_used, unit) : "Not known yet"}
                        </span>
                        <span className="block whitespace-normal text-[12px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{usedHint(item, view)}</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="flex flex-wrap items-center gap-1">
                            <StatusPill tone={tone} />
                            {item.has_use ? <SoFarLimit tone={tone} gap={gap} allowed={item.allowed_gap} /> : null}
                          </span>
                          <span className="text-[12.5px] font-semibold tabular-nums">{gapText(gap, unit)}</span>
                        </div>
                        <GapMeter compact gap={gap} allowed={item.allowed_gap} unit={unit} label={view.actual_known ? "Used against spec + wastage" : "Floor so far against spec + wastage"} className="mt-1" />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{qty(item.opening, unit)}</td>
                      <td className="num">
                        {qty(item.received, unit)}
                        {item.opening_loads ? <span className="block whitespace-normal text-[12px] leading-4 text-muted-foreground">{qty(item.opening_loads, unit)} opening load</span> : null}
                      </td>
                      <td className="num">{qty(item.sent_back, unit)}</td>
                      <td className="num">{qty(item.issued, unit)}</td>
                      <td className="num">{signedQty(item.corrections, unit)}</td>
                      <td className="num">
                        <span className="font-semibold">{qty(item.closing, unit)}</span>
                        {!item.identity_ok ? <span className="block whitespace-normal text-[12px] font-medium leading-4 text-signal-amber-ink">Does not add up</span> : null}
                      </td>
                    </>
                  )}
                  <td className="!px-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenSources(item)}
                      className="inline-grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label={`${item.item_name}: where the numbers come from`}
                      title="Where the numbers come from"
                      data-testid="month-end-sources-link"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                {detail ? (
                  <tr className="sub-row" data-testid="month-end-item-detail" data-item-code={item.item_code}>
                    <td colSpan={span} className={cn("relative before:absolute before:inset-y-0 before:left-0 before:w-1", toneEdge(tone))}>
                      <div className="grid gap-x-6 gap-y-2 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                        <div className="min-w-0">
                          <p className="text-[13px] leading-5 text-foreground">
                            {sentence.text}
                            {sentence.strong ? <strong className="font-semibold">{sentence.strong}</strong> : null}
                            {sentence.tail || ""}
                          </p>
                          {split ? <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{split}</p> : null}
                          <PostedAfterClose count={item.posted_after_close} className="mt-1.5" />
                          <ItemFlags item={item} className="mt-1.5" />
                        </div>
                        <ItemNote item={item} view={view} plantId={plantId} idPrefix="table" className="min-w-0" />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
