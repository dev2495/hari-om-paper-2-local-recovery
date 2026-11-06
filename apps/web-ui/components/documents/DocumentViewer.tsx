"use client"

/**
 * Doc Vault viewer (6 Nov 2026): one document, page by page. Photos zoom with pinch, the mouse wheel or
 * the + / − buttons, pan by dragging when zoomed, and rotate in quarter turns; PDFs open inline.
 * Keys: ← → pages, + − zoom, 0 fit, R rotate. Theme tokens only, so dark mode works.
 */
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Maximize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react"

import { fileUrl, type DocPage, type VaultDocument } from "@/lib/api-documents"
import { cn } from "@/lib/utils"

const MIN_SCALE = 1
const MAX_SCALE = 6

type View = { scale: number; x: number; y: number; rotation: number }
const FIT: View = { scale: 1, x: 0, y: 0, rotation: 0 }

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function pagesOf(document: VaultDocument): DocPage[] {
  if (document.page_list?.length) return document.page_list
  return [{ page_no: 1, mime: document.mime, bytes: document.bytes, width: null, height: null, pdf_pages: null, file_url: document.file_url, thumb_url: document.thumb_url, uploaded_by: document.uploaded_by, uploaded_at: document.uploaded_at }]
}

export function DocumentViewer({ document, initialPage = 1, className }: { document: VaultDocument; initialPage?: number; className?: string }) {
  const pages = pagesOf(document)
  const [pageNo, setPageNo] = useState(Math.min(Math.max(1, initialPage), pages.length))
  const [view, setView] = useState<View>(FIT)
  const [failed, setFailed] = useState(false)
  const frame = useRef<HTMLDivElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)

  const page = pages.find((row) => row.page_no === pageNo) || pages[0]
  const isPdf = page.mime === "application/pdf"
  const src = fileUrl(page.file_url)

  useEffect(() => { setView(FIT); setFailed(false) }, [pageNo, document.id])
  useEffect(() => { setPageNo(Math.min(Math.max(1, initialPage), pages.length)) }, [document.id, initialPage, pages.length])

  const zoom = useCallback((factor: number) => setView((current) => {
    const scale = clampScale(current.scale * factor)
    return scale === 1 ? { ...current, scale, x: 0, y: 0 } : { ...current, scale }
  }), [])
  const rotate = () => setView((current) => ({ ...current, rotation: (current.rotation + 90) % 360 }))
  const go = (delta: number) => setPageNo((current) => Math.min(pages.length, Math.max(1, current + delta)))

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    if (key === "ArrowRight" || key === "PageDown") { go(1); event.preventDefault() }
    else if (key === "ArrowLeft" || key === "PageUp") { go(-1); event.preventDefault() }
    else if (!isPdf && (key === "+" || key === "=")) { zoom(1.25); event.preventDefault() }
    else if (!isPdf && key === "-") { zoom(0.8); event.preventDefault() }
    else if (!isPdf && key === "0") { setView(FIT); event.preventDefault() }
    else if (!isPdf && (key === "r" || key === "R")) { rotate(); event.preventDefault() }
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isPdf) return
    if (!event.ctrlKey && view.scale === 1 && Math.abs(event.deltaY) < 40) return
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1.15 : 0.87)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isPdf) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values())
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
      drag.current = null
    } else if (pointers.current.size === 1 && view.scale > 1) {
      drag.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y }
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values())
      const scale = clampScale(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance)))
      setView((current) => (scale === 1 ? { ...current, scale, x: 0, y: 0 } : { ...current, scale }))
    } else if (drag.current) {
      const start = drag.current
      setView((current) => ({ ...current, x: start.startX + (event.clientX - start.x), y: start.startY + (event.clientY - start.y) }))
    }
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!pointers.current.size) drag.current = null
  }

  const button = "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground transition hover:bg-muted disabled:opacity-40 sm:h-9 sm:w-9"
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)} data-testid="document-viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" className={button} onClick={() => go(-1)} disabled={pageNo <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[78px] text-center text-[12.5px] font-semibold tabular-nums text-foreground" aria-live="polite">Page {pageNo} of {pages.length}</span>
          <button type="button" className={button} onClick={() => go(1)} disabled={pageNo >= pages.length} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-1.5">
          {!isPdf ? <>
            <button type="button" className={button} onClick={() => zoom(0.8)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
            <button type="button" className={button} onClick={() => zoom(1.25)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
            <button type="button" className={button} onClick={() => setView(FIT)} aria-label="Fit to screen"><Maximize2 className="h-4 w-4" /></button>
            <button type="button" className={button} onClick={rotate} aria-label="Rotate a quarter turn"><RotateCw className="h-4 w-4" /></button>
          </> : null}
          <a className={button} href={src} target="_blank" rel="noreferrer" aria-label="Open in a new tab"><ExternalLink className="h-4 w-4" /></a>
          <a className={button} href={fileUrl(page.file_url, true)} aria-label="Download this page"><Download className="h-4 w-4" /></a>
        </div>
      </div>
      <div
        ref={frame}
        tabIndex={0}
        role="region"
        aria-label={`${document.doc_no}, page ${pageNo}. Use the arrow keys for pages, plus and minus to zoom, R to rotate.`}
        onKeyDown={onKey}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => (view.scale > 1 ? setView((current) => ({ ...FIT, rotation: current.rotation })) : zoom(2))}
        className={cn(
          "relative min-h-[320px] flex-1 overflow-hidden rounded-xl border border-border bg-[hsl(var(--surface-2))] outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !isPdf && "touch-none select-none",
          !isPdf && view.scale > 1 ? "cursor-grab active:cursor-grabbing" : "",
        )}
      >
        {isPdf ? (
          <iframe key={src} src={src} title={`${document.doc_no} page ${pageNo}`} className="absolute inset-0 h-full w-full bg-white" />
        ) : failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileText className="h-8 w-8" aria-hidden="true" />
            This page could not be shown. Open it in a new tab, or ask the Admin to check document storage.
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={`${document.kind_label} ${document.doc_no}, page ${pageNo}`}
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain transition-transform duration-75 will-change-transform"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotation}deg)` }}
          />
        )}
      </div>
      {pages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Pages">
          {pages.map((row) => (
            <button
              key={row.page_no}
              type="button"
              onClick={() => setPageNo(row.page_no)}
              aria-label={`Page ${row.page_no}`}
              aria-current={row.page_no === pageNo}
              className={cn("relative h-16 w-14 shrink-0 overflow-hidden rounded-lg border bg-card", row.page_no === pageNo ? "border-primary ring-2 ring-primary/30" : "border-border")}
            >
              {row.thumb_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(row.thumb_url)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10.5px] font-semibold text-muted-foreground"><FileText className="h-4 w-4" aria-hidden="true" /></span>
              )}
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-card/90 px-1 text-[10px] font-semibold tabular-nums text-foreground">{row.page_no}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
