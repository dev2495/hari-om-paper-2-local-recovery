"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CloudRain, Copy, History, Pencil, RotateCcw, Save, Sun, Users } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { command, errorText, seasonApi, seasonApiForPlant, seasonLabel, type Season } from "@/lib/season-api"
import { specApi } from "@/lib/api"
import { useCustomers } from "@/hooks/use-master-data"
import { cn } from "@/lib/utils"

const references: Record<string, string> = { CUSTOMER_ID: "Customer I.D.", CUSTOMER_OD: "Customer O.D.", CUSTOMER_LENGTH: "Customer length", CUSTOMER_WEIGHT: "Customer weight", CUSTOMER_CS: "Customer C.S.", MANDREL_DIAMETER: "Mandrel diameter", WINDING_LENGTH: "Bamboo length", MOISTURE_MIN: "Customer moisture min", MOISTURE_MAX: "Customer moisture max", CONST: "Fixed value", "SAMPLE.pre_weight": "Same sample's pre-weight" }
const stages = ["WINDER", "OVEN", "PROCESS"]
const stageLabel = (value: string) => value === "WINDER" ? "Winding" : value === "OVEN" ? "Oven" : "Process"
const control = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const numberField = "h-10 shrink-0 rounded-lg border border-border bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const num = (value: number) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 4 })

/** One bound term in words: "Customer O.D. + 0.8", "0.4 × Customer C.S. − 10", "400". */
function termText(term: any) {
  const factor = Number(term.factor ?? 1)
  const offset = Number(term.offset ?? 0)
  if (term.ref === "CONST") return num(offset)
  const base = `${factor !== 1 ? `${num(factor)} × ` : ""}${references[term.ref] || term.ref}`
  return offset ? `${base} ${offset > 0 ? "+" : "−"} ${num(Math.abs(offset))}` : base
}
function sideText(terms: any[], side: "lower" | "upper") {
  if (!terms?.length) return ""
  if (terms.length === 1) return termText(terms[0])
  return `${side === "lower" ? "highest" : "lowest"} of (${terms.map(termText).join(", ")})`
}
/** The rule the way the floor reads it. */
function ruleText(row: any) {
  if (row.mode === "RECORD_ONLY") return "Recorded only — no limit"
  const lower = sideText(row.lower, "lower")
  const upper = sideText(row.upper, "upper")
  if (lower && upper) return `${lower}  to  ${upper}`
  if (lower) return `at least ${lower}`
  if (upper) return `at most ${upper}`
  return "No band set"
}

export default function StageRulesPage() {
  const { user, activePlant } = useAuth()
  const hasConcretePlant = Boolean(activePlant && activePlant.toUpperCase() !== "ALL")
  const overlayApi = seasonApiForPlant(activePlant || "")
  const roles = new Set([user?.role, ...(user?.roles || [])])
  const canEdit = ["QC", "Owner", "Admin"].some(r => roles.has(r))
  const cache = useQueryClient()
  const [season, setSeason] = useState<Season>("ROY")
  const [rows, setRows] = useState<any[]>([])
  const [editing, setEditing] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [tab, setTab] = useState<"rules" | "overlays">("rules")
  const [targetType, setTargetType] = useState("CUSTOMER")
  const [targetId, setTargetId] = useState("")
  const [overlaySeason, setOverlaySeason] = useState("BOTH")
  const [overlayCodes, setOverlayCodes] = useState<string[]>([])
  const rules = useQuery({ queryKey: ["season-rules", season], queryFn: async () => (await seasonApi.rules(season)).data })
  const overlays = useQuery({ queryKey: ["season-overlays", activePlant], queryFn: async () => (await overlayApi.overlays()).data, enabled: tab === "overlays" && hasConcretePlant })
  const customers = useCustomers()
  const specs = useQuery({ queryKey: ["overlay-spec-options", activePlant], queryFn: async () => (await specApi.getSpecs()).data, enabled: tab === "overlays" && targetType === "SPEC" && hasConcretePlant })
  // What is in use is the published version; a leftover draft from the old two-step flow is shown as a note.
  const inUse = rules.data?.published || rules.data?.draft
  const baseRules: any[] = useMemo(() => inUse?.rules || [], [inUse])
  const scopedOverrides = (overlays.data || []).filter((o: any) => o.target_type === targetType && o.target_id === targetId && o.season === overlaySeason)
  const existingOverride = scopedOverrides.find((o: any) => o.status === "DRAFT") || scopedOverrides.find((o: any) => o.status === "PUBLISHED")
  const overlayReadError = tab === "overlays" && hasConcretePlant ? overlays.error || customers.error || (targetType === "SPEC" ? specs.error : null) : null
  const signature = JSON.stringify([baseRules, existingOverride || null, tab])
  useEffect(() => {
    const override = tab === "overlays" ? existingOverride : null
    setRows(baseRules.map((r: any) => override?.rules.find((o: any) => o.rule_id === r.rule_id) || structuredClone(r)))
    setOverlayCodes(override?.rules.map((o: any) => o.rule_id) || [])
    setNote(override?.reason || ""); setError(""); setEditing([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, season, targetType, targetId, overlaySeason])
  const changedIds = rows.filter((row) => JSON.stringify(row) !== JSON.stringify(baseRules.find((r: any) => r.rule_id === row.rule_id))).map((row) => row.rule_id)
  const dirty = changedIds.length > 0
  const mutation = useMutation({
    mutationFn: async (run: () => Promise<any>) => run(),
    onSuccess: () => { setError(""); setEditing([]); cache.invalidateQueries({ queryKey: ["season-rules"] }); cache.invalidateQueries({ queryKey: ["season-overlays"] }); cache.invalidateQueries({ queryKey: ["season-spec-qc"] }); cache.invalidateQueries({ queryKey: ["spec-summary"] }) },
    onError: e => { setError(errorText(e)); setNotice("") },
  })
  const indexOf = (id: string) => rows.findIndex((row) => row.rule_id === id)
  const change = (id: string, patch: any) => setRows(current => current.map((row) => row.rule_id === id ? { ...row, ...patch } : row))
  const termChange = (id: string, side: string, termIndex: number, patch: any) => change(id, { [side]: rows[indexOf(id)][side].map((term: any, i: number) => i === termIndex ? { ...term, ...patch } : term) })
  const startEdit = (id: string) => setEditing((current) => current.includes(id) ? current : [...current, id])
  const undoRow = (id: string) => { const original = baseRules.find((r: any) => r.rule_id === id); if (original) change(id, structuredClone(original)); setEditing((current) => current.filter((v) => v !== id)) }

  const saveVersion = () => mutation.mutate(async () => {
    // One step for QC: save the edited rules and make them the version in use.
    const saved = await seasonApi.saveRules(season, command({ expected_version: rules.data?.draft?.row_version, rules: rows, note }))
    const published = await seasonApi.publishRules(season, command({ expected_version: saved.data?.row_version, note }))
    const impact = published.data?.impact
    setNotice(`Saved as version ${published.data?.published?.version ?? ""}. ${impact ? `${impact.specs_checked} specifications checked${impact.blocked_count ? ` · ${impact.blocked_count} need attention before release: ${(impact.blocked || []).map((v: any) => v.customer).join(", ")}` : " · all can release on it"}.` : ""}`)
    setNote("")
    return published
  })

  const editor = (row: any) => {
    const id = row.rule_id
    return (
      <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[.03] p-3" data-testid={`rule-editor-${row.parameter}`}>
        <div className="flex flex-wrap items-center gap-3">
          <select className={control} aria-label={`${row.label} rule mode`} value={row.mode} onChange={e => change(id, { mode: e.target.value, lower: e.target.value === "RECORD_ONLY" ? [] : row.lower?.length ? row.lower : [{ ref: "CONST", factor: 1, offset: 0 }], upper: e.target.value === "RECORD_ONLY" ? [] : row.upper })}><option value="BAND">Tolerance band</option><option value="RECORD_ONLY">Record only</option></select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!row.requires_instrument} onChange={e => change(id, { requires_instrument: e.target.checked })} />Calibrated instrument</label>
          <label className="flex items-center gap-2 text-sm">Readings per batch <input aria-label={`${row.label} minimum readings`} className={`${numberField} w-16`} type="number" min={2} max={10} value={row.min_readings} onChange={e => change(id, { min_readings: Math.max(2, Number(e.target.value)) })} /></label>
        </div>
        {row.mode === "RECORD_ONLY" ? <p className="text-sm text-muted-foreground">QC records a valid reading; no tolerance is checked.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(["lower", "upper"] as const).map(side => (
              <div key={side} className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">{side === "lower" ? "Minimum (if several, the highest applies)" : "Maximum (if several, the lowest applies)"}</p>
                {(row[side] || []).map((term: any, ti: number) => (
                  <div key={ti} className="flex items-center gap-2">
                    <select className={`${control} min-w-0 flex-1`} aria-label={`${row.label} ${side} reference`} value={term.ref} onChange={e => termChange(id, side, ti, { ref: e.target.value })}>{Object.entries(references).filter(([ref]) => !ref.startsWith("SAMPLE") || row.stage === "OVEN" && row.parameter === "post_weight").map(([ref, label]) => <option key={ref} value={ref}>{label}</option>)}</select>
                    {term.ref !== "CONST" ? <><span className="text-muted-foreground" aria-hidden="true">×</span><input type="number" step="any" className={`${numberField} w-16`} aria-label={`${row.label} ${side} factor`} title="Multiply by" value={term.factor} onChange={e => termChange(id, side, ti, { factor: Number(e.target.value) })} /><span className="text-muted-foreground" aria-hidden="true">+</span></> : null}
                    <input type="number" step="any" className={`${numberField} w-20`} aria-label={`${row.label} ${side} ${term.ref === "CONST" ? "value" : "offset"}`} title={term.ref === "CONST" ? "Value" : "Add (use − to subtract)"} value={term.offset} onChange={e => termChange(id, side, ti, { offset: Number(e.target.value) })} />
                    <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove this term" onClick={() => change(id, { [side]: row[side].filter((_: any, i: number) => i !== ti) })}>×</button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => change(id, { [side]: [...(row[side] || []), { ref: "CONST", factor: 1, offset: 0 }] })}>+ Add a {side === "lower" ? "minimum" : "maximum"}</Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[12.5px]"><span className="text-muted-foreground">Reads as: </span><span className="font-medium">{ruleText(row)} {row.mode !== "RECORD_ONLY" ? row.unit : ""}</span></p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setEditing((current) => current.filter((v) => v !== id))}>Done</Button>
          <Button size="sm" variant="outline" onClick={() => undoRow(id)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Undo</Button>
        </div>
      </div>
    )
  }

  return <div className="space-y-5" data-testid="stage-rules-page">
    <PageHeader title="Process stage rules" description="The winding, oven and process tolerances in use for each season. Edit a rule only when needed; saving makes a new version. Job cards released after that use it; cards already released keep the version they were released with." />
    <QualityDeskNav />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-xl border border-border bg-muted p-1" role="tablist" aria-label="QC season">
        {(["ROY", "MONSOON"] as Season[]).map(s => <Button key={s} variant={s === season ? "default" : "ghost"} onClick={() => { if (!dirty || window.confirm("Discard the rule changes you have not saved?")) setSeason(s) }} role="tab" aria-selected={s === season}>{s === "MONSOON" ? <CloudRain className="mr-2 h-4 w-4" /> : <Sun className="mr-2 h-4 w-4" />}{seasonLabel(s)}</Button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}><History className="mr-2 h-4 w-4" />Version history</Button>
        <Button variant={tab === "overlays" ? "default" : "outline"} onClick={() => { if (!dirty || window.confirm("Discard the rule changes you have not saved?")) setTab(tab === "rules" ? "overlays" : "rules") }}><Users className="mr-2 h-4 w-4" />{tab === "rules" ? "Customer / spec overrides" : "Back to season rules"}</Button>
      </div>
    </div>
    {error && <div role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-signal-emerald-line bg-signal-emerald-soft p-4 text-sm text-signal-emerald-ink">{notice}</div>}
    {overlayReadError && <div role="alert" className="space-y-2 rounded-xl border border-destructive bg-destructive/10 p-4 text-sm"><p>Could not load override options or history: {errorText(overlayReadError)}</p><Button variant="outline" onClick={() => { overlays.refetch(); customers.refetch(); if (targetType === "SPEC") specs.refetch() }}>Retry</Button></div>}
    {tab === "overlays" && !hasConcretePlant && <section className="space-y-2 rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Choose a plant for customer or specification overrides</h2><p className="text-sm text-muted-foreground">Select one plant in the plant selector at the top to load its customers, specifications and override history.</p></section>}
    {rules.isLoading && <p role="status">Loading stage rules…</p>}
    {rules.isError && <Button onClick={() => rules.refetch()}>Retry loading rules</Button>}
    {!inUse && !rules.isLoading && !rules.isError && tab === "rules" && <section className="rounded-xl border border-dashed border-border bg-card p-8"><h2 className="text-xl font-semibold">Set up the seasonal standards</h2><p className="my-3 text-muted-foreground">Rest of year and Monsoon begin with the client&apos;s base rules.</p>{canEdit && <Button disabled={mutation.isPending} onClick={() => mutation.mutate(() => seasonApi.bootstrap(command()))}>Create the base rules</Button>}</section>}
    {inUse && (tab === "rules" || hasConcretePlant) && <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="rounded-full bg-signal-emerald-soft px-3 py-1 font-semibold text-signal-emerald-ink ring-1 ring-signal-emerald-line">{rules.data?.published ? `In use: version ${rules.data.published.version}` : "Not yet in use"}</span>
        {rules.data?.published?.published_at ? <span className="text-muted-foreground">since {new Date(`${rules.data.published.published_at}Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{rules.data.published.published_by ? ` · ${rules.data.published.published_by}` : ""}{rules.data.published.change_note ? ` · “${rules.data.published.change_note}”` : ""}</span> : null}
        <span className="text-muted-foreground">Every batch needs at least 2 readings per check; QC may add more.</span>
        {rules.data?.draft && rules.data?.published && canEdit && tab === "rules" ? <span className="flex items-center gap-2 text-signal-amber-ink">A saved draft (version {rules.data.draft.version}) is not in use yet.<Button size="sm" variant="outline" onClick={() => { setRows(structuredClone(rules.data.draft.rules)); setNote(rules.data.draft.change_note || "") }}>Review that draft</Button></span> : null}
      </div>
      {tab === "overlays" && <section className="space-y-3 rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Override rules for one customer or specification</h2><p className="text-sm text-muted-foreground">Pick the customer or spec, tick the rules it overrides and edit them. A possibly wider rule needs Owner/Admin to publish it.</p><div className="flex flex-wrap gap-2"><select className={control} aria-label="Override target type" value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId("") }}><option value="CUSTOMER">Customer</option><option value="SPEC">Specification</option></select><select className={control} aria-label="Override target" value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Select {targetType.toLowerCase()}</option>{(targetType === "CUSTOMER" ? customers.data || [] : specs.data || []).map((v: any) => <option key={v.id} value={targetType === "CUSTOMER" ? v.id : v.lineage_id || v.id}>{v.name || v.customer_name} {v.spec_reference || ""}</option>)}</select><select className={control} aria-label="Override season" value={overlaySeason} onChange={e => { setOverlaySeason(e.target.value); if (e.target.value !== "BOTH") setSeason(e.target.value as Season) }}><option value="BOTH">Both seasons</option><option value="ROY">Rest of year</option><option value="MONSOON">Monsoon</option></select></div></section>}
      {stages.map(stage => (
        <section key={stage} className="overflow-hidden rounded-xl border border-border bg-card" data-testid={`stage-rules-${stage}`}>
          <header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-lg font-semibold">{stageLabel(stage)}</h2><span className="text-[12.5px] text-muted-foreground">{rows.filter((row) => row.stage === stage).length} checks</span></header>
          <div className="overflow-x-auto">
            <table className="tube-grid w-full min-w-[760px]">
              <thead><tr>{tab === "overlays" ? <th className="w-10">Override</th> : null}<th>Check</th><th>Allowed band</th><th>Readings</th><th>Instrument</th><th className="text-right">{canEdit ? "Action" : ""}</th></tr></thead>
              <tbody>
                {rows.filter((row) => row.stage === stage).map((row) => {
                  const changed = changedIds.includes(row.rule_id)
                  const isEditing = editing.includes(row.rule_id)
                  return (
                    <Fragment key={row.rule_id}>
                      <tr className={cn(changed && "bg-signal-amber-soft/40")}>
                        {tab === "overlays" ? <td><input type="checkbox" aria-label={`Override ${row.label}`} checked={overlayCodes.includes(row.rule_id)} onChange={e => setOverlayCodes(c => e.target.checked ? [...c, row.rule_id] : c.filter(v => v !== row.rule_id))} /></td> : null}
                        <td><p className="font-medium">{row.label}</p><p className="text-[11.5px] text-muted-foreground">{row.unit || "no unit"}{row.required === false ? " · optional" : ""}{changed ? " · changed, not saved" : ""}</p></td>
                        <td className="text-[13px]">{ruleText(row)} <span className="text-muted-foreground">{row.mode !== "RECORD_ONLY" ? row.unit : ""}</span></td>
                        <td className="tabular-nums">{row.min_readings}+</td>
                        <td>{row.requires_instrument ? "Calibrated" : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right">{canEdit && !isEditing ? <Button size="sm" variant="outline" onClick={() => startEdit(row.rule_id)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button> : null}</td>
                      </tr>
                      {isEditing ? <tr><td colSpan={tab === "overlays" ? 6 : 5}>{editor(row)}</td></tr> : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {canEdit && (dirty || tab === "overlays") ? (
        <section className="sticky bottom-2 z-10 space-y-3 rounded-xl border border-primary/30 bg-card p-4 shadow-lg" data-testid="stage-rules-save">
          <p className="text-sm font-semibold">{tab === "overlays" ? `${overlayCodes.length} rule(s) ticked for this override` : `${changedIds.length} rule(s) changed`}</p>
          <Input aria-label="Change reason" placeholder="Reason for this version (required) — e.g. customer asked for tighter C.S." value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {tab === "overlays"
              ? <Button disabled={!targetId || !note.trim() || !overlayCodes.length || mutation.isPending} onClick={() => mutation.mutate(() => overlayApi.saveOverlay(command({ target_type: targetType, target_id: targetId, season: overlaySeason, expected_version: existingOverride?.status === "DRAFT" ? existingOverride.row_version : undefined, note, rules: rows.filter(r => overlayCodes.includes(r.rule_id)) })))}>Save override draft</Button>
              : <Button disabled={!note.trim() || mutation.isPending} onClick={saveVersion}><Save className="mr-2 h-4 w-4" />Save as new version</Button>}
            {season === "MONSOON" && tab === "rules" ? <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(async () => { const r = await seasonApi.rules("ROY"); setRows(structuredClone((r.data.published || r.data.draft).rules)); return r })}><Copy className="mr-2 h-4 w-4" />Copy rest-of-year rules</Button> : null}
            {dirty ? <Button variant="outline" disabled={mutation.isPending} onClick={() => { setRows(structuredClone(baseRules)); setEditing([]) }}>Discard changes</Button> : null}
          </div>
        </section>
      ) : canEdit && tab === "rules" && season === "MONSOON" ? (
        <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(async () => { const r = await seasonApi.rules("ROY"); setRows(structuredClone((r.data.published || r.data.draft).rules)); return r })}><Copy className="mr-2 h-4 w-4" />Start from the rest-of-year rules</Button>
      ) : null}
      {tab === "overlays" && <section className="space-y-2"><h2 className="font-semibold">Override history</h2>{overlays.isLoading ? <p>Loading overrides…</p> : overlays.isError ? <p className="text-sm text-destructive">Override history is unavailable. Retry above.</p> : !overlays.data?.length ? <p className="text-sm text-muted-foreground">No overrides yet.</p> : overlays.data.map((o: any) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"><div><p className="font-medium">{o.target_type === "CUSTOMER" ? "Customer" : "Specification"} · {o.season === "BOTH" ? "both seasons" : seasonLabel(o.season)} · v{o.version} · {String(o.status).toLowerCase()}</p><p className="text-sm text-muted-foreground">{o.reason}</p></div>{canEdit && o.status === "DRAFT" && <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(() => overlayApi.publishOverlay(o.id, command({ expected_version: o.row_version, note: o.reason })))}>Publish override</Button>}</div>)}</section>}
      {showHistory && <section className="rounded-xl border border-border bg-card p-4" data-testid="stage-rules-history"><h2 className="mb-3 font-semibold">{seasonLabel(season)} version history</h2>{rules.data?.versions?.map((version: any, i: number, all: any[]) => {
        const previous = all.slice(i + 1).find((v: any) => v.status !== "DRAFT")
        const changes = previous ? version.rules.filter((r: any) => JSON.stringify(r) !== JSON.stringify(previous.rules.find((v: any) => v.rule_id === r.rule_id))) : []
        return <div key={version.id} className="border-b border-border py-3 last:border-0"><p className="font-medium">Version {version.version} · {String(version.status).toLowerCase()} · {version.published_by || version.created_by}{version.published_at ? ` · ${new Date(`${version.published_at}Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p><p className="text-sm text-muted-foreground">{version.change_note}</p>{changes.length ? <ul className="mt-1 space-y-0.5 text-[12.5px]">{changes.map((r: any) => { const before = previous.rules.find((v: any) => v.rule_id === r.rule_id); return <li key={r.rule_id}>{stageLabel(r.stage)} {r.label}: {before ? ruleText(before) : "new"} → <b>{ruleText(r)}</b></li> })}</ul> : previous ? <p className="mt-1 text-[12.5px] text-muted-foreground">No rule changes</p> : null}</div>
      })}</section>}
    </>}
  </div>
}
