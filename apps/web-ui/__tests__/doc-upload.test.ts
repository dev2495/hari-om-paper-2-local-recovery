import assert from "node:assert/strict"

import { createOutbox, fitWithin, isRetryable, memoryStore, retryDelay, sniffFileKind, type OutboxItem, type UploadResult } from "../lib/doc-upload"

// Doc Vault (6 Nov 2026): photos shrink to 2000 px on the long side, never grow, keep their shape.
assert.deepEqual(fitWithin(4000, 3000), { width: 2000, height: 1500 })
assert.deepEqual(fitWithin(3000, 4000), { width: 1500, height: 2000 })
assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800 })
assert.deepEqual(fitWithin(0, 800), { width: 0, height: 0 })

// The bytes decide the type, not the name.
assert.equal(sniffFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg")
assert.equal(sniffFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png")
assert.equal(sniffFileKind(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")), "webp")
assert.equal(sniffFileKind(new TextEncoder().encode("%PDF-1.7\n")), "pdf")
assert.equal(sniffFileKind(new TextEncoder().encode("\u0000\u0000\u0000\u0018ftypheic")), "heic")
assert.equal(sniffFileKind(new TextEncoder().encode("MZ executable")), null)

// Offline, timeouts and server trouble retry; a refused file does not.
for (const status of [undefined, 0, 401, 408, 429, 500, 502, 503, 504]) assert.ok(isRetryable(status), String(status))
for (const status of [400, 403, 404, 409, 413, 415, 422]) assert.ok(!isRetryable(status), String(status))
assert.deepEqual([1, 2, 3, 4].map(retryDelay), [2000, 4000, 8000, 16000])
assert.equal(retryDelay(40), 300_000)

async function outboxFlow() {
  let clock = 1_000
  const calls: Array<{ index: number; documentId?: string; requestId: string }> = []
  const answers: UploadResult[] = [
    { ok: false },                                                     // offline on the first try
    { ok: true, status: 200, body: { document: { id: "doc-1", doc_no: "DV-2611-0001" } } },
    { ok: true, status: 200, body: { document: { id: "doc-1", doc_no: "DV-2611-0001" } } },
  ]
  const timers: Array<() => void> = []
  const box = createOutbox({
    store: memoryStore(),
    now: () => clock,
    schedule: (fn) => { timers.push(fn); return timers.length },
    upload: async (item: OutboxItem, progress) => { calls.push({ index: item.index, documentId: item.documentId, requestId: item.requestId }); progress(0.5); return answers.shift() || { ok: false } },
  })
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })
  await box.enqueue([{ blob, name: "p1.jpg", mime: "image/jpeg" }, { blob, name: "p2.jpg", mime: "image/jpeg" }], { kind: "VENDOR_BILL", link_entity_type: "GRN", link_entity_id: "g-1" }, "plant-a")
  await box.process()
  // First try failed: the first page waits (with its message); the second waits for the document.
  let state = box.state()
  assert.equal(calls.length, 1)
  assert.equal(state.pending, 2)
  assert.match(state.items[0].error || "", /No network/)
  // Time passes; the retry carries the same request id so the server cannot save it twice.
  clock += retryDelay(1) + 1
  await box.process()
  state = box.state()
  assert.equal(calls.length, 3)
  assert.equal(calls[1].requestId, calls[0].requestId)
  assert.deepEqual(calls.map((call) => call.index), [0, 0, 1])
  assert.equal(calls[2].documentId, "doc-1", "page 2 joins the document page 1 made")
  assert.equal(state.pending, 0)
  assert.ok(state.items.every((item) => item.status === "done" && item.docNo === "DV-2611-0001"))

  // A refused file fails for good, and takes its waiting pages with it.
  const refused = createOutbox({ store: memoryStore(), now: () => clock, schedule: () => 0,
    upload: async () => ({ ok: false, status: 415, body: { detail: "Only photos (JPEG, PNG, WebP) and PDF files can be saved." } }) })
  await refused.enqueue([{ blob, name: "a.txt", mime: "text/plain" }, { blob, name: "b.jpg", mime: "image/jpeg" }], { kind: "OTHER" }, "plant-a")
  await refused.process()
  const failed = refused.state()
  assert.equal(failed.failed, 2)
  assert.match(failed.items[0].error || "", /Only photos/)
  await refused.discard(failed.items[0].id)
  assert.equal(refused.state().items.length, 1)

  // Pages for a document already saved go straight to it.
  const pages: OutboxItem[] = []
  const more = createOutbox({ store: memoryStore(), now: () => clock, schedule: () => 0,
    upload: async (item) => { pages.push(item); return { ok: true, status: 200, body: { document: { id: "doc-9", doc_no: "DV-2611-0009" } } } } })
  await more.enqueue([{ blob, name: "p3.jpg", mime: "image/jpeg" }], { kind: "VENDOR_BILL" }, "plant-a", "doc-9")
  await more.process()
  assert.equal(pages.length, 1)
  assert.equal(pages[0].index, 1)
  assert.equal(pages[0].documentId, "doc-9")
}

outboxFlow().then(() => console.log("doc-upload ok"), (error) => { console.error(error); process.exit(1) })
