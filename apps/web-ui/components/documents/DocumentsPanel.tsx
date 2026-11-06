"use client"

/**
 * Documents of one record (6 Nov 2026): the bills, challans and photos linked to a GRN, debit note,
 * gate entry … with thumbnails, a camera / file button and the viewer.
 *
 *   <DocumentsPanel entityType="GRN" entityId={receipt.id} kinds={["VENDOR_BILL", "VENDOR_CHALLAN"]} />
 *
 * Files added here are linked to the record when they are saved. They go through the outbox
 * (lib/doc-upload.ts), so a weak network only delays them.
 */
import { AlertTriangle, Camera, CheckCircle2, FilePlus2, FileText, Loader2, RotateCcw, X } from "lucide-react"
import { useMemo, useRef, useState, type ReactNode } from "react"

import { DocumentDrawer } from "@/components/documents/DocumentDrawer"
import { useAuth } from "@/context/AuthContext"
import { useDocumentOutbox, useEntityDocuments } from "@/hooks/use-documents"
import { describeApiError } from "@/lib/api-error"
import { fileUrl, type VaultDocument } from "@/lib/api-documents"
import {
  DOC_KIND_LABELS, discardOutboxItem, queueDocumentFiles, retryOutbox, UploadRefused,
  type DocEntityType, type DocKind, type OutboxItem, type UploadMeta,
} from "@/lib/doc-upload"
import { timeText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const control = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold max-sm:h-11"

export function DocumentThumb({ document, className }: { document: VaultDocument; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (document.thumb_url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fileUrl(document.thumb_url)} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("h-full w-full object-cover", className)} />
  }
  return (
    <span className={cn("flex h-full w-full flex-col items-center justify-center gap-1 bg-[hsl(var(--surface-2))] text-muted-foreground", className)}>
      <FileText className="h-6 w-6" aria-hidden="true" />
      <span className="text-[10.5px] font-semibold">{document.mime === "application/pdf" ? "PDF" : "File"}</span>
    </span>
  )
}

export function OutboxStrip({ items }: { items: OutboxItem[] }) {
  if (!items.length) return null
  const sending = items.filter((item) => item.status === "uploading" || item.status === "waiting")
  const failed = items.filter((item) => item.status === "failed")
  const saved = items.filter((item) => item.status === "done")
  const progress = sending.length ? Math.round((sending.reduce((sum, item) => sum + item.progress, 0) / sending.length) * 100) : 0
  const offline = sending.some((item) => item.error)
  return (
    <div className="space-y-2" data-testid="document-outbox">
      {sending.length ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft px-3 py-2 text-[12.5px] text-signal-cyan-ink">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="font-semibold">{sending.length === 1 ? "1 file" : `${sending.length} files`} uploading{progress ? ` · ${progress}%` : ""}</span>
          {offline ? <span>{sending.find((item) => item.error)?.error}</span> : <span>You can keep working; they are kept on this device until sent.</span>}
        </div>
      ) : null}
      {failed.map((item) => (
        <div key={item.id} role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="font-semibold">{item.name}</span>: {item.error}</span>
          <button type="button" className={cn(control, "border border-signal-rose-line bg-card")} onClick={() => void retryOutbox()}><RotateCcw className="h-3.5 w-3.5" /> Try again</button>
          <button type="button" className={cn(control, "border border-signal-rose-line bg-card")} onClick={() => void discardOutboxItem(item.id)} aria-label={`Remove ${item.name} from the upload list`}><X className="h-3.5 w-3.5" /> Remove</button>
        </div>
      ))}
      {saved.length && !sending.length ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-[12.5px] text-signal-emerald-ink">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved {Array.from(new Set(saved.map((item) => item.docNo).filter(Boolean))).join(", ") || "to the Doc Vault"}.
        </div>
      ) : null}
    </div>
  )
}

/** The camera + file buttons. One press = one document (several files picked together become its pages). */
export function AddDocumentButtons({ kinds, meta, onQueued, compact = false, testId = "document-add" }: {
  kinds: DocKind[]
  meta?: Omit<UploadMeta, "kind">
  onQueued?: (group: string) => void
  compact?: boolean
  testId?: string
}) {
  const { activePlant } = useAuth()
  const [kind, setKind] = useState<DocKind>(kinds[0] || "OTHER")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const camera = useRef<HTMLInputElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const writable = Boolean(activePlant && activePlant !== "ALL")

  const queue = async (files: FileList | null) => {
    if (!files?.length) return
    setError("")
    setBusy(true)
    try {
      const group = await queueDocumentFiles(Array.from(files), { ...(meta || {}), kind }, { plantId: activePlant })
      onQueued?.(group)
    } catch (problem) {
      setError(problem instanceof UploadRefused ? problem.message : describeApiError(problem, "The file could not be added. Try again."))
    } finally {
      setBusy(false)
    }
  }

  if (!writable) return <p className="text-[12px] text-muted-foreground">Pick one plant at the top to add documents.</p>
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        {kinds.length > 1 ? (
          <select aria-label="Document type" value={kind} onChange={(event) => setKind(event.target.value as DocKind)}
            className="h-9 rounded-lg border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 max-sm:h-11">
            {kinds.map((value) => <option key={value} value={value}>{DOC_KIND_LABELS[value]}</option>)}
          </select>
        ) : null}
        <button type="button" disabled={busy} className="erp-btn-primary max-sm:h-11" onClick={() => camera.current?.click()} data-testid={`${testId}-camera`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {compact ? "Photo" : "Take photo"}
        </button>
        <button type="button" disabled={busy} className="erp-btn-secondary max-sm:h-11" onClick={() => picker.current?.click()} data-testid={`${testId}-file`}>
          <FilePlus2 className="h-4 w-4" /> {compact ? "File" : "Photo or PDF"}
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(event) => { void queue(event.target.files); event.target.value = "" }} />
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        data-testid={`${testId}-input`} onChange={(event) => { void queue(event.target.files); event.target.value = "" }} />
      {error ? <p role="alert" className="text-[12.5px] text-signal-rose-ink">{error}</p> : null}
    </div>
  )
}

export function DocumentCard({ document, onOpen }: { document: VaultDocument; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-testid="document-card"
      className={cn("group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/40 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        document.status === "VOID" && "opacity-60")}>
      <span className="relative block aspect-[4/3] w-full overflow-hidden border-b border-border">
        <DocumentThumb document={document} />
        {document.pages > 1 ? <span className="absolute right-1.5 top-1.5 rounded-md bg-card/90 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-foreground">{document.pages} pages</span> : null}
        {document.status === "VOID" ? <span className="absolute left-1.5 top-1.5 rounded-md bg-signal-rose-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-signal-rose-ink">Void</span> : null}
      </span>
      <span className="block space-y-0.5 px-2.5 py-2">
        <span className="block truncate text-[12.5px] font-semibold text-foreground">{document.kind_label}{document.ref_no ? ` · ${document.ref_no}` : ""}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{document.doc_no} · {who(document.uploaded_by)}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{timeText(document.uploaded_at)}</span>
      </span>
    </button>
  )
}

export function DocumentsPanel({ entityType, entityId, kinds = ["VENDOR_BILL", "VENDOR_CHALLAN", "OTHER"], allowUpload = true, meta, title = "Documents", description, action, className }: {
  entityType: DocEntityType
  entityId: string
  /** Types this panel can add (the first is the default). */
  kinds?: DocKind[]
  allowUpload?: boolean
  /** Filled on new documents (party, number …); the link to this record is added by the panel. */
  meta?: Omit<UploadMeta, "kind" | "link_entity_type" | "link_entity_id">
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  const query = useEntityDocuments(entityType, entityId)
  const outbox = useDocumentOutbox()
  const [openId, setOpenId] = useState<string | null>(null)
  const documents = query.data?.items || []
  const canUpload = query.data?.can_upload
  const addable = useMemo(() => kinds.filter((kind) => !canUpload || canUpload.includes(kind)), [kinds, canUpload])
  const mine = outbox.items.filter((item) => item.meta.link_entity_type === entityType && item.meta.link_entity_id === entityId
    || (item.documentId && documents.some((document) => document.id === item.documentId)))
  const forbidden = (query.error as any)?.response?.status === 403

  if (forbidden) return null
  return (
    <section className={cn("erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)} data-testid={`documents-panel-${entityType.toLowerCase()}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}{documents.length ? <span className="ml-1.5 text-muted-foreground">· {documents.length}</span> : null}</h2>
          <p className="mt-0.5 max-w-3xl text-[12.5px] leading-5 text-muted-foreground">{description || "Bills, challans and photos kept with this record. Tap one to view, zoom or rotate it."}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {action}
          {allowUpload && addable.length ? (
            <AddDocumentButtons kinds={addable} meta={{ ...(meta || {}), link_entity_type: entityType, link_entity_id: entityId }} testId={`documents-${entityType.toLowerCase()}-add`} />
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <OutboxStrip items={mine} />
        {query.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
            {[0, 1, 2].map((index) => <div key={index} className="skeleton aspect-[4/3] rounded-xl" />)}
          </div>
        ) : query.isError ? (
          <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink">
            {describeApiError(query.error, "Documents could not be loaded.")} <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>Try again</button>
          </p>
        ) : documents.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {documents.map((document) => <DocumentCard key={document.id} document={document} onOpen={() => setOpenId(document.id)} />)}
          </div>
        ) : !mine.length ? (
          <p className="rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-6 text-center text-[13px] text-muted-foreground">
            No documents yet.{allowUpload && addable.length ? " Take a photo of the bill or challan, or add its PDF." : ""}
          </p>
        ) : null}
      </div>
      <DocumentDrawer documentId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}
