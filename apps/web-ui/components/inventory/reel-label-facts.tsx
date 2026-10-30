import { cn } from "@/lib/utils"

/**
 * The readable lines of a reel / coil label (client 2026-10-30), as the server works them out when the label is
 * printed: GSM, BF and Polybond from the reel's incoming QC readings (the average of its samples), otherwise from
 * the PO line or the material master marked "(spec)"; width, weight, vendor, received date and the vendor's reel
 * number from the receipt. A value nobody gave stays blank — never 0. The QR beside it is unchanged.
 */
export type ReelFacts = {
  item?: string
  gsm?: string
  bf?: string
  ply_bond?: string
  width_mm?: string
  weight_kg?: string
  vendor?: string
  received_date?: string
  reel_no?: string
}

const ROWS: Array<Array<[keyof ReelFacts, string]>> = [
  [["gsm", "GSM"], ["bf", "BF"], ["ply_bond", "Polybond"]],
  [["width_mm", "Width mm"], ["weight_kg", "Weight kg"], ["reel_no", "Reel no"]],
]

export function hasReelFacts(value: unknown): value is ReelFacts {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function ReelLabelFacts({ facts, withItem = true, className }: { facts: ReelFacts; withItem?: boolean; className?: string }) {
  return (
    <div className={cn("space-y-1.5 text-foreground", className)} data-testid="reel-label-facts">
      {withItem && facts.item ? <p className="text-[13.5px] font-semibold leading-tight" data-testid="reel-label-item">{facts.item}</p> : null}
      {ROWS.map((row, index) => (
        <dl key={index} className="grid grid-cols-3 gap-x-2">
          {row.map(([key, label]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</dt>
              <dd className="text-[14px] font-bold tabular-nums leading-tight [overflow-wrap:anywhere]" data-testid={`reel-label-${key}`}>{facts[key] || " "}</dd>
            </div>
          ))}
        </dl>
      ))}
      {facts.vendor ? <p className="text-[12px] leading-snug" data-testid="reel-label-vendor"><span className="text-muted-foreground">Vendor </span><b className="font-semibold">{facts.vendor}</b></p> : null}
      {facts.received_date ? <p className="text-[12px]" data-testid="reel-label-received"><span className="text-muted-foreground">Received </span><b className="font-semibold">{facts.received_date}</b></p> : null}
    </div>
  )
}
