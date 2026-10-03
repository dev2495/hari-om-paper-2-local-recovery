"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useApp } from "@/context/AppContext"
import { productionApi } from "@/lib/api"

export type QcInstrument = {
  id: string
  code: string
  name: string
  instrument_type?: string | null
  calibration_due?: string | null
  certificate_ref?: string | null
  active: boolean
  calibration_status: "valid" | "due_soon" | "expired"
}

export function useQcInstruments(plantId?: string) {
  return useQuery({
    queryKey: ["qc-instruments", plantId || ""],
    enabled: Boolean(plantId),
    queryFn: async () => {
      const { data } = await productionApi.getQcInstruments(plantId)
      return (Array.isArray(data?.items) ? data.items : []) as QcInstrument[]
    },
  })
}

const STATUS_TONE: Record<string, string> = {
  valid: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  due_soon: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
  expired: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
}

const EMPTY = { code: "", name: "", instrument_type: "", calibration_due: "", certificate_ref: "", active: true }

/** Plant register of calibrated instruments; stage checks that need an instrument read calibration from here. */
export function InstrumentRegister({ plantId, canEdit }: { plantId?: string; canEdit: boolean }) {
  const { showToast } = useApp()
  const queryClient = useQueryClient()
  const instruments = useQcInstruments(plantId)
  const [form, setForm] = useState(EMPTY)
  const save = useMutation({
    mutationFn: (data: any) => productionApi.upsertQcInstrument(data, plantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qc-instruments"] }),
  })
  const rows = instruments.data || []
  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast("Instrument ID and name are required.", "error")
      return
    }
    try {
      await save.mutateAsync({
        code: form.code.trim(),
        name: form.name.trim(),
        instrument_type: form.instrument_type.trim() || undefined,
        calibration_due: form.calibration_due || undefined,
        certificate_ref: form.certificate_ref.trim() || undefined,
        active: form.active,
      })
      setForm(EMPTY)
      showToast("Instrument saved.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      showToast(typeof detail === "string" ? detail : detail?.message || "Instrument could not be saved.", "error")
    }
  }
  if (!plantId) return <p className="text-sm text-muted-foreground">Pick one plant to see its instruments.</p>
  return (
    <div className="space-y-3" data-testid="instrument-register">
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-muted text-[11.5px] font-semibold text-muted-foreground">
              <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Instrument</th><th className="px-3 py-2">Calibration due</th><th className="px-3 py-2">Certificate</th><th className="px-3 py-2">Status</th>{canEdit ? <th /> : null}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b border-border last:border-0 ${row.active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2 font-semibold">{row.code}</td>
                  <td className="px-3 py-2">{row.name}{row.instrument_type ? ` · ${row.instrument_type}` : ""}</td>
                  <td className="px-3 py-2">{row.calibration_due || "—"}</td>
                  <td className="px-3 py-2">{row.certificate_ref || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[row.calibration_status] || ""}`}>
                      {row.active ? row.calibration_status.replace("_", " ") : "inactive"}
                    </span>
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary"
                        onClick={() =>
                          setForm({
                            code: row.code,
                            name: row.name,
                            instrument_type: row.instrument_type || "",
                            calibration_due: row.calibration_due || "",
                            certificate_ref: row.certificate_ref || "",
                            active: row.active,
                          })
                        }
                      >
                        Edit
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No instruments registered. Until the first one is added, instrument-required checks accept the calibration details typed on the form.
        </p>
      )}
      {canEdit ? (
        <div className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-6">
          <input className="h-10 rounded-xl border border-border px-3 text-sm" placeholder="ID (e.g. VC-01)" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
          <input className="h-10 rounded-xl border border-border px-3 text-sm md:col-span-2" placeholder="Name (e.g. Vernier 150 mm)" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <input className="h-10 rounded-xl border border-border px-3 text-sm" placeholder="Type" value={form.instrument_type} onChange={(event) => setForm((current) => ({ ...current, instrument_type: event.target.value }))} />
          <input className="h-10 rounded-xl border border-border px-3 text-sm" type="date" title="Calibration due" value={form.calibration_due} onChange={(event) => setForm((current) => ({ ...current, calibration_due: event.target.value }))} />
          <input className="h-10 rounded-xl border border-border px-3 text-sm" placeholder="Certificate no." value={form.certificate_ref} onChange={(event) => setForm((current) => ({ ...current, certificate_ref: event.target.value }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Active
          </label>
          <button type="button" disabled={save.isPending} onClick={() => void submit()} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60 md:col-start-6">
            Save instrument
          </button>
        </div>
      ) : null}
    </div>
  )
}
