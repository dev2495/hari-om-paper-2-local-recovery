"use client"

import Link from "next/link"
import { History } from "lucide-react"
import { Notice } from "@/components/inventory/stock-ui"
import { type ChangedAfterCount, dayText, plural, signedQty } from "@/lib/api-stock"

/**
 * Stock entered after the month-end count was approved but dated into the month it counted. The count's
 * certificate no longer matches the book for these materials; the Owner recounts or checks the entries
 * before closing the month (a flag, not a block).
 */
export function ChangedAfterCountNotice({ items, monthLabel, countHref, closed = false, testId = "changed-after-count" }: { items: ChangedAfterCount[]; monthLabel?: string | null; countHref?: string; closed?: boolean; testId?: string }) {
  if (!items.length) return null
  return (
    <Notice tone="amber" icon={History} testId={testId}
      title={`${plural(items.length, "material")} changed after the month-end count`}>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, 5).map((row) => (
          <li key={row.item_id}>
            <b>{row.item_name || row.item_code || "A material"}</b>{row.item_code ? ` (${row.item_code})` : ""}: {signedQty(row.qty, row.uom || "KG")} entered after the count was approved
            {row.first_day ? `, dated ${dayText(row.first_day)}` : ""}{row.docs.length ? ` (${row.docs.join(", ")})` : ""}.
          </li>
        ))}
        {items.length > 5 ? <li>and {plural(items.length - 5, "more material")}.</li> : null}
      </ul>
      <p className="mt-1.5">The count saw the stock before {items.length === 1 ? "this entry" : "these entries"}, so the certificate{monthLabel ? ` for ${monthLabel}` : ""} no longer matches the book. {closed
        ? "The month is already closed: the Owner checks the entries, and re-opens the month if a recount is needed."
        : `Count ${items.length === 1 ? "it" : "them"} again with a spot count, or check the entries, before the month is closed.`}</p>
      {/* Under the text (not beside it), so the words keep the full width on a phone. */}
      {countHref ? <Link href={countHref} className="erp-btn-secondary mt-2.5 !h-11">Open the count</Link> : null}
    </Notice>
  )
}
