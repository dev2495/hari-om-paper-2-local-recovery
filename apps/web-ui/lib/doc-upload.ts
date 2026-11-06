/**
 * Doc Vault uploads (6 Nov 2026): shrink photos on the phone, keep them in an outbox until the server
 * has them, and retry in the background, so a gate phone on a weak network never loses a photo.
 *
 * Use from any page (DocumentsPanel, the Gate desk):
 *
 *   const group = await queueDocumentFiles(files, { kind: "VENDOR_BILL", link_entity_type: "GRN", link_entity_id: id }, { plantId })
 *   const stop = subscribeOutbox((state) => …)      // state.items, state.pending, state.uploading, state.failed
 *   startOutbox()                                    // once per tab (DocumentsPanel does it)
 *
 * The files of one call become ONE document: the first file creates it, the others are added as its
 * pages. Photos are re-drawn on a canvas (longest edge 2000 px, JPEG 0.8, upright by their EXIF
 * orientation). PDFs pass through untouched. Each file carries its own request id, so a retry after a
 * dropped connection returns what the first try saved instead of making a second document.
 *
 * Storage: IndexedDB ("hariom-doc-outbox"); in browsers without it the outbox lives in memory.
 */

export type DocKind = "VENDOR_BILL" | "VENDOR_CHALLAN" | "EXPENSE_BILL" | "TALLY_BILL" | "OUR_CHALLAN" | "DEBIT_NOTE" | "VISITOR_PHOTO" | "OTHER"
export type DocEntityType = "GRN" | "REEL" | "BATCH" | "GATE_ENTRY" | "VISIT" | "DISPATCH" | "DEBIT_NOTE" | "PO" | "WEIGHT_VARIANCE"

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  VENDOR_BILL: "Vendor bill",
  VENDOR_CHALLAN: "Vendor challan",
  EXPENSE_BILL: "Expense bill",
  TALLY_BILL: "Tally bill",
  OUR_CHALLAN: "Our challan",
  DEBIT_NOTE: "Debit note",
  VISITOR_PHOTO: "Visitor photo",
  OTHER: "Other",
}

export type UploadMeta = {
  kind: DocKind
  source?: "GATE" | "STORE" | "QC" | "DISPATCH"
  category?: string
  party_type?: string
  party_id?: string
  party_name?: string
  ref_no?: string
  ref_date?: string
  amount?: string | number
  note?: string
  link_entity_type?: DocEntityType
  link_entity_id?: string
}

export const MAX_EDGE = 2000
export const JPEG_QUALITY = 0.8
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ATTEMPTS_BEFORE_PAUSE = 12

// ── Pure helpers (unit tested) ─────────────────────────────────────────────────────────────────

/** The size that fits inside a maxEdge × maxEdge box without enlarging. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  if (!width || !height) return { width: 0, height: 0 }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export type SniffedKind = "jpeg" | "png" | "webp" | "pdf" | "heic" | null

/** What a file really is, from its first bytes (the server checks the same way). */
export function sniffFileKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "png"
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.slice(from, to)))
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp"
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(ascii(8, 12))) return "heic"
  const head = ascii(0, Math.min(bytes.length, 1024)).trimStart()
  if (head.startsWith("%PDF-")) return "pdf"
  return null
}

/** Wait before the next try: 2 s, 4 s, 8 s … up to 5 minutes. */
export function retryDelay(attempt: number): number {
  return Math.min(300_000, 2000 * 2 ** Math.max(0, attempt - 1))
}

/** Worth trying again later? No answer (offline), an expired sign-in, timeouts, rate limits and server trouble are;
 * a refused file is not. */
export function isRetryable(status?: number | null): boolean {
  if (!status) return true
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500
}

export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toLocaleString("en-IN", { maximumFractionDigits: 1 })} MB`
}

export function newRequestId(): string {
  const cryptoApi: Crypto | undefined = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── Browser-side preparation ───────────────────────────────────────────────────────────────────

export class UploadRefused extends Error {}

async function headBytes(blob: Blob): Promise<Uint8Array> {
  const slice = blob.slice(0, 1024)
  const buffer = typeof (slice as any).arrayBuffer === "function"
    ? await slice.arrayBuffer()
    : await new Response(slice).arrayBuffer()
  return new Uint8Array(buffer)
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch { /* fall through to <img>, which also applies EXIF orientation in current browsers */ }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.decoding = "async"
      element.onload = () => resolve(element)
      element.onerror = () => reject(new UploadRefused("This photo could not be opened. Take it again."))
      element.src = url
    })
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** Redraw a photo upright at most 2000 px on the long side as JPEG 0.8. Keeps the original when that is smaller. */
export async function compressImage(blob: Blob, maxEdge = MAX_EDGE, quality = JPEG_QUALITY): Promise<Blob> {
  const decoded = await decode(blob)
  try {
    const size = fitWithin(decoded.width, decoded.height, maxEdge)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (!context) return blob
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(decoded.source, 0, 0, size.width, size.height)
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    if (!output) return blob
    const unchangedSize = size.width === decoded.width && size.height === decoded.height
    return unchangedSize && blob.type === "image/jpeg" && output.size >= blob.size ? blob : output
  } finally {
    decoded.close()
  }
}

/** What will be sent for one picked file: a shrunk JPEG for a photo, the PDF as it is. */
export async function prepareUpload(file: File): Promise<{ blob: Blob; name: string; mime: string }> {
  const kind = sniffFileKind(await headBytes(file))
  if (kind === "pdf") {
    if (file.size > MAX_FILE_BYTES) throw new UploadRefused(`${file.name} is ${fileSizeText(file.size)}. A PDF can be at most 10 MB; split it into parts.`)
    return { blob: file, name: file.name || "document.pdf", mime: "application/pdf" }
  }
  if (kind === "jpeg" || kind === "png" || kind === "webp" || kind === "heic" || file.type.startsWith("image/")) {
    let blob: Blob
    try {
      blob = await compressImage(file)
    } catch (error) {
      if (kind === "heic") throw new UploadRefused("This phone saved the photo as HEIC, which cannot be read here. In the camera settings choose Most Compatible, or send a PDF.")
      throw error
    }
    if (blob.size > MAX_FILE_BYTES) throw new UploadRefused("This photo is still over 10 MB after shrinking. Take it again.")
    const base = (file.name || "photo").replace(/\.[^.]+$/, "")
    return { blob, name: blob === file ? file.name : `${base}.jpg`, mime: blob.type || "image/jpeg" }
  }
  throw new UploadRefused(`${file.name || "This file"} is not a photo or a PDF. Only photos (JPEG, PNG, WebP) and PDF files can be saved.`)
}

// ── Outbox ─────────────────────────────────────────────────────────────────────────────────────

export type OutboxStatus = "waiting" | "uploading" | "failed" | "done"

export type OutboxItem = {
  id: string
  requestId: string
  plantId: string | null
  /** Files of one "Add" make one document; index 0 creates it, the rest become its pages. */
  group: string
  index: number
  count: number
  documentId?: string
  docNo?: string
  meta: UploadMeta
  name: string
  mime: string
  size: number
  blob: Blob
  attempts: number
  status: OutboxStatus
  progress: number
  error?: string
  createdAt: number
  nextAttemptAt: number
  /** When the server confirmed it (done rows stay on screen 15 s as "Saved"). */
  doneAt?: number
}

export type OutboxState = {
  items: OutboxItem[]
  pending: number
  uploading: number
  failed: number
}

export type UploadResult = { ok: boolean; status?: number; body?: any }
export type Uploader = (item: OutboxItem, onProgress: (fraction: number) => void) => Promise<UploadResult>

export interface OutboxStore {
  all(): Promise<OutboxItem[]>
  put(item: OutboxItem): Promise<void>
  remove(id: string): Promise<void>
}

export function memoryStore(): OutboxStore {
  const rows = new Map<string, OutboxItem>()
  return {
    all: async () => Array.from(rows.values()),
    put: async (item) => { rows.set(item.id, item) },
    remove: async (id) => { rows.delete(id) },
  }
}

function idbStore(): OutboxStore | null {
  if (typeof indexedDB === "undefined") return null
  let opened: Promise<IDBDatabase> | null = null
  const database = () => {
    opened ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hariom-doc-outbox", 1)
      request.onupgradeneeded = () => { request.result.createObjectStore("items", { keyPath: "id" }) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return opened
  }
  const run = <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void) =>
    database().then((db) => new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("items", mode)
      const request = work(transaction.objectStore("items"))
      transaction.oncomplete = () => resolve(request ? (request as IDBRequest<T>).result : (undefined as T))
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    }))
  return {
    all: () => run<OutboxItem[]>("readonly", (store) => store.getAll() as IDBRequest<OutboxItem[]>).then((rows) => rows || []),
    put: (item) => run<void>("readwrite", (store) => { store.put(item) }),
    remove: (id) => run<void>("readwrite", (store) => { store.delete(id) }),
  }
}

function readDetail(body: any, fallback: string): string {
  const detail = body?.detail
  if (typeof detail === "string" && detail) return detail
  if (detail && typeof detail.message === "string") return detail.message
  return fallback
}

/** The default uploader: multipart XHR (so the page can show progress), cookie auth, plant header. */
export const xhrUploader: Uploader = (item, onProgress) => new Promise((resolve) => {
  const form = new FormData()
  form.append("file", item.blob, item.name)
  form.append("request_id", item.requestId)
  const url = item.index === 0 ? "/api/documents" : `/api/documents/${item.documentId}/pages`
  if (item.index === 0) {
    for (const [key, value] of Object.entries(item.meta)) {
      if (value !== undefined && value !== null && String(value) !== "") form.append(key, String(value))
    }
  }
  const request = new XMLHttpRequest()
  request.open("POST", url)
  request.withCredentials = true
  request.timeout = 120_000
  if (item.plantId && item.plantId !== "ALL") request.setRequestHeader("X-Plant-ID", item.plantId)
  request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
  request.onload = () => {
    let body: any = null
    try { body = JSON.parse(request.responseText || "null") } catch { body = null }
    resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, body })
  }
  request.onerror = () => resolve({ ok: false })
  request.ontimeout = () => resolve({ ok: false, status: 408 })
  request.send(form)
})

export type Outbox = ReturnType<typeof createOutbox>

/** An outbox over any store and uploader (the app uses IndexedDB + XHR; tests use memory + a fake). */
export function createOutbox({ store, upload, now = () => Date.now(), schedule = (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, onDone }: {
  store: OutboxStore
  upload: Uploader
  now?: () => number
  schedule?: (fn: () => void, ms: number) => number
  onDone?: (item: OutboxItem) => void
}) {
  let items: OutboxItem[] = []
  let loaded = false
  let timer: number | null = null
  const listeners = new Set<(state: OutboxState) => void>()

  const state = (): OutboxState => ({
    items: [...items].sort((a, b) => a.createdAt - b.createdAt || a.index - b.index),
    pending: items.filter((item) => item.status === "waiting" || item.status === "uploading").length,
    uploading: items.filter((item) => item.status === "uploading").length,
    failed: items.filter((item) => item.status === "failed").length,
  })
  const emit = () => { const snapshot = state(); listeners.forEach((listener) => listener(snapshot)) }
  const save = async (item: OutboxItem) => {
    items = items.map((row) => (row.id === item.id ? item : row))
    if (item.status === "done") await store.remove(item.id)
    else await store.put(item)
    emit()
  }
  const load = async () => {
    if (loaded) return
    loaded = true
    const saved = await store.all().catch(() => [] as OutboxItem[])
    const known = new Set(items.map((item) => item.id))
    // A page reload during an upload leaves it "uploading": send it again (its request id makes that safe).
    items = [...items, ...saved.filter((item) => !known.has(item.id)).map((item) => (item.status === "uploading" ? { ...item, status: "waiting" as const } : item))]
    emit()
  }

  /** Queue files as one new document, or (existingDocumentId) as more pages of a saved one. */
  async function enqueue(files: Array<{ blob: Blob; name: string; mime: string }>, meta: UploadMeta, plantId: string | null, existingDocumentId?: string): Promise<string> {
    await load()
    const group = newRequestId()
    const created = now()
    const offset = existingDocumentId ? 1 : 0
    const rows: OutboxItem[] = files.map((file, position) => ({
      id: newRequestId(), requestId: newRequestId(), plantId, group, index: position + offset, count: files.length + offset,
      documentId: existingDocumentId, meta, name: file.name, mime: file.mime,
      size: file.blob.size, blob: file.blob, attempts: 0, status: "waiting", progress: 0, createdAt: created, nextAttemptAt: created,
    }))
    items = [...items, ...rows]
    for (const row of rows) await store.put(row)
    emit()
    void process()
    return group
  }

  function next(): OutboxItem | undefined {
    const time = now()
    return state().items.find((item) => item.status === "waiting" && item.nextAttemptAt <= time && (item.index === 0 || Boolean(item.documentId)))
  }

  function sweep() {
    const cutoff = now() - 15_000
    const before = items.length
    items = items.filter((item) => item.status !== "done" || (item.doneAt || 0) > cutoff)
    if (items.length !== before) emit()
  }

  function plan() {
    sweep()
    if (timer !== null) return
    const waiting = items.filter((item) => item.status === "waiting" && (item.index === 0 || item.documentId))
    const done = items.filter((item) => item.status === "done")
    if (!waiting.length && !done.length) return
    const due = [...waiting.map((item) => item.nextAttemptAt), ...done.map((item) => (item.doneAt || 0) + 15_500)]
    const wait = Math.max(250, Math.min(...due) - now())
    timer = schedule(() => { timer = null; void process() }, wait)
  }

  let inflight: Promise<void> | null = null

  /** Send what is due. A call while sending returns the same run (so callers can await "idle"). */
  function process(): Promise<void> {
    inflight ||= run().finally(() => { inflight = null })
    return inflight
  }

  async function run(): Promise<void> {
    await load()
    try {
      for (let item = next(); item; item = next()) {
        let current: OutboxItem = { ...item, status: "uploading", progress: 0, attempts: item.attempts + 1, error: undefined }
        await save(current)
        const result = await upload(current, (fraction) => {
          current = { ...current, progress: Math.min(0.99, fraction) }
          items = items.map((row) => (row.id === current.id ? current : row))
          emit()
        }).catch(() => ({ ok: false } as UploadResult))
        if (result.ok) {
          const document = result.body?.document
          const done: OutboxItem = { ...current, status: "done", progress: 1, doneAt: now(), documentId: document?.id || current.documentId, docNo: document?.doc_no }
          await save(done)
          if (current.index === 0 && document?.id) {
            for (const page of items.filter((row) => row.group === current.group && row.index > 0)) {
              await save({ ...page, documentId: document.id, docNo: document.doc_no, nextAttemptAt: now() })
            }
          }
          onDone?.(done)
          continue
        }
        const retry = isRetryable(result.status)
        const message = retry
          ? (result.status === 401 ? "Sign in again; the file waits on this device and is sent after you sign in."
            : result.status ? `The server is busy (${result.status}). Trying again.` : "No network. It will be sent when the phone is back online.")
          : readDetail(result.body, "The file was refused.")
        const paused = retry && current.attempts >= MAX_ATTEMPTS_BEFORE_PAUSE
        await save({
          ...current, progress: 0, error: paused ? `${message} Tap Try again.` : message,
          status: retry && !paused ? "waiting" : "failed", nextAttemptAt: now() + retryDelay(current.attempts),
        })
        // A first page that failed for good takes its other pages with it (they have no document to join).
        if (!retry && current.index === 0) {
          for (const page of items.filter((row) => row.group === current.group && row.index > 0 && row.status === "waiting")) {
            await save({ ...page, status: "failed", error: "Not sent: the first page was refused." })
          }
        }
      }
    } finally {
      // Done rows stay on screen a moment ("Saved DV-…"), then go.
      plan()
    }
  }

  async function retryAll() {
    await load()
    for (const item of items.filter((row) => row.status === "failed" || row.status === "waiting")) {
      await save({ ...item, status: "waiting", attempts: Math.min(item.attempts, 1), nextAttemptAt: now(), error: undefined })
    }
    return process()
  }

  async function discard(id: string) {
    const item = items.find((row) => row.id === id)
    if (!item || item.status === "uploading") return
    items = items.filter((row) => row.id !== id)
    await store.remove(id)
    emit()
  }

  function subscribe(listener: (state: OutboxState) => void) {
    listeners.add(listener)
    listener(state())
    void load()
    return () => { listeners.delete(listener) }
  }

  return { enqueue, process, retryAll, discard, subscribe, state, load }
}

// ── The app's one outbox ───────────────────────────────────────────────────────────────────────

let shared: Outbox | null = null
let started = false
const doneListeners = new Set<(item: OutboxItem) => void>()

function outbox(): Outbox {
  shared ||= createOutbox({ store: idbStore() || memoryStore(), upload: xhrUploader, onDone: (item) => doneListeners.forEach((listener) => listener(item)) })
  return shared
}

/** Shrink and queue files as one document. Resolves when they are safely in the outbox (not yet sent). */
export async function queueDocumentFiles(files: File[], meta: UploadMeta, { plantId }: { plantId: string | null }): Promise<string> {
  if (!files.length) throw new UploadRefused("Pick a photo or a PDF first.")
  const prepared = []
  for (const file of files) prepared.push(await prepareUpload(file))
  return outbox().enqueue(prepared, meta, plantId)
}

/** Shrink and queue files as more pages of a saved document (a bill photographed page by page). */
export async function queueDocumentPages(documentId: string, files: File[], { plantId, kind = "OTHER" }: { plantId: string | null; kind?: DocKind }): Promise<string> {
  if (!files.length) throw new UploadRefused("Pick a photo or a PDF first.")
  const prepared = []
  for (const file of files) prepared.push(await prepareUpload(file))
  return outbox().enqueue(prepared, { kind }, plantId, documentId)
}

export function subscribeOutbox(listener: (state: OutboxState) => void): () => void {
  return outbox().subscribe(listener)
}

/** Called when an upload lands (to refresh lists). */
export function onDocumentSaved(listener: (item: OutboxItem) => void): () => void {
  doneListeners.add(listener)
  return () => { doneListeners.delete(listener) }
}

/** Start background sending: now, when the phone comes back online, and when the tab is shown again. */
export function startOutbox(): void {
  if (started || typeof window === "undefined") return
  started = true
  const kick = () => { void outbox().process() }
  window.addEventListener("online", kick)
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick() })
  kick()
}

export function retryOutbox(): Promise<void> {
  return outbox().retryAll()
}

export function discardOutboxItem(id: string): Promise<void> {
  return outbox().discard(id)
}
