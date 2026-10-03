"use client"

import { useEffect, useState } from "react"

import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useSpecDefaults, useUpdateSpecDefaults } from "@/hooks/use-specs"
import { displayPlantScope } from "@/lib/plant-scope"

const FIELDS = [
  { key: "adhesive_percent", label: "Total additions", unit: "%", hint: "Adhesive + parchment allowance" },
  { key: "parchment_percent", label: "Parchment share", unit: "%", hint: "Part of the total additions" },
  { key: "moisture_loss_percent", label: "Moisture loss", unit: "%", hint: "Wet → dry divisor" },
  { key: "band_id_mm", label: "± I.D.", unit: "mm", hint: "Final limit band" },
  { key: "band_od_mm", label: "± O.D.", unit: "mm", hint: "Final limit band" },
  { key: "band_length_mm", label: "± Length", unit: "mm", hint: "Final limit band" },
  { key: "band_weight_g", label: "± Weight", unit: "g", hint: "Final limit band" },
  { key: "band_cs_pct", label: "± C.S.", unit: "%", hint: "Of required C.S." },
  { key: "band_moisture_pct", label: "± Moisture", unit: "%", hint: "Final limit band" },
] as const

/**
 * Plant defaults every new specification starts from. Existing specs keep the bands
 * they were saved with; a spec can still set its own bands on the sheet.
 */
export function SpecDefaultsPanel() {
  const { activePlant } = useAuth()
  const { showToast } = useApp()
  const plant = activePlant && activePlant !== "ALL" ? activePlant : null
  const defaultsQuery = useSpecDefaults(plant)
  const update = useUpdateSpecDefaults()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!defaultsQuery.data) return
    setValues(Object.fromEntries(FIELDS.map((field) => [field.key, String((defaultsQuery.data as any)[field.key] ?? "")])))
  }, [defaultsQuery.data])

  if (!plant) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="spec-defaults-pick-plant">
        Pick one plant in the top switcher to review its specification defaults.
      </p>
    )
  }

  const save = async () => {
    const payload: Record<string, number> = {}
    for (const field of FIELDS) {
      const number = Number(values[field.key])
      if (!Number.isFinite(number) || number < 0) {
        showToast(`${field.label} must be a number of 0 or more.`, "error")
        return
      }
      payload[field.key] = number
    }
    try {
      await update.mutateAsync({ data: payload, plantId: plant })
      showToast("Plant specification defaults saved. New specs start from them.", "success")
      setOpen(false)
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      showToast(typeof detail === "string" ? detail : error?.message || "Could not save defaults.", "error")
    }
  }

  return (
    <section className="rounded-[28px] border border-border bg-card/80 p-4 shadow-sm" data-testid="spec-defaults-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-muted-foreground">Plant specification defaults · {displayPlantScope(plant)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {defaultsQuery.data
              ? FIELDS.map((field) => `${field.label} ${(defaultsQuery.data as any)[field.key] ?? "—"}${field.unit === "%" ? "%" : ` ${field.unit}`}`).join(" · ")
              : defaultsQuery.isError
                ? "Defaults could not be loaded."
                : "Loading defaults…"}
          </p>
        </div>
        <button
          type="button"
          data-testid="spec-defaults-toggle"
          onClick={() => setOpen((current) => !current)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground"
        >
          {open ? "Close" : "Edit defaults"}
        </button>
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {FIELDS.map((field) => (
              <label key={field.key} className="space-y-1 text-sm">
                <span className="block text-[12px] font-semibold text-muted-foreground">
                  {field.label} ({field.unit})
                </span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  data-testid={`spec-defaults-${field.key}`}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3"
                />
                <span className="block text-[11px] text-muted-foreground">{field.hint}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Saved specs keep their own bands. Only new specifications start from these values.</p>
          <button
            type="button"
            data-testid="spec-defaults-save"
            disabled={update.isPending}
            onClick={() => void save()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {update.isPending ? "Saving…" : "Save defaults"}
          </button>
        </div>
      ) : null}
    </section>
  )
}
