"use client"

// Box labels (owner decision 2026-11-01): every finished-goods box gets a sticker with the plant heading, the
// customer and product, the job card and order, the box code big and bold, the pcs (a part box marked), when
// and who packed it, and a QR that opens the box page. ?card=<job card id> prints the card's boxes, ?codes=a,b
// the boxes named; ?size=a4-8 | a4-21 | single picks the sheet. Printing or reprinting a label only counts the
// print on the box (audit) and never adds stock.

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Package, Printer } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Suspense, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { BackLink, EmptyBlock, Notice, PickPlant } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useSinglePlant } from "@/hooks/use-stock"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/api-stock"
import { BOX_LABEL_SIZES, boxDayText, boxesApi, boxesText, boxLabelPages, boxLabelSize, boxPageUrl, shiftShort, type Box, type BoxLabelSize } from "@/lib/boxes"
import { labelHeading } from "@/lib/reel-label"
import { cn } from "@/lib/utils"

/* Labels are paper: black on white in light and dark mode. Sizes inside a label are in cqw (1% of the label's
 * width), so the screen preview and the printed label are the same drawing at any width. */
const LABEL_CSS = `
.box-label { container-type: inline-size; box-sizing: border-box; display: flex; flex-direction: column; width: 100%; overflow: hidden;
  background: #fff; color: #000; border: 0.5mm solid #000; font-family: Arial, Helvetica, "Liberation Sans", sans-serif; line-height: 1.15;
  break-inside: avoid; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.box-label[data-size="a4-8"] { aspect-ratio: 97 / 70; max-width: 97mm; }
.box-label[data-size="single"] { aspect-ratio: 96 / 71; max-width: 96mm; }
.box-label[data-size="a4-21"] { aspect-ratio: 64 / 39.5; max-width: 64mm; }
.box-label * { box-sizing: border-box; }
.bl-head { padding: 1.4cqw 2cqw; border-bottom: 0.3mm solid #000; text-align: center; font-weight: 800; font-size: 4.4cqw; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-body { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2cqw; padding: 1.6cqw 2cqw; flex: 1 1 auto; min-height: 0; }
.bl-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 1.8cqw; row-gap: .5cqw; align-content: start; margin: 0; }
.bl-facts dt { font-size: 2.5cqw; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding-top: .45cqw; }
.bl-facts dd { margin: 0; font-size: 3.5cqw; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-qr { width: 25cqw; }
.bl-qr svg { display: block; width: 100%; height: auto; }
.bl-qr p { margin: .6cqw 0 0; font-size: 2.1cqw; text-align: center; font-weight: 700; }
.bl-code { padding: 1cqw 2cqw .4cqw; border-top: 0.3mm solid #000; font-weight: 900; letter-spacing: .01em; white-space: nowrap; text-align: center; line-height: 1.05; }
.bl-pcs { display: flex; align-items: center; justify-content: center; gap: 2.4cqw; padding: .4cqw 2cqw 1.2cqw; }
.bl-pcs b { font-size: 7cqw; font-weight: 900; }
.bl-part { background: #000; color: #fff; font-weight: 900; font-size: 4.4cqw; padding: .6cqw 2cqw; letter-spacing: .06em; }
.bl-foot { padding: 1.1cqw 2cqw; border-top: 0.3mm solid #000; font-size: 2.9cqw; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
/* Compact (A4 3 x 7): code and pcs on the left, QR on the right, three short lines. */
.box-label[data-size="a4-21"] .bl-head { font-size: 4.6cqw; padding: 1.2cqw 2.4cqw; }
.bl-compact { display: grid; grid-template-columns: minmax(0, 1fr) 28cqw; gap: 2.4cqw; padding: 1.6cqw 2.4cqw; flex: 1 1 auto; min-height: 0; }
.bl-compact .bl-code { border: 0; padding: 0; text-align: left; }
.bl-compact .bl-pcs { justify-content: flex-start; padding: .8cqw 0 1cqw; gap: 2cqw; }
.bl-compact .bl-pcs b { font-size: 6.6cqw; }
.bl-compact .bl-part { font-size: 4.4cqw; padding: .4cqw 1.6cqw; }
.bl-compact .bl-line { margin: 0; font-size: 4cqw; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-compact .bl-qr { width: 28cqw; align-self: center; }
/* The print copy lives at the end of <body>: hidden on screen, the only thing printed. */
.box-label-print { display: none; }
@media print {
  body:has(.box-label-print) > *:not(.box-label-print) { display: none !important; }
  body:has(.box-label-print) .box-label-print { display: block; }
  .box-label-print .box-label-page { break-after: page; page-break-after: always; }
  .box-label-print .box-label-page:last-child { break-after: auto; page-break-after: auto; }
  .box-label-print[data-size="a4-8"] .box-label-page, .box-label-print[data-size="a4-21"] .box-label-page { display: grid; justify-content: center; align-content: start; }
  .box-label-print[data-size="a4-8"] .box-label-page { grid-template-columns: repeat(2, 97mm); grid-auto-rows: 70mm; gap: 1.6mm 4mm; }
  .box-label-print[data-size="a4-21"] .box-label-page { grid-template-columns: repeat(3, 64mm); grid-auto-rows: 39.5mm; gap: 1.4mm 3mm; }
  .box-label-print .box-label { max-width: none; width: 100%; height: 100%; aspect-ratio: auto; }
  .box-label-print[data-size="single"] .box-label { width: 96mm; height: 71mm; }
}
`
/* The sheet prints one size at a time, so the page rule follows the chosen size (it comes after the app's A4 rule). */
const pageCss = (size: BoxLabelSize) => `@media print { @page { size: ${size === "single" ? "100mm 75mm" : "A4 portrait"}; margin: ${size === "single" ? "2mm" : "6mm"}; } }`

export default function BoxLabelsPage() {
  return (
    <Suspense fallback={<LoadingState label="Preparing box labels…" />}>
      <BoxLabelSheet />
    </Suspense>
  )
}

/** The box code as big as the space allows: long codes step down so they stay on one line. */
function codeSize(code: string, room: number, max: number) {
  return `${Math.min(max, room / Math.max(1, code.length * 0.6)).toFixed(2)}cqw`
}

function joined(...parts: (string | null | undefined)[]) {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(" · ")
}

function BoxLabel({ box, heading, size }: { box: Box; heading: string; size: BoxLabelSize }) {
  const url = boxPageUrl(box.box_code)
  const product = joined(box.product_code, box.spec_reference)
  const sizeColour = joined(box.size_label, box.colour)
  const order = joined(box.sales_order_no, box.customer_po ? `PO ${box.customer_po}` : "")
  const packed = joined(boxDayText(box.business_date || box.packed_at), shiftShort(box.shift_code), box.operator_name)
  const pcs = Number(box.qty || 0).toLocaleString("en-IN")
  const qr = <QRCodeSVG value={url} size={160} level="M" bgColor="#ffffff" fgColor="#000000" />

  if (size === "a4-21") {
    return (
      <article className="box-label" data-size={size} data-testid="box-label">
        <div className="bl-head">{heading || "FINISHED GOODS"}</div>
        <div className="bl-compact">
          <div className="min-w-0">
            <div className="bl-code" style={{ fontSize: codeSize(box.box_code, 58, 10) }} data-testid="box-label-code">{box.box_code}</div>
            <div className="bl-pcs"><b>{pcs} pcs</b>{box.is_part ? <span className="bl-part">PART BOX</span> : null}</div>
            {box.customer ? <p className="bl-line">{box.customer}</p> : null}
            {product || sizeColour ? <p className="bl-line">{joined(product, sizeColour)}</p> : null}
            <p className="bl-line">{joined(box.job_card_no ? `Card ${box.job_card_no}` : "", box.sales_order_no)}</p>
            {packed ? <p className="bl-line">{packed}</p> : null}
          </div>
          <div className="bl-qr">{qr}</div>
        </div>
      </article>
    )
  }

  return (
    <article className="box-label" data-size={size} data-testid="box-label">
      <div className="bl-head">{heading || "FINISHED GOODS"}</div>
      <div className="bl-body">
        <dl className="bl-facts">
          {box.customer ? <><dt>Customer</dt><dd>{box.customer}</dd></> : null}
          {product ? <><dt>Product</dt><dd>{product}</dd></> : null}
          {sizeColour ? <><dt>Size</dt><dd>{sizeColour}</dd></> : null}
          {box.job_card_no ? <><dt>Job card</dt><dd>{box.job_card_no}</dd></> : null}
          {order ? <><dt>Order</dt><dd>{order}</dd></> : null}
        </dl>
        <div className="bl-qr">{qr}<p>Scan for box</p></div>
      </div>
      <div className="bl-code" style={{ fontSize: codeSize(box.box_code, 92, 12) }} data-testid="box-label-code">{box.box_code}</div>
      <div className="bl-pcs"><b>{pcs} pcs</b>{box.is_part ? <span className="bl-part">PART BOX</span> : null}</div>
      <div className="bl-foot">{packed ? `Packed ${packed}` : "Packed"}</div>
    </article>
  )
}

function BoxLabelSheet() {
  const search = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const { activePlant } = useAuth()
  const single = useSinglePlant()
  const plants = usePlants()
  const card = (search.get("card") || "").trim()
  const codes = (search.get("codes") || "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean).join(",")
  const [size, setSize] = useState<BoxLabelSize>(() => boxLabelSize(search.get("size")))
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [printing, setPrinting] = useState(false)
  const [warning, setWarning] = useState("")
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const query = useQuery({
    queryKey: ["boxes", "labels", activePlant || "none", card, codes],
    enabled: single && Boolean(card || codes),
    queryFn: async () => {
      const { data } = await boxesApi.labels(card ? { job_card_id: card } : { codes })
      return (Array.isArray(data) ? data : []) as Box[]
    },
  })
  const boxes = useMemo(() => query.data || [], [query.data])
  const plant = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant) || String(row.code) === String(activePlant))
  const heading = labelHeading(plant)
  const chosen = useMemo(() => boxes.filter((box) => (picked ? picked.has(box.id) : true)), [boxes, picked])
  const cardIds = Array.from(new Set(boxes.map((box) => box.job_card_id)))
  const backCard = card || (cardIds.length === 1 ? cardIds[0] : "")
  const cardNo = boxes.find((box) => box.job_card_no)?.job_card_no

  const pickSize = (value: BoxLabelSize) => {
    setSize(value)
    const next = new URLSearchParams(search.toString())
    next.set("size", value)
    router.replace(`${pathname}?${next}`, { scroll: false })
  }
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current ?? boxes.map((box) => box.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const print = async () => {
    if (!chosen.length) return
    setPrinting(true)
    setWarning("")
    try {
      await boxesApi.printed(chosen.map((box) => box.id))
      void queryClient.invalidateQueries({ queryKey: ["boxes"] })
    } catch (error) {
      setWarning(`The print could not be counted on the boxes (${errorText(error)}). The labels still print.`)
    } finally {
      setPrinting(false)
    }
    window.setTimeout(() => window.print(), 50)
  }

  if (!single) return <PickPlant what="box labels" />
  const back = backCard ? <BackLink href={`/production/job-cards/${encodeURIComponent(backCard)}`}>Job card{cardNo ? ` ${cardNo}` : ""}</BackLink> : <BackLink href="/production/job-cards">Job cards</BackLink>
  if (!card && !codes) {
    return (
      <div className="space-y-4" data-testid="box-labels">
        {back}
        <PageHeader badge="Production" title="Box labels" description="Labels for finished-goods boxes, with a QR that opens the box." />
        <EmptyBlock icon={Package} title="Choose the boxes to print" message="Open box labels from a job card or a box page." action={<Link href="/production/job-cards" className="erp-btn-primary !h-11">Open Job cards</Link>} testId="box-labels-none" />
      </div>
    )
  }

  const pages = boxLabelPages(chosen, size)
  return (
    <div className="min-w-0 space-y-4" data-testid="box-labels">
      <style dangerouslySetInnerHTML={{ __html: LABEL_CSS + pageCss(size) }} />
      <div className="space-y-4">
        {back}
        <PageHeader badge="Production" title="Box labels" description={boxes.length ? `${cardNo && cardIds.length === 1 ? `Job card ${cardNo} · ` : ""}${boxesText(boxes)}` : "Labels for finished-goods boxes, with a QR that opens the box."}
          actions={boxes.length ? <button type="button" className="erp-btn-primary !h-11" onClick={() => void print()} disabled={!chosen.length || printing} data-testid="box-labels-print"><Printer className="h-4 w-4" aria-hidden="true" />{printing ? "Preparing…" : `Print ${chosen.length} label${chosen.length === 1 ? "" : "s"}`}</button> : null} />
      </div>
      {query.isLoading ? <LoadingState label="Preparing box labels…" /> : query.isError ? <ErrorState title="Box labels could not be prepared" message={errorText(query.error)} onRetry={() => void query.refetch()} /> : !boxes.length ? (
        <EmptyBlock icon={Package} title={card ? "No boxes on this job card yet" : "These boxes are not in this plant"} message={card ? "Boxes are packed from QC-cleared Process pcs; the last part box is packed when Process closes." : "The link may be old, or the boxes belong to another plant: check the plant at the top."} action={backCard ? <Link href={`/production/job-cards/${encodeURIComponent(backCard)}`} className="erp-btn-secondary !h-11">Open the job card</Link> : undefined} testId="box-labels-empty" />
      ) : (
        <>
          <section className="erp-panel space-y-4 rounded-xl p-4" aria-label="Label settings">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Label size</p>
              <div role="radiogroup" aria-label="Label size" className="mt-2 flex flex-wrap gap-2">
                {BOX_LABEL_SIZES.map((row) => (
                  <button key={row.value} type="button" role="radio" aria-checked={size === row.value} onClick={() => pickSize(row.value)} data-testid={`box-label-size-${row.value}`}
                    className={cn("min-h-11 rounded-lg border px-3 text-[13px] font-medium transition-colors", size === row.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}>
                    {row.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-foreground">Boxes to print <span className="font-normal text-muted-foreground">· {chosen.length} of {boxes.length}</span></p>
                <div className="flex gap-2">
                  <button type="button" className="erp-btn-secondary !h-9" onClick={() => setPicked(null)} data-testid="box-labels-all">Select all</button>
                  <button type="button" className="erp-btn-secondary !h-9" onClick={() => setPicked(new Set())} data-testid="box-labels-clear">Clear</button>
                </div>
              </div>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {boxes.map((box) => (
                  <li key={box.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[13px] hover:bg-muted">
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={picked ? picked.has(box.id) : true} onChange={() => toggle(box.id)} data-testid={`box-pick-${box.box_code}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono font-semibold text-foreground">{box.box_code}</span>
                        <span className="block truncate text-muted-foreground">{Number(box.qty || 0).toLocaleString("en-IN")} pcs{box.is_part ? " · part box" : ""}{box.label_prints ? ` · printed ${box.label_prints}×` : ""}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <Notice tone="blue">Reprinting a label only counts the print on the box. It never adds stock.</Notice>
            {warning ? <Notice tone="amber" testId="box-labels-warning">{warning}</Notice> : null}
          </section>
          {chosen.length ? (
            <div className={cn("grid gap-3", size === "a4-21" ? "grid-cols-2 sm:grid-cols-3" : size === "single" ? "max-w-[96mm]" : "sm:grid-cols-2 max-w-[200mm]")} data-testid="box-label-preview">
              {chosen.map((box) => <BoxLabel key={box.id} box={box} heading={heading} size={size} />)}
            </div>
          ) : <EmptyBlock icon={Package} title="No box chosen" message="Tick the boxes whose labels you want to print." testId="box-labels-none-picked" />}
          {mounted && chosen.length ? createPortal(
            <div className="box-label-print" data-size={size} aria-hidden="true">
              {pages.map((page, index) => <div key={index} className="box-label-page">{page.map((box) => <BoxLabel key={box.id} box={box} heading={heading} size={size} />)}</div>)}
            </div>,
            document.body,
          ) : null}
        </>
      )}
    </div>
  )
}
