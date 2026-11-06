"use client"

/** Doc Vault detail drawer (6 Nov 2026): the viewer, the facts, link chips that open the record, history and void. */
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Ban, Camera, FilePlus2, History, Link2, Loader2, Search, X } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"

import { DocumentViewer } from "@/components/documents/DocumentViewer"
import { Chip } from "@/components/inventory/stock-ui"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { useAuth } from "@/context/AuthContext"
import { useDocumentActions, useVaultDocument } from "@/hooks/use-documents"
import { purchaseApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-error"
import type { VaultDocument } from "@/lib/api-documents"
import { fileSizeText, queueDocumentPages, UploadRefused, type DocEntityType } from "@/lib/doc-upload"
import { dayText, timeText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const SOURCE_WORDS: Record<string, string> = { GATE: "Gate", STORE: "Stores", QC: "Quality", DISPATCH: "Dispatch", SYSTEM: "System copy" }
const ACTION_WORDS: Record<string, string> = { UPLOAD: "Saved", ADD_PAGE: "Added a page", LINK: "Linked", UNLINK: "Unlinked", EDIT: "Corrected", VOID: "Voided" }
const LINK_WORDS: Partial<Record<DocEntityType, string>> = { GRN: "GRN", REEL: "Reel", BATCH: "Lot", GATE_ENTRY: "Gate entry", VISIT: "Visit", DISPATCH: "Dispatch", DEBIT_NOTE: "Debit note", PO: "PO", WEIGHT_VARIANCE: "Weight case" }

export function money(value: number | null | undefined) {
  return value == null ? "" : `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function historyLine(event: NonNullable<VaultDocument["history"]>[number]) {
  const detail = event.detail || {}
  if (event.action === "LINK" || event.action === "UNLINK") return detail.label || `${detail.entity_type} ${detail.entity_id}`
  if (event.action === "VOID") return detail.reason || ""
  if (event.action === "ADD_PAGE") return `Page ${detail.page_no}`
  if (event.action === "EDIT") return Object.keys(detail.after || {}).map((key) => key.replace("_", " ")).join(", ")
  if (event.action === "UPLOAD") return detail.bytes ? fileSizeText(Number(detail.bytes)) : ""
  return ""
}

function GrnLinkPicker({ onPick, busy }: { onPick: (receiptId: string) => void; busy: boolean }) {
  const { activePlant } = useAuth()
  const [q, setQ] = useState("")
  const search = q.trim()
  const results = useQuery({
    queryKey: ["documents", "grn-search", activePlant, search],
    queryFn: () => purchaseApi.getGovernedReceipts({ q: search, limit: 6, offset: 0 }).then((r) => (r.data?.items || []) as any[]),
    enabled: search.length >= 2 && Boolean(activePlant && activePlant !== "ALL"),
  })
  return (
    <div className="space-y-2 rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3">
      <label className="block text-[12.5px] font-semibold text-foreground" htmlFor="doc-grn-search">Link to a GRN</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input id="doc-grn-search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="GRN no., vendor, challan or invoice"
          className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-[13px] outline-none focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 sm:h-9" />
      </div>
      {search.length >= 2 ? (
        results.isLoading ? <p className="text-xs text-muted-foreground">Looking…</p>
          : results.data?.length ? (
            <ul className="space-y-1">
              {results.data.map((row) => (
                <li key={row.id}>
                  <button type="button" disabled={busy} onClick={() => onPick(row.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-[13px] hover:border-primary/50 disabled:opacity-60 sm:min-h-9">
                    <span className="min-w-0"><span className="font-semibold">{row.grn_no}</span><span className="block truncate text-xs text-muted-foreground">{row.supplier_name || "—"} · challan {row.supplier_challan_no || "—"}</span></span>
                    <Link2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">No GRN matches “{search}”.</p>
      ) : <p className="text-xs text-muted-foreground">Type at least 2 letters.</p>}
    </div>
  )
}

export function DocumentDrawer({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const { activePlant } = useAuth()
  const query = useVaultDocument(documentId)
  const actions = useDocumentActions()
  const voidReason = useReasonChoice("DOC_VOID")
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [linking, setLinking] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const camera = useRef<HTMLInputElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const document = query.data
  const writable = Boolean(activePlant && activePlant !== "ALL")
  const active = document?.status === "ACTIVE"

  const addPages = async (files: FileList | null) => {
    if (!document || !files?.length) return
    try {
      await queueDocumentPages(document.id, Array.from(files), { plantId: activePlant, kind: document.kind })
      setMessage({ tone: "ok", text: `${files.length === 1 ? "The page is" : `${files.length} pages are`} on the way. They show here once sent.` })
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof UploadRefused ? error.message : describeApiError(error, "The page could not be added.") })
    }
  }

  const fail = (error: unknown, fallback: string) => setMessage({ tone: "error", text: describeApiError(error, fallback) })

  return (
    <DialogPrimitive.Root open={Boolean(documentId)} onOpenChange={(open) => { if (!open) { onClose(); setMessage(null); setLinking(false) } }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tube-overlay fixed inset-0 z-50 bg-[hsl(224_30%_6%/.42)] backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          data-testid="document-drawer"
          className="fixed inset-0 z-50 flex flex-col bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(980px,100vw)] sm:border-l sm:border-border"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="flex flex-wrap items-center gap-2 text-[16px] font-semibold tracking-tight text-foreground">
                {document?.doc_no || "Document"}
                {document ? <Chip tone={document.kind === "DEBIT_NOTE" ? "violet" : "blue"}>{document.kind_label}</Chip> : null}
                {document?.status === "VOID" ? <Chip tone="rose">Void</Chip> : null}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                {document ? [document.party_name, document.ref_no && `No. ${document.ref_no}`, document.ref_date && dayText(document.ref_date)].filter(Boolean).join(" · ") || "No party or number yet" : "Loading…"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>

          {query.isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening the document…</div>
          ) : query.isError || !document ? (
            <div className="m-5 rounded-xl border border-signal-rose-line bg-signal-rose-soft p-4 text-sm text-signal-rose-ink" role="alert">
              {describeApiError(query.error, "This document could not be opened.")} Close and try again.
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
              <div className="flex min-h-[60vh] flex-col p-4 sm:p-5 lg:min-h-0">
                <DocumentViewer document={document} className="flex-1" />
              </div>
              <aside className="space-y-4 border-t border-border p-4 sm:p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
                {message ? <p role={message.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-[12.5px] leading-5", message.tone === "error" ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink")}>{message.text}</p> : null}
                {document.status === "VOID" ? (
                  <p className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] leading-5 text-signal-rose-ink">
                    Voided by {who(document.voided_by)} · {timeText(document.voided_at)}. {document.void_reason}. The file is kept.
                  </p>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
                  <div><dt className="text-muted-foreground">Party</dt><dd className="font-semibold text-foreground">{document.party_name || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Number · date</dt><dd className="font-semibold text-foreground">{document.ref_no || "—"}{document.ref_date ? ` · ${dayText(document.ref_date)}` : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold tabular-nums text-foreground">{money(document.amount) || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Pages</dt><dd className="font-semibold tabular-nums text-foreground">{document.pages} · {fileSizeText(document.bytes)}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">Saved</dt><dd className="font-semibold text-foreground">{SOURCE_WORDS[document.source] || document.source} · {who(document.uploaded_by)} · {timeText(document.uploaded_at)}</dd></div>
                  {document.category ? <div className="col-span-2"><dt className="text-muted-foreground">Category</dt><dd className="font-semibold text-foreground">{document.category}</dd></div> : null}
                </dl>

                <section className="space-y-2">
                  <h3 className="text-[12.5px] font-semibold text-foreground">Linked to</h3>
                  {document.links.length ? (
                    <ul className="flex flex-wrap gap-2" data-testid="document-links">
                      {document.links.map((link) => (
                        <li key={`${link.entity_type}:${link.entity_id}`} className="inline-flex items-center overflow-hidden rounded-full border border-signal-cyan-line bg-signal-cyan-soft text-[12px] font-semibold text-signal-cyan-ink">
                          {link.href ? <Link href={link.href} className="px-3 py-1.5 hover:underline" onClick={onClose}>{link.label || `${LINK_WORDS[link.entity_type] || link.entity_type} ${link.entity_id}`}</Link>
                            : <span className="px-3 py-1.5">{link.label || link.entity_id}</span>}
                          {document.can?.unlink && writable ? (
                            <button type="button" aria-label={`Unlink ${link.label || link.entity_id}`} disabled={actions.unlink.isPending}
                              className="grid h-8 w-8 place-items-center border-l border-signal-cyan-line hover:bg-signal-cyan-line/40"
                              onClick={() => actions.unlink.mutate({ id: document.id, entityType: link.entity_type, entityId: link.entity_id }, { onError: (error) => fail(error, "The link could not be removed."), onSuccess: () => setMessage({ tone: "ok", text: "Link removed. It stays in the history." }) })}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[12.5px] text-muted-foreground">{["VENDOR_BILL", "VENDOR_CHALLAN"].includes(document.kind) ? "Not linked to a GRN yet. Stores links it when the GRN is made." : "Not linked to any record."}</p>}
                  {active && writable && document.can?.edit ? (
                    linking ? <GrnLinkPicker busy={actions.link.isPending} onPick={(receiptId) => actions.link.mutate({ id: document.id, entityType: "GRN", entityId: receiptId }, {
                      onSuccess: () => { setLinking(false); setMessage({ tone: "ok", text: "Linked. The document now shows on the GRN." }) },
                      onError: (error) => fail(error, "The document could not be linked."),
                    })} />
                      : <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={() => setLinking(true)}><Link2 className="h-4 w-4" /> Link to a GRN</button>
                  ) : null}
                </section>

                {active && writable && document.can?.add_page ? (
                  <section className="space-y-2">
                    <h3 className="text-[12.5px] font-semibold text-foreground">More pages</h3>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={() => camera.current?.click()}><Camera className="h-4 w-4" /> Photo of next page</button>
                      <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={() => picker.current?.click()}><FilePlus2 className="h-4 w-4" /> Add file</button>
                    </div>
                    <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(event) => { void addPages(event.target.files); event.target.value = "" }} />
                    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" tabIndex={-1} onChange={(event) => { void addPages(event.target.files); event.target.value = "" }} />
                  </section>
                ) : null}

                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground"><History className="h-3.5 w-3.5" aria-hidden="true" /> History</h3>
                  <ol className="space-y-2" data-testid="document-history">
                    {(document.history || []).map((event, index) => (
                      <li key={index} className="border-l-2 border-signal-cyan-line pl-3 text-[12px] leading-5">
                        <span className="font-semibold text-foreground">{ACTION_WORDS[event.action] || event.action}</span>
                        <span className="text-muted-foreground"> · {who(event.actor)} · {timeText(event.at)}</span>
                        {historyLine(event) ? <p className="text-muted-foreground">{historyLine(event)}</p> : null}
                      </li>
                    ))}
                  </ol>
                </section>

                {document.can?.void && writable ? (
                  confirmVoid ? (
                    <section className="space-y-3 rounded-xl border border-signal-rose-line bg-signal-rose-soft/60 p-3" data-testid="document-void-form">
                      <p className="text-[12.5px] leading-5 text-foreground">Void {document.doc_no}? Nothing is deleted: it is hidden from the vault and the record pages, and stays in the history.</p>
                      <ReasonPicker category="DOC_VOID" label="Why void" value={voidReason.value} onChange={voidReason.setValue} showErrors={voidReason.touched} compact testIdPrefix="document:void" />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="erp-btn-secondary max-sm:h-11" disabled={actions.voidDocument.isPending} onClick={() => { setConfirmVoid(false); voidReason.reset() }}>Keep it</button>
                        <button type="button" data-testid="document-void-confirm" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-700 px-3 text-[13px] font-semibold text-white hover:bg-rose-800 disabled:opacity-60 max-sm:h-11" disabled={actions.voidDocument.isPending}
                          onClick={() => {
                            if (!voidReason.validate()) return
                            actions.voidDocument.mutate({ id: document.id, expected_version: document.version, reason_code: voidReason.value.code.trim().toUpperCase(), reason_note: String(voidReason.value.note || "").trim() || null }, {
                              onSuccess: () => { setConfirmVoid(false); voidReason.reset(); setMessage({ tone: "ok", text: `${document.doc_no} is void. The file and its history are kept.` }) },
                              onError: (error) => fail(error, "The document could not be voided."),
                            })
                          }}>
                          {actions.voidDocument.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Void document
                        </button>
                      </div>
                    </section>
                  ) : (
                    <button type="button" className="erp-btn-secondary w-full justify-center text-signal-rose-ink max-sm:h-11" onClick={() => { voidReason.reset(); setConfirmVoid(true) }}>
                      <Ban className="h-4 w-4" /> Void document
                    </button>
                  )
                ) : null}
                {!writable ? <p className="text-[12px] text-muted-foreground">All plants is view-only. Pick one plant at the top to link, add pages or void.</p> : null}
              </aside>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
