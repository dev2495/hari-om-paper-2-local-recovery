"use client"

import { useEffect, useState } from "react"

import { emptyIncomingProfile, formatAllowedRange } from "@/lib/qc-measurement"

type ItemQualityProfileFormProps = {
  item: any
  saving?: boolean
  onSave: (profile: any) => Promise<void> | void
  onCopyTemplate?: () => Promise<void> | void
  onApprove?: (exemption?: boolean) => Promise<void> | void
}

export function ItemQualityProfileForm({ item, saving, onSave, onCopyTemplate, onApprove }: ItemQualityProfileFormProps) {
  const [formError, setFormError] = useState("")
  const [savedMessage, setSavedMessage] = useState("")
  const [profile, setProfile] = useState(() => item?.quality_profile || emptyIncomingProfile())

  useEffect(() => {
    setProfile(item?.quality_profile || emptyIncomingProfile())
  }, [item?.id, item?.quality_profile])

  const parameters = Array.isArray(profile.parameters) ? profile.parameters : []

  function updateRow(index: number, patch: Record<string, any>) {
    setSavedMessage("")
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
        setFormError("")
        setSavedMessage("")
        try {
          const status = ["draft", "complete"].includes(profile.setup_status || profile.status)
            ? (profile.setup_status || profile.status) : "draft"
          await onSave({ ...profile, status, setup_status: status })
          setSavedMessage("Saved for review. Approval is a separate action.")
        } catch (error: any) {
          const detail = error?.response?.data?.detail
          setFormError(typeof detail === "string" ? detail : detail?.message || error?.message || "Quality profile could not be saved.")
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[12px] font-semibold text-muted-foreground">Setup status</span>
          <select
            value={["draft", "complete"].includes(profile.setup_status || profile.status) ? (profile.setup_status || profile.status) : "draft"}
            onChange={(event) =>
              setProfile((current: any) => ({
                ...current,
                setup_status: event.target.value,
                status: event.target.value,
                inspection_required: event.target.value !== "not_required",
              }))
            }
            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
          >
            <option value="draft">Draft</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <p className="self-end text-xs text-muted-foreground">
          Save changes for review, then approve the revision. Critical checks cannot be waived after failure. Existing lots keep their approved rules.
        </p>
      </div>
      <div className="rounded-2xl border border-border md:overflow-x-auto">
        <table className="block w-full border-collapse text-sm md:table">
          <thead className="hidden md:table-header-group">
            <tr className="bg-muted text-left text-[12px] text-muted-foreground">
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Min</th>
              <th className="px-3 py-2">Max</th>
              <th className="px-3 py-2">Frozen rule</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-border md:table-row-group">
            {parameters.map((row: any, index: number) => (
              <tr key={`${row.code || "row"}-${index}`} className="grid grid-cols-2 gap-x-2 p-2 md:table-row md:p-0">
                <td className="min-w-0 px-2 py-2 md:px-3">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Code</span>
                  <input aria-label={`Code for ${row.label || row.code || "parameter"}`}  className="h-10 w-full min-w-0 rounded-lg md:w-24 border border-border px-2" value={row.code || ""} onChange={(event) => updateRow(index, { code: event.target.value })} />
                </td>
                <td className="min-w-0 px-2 py-2 md:px-3">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Label</span>
                  <input aria-label={`Label for ${row.label || row.code || "parameter"}`}  className="h-10 w-full rounded-lg border border-border px-2" value={row.label || ""} onChange={(event) => updateRow(index, { label: event.target.value })} />
                </td>
                <td className="min-w-0 px-2 py-2 md:px-3">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Unit</span>
                  <input aria-label={`Unit for ${row.label || row.code || "parameter"}`}  className="h-10 w-full min-w-0 rounded-lg md:w-16 border border-border px-2" value={row.unit || ""} onChange={(event) => updateRow(index, { unit: event.target.value })} />
                </td>
                <td className="min-w-0 px-2 py-2 md:px-3">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Minimum</span>
                  <input aria-label={`Minimum for ${row.label || row.code || "parameter"}`}  className="h-10 w-full min-w-0 rounded-lg md:w-20 border border-border px-2" type="number" step="0.001" value={row.min ?? ""} onChange={(event) => updateRow(index, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                </td>
                <td className="min-w-0 px-2 py-2 md:px-3">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Maximum</span>
                  <input aria-label={`Maximum for ${row.label || row.code || "parameter"}`}  className="h-10 w-full min-w-0 rounded-lg md:w-20 border border-border px-2" type="number" step="0.001" value={row.max ?? ""} onChange={(event) => updateRow(index, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                </td>
                <td className="col-span-2 px-2 py-2 text-xs font-semibold text-muted-foreground md:px-3">{formatAllowedRange(row)}
                    <label className="mt-2 flex min-h-10 items-center gap-2 font-medium">
                      <input type="checkbox" checked={row.non_waivable === true}
                        aria-label={`Critical non-waivable check: ${row.label || row.code || "parameter"}`}
                        onChange={(event) => updateRow(index, { non_waivable: event.target.checked })} />
                      Critical: cannot be waived
                    </label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {formError ? <p role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink">{formError}</p> : null}
      {savedMessage ? <p role="status" className="text-sm text-muted-foreground">{savedMessage}</p> : null}
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
          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground"
        >
          Add parameter
        </button>
        <button
          type="button"
          disabled={saving || !item || !onCopyTemplate}
          onClick={() => onCopyTemplate?.()}
          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground disabled:opacity-50"
        >
          Copy category template
        </button>
        <button
          type="submit"
          disabled={saving || !item}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Save item QC profile
        </button>
        <button
          type="button"
          disabled={saving || !item || !onApprove}
          onClick={() => onApprove?.(false)}
          className="rounded-xl border border-foreground/80 px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          Approve profile
        </button>
        <button
          type="button"
          disabled={saving || !item || !onApprove}
          onClick={() => onApprove?.(true)}
          className="rounded-xl border border-signal-amber-ink/40 px-3 py-2 text-sm font-semibold text-signal-amber-ink disabled:opacity-50"
        >
          Approve exemption
        </button>
      </div>
    </form>
  )
}
