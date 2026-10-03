"use client"

import { useEffect, useMemo, useState } from "react"

import { emptyIncomingProfile, formatAllowedRange, incomingProfileBlockers, nominalMismatches, type MasterNominal } from "@/lib/qc-measurement"

type ItemQualityProfileFormProps = {
  item: any
  saving?: boolean
  allowExemption?: boolean
  /** Nominal values from the linked master (e.g. paper GSM / BF / ply bond) used to sanity-check the bands. */
  masterNominals?: MasterNominal[]
  /** Signed-in user id; approval by the person who saved the revision is refused (maker-checker). */
  currentUserId?: string | null
  onSave: (profile: any) => Promise<void> | void
  onCopyTemplate?: () => Promise<void> | void
  onApprove?: (exemption?: boolean) => Promise<void> | void
}

const CHECK_TYPES = [
  { value: "number", label: "Measured number" },
  { value: "select", label: "Pass / not OK" },
  { value: "text", label: "Note only" },
]
const PASS_FAIL_OPTIONS = ["OK", "NG"]

function blankRow() {
  return {
    code: "",
    label: "",
    unit: "",
    min: null,
    max: null,
    required: true,
    applicable: true,
    input_type: "number",
    options: [],
    method: "",
    requires_instrument: false,
    non_waivable: false,
  }
}

function lastSavedBy(profile: any): string | null {
  const history = Array.isArray(profile?.history) ? profile.history : []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && ["SAVED", "TEMPLATE_COPIED"].includes(entry.action) && entry.revision === profile?.revision) {
      return entry.actor ? String(entry.actor) : null
    }
  }
  return null
}

export function ItemQualityProfileForm({
  item,
  saving,
  onSave,
  onCopyTemplate,
  onApprove,
  allowExemption = true,
  masterNominals = [],
  currentUserId = null,
}: ItemQualityProfileFormProps) {
  const [formError, setFormError] = useState("")
  const [savedMessage, setSavedMessage] = useState("")
  const [profile, setProfile] = useState(() => item?.quality_profile || emptyIncomingProfile())
  const [dirty, setDirty] = useState(false)
  const [bands, setBands] = useState<Record<number, { nominal: string; tolerance: string }>>({})

  useEffect(() => {
    setProfile(item?.quality_profile || emptyIncomingProfile())
    setDirty(false)
    setBands({})
  }, [item?.id, item?.quality_profile])

  const parameters: any[] = Array.isArray(profile.parameters) ? profile.parameters : []
  const blockers = useMemo(() => incomingProfileBlockers(parameters), [parameters])
  const mismatches = useMemo(() => nominalMismatches(parameters, masterNominals), [parameters, masterNominals])
  const savedStatus = String(item?.quality_profile?.status || item?.quality_profile?.setup_status || "").toLowerCase()
  const maker = lastSavedBy(item?.quality_profile)
  const selfApproval = Boolean(maker && currentUserId && maker === currentUserId)
  const approveDisabledReason = !item
    ? "Select a material first."
    : dirty
      ? "Save your changes before approving."
      : !item?.quality_profile
        ? "Save a profile before approving."
        : savedStatus === "approved"
          ? "This revision is already approved."
          : blockers.length
            ? "Resolve the items listed above first."
            : selfApproval
              ? "You saved this revision; another Owner/Admin must approve it."
              : ""

  function patchProfile(updater: (current: any) => any) {
    setSavedMessage("")
    setDirty(true)
    setProfile(updater)
  }

  function updateRow(index: number, patch: Record<string, any>) {
    patchProfile((current: any) => ({
      ...current,
      parameters: (current.parameters || []).map((row: any, rowIndex: number) => (rowIndex === index ? { ...row, ...patch } : row)),
    }))
  }

  function removeRow(index: number) {
    const row = parameters[index]
    if (!window.confirm(`Remove ${row?.label || row?.code || "this parameter"} from the profile?`)) return
    patchProfile((current: any) => ({
      ...current,
      parameters: (current.parameters || []).filter((_: any, rowIndex: number) => rowIndex !== index),
    }))
    setBands({})
  }

  function applyBand(index: number) {
    const band = bands[index]
    const nominal = Number(band?.nominal)
    const tolerance = Number(band?.tolerance)
    if (!Number.isFinite(nominal) || !Number.isFinite(tolerance) || tolerance < 0 || String(band?.nominal ?? "").trim() === "") {
      setFormError("Enter a nominal value and a ± tolerance of 0 or more.")
      return
    }
    setFormError("")
    const round = (value: number) => Math.round(value * 1000) / 1000
    updateRow(index, { min: round(nominal - tolerance), max: round(nominal + tolerance) })
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
          const status = blockers.length ? "draft" : "complete"
          await onSave({ ...profile, status, setup_status: status })
          setDirty(false)
          setSavedMessage(
            blockers.length
              ? "Saved as draft. Complete the items listed before it can be approved."
              : "Saved and ready for Owner/Admin approval.",
          )
        } catch (error: any) {
          const detail = error?.response?.data?.detail
          setFormError(typeof detail === "string" ? detail : detail?.message || error?.message || "Quality profile could not be saved.")
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        One row per check. For a measured value, enter the nominal and ± tolerance (or min/max directly). Critical checks cannot be waived
        after failure. Existing lots keep the revision they were received under.
      </p>
      {masterNominals.length ? (
        <p className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="item-qc-master-nominals">
          Master nominal: {masterNominals.map((row) => `${row.label} ${row.value}${row.unit ? ` ${row.unit}` : ""}`).join(" · ")}
        </p>
      ) : null}
      {parameters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No checks yet. Copy the category template or add a parameter.
        </p>
      ) : null}
      <div className="space-y-3">
        {parameters.map((row: any, index: number) => {
          const inputType = ["select", "categorical", "enum", "boolean"].includes(String(row.input_type)) ? "select" : row.input_type === "text" ? "text" : "number"
          const notApplicable = row.applicable === false
          const mismatch = mismatches.find((entry) => entry.index === index)
          const name = row.label || row.code || "parameter"
          return (
            <div
              key={`row-${index}`}
              data-testid={`item-qc-row-${index}`}
              className={`rounded-2xl border p-3 ${mismatch ? "border-signal-amber-line bg-signal-amber-soft/40" : "border-border bg-card"}`}
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.6fr)_auto]">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Code</span>
                  <input aria-label={`Code for ${name}`} className="h-10 w-full rounded-lg border border-border px-2" value={row.code || ""} onChange={(event) => updateRow(index, { code: event.target.value.trim().toLowerCase().replace(/\s+/g, "_") })} />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Label</span>
                  <input aria-label={`Label for ${name}`} className="h-10 w-full rounded-lg border border-border px-2" value={row.label || ""} onChange={(event) => updateRow(index, { label: event.target.value })} />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Check type</span>
                  <select
                    aria-label={`Check type for ${name}`}
                    data-testid={`item-qc-type-${index}`}
                    className="h-10 w-full rounded-lg border border-border bg-card px-2"
                    value={inputType}
                    onChange={(event) => {
                      const next = event.target.value
                      updateRow(index, {
                        input_type: next,
                        options: next === "select" ? (Array.isArray(row.options) && row.options.length ? row.options : PASS_FAIL_OPTIONS) : [],
                        ...(next === "number" ? {} : { min: null, max: null }),
                      })
                    }}
                  >
                    {CHECK_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Unit</span>
                  <input aria-label={`Unit for ${name}`} disabled={inputType !== "number"} className="h-10 w-full rounded-lg border border-border px-2 disabled:opacity-50" value={row.unit || ""} onChange={(event) => updateRow(index, { unit: event.target.value })} />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    data-testid={`item-qc-remove-${index}`}
                    onClick={() => removeRow(index)}
                    className="h-10 rounded-lg border border-signal-rose-line px-3 text-xs font-semibold text-signal-rose-ink"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {inputType === "number" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_auto_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)]">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Nominal</span>
                    <input
                      aria-label={`Nominal for ${name}`}
                      data-testid={`item-qc-nominal-${index}`}
                      type="number"
                      step="0.001"
                      disabled={notApplicable}
                      className="h-10 w-full rounded-lg border border-border px-2"
                      value={bands[index]?.nominal ?? ""}
                      placeholder={row.min != null && row.max != null ? String(Math.round(((Number(row.min) + Number(row.max)) / 2) * 1000) / 1000) : ""}
                      onChange={(event) => setBands((current) => ({ ...current, [index]: { nominal: event.target.value, tolerance: current[index]?.tolerance ?? "" } }))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">± Tolerance</span>
                    <input
                      aria-label={`Tolerance for ${name}`}
                      data-testid={`item-qc-tolerance-${index}`}
                      type="number"
                      step="0.001"
                      min={0}
                      disabled={notApplicable}
                      className="h-10 w-full rounded-lg border border-border px-2"
                      value={bands[index]?.tolerance ?? ""}
                      placeholder={row.min != null && row.max != null ? String(Math.round(((Number(row.max) - Number(row.min)) / 2) * 1000) / 1000) : ""}
                      onChange={(event) => setBands((current) => ({ ...current, [index]: { nominal: current[index]?.nominal ?? "", tolerance: event.target.value } }))}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      data-testid={`item-qc-apply-band-${index}`}
                      disabled={notApplicable}
                      onClick={() => applyBand(index)}
                      className="h-10 rounded-lg border border-border px-3 text-xs font-semibold text-foreground disabled:opacity-50"
                    >
                      Set min/max
                    </button>
                  </div>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Min</span>
                    <input aria-label={`Minimum for ${name}`} data-testid={`item-qc-min-${index}`} type="number" step="0.001" disabled={notApplicable} className="h-10 w-full rounded-lg border border-border px-2" value={row.min ?? ""} onChange={(event) => updateRow(index, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Max</span>
                    <input aria-label={`Maximum for ${name}`} data-testid={`item-qc-max-${index}`} type="number" step="0.001" disabled={notApplicable} className="h-10 w-full rounded-lg border border-border px-2" value={row.max ?? ""} onChange={(event) => updateRow(index, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Test method</span>
                    <input aria-label={`Method for ${name}`} className="h-10 w-full rounded-lg border border-border px-2" value={row.method || ""} placeholder="e.g. GSM cutter + balance" onChange={(event) => updateRow(index, { method: event.target.value })} />
                  </label>
                </div>
              ) : inputType === "select" ? (
                <label className="mt-2 block space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Accepted outcomes (comma separated; NG / NOT OK / FAIL count as failing)</span>
                  <input
                    aria-label={`Outcomes for ${name}`}
                    data-testid={`item-qc-options-${index}`}
                    className="h-10 w-full rounded-lg border border-border px-2"
                    value={(Array.isArray(row.options) ? row.options : []).join(", ")}
                    onChange={(event) =>
                      updateRow(index, {
                        options: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Recorded as a note on the inspection; it does not decide PASS or FAIL.</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-foreground">
                <label className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={row.applicable !== false} onChange={(event) => updateRow(index, { applicable: event.target.checked })} />
                  Applies to this material
                </label>
                <label className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={row.required !== false} disabled={notApplicable} onChange={(event) => updateRow(index, { required: event.target.checked })} />
                  Reading required
                </label>
                <label className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={row.requires_instrument === true} disabled={notApplicable} onChange={(event) => updateRow(index, { requires_instrument: event.target.checked })} />
                  Calibrated instrument
                </label>
                <label className="flex min-h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.non_waivable === true}
                    disabled={notApplicable}
                    aria-label={`Critical non-waivable check: ${name}`}
                    onChange={(event) => updateRow(index, { non_waivable: event.target.checked })}
                  />
                  Critical: cannot be waived
                </label>
                <span className="text-muted-foreground" data-testid={`item-qc-rule-${index}`}>
                  {inputType === "number" ? formatAllowedRange(row) : inputType === "select" ? `Accepts ${(row.options || []).join(" / ") || "—"}` : "Note"}
                </span>
              </div>
              {mismatch ? (
                <p className="mt-2 text-xs font-semibold text-signal-amber-ink" data-testid={`item-qc-nominal-warning-${index}`}>
                  Master {mismatch.label} is {mismatch.value}
                  {mismatch.unit ? ` ${mismatch.unit}` : ""}, outside this band. Check the band or the master before approving.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      {blockers.length ? (
        <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft p-3 text-xs text-signal-amber-ink" data-testid="item-qc-blockers">
          <p className="font-semibold">Before this profile can be approved:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {blockers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {formError ? <p role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink">{formError}</p> : null}
      {savedMessage ? <p role="status" className="text-sm text-muted-foreground">{savedMessage}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="item-qc-add-row"
          onClick={() => patchProfile((current: any) => ({ ...current, parameters: [...(current.parameters || []), blankRow()] }))}
          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground"
        >
          Add parameter
        </button>
        <button
          type="button"
          disabled={saving || !item || !onCopyTemplate}
          onClick={() => {
            if (parameters.length && !window.confirm("Copying the category template replaces the current draft rows. Continue?")) return
            void onCopyTemplate?.()
          }}
          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground disabled:opacity-50"
        >
          Copy category template
        </button>
        <button type="submit" disabled={saving || !item} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Save item QC profile
        </button>
        {onApprove ? (
          <button
            type="button"
            data-testid="item-qc-approve"
            disabled={saving || Boolean(approveDisabledReason)}
            title={approveDisabledReason || undefined}
            onClick={async () => {
              if (mismatches.length && !window.confirm(`${mismatches.length} band(s) do not contain the master nominal. Approve anyway?`)) return
              setFormError("")
              try {
                await onApprove(false)
                setSavedMessage("Approved. New receipts of this material will be checked against this revision.")
              } catch (error: any) {
                const detail = error?.response?.data?.detail
                setFormError(typeof detail === "string" ? detail : detail?.message || error?.message || "Could not approve the profile.")
              }
            }}
            className="rounded-xl border border-foreground/80 px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            Approve profile
          </button>
        ) : null}
        {allowExemption && onApprove ? (
          <button
            type="button"
            disabled={saving || !item || dirty || selfApproval}
            onClick={async () => {
              if (!window.confirm("Approve a no-inspection exemption? Receipts of this material will skip incoming QC.")) return
              try {
                await onApprove(true)
              } catch (error: any) {
                const detail = error?.response?.data?.detail
                setFormError(typeof detail === "string" ? detail : detail?.message || error?.message || "Could not approve the exemption.")
              }
            }}
            className="rounded-xl border border-signal-amber-ink/40 px-3 py-2 text-sm font-semibold text-signal-amber-ink disabled:opacity-50"
          >
            Approve exemption
          </button>
        ) : null}
      </div>
      {onApprove && approveDisabledReason && item?.quality_profile ? (
        <p className="text-xs text-muted-foreground" data-testid="item-qc-approve-hint">{approveDisabledReason}</p>
      ) : null}
    </form>
  )
}
