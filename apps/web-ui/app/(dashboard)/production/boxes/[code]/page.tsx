"use client"

// The box page (owner decision 2026-11-01): what a box label's QR opens. The box's pcs (a part box marked),
// where it is (packed, dispatched on a challan, kept as surplus), its stock posting, QC flags from the runs in
// it (QC flags a box, it never holds it), when and who packed it, the runs and packing in it, and links to the
// job card, this label and the card's other boxes.

import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Package, Printer, Tags } from "lucide-react"
import type { ReactNode } from "react"

import { BackLink, EmptyBlock, Notice, PickPlant } from "@/components/inventory/stock-ui"
import { flagText, runNo, stampLabel, toneClass } from "@/components/production/card/model"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useSinglePlant } from "@/hooks/use-stock"
import { errorText } from "@/lib/api-stock"
import { boxDayText, boxesApi, boxStatusLabel, boxStockLabel, shiftShort, type Box } from "@/lib/boxes"
import { cn } from "@/lib/utils"

type Tone = Parameters<typeof toneClass>[0]

function Chip({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", toneClass(tone))} data-testid={testId}>{children}</span>
}

function Panel({ title, children, testId, className }: { title: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn("erp-panel min-w-0 rounded-xl p-4", className)} data-testid={testId}>
      <h2 className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] text-foreground">{children}</div>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

const statusTone: Record<string, Tone> = { PACKED: "blue", DISPATCHED: "emerald", RETAINED: "violet", VOID: "muted" }
const stockTone: Record<string, Tone> = { POSTED: "emerald", PENDING: "blue", FAILED: "amber" }

export default function BoxPage() {
  const params = useParams<{ code: string }>()
  const code = decodeURIComponent(String(params?.code || "")).trim().toUpperCase()
  const { activePlant } = useAuth()
  const single = useSinglePlant()
  const query = useQuery({
    queryKey: ["boxes", "by-code", activePlant || "none", code],
    enabled: single && Boolean(code),
    retry: (count, error: any) => Number(error?.response?.status) !== 404 && count < 2,
    queryFn: async () => (await boxesApi.byCode(code)).data as Box,
  })

  if (!single) return <PickPlant what="this box" />
  if (query.isLoading) return <LoadingState label={`Opening box ${code}…`} />
  if (query.isError) {
    if (Number((query.error as any)?.response?.status) === 404) {
      return (
        <div className="space-y-4" data-testid="box-page-missing">
          <BackLink href="/production/job-cards">Job cards</BackLink>
          <EmptyBlock icon={Package} title={`No box ${code} in this plant`} message="Check the plant at the top, or scan the label again." action={<Link href="/scan" className="erp-btn-secondary !h-11">Scan again</Link>} testId="box-missing" />
        </div>
      )
    }
    return <ErrorState title="This box could not be opened" message={errorText(query.error)} onRetry={() => void query.refetch()} />
  }
  const box = query.data
  if (!box) return null

  const cardHref = `/production/job-cards/${encodeURIComponent(box.job_card_id)}`
  const summary = box.card_summary
  const flags = box.qc_flags || []
  const lines = box.packaging?.lines || []
  const warnings = box.packaging?.warnings || []
  const runs = box.allocations || []
  const subtitle = [box.customer, [box.product_code, box.spec_reference].filter(Boolean).join(" · "), [box.size_label, box.colour].filter(Boolean).join(" · ")].filter(Boolean).join(" — ")

  return (
    <div className="min-w-0 space-y-4" data-testid="box-page">
      <BackLink href={cardHref}>Job card{box.job_card_no ? ` ${box.job_card_no}` : ""}</BackLink>
      <PageHeader badge={box.is_part ? "Part box" : "Box"} title={box.box_code} description={subtitle || undefined}
        actions={<>
          <Link href={`/production/boxes/labels?codes=${encodeURIComponent(box.box_code)}`} className="erp-btn-secondary !h-11" data-testid="box-print-label"><Printer className="h-4 w-4" aria-hidden="true" />Print this label</Link>
          <Link href={cardHref} className="erp-btn-primary !h-11" data-testid="box-open-card"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open job card</Link>
        </>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Panel title="Pcs in this box" testId="box-pcs">
          <p className="flex flex-wrap items-baseline gap-2"><span className="text-[30px] font-bold leading-none tabular-nums">{Number(box.qty || 0).toLocaleString("en-IN")}</span><span className="text-muted-foreground">pcs</span>{box.is_part ? <Chip tone="amber" testId="box-part-chip">Part box</Chip> : null}</p>
          <p className="text-[13px] text-muted-foreground">{box.qty_per_box ? `A full box holds ${Number(box.qty_per_box).toLocaleString("en-IN")} pcs.` : "The spec has no qty per box."}{box.box_master_code ? ` Box ${box.box_master_code}.` : ""}</p>
        </Panel>

        <Panel title="Status" testId="box-status">
          <p><Chip tone={statusTone[box.status] || "muted"}>{boxStatusLabel[box.status] || box.status}</Chip></p>
          {box.status === "DISPATCHED" ? (
            <p className="text-[13px]">On challan <span className="font-semibold">{box.challan_no || "—"}</span>{box.challan_date ? ` · ${boxDayText(box.challan_date)}` : box.dispatched_at ? ` · ${boxDayText(box.dispatched_at)}` : ""}</p>
          ) : box.status === "RETAINED" ? (
            <p className="text-[13px] text-muted-foreground">Kept in stock as surplus after the order was filled.</p>
          ) : box.status === "PACKED" ? (
            <p className="text-[13px] text-muted-foreground">Packed and waiting for dispatch.</p>
          ) : null}
        </Panel>

        <Panel title="Stock" testId="box-stock">
          <p><Chip tone={box.status === "DISPATCHED" ? "muted" : stockTone[box.fg_status] || "muted"} testId="box-stock-chip">{box.status === "DISPATCHED" ? "Shipped: out of stock" : boxStockLabel[box.fg_status] || box.fg_status}</Chip></p>
          <p className="text-[13px] text-muted-foreground">{box.status === "DISPATCHED" ? "The challan took this box's lot out of finished-goods stock." : "Each box is its own finished-goods lot in stock."}</p>
        </Panel>

        <Panel title="QC" testId="box-qc">
          {flags.length ? (
            <>
              <p><Chip tone="amber" testId="box-qc-flagged">QC flagged</Chip></p>
              <ul className="space-y-1 text-[13px]">
                {flags.map((flag, index) => <li key={index}>{flagText(flag)}{flag.entry_no != null ? <span className="text-muted-foreground"> · run {runNo({ stage: "PROCESS", entry_no: flag.entry_no })}</span> : null}</li>)}
              </ul>
              <p className="text-[12px] text-muted-foreground">Flagged only: QC never holds a box.</p>
            </>
          ) : <p><Chip tone="emerald">No QC flags</Chip></p>}
        </Panel>

        <Panel title="Packed" testId="box-packed">
          <dl>
            <Fact label="Date">{boxDayText(box.business_date || box.packed_at) || "—"}</Fact>
            <Fact label="Shift">{shiftShort(box.shift_code) || "—"}</Fact>
            <Fact label="Operator">{box.operator_name || "—"}</Fact>
            {box.packed_at ? <Fact label="Saved">{stampLabel(box.packed_at)}</Fact> : null}
            <Fact label="Label printed">{box.label_prints ? `${box.label_prints} time${box.label_prints === 1 ? "" : "s"}` : "Not yet"}</Fact>
          </dl>
        </Panel>

        <Panel title="Runs in this box" testId="box-runs">
          {runs.length ? (
            <ul className="space-y-1">
              {runs.map((run, index) => <li key={run.entry_id || index} className="flex justify-between gap-3 text-[13px]"><span className="font-medium">Process run {runNo({ stage: "PROCESS", entry_no: run.entry_no })}</span><span className="tabular-nums">{Number(run.pcs || 0).toLocaleString("en-IN")} pcs</span></li>)}
            </ul>
          ) : <p className="text-[13px] text-muted-foreground">No runs recorded on this box.</p>}
        </Panel>

        <Panel title="Packing in this box" testId="box-packing">
          {lines.length ? (
            <ul className="space-y-1">
              {lines.map((line, index) => <li key={`${line.code}-${index}`} className="flex justify-between gap-3 text-[13px]"><span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{line.code}</span> <span className="text-muted-foreground">{String(line.kind || "").toLowerCase()}</span></span><span className="shrink-0 tabular-nums">{Number(line.pcs || 0).toLocaleString("en-IN")} pcs</span></li>)}
            </ul>
          ) : <p className="text-[13px] text-muted-foreground">No packing material set on the spec.</p>}
          {warnings.map((warning, index) => <Notice key={index} tone="amber">{warning}</Notice>)}
        </Panel>

        <Panel title="This job card's boxes" testId="box-card-summary" className="sm:col-span-2 lg:col-span-2">
          {summary ? (
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label="Boxes">{summary.box_count} · {Number(summary.boxed_pcs || 0).toLocaleString("en-IN")} pcs</Fact>
              <Fact label="Ready to dispatch">{summary.ready_boxes} · {Number(summary.ready_pcs || 0).toLocaleString("en-IN")} pcs</Fact>
              <Fact label="Dispatched">{summary.dispatched_boxes} · {Number(summary.dispatched_pcs || 0).toLocaleString("en-IN")} pcs</Fact>
              <Fact label="Kept as surplus">{summary.retained_boxes} · {Number(summary.retained_pcs || 0).toLocaleString("en-IN")} pcs</Fact>
              {summary.part_boxes ? <Fact label="Part boxes">{summary.part_boxes}</Fact> : null}
              {summary.flagged_boxes ? <Fact label="QC flagged">{summary.flagged_boxes}</Fact> : null}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={cardHref} className="erp-btn-secondary !h-11">Job card{box.job_card_no ? ` ${box.job_card_no}` : ""}</Link>
            <Link href={`/production/boxes/labels?card=${encodeURIComponent(box.job_card_id)}`} className="erp-btn-secondary !h-11" data-testid="box-card-labels"><Tags className="h-4 w-4" aria-hidden="true" />All box labels of this card</Link>
          </div>
        </Panel>
      </div>
    </div>
  )
}
