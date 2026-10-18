"use client"

import { useEffect, useMemo, useState } from "react"
import { History, Ruler, Save } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, fieldClass } from "@/components/procurement/procurement-shell"
import { useQualityStandardScope, useSaveQualityStandardTolerances } from "@/hooks/use-inventory"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"
import { BAND_MODES, bandLineFrom, bandPayload, blankBand, describeBand, previewBand, showNumber, type BandLine } from "@/lib/qc-bands"

type Line = BandLine
type Scope = "ITEM" | "GROUP" | "SUBGROUP" | "TYPE"

const FROM: Record<string, string> = { SUBGROUP: "colour", GROUP: "group", TYPE: "all-material default" }
const blank: Line = blankBand
const show = showNumber
const num = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(Number(value)))
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return detail?.message || error?.message || "Could not save"
}
const describe = (band: any, nominal?: number | null) => describeBand(band, nominal)

export type QcBandTarget = {
  materialType: string
  scope: Scope
  scopeKey: string
  title: string
  subtitle?: string
  /** Line saves only: the master row's group (e.g. paper variety) and its nominal values per QC check. */
  group?: string | null
  nominals?: Record<string, number | null | undefined>
}

/** Inward QC band for one master row (a material line, a group, or a parchment company / colour). */
export function QcBandDialog({ target, onClose }: { target: QcBandTarget | null; onClose: () => void }) {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canEdit = ["Owner", "Admin"].some((role) => roles.has(role))
  const open = Boolean(target)
  const [groupName, subgroupName] = target?.scope === "SUBGROUP" ? target.scopeKey.split("||") : [target?.group || "", ""]
  const query = useQualityStandardScope(
    { material_type: target?.materialType || "", scope: target?.scope || "", scope_key: target?.scopeKey || "", group: groupName || "", subgroup: subgroupName || "" },
    open,
  )
  const save = useSaveQualityStandardTolerances()
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [nominalEdits, setNominalEdits] = useState<Record<string, string>>({})
  const data = query.data
  const parameters: any[] = useMemo(() => data?.parameters || [], [data])
  // The master row's own value (GSM, thickness, BF…) is the nominal; checks the master has no field for
  // (width, moisture…) take a nominal typed here, kept on the material line.
  const fromMaster = (code: string) => {
    const value = target?.nominals?.[code]
    return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
  }
  const masterNominal = (code: string) => {
    const master = fromMaster(code)
    if (master !== null) return master
    const typed = nominalEdits[code]
    if (typed !== undefined) return typed.trim() !== "" && Number.isFinite(Number(typed)) ? Number(typed) : null
    const saved = data?.nominals?.[code]
    return saved !== null && saved !== undefined && Number.isFinite(Number(saved)) ? Number(saved) : null
  }

  const signature = JSON.stringify([target?.scope, target?.scopeKey, data?.bands, data?.version])
  useEffect(() => {
    if (!data) return
    const next: Record<string, Line> = {}
    for (const parameter of parameters) {
      const band = data.bands?.[parameter.parameter_key]
      next[parameter.parameter_key] = band ? bandLineFrom(band) : { ...blank }
    }
    setLines(next); setNominalEdits({}); setNote(""); setError(""); setNotice("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const setLine = (code: string, patch: Partial<Line>) => setLines((current) => ({ ...current, [code]: { ...(current[code] || blank), ...patch } }))
  const preview = (code: string) => previewBand(lines[code] || blank, masterNominal(code), target?.scope === "ITEM")

  const submit = async () => {
    if (!target) return
    setError(""); setNotice("")
    try {
      const nominals = target.scope === "ITEM"
        ? Object.fromEntries(parameters.map((p) => [p.parameter_key, masterNominal(p.parameter_key)]).filter(([code, value]) => value !== null || nominalEdits[code as string] !== undefined))
        : undefined
      const result = await save.mutateAsync({
        material_type: target.materialType, scope: target.scope, scope_key: target.scopeKey, note,
        ...(target.scope === "ITEM" ? { nominals: nominals as Record<string, number>, material_group: target.group || null } : {}),
        lines: parameters.map((p) => bandPayload(p.parameter_key, lines[p.parameter_key] || blank)),
      })
      const changed = result.data?.changed?.length || 0
      setNotice(changed ? `Saved as version ${result.data?.version}. Lots received from now on are checked against it.` : "Nothing changed.")
    } catch (err) { setError(errorText(err)) }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-none overflow-y-auto sm:max-w-4xl" data-testid="qc-band-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ruler className="h-4 w-4 text-primary" aria-hidden="true" />Inward QC band · {target?.title}</DialogTitle>
          <DialogDescription>
            {target?.subtitle ? `${target.subtitle} · ` : ""}
            {data?.version ? `Version ${data.version}${data.history?.[0] ? ` · saved by ${data.history[0].actor || "—"} on ${data.history[0].at ? new Date(`${data.history[0].at}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}` : ""}` : "No band saved here yet — it uses the band above it."}
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? <p className="py-6 text-sm text-muted-foreground">Loading QC band…</p> : query.isError ? <p role="alert" className="text-sm text-signal-rose-ink">{errorText(query.error)}</p> : !parameters.length ? (
          <p className="rounded-lg border border-signal-cyan-line bg-signal-cyan-soft px-3 py-2 text-sm text-signal-cyan-ink">QC has no measured checks switched on for this material. Add them in Quality › Material standards.</p>
        ) : (
          <div className="space-y-4">
            {target?.scope === "ITEM" && data?.stock_lines?.length === 0 ? <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink">No stock material uses code {target.scopeKey} yet. The band is kept and applies as soon as a material with this code is received.</p> : null}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="tube-grid w-full min-w-[680px]">
                <thead><tr><th>Check</th>{target?.scope === "ITEM" ? <th>Nominal (master)</th> : null}<th>Band type</th><th>Band</th><th>Lot is checked against</th></tr></thead>
                <tbody>
                  {parameters.map((parameter) => {
                    const code = parameter.parameter_key
                    const line = lines[code] || blank
                    const inherited = data?.inherited?.[code]
                    const nominal = target?.scope === "ITEM" ? masterNominal(code) : null
                    return (
                      <tr key={code}>
                        <td><p className="font-medium">{parameter.label}</p><p className="text-[11.5px] text-muted-foreground">{parameter.unit || "no unit"}</p></td>
                        {target?.scope === "ITEM" ? (
                          <td className="tabular-nums">
                            {fromMaster(code) !== null || !canEdit ? show(nominal) : (
                              <input className={cn(fieldClass, "w-24")} type="number" step="any" placeholder="nominal" aria-label={`${parameter.label} nominal`}
                                value={nominalEdits[code] ?? num(data?.nominals?.[code])} onChange={(e) => setNominalEdits((current) => ({ ...current, [code]: e.target.value }))} />
                            )}
                          </td>
                        ) : null}
                        <td><select disabled={!canEdit} className={cn(fieldClass, "w-[9.5rem]")} aria-label={`${parameter.label} band type`} value={line.mode} onChange={(e) => setLine(code, { mode: e.target.value as Line["mode"] })}>{BAND_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></td>
                        <td>
                          {line.mode === "RANGE" ? (
                            <div className="flex items-center gap-1.5">
                              <input disabled={!canEdit} className={cn(fieldClass, "w-24")} type="number" step="any" placeholder="min" aria-label={`${parameter.label} minimum`} value={line.min} onChange={(e) => setLine(code, { min: e.target.value })} />
                              <span className="text-muted-foreground">to</span>
                              <input disabled={!canEdit} className={cn(fieldClass, "w-24")} type="number" step="any" placeholder="max" aria-label={`${parameter.label} maximum`} value={line.max} onChange={(e) => setLine(code, { max: e.target.value })} />
                            </div>
                          ) : line.mode === "NONE" ? (
                            <span className="text-[12.5px] text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5"><span className="text-muted-foreground">{line.mode === "AT_LEAST" ? "less" : line.mode === "AT_MOST" ? "plus" : "±"}</span><input disabled={!canEdit} className={cn(fieldClass, "w-24")} type="number" step="any" min="0" placeholder={line.mode === "AT_LEAST" || line.mode === "AT_MOST" ? "0" : ""} aria-label={`${parameter.label} ${line.mode === "AT_LEAST" || line.mode === "AT_MOST" ? "allowance" : "tolerance"}`} value={line.spread} onChange={(e) => setLine(code, { spread: e.target.value })} /><span className="text-muted-foreground">{line.mode === "PERCENT" ? "%" : parameter.unit}</span></div>
                          )}
                        </td>
                        <td className="text-[12.5px]">
                          {preview(code) ? <span className="font-medium">{preview(code)}</span> : inherited ? <span>{describe(inherited, nominal)} <span className="text-muted-foreground">· from {FROM[inherited.from] || "default"}{inherited.from !== "TYPE" ? ` ${String(inherited.from_key).replace("||", " › ")}` : ""}</span></span> : <span className="text-muted-foreground">Recorded only — no band</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">{error}</p> : null}
            {notice ? <p role="status" className="rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-sm text-signal-emerald-ink">{notice}</p> : null}
            {canEdit ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1"><Field label="Reason for the change" hint="kept with this version"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. thickness ± 0.05 agreed with supplier" /></Field></div>
                <button type="button" className="erp-btn-primary" disabled={save.isPending} onClick={submit}><Save className="h-4 w-4" />Save as new version</button>
              </div>
            ) : <p className="text-[12.5px] text-muted-foreground">Only Owner or Admin can change QC bands.</p>}
            <section className="rounded-xl border border-border">
              <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
                <span className="flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" />Versions and audit · {data?.history?.length || 0}</span>
                <span className="text-[12.5px] font-normal text-muted-foreground">{showHistory ? "Hide" : "Show"}</span>
              </button>
              {showHistory ? (
                <ol className="divide-y divide-border border-t border-border">
                  {(data?.history || []).map((version: any) => (
                    <li key={version.version} className="px-3 py-2.5 text-[12.5px]">
                      <p><span className="font-semibold">Version {version.version}</span> · {version.actor || "system"} · {version.at ? new Date(`${version.at}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}{version.note ? ` · “${version.note}”` : ""}</p>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {version.changes.map((change: any, index: number) => {
                          const label = parameters.find((p) => p.parameter_key === change.parameter_key)?.label || change.parameter_key || "Nominal / group"
                          return <li key={index}>{label}: {change.kind === "LINE_NOMINALS" ? "nominal values updated" : `${describe(change.before)} → ${change.kind === "TOLERANCE_CLEARED" ? "cleared" : describe(change.after)}`}</li>
                        })}
                      </ul>
                    </li>
                  ))}
                  {!data?.history?.length ? <li className="px-3 py-2.5 text-[12.5px] text-muted-foreground">No versions yet.</li> : null}
                </ol>
              ) : null}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
