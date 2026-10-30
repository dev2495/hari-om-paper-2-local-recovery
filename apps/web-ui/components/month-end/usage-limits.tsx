"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Info, LoaderCircle, RotateCcw, Save, ShieldCheck } from "lucide-react"

import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useSaveUsageLimits, useUsageLimits } from "@/hooks/use-month-end"
import { usePlants } from "@/hooks/use-system"
import { describeApiError } from "@/lib/api-error"
import { dayTimeText, monthEndErrorText, personText, qty, type MonthEndLimit } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

type Draft = Record<string, { normal_wastage_pct: string; allowed_gap_pct: string; min_gap: string }>

const TYPE_HELP: Record<string, string> = {
  RAW_PAPER: "Kraft and other papers.",
  ADHESIVE: "Glue and its components.",
  PARCHMENT: "Parchment in every colour.",
  PACKAGING: "Boxes, plastic sheets and fadda, in each item's own unit.",
  OTHER: "Anything else issued to the floor, in its own unit.",
}

const toDraft = (limits: MonthEndLimit[]): Draft =>
  Object.fromEntries(limits.map((row) => [row.material_type, { normal_wastage_pct: String(row.normal_wastage_pct), allowed_gap_pct: String(row.allowed_gap_pct), min_gap: String(row.min_gap) }]))

const num = (value: string) => {
  const parsed = Number(value)
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : NaN
}

const OWN_UNIT = "each item's own unit"

/** The unit the minimum gap reads in. It always applies in each item's own unit (spec 1): one unit in
 * use names it (adhesive kept in litres reads litre), mixed units (kg and litre) name no single unit. */
function unitWord(row: MonthEndLimit) {
  const units = Array.from(new Set(row.units_in_use || []))
  if (units.length === 1) return units[0]
  if (units.length > 1) return ""
  return row.unit_hint && row.unit_hint !== OWN_UNIT ? row.unit_hint : ""
}

/** "counted in kg", "counted in kg and litre: the minimum gap is in each item's own unit". */
function unitHelp(row: MonthEndLimit) {
  const units = Array.from(new Set(row.units_in_use || []))
  if (units.length > 1) return ` Counted in ${units.join(" and ")}: the minimum gap applies in each item's own unit.`
  const unit = unitWord(row)
  return unit ? ` Counted in ${unit}.` : " In each item's own unit."
}

function Field({ id, label, shortLabel, suffix, value, onChange, disabled, error, hint }: { id: string; label: string; shortLabel: string; suffix: string; value: string; onChange: (value: string) => void; disabled: boolean; error?: string; hint: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block truncate text-[12px] font-semibold text-foreground">
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </label>
      <div className={cn("mt-1 flex h-12 items-center overflow-hidden rounded-lg border bg-card focus-within:ring-2 focus-within:ring-ring/40", error ? "border-signal-rose-line" : "border-input", disabled && "bg-[hsl(var(--surface-2))]")}>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint`}
          className="h-full w-full min-w-0 flex-1 bg-transparent px-2.5 text-[14px] font-semibold tabular-nums outline-none disabled:cursor-not-allowed sm:px-3"
        />
        {suffix ? <span className="shrink-0 pr-2.5 text-[12px] font-medium text-muted-foreground sm:pr-3 sm:text-[12.5px]">{suffix}</span> : null}
      </div>
      <p id={`${id}-hint`} className={cn("mt-1 text-[12px] leading-4", error ? "text-signal-rose-ink" : "text-muted-foreground")}>{error || hint}</p>
    </div>
  )
}

export function UsageLimits() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { activePlant, user } = useAuth()
  const { showToast } = useApp()
  const plants = usePlants()
  const isSuper = (user?.roles || []).some((role) => role === "Owner" || role === "Admin") || user?.role === "Owner" || user?.role === "Admin"
  // The month-end page is for the Owner, Admin and plant head (its RoleGate): no back link for others.
  const canSeeMonthEnd = isSuper || (user?.roles || []).includes("PlantManager") || user?.role === "PlantManager"
  const allowed = useMemo(() => new Set([...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].map(String)), [user])
  const plantRows = (plants.data || []).filter((plant: any) => isSuper || allowed.has(String(plant.id)))
  const requested = params.get("plant") || ""
  const fallback = activePlant && activePlant !== "ALL" ? activePlant : plantRows[0]?.id ? String(plantRows[0].id) : ""
  const plantId = requested && requested !== "ALL" && (isSuper || allowed.has(requested)) ? requested : fallback

  const query = useUsageLimits(plantId)
  const save = useSaveUsageLimits(plantId)
  const limits = query.data?.plants?.[0]?.limits || []
  const defaults = Object.fromEntries((query.data?.defaults || []).map((row) => [row.material_type, row]))
  const canEdit = Boolean(query.data?.can_edit)
  const [draft, setDraft] = useState<Draft>({})
  const signature = limits.map((row) => `${row.material_type}:${row.normal_wastage_pct}:${row.allowed_gap_pct}:${row.min_gap}`).join("|")
  useEffect(() => {
    setDraft(toDraft(limits))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, plantId])

  const errors: Record<string, Partial<Record<keyof Draft[string], string>>> = {}
  for (const row of limits) {
    const value = draft[row.material_type]
    if (!value) continue
    const wastage = num(value.normal_wastage_pct)
    const gap = num(value.allowed_gap_pct)
    const minimum = num(value.min_gap)
    const rowErrors: Partial<Record<keyof Draft[string], string>> = {}
    if (!(wastage >= 0 && wastage <= 50)) rowErrors.normal_wastage_pct = "Between 0 and 50 %"
    if (!(gap >= 0 && gap <= 100)) rowErrors.allowed_gap_pct = "Between 0 and 100 %"
    if (!(minimum >= 0)) rowErrors.min_gap = "0 or more"
    if (Object.keys(rowErrors).length) errors[row.material_type] = rowErrors
  }
  const dirty = limits.some((row) => {
    const value = draft[row.material_type]
    return value && (num(value.normal_wastage_pct) !== row.normal_wastage_pct || num(value.allowed_gap_pct) !== row.allowed_gap_pct || num(value.min_gap) !== row.min_gap)
  })
  const hasErrors = Object.keys(errors).length > 0
  const lastSaved = limits.filter((row) => row.updated_at).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0]

  const submit = () =>
    save.mutate(
      limits.map((row) => ({
        material_type: row.material_type,
        normal_wastage_pct: num(draft[row.material_type].normal_wastage_pct),
        allowed_gap_pct: num(draft[row.material_type].allowed_gap_pct),
        min_gap: num(draft[row.material_type].min_gap),
      })),
      {
        onSuccess: () => showToast("Usage limits saved. Open months use them now; closed months keep their own.", "success"),
        onError: (error) => showToast(describeApiError(error, "The limits could not be saved"), "error"),
      },
    )

  const setField = (type: string, key: keyof Draft[string], value: string) => setDraft((current) => ({ ...current, [type]: { ...current[type], [key]: value } }))

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4 pb-24 sm:pb-6" data-testid="usage-limits-page">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {canSeeMonthEnd ? (
            <Link href={`/production/reconciliation${plantId ? `?plant=${encodeURIComponent(plantId)}` : ""}`} className="mb-1 inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Month-end close
            </Link>
          ) : null}
          <h1 className="text-[clamp(20px,2.4vw,26px)] font-[650] leading-tight tracking-[-0.022em]">Usage limits</h1>
          <p className="mt-1.5 max-w-[72ch] text-[13.5px] leading-6 text-muted-foreground">
            How much material the floor may use beyond the spec, per material type. Expected use = spec + normal wastage; an item is fine while its gap stays inside the allowed gap.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="limits-plant" className="text-[12px] font-semibold text-muted-foreground">Plant</label>
          <select
            id="limits-plant"
            value={plantId}
            onChange={(event) => {
              const next = new URLSearchParams(params.toString())
              next.set("plant", event.target.value)
              router.replace(`${pathname}?${next.toString()}`, { scroll: false })
            }}
            className="h-11 min-w-[12rem] rounded-lg border border-input bg-card px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9"
            data-testid="usage-limits-plant"
          >
            {plantRows.map((plant: any) => <option key={plant.id} value={String(plant.id)}>{plant.name || plant.code}</option>)}
          </select>
        </div>
      </header>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-[hsl(var(--surface-2))] px-4 py-3 text-[12.5px] leading-5 text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Used by Month-end close only (not QC, not purchase). Allowed gap = the bigger of <strong className="font-semibold text-foreground">allowed gap % × expected</strong> and the <strong className="font-semibold text-foreground">minimum gap</strong>, so tiny quantities never flag.
          Closed months keep the limits they were closed with.
        </p>
      </div>

      {!canEdit && query.data ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-[12.5px] text-muted-foreground" role="note">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Only the Owner or Admin can change these limits.
        </p>
      ) : null}

      {!plantId ? (
        <LoadingState label="Finding your plant…" />
      ) : query.isLoading ? (
        <LoadingState label="Reading the usage limits…" />
      ) : query.isError || !query.data ? (
        <ErrorState title="Usage limits could not be loaded" message={monthEndErrorText(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <div className="grid gap-3" data-testid="usage-limits-list">
          {limits.map((row) => {
            const value = draft[row.material_type] || { normal_wastage_pct: "", allowed_gap_pct: "", min_gap: "" }
            const standard = defaults[row.material_type]
            const unit = unitWord(row)
            const exampleUnit = unit.includes(" or ") ? "" : unit
            const wastage = num(value.normal_wastage_pct)
            const gapPct = num(value.allowed_gap_pct)
            const minimum = num(value.min_gap)
            const spec = 100
            const expected = spec * (1 + (Number.isFinite(wastage) ? wastage : 0) / 100)
            const allowedGap = Math.max((Number.isFinite(gapPct) ? gapPct : 0) * expected / 100, Number.isFinite(minimum) ? minimum : 0)
            const isStandard = standard && num(value.normal_wastage_pct) === standard.normal_wastage_pct && num(value.allowed_gap_pct) === standard.allowed_gap_pct && num(value.min_gap) === standard.min_gap
            const rowErrors = errors[row.material_type] || {}
            return (
              <article key={row.material_type} className="rounded-xl border border-border bg-card p-4 shadow-premium" data-testid="usage-limit-row" data-type={row.material_type}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold">{row.label}</h2>
                    <p className="text-[12.5px] text-muted-foreground" data-testid="usage-limit-unit-help">{TYPE_HELP[row.material_type]}{row.material_type === "PACKAGING" || row.material_type === "OTHER" ? "" : unitHelp(row)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex h-6 items-center rounded-full border px-2 text-[12px] font-semibold", row.source === "PLANT" ? "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink" : "border-border bg-muted text-muted-foreground")}>
                      {row.source === "PLANT" ? "Set for this plant" : "Standard"}
                    </span>
                    {canEdit && standard && !isStandard ? (
                      <button
                        type="button"
                        className="inline-flex min-h-[44px] items-center gap-1 px-1 text-[12px] font-semibold text-primary hover:underline sm:min-h-0"
                        onClick={() => setDraft((current) => ({ ...current, [row.material_type]: { normal_wastage_pct: String(standard.normal_wastage_pct), allowed_gap_pct: String(standard.allowed_gap_pct), min_gap: String(standard.min_gap) } }))}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Use standard
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
                  <Field id={`${row.material_type}-wastage`} label="Normal wastage" shortLabel="Wastage" suffix="%" value={value.normal_wastage_pct} disabled={!canEdit} onChange={(next) => setField(row.material_type, "normal_wastage_pct", next)} error={rowErrors.normal_wastage_pct} hint={`Standard ${qty(standard?.normal_wastage_pct ?? 0)}%`} />
                  <Field id={`${row.material_type}-gap`} label="Allowed gap" shortLabel="Allowed gap" suffix="%" value={value.allowed_gap_pct} disabled={!canEdit} onChange={(next) => setField(row.material_type, "allowed_gap_pct", next)} error={rowErrors.allowed_gap_pct} hint={`Standard ${qty(standard?.allowed_gap_pct ?? 7)}%`} />
                  <Field id={`${row.material_type}-min`} label="Minimum gap" shortLabel="Min. gap" suffix={unit} value={value.min_gap} disabled={!canEdit} onChange={(next) => setField(row.material_type, "min_gap", next)} error={rowErrors.min_gap} hint={unit ? `Standard ${qty(standard?.min_gap ?? 0, unit)}` : `Standard ${qty(standard?.min_gap ?? 0)} in each item's unit`} />
                </div>
                <p className="mt-3 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2 text-[12.5px] leading-5 text-muted-foreground" data-testid="usage-limit-example">
                  Example: spec {qty(spec, exampleUnit)} → expected <strong className="font-semibold text-foreground">{qty(expected, exampleUnit)}</strong>; fine between {qty(Math.max(0, expected - allowedGap), exampleUnit)} and {qty(expected + allowedGap, exampleUnit)} (± {qty(allowedGap, exampleUnit)}).
                </p>
                {row.updated_by && row.source === "PLANT" ? (
                  <p className="mt-2 text-[12px] text-muted-foreground">Saved by {personText(row.updated_by)} · {dayTimeText(row.updated_at)}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      {canEdit && query.data ? (
        <div className={cn("z-20 rounded-xl border border-border bg-card/95 px-3.5 py-2.5 backdrop-blur [margin-bottom:env(safe-area-inset-bottom)] sm:static sm:px-4 sm:py-3 sm:shadow-premium", dirty ? "sticky bottom-2 shadow-pop" : "shadow-premium")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12.5px] leading-5 text-muted-foreground">
              {hasErrors ? "Fix the marked fields first." : dirty ? "Unsaved changes. Open months use the new limits as soon as you save." : lastSaved ? `Last saved by ${personText(lastSaved.updated_by)} · ${dayTimeText(lastSaved.updated_at)}` : "These are the standard limits."}
            </p>
            <div className="flex gap-2">
              <button type="button" className="erp-btn-secondary !h-11 flex-1 sm:flex-none" disabled={!dirty || save.isPending} onClick={() => setDraft(toDraft(limits))}>Undo changes</button>
              <button type="button" className="erp-btn-primary !h-11 flex-1 sm:flex-none" disabled={!dirty || hasErrors || save.isPending} onClick={submit} data-testid="usage-limits-save">
                {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save limits
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
