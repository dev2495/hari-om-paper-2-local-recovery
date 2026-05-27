"use client"

import { useEffect, useMemo, useState } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  formatNumber,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useToleranceSettings, useUpdateToleranceSettings } from "@/hooks/use-production"
import { usePlants } from "@/hooks/use-system"

type FormState = {
  default_kg: string
  raw_paper_kg: string
  adhesive_kg: string
  parchment_kg: string
  packaging_kg: string
  paper_expected_consumption_factor: string
  paper_standard_wastage_percent: string
}

const EMPTY_FORM: FormState = {
  default_kg: "",
  raw_paper_kg: "",
  adhesive_kg: "",
  parchment_kg: "",
  packaging_kg: "",
  paper_expected_consumption_factor: "",
  paper_standard_wastage_percent: "",
}

function asString(value: any): string {
  if (value === null || value === undefined || value === "") return ""
  return String(value)
}

function numericOrNull(value: string, allowZero = true): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  if (!allowZero && n <= 0) return null
  return n
}

export default function TolerancesWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <TolerancesPage />
    </RoleGate>
  )
}

function TolerancesPage() {
  const { activePlant, user } = useAuth()
  const { data: plants } = usePlants()
  const plantList: Array<{ id: string; code?: string; name?: string }> = useMemo(
    () => (Array.isArray(plants) ? plants : []),
    [plants],
  )

  // Selected plant for the editor. Default to user's active plant; otherwise first allowed.
  const [selectedPlant, setSelectedPlant] = useState<string>("")

  useEffect(() => {
    if (selectedPlant) return
    if (activePlant && activePlant !== "ALL") {
      setSelectedPlant(activePlant)
      return
    }
    const firstPlant = plantList.find((p) => p?.id || p?.code)
    if (firstPlant) {
      setSelectedPlant(String(firstPlant.id || firstPlant.code || ""))
    }
  }, [activePlant, plantList, selectedPlant])

  const { data, isLoading, isError, refetch } = useToleranceSettings(selectedPlant || undefined, {
    enabled: Boolean(selectedPlant),
  })
  const update = useUpdateToleranceSettings()

  const currentRow = useMemo(() => {
    const rows = (data as any)?.rows || []
    return rows.find((r: any) => String(r?.plant_id || "") === selectedPlant) || rows[0] || null
  }, [data, selectedPlant])

  const globalDefaults = useMemo(() => (data as any)?.global_defaults || {}, [data])
  const globalByItemType = useMemo(() => globalDefaults.by_item_type || {}, [globalDefaults])

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  // Seed form when the current row changes (selecting a new plant or after a save).
  useEffect(() => {
    if (!currentRow) return
    setForm({
      default_kg: asString(currentRow.default_kg ?? globalDefaults.default_kg ?? 5),
      raw_paper_kg: asString(currentRow.by_item_type_overrides?.RAW_PAPER),
      adhesive_kg: asString(currentRow.by_item_type_overrides?.ADHESIVE),
      parchment_kg: asString(currentRow.by_item_type_overrides?.PARCHMENT),
      packaging_kg: asString(currentRow.by_item_type_overrides?.PACKAGING),
      paper_expected_consumption_factor: asString(currentRow.paper_expected_consumption_factor),
      paper_standard_wastage_percent: asString(currentRow.paper_standard_wastage_percent),
    })
    setDirty(false)
    setSaveError(null)
    setSaveOk(null)
  }, [currentRow, globalDefaults.default_kg])

  function update_field<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setSaveOk(null)
  }

  async function onSave() {
    setSaveError(null)
    setSaveOk(null)
    const defaultKg = numericOrNull(form.default_kg, true)
    if (defaultKg === null || defaultKg < 0) {
      setSaveError("Default tolerance is required and must be ≥ 0.")
      return
    }
    const payload = {
      default_kg: defaultKg,
      raw_paper_kg: numericOrNull(form.raw_paper_kg, true),
      adhesive_kg: numericOrNull(form.adhesive_kg, true),
      parchment_kg: numericOrNull(form.parchment_kg, true),
      packaging_kg: numericOrNull(form.packaging_kg, true),
      paper_expected_consumption_factor: numericOrNull(form.paper_expected_consumption_factor, false),
      paper_standard_wastage_percent: numericOrNull(form.paper_standard_wastage_percent, true),
    }
    try {
      await update.mutateAsync({ plantId: selectedPlant, payload })
      setSaveOk("Saved. Reconciliation will use these tolerances on the next refresh.")
      setDirty(false)
      refetch()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || "Save failed."
      setSaveError(String(detail))
    }
  }

  const onReset = () => {
    if (currentRow) {
      setForm({
        default_kg: asString(currentRow.default_kg ?? globalDefaults.default_kg ?? 5),
        raw_paper_kg: asString(currentRow.by_item_type_overrides?.RAW_PAPER),
        adhesive_kg: asString(currentRow.by_item_type_overrides?.ADHESIVE),
        parchment_kg: asString(currentRow.by_item_type_overrides?.PARCHMENT),
        packaging_kg: asString(currentRow.by_item_type_overrides?.PACKAGING),
        paper_expected_consumption_factor: asString(currentRow.paper_expected_consumption_factor),
        paper_standard_wastage_percent: asString(currentRow.paper_standard_wastage_percent),
      })
      setDirty(false)
      setSaveError(null)
      setSaveOk(null)
    }
  }

  // Build the "effective" preview so the user can see what will be in force.
  const effective = useMemo(() => {
    const defKg = numericOrNull(form.default_kg, true) ?? Number(globalDefaults.default_kg || 5)
    const pickOrGlobal = (override: number | null, globalKey: string): number => {
      if (override === null) return Number(globalByItemType[globalKey] ?? defKg)
      return override
    }
    return {
      default_kg: defKg,
      RAW_PAPER: pickOrGlobal(numericOrNull(form.raw_paper_kg, true), "RAW_PAPER"),
      ADHESIVE: pickOrGlobal(numericOrNull(form.adhesive_kg, true), "ADHESIVE"),
      PARCHMENT: pickOrGlobal(numericOrNull(form.parchment_kg, true), "PARCHMENT"),
      PACKAGING: pickOrGlobal(numericOrNull(form.packaging_kg, true), "PACKAGING"),
    }
  }, [form, globalDefaults, globalByItemType])

  const scopeLabel = currentRow?.scope === "plant" ? "PLANT OVERRIDE" : "GLOBAL DEFAULTS"
  const lastUpdated = currentRow?.updated_at ? new Date(currentRow.updated_at).toLocaleString() : "—"
  const lastUpdatedBy = currentRow?.updated_by || "—"

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="system-tolerances-page">
      <ReportHero
        eyebrow="System · per-plant tolerances"
        title="Variance tolerance editor"
        description="Set the per-item-type variance bands used by reconciliation. Saved values apply to the selected plant on the next math refresh. Leave a band blank to keep the global default."
        accent="cyan"
        chips={[
          { label: scopeLabel, tone: currentRow?.scope === "plant" ? "ok" : "neutral" },
          { label: `Last updated ${lastUpdated}`, tone: "neutral" },
          { label: `By ${lastUpdatedBy}`, tone: "neutral" },
          { label: `Owner / Admin only`, tone: "warn" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Plant">
          <select
            value={selectedPlant}
            onChange={(e) => setSelectedPlant(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            data-testid="tolerance-plant-select"
          >
            {plantList.length === 0 ? <option value="">No plants</option> : null}
            {plantList.map((p) => (
              <option key={String(p.id || p.code)} value={String(p.id || p.code)}>
                {p.name || p.code || p.id}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Editor">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">
            {user?.email || user?.name || "—"}
          </span>
        </FilterField>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty || update.isPending}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-cyan-200 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || update.isPending || !selectedPlant}
          className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-40"
          data-testid="tolerance-save"
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </ReportFilterBar>

      {isError ? (
        <NoteCallout tone="critical">Could not load tolerance settings. Check that production-service is up.</NoteCallout>
      ) : null}
      {saveError ? <NoteCallout tone="critical">{saveError}</NoteCallout> : null}
      {saveOk ? <NoteCallout tone="ok">{saveOk}</NoteCallout> : null}

      <Panel
        eyebrow="Editor"
        title="Variance bands (kg)"
        description="Override the per-item-type band for this plant. Blank = use the global default shown next to each field."
      >
        {isLoading ? (
          <NoteCallout tone="neutral">Loading current settings…</NoteCallout>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ToleranceField
              label="Default (fallback)"
              hint={`Used when item type is unknown. Global: ${formatNumber(Number(globalDefaults.default_kg || 5), 2)} kg`}
              value={form.default_kg}
              onChange={(v) => update_field("default_kg", v)}
              testId="tol-default"
              required
            />
            <ToleranceField
              label="Raw paper"
              hint={`Global: ${formatNumber(Number(globalByItemType.RAW_PAPER || 5), 2)} kg`}
              value={form.raw_paper_kg}
              onChange={(v) => update_field("raw_paper_kg", v)}
              testId="tol-raw-paper"
            />
            <ToleranceField
              label="Adhesive"
              hint={`Global: ${formatNumber(Number(globalByItemType.ADHESIVE || 0.5), 2)} kg`}
              value={form.adhesive_kg}
              onChange={(v) => update_field("adhesive_kg", v)}
              testId="tol-adhesive"
            />
            <ToleranceField
              label="Parchment"
              hint={`Global: ${formatNumber(Number(globalByItemType.PARCHMENT || 1), 2)} kg`}
              value={form.parchment_kg}
              onChange={(v) => update_field("parchment_kg", v)}
              testId="tol-parchment"
            />
            <ToleranceField
              label="Packaging"
              hint={`Global: ${formatNumber(Number(globalByItemType.PACKAGING || 10), 2)} kg`}
              value={form.packaging_kg}
              onChange={(v) => update_field("packaging_kg", v)}
              testId="tol-packaging"
            />
            <ToleranceField
              label="Paper expected factor (×)"
              hint={`Multiplier on theoretical paper consumption. Global: ${formatNumber(Number(globalDefaults.paper_expected_consumption_factor || 1.07), 3)}`}
              value={form.paper_expected_consumption_factor}
              onChange={(v) => update_field("paper_expected_consumption_factor", v)}
              testId="tol-paper-factor"
            />
            <ToleranceField
              label="Paper standard wastage (%)"
              hint={`Allowed standard wastage. Global: ${formatNumber(Number(globalDefaults.paper_standard_wastage_percent || 7), 2)}%`}
              value={form.paper_standard_wastage_percent}
              onChange={(v) => update_field("paper_standard_wastage_percent", v)}
              testId="tol-paper-wastage"
            />
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="Preview"
        title="Effective tolerances after save"
        description="What reconciliation will use if you save right now. Plant override columns show 'OVERRIDE' when the field is set; otherwise they fall through to the global value."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3">Item type</th>
              <th className="py-2 pr-3 text-right">Global</th>
              <th className="py-2 pr-3 text-right">Effective</th>
              <th className="py-2 pr-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {["RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKAGING"].map((k) => {
              const globalVal = Number(globalByItemType[k] ?? globalDefaults.default_kg ?? 5)
              const effVal = Number((effective as any)[k] ?? globalVal)
              const overrideRaw = (form as any)[
                k === "RAW_PAPER"
                  ? "raw_paper_kg"
                  : k === "ADHESIVE"
                    ? "adhesive_kg"
                    : k === "PARCHMENT"
                      ? "parchment_kg"
                      : "packaging_kg"
              ] as string
              const isOverride = overrideRaw.trim() !== ""
              return (
                <tr key={k} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{k.replace("_", " ")}</td>
                  <td className="py-2 pr-3 text-right text-slate-500">{formatNumber(globalVal, 2)} kg</td>
                  <td className="py-2 pr-3 text-right font-bold text-slate-950">{formatNumber(effVal, 2)} kg</td>
                  <td className="py-2 pr-3">
                    <Pill tone={isOverride ? "ok" : "neutral"}>{isOverride ? "OVERRIDE" : "GLOBAL"}</Pill>
                  </td>
                </tr>
              )
            })}
            <tr>
              <td className="py-2 pr-3 font-mono text-xs">DEFAULT (fallback)</td>
              <td className="py-2 pr-3 text-right text-slate-500">{formatNumber(Number(globalDefaults.default_kg || 5), 2)} kg</td>
              <td className="py-2 pr-3 text-right font-bold text-slate-950">{formatNumber(effective.default_kg, 2)} kg</td>
              <td className="py-2 pr-3">
                <Pill tone={form.default_kg.trim() && Number(form.default_kg) !== Number(globalDefaults.default_kg || 5) ? "ok" : "neutral"}>
                  {form.default_kg.trim() && Number(form.default_kg) !== Number(globalDefaults.default_kg || 5) ? "OVERRIDE" : "GLOBAL"}
                </Pill>
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel
        eyebrow="How this works"
        title="Notes"
      >
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li><strong>Empty band</strong> means the system falls back to the global default. Saving a row with all bands blank just commits the <code>default_kg</code>.</li>
          <li><strong>Save</strong> commits the plant override row. The next reconciliation refresh uses it; in-flight responses are not retroactively re-classified.</li>
          <li><strong>ALL scope is rejected.</strong> Switch the plant chip before saving — the audit trail records exactly which plant the change applies to.</li>
          <li><strong>Reset</strong> reverts the form to the most-recently-saved values for the selected plant.</li>
        </ul>
      </Panel>
    </div>
  )
}

function ToleranceField({
  label,
  hint,
  value,
  onChange,
  testId,
  required,
}: {
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  testId?: string
  required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-slate-800">
        {label} {required ? <span className="text-rose-700">*</span> : null}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        placeholder={required ? "Required" : "Use global default"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-400 focus:outline-none"
      />
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  )
}
