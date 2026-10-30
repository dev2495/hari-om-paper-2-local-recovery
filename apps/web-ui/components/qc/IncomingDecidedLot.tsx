"use client"

import Link from "next/link"
import { ArrowLeft, BadgeCheck, Ban, CircleSlash, Hand, TriangleAlert } from "lucide-react"

import { Chip } from "@/components/sales/order-chips"
import { LoadingState } from "@/components/workspace/query-state"
import { usePeopleVersion } from "@/hooks/use-people"
import { personLabel } from "@/lib/people"
import { timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

/** What a saved incoming check means, in plain words (never PASS / REJECT codes). */
function outcome(row: any): { word: string; tone: "emerald" | "amber" | "rose" | "slate"; icon: any; detail: string } {
  const status = String(row?.status || "").toUpperCase()
  const disposition = String(row?.disposition || "").toUpperCase()
  const stock = String(row?.stock_status || "").toUpperCase()
  if (["REJECT", "BLOCK", "SCRAP"].includes(disposition)) return { word: "Rejected", tone: "rose", icon: Ban, detail: "Kept out of issue. Store returns it to the supplier, or the plant head allows a concession." }
  if (disposition === "HOLD") return { word: "On hold", tone: "amber", icon: Hand, detail: "QC kept it out of issue for review." }
  if (status === "PASS" && stock === "UNRESTRICTED") return { word: "Passed · released", tone: "emerald", icon: BadgeCheck, detail: "Every check was within its band, so the lot can be issued to the floor." }
  if (status === "PASS") return { word: "Passed", tone: "emerald", icon: BadgeCheck, detail: "Every check was within its band." }
  if (status === "FAIL") return { word: "Failed", tone: "rose", icon: TriangleAlert, detail: "At least one check was outside its band, so the lot stayed on hold." }
  return { word: "Readings incomplete", tone: "amber", icon: CircleSlash, detail: "Some required readings were missing." }
}

const VERDICT: Record<string, { word: string; className: string }> = {
  PASS: { word: "In band", className: "text-signal-emerald-ink" },
  FAIL: { word: "Out of band", className: "text-signal-rose-ink" },
  INVALID: { word: "Not valid", className: "text-signal-rose-ink" },
  OBSERVATION_ONLY: { word: "Recorded", className: "text-muted-foreground" },
}

function readingValue(result: any) {
  const value = result?.value ?? result?.submitted
  if (value === null || value === undefined || value === "") return "—"
  const text = typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : String(value)
  return result?.unit ? `${text} ${result.unit}` : text
}

/**
 * A lot opened from a link (GRN page, inward list, scan) whose incoming check is already decided:
 * its saved result, read-only. A new check is entered only while a lot is on QC hold.
 */
export function IncomingDecidedLot({ lotLabel, inspections, loading, back }: { lotLabel?: string; inspections: any[]; loading: boolean; back?: { href: string; label: string } | null }) {
  usePeopleVersion()
  // The page scrolls to this panel, so the way back sits inside it as well as at the top of the page.
  const backLink = back ? <Link href={back.href} className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-panel-back"><ArrowLeft className="h-4 w-4" /> {back.label}</Link> : null
  if (loading) return <section className="erp-panel rounded-xl p-6"><LoadingState label="Loading this lot's QC result…" /></section>
  const latest = inspections[0]
  if (!latest) {
    return (
      <section className="erp-panel scroll-mt-20 rounded-xl p-5" data-testid="incoming-linked-missing">
        <h2 className="text-[16px] font-semibold text-foreground">{lotLabel ? `${lotLabel} was` : "This lot was"} not found or is already decided</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">It is not waiting for incoming QC and has no saved check here. Open it from the GRN register to see its inward and QC state.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {backLink}
          {back?.href.startsWith("/purchase/receipts") && !back.href.startsWith("/purchase/receipts/") ? null : <Link href="/purchase/receipts" className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-open-register">Open the GRN register</Link>}
        </div>
      </section>
    )
  }
  const result = outcome(latest)
  const Icon = result.icon
  const readings: any[] = Array.isArray(latest?.evaluation?.parameter_results) ? latest.evaluation.parameter_results : []
  const fallback = readings.length ? [] : Object.entries(latest?.readings || {}).filter(([code]) => code !== "remark")
  return (
    <section className="erp-panel scroll-mt-20 rounded-xl p-4 sm:p-5" data-testid="incoming-decided-lot">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Incoming QC result · read-only</p>
          <h2 className="mt-0.5 text-[19px] font-semibold tracking-tight text-foreground">{latest.entity_label || lotLabel || "Lot"}</h2>
          <p className="text-[13px] text-muted-foreground">Checked {timeText(latest.created_at)} by {personLabel(latest.created_by)}</p>
        </div>
        <Chip tone={result.tone} icon={Icon}>{result.word}</Chip>
      </div>
      <p className={cn("mt-3 rounded-lg border px-3 py-2 text-[13px] leading-5", result.tone === "emerald" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : result.tone === "rose" ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")}>
        {result.detail} This lot is already decided, so nothing here can be changed.
      </p>
      {backLink ? <div className="mt-3">{backLink}</div> : null}
      {readings.length || fallback.length ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-border" data-testid="incoming-decided-readings">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-muted text-[11.5px] font-semibold text-muted-foreground">
              <tr><th className="px-3 py-2">Check</th><th className="px-3 py-2">Reading</th><th className="hidden px-3 py-2 sm:table-cell">Allowed</th><th className="px-3 py-2">Result</th></tr>
            </thead>
            <tbody>
              {readings.map((row) => {
                const verdict = VERDICT[String(row.verdict || "").toUpperCase()] || { word: String(row.verdict || "—"), className: "text-muted-foreground" }
                return (
                  <tr key={row.code} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{row.label || row.code}</td>
                    <td className="px-3 py-2 tabular-nums">{readingValue(row)}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{String(row.allowed_display || "").replace(/^Allowed: /, "") || "—"}</td>
                    <td className={cn("px-3 py-2 font-semibold", verdict.className)}>{verdict.word}</td>
                  </tr>
                )
              })}
              {fallback.map(([code, value]) => (
                <tr key={code} className="border-t border-border"><td className="px-3 py-2 font-medium">{code}</td><td className="px-3 py-2 tabular-nums">{String(value)}</td><td className="hidden px-3 py-2 sm:table-cell">—</td><td className="px-3 py-2">—</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {latest.notes || latest.readings?.remark ? <p className="mt-3 text-[12.5px] text-muted-foreground">Note: {latest.notes || latest.readings.remark}</p> : null}
      {inspections.length > 1 ? <p className="mt-2 text-[12px] text-muted-foreground">{inspections.length - 1} earlier check{inspections.length === 2 ? "" : "s"} on this lot are kept in its history.</p> : null}
    </section>
  )
}
