"use client"

// Dispatch: finished goods ready, shipped, retained and QC-excluded quantities from the card's flow,
// the dispatch slips made from this card, packing, and the shortage decision once final QC has closed.

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Flag, Package, Printer, Truck } from "lucide-react"

import { boxStatusLabel, boxesApi, boxesText, shiftShort, type Box } from "@/lib/boxes"
import { cn } from "@/lib/utils"
import { JobCardShortagePanel } from "../../JobCardShortagePanel"
import { Tile } from "./OverviewTab"
import { dayLabel, fmt, stageLabel, stampLabel, toneClass, useCardRoles } from "../model"

/** The card's boxes (owner decision 2, 1 Nov 2026): code, pcs, part box, QC flag, stock posting, challan; labels print here. */
function BoxesPanel({ card, summary }: { card: any; summary: any }) {
  const query = useQuery({ queryKey: ["card-boxes", card.id], queryFn: async () => (await boxesApi.cardBoxes(String(card.id))).data, refetchInterval: 15_000 })
  const boxes: Box[] = query.data?.boxes || []
  const warnings: string[] = query.data?.packaging?.warnings || []
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="card-boxes">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[14px] font-semibold">Boxes</h3>
        <span className="text-[12.5px] text-muted-foreground">{boxes.length ? boxesText(boxes.filter((b) => b.status !== "VOID")) : "packed as Process good pcs are logged"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {boxes.length ? (
            <Link href={`/production/boxes/labels?card=${card.id}`} className="erp-btn-secondary !h-8" data-testid="card-boxes-labels">
              <Printer className="h-4 w-4" /> Box labels
            </Link>
          ) : null}
        </div>
      </div>
      {summary?.qty_per_box ? null : <p className={cn("mx-4 mt-3 rounded-lg border px-3 py-2 text-[12.5px]", toneClass("amber"))}>The spec has no qty per box: pcs are not boxed until it is set (Packing setup); at Process close everything goes into one part box.</p>}
      {warnings.length ? (
        <ul className={cn("mx-4 mt-3 space-y-0.5 rounded-lg border px-3 py-2 text-[12.5px]", toneClass("amber"))} data-testid="card-boxes-warnings">
          {warnings.map((w) => <li key={w}>· {w}</li>)}
        </ul>
      ) : null}
      {boxes.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Box</th>
                <th className="px-2 py-2 text-right">Pcs</th>
                <th className="px-2 py-2 text-left">Packed</th>
                <th className="px-2 py-2 text-left">Stock</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {boxes.map((b) => (
                <tr key={b.id} data-testid={`card-box-${b.box_code}`}>
                  <td className="px-4 py-2 font-mono font-semibold">
                    <Link href={`/production/boxes/${encodeURIComponent(b.box_code)}`} className="text-primary underline-offset-2 hover:underline">{b.box_code}</Link>
                    {b.is_part ? <span className={cn("ml-1.5 rounded-full border px-1.5 font-sans text-[10.5px] font-semibold", toneClass("violet"))}>part box</span> : null}
                    {b.qc_flagged ? <span className={cn("ml-1.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 font-sans text-[10.5px] font-semibold", toneClass("amber"))} title={(b.qc_flags || []).map((f) => `${f.label || f.parameter} ${f.value}`).join(" · ")}><Flag className="h-3 w-3" aria-hidden="true" />QC flagged</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(b.qty, 0)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{[dayLabel(b.business_date), shiftShort(b.shift_code), b.operator_name].filter(Boolean).join(" · ")}</td>
                  <td className="px-2 py-2">{b.status === "DISPATCHED" && b.fg_status === "POSTED" ? "Shipped" : b.fg_status === "POSTED" ? "In stock" : b.fg_status === "FAILED" ? <span className="text-signal-rose-ink">Posting failed · retrying</span> : "Posting…"}</td>
                  <td className="px-4 py-2">{boxStatusLabel[b.status] || b.status}{b.challan_no ? ` · ${b.challan_no}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{query.isLoading ? "Loading boxes…" : "No box packed yet. Boxes are packed from Process good pcs once their QC readings are done."}</p>
      )}
    </section>
  )
}

export function DispatchTab({ card, flow }: { card: any; flow: any }) {
  const { canSubmit } = useCardRoles()
  const dispatch = (flow?.stages || []).find((s: any) => s.stage === "DISPATCH")
  const rows: any[] = Array.isArray(card?.dispatch_history) ? card.dispatch_history : []
  const packing = card?.packing_record
  const boxSummary = flow?.boxes
  // Box cards: what can ship now is the packed boxes already in stock (Process may still be running).
  const ready = boxSummary ? Number(boxSummary.ready_pcs || 0) : Number(dispatch?.available_from_upstream || 0)
  const oldStages: any[] = !flow ? (card?.stages || []).filter((s: any) => ["PACKING", "QC", "DISPATCH"].includes(s.stage_type)) : []

  return (
    <div className="space-y-4" data-testid="tab-dispatch">
      {dispatch ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {boxSummary ? (
            <>
              <Tile label="Finished goods (boxes)" value={`${fmt(boxSummary.boxed_pcs, 0)} pcs`} sub={`${fmt(boxSummary.box_count, 0)} box${boxSummary.box_count === 1 ? "" : "es"}${boxSummary.part_boxes ? ` · ${boxSummary.part_boxes} part` : ""}`} />
              <Tile label="Ready to ship" value={`${fmt(ready, 0)} pcs`} tone={ready ? "emerald" : undefined} sub={`${fmt(boxSummary.ready_boxes, 0)} box${boxSummary.ready_boxes === 1 ? "" : "es"} in stock${dispatch.max_ship_qty != null ? ` · released left ${fmt(dispatch.max_ship_qty, 0)}` : ""}`} testId="dispatch-ready" />
            </>
          ) : (
            <>
              <Tile label="Finished goods" value={`${fmt(dispatch.dispatchable_qty ?? 0, 0)} pcs`} sub={dispatch.status === "PLANNED" ? "posted when Process closes" : "posted to stock"} />
              <Tile label="Ready to ship" value={`${fmt(ready, 0)} pcs`} tone={ready ? "emerald" : undefined} sub={dispatch.max_ship_qty != null ? `may ship up to ${fmt(dispatch.max_ship_qty, 0)} (order tolerance)` : undefined} testId="dispatch-ready" />
            </>
          )}
          <Tile label="Shipped" value={`${fmt(dispatch.accepted_total, 0)} pcs`} sub={rows.length ? `${rows.length} dispatch slip${rows.length === 1 ? "" : "s"}` : "no DC yet"} />
          <Tile
            label="Kept back"
            value={`${fmt(Number(dispatch.retained_fg_qty || 0) + Number(dispatch.qc_rejected_qty || 0) + Number(dispatch.qc_uninspected_qty || 0), 0)} pcs`}
            sub={[dispatch.retained_fg_qty ? `${fmt(dispatch.retained_fg_qty, 0)} retained in stock` : "", dispatch.qc_rejected_qty ? `${fmt(dispatch.qc_rejected_qty, 0)} QC rejected` : "", dispatch.qc_uninspected_qty ? `${fmt(dispatch.qc_uninspected_qty, 0)} not inspected` : ""].filter(Boolean).join(" · ") || "nothing held back"}
          />
        </div>
      ) : null}

      {boxSummary ? <BoxesPanel card={card} summary={boxSummary} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="dispatch-slips">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <h3 className="text-[14px] font-semibold">Dispatch slips from this card</h3>
            <div className="ml-auto flex flex-wrap gap-2">
              {ready > 0 ? (
                <Link href={`/logistics/dispatch/new?job_card_id=${card.id}`} className="erp-btn-primary !h-8">
                  <Truck className="h-4 w-4" /> Create dispatch slip · {boxSummary ? `${fmt(boxSummary.ready_boxes, 0)} boxes` : fmt(ready, 0)} ready
                </Link>
              ) : null}
              <Link href="/logistics/dispatch" className="erp-btn-secondary !h-8">
                Open dispatch
              </Link>
            </div>
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">DC</th>
                    <th className="px-2 py-2 text-left">When</th>
                    <th className="px-2 py-2 text-right">Pcs</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Vehicle · by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((d: any, i: number) => {
                    const snap = d.dispatch_snapshot || {}
                    return (
                      <tr key={d.id || i}>
                        <td className="px-4 py-2 font-semibold">
                          {d.id ? (
                            <Link href={`/logistics/dispatch/${d.id}`} className="text-primary underline-offset-2 hover:underline">
                              {d.dispatch_no || snap.dispatch_no || d.reference || String(d.id).slice(0, 8)}
                            </Link>
                          ) : (
                            d.dispatch_no || "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">{stampLabel(d.dispatched_at || d.sealed_at || d.created_at || snap.dispatch_date) || "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(snap.dispatch_qty ?? snap.qty ?? d.qty ?? d.quantity, 0)}</td>
                        <td className="px-2 py-2">{String(d.status || "").toLowerCase() || "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{[snap.vehicle_no || d.vehicle_no, d.created_by ? String(d.created_by).split("@")[0] : ""].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{ready > 0 ? "Finished goods are ready; no dispatch slip yet." : "No dispatch slip from this card yet. One can be made once Process closes and finished goods post."}</p>
          )}
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4" data-testid="dispatch-packing">
            <h3 className="text-[14px] font-semibold">{boxSummary ? "Packing · box by box" : "Packing · at Process close"}</h3>
            {boxSummary ? (
              <p className="mt-2 text-[13px] text-muted-foreground" data-testid="dispatch-packing-boxes">
                Process good pcs are packed into boxes of {boxSummary.qty_per_box ? `${fmt(boxSummary.qty_per_box, 0)} pcs` : "the spec's qty per box"} as their QC readings are done; the pcs left at Process close go into a part box. Each box goes into stock on its own and uses one box plus the spec&apos;s plastic and fadda per box for the month&apos;s packing theory.
              </p>
            ) : packing ? (
              <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">Packed</dt>
                <dd>{fmt(packing.packed_qty ?? packing.qty, 0)} pcs</dd>
                {packing.box_count != null ? (
                  <>
                    <dt className="text-muted-foreground">Boxes</dt>
                    <dd>
                      {fmt(packing.box_count, 0)}
                      {packing.qty_per_box ? ` × ${fmt(packing.qty_per_box, 0)}` : ""}
                    </dd>
                  </>
                ) : null}
                {packing.created_at ? (
                  <>
                    <dt className="text-muted-foreground">Recorded</dt>
                    <dd>{stampLabel(packing.created_at)}</dd>
                  </>
                ) : null}
              </dl>
            ) : dispatch?.dispatchable_qty ? (
              <p className="mt-2 text-[13px] text-muted-foreground">Packing from the spec sheet posted with Process close: {fmt(dispatch.dispatchable_qty, 0)} pcs finished goods. Process QC is the final QC.</p>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">Process QC is the final QC: packing material and finished goods post when Process closes. Nothing packed yet.</p>
            )}
            {oldStages.length ? (
              <ul className="mt-2 space-y-1 text-[13px]">
                {oldStages.map((s: any) => (
                  <li key={s.stage_type} className="flex justify-between gap-2">
                    <span>{stageLabel(s.stage_type)}</span>
                    <span className="text-muted-foreground">
                      {String(s.status || "").toLowerCase()}
                      {s.output_qty ? ` · ${fmt(s.output_qty, 0)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          {dispatch?.status === "COMPLETED" ? <p className="rounded-xl border border-signal-emerald-line bg-signal-emerald-soft px-4 py-3 text-[13px] text-signal-emerald-ink">Dispatch reconciled: everything that could ship has shipped{dispatch.retained_fg_qty ? ` (${fmt(dispatch.retained_fg_qty, 0)} pcs retained in stock)` : ""}.</p> : null}
        </div>
      </div>

      {canSubmit && flow ? <JobCardShortagePanel key={card.id} card={card} flow={flow} /> : null}
    </div>
  )
}
