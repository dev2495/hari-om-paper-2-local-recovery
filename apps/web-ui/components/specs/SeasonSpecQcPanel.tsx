"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { command, errorText, seasonApiForPlant, seasonLabel, type Season } from "@/lib/season-api"

const STAGES = [
  { key: "WINDER", label: "Winding" },
  { key: "OVEN", label: "Oven" },
  { key: "PROCESS", label: "Process" },
] as const

const SOURCE_LABEL: Record<string, string> = {
  GLOBAL: "Global rule",
  CUSTOMER: "Customer override",
  SPEC_OVERRIDE: "Spec override (QC rules page)",
  SPEC_SHEET: "Set on this spec sheet",
}

const fmt = (value: any) => (value == null || value === "" ? null : String(Math.round(Number(value) * 1000) / 1000))

function rangeText(row: any) {
  if (!row) return "—"
  if (!row.applicable) return "Not applicable"
  if (row.dynamic) {
    const factor = (terms: any[]) => terms?.find((t: any) => t.ref === "SAMPLE.pre_weight")?.factor
    const low = factor(row.lower)
    const high = factor(row.upper)
    if (low != null && high != null) return `${fmt((1 - Number(high)) * 100)}–${fmt((1 - Number(low)) * 100)}% below the same sample's pre-weight`
    return "Relative to the same sample's pre-weight"
  }
  if (row.mode === "RECORD_ONLY" && row.min == null && row.max == null) return "Record reading"
  const min = fmt(row.min)
  const max = fmt(row.max)
  if (min && max) return `${min} – ${max} ${row.unit}`
  if (min) return `≥ ${min} ${row.unit}`
  if (max) return `≤ ${max} ${row.unit}`
  return "Record reading"
}

type Draft = Record<string, { min: string; max: string }>

/**
 * Stage QC for a seasonal specification: the tolerances job cards will freeze
 * (global seasonal rules, then customer override, then values set on this
 * spec sheet), plus optional spec-sheet values that win over both.
 */
export function SeasonSpecQcPanel({
  specId,
  plantId,
  canEdit,
  editable,
}: {
  specId: string
  plantId: string
  canEdit: boolean
  editable: boolean
}) {
  const client = useMemo(() => seasonApiForPlant(plantId), [plantId])
  const cache = useQueryClient()
  const overview = useQuery({
    queryKey: ["spec-qc-overview", specId],
    queryFn: async () => (await client.qcOverview(specId)).data,
    enabled: Boolean(specId && plantId),
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>({})
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")

  const specValues = useMemo(() => {
    const map: Record<string, any> = {}
    for (const row of overview.data?.values || []) map[`${row.stage}:${row.parameter}`] = row
    return map
  }, [overview.data])

  useEffect(() => {
    const next: Draft = {}
    for (const [key, row] of Object.entries(specValues)) next[key] = { min: fmt(row.min) || "", max: fmt(row.max) || "" }
    setDraft(next)
  }, [specValues])

  const rowsBySeason = (season: Season) => {
    const map: Record<string, any> = {}
    for (const row of overview.data?.seasons?.[season]?.parameters || []) map[`${row.stage}:${row.parameter}`] = row
    return map
  }
  const roy = rowsBySeason("ROY")
  const monsoon = rowsBySeason("MONSOON")

  const save = useMutation({
    mutationFn: async () => {
      const values: any[] = []
      const keys = new Set([...Object.keys(draft), ...Object.keys(specValues)])
      for (const key of Array.from(keys)) {
        const [stage, parameter] = key.split(":")
        const entry = draft[key] || { min: "", max: "" }
        const before = specValues[key]
        if (before?.formula && !entry.min && !entry.max) continue
        const min = entry.min.trim() === "" ? null : Number(entry.min)
        const max = entry.max.trim() === "" ? null : Number(entry.max)
        if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) {
          throw new Error(`${stage} ${parameter}: enter numbers only`)
        }
        values.push({ stage, parameter, min, max })
      }
      return client.saveSpecQc(specId, command({ values, note: note.trim() || "Stage QC values set on the spec sheet" }))
    },
    onSuccess: async () => {
      setError("")
      setEditing(false)
      setNote("")
      setSaved("Saved. New job cards from this specification will use these values.")
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["spec-qc-overview", specId] }),
        cache.invalidateQueries({ queryKey: ["spec-season-blockers", specId] }),
        cache.invalidateQueries({ queryKey: ["spec-summary"] }),
      ])
    },
    onError: (e: any) => setError(e?.response ? errorText(e) : e?.message || "Could not save stage QC values"),
  })

  const setValue = (key: string, side: "min" | "max", value: string) =>
    setDraft((current) => ({ ...current, [key]: { ...(current[key] || { min: "", max: "" }), [side]: value } }))

  const specValueCount = Object.keys(specValues).length

  return (
    <section id="stage-qc" className="scroll-mt-24 rounded-2xl border border-border bg-card p-4" data-testid="season-spec-qc-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1e765e]">Stage QC · in-process tolerances</p>
          <h3 className="mt-1 text-lg font-bold text-foreground">What winding, oven and process QC will check</h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Global seasonal rules apply by default. A customer override replaces a rule for that customer. Values you set on this
            spec sheet win over both. Job cards freeze these tolerances when they are released, so later changes never alter running work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/quality/stage-rules" className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground">
            Global rules &amp; customer overrides
          </Link>
          {canEdit && editable && !editing ? (
            <button type="button" data-testid="season-spec-qc-edit" onClick={() => { setEditing(true); setSaved("") }} className="rounded-lg bg-[#102832] px-3 py-2 text-xs font-bold text-white">
              {specValueCount ? "Change spec-sheet values" : "Set spec-specific values"}
            </button>
          ) : null}
        </div>
      </div>

      {overview.isLoading ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading stage QC tolerances…</p> : null}
      {overview.isError ? (
        <div role="alert" className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm">
          Stage QC tolerances could not be loaded: {errorText(overview.error)}{" "}
          <button type="button" className="font-semibold underline" onClick={() => overview.refetch()}>Retry</button>
        </div>
      ) : null}
      {saved ? <p role="status" className="mt-3 rounded-lg border border-[#b9e4d1] bg-[#e4f6ed] p-3 text-sm text-[#166b51]">{saved}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {(["ROY", "MONSOON"] as Season[]).map((season) => {
        const info = overview.data?.seasons?.[season]
        if (!info) return null
        if (info.error) return <p key={season} className="mt-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">{seasonLabel(season)}: {info.error}</p>
        const problems = [...(info.unresolved || []).map((u: any) => `${u.stage} ${u.parameter}: missing ${u.refs.join(", ")}`), ...(info.conflicts || []).map((c: any) => `${c.stage} ${c.parameter}: minimum ${fmt(c.min)} is above maximum ${fmt(c.max)}`)]
        return problems.length ? (
          <div key={season} role="alert" className="mt-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink">
            <p className="font-semibold">{seasonLabel(season)} needs attention before release</p>
            {problems.map((p) => <p key={p}>{p}</p>)}
          </div>
        ) : null
      })}

      {overview.data ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Stage · parameter</th>
                <th className="py-2 pr-3 font-semibold">Rest of year (v{overview.data.seasons?.ROY?.rule_set_version ?? "—"})</th>
                <th className="py-2 pr-3 font-semibold">Monsoon (v{overview.data.seasons?.MONSOON?.rule_set_version ?? "—"})</th>
                <th className="py-2 pr-3 font-semibold">Source</th>
                {editing ? <th className="py-2 font-semibold">Spec-sheet min / max</th> : null}
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => {
                const keys = Object.keys(roy).filter((key) => key.startsWith(`${stage.key}:`))
                return keys.map((key, index) => {
                  const row = roy[key]
                  const monsoonRow = monsoon[key]
                  const specRow = specValues[key]
                  return (
                    <tr key={key} className="border-b border-border/70 align-top">
                      <td className="py-2 pr-3">
                        {index === 0 ? <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">{stage.label}</span> : null}
                        <span className="font-medium">{row.label}</span>
                        <span className="ml-1 text-xs text-muted-foreground">· {row.applicable ? `${row.min_readings} samples` : "only when notched"}</span>
                      </td>
                      <td className="py-2 pr-3">{rangeText(row)}</td>
                      <td className="py-2 pr-3">{rangeText(monsoonRow)}</td>
                      <td className="py-2 pr-3 text-xs">
                        <span className={row.source === "SPEC_SHEET" ? "font-semibold text-[#166b51]" : row.source === "GLOBAL" ? "text-muted-foreground" : "font-semibold text-signal-amber-ink"}>
                          {SOURCE_LABEL[row.source] || row.source}
                        </span>
                        {specRow?.formula ? <span className="block text-muted-foreground">Formula override — edit on the QC rules page</span> : null}
                      </td>
                      {editing ? (
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              aria-label={`${stage.label} ${row.label} minimum`}
                              inputMode="decimal"
                              className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm"
                              placeholder="min"
                              value={draft[key]?.min ?? ""}
                              onChange={(e) => setValue(key, "min", e.target.value)}
                            />
                            <span className="text-muted-foreground">–</span>
                            <input
                              aria-label={`${stage.label} ${row.label} maximum`}
                              inputMode="decimal"
                              className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm"
                              placeholder="max"
                              value={draft[key]?.max ?? ""}
                              onChange={(e) => setValue(key, "max", e.target.value)}
                            />
                            <span className="text-xs text-muted-foreground">{row.unit}</span>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Leave a row empty to follow the global rule (or the customer override). Process limits are always kept inside this
            spec&apos;s final limits. Values apply to every version of this specification for job cards released from now on.
          </p>
          <input
            aria-label="Reason for spec-sheet QC values"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
            placeholder="Reason (e.g. customer drawing rev. 3)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="season-spec-qc-save" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-[#102832] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
              {save.isPending ? "Saving…" : "Save stage QC values"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError("") }} className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {overview.data?.overlay && !editing ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Spec-sheet values v{overview.data.overlay.version} · {overview.data.overlay.reason}
        </p>
      ) : null}
    </section>
  )
}
