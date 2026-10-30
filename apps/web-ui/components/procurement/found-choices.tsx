"use client"

import { Chip } from "@/components/sales/order-chips"
import { foundWords, matchWords, type FoundRow } from "@/lib/lot-find"
import { cn } from "@/lib/utils"

const qty = (row: FoundRow) => `${Number(row.qty || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${({ KG: "kg", PCS: "pcs", L: "L" } as Record<string, string>)[String(row.uom || "").toUpperCase()] || String(row.uom || "").toLowerCase()}`

/**
 * A typed number that fits more than one lot, reel or coil (a GRN with two lots, a part of a number, an
 * old mark used twice): a short list to tap, oldest first, the ones that can go to the floor on top. Tapping
 * one checks it exactly like a scan of its label. Rows are 44 px tall.
 */
export function FoundChoices({ choices, onPick, onCancel, testid }: {
  choices: { code: string; rows: FoundRow[]; count: number; truncated: boolean }
  onPick: (row: FoundRow) => void
  onCancel: () => void
  testid: string
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/40 p-2" data-testid={testid}>
      <p className="px-1 pb-1.5 text-[12.5px] font-semibold text-foreground">
        {matchWords(choices.rows, choices.code, choices.count)}: tap the one in your hand
        {choices.truncated ? <span className="font-normal text-muted-foreground"> · first {choices.rows.length} shown, type more of the number to narrow it</span> : null}
      </p>
      <ul className="grid gap-1.5">
        {choices.rows.map((row) => {
          const words = foundWords(row)
          const where = row.location_name || row.location_code
          return (
            <li key={`${row.kind}-${row.id}`}>
              <button type="button" onClick={() => onPick(row)} data-testid={`${testid}-${row.code}`} className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:border-foreground/25 hover:bg-muted/40")}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-foreground">{row.code}{row.matched_on === "GRN" ? <span className="font-normal text-muted-foreground"> · GRN {row.matched_value}</span> : row.matched_on === "OLD_MARK" ? <span className="font-normal text-muted-foreground"> · old mark {row.matched_value}</span> : row.matched_on === "VENDOR_REEL" ? <span className="font-normal text-muted-foreground"> · vendor reel {row.matched_value}</span> : null}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{[row.item_name || row.item_code, row.kind === "REEL" ? (String(row.physical_form || "").toUpperCase() === "COIL" ? "coil" : "reel") : null, where].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-[13px] font-semibold tabular-nums text-foreground">{qty(row)}</span>
                  <Chip tone={words.tone} size="xs">{words.text}</Chip>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" onClick={onCancel} className="mt-1 inline-flex min-h-11 items-center px-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
    </div>
  )
}
