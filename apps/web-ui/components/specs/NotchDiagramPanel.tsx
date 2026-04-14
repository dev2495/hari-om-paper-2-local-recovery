"use client"

import { useMemo } from "react"

import { useTools } from "@/hooks/use-master-data"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { SpecEditorNotch } from "./spec-sheet-utils"

type NotchDiagramPanelProps = {
  value: SpecEditorNotch
  readOnly?: boolean
  onChange?: (patch: Partial<SpecEditorNotch>) => void
}

type ToolRecord = {
  id?: string | number
  category?: string
  code?: string
  name?: string
  spec_text?: string
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

function ToolSelect({
  label,
  value,
  onChange,
  options,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ToolRecord[]
  readOnly?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</span>
      <select
        value={value || "__NONE__"}
        onChange={(event) => onChange(event.target.value === "__NONE__" ? "" : event.target.value)}
        disabled={readOnly}
        className="h-10 rounded-2xl border border-slate-200 bg-white/80 px-3 text-sm text-slate-800"
      >
        <option value="__NONE__">Select {label.toLowerCase()}</option>
        {options.map((option) => {
          const line = [option.code, option.name].filter(Boolean).join(" · ")
          return (
            <option key={String(option.id || line)} value={String(option.code || option.name || "")}>
              {line || option.spec_text || "Tool"}
            </option>
          )
        })}
      </select>
    </label>
  )
}

function DiagramBadge({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  )
}

export function NotchDiagramPanel({ value, readOnly, onChange }: NotchDiagramPanelProps) {
  const { data: toolRows = [] } = useTools()

  const tools = useMemo(() => (Array.isArray(toolRows) ? toolRows : []), [toolRows])
  const groupedTools = useMemo(() => {
    const group = (category: string) =>
      tools.filter((row: ToolRecord) => String(row.category || "").toUpperCase() === category)

    return {
      holder: group("NOTCHING_HOLDER"),
      blade: group("NOTCHING_BLADE"),
      groove: group("GROOVE"),
      punch: group("PUNCH"),
      die: group("DIE"),
      tochha: group("TOCHHA"),
      widerTool: group("WIDER_TOOL"),
    }
  }, [tools])

  const selectedMeta = useMemo(() => {
    const pick = (categoryOptions: ToolRecord[], current: string) =>
      categoryOptions.find((option) => String(option.code || option.name || "") === String(current || ""))

    return {
      holder: pick(groupedTools.holder, value.notching_holder),
      blade: pick(groupedTools.blade, value.notching_blade),
      groove: pick(groupedTools.groove, value.groove),
      punch: pick(groupedTools.punch, value.punch),
      die: pick(groupedTools.die, value.die),
      tochha: pick(groupedTools.tochha, value.tochha),
      widerTool: pick(groupedTools.widerTool, value.wider_tool),
    }
  }, [groupedTools, value.die, value.groove, value.notching_blade, value.notching_holder, value.punch, value.tochha, value.wider_tool])

  const depth = Number(value.notch_depth_mm || 0)
  const distance = Number(value.notch_distance_mm || 0)
  const notchActive = Boolean(value.notch_required)
  const position = String(value.notch_position || "Top").toLowerCase()
  const isDouble = String(value.notch_type || "").toLowerCase() === "double"
  const isSlot = String(value.notch_type || "").toLowerCase() === "slot"
  const isPunch = String(value.notch_type || "").toLowerCase() === "punch"

  const primaryNotchStyle =
    position === "left"
      ? { left: "18%", top: "50%", transform: "translate(-50%, -50%)" }
      : position === "right"
        ? { left: "82%", top: "50%", transform: "translate(-50%, -50%)" }
        : { left: "50%", top: "18%", transform: "translate(-50%, -50%)" }

  const secondaryNotchStyle =
    position === "left"
      ? { left: "18%", top: "30%", transform: "translate(-50%, -50%)" }
      : position === "right"
        ? { left: "82%", top: "30%", transform: "translate(-50%, -50%)" }
        : { left: "64%", top: "18%", transform: "translate(-50%, -50%)" }

  const selectedConnections = [
    selectedMeta.holder?.code || value.notching_holder,
    selectedMeta.blade?.code || value.notching_blade,
    selectedMeta.groove?.code || value.groove,
    selectedMeta.punch?.code || value.punch,
    selectedMeta.tochha?.code || value.tochha,
    selectedMeta.widerTool?.code || value.wider_tool,
    selectedMeta.die?.code || value.die,
  ].filter(Boolean)

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

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.05),transparent_58%),linear-gradient(135deg,#eff6ff,#f8fafc_48%,#fff7ed)] p-6">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span>Tube Face</span>
            <span>{value.notch_type || "Single notch"}</span>
          </div>
          <div className="relative mt-6 h-52 rounded-[36px] border border-dashed border-slate-300/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="absolute inset-4 rounded-[28px] border border-slate-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(226,232,240,0.75))]" />
            <div className="absolute inset-x-8 top-1/2 h-[1px] -translate-y-1/2 bg-slate-200" />
            <div className="absolute left-1/2 top-7 h-28 w-[1px] -translate-x-1/2 bg-slate-200" />
            <div
              className={cn(
                "absolute transition",
                isSlot ? "h-7 w-16 rounded-full" : "h-10 w-10 rounded-full",
                notchActive ? "border-2 border-cyan-600 bg-cyan-100 shadow-lg" : "border-2 border-slate-300 bg-white/80",
                isPunch ? "ring-4 ring-cyan-100" : "",
              )}
              style={primaryNotchStyle}
            />
            {isDouble ? (
              <div
                className={cn(
                  "absolute h-10 w-10 rounded-full border-2 transition",
                  notchActive ? "border-cyan-600 bg-cyan-100 shadow-lg" : "border-slate-300 bg-white/80",
                )}
                style={secondaryNotchStyle}
              />
            ) : null}
            <div className="absolute left-1/2 top-[22%] w-[42%] -translate-x-1/2 border-t border-dashed border-cyan-300/90" />
            <div className="absolute left-[11%] top-1/2 w-[14%] -translate-y-1/2 border-t border-dashed border-slate-300/90" />
            <div className="absolute right-[11%] top-1/2 w-[14%] -translate-y-1/2 border-t border-dashed border-slate-300/90" />
            <div
              className={cn(
                "absolute rounded-full px-2 py-1 text-[10px] font-semibold shadow-sm",
                notchActive ? "bg-slate-900 text-white" : "bg-white text-slate-400",
              )}
              style={{ left: "50%", bottom: "10%", transform: "translateX(-50%)" }}
            >
              {notchActive ? `${depth || 0} mm depth · ${distance || 0} mm from edge` : "No notch configured"}
            </div>
            {selectedConnections.length > 0 ? (
              <div className="absolute right-4 top-4 max-w-[42%] rounded-2xl border border-cyan-100 bg-white/85 px-3 py-2 text-[11px] text-slate-600 shadow-sm">
                <p className="font-semibold uppercase tracking-[0.18em] text-cyan-700">Linked tooling</p>
                <p className="mt-1 leading-5">{selectedConnections.join(" · ")}</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-4">
            <DiagramBadge label="Position" value={value.notch_position || "Top"} />
            <DiagramBadge label="Tube Direction" value={value.tube_direction || "Standard"} />
            <DiagramBadge label="Top Paper" value={value.top_paper_required ? "Required" : "Not required"} />
            <DiagramBadge label="Tochha Type" value={value.tochha_type || "Standard"} />
          </div>
        </div>

        <div className="grid gap-3">
          {!notchActive ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              Keep this off until the spec truly needs a notch. When enabled, holder, blade, groove, and die stay linked to the diagram so setup can move from sheet to job-card without retyping.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ToolSelect
              label="Holder"
              value={value.notching_holder}
              onChange={(next) => onChange?.({ notching_holder: next })}
              options={groupedTools.holder}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Blade"
              value={value.notching_blade}
              onChange={(next) => onChange?.({ notching_blade: next })}
              options={groupedTools.blade}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Groove"
              value={value.groove}
              onChange={(next) => onChange?.({ groove: next })}
              options={groupedTools.groove}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Punch"
              value={value.punch}
              onChange={(next) => onChange?.({ punch: next })}
              options={groupedTools.punch}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Tochha"
              value={value.tochha}
              onChange={(next) => onChange?.({ tochha: next })}
              options={groupedTools.tochha}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Wider Tool"
              value={value.wider_tool}
              onChange={(next) => onChange?.({ wider_tool: next })}
              options={groupedTools.widerTool}
              readOnly={readOnly}
            />
            <ToolSelect
              label="Die"
              value={value.die}
              onChange={(next) => onChange?.({ die: next })}
              options={groupedTools.die}
              readOnly={readOnly}
            />
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Tube Direction</span>
              <select
                value={value.tube_direction}
                onChange={(event) => onChange?.({ tube_direction: event.target.value })}
                disabled={readOnly}
                className="h-10 rounded-2xl border border-slate-200 bg-white/80 px-3 text-sm text-slate-800"
              >
                <option value="Standard">Standard</option>
                <option value="Reverse">Reverse</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Tochha Type</span>
              <select
                value={value.tochha_type || "__NONE__"}
                onChange={(event) => onChange?.({ tochha_type: event.target.value === "__NONE__" ? "" : event.target.value })}
                disabled={readOnly}
                className="h-10 rounded-2xl border border-slate-200 bg-white/80 px-3 text-sm text-slate-800"
              >
                <option value="__NONE__">Select tochha type</option>
                <option value="Standard">Standard</option>
                <option value="Deep">Deep</option>
                <option value="Heavy">Heavy</option>
              </select>
            </label>
            <Field
              label="Height Gauge Go"
              value={value.height_gauge_go}
              onChange={(next) => onChange?.({ height_gauge_go: next })}
              readOnly={readOnly}
            />
            <Field
              label="Height Gauge No-Go"
              value={value.height_gauge_no_go}
              onChange={(next) => onChange?.({ height_gauge_no_go: next })}
              readOnly={readOnly}
            />
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={value.top_paper_required}
                onChange={(event) => onChange?.({ top_paper_required: event.target.checked })}
                disabled={readOnly}
                className="h-4 w-4 rounded border-slate-300"
              />
              Top paper required
            </label>
          </div>

          {(selectedMeta.holder?.spec_text ||
            selectedMeta.blade?.spec_text ||
            selectedMeta.groove?.spec_text ||
            selectedMeta.punch?.spec_text ||
            selectedMeta.die?.spec_text) ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Master notes</p>
              <div className="mt-3 space-y-2">
                {[selectedMeta.holder, selectedMeta.blade, selectedMeta.groove, selectedMeta.punch, selectedMeta.die]
                  .filter((tool): tool is ToolRecord => Boolean(tool?.spec_text))
                  .map((tool) => (
                    <p key={String(tool.code || tool.name)}>
                      <span className="font-medium text-slate-900">{tool.code || tool.name}:</span> {tool.spec_text}
                    </p>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
