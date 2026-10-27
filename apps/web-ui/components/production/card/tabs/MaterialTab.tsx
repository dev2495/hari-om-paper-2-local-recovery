"use client"

// Material: what the card knows today — output truth (planned, issued, produced, packed, dispatched),
// the paper recipe and bamboo math frozen on the card, reels issued to the winder, stock postings and
// unused input. Issues are made in Stores; this tab only shows them.

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { seasonTimestamp } from "@/lib/season-api"
import { ResidualWipPanel } from "../../ResidualWipPanel"
import { useCardEffects, useCardMutation, useEntryApi, useStableCommand } from "../data"
import { Tile } from "./OverviewTab"
import { cardFacts, fmt, stageLabel, useCardRoles } from "../model"

export function MaterialTab({ card, flow }: { card: any; flow: any }) {
  const { canSubmit } = useCardRoles()
  const entryApi = useEntryApi(card)
  const { mutation } = useCardMutation(String(card.id))
  const { stableCommand, reset } = useStableCommand()
  const effects = useCardEffects(card)
  const facts = cardFacts(card)
  const snapshot = card?.document_snapshot || {}
  const truth = snapshot.material_truth || {}
  const recipe = snapshot.recipe_summary || {}
  const manufacturing = snapshot.manufacturing_spec || {}
  const rows: any[] = Array.isArray(recipe.rows) ? recipe.rows : []
  const adhesives: any[] = Array.isArray(recipe.adhesive_components) ? recipe.adhesive_components : []
  const winderMachine = card.stages?.find((s: any) => s.stage_type === "WINDER")?.machine_id
  const reelIssues = useQuery({
    queryKey: ["continuous-reel-issues", card.id, winderMachine],
    queryFn: async () => (await entryApi.reelIssues(winderMachine)).data,
    enabled: Boolean(winderMachine),
  })
  const reels: any[] = (reelIssues.data || []).filter((i: any) => !i.sales_order_id || i.sales_order_id === card.sales_order_id)
  const theoryPerTube = Number(recipe.paper_total_g || 0)
  const theoryPaperKg = theoryPerTube && facts.qty ? (theoryPerTube * facts.qty) / 1000 : 0
  const theoryGlueKg = Number(recipe.adhesive_total_g || 0) && facts.qty ? (Number(recipe.adhesive_total_g) * facts.qty) / 1000 : 0
  const issuedKg = reels.reduce((sum: number, i: any) => sum + Number(i.consumed_weight_kg || i.issued_weight_kg || 0), 0)

  return (
    <div className="space-y-4" data-testid="tab-material">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Planned" value={`${fmt(truth.planned_output_qty ?? facts.qty, 0)} pcs`} sub={facts.bamboo ? `${fmt(truth.target_bamboo_count ?? facts.bamboo, 0)} bamboo × ${fmt(truth.pcs_per_bamboo ?? facts.pcsPerBamboo, 0)}` : undefined} />
        <Tile label="Issued input" value={truth.issued_input_qty != null ? fmt(truth.issued_input_qty, 1) : "—"} sub="from Stores issues" />
        <Tile label="Produced" value={truth.produced_output_qty != null ? fmt(truth.produced_output_qty, 0) : "—"} sub="good output recorded" />
        <Tile label="Packed" value={truth.packed_qty != null ? `${fmt(truth.packed_qty, 0)} pcs` : "—"} sub={truth.packed_qty == null ? "not packed yet" : undefined} />
        <Tile label="Dispatched" value={truth.dispatched_qty != null ? `${fmt(truth.dispatched_qty, 0)} pcs` : "—"} sub={truth.dispatched_qty == null ? "no DC yet" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="material-reels">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[14px] font-semibold">Reels issued to the winder</h3>
              <span className="text-[12px] text-muted-foreground">from Stores · closed issues on {winderMachine ? "this card's winder" : "the winder"}</span>
              <Link href="/inventory/production-issue" className="erp-btn-secondary ml-auto !h-8">
                Issue more
              </Link>
            </div>
            {!winderMachine ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No winder on this card yet.</p> : null}
            {winderMachine && reelIssues.isLoading ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Loading reel issues…</p> : null}
            {winderMachine && reelIssues.isError ? <p className="px-4 py-6 text-center text-[13px] text-signal-rose-ink">Reel issues could not be loaded from Inventory.</p> : null}
            {winderMachine && reelIssues.isSuccess && !reels.length ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No reel issues recorded for this winder and order.</p> : null}
            {reels.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Reel</th>
                      <th className="px-2 py-2 text-right">Kg</th>
                      <th className="px-4 py-2 text-left">Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reels.map((i: any) => (
                      <tr key={i.id}>
                        <td className="px-4 py-2 whitespace-nowrap">{i.issue_date || "—"}</td>
                        <td className="px-2 py-2">{i.reel_code || i.amigo_no || String(i.id).slice(0, 8)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(i.consumed_weight_kg || i.issued_weight_kg, 1)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{i.sales_order_id ? (i.sales_order_id === card.sales_order_id ? "this order" : String(i.sales_order_id).slice(0, 8)) : "winder, no order"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-card p-4" data-testid="material-recipe">
            <h3 className="text-[14px] font-semibold">
              Recipe frozen on this card <span className="text-[12px] font-normal text-muted-foreground">{facts.pcsPerBamboo ? `· ${fmt(facts.bamboo, 0)} bamboo × ${fmt(facts.pcsPerBamboo, 0)} pcs` : ""}</span>
            </h3>
            {rows.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left">Paper</th>
                      <th className="py-1 text-right">GSM</th>
                      <th className="py-1 text-right">Plies</th>
                      <th className="py-1 text-right">g / tube</th>
                      <th className="py-1 text-right">Theory kg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row: any, i: number) => (
                      <tr key={`${row.code || i}`}>
                        <td className="py-1.5">
                          <b>{row.variety || row.category || "Paper"}</b>
                          <span className="block text-[11px] text-muted-foreground">{row.positionsText ? `positions ${row.positionsText}` : ""}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(row.gsm, 0)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(row.plyCount || row.actualPlyCount, 0)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(row.weightAllPly || row.totalWeightG, 2)}</td>
                        <td className="py-1.5 text-right tabular-nums">{facts.qty ? fmt((Number(row.weightAllPly || row.totalWeightG || 0) * facts.qty) / 1000, 1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1.5">Paper total</td>
                      <td />
                      <td />
                      <td className="py-1.5 text-right tabular-nums">{fmt(theoryPerTube, 2)}</td>
                      <td className="py-1.5 text-right tabular-nums">{theoryPaperKg ? fmt(theoryPaperKg, 1) : "—"}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5">Glue{adhesives.length ? ` · ${adhesives.map((a: any) => `${a.name || "glue"} ${fmt(a.ratio_percent, 0)}%`).join(", ")}` : ""}</td>
                      <td />
                      <td />
                      <td className="py-1.5 text-right tabular-nums">{fmt(recipe.adhesive_total_g, 2)}</td>
                      <td className="py-1.5 text-right tabular-nums">{theoryGlueKg ? fmt(theoryGlueKg, 1) : "—"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">Recipe rows were not captured on this card&apos;s snapshot.</p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3">
              <dt className="text-muted-foreground">Bamboo length</dt>
              <dd className="sm:col-span-2">{facts.bambooLength ? `${fmt(facts.bambooLength, 0)} mm · usable ${fmt(manufacturing.usable_length_mm, 0)} · trim ${fmt(manufacturing.trim_loss_mm, 0)} mm` : "—"}</dd>
              <dt className="text-muted-foreground">Tube dry / wet</dt>
              <dd className="sm:col-span-2">
                {fmt(manufacturing.tube_dry_weight_g, 2)} / {fmt(manufacturing.tube_wet_weight_g, 2)} g · drying {fmt(recipe.drying_percent, 0)}%
              </dd>
              <dt className="text-muted-foreground">Bamboo dry / wet</dt>
              <dd className="sm:col-span-2">
                {fmt(manufacturing.whole_bamboo_dry_weight_g, 1)} / {fmt(manufacturing.whole_bamboo_wet_weight_g, 1)} g
              </dd>
              <dt className="text-muted-foreground">Issued vs theory</dt>
              <dd className="sm:col-span-2">{issuedKg && theoryPaperKg ? `${fmt(issuedKg, 1)} kg issued · ${fmt(theoryPaperKg, 1)} kg theory (${issuedKg >= theoryPaperKg ? "+" : "−"}${fmt((Math.abs(issuedKg - theoryPaperKg) / theoryPaperKg) * 100, 1)}%)` : "settled at the monthly stock count"}</dd>
            </dl>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4" data-testid="material-postings">
            <h3 className="text-[14px] font-semibold">
              Stock postings <span className="text-[12px] font-normal text-muted-foreground">{flow?.pending_effects ? `· ${flow.pending_effects} pending` : ""}</span>
            </h3>
            {effects.isLoading ? <p className="mt-2 text-[13px] text-muted-foreground">Loading…</p> : null}
            {effects.data?.length ? (
              <ul className="mt-2 divide-y divide-border">
                {effects.data.map((e: any) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <div>
                      <p>
                        {stageLabel(e.stage || "")} · {String(e.kind || "").replaceAll("_", " ").toLowerCase()} · {String(e.status || "").toLowerCase()}
                      </p>
                      {e.last_error ? <p className="text-signal-rose-ink">{e.last_error}</p> : null}
                      <p className="text-[11.5px] text-muted-foreground">
                        Attempts {e.attempts}
                        {e.status === "FAILED" && e.next_attempt_at ? ` · next automatic retry ${seasonTimestamp(e.next_attempt_at)}` : ""}
                      </p>
                    </div>
                    {canSubmit && e.status === "FAILED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() =>
                          mutation.mutate(async () => {
                            const r = await entryApi.retryEffect(card.id, e.id, stableCommand({ expected_version: e.attempts, reason: "Supervisor requested retry after reviewing posting failure" }, `effect:${e.id}`))
                            reset()
                            await effects.refetch()
                            return r
                          })
                        }
                      >
                        Retry posting
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : effects.isSuccess ? (
              <p className="mt-2 text-[13px] text-muted-foreground">Nothing posted to stock from this card yet. Finished goods and packing post when Process closes.</p>
            ) : null}
          </section>

          {flow?.residual_wip?.length ? (
            <ResidualWipPanel
              rows={flow.residual_wip}
              canResolve={canSubmit}
              busy={mutation.isPending}
              onResolve={(row, disposition, reason) =>
                mutation.mutate(async () => {
                  const r = await entryApi.resolveResidual(card.id, row.id, stableCommand({ expected_version: row.row_version, disposition, reason }, `residual:${row.id}`))
                  reset()
                  return r
                })
              }
            />
          ) : null}

          <section className="rounded-xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
            <p>Paper, glue and parchment are settled by the monthly stock count against theory; packing material posts when Process closes.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/inventory/production-issue" className="erp-btn-secondary !h-8">
                Stores › Issue
              </Link>
              <Link href="/production/reconciliation" className="erp-btn-secondary !h-8">
                Reconciliation
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
