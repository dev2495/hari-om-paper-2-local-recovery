"use client"

import { useEffect, useState } from "react"

import { emptyIncomingProfile, formatAllowedRange } from "@/lib/qc-measurement"

type ItemQualityProfileFormProps = {
  item: any
  saving?: boolean
  onSave: (profile: any) => Promise<void> | void
}

export function ItemQualityProfileForm({ item, saving, onSave }: ItemQualityProfileFormProps) {
  const [profile, setProfile] = useState(() => item?.quality_profile || emptyIncomingProfile())

  useEffect(() => {
    setProfile(item?.quality_profile || emptyIncomingProfile())
  }, [item?.id, item?.quality_profile])

  const parameters = Array.isArray(profile.parameters) ? profile.parameters : []

  function updateRow(index: number, patch: Record<string, any>) {
    setProfile((current: any) => ({
      ...current,
      parameters: (current.parameters || []).map((row: any, rowIndex: number) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }))
  }

  return (
    <form
      data-testid="item-quality-profile-form"
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault()
        await onSave(profile)
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Setup status</span>
          <select
            value={profile.setup_status || profile.status || "draft"}
            onChange={(event) =>
              setProfile((current: any) => ({
                ...current,
                setup_status: event.target.value,
                status: event.target.value,
                inspection_required: event.target.value !== "not_required",
              }))
            }
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="draft">Draft</option>
            <option value="complete">Complete</option>
            <option value="not_required">Inspection not required</option>
          </select>
        </label>
        <p className="self-end text-xs text-slate-500">
          Incoming QC uses these owned item rules. Blank min/max never invents a PASS.
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Min</th>
              <th className="px-3 py-2">Max</th>
              <th className="px-3 py-2">Frozen rule</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((row: any, index: number) => (
              <tr key={`${row.code || "row"}-${index}`}>
                <td className="px-3 py-2">
                  <input className="h-10 w-24 rounded-lg border border-slate-200 px-2" value={row.code || ""} onChange={(event) => updateRow(index, { code: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className="h-10 w-full rounded-lg border border-slate-200 px-2" value={row.label || ""} onChange={(event) => updateRow(index, { label: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className="h-10 w-16 rounded-lg border border-slate-200 px-2" value={row.unit || ""} onChange={(event) => updateRow(index, { unit: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className="h-10 w-20 rounded-lg border border-slate-200 px-2" type="number" step="0.001" value={row.min ?? ""} onChange={(event) => updateRow(index, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                </td>
                <td className="px-3 py-2">
                  <input className="h-10 w-20 rounded-lg border border-slate-200 px-2" type="number" step="0.001" value={row.max ?? ""} onChange={(event) => updateRow(index, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                </td>
                <td className="px-3 py-2 text-xs font-semibold text-slate-600">{formatAllowedRange(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            setProfile((current: any) => ({
              ...current,
              parameters: [
                ...(current.parameters || []),
                { code: "", label: "", unit: "", min: null, max: null, required: true, applicable: true, input_type: "number" },
              ],
            }))
          }
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Add parameter
        </button>
        <button
          type="submit"
          disabled={saving || !item}
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save item QC profile
        </button>
      </div>
    </form>
  )
}
