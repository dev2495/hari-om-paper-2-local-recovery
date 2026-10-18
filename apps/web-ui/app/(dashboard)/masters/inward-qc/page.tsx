"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { ArrowUpRight, ChevronRight, Layers, RefreshCw, Save, Search, Tag } from "lucide-react"

import { MATERIAL_TYPES, MaterialTypeTabs, materialTypeMeta } from "@/components/qc/MaterialTypeTabs"
import { Field, MessageBar, ProcurementShell, fieldClass } from "@/components/procurement/procurement-shell"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAdhesives, usePapers, useParchments } from "@/hooks/use-master-data"
import { useQualityStandardTolerances, useSaveQualityStandardItem, useSaveQualityStandardTolerances } from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

type Scope = { scope: "TYPE" | "GROUP" | "SUBGROUP" | "ITEM"; key: string; label: string }
type Line = { mode: "RANGE" | "PLUS_MINUS" | "PERCENT"; min: string; max: string; spread: string }

const MODES = [
  { value: "RANGE", label: "Min – max" },
  { value: "PLUS_MINUS", label: "± value" },
  { value: "PERCENT", label: "± %" },
] as const
const SCOPE_WORD: Record<string, string> = { ITEM: "this line", SUBGROUP: "colour", GROUP: "group", TYPE: "all" }
const PACKING_KINDS = ["Box", "Plastic sheet", "Fadda"]
const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
const num = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(Number(value)))
const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 4 }))
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return detail?.message || error?.message || "Could not save"
}

/** Master record for an inventory material (matched by id or code) and its nominal values per QC check. */
function masterNominals(type: string, item: any, papers: any[], adhesives: any[]): { source: string; values: Record<string, number> } | null {
  const pick = (rows: any[], codeField: string) => rows.find((row) => String(row.id) === String(item.id)) || rows.find((row) => norm(row[codeField]) && norm(row[codeField]) === norm(item.item_code))
  const values: Record<string, number> = {}
  const put = (code: string, value: unknown) => { const n = Number(value); if (value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n > 0) values[code] = n }
  if (type === "RAW_PAPER") {
    const paper = pick(papers, "code")
    if (!paper) return null
    put("gsm", paper.gsm); put("bf", paper.bf); put("caliper_mm", paper.thickness_mm); put("ply_bond", paper.ply_bond); put("bulk", paper.bulk_factor); put("width_mm", paper.width_mm)
    return { source: `paper master ${paper.code || paper.variety || ""}`.trim(), values }
  }
  if (type === "ADHESIVE") {
    const adhesive = pick(adhesives, "internal_code")
    if (!adhesive) return null
    put("viscosity", adhesive.viscosity); put("solid_content", adhesive.solid_content_percent); put("ph", adhesive.ph)
    return { source: `adhesive master ${adhesive.internal_code || adhesive.name || ""}`.trim(), values }
  }
  return null
}

function ToleranceWorkspace() {
  const params = useSearchParams()
  const initialType = MATERIAL_TYPES.some((type) => type.value === params.get("type")) ? String(params.get("type")) : "RAW_PAPER"
  const [materialType, setMaterialType] = useState(initialType)
  const meta = materialTypeMeta(materialType)
  const data = useQualityStandardTolerances(materialType)
  const papers = usePapers({ include_inactive: true })
  const adhesives = useAdhesives({ include_inactive: true })
  const parchments = useParchments({ include_inactive: true })
  const saveBands = useSaveQualityStandardTolerances()
  const saveItem = useSaveQualityStandardItem()
  const [selected, setSelected] = useState<Scope>({ scope: "TYPE", key: "", label: `All ${meta.label.toLowerCase()}` })
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [nominals, setNominals] = useState<Record<string, string>>({})
  const [group, setGroup] = useState("")
  const [subgroup, setSubgroup] = useState("")
  const [note, setNote] = useState("")
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const payload = data.data
  const parameters: any[] = useMemo(() => (payload?.parameters || []).filter((row: any) => row.measured), [payload])
  const items: any[] = useMemo(() => payload?.items || [], [payload])
  const tolerances: any[] = useMemo(() => payload?.tolerances || [], [payload])
  const selectedItem = selected.scope === "ITEM" ? items.find((row) => row.id === selected.key) : null
  const paperRows: any[] = useMemo(() => (Array.isArray(papers.data) ? papers.data : []), [papers.data])
  const adhesiveRows: any[] = useMemo(() => (Array.isArray(adhesives.data) ? adhesives.data : []), [adhesives.data])
  const parchmentRows: any[] = useMemo(() => (Array.isArray(parchments.data) ? parchments.data : []), [parchments.data])

  // Group / sub-group names offered from the masters; any other name can still be typed.
  const groupOptions = useMemo(() => {
    const names = new Set<string>((payload?.groups || []).map((row: any) => row.group))
    if (materialType === "RAW_PAPER") paperRows.forEach((row) => row.variety && names.add(String(row.variety)))
    if (materialType === "ADHESIVE") adhesiveRows.forEach((row) => row.variety && names.add(String(row.variety)))
    if (materialType === "PARCHMENT") parchmentRows.forEach((row) => row.vendor_name && names.add(String(row.vendor_name)))
    if (materialType === "PACKAGING") PACKING_KINDS.forEach((kind) => names.add(kind))
    return [...names].filter(Boolean).sort()
  }, [payload, materialType, paperRows, adhesiveRows, parchmentRows])
  const subgroupOptions = (forGroup: string) => {
    const names = new Set<string>(((payload?.groups || []).find((row: any) => row.group === forGroup)?.subgroups) || [])
    parchmentRows.filter((row) => row.vendor_name === forGroup && row.color_name).forEach((row) => names.add(String(row.color_name)))
    return [...names].sort()
  }

  const tree = useMemo(() => {
    const groups = new Map<string, { subgroups: Map<string, any[]>; lines: any[] }>()
    const ungrouped: any[] = []
    for (const item of items) {
      if (!item.material_group) { ungrouped.push(item); continue }
      const entry = groups.get(item.material_group) || { subgroups: new Map(), lines: [] }
      if (item.material_subgroup) entry.subgroups.set(item.material_subgroup, [...(entry.subgroups.get(item.material_subgroup) || []), item])
      else entry.lines.push(item)
      groups.set(item.material_group, entry)
    }
    for (const row of payload?.groups || []) {
      const entry = groups.get(row.group) || { subgroups: new Map(), lines: [] }
      for (const sub of row.subgroups || []) if (!entry.subgroups.has(sub)) entry.subgroups.set(sub, [])
      groups.set(row.group, entry)
    }
    return { groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)), ungrouped }
  }, [items, payload])

  const bandCount = (scope: string, key: string) => tolerances.filter((row) => row.scope === scope && row.scope_key === key).length

  // Load the editor whenever the scope or the saved data changes.
  const signature = JSON.stringify([selected, tolerances, selectedItem?.qc_nominals, selectedItem?.material_group, selectedItem?.material_subgroup])
  useEffect(() => {
    const next: Record<string, Line> = {}
    for (const parameter of parameters) {
      const row = tolerances.find((t) => t.scope === selected.scope && t.scope_key === selected.key && t.parameter_key === parameter.parameter_key)
      next[parameter.parameter_key] = row
        ? { mode: row.mode, min: num(row.min_value), max: num(row.max_value), spread: num(row.tolerance_value) }
        : { mode: "RANGE", min: "", max: "", spread: "" }
    }
    setLines(next)
    setNominals(Object.fromEntries(parameters.map((p) => [p.parameter_key, num(selectedItem?.qc_nominals?.[p.parameter_key])])))
    setGroup(selectedItem?.material_group || "")
    setSubgroup(selectedItem?.material_subgroup || "")
    setNote("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, parameters.length])

  useEffect(() => { setSelected({ scope: "TYPE", key: "", label: `All ${materialTypeMeta(materialType).label.toLowerCase()}` }); setError(""); setNotice("") }, [materialType])

  const master = selectedItem ? masterNominals(materialType, selectedItem, paperRows, adhesiveRows) : null
  const unsynced = items.filter((item) => {
    const found = masterNominals(materialType, item, paperRows, adhesiveRows)
    return found && Object.entries(found.values).some(([code, value]) => parameters.some((p) => p.parameter_key === code) && Number(item.qc_nominals?.[code]) !== value)
  })

  const setLine = (code: string, patch: Partial<Line>) => setLines((current) => ({ ...current, [code]: { ...current[code], ...patch } }))
  const preview = (code: string) => {
    const line = lines[code]
    if (!line) return null
    const nominal = selected.scope === "ITEM" ? Number(nominals[code]) : NaN
    if (line.mode === "RANGE") return line.min || line.max ? `${line.min || "—"} to ${line.max || "—"}` : null
    if (!line.spread) return null
    if (!Number.isFinite(nominal) || nominals[code] === "") return `± ${line.spread}${line.mode === "PERCENT" ? "%" : ""} around each line's nominal`
    const spread = line.mode === "PERCENT" ? Math.abs(nominal) * Number(line.spread) / 100 : Number(line.spread)
    return `${show(nominal - spread)} to ${show(nominal + spread)}`
  }

  const save = async () => {
    setError(""); setNotice("")
    try {
      let itemChanged = false
      if (selectedItem) {
        const nominalPayload = Object.fromEntries(parameters.map((p) => [p.parameter_key, nominals[p.parameter_key] === "" ? null : Number(nominals[p.parameter_key])]))
        const result = await saveItem.mutateAsync({ id: selectedItem.id, data: { material_group: group || null, material_subgroup: meta.subgroup ? subgroup || null : null, qc_nominals: nominalPayload } })
        itemChanged = Boolean(result.data?.changed)
      }
      const result = await saveBands.mutateAsync({
        material_type: materialType, scope: selected.scope, scope_key: selected.key, note,
        lines: parameters.map((p) => {
          const line = lines[p.parameter_key] || { mode: "RANGE", min: "", max: "", spread: "" }
          return line.mode === "RANGE"
            ? { parameter_key: p.parameter_key, mode: "RANGE" as const, min_value: line.min === "" ? null : Number(line.min), max_value: line.max === "" ? null : Number(line.max) }
            : { parameter_key: p.parameter_key, mode: line.mode, tolerance_value: line.spread === "" ? null : Number(line.spread) }
        }),
      })
      const changed = result.data?.changed?.length || 0
      setNotice(changed || itemChanged ? `Saved. ${result.data?.items_updated ?? 0} material line(s) now inspect against the new band${changed === 1 ? "" : "s"}; lots already received keep the band they arrived with.` : "No change to save.")
    } catch (err) { setError(errorText(err)) }
  }

  const syncFromMasters = async () => {
    setError(""); setNotice("")
    try {
      for (const item of unsynced) {
        const found = masterNominals(materialType, item, paperRows, adhesiveRows)
        if (!found) continue
        const values = Object.fromEntries(Object.entries(found.values).filter(([code]) => parameters.some((p) => p.parameter_key === code)))
        const groupName = item.material_group || (materialType === "RAW_PAPER" ? paperRows.find((p) => norm(p.code) === norm(item.item_code))?.variety : adhesiveRows.find((a) => norm(a.internal_code) === norm(item.item_code))?.variety) || null
        await saveItem.mutateAsync({ id: item.id, data: { qc_nominals: values, ...(item.material_group ? {} : { material_group: groupName }) } })
      }
      setNotice(`Nominals copied from the masters for ${unsynced.length} line(s).`)
    } catch (err) { setError(errorText(err)) }
  }

  const node = (scope: Scope, depth: number, extra?: string) => {
    const active = selected.scope === scope.scope && selected.key === scope.key
    const count = bandCount(scope.scope, scope.key)
    return (
      <button key={`${scope.scope}:${scope.key}`} type="button" onClick={() => { setSelected(scope); setError(""); setNotice("") }}
        className={cn("flex w-full min-h-10 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors", active ? "bg-primary/10 text-foreground ring-1 ring-primary/30" : "hover:bg-muted")}
        style={{ paddingLeft: `${10 + depth * 16}px` }} aria-current={active ? "true" : undefined}>
        {scope.scope === "ITEM" ? <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Layers className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
        <span className={cn("min-w-0 flex-1 truncate", scope.scope !== "ITEM" && "font-semibold")}>{scope.label}{extra ? <span className="ml-1 font-normal text-muted-foreground">{extra}</span> : null}</span>
        {count ? <span className="rounded-full bg-signal-cyan-soft px-2 py-0.5 text-[11px] font-semibold text-signal-cyan-ink">{count} band{count === 1 ? "" : "s"}</span> : null}
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-transparent")} aria-hidden="true" />
      </button>
    )
  }
  const matches = (item: any) => !search || `${item.item_code} ${item.name}`.toLowerCase().includes(search.toLowerCase())
  const itemLabel = (item: any) => `${item.item_code} · ${item.name}`

  return (
    <ProcurementShell eyebrow="Masters" title="Inward QC tolerances" description="Set the accepted band for each QC check — for all of a material type, a group (paper variety, parchment company), a parchment colour, or one material line. The most specific band wins. Lots arriving later are checked against it; a reading outside the band holds the lot.">
      <MaterialTypeTabs value={materialType} onChange={setMaterialType} />
      {error ? <MessageBar tone="error">{error}</MessageBar> : null}
      {notice ? <MessageBar tone="success">{notice}</MessageBar> : null}
      {data.isLoading ? <LoadingState label="Loading tolerances…" /> : data.isError ? <ErrorState message="Tolerances could not be loaded." onRetry={() => data.refetch()} /> : !parameters.length ? (
        <MessageBar tone="info">QC has no measured checks switched on for {meta.label.toLowerCase()}. <Link className="font-semibold underline" href="/quality/material-standards">Open Material standards</Link> to add one.</MessageBar>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <nav aria-label={`${meta.label} lines and groups`} className="space-y-2 rounded-xl border border-border bg-card p-3 lg:sticky lg:top-20">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-2.5"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="w-full bg-transparent text-[13px] outline-none" placeholder="Find a material line" aria-label="Find a material line" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <div className="max-h-[62vh] space-y-0.5 overflow-auto pr-1">
              {node({ scope: "TYPE", key: "", label: `All ${meta.label.toLowerCase()}` }, 0, "default")}
              {tree.groups.map(([name, entry]) => (
                <div key={name}>
                  {node({ scope: "GROUP", key: name, label: name }, 1)}
                  {[...entry.subgroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sub, subItems]) => (
                    <div key={sub}>
                      {node({ scope: "SUBGROUP", key: `${name}||${sub}`, label: sub }, 2)}
                      {subItems.filter(matches).map((item) => node({ scope: "ITEM", key: item.id, label: itemLabel(item) }, 3))}
                    </div>
                  ))}
                  {entry.lines.filter(matches).map((item) => node({ scope: "ITEM", key: item.id, label: itemLabel(item) }, 2))}
                </div>
              ))}
              {tree.ungrouped.filter(matches).length ? <p className="px-2.5 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">No {meta.group.toLowerCase()} yet</p> : null}
              {tree.ungrouped.filter(matches).map((item) => node({ scope: "ITEM", key: item.id, label: itemLabel(item) }, 1))}
              {!items.length ? <p className="px-2.5 py-3 text-[12.5px] text-muted-foreground">No {meta.label.toLowerCase()} lines in this plant yet. Add them in Inventory › Material items.</p> : null}
            </div>
            {unsynced.length ? (
              <div className="rounded-lg border border-signal-amber-line bg-signal-amber-soft p-2.5 text-[12.5px] text-signal-amber-ink">
                {unsynced.length} line(s) have nominal values in the {meta.label.toLowerCase()} master not yet copied here.
                <button type="button" className="mt-2 flex items-center gap-1.5 font-semibold underline" onClick={syncFromMasters} disabled={saveItem.isPending}><RefreshCw className="h-3.5 w-3.5" />Copy nominals from master</button>
              </div>
            ) : null}
          </nav>

          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="tolerance-editor">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{selected.scope === "TYPE" ? "Default for every line" : selected.scope === "GROUP" ? meta.group : selected.scope === "SUBGROUP" ? `${meta.group} › ${meta.subgroup}` : "Material line"}</p>
                <h2 className="truncate text-[16px] font-semibold">{selected.scope === "SUBGROUP" ? selected.key.replace("||", " › ") : selected.label}</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{selected.scope === "ITEM" ? "Leave a band blank to use the colour / group / default band shown on the right." : "Lines below this inherit these bands unless they set their own."}</p>
              </div>
              <Link href="/quality/material-standards" className="erp-btn-secondary !h-9">QC checks<ArrowUpRight className="h-4 w-4" /></Link>
            </header>

            {selectedItem ? (
              <div className="grid gap-3 border-b border-border bg-muted/30 px-4 py-3 sm:grid-cols-2">
                <Field label={meta.group}>
                  <input className={fieldClass} list="qc-group-options" value={group} onChange={(e) => { setGroup(e.target.value); setSubgroup("") }} placeholder={`Choose or type a ${meta.group.toLowerCase()}`} />
                  <datalist id="qc-group-options">{groupOptions.map((name) => <option key={name} value={name} />)}</datalist>
                </Field>
                {meta.subgroup ? (
                  <Field label={meta.subgroup} hint={group ? undefined : `choose the ${meta.group.toLowerCase()} first`}>
                    <input className={fieldClass} list="qc-subgroup-options" value={subgroup} disabled={!group} onChange={(e) => setSubgroup(e.target.value)} placeholder={`Choose or type a ${meta.subgroup.toLowerCase()}`} />
                    <datalist id="qc-subgroup-options">{subgroupOptions(group).map((name) => <option key={name} value={name} />)}</datalist>
                  </Field>
                ) : null}
                {master ? <p className="text-[12px] text-muted-foreground sm:col-span-2">Nominal values from the {master.source}: {Object.entries(master.values).map(([code, value]) => `${parameters.find((p) => p.parameter_key === code)?.label || code} ${value}`).join(" · ") || "none"}.</p> : null}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="tube-grid w-full min-w-[720px]">
                <thead>
                  <tr><th>Check</th>{selectedItem ? <th>Nominal</th> : null}<th>Band type</th><th>Band</th><th>{selectedItem ? "Inspected against" : "Resulting band"}</th></tr>
                </thead>
                <tbody>
                  {parameters.map((parameter) => {
                    const code = parameter.parameter_key
                    const line = lines[code] || { mode: "RANGE", min: "", max: "", spread: "" }
                    const inherited = selectedItem?.bands?.[code]
                    return (
                      <tr key={code}>
                        <td><p className="font-medium">{parameter.label}</p><p className="text-[11.5px] text-muted-foreground">{parameter.unit || "no unit"}{parameter.required ? "" : " · optional"}</p></td>
                        {selectedItem ? <td><input className={cn(fieldClass, "w-24")} type="number" step="any" aria-label={`${parameter.label} nominal`} value={nominals[code] ?? ""} onChange={(e) => setNominals({ ...nominals, [code]: e.target.value })} placeholder={master?.values[code] != null ? String(master.values[code]) : ""} /></td> : null}
                        <td>
                          <select className={cn(fieldClass, "w-[8.75rem]")} aria-label={`${parameter.label} band type`} value={line.mode} onChange={(e) => setLine(code, { mode: e.target.value as Line["mode"] })}>
                            {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                          </select>
                        </td>
                        <td>
                          {line.mode === "RANGE" ? (
                            <div className="flex items-center gap-1.5">
                              <input className={cn(fieldClass, "w-24")} type="number" step="any" aria-label={`${parameter.label} minimum`} placeholder="min" value={line.min} onChange={(e) => setLine(code, { min: e.target.value })} />
                              <span className="text-muted-foreground">to</span>
                              <input className={cn(fieldClass, "w-24")} type="number" step="any" aria-label={`${parameter.label} maximum`} placeholder="max" value={line.max} onChange={(e) => setLine(code, { max: e.target.value })} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5"><span className="text-muted-foreground">±</span><input className={cn(fieldClass, "w-24")} type="number" step="any" min="0" aria-label={`${parameter.label} tolerance`} value={line.spread} onChange={(e) => setLine(code, { spread: e.target.value })} /><span className="text-muted-foreground">{line.mode === "PERCENT" ? "%" : parameter.unit}</span></div>
                          )}
                        </td>
                        <td className="text-[12.5px]">
                          {preview(code) ? <span className="font-medium">{preview(code)}</span> : selectedItem && inherited && (inherited.min != null || inherited.max != null) && inherited.source !== "ITEM" ? (
                            <span>{show(inherited.min)} to {show(inherited.max)} <span className="text-muted-foreground">· from {SCOPE_WORD[inherited.source] || "default"}</span></span>
                          ) : <span className="text-muted-foreground">Recorded only — no band</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <footer className="flex flex-wrap items-end gap-3 border-t border-border bg-muted/30 px-4 py-3">
              <div className="min-w-[240px] flex-1"><Field label="Reason for the change" hint="optional, kept in history"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier agreed GSM ±4%" /></Field></div>
              <button type="button" className="erp-btn-primary" disabled={saveBands.isPending || saveItem.isPending} onClick={save}><Save className="h-4 w-4" />Save bands</button>
            </footer>
          </section>
        </div>
      )}
    </ProcurementShell>
  )
}

export default function InwardQcTolerancesPage() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <Suspense fallback={<LoadingState label="Loading tolerances…" />}>
        <ToleranceWorkspace />
      </Suspense>
    </RoleGate>
  )
}
