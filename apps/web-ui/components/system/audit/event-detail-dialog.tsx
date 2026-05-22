"use client"

import { Copy, ExternalLink, X } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import {
  avatarTone,
  initials,
  relativeTime,
  severityClass,
  streamMeta,
  timestampText,
  type AuditEvent,
} from "./audit-shared"

export function EventDetailDialog({
  event,
  onClose,
}: {
  event: AuditEvent | null
  onClose: () => void
}) {
  if (!event) {
    return (
      <Dialog open={false} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="hidden" />
      </Dialog>
    )
  }

  const meta = streamMeta(event.stream)
  const Icon = meta.icon

  const handleCopy = () => {
    const text = `[AUDIT] ${event.streamLabel} · ${event.action} · actor=${event.actor} · ref=${event.reference} · at=${event.timestamp || "—"}`
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Audit event — {event.action}</DialogTitle>

        <div className="flex items-center gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-cyan-50/40 to-white px-6 py-5">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-base font-bold text-white shadow-md ring-1 ring-white/40",
              avatarTone(event.actor),
            )}
          >
            {initials(event.actor)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ background: meta.color + "1a", borderColor: meta.color + "55", color: meta.color }}
              >
                <Icon className="h-3 w-3" />
                {meta.short}
              </span>
              <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", severityClass(event.severity))}>
                {event.severity}
              </span>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {timestampText(event.timestamp)} · {relativeTime(event.timestamp)}
              </span>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
              {event.action.replaceAll("_", " ")}
            </h2>
            <p className="mt-0.5 text-[13px] font-medium text-slate-600">{event.summary}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-6 py-5">
          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Who · What · Where</p>
            <dl className="mt-3 grid gap-2 text-[12.5px]">
              <KV k="Actor" v={event.actor} />
              <KV k="Role" v={event.role || "—"} />
              <KV k="Entity" v={event.entityType} />
              <KV k="Reference" v={event.reference || "—"} mono />
              <KV k="Stream" v={event.streamLabel} />
              <KV k="Timestamp" v={timestampText(event.timestamp)} />
            </dl>
          </section>

          {event.details && Object.keys(event.details).length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Details</p>
              <pre className="mt-3 max-h-[220px] overflow-auto rounded-xl bg-slate-950 p-3 text-[11.5px] leading-5 text-slate-200">
                {JSON.stringify(event.details, null, 2)}
              </pre>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {event.href ? (
              <Link href={event.href}>
                <Button className="rounded-xl bg-slate-900 text-white hover:bg-slate-800">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open in module
                </Button>
              </Link>
            ) : null}
            <Button variant="outline" onClick={handleCopy} className="rounded-xl border-slate-200">
              <Copy className="mr-2 h-4 w-4" />
              Copy citation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-baseline gap-3">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{k}</dt>
      <dd className={cn("break-words font-semibold text-slate-900", mono ? "font-mono text-[12px]" : "")}>{v}</dd>
    </div>
  )
}
