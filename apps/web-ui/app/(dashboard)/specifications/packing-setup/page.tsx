"use client"

// Packing setup (owner decision 5, 1 Nov 2026): a temporary Owner/Admin page to give every active spec
// its box (Packaging master), qty per box, plastic and fadda. Each row saves straight to the spec as an
// audited packing amendment (no re-approval) and is pushed into open job cards that have not packed yet.

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/workspace/page-header"
import { useAuth } from "@/context/AuthContext"
import { useCustomers, usePackagingBoxes, usePackagingFadda, usePackagingPlasticSheets } from "@/hooks/use-master-data"
import { api } from "@/lib/api"
import { errorText } from "@/lib/season-api"
import {
  addBoxHref,
  boxCodesNotInMaster,
  draftChanged,
  draftFromPacking,
  draftPayload,
  draftProblems,
  filterPackingRows,
  masterCodes,
  sizeText,
  type PackingDraft,
  type PackingMasters,
  type PackingSetupRow,
} from "@/lib/packing-setup"

const field = "h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-60"
const kg = (value: unknown) => (value === null || value === undefined || value === "" ? "weight not set" : `${Number(value).toFixed(3)} kg/pc`)

type RowState = { saving?: boolean; message?: string; error?: string }

function newRequestId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `packing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export default function PackingSetupPage() {
  const { user } = useAuth()
  const allowed = [user?.role, ...(user?.roles || [])].some((role) => role === "Owner" || role === "Admin")
  const cache = useQueryClient()
  const customers = useCustomers()
  const boxesQuery = usePackagingBoxes()
  const plasticsQuery = usePackagingPlasticSheets()
  const faddaQuery = usePackagingFadda()
  const rowsQuery = useQuery({
    queryKey: ["packing-setup"],
    enabled: allowed,
    queryFn: async () => (await api.get("/api/spec/specifications/packing-setup")).data as { items: PackingSetupRow[]; total: number; complete: number },
  })
  // Boxes are keyed by code, plastic sheets and fadda by SKU: one shape here.
  const masters: PackingMasters = useMemo(
    () => ({
      boxes: ((boxesQuery.data || []) as any[]).map((row) => ({ ...row, code: String(row.code || "") })),
      plastics: ((plasticsQuery.data || []) as any[]).map((row) => ({ ...row, code: String(row.sku || row.code || "") })),
      fadda: ((faddaQuery.data || []) as any[]).map((row) => ({ ...row, code: String(row.sku || row.code || "") })),
    }),
    [boxesQuery.data, plasticsQuery.data, faddaQuery.data],
  )
  const mastersReady = Boolean(boxesQuery.data && plasticsQuery.data && faddaQuery.data)
  const [overrides, setOverrides] = useState<Record<string, PackingSetupRow>>({})
  const rows = useMemo(() => (rowsQuery.data?.items || []).map((row) => overrides[row.id] || row), [rowsQuery.data, overrides])
  const [drafts, setDrafts] = useState<Record<string, PackingDraft>>({})
  const [state, setState] = useState<Record<string, RowState>>({})
  const [missingOnly, setMissingOnly] = useState(true)
  const [customerId, setCustomerId] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState({ plastic_sku: "", plastic_per_box: "1", fadda_sku: "", fadda_per_box: "1", touchPlastic: true, touchFadda: true })
  const [bulkNote, setBulkNote] = useState("")

  const draftOf = (row: PackingSetupRow) => drafts[row.id] || draftFromPacking(row.packing, masters)
  const setDraft = (row: PackingSetupRow, change: Partial<PackingDraft>) => setDrafts((all) => ({ ...all, [row.id]: { ...draftOf(row), ...change } }))
  const visible = filterPackingRows(rows, { missingOnly, customerId, search })
  const complete = rows.filter((row) => row.complete).length
  const missingBoxes = boxCodesNotInMaster(rows, masters.boxes)
  const boxCodes = masterCodes(masters.boxes)
  // Only rows the person edited count as changed; defaults shown on untouched rows save with their own button.
  const edited = (row: PackingSetupRow) => Boolean(drafts[row.id]) && draftChanged(draftOf(row), row.packing)
  const changedRows = rows.filter(edited)
  const customerOptions = useMemo(() => {
    const ids = new Set(rows.map((row) => row.customer_id).filter(Boolean))
    return ((customers.data || []) as any[]).filter((c) => ids.has(String(c.id)))
  }, [customers.data, rows])

  async function save(row: PackingSetupRow) {
    const draft = draftOf(row)
    const problems = draftProblems(draft, masters)
    if (problems.length) {
      setState((all) => ({ ...all, [row.id]: { error: problems.join(" · ") } }))
      return false
    }
    // Save to the spec's own plant, so "All Visible Plants" at the top never sends the save to another plant.
    const plantId = String((row as PackingSetupRow & { plant_id?: string | null }).plant_id || "")
    if (!plantId) {
      setState((all) => ({ ...all, [row.id]: { error: "This spec has no plant. Pick one plant at the top and refresh the list." } }))
      return false
    }
    setState((all) => ({ ...all, [row.id]: { saving: true } }))
    try {
      const { data } = await api.put(`/api/spec/specifications/${row.id}/packing`, draftPayload(draft, row, newRequestId()), {
        headers: { "X-Plant-ID": plantId },
      })
      const cards = data.job_cards || {}
      const parts = [data.amended ? "Saved to the spec" : "No change on the spec"]
      if (cards.error) parts.push(cards.error)
      else parts.push(`${cards.updated || 0} open job card${cards.updated === 1 ? "" : "s"} updated` + (cards.skipped_packed ? `, ${cards.skipped_packed} already packing kept their box` : ""))
      setOverrides((all) => ({ ...all, [row.id]: data.spec }))
      setDrafts((all) => {
        const next = { ...all }
        delete next[row.id]
        return next
      })
      setState((all) => ({ ...all, [row.id]: { message: parts.join(" · "), error: cards.error ? cards.error : undefined } }))
      return true
    } catch (error) {
      const detail = (error as any)?.response?.data?.detail
      const stale = detail?.code === "STALE_VERSION"
      setState((all) => ({ ...all, [row.id]: { error: stale ? "This spec changed since the list loaded. Refresh the list and try again." : errorText(error) } }))
      return false
    }
  }

  async function saveChanged() {
    for (const row of changedRows) {
      // One at a time: each save takes the season lock and pushes to job cards.
      await save(row)
    }
    cache.invalidateQueries({ queryKey: ["packing-setup"] })
  }

  function applyBulk() {
    const plasticOk = !bulk.touchPlastic || !bulk.plastic_sku || Number(bulk.plastic_per_box) > 0
    const faddaOk = !bulk.touchFadda || !bulk.fadda_sku || Number(bulk.fadda_per_box) > 0
    if (!plasticOk || !faddaOk) {
      setBulkNote("Per box must be at least 1 when a material is chosen.")
      return
    }
    setDrafts((all) => {
      const next = { ...all }
      for (const row of rows.filter((r) => selected.has(r.id))) {
        const draft = next[row.id] || draftFromPacking(row.packing, masters)
        next[row.id] = {
          ...draft,
          ...(bulk.touchPlastic ? { plastic_sku: bulk.plastic_sku, plastic_per_box: bulk.plastic_sku ? bulk.plastic_per_box : "0" } : {}),
          ...(bulk.touchFadda ? { fadda_sku: bulk.fadda_sku, fadda_per_box: bulk.fadda_sku ? bulk.fadda_per_box : "0" } : {}),
        }
      }
      return next
    })
    setBulkNote(`Applied to ${selected.size} row${selected.size === 1 ? "" : "s"}. Press Save on each row, or Save all changed rows.`)
  }

  if (!allowed) {
    return (
      <div className="space-y-5">
        <PageHeader title="Packing setup" description="Owner and Admin only." />
        <p className="erp-panel rounded-xl p-6 text-sm text-muted-foreground">Ask the Owner or an Admin to set packing on the specifications.</p>
      </div>
    )
  }

  const plasticDefault = masters.plastics.length === 1 ? String(masters.plastics[0].code) : ""
  const faddaDefault = masters.fadda.length === 1 ? String(masters.fadda[0].code) : ""
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id))

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        badge="Design · temporary"
        title="Packing setup"
        description="Give every active specification its box, quantity per box, plastic and fadda from the Packaging master. Saving changes only the packing on the spec (recorded as a packing amendment, no re-approval) and updates open job cards that have not packed a box yet."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="erp-btn-secondary" href="/masters/packaging">Packaging master</Link>
            <Link className="erp-btn-secondary" href="/specifications">Specifications</Link>
          </div>
        }
      />

      <section className="erp-panel rounded-xl p-4" aria-label="Progress">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Specifications with complete packing</p>
            <p className="text-2xl font-semibold tabular" data-testid="packing-progress">
              {complete} of {rows.length} complete
            </p>
          </div>
          <p className="max-w-xl text-xs text-muted-foreground">
            Complete = a box from the Packaging master and a whole quantity per box; a plastic or fadda count needs its master too.
            {plasticDefault || faddaDefault ? ` Defaults: ${[plasticDefault && `plastic ${plasticDefault}`, faddaDefault && `fadda ${faddaDefault}`].filter(Boolean).join(", ")} (the only active master of its kind).` : ""}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length || 1} aria-valuenow={complete}>
          <div className="h-full rounded-full bg-signal-emerald-ink transition-all" style={{ width: `${rows.length ? (complete / rows.length) * 100 : 0}%` }} />
        </div>
      </section>

      {missingBoxes.length > 0 && (
        <section className="rounded-xl border border-signal-amber-line bg-signal-amber-soft p-4 text-signal-amber-ink" aria-label="Box codes not in the master">
          <p className="text-sm font-semibold">Box codes on specs that are not in the Packaging master</p>
          <p className="mt-1 text-xs">Add each box in the master (size and weight per box), then pick it on the rows below.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingBoxes.map((item) => (
              <Link key={item.code} href={addBoxHref(item.code)} className="inline-flex items-center gap-2 rounded-md border border-signal-amber-line bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted">
                <span className="font-mono">{item.code}</span>
                <span className="text-muted-foreground">{item.specs} spec{item.specs === 1 ? "" : "s"}</span>
                <span className="text-primary">Add box</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="erp-panel rounded-xl p-4" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing packing only
          </label>
          <select aria-label="Customer filter" className={field} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All customers</option>
            {customerOptions.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input aria-label="Search specifications" className={`${field} min-w-48 flex-1`} placeholder="Search customer, box code or spec ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="text-xs text-muted-foreground">{visible.length} shown</span>
        </div>
      </section>

      {selected.size > 0 && (
        <section className="rounded-xl border border-border bg-muted p-4" aria-label="Apply to selected">
          <p className="text-sm font-semibold">{selected.size} selected: set plastic and fadda together</p>
          <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={bulk.touchPlastic} onChange={(e) => setBulk({ ...bulk, touchPlastic: e.target.checked })} /> Plastic</label>
            <select aria-label="Bulk plastic" className={field} disabled={!bulk.touchPlastic} value={bulk.plastic_sku} onChange={(e) => setBulk({ ...bulk, plastic_sku: e.target.value })}>
              <option value="">No plastic</option>
              {masters.plastics.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.size_label || "size —"}</option>)}
            </select>
            <input aria-label="Bulk plastic per box" type="number" min={0} className={`${field} w-20`} disabled={!bulk.touchPlastic || !bulk.plastic_sku} value={bulk.plastic_per_box} onChange={(e) => setBulk({ ...bulk, plastic_per_box: e.target.value })} />
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={bulk.touchFadda} onChange={(e) => setBulk({ ...bulk, touchFadda: e.target.checked })} /> Fadda</label>
            <select aria-label="Bulk fadda" className={field} disabled={!bulk.touchFadda} value={bulk.fadda_sku} onChange={(e) => setBulk({ ...bulk, fadda_sku: e.target.value })}>
              <option value="">No fadda</option>
              {masters.fadda.map((f) => <option key={f.code} value={f.code}>{f.code}</option>)}
            </select>
            <input aria-label="Bulk fadda per box" type="number" min={0} className={`${field} w-20`} disabled={!bulk.touchFadda || !bulk.fadda_sku} value={bulk.fadda_per_box} onChange={(e) => setBulk({ ...bulk, fadda_per_box: e.target.value })} />
            <button type="button" className="erp-btn-primary" onClick={applyBulk}>Apply to selected</button>
            <button type="button" className="erp-btn-secondary" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
          {bulkNote && <p className="mt-2 text-xs text-muted-foreground" role="status">{bulkNote}</p>}
        </section>
      )}

      {changedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-signal-blue-line bg-signal-blue-soft p-3 text-sm text-signal-blue-ink">
          <span>{changedRows.length} row{changedRows.length === 1 ? "" : "s"} changed and not saved yet.</span>
          <button type="button" className="erp-btn-primary" onClick={saveChanged} disabled={changedRows.some((row) => state[row.id]?.saving)}>Save all changed rows</button>
        </div>
      )}

      {rowsQuery.isLoading || !mastersReady ? (
        <div role="status" className="erp-panel rounded-xl p-10 text-center text-sm">Loading specifications and packaging masters…</div>
      ) : rowsQuery.isError ? (
        <div className="rounded-xl border border-destructive p-6 text-sm">
          <p>{errorText(rowsQuery.error)}</p>
          <button type="button" className="erp-btn-secondary mt-3" onClick={() => rowsQuery.refetch()}>Retry</button>
        </div>
      ) : (
        <section className="erp-panel overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={allVisibleSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...visible.map((row) => row.id)]) : new Set([...selected].filter((id) => !visible.some((row) => row.id === id))))}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Customer / spec / size</th>
                  <th className="px-3 py-2 font-medium">Box (master)</th>
                  <th className="px-3 py-2 font-medium">Qty / box</th>
                  <th className="px-3 py-2 font-medium">Plastic · per box</th>
                  <th className="px-3 py-2 font-medium">Fadda · per box</th>
                  <th className="min-w-[15rem] px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const draft = draftOf(row)
                  const changed = edited(row)
                  const differs = draftChanged(draft, row.packing)
                  const rowState = state[row.id] || {}
                  const box = masters.boxes.find((b) => String(b.code).toUpperCase() === draft.box_code.toUpperCase())
                  const plastic = masters.plastics.find((p) => String(p.code).toUpperCase() === draft.plastic_sku.toUpperCase())
                  const fadda = masters.fadda.find((f) => String(f.code).toUpperCase() === draft.fadda_sku.toUpperCase())
                  const specBoxMissing = Boolean(row.packing.box_code) && !boxCodes.has(row.packing.box_code.toUpperCase())
                  return (
                    <tr key={row.id} data-testid="packing-row" data-spec-id={row.id} className={`border-t border-border align-top ${changed ? "bg-signal-blue-soft/40" : ""}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" aria-label={`Select ${row.customer_name} v${row.version}`} checked={selected.has(row.id)} onChange={(e) => setSelected((all) => { const next = new Set(all); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next })} />
                      </td>
                      <td className="max-w-[17rem] px-3 py-3">
                        <Link href={`/specifications/${row.id}`} className="font-semibold hover:underline">{row.customer_name}</Link>
                        <p className="text-xs text-muted-foreground">Spec v{row.version} · {row.id.slice(0, 8)} · {row.status}</p>
                        <p className="font-mono text-xs text-muted-foreground">{sizeText(row)}{row.target_tube_weight ? ` · ${row.target_tube_weight} g` : ""}</p>
                        {row.last_amendment && <p className="mt-1 text-xs text-muted-foreground">Packing amended {new Date(row.last_amendment.created_at).toLocaleDateString()}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <select aria-label={`Box for ${row.customer_name} v${row.version}`} className={`${field} w-40`} value={boxCodes.has(draft.box_code.toUpperCase()) ? draft.box_code.toUpperCase() : ""} onChange={(e) => setDraft(row, { box_code: e.target.value })}>
                          <option value="">Choose box</option>
                          {masters.boxes.map((b) => <option key={b.code} value={String(b.code).toUpperCase()}>{b.code} · {b.size_label || "size —"}</option>)}
                        </select>
                        {box ? (
                          <p className="mt-1 text-xs text-muted-foreground">{box.size_label || "size —"} · {kg(box.weight_kg)}</p>
                        ) : specBoxMissing && draft.box_code.toUpperCase() === row.packing.box_code.toUpperCase() ? (
                          <p className="mt-1 text-xs text-signal-rose-ink">
                            Spec says <span className="font-mono font-semibold">{row.packing.box_code}</span>: not in master.{" "}
                            <Link href={addBoxHref(row.packing.box_code)} className="font-semibold underline">Add box</Link>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <input aria-label={`Qty per box for ${row.customer_name} v${row.version}`} type="number" min={1} step={1} className={`${field} w-24`} value={draft.qty_per_box} onChange={(e) => setDraft(row, { qty_per_box: e.target.value })} />
                        <p className="mt-1 text-xs text-muted-foreground">pcs</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <select aria-label={`Plastic for ${row.customer_name} v${row.version}`} className={`${field} w-32`} value={draft.plastic_sku} onChange={(e) => setDraft(row, { plastic_sku: e.target.value, plastic_per_box: e.target.value ? draft.plastic_per_box && draft.plastic_per_box !== "0" ? draft.plastic_per_box : "1" : "0" })}>
                            <option value="">No plastic</option>
                            {masters.plastics.map((p) => <option key={p.code} value={String(p.code).toUpperCase()}>{p.code}</option>)}
                          </select>
                          <input aria-label={`Plastic per box for ${row.customer_name} v${row.version}`} type="number" min={0} className={`${field} w-16`} disabled={!draft.plastic_sku} value={draft.plastic_sku ? draft.plastic_per_box : "0"} onChange={(e) => setDraft(row, { plastic_per_box: e.target.value })} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{plastic ? `${plastic.size_label || "size —"} · ${kg(plastic.weight_kg)}` : "—"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <select aria-label={`Fadda for ${row.customer_name} v${row.version}`} className={`${field} w-28`} value={draft.fadda_sku} onChange={(e) => setDraft(row, { fadda_sku: e.target.value, fadda_per_box: e.target.value ? draft.fadda_per_box && draft.fadda_per_box !== "0" ? draft.fadda_per_box : "1" : "0" })}>
                            <option value="">No fadda</option>
                            {masters.fadda.map((f) => <option key={f.code} value={String(f.code).toUpperCase()}>{f.code}</option>)}
                          </select>
                          <input aria-label={`Fadda per box for ${row.customer_name} v${row.version}`} type="number" min={0} className={`${field} w-16`} disabled={!draft.fadda_sku} value={draft.fadda_sku ? draft.fadda_per_box : "0"} onChange={(e) => setDraft(row, { fadda_per_box: e.target.value })} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{fadda ? kg(fadda.weight_kg) : "—"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${row.complete ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-amber-soft text-signal-amber-ink"}`}>
                            {row.complete ? "Complete" : "Missing"}
                          </span>
                          {!row.complete && row.blockers.length > 0 && !changed && (
                            <ul className="list-disc pl-4 text-xs text-muted-foreground">
                              {row.blockers.map((text) => <li key={text}>{text.replace(/^Packing: /, "").replace(" from the Packaging master", "").replace(" (whole pieces)", "")}</li>)}
                            </ul>
                          )}
                          <button type="button" className={changed || !row.complete ? "erp-btn-primary" : "erp-btn-secondary"} disabled={rowState.saving} onClick={() => save(row)}>
                            {rowState.saving ? "Saving…" : changed || (differs && row.complete) ? "Save" : row.complete ? "Save again" : differs ? "Save with defaults" : "Save"}
                          </button>
                          {rowState.message && <p className="max-w-[16rem] text-xs text-signal-emerald-ink" role="status">{rowState.message}</p>}
                          {rowState.error && <p className="max-w-[16rem] text-xs text-signal-rose-ink" role="alert">{rowState.error}</p>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <div className="p-10 text-center">
              <p className="font-medium">{missingOnly && rows.length && complete === rows.length ? "Every active specification has its packing." : "No specifications match these filters."}</p>
              <p className="mt-1 text-sm text-muted-foreground">{missingOnly ? "Untick “Missing packing only” to see and change any spec." : "Clear a filter to see more."}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
