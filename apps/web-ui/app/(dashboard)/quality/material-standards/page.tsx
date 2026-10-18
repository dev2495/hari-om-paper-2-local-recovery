"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, Check, History, Pencil, Plus, Power, Ruler, X } from "lucide-react"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { MaterialTypeTabs } from "@/components/qc/MaterialTypeTabs"
import { Field, fieldClass } from "@/components/procurement/procurement-shell"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateQualityStandardParameter,
  useQualityStandardHistory,
  useQualityStandardParameters,
  useUpdateQualityStandardParameter,
} from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

const KINDS = [
  { value: "number", label: "Measured value", hint: "A number checked against the band Masters set" },
  { value: "select", label: "Pass / fail", hint: "Pick one outcome, e.g. OK / NOT OK" },
  { value: "text", label: "Note", hint: "Written observation; never holds a lot" },
]
const kindLabel = (value: string) => KINDS.find((kind) => kind.value === value)?.label || "Measured value"
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return detail?.message || error?.message || "Could not save"
}
const blankDraft = { label: "", unit: "", input_type: "number", options: "OK, NOT OK", required: true }

export default function MaterialStandardsPage() {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canEdit = ["QC", "InwardQC", "Owner", "Admin"].some((role) => roles.has(role))
  const canSetBands = ["Owner", "Admin"].some((role) => roles.has(role))
  const [materialType, setMaterialType] = useState("RAW_PAPER")
  const parameters = useQualityStandardParameters(materialType)
  const history = useQualityStandardHistory(materialType)
  const create = useCreateQualityStandardParameter()
  const update = useUpdateQualityStandardParameter()
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<any>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<any>(blankDraft)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { setEditing(null); setAdding(false); setError(""); setNotice("") }, [materialType])

  const rows: any[] = useMemo(() => parameters.data || [], [parameters.data])
  const active = rows.filter((row) => row.active)
  const inactive = rows.filter((row) => !row.active)

  const done = (message: string, result?: any) => {
    setError("")
    const count = Number(result?.data?.items_updated || 0)
    setNotice(`${message}${count ? ` · ${count} material${count === 1 ? "" : "s"} now use it on the next inward` : ""}`)
  }

  const startEdit = (row: any) => {
    setEditing(row.id)
    setEdit({ label: row.label, unit: row.unit || "", input_type: row.input_type || "number", options: (row.options || []).map((option: string) => option.replace(/_/g, " ")).join(", "), required: row.required })
    setError("")
  }
  const saveEdit = async (row: any) => {
    try {
      const result = await update.mutateAsync({ id: row.id, data: {
        label: edit.label, unit: edit.unit, input_type: edit.input_type, required: edit.required,
        options: edit.input_type === "select" ? String(edit.options).split(",").map((v: string) => v.trim()).filter(Boolean) : [],
      } })
      setEditing(null)
      done(`${edit.label} saved`, result)
    } catch (err) { setError(errorText(err)) }
  }
  const toggle = async (row: any) => {
    try {
      const result = await update.mutateAsync({ id: row.id, data: { active: !row.active } })
      done(row.active ? `${row.label} switched off` : `${row.label} switched on`, result)
    } catch (err) { setError(errorText(err)) }
  }
  const add = async () => {
    try {
      const result = await create.mutateAsync({
        material_type: materialType, label: draft.label.trim(), unit: draft.unit.trim(), input_type: draft.input_type, required: draft.required,
        options: draft.input_type === "select" ? String(draft.options).split(",").map((v: string) => v.trim()).filter(Boolean) : [],
      })
      setDraft(blankDraft); setAdding(false)
      done(`${draft.label.trim()} added${draft.input_type === "number" ? " — set its band in Masters" : ""}`, result)
    } catch (err) { setError(errorText(err)) }
  }

  const row = (item: any) => {
    const isEditing = editing === item.id
    return (
      <li key={item.id} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !item.active && "bg-muted/40")} data-testid={`qc-parameter-${item.parameter_key}`}>
        {isEditing ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
            <Field label="Check"><input className={fieldClass} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Unit" hint="optional"><input className={fieldClass} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="mm, %, kg…" /></Field>
            <Field label="Recorded as"><select className={fieldClass} value={edit.input_type} onChange={(e) => setEdit({ ...edit, input_type: e.target.value })}>{KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></Field>
            <label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.required} onChange={(e) => setEdit({ ...edit, required: e.target.checked })} /> Required</label>
            {edit.input_type === "select" ? <div className="sm:col-span-4"><Field label="Outcomes" hint="comma separated; FAIL, NOT OK, NO or REJECT hold the lot"><input className={fieldClass} value={edit.options} onChange={(e) => setEdit({ ...edit, options: e.target.value })} /></Field></div> : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", item.active ? "bg-signal-cyan-soft text-signal-cyan-ink" : "bg-muted text-muted-foreground")}><Ruler className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className={cn("font-semibold", !item.active && "text-muted-foreground")}>{item.label}{item.unit ? <span className="ml-1.5 font-normal text-muted-foreground">({item.unit})</span> : null}</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {kindLabel(item.input_type)}
                {item.input_type === "select" && item.options?.length ? ` · ${item.options.map((option: string) => option.replace(/_/g, " ")).join(" / ")}` : ""}
                {" · "}{item.required ? "required" : "optional"}
                {!item.active ? " · switched off" : item.measured ? " · band set in Masters" : ""}
              </p>
            </div>
          </div>
        )}
        {canEdit ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {isEditing ? (
              <>
                <button type="button" className="erp-btn-primary !h-9" disabled={update.isPending || !edit.label.trim()} onClick={() => saveEdit(item)}><Check className="h-4 w-4" />Save</button>
                <button type="button" className="erp-btn-secondary !h-9" onClick={() => setEditing(null)}><X className="h-4 w-4" />Cancel</button>
              </>
            ) : (
              <>
                <button type="button" className="erp-btn-secondary !h-9" onClick={() => startEdit(item)} aria-label={`Edit ${item.label}`}><Pencil className="h-4 w-4" />Edit</button>
                <button type="button" className={cn("!h-9", item.active ? "erp-btn-secondary" : "erp-btn-primary")} disabled={update.isPending} onClick={() => toggle(item)} aria-label={`${item.active ? "Switch off" : "Switch on"} ${item.label}`}><Power className="h-4 w-4" />{item.active ? "Switch off" : "Switch on"}</button>
              </>
            )}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <RoleGate allow={["QC", "InwardQC", "PlantManager", "Store"]}>
      <div className="space-y-5" data-testid="material-standards-page">
        <PageHeader title="Material standards" description="The checks QC does on each incoming material. QC decides which checks exist; the tolerance band for every measured check is set per material line or group in Masters." />
        <QualityDeskNav />
        <ol className="grid gap-3 md:grid-cols-3" aria-label="How inward QC works">
          {[
            ["1", "QC lists the checks", "Here, per material type. Add, rename or switch a check off."],
            ["2", "Masters set the bands", "Per material line or group (e.g. a paper variety or a parchment company and colour)."],
            ["3", "GRN lot is inspected", "All readings inside the band → released. Any reading outside → flagged and held."],
          ].map(([step, title, detail]) => (
            <li key={step} className="flex gap-3 rounded-xl border border-border bg-card p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">{step}</span>
              <div><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{detail}</p></div>
            </li>
          ))}
        </ol>
        <MaterialTypeTabs value={materialType} onChange={setMaterialType} />
        {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">{error}</p> : null}
        {notice ? <p role="status" className="rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-sm text-signal-emerald-ink">{notice}</p> : null}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-semibold">Checks in use · {active.length}</h2>
              <p className="text-[12.5px] text-muted-foreground">Every GRN lot of this material is inspected on these checks.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canSetBands ? <Link href={`/masters/inward-qc?type=${materialType}`} className="erp-btn-secondary !h-9">Set tolerance bands<ArrowUpRight className="h-4 w-4" /></Link> : null}
              {canEdit && !adding ? <button type="button" className="erp-btn-primary !h-9" onClick={() => { setAdding(true); setError("") }}><Plus className="h-4 w-4" />Add a check</button> : null}
            </div>
          </header>
          {parameters.isLoading ? <LoadingState label="Loading checks…" /> : parameters.isError ? <ErrorState message="Checks could not be loaded." onRetry={() => parameters.refetch()} /> : (
            <ul className="divide-y divide-border">
              {active.map(row)}
              {!active.length ? <li className="px-4 py-6 text-sm text-muted-foreground">No checks switched on. Lots of this material are released on receipt without inspection readings.</li> : null}
            </ul>
          )}
          {adding ? (
            <div className="space-y-3 border-t border-border bg-signal-cyan-soft/40 p-4" data-testid="add-qc-parameter">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
                <Field label="New check"><input autoFocus className={fieldClass} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Cobb, Burst factor" /></Field>
                <Field label="Unit" hint="optional"><input className={fieldClass} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="mm, %, kg…" /></Field>
                <Field label="Recorded as"><select className={fieldClass} value={draft.input_type} onChange={(e) => setDraft({ ...draft, input_type: e.target.value })}>{KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></Field>
                <label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> Required</label>
              </div>
              {draft.input_type === "select" ? <Field label="Outcomes" hint="comma separated; FAIL, NOT OK, NO or REJECT hold the lot"><input className={fieldClass} value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} /></Field> : null}
              <p className="text-[12.5px] text-muted-foreground">{KINDS.find((kind) => kind.value === draft.input_type)?.hint}.</p>
              <div className="flex gap-2">
                <button type="button" className="erp-btn-primary" disabled={!draft.label.trim() || create.isPending} onClick={add}><Plus className="h-4 w-4" />Add check</button>
                <button type="button" className="erp-btn-secondary" onClick={() => { setAdding(false); setDraft(blankDraft) }}>Cancel</button>
              </div>
            </div>
          ) : null}
        </section>
        {inactive.length ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-3"><h2 className="font-semibold">Switched off · {inactive.length}</h2><p className="text-[12.5px] text-muted-foreground">Not asked at inward. Switch one on to add it back to every new inspection.</p></header>
            <ul className="divide-y divide-border">{inactive.map(row)}</ul>
          </section>
        ) : null}
        <section className="rounded-xl border border-border bg-card">
          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            <span className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-muted-foreground" />Change history</span>
            <span className="text-[12.5px] text-muted-foreground">{showHistory ? "Hide" : "Show"}</span>
          </button>
          {showHistory ? (
            <ol className="divide-y divide-border border-t border-border">
              {(history.data || []).slice(0, 60).map((event: any) => (
                <li key={event.id} className="px-4 py-2.5 text-[13px]">
                  <span className="font-medium">{event.kind.replace(/_/g, " ").toLowerCase().replace(/^./, (c: string) => c.toUpperCase())}</span>
                  {" · "}{event.after?.label || event.before?.label || event.parameter_key || ""}
                  {event.scope && event.scope !== "TYPE" ? ` · ${event.scope.toLowerCase()}` : ""}
                  <span className="text-muted-foreground"> · {event.actor || "system"} · {event.at ? new Date(`${event.at}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  {event.note ? <p className="text-[12px] text-muted-foreground">{event.note}</p> : null}
                </li>
              ))}
              {!history.data?.length ? <li className="px-4 py-3 text-[13px] text-muted-foreground">No changes recorded yet.</li> : null}
            </ol>
          ) : null}
        </section>
      </div>
    </RoleGate>
  )
}
