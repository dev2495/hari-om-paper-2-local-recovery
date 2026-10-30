"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Field, Notice, Segmented, Sheet, fieldClass } from "@/components/inventory/stock-ui"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useLocationsOverview, useStartCount } from "@/hooks/use-stock"
import { errorCode, errorText, plural, unitTotalsText } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

/** "3 reels and 2 lots · 1,200 kg · 40 pcs", or "empty". */
function rackStockWords(stock: { reels: number; lots: number; totals: Parameters<typeof unitTotalsText>[0] }): string {
  const parts = [stock.reels ? plural(stock.reels, "reel") : "", stock.lots ? plural(stock.lots, "lot") : ""].filter(Boolean)
  return parts.length ? `${parts.join(" and ")} · ${unitTotalsText(stock.totals)}` : "Empty"
}

/** Start a spot count (any role): a few racks, a few materials, or the whole store. */
export function CountStartSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const start = useStartCount()
  const overview = useLocationsOverview()
  const itemsQuery = useInventoryItems()
  const [by, setBy] = useState<"RACKS" | "ITEMS" | "ALL">("RACKS")
  const [racks, setRacks] = useState<string[]>([])
  const [items, setItems] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [openCountId, setOpenCountId] = useState("")
  const locations = (overview.data?.items || []).filter((row) => row.active && !["WIP", "DISPATCH"].includes(String(row.purpose)))
  const materials: any[] = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (Array.isArray(itemsQuery.data) ? itemsQuery.data : [])
      .filter((row: any) => !["FINISHED_GOOD", "TOOL"].includes(String(row.type)))
      .filter((row: any) => !needle || `${row.item_code} ${row.name}`.toLowerCase().includes(needle))
      .slice(0, 60)
  }, [itemsQuery.data, search])
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((row) => row !== value) : [...list, value])
  const ready = by === "ALL" || (by === "RACKS" ? racks.length > 0 : items.length > 0)

  const go = async () => {
    setError("")
    setOpenCountId("")
    try {
      const count = await start.mutateAsync({ kind: "SPOT", location_ids: by === "RACKS" ? racks : [], item_ids: by === "ITEMS" ? items : [] })
      onOpenChange(false)
      router.push(`/inventory/counts/${count.id}`)
    } catch (cause: any) {
      setError(errorText(cause))
      if (errorCode(cause) === "RACK_IN_OPEN_COUNT") setOpenCountId(String(cause?.response?.data?.detail?.count_id || ""))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide title="Start a spot count" description="Count a few racks or a few materials now. Anyone can count; the Owner approves the difference." testId="count-start-sheet"
      footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className="erp-btn-primary !h-11 min-w-36" disabled={!ready || start.isPending} onClick={go} data-testid="count-start-go">{start.isPending ? "Starting…" : "Start counting"}</button></>}>
      <div className="space-y-3.5">
        <Segmented<"RACKS" | "ITEMS" | "ALL"> label="What to count" value={by} onChange={setBy} options={[{ value: "RACKS", label: "Some racks" }, { value: "ITEMS", label: "Some materials" }, { value: "ALL", label: "Whole store" }]} testId="count-start-by" />
        {by === "RACKS" ? (
          <div className="grid max-h-[44vh] grid-cols-1 gap-2 overflow-y-auto overflow-x-hidden pr-0.5 sm:grid-cols-2">
            {locations.map((row) => (
              <label key={row.id} className={cn("flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", racks.includes(row.id) ? "border-primary/50 bg-primary/5" : "border-border")}>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={racks.includes(row.id)} onChange={() => setRacks(toggle(racks, row.id))} data-testid={`count-start-rack-${row.code}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[14px] font-bold text-foreground">{row.code}</span>
                  {row.name && row.name !== row.code ? <span className="block truncate text-[12px] text-muted-foreground">{row.name}</span> : null}
                  <span className="block truncate text-[12px] tabular-nums text-muted-foreground">{rackStockWords(row.stock)}</span>
                </span>
              </label>
            ))}
            {!locations.length ? <p className="text-[13px] text-muted-foreground">No store racks yet. Add racks on Stores → Locations.</p> : null}
          </div>
        ) : by === "ITEMS" ? (
          <>
            <Field label="Materials"><input className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or code" /></Field>
            <div className="max-h-[38vh] space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {materials.map((row: any) => (
                <label key={row.id} className={cn("flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5", items.includes(String(row.id)) ? "bg-primary/5" : "hover:bg-muted")}>
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={items.includes(String(row.id))} onChange={() => setItems(toggle(items, String(row.id)))} />
                  {/* Name first (it is what people read); the code sits under it and is cut, never the name. */}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] leading-5 text-foreground">{row.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{row.item_code}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[12.5px] text-muted-foreground">The racks that hold these materials are added for you.</p>
          </>
        ) : (
          <Notice tone="blue" title="Every store rack, plus stock with no location">Use the month-end count to close a month; a whole-store spot count changes stock but is not the certificate of a month.</Notice>
        )}
        {error ? <Notice tone={openCountId ? "amber" : "rose"} action={openCountId ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => { onOpenChange(false); router.push(`/inventory/counts/${openCountId}`) }} data-testid="count-start-open-existing">Open that count</button> : null}>{error}</Notice> : null}
      </div>
    </Sheet>
  )
}
