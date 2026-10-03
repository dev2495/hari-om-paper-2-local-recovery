"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { History, CloudRain, Sun, Copy, Save, ShieldCheck } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { command, errorText, seasonApi, seasonApiForPlant, seasonLabel, type Season } from "@/lib/season-api"
import { specApi } from "@/lib/api"
import { useCustomers } from "@/hooks/use-master-data"

const references: Record<string, string> = { CUSTOMER_ID: "Customer minimum I.D.", CUSTOMER_OD: "Customer O.D.", CUSTOMER_LENGTH: "Customer length", CUSTOMER_WEIGHT: "Customer weight", CUSTOMER_CS: "Customer C.S.", MANDREL_DIAMETER: "Mandrel diameter", WINDING_LENGTH: "Bamboo length", MOISTURE_MIN: "Customer moisture minimum", MOISTURE_MAX: "Customer moisture maximum", CONST: "Fixed value", "SAMPLE.pre_weight": "Same sample pre-weight" }
const stages = ["WINDER", "OVEN", "PROCESS"]
const stageLabel = (value: string) => value === "WINDER" ? "Winding" : value === "OVEN" ? "Oven" : "Process"
const control = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export default function StageRulesPage() {
  const { user, activePlant } = useAuth()
  const hasConcretePlant = Boolean(activePlant && activePlant.toUpperCase() !== "ALL")
  const overlayApi = seasonApiForPlant(activePlant || "")
  const roles = new Set([user?.role, ...(user?.roles || [])])
  const canEdit = ["QC", "Owner", "Admin"].some(r => roles.has(r))
  const cache = useQueryClient()
  const [season, setSeason] = useState<Season>("ROY")
  const [rows, setRows] = useState<any[]>([])
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [impact, setImpact] = useState<any>(null)
  const [tab, setTab] = useState<"rules" | "overlays">("rules")
  const [targetType, setTargetType] = useState("CUSTOMER")
  const [targetId, setTargetId] = useState("")
  const [overlaySeason, setOverlaySeason] = useState("BOTH")
  const [overlayCodes, setOverlayCodes] = useState<string[]>([])
  const rules = useQuery({ queryKey: ["season-rules", season], queryFn: async () => (await seasonApi.rules(season)).data })
  const overlays = useQuery({ queryKey: ["season-overlays", activePlant], queryFn: async () => (await overlayApi.overlays()).data, enabled: tab === "overlays" && hasConcretePlant })
  const customers = useCustomers()
  const specs = useQuery({ queryKey: ["overlay-spec-options", activePlant], queryFn: async () => (await specApi.getSpecs()).data, enabled: tab === "overlays" && targetType === "SPEC" && hasConcretePlant })
  const source = rules.data?.draft || rules.data?.published
  const sourceRules = JSON.stringify(source?.rules || [])
  const scopedOverrides = (overlays.data || []).filter((o: any) => o.target_type === targetType && o.target_id === targetId && o.season === overlaySeason)
  const existingOverride = scopedOverrides.find((o: any) => o.status === "DRAFT") || scopedOverrides.find((o: any) => o.status === "PUBLISHED")
  const overlayReadError = tab === "overlays" && hasConcretePlant ? overlays.error || customers.error || (targetType === "SPEC" ? specs.error : null) : null
  const overrideSignature = JSON.stringify(existingOverride || null)
  useEffect(() => {
    const base = JSON.parse(sourceRules)
    const override = tab === "overlays" ? JSON.parse(overrideSignature) : null
    setRows(base.map((r: any) => override?.rules.find((o: any) => o.rule_id === r.rule_id) || r))
    setOverlayCodes(override?.rules.map((o: any) => o.rule_id) || [])
    setNote(override?.reason || ""); setImpact(null); setError("")
  }, [sourceRules, overrideSignature, season, tab, targetType, targetId, overlaySeason])
  const dirty = JSON.stringify(rows) !== JSON.stringify(source?.rules || [])
  const mutation = useMutation({
    mutationFn: async (run: () => Promise<any>) => run(),
    onSuccess: () => { setError(""); cache.invalidateQueries({ queryKey: ["season-rules"] }); cache.invalidateQueries({ queryKey: ["season-overlays"] }); cache.invalidateQueries({queryKey:["season-spec-qc"]}); cache.invalidateQueries({queryKey:["spec-summary"]}); cache.invalidateQueries({queryKey:["purchase-v2","sales-bom-demand"]}) },
    onError: e => setError(errorText(e)),
  })
  const change = (index: number, patch: any) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row))
  const termChange = (index: number, side: string, termIndex: number, patch: any) => change(index, { [side]: rows[index][side].map((term: any, i: number) => i === termIndex ? { ...term, ...patch } : term) })
  return <div className="space-y-5 p-4 sm:p-6">
    <QualityDeskNav />
    <PageHeader title="Stage QC rules" description="One seasonal standard for both plants. Released cards keep their frozen tolerances." />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-xl border border-border bg-muted p-1" role="tablist" aria-label="QC season">
        {(["ROY", "MONSOON"] as Season[]).map(s => <Button key={s} variant={s === season ? "default" : "ghost"} onClick={() => { if (!dirty || window.confirm("Discard unsaved rule changes?")) setSeason(s) }} role="tab" aria-selected={s === season}>{s === "MONSOON" ? <CloudRain className="mr-2 h-4 w-4" /> : <Sun className="mr-2 h-4 w-4" />}{seasonLabel(s)}</Button>)}
      </div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setShowHistory(!showHistory)}><History className="mr-2 h-4 w-4" />History</Button><Button variant="outline" onClick={() => setTab(tab === "rules" ? "overlays" : "rules")}>{tab === "rules" ? "Customer / spec overrides" : "Global rules"}</Button></div>
    </div>
    {error && <div role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm">{error}</div>}
    {overlayReadError && <div role="alert" className="space-y-2 rounded-xl border border-destructive bg-destructive/10 p-4 text-sm"><p>Could not load override options or history: {errorText(overlayReadError)}</p><Button variant="outline" onClick={() => { overlays.refetch(); customers.refetch(); if (targetType === "SPEC") specs.refetch() }}>Retry override details</Button></div>}
    {tab === "overlays" && !hasConcretePlant && <section className="space-y-2 rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Choose a plant for customer or specification overrides</h2><p className="text-sm text-muted-foreground">Select one plant in the plant selector at the top to load its customers, specifications and override history. Global seasonal rules remain available for both plants.</p></section>}
    {rules.isLoading && <p role="status">Loading seasonal rules…</p>}
    {rules.isError && <Button onClick={() => rules.refetch()}>Retry loading rules</Button>}
    {!source && !rules.isLoading && !rules.isError && tab === "rules" && <section className="rounded-xl border border-dashed border-border bg-card p-8"><h2 className="text-xl font-semibold">Set up the seasonal standards</h2><p className="my-3 text-muted-foreground">Rest of year and Monsoon begin with the same client rules. Review each before publishing.</p>{canEdit && <Button disabled={mutation.isPending} onClick={() => mutation.mutate(() => seasonApi.bootstrap(command()))}>Create rule templates</Button>}</section>}
    {source && (tab === "rules" || hasConcretePlant) && <>
      <div className="flex flex-wrap items-center gap-3 text-sm"><span className="rounded-full bg-muted px-3 py-1 font-semibold">{rules.data?.published ? `Published v${rules.data.published.version}` : "Not yet published"}</span>{rules.data?.draft && <span className="text-amber-700">Draft v{rules.data.draft.version}</span>}{dirty && <span>Unsaved changes</span>}<span className="text-muted-foreground">At least 2 samples per required parameter before stage close</span></div>
      {tab === "overlays" && <section className="space-y-3 rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Override selected rules</h2><p className="text-sm text-muted-foreground">Select rows below, edit their bounds, and save an override with its reason. Potentially wider rules require Owner/Admin publication.</p><div className="flex flex-wrap gap-2"><select className={control} aria-label="Override target type" value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId("") }}><option value="CUSTOMER">Customer</option><option value="SPEC">Specification</option></select><select className={control} aria-label="Override target" value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Select {targetType.toLowerCase()}</option>{(targetType === "CUSTOMER" ? customers.data || [] : specs.data || []).map((v: any) => <option key={v.id} value={targetType === "CUSTOMER" ? v.id : v.lineage_id || v.id}>{v.name || v.customer_name} {v.spec_reference || ""}</option>)}</select><select className={control} aria-label="Override season" value={overlaySeason} onChange={e => { setOverlaySeason(e.target.value); if (e.target.value !== "BOTH") setSeason(e.target.value as Season) }}><option value="BOTH">Both seasons</option><option value="ROY">Rest of year</option><option value="MONSOON">Monsoon</option></select></div></section>}
      {stages.map(stage => <section key={stage} className="overflow-hidden rounded-xl border border-border bg-card"><header className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3"><h2 className="text-lg font-semibold">{stageLabel(stage)}</h2><span className="text-xs text-muted-foreground">Required observations and tolerances</span></header><div className="divide-y divide-border">{rows.map((row, index) => row.stage === stage && <div key={row.rule_id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3">{tab === "overlays" && <input type="checkbox" aria-label={`Override ${row.label}`} checked={overlayCodes.includes(row.rule_id)} onChange={e => setOverlayCodes(c => e.target.checked ? [...c, row.rule_id] : c.filter(v => v !== row.rule_id))} />}<h3 className="font-semibold">{row.label} <span className="font-normal text-muted-foreground">{row.unit}</span></h3></div><div className="flex gap-2"><select disabled={!canEdit} className={control} aria-label={`${row.label} rule mode`} value={row.mode} onChange={e => change(index, { mode: e.target.value, lower: e.target.value === "RECORD_ONLY" ? [] : [{ ref: "CONST", factor: 1, offset: 0 }], upper: [] })}><option value="BAND">Tolerance band</option><option value="RECORD_ONLY">Record only</option></select><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!canEdit} checked={!!row.requires_instrument} onChange={e=>change(index,{requires_instrument:e.target.checked})}/> Calibrated instrument</label><Input aria-label={`${row.label} minimum readings`} className="w-20" type="number" min={2} max={10} value={row.min_readings} disabled={!canEdit} onChange={e => change(index, { min_readings: Number(e.target.value) })} /></div></div>{row.mode === "RECORD_ONLY" ? <p className="mt-2 text-sm text-muted-foreground">Record a valid reading. No numeric tolerance is imposed.</p> : <div className="mt-3 grid gap-4 lg:grid-cols-2">{["lower", "upper"].map(side => <div key={side} className="space-y-2"><p className="text-xs font-semibold uppercase text-muted-foreground">{side === "lower" ? "Minimum — greatest term" : "Maximum — smallest term"}</p>{row[side].map((term: any, ti: number) => <div key={ti} className="flex flex-wrap items-center gap-2"><select disabled={!canEdit} className={`${control} min-w-40 flex-1`} aria-label={`${row.label} ${side} reference`} value={term.ref} onChange={e => termChange(index, side, ti, { ref: e.target.value })}>{Object.entries(references).filter(([ref]) => !ref.startsWith("SAMPLE") || stage === "OVEN" && row.parameter === "post_weight").map(([ref, label]) => <option key={ref} value={ref}>{label}</option>)}</select><span>×</span><Input type="number" step="any" className="w-20" aria-label={`${row.label} ${side} factor`} value={term.factor} disabled={!canEdit} onChange={e => termChange(index, side, ti, { factor: Number(e.target.value) })} /><span>+</span><Input type="number" step="any" className="w-24" aria-label={`${row.label} ${side} offset`} value={term.offset} disabled={!canEdit} onChange={e => termChange(index, side, ti, { offset: Number(e.target.value) })} />{canEdit && <Button variant="ghost" aria-label="Remove bound term" onClick={() => change(index, { [side]: row[side].filter((_: any, i: number) => i !== ti) })}>×</Button>}</div>)}{canEdit && <Button size="sm" variant="ghost" onClick={() => change(index, { [side]: [...row[side], { ref: "CONST", factor: 1, offset: 0 }] })}>+ Add {side === "lower" ? "minimum" : "maximum"} term</Button>}</div>)}</div>}</div>)}</div></section>)}
      {canEdit && <section className="sticky bottom-2 space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"><Input aria-label="Change reason" placeholder="Change / customer requirement reason" value={note} onChange={e => setNote(e.target.value)} /><div className="flex flex-wrap gap-2">{tab === "overlays" ? <Button disabled={!targetId || !note.trim() || !overlayCodes.length || mutation.isPending} onClick={() => mutation.mutate(() => overlayApi.saveOverlay(command({ target_type: targetType, target_id: targetId, season: overlaySeason, expected_version: existingOverride?.status === "DRAFT" ? existingOverride.row_version : undefined, note, rules: rows.filter(r => overlayCodes.includes(r.rule_id)) })))}>Save override draft</Button> : <><Button disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate(() => seasonApi.saveRules(season, command({ expected_version: rules.data?.draft?.row_version, rules: rows, note })))}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button variant="outline" disabled={!rules.data?.draft || dirty || mutation.isPending} onClick={() => mutation.mutate(async () => { const r = await seasonApi.impact(season); setImpact(r.data); return r })}>Preview impact</Button><Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(async () => { const r = await seasonApi.rules("ROY"); setRows(structuredClone((r.data.published || r.data.draft).rules)); return r })}><Copy className="mr-2 h-4 w-4" />Copy rest of year</Button><Button disabled={!rules.data?.draft || dirty || !note.trim() || mutation.isPending} onClick={() => mutation.mutate(() => seasonApi.publishRules(season, command({ expected_version: rules.data.draft.row_version, note })))}><ShieldCheck className="mr-2 h-4 w-4" />Publish {seasonLabel(season)}</Button></>}</div>{impact && <p className="text-sm">{impact.specs_checked} specs checked · {impact.blocked_count} become blocked. {(impact.blocked || []).map((v: any) => v.customer).join(", ")}</p>}</section>}
      {tab === "overlays" && <section className="space-y-2"><h2 className="font-semibold">Override history</h2>{overlays.isLoading ? <p>Loading overrides…</p> : overlays.isError ? <p className="text-sm text-destructive">Override history is unavailable. Retry override details above.</p> : !overlays.data?.length ? <p className="text-sm text-muted-foreground">No overrides yet.</p> : overlays.data.map((o: any) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"><div><p className="font-medium">{o.target_type} · {o.season} v{o.version} · {o.status}</p><p className="text-sm text-muted-foreground">{o.reason}</p></div>{canEdit && o.status === "DRAFT" && <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(() => overlayApi.publishOverlay(o.id, command({ expected_version: o.row_version, note: o.reason })))}>Publish override</Button>}</div>)}</section>}
      {showHistory && <section className="rounded-xl border border-border bg-card p-4"><h2 className="mb-3 font-semibold">{seasonLabel(season)} version history</h2>{rules.data?.versions?.map((version: any, i: number, all: any[]) => <div key={version.id} className="border-b border-border py-3"><p className="font-medium">v{version.version} · {version.status} · {version.published_by || version.created_by}</p><p className="text-sm text-muted-foreground">{version.change_note}</p>{all[i + 1] && <p className="mt-1 text-xs">Changed: {version.rules.filter((r: any) => JSON.stringify(r) !== JSON.stringify(all[i + 1].rules.find((v: any) => v.rule_id === r.rule_id))).map((r: any) => `${stageLabel(r.stage)} ${r.label}`).join(", ") || "No rule changes"}</p>}</div>)}</section>}
    </>}
  </div>
}
