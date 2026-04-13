"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { SpecEditorNotch } from "./spec-sheet-utils"

type NotchDiagramPanelProps = {
  value: SpecEditorNotch
  readOnly?: boolean
  onChange?: (patch: Partial<SpecEditorNotch>) => void
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={readOnly}
        className="h-10 rounded-2xl border-slate-200 bg-white/80 text-sm"
      />
    </label>
  )
}

export function NotchDiagramPanel({ value, readOnly, onChange }: NotchDiagramPanelProps) {
  const depth = Number(value.notch_depth_mm || 0)
  const distance = Number(value.notch_distance_mm || 0)
  const notchActive = Boolean(value.notch_required)
  const position = String(value.notch_position || "Top").toLowerCase()
  const notchStyle =
    position === "left"
      ? { left: "20%", top: "50%", transform: "translate(-50%, -50%)" }
      : position === "right"
        ? { left: "80%", top: "50%", transform: "translate(-50%, -50%)" }
        : { left: "50%", top: "20%", transform: "translate(-50%, -50%)" }

  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-slate-200/70 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Notch Tooling</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Diagram and setup cues</h3>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={value.notch_required}
              onChange={(event) => onChange?.({ notch_required: event.target.checked })}
              disabled={readOnly}
              className="h-4 w-4 rounded border-slate-300"
            />
            Notch required
          </label>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.04),transparent_58%),linear-gradient(135deg,#eff6ff,#f8fafc_48%,#fff7ed)] p-6">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span>Tube Face</span>
            <span>{value.notch_type || "Single notch"}</span>
          </div>
          <div className="relative mt-6 h-44 rounded-[36px] border border-dashed border-slate-300/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="absolute inset-4 rounded-[28px] border border-slate-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(226,232,240,0.75))]" />
            <div className="absolute inset-x-8 top-1/2 h-[1px] -translate-y-1/2 bg-slate-200" />
            <div className="absolute left-1/2 top-7 h-24 w-[1px] -translate-x-1/2 bg-slate-200" />
            <div
              className={cn(
                "absolute h-10 w-10 rounded-full border-2 transition",
                notchActive ? "border-cyan-600 bg-cyan-100 shadow-lg" : "border-slate-300 bg-white/80",
              )}
              style={notchStyle}
            />
            <div
              className={cn(
                "absolute rounded-full px-2 py-1 text-[10px] font-semibold shadow-sm",
                notchActive ? "bg-slate-900 text-white" : "bg-white text-slate-400",
              )}
              style={{
                left: "50%",
                bottom: "12%",
                transform: "translateX(-50%)",
              }}
            >
              {notchActive ? `${depth || 0} mm depth · ${distance || 0} mm from edge` : "No notch configured"}
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Position</p>
              <p className="mt-1 font-medium text-slate-900">{value.notch_position || "Top"}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Tube Direction</p>
              <p className="mt-1 font-medium text-slate-900">{value.tube_direction || "Standard"}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Top Paper</p>
              <p className="mt-1 font-medium text-slate-900">{value.top_paper_required ? "Required" : "Not required"}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Notch Type</span>
            <select
              value={value.notch_type}
              onChange={(event) => onChange?.({ notch_type: event.target.value })}
              disabled={readOnly}
              className="h-10 rounded-2xl border border-slate-200 bg-white/80 px-3 text-sm text-slate-800"
            >
              <option value="Single">Single</option>
              <option value="Double">Double</option>
              <option value="Slot">Slot</option>
              <option value="Punch">Punch</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Notch Position</span>
            <select
              value={value.notch_position}
              onChange={(event) => onChange?.({ notch_position: event.target.value })}
              disabled={readOnly}
              className="h-10 rounded-2xl border border-slate-200 bg-white/80 px-3 text-sm text-slate-800"
            >
              <option value="Top">Top</option>
              <option value="Left">Left</option>
              <option value="Right">Right</option>
            </select>
          </label>

          <Field
            label="Distance From Edge"
            value={value.notch_distance_mm}
            onChange={(next) => onChange?.({ notch_distance_mm: next })}
            readOnly={readOnly}
          />
          <Field
            label="Notch Depth"
            value={value.notch_depth_mm}
            onChange={(next) => onChange?.({ notch_depth_mm: next })}
            readOnly={readOnly}
          />
          <Field
            label="Holder"
            value={value.notching_holder}
            onChange={(next) => onChange?.({ notching_holder: next })}
            readOnly={readOnly}
          />
          <Field
            label="Blade"
            value={value.notching_blade}
            onChange={(next) => onChange?.({ notching_blade: next })}
            readOnly={readOnly}
          />
          <Field
            label="Punch"
            value={value.punch}
            onChange={(next) => onChange?.({ punch: next })}
            readOnly={readOnly}
          />
          <Field
            label="Die"
            value={value.die}
            onChange={(next) => onChange?.({ die: next })}
            readOnly={readOnly}
          />
        </div>
      </div>
    </section>
  )
}
