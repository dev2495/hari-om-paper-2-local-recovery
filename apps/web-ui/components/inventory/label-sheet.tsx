"use client"

import "./label-sheet.css"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Printer } from "lucide-react"

import { cn } from "@/lib/utils"

export type LabelLayout = "sheet" | "single"

const LAYOUT_KEY = "hariom_label_layout"

/** A4 sheet (8 labels, as the plant prints them) or one label per page; remembered on this device. */
export function useLabelLayout(): [LabelLayout, (next: LabelLayout) => void] {
  const [layout, setLayout] = useState<LabelLayout>("sheet")
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY)
      if (saved === "single" || saved === "sheet") setLayout(saved)
    } catch {
      // private window: the A4 sheet stays the default
    }
  }, [])
  const choose = (next: LabelLayout) => {
    setLayout(next)
    try { window.localStorage.setItem(LAYOUT_KEY, next) } catch { /* not remembered */ }
  }
  return [layout, choose]
}

/** "A4 sheet · 8 per page" / "One label per page" switch and the print button, for a page header. */
export function LabelPrintBar({ layout, onLayout, count, onPrint, disabled, testId = "label-print" }: {
  layout: LabelLayout; onLayout: (next: LabelLayout) => void; count: number; onPrint?: () => void; disabled?: boolean; testId?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Label paper" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
        {([["sheet", "A4 sheet · 8 per page"], ["single", "One label per page"]] as const).map(([value, words]) => (
          <button key={value} type="button" role="radio" aria-checked={layout === value} onClick={() => onLayout(value)}
            className={cn("min-h-11 rounded-md px-3 text-[13px] font-semibold sm:min-h-9", layout === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            data-testid={`${testId}-layout-${value}`}>
            {words}
          </button>
        ))}
      </div>
      <button type="button" className="erp-btn-primary !h-11" onClick={onPrint || (() => window.print())} disabled={disabled || !count} data-testid={testId}>
        <Printer className="h-4 w-4" aria-hidden="true" />Print {count} label{count === 1 ? "" : "s"}
      </button>
    </div>
  )
}

/**
 * The labels on screen (a preview grid) and their print copy: a copy at the end of <body> that is the only
 * thing printed, so the page around it never pushes labels down or across a page break. ``layout`` picks the
 * A4 sheet of 8 (2 x 4, as the plant's Excel prints) or one label per page.
 */
export function LabelSheet({ layout, children, className, testId }: { layout: LabelLayout; children: ReactNode; className?: string; testId?: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => setHost(document.body), [])
  return (
    <>
      <div className={cn("grid justify-items-center gap-4 sm:grid-cols-2", className)} data-testid={testId}>{children}</div>
      {host ? createPortal(
        <div className="label-sheet-print" data-layout={layout} aria-hidden="true" data-testid={testId ? `${testId}-print` : undefined}>
          <div className="label-sheet-print__grid">{children}</div>
        </div>,
        host,
      ) : null}
    </>
  )
}
