"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Undo2 } from "lucide-react"
import { useRef, useState } from "react"

import { ContinuousScanner } from "@/components/inventory/continuous-scanner"
import { Chip, TONE } from "@/components/inventory/stock-ui"
import { clientRef, errorCode, errorText, qtyText, stockApi, type LocationBrief, type MoveResult, type Tone } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

type Row = { key: string; tone: Tone; title: string; detail: string; ref?: string; undone?: boolean }

/**
 * Move stock here / put away (spec 2.7): with the rack open, scan lot after lot. Each one is filed here at
 * once with from → to and who; a held lot moves but stays held; floor stock is refused in plain words.
 */
export function MoveHere({ location, onClose }: { location: LocationBrief; onClose: () => void }) {
  const client = useQueryClient()
  const [rows, setRows] = useState<Row[]>([])
  const [flash, setFlash] = useState<{ tone: Tone; key: number } | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const moved = rows.filter((row) => row.ref && !row.undone).length

  const add = (row: Row) => {
    setRows((current) => [row, ...current].slice(0, 60))
    setFlash({ tone: row.tone, key: Date.now() })
  }
  const scan = (code: string) => {
    const run = async () => {
      const ref = clientRef("move")
      try {
        const result: MoveResult = await stockApi.scanMove({ to_location_id: location.id, code, client_ref: ref })
        const lot = result.lot
        add({
          key: ref,
          tone: result.moved ? (result.held ? "amber" : "emerald") : "slate",
          title: `${lot.code} · ${qtyText(lot.qty, lot.uom)}`,
          detail: result.moved ? `${result.from ? `from ${result.from.code}` : "from no location"} → ${location.code}${result.held ? " · stays on QC hold" : ""}` : "Already here",
          ref: result.moved ? ref : undefined,
        })
        void client.invalidateQueries({ queryKey: ["stock"] })
      } catch (error) {
        const kind = errorCode(error)
        add({ key: ref, tone: kind === "RACK_LABEL" ? "amber" : "rose", title: kind === "RACK_LABEL" ? "That is a rack label" : "Not moved", detail: kind === "RACK_LABEL" ? `You are filing stock on ${location.code}. Scan the reel, coil or lot labels to move them here.` : errorText(error) })
      }
    }
    queue.current = queue.current.then(run, run)
  }
  const undo = async (row: Row) => {
    if (!row.ref) return
    try {
      await stockApi.undoMove(row.ref)
      setRows((current) => current.map((item) => item.key === row.key ? { ...item, undone: true } : item))
      void client.invalidateQueries({ queryKey: ["stock"] })
    } catch (error) {
      add({ key: clientRef("undo"), tone: "rose", title: "Not put back", detail: errorText(error) })
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-primary/30 bg-card p-4 shadow-[var(--shadow-premium)]" data-testid="move-here">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Move stock to {location.code}</h2>
          <p className="text-[12.5px] text-muted-foreground">Scan each reel, coil or lot label. Nothing on the floor can come back to the store.</p>
        </div>
        <button type="button" className="erp-btn-secondary !h-11" onClick={onClose} data-testid="move-here-done"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Done{moved ? ` (${moved} moved)` : ""}</button>
      </div>
      <ContinuousScanner onCode={scan} flash={flash} testId="move-scanner" />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border" aria-live="polite">
          {rows.map((row) => (
            <li key={row.key} className={cn("flex items-center gap-3 px-3 py-2.5 motion-safe:animate-enter-up", row.undone && "opacity-60")} data-testid="move-row">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[row.tone].dot)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13.5px] font-semibold text-foreground">{row.title}</p>
                <p className="flex items-center gap-1 truncate text-[12.5px] text-muted-foreground">{row.undone ? "Put back" : row.detail}</p>
              </div>
              {row.ref && !row.undone ? (
                <button type="button" onClick={() => void undo(row)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-primary hover:bg-muted" data-testid="move-undo"><Undo2 className="h-4 w-4" aria-hidden="true" />Undo</button>
              ) : row.tone !== "emerald" && !row.ref ? <Chip tone={row.tone}>{row.tone === "slate" ? "Here" : "Refused"}</Chip> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
