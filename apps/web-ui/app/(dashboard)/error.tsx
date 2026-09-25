"use client"

import Link from "next/link"
import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

/** Keeps the shell and navigation alive when one page fails to render. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Workspace page failed to render", error)
  }, [error])
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-[var(--shadow-premium)] animate-enter-up">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-signal-rose-soft text-signal-rose-ink ring-1 ring-signal-rose-line"><AlertTriangle className="h-5 w-5" /></span>
      <h1 className="mt-4 text-[18px] font-semibold tracking-tight">This page couldn&apos;t load</h1>
      <p className="mt-1.5 text-[13.5px] leading-6 text-muted-foreground">Nothing was saved or changed. Retry, or open another workspace from the sidebar.{error?.digest ? ` Reference ${error.digest}.` : ""}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" className="erp-btn-primary" onClick={reset}><RotateCcw className="h-4 w-4" />Retry</button>
        <Link href="/inbox" className="erp-btn-secondary">Open inbox</Link>
      </div>
    </div>
  )
}
