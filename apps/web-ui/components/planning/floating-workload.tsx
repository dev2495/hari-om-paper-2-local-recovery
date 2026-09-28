"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { createPortal } from "react-dom"
import { BarChart3, ChevronDown, Grip, RotateCcw, X } from "lucide-react"
import { clampWorkloadPosition, summarizeWorkload, workloadUnit, type WorkloadGrouping, type WorkloadJob } from "@/lib/planner-workload"
import { cn } from "@/lib/utils"

const fmt = (n: number, decimals = 0) => n.toLocaleString("en-IN", { maximumFractionDigits: decimals })
export function FloatingWorkload({ jobs, stage, scope, machineLabel, selected, grouping, onGrouping, onSelect, refreshing = false }: {
  jobs: WorkloadJob[]; stage: string; scope: string; machineLabel: (id: string) => string
  selected: string | null; grouping: WorkloadGrouping; onGrouping: (value: WorkloadGrouping) => void; onSelect: (value: string | null) => void; refreshing?: boolean
}) {
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; origin: { x: number; y: number } } | null>(null)
  const position = useRef({ x: 0, y: 160 })
  const frame = useRef<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [measure, setMeasure] = useState<"load" | "pcs">("load")
  const [search, setSearch] = useState("")
  const key = `planner-workload:v1:${scope}:${stage}`
  const unit = workloadUnit(stage)
  const title = `${stage.charAt(0).toUpperCase()}${stage.slice(1).toLowerCase()} queue`
  const rows = useMemo(() => summarizeWorkload(jobs, stage, grouping, machineLabel), [jobs, stage, grouping, machineLabel])
  const totals = rows.reduce((t, row) => ({ parts: t.parts + row.parts, pcs: t.pcs + row.pcs, load: t.load + row.load, unknown: t.unknown + row.unknown }), { parts: 0, pcs: 0, load: 0, unknown: 0 })
  const max = Math.max(1, ...rows.map(row => measure === "pcs" ? row.pcs : row.load))
  const visible = rows.filter(row => row.label.toLowerCase().includes(search.trim().toLowerCase()))
  const selectedLabel = selected ? (rows.find(row => row.id === selected)?.label || (selected === "unassigned" ? "Unassigned" : machineLabel(selected))) : null

  const place = useCallback((next: { x: number; y: number }, save = false) => {
    if (!panel.current) return
    const box = panel.current.getBoundingClientRect()
    position.current = clampWorkloadPosition(next, { width: window.innerWidth, height: window.innerHeight }, box)
    panel.current.style.left = `${position.current.x}px`
    panel.current.style.top = `${position.current.y}px`
    if (save) { try { localStorage.setItem(key, JSON.stringify(position.current)) } catch { /* Preferences may be disabled. */ } }
  }, [key])
  const reset = () => place({ x: window.innerWidth - 398, y: 160 }, true)
  useEffect(() => { setMounted(true) }, [])
  useLayoutEffect(() => {
    if (!mounted) return
    let saved = { x: window.innerWidth - 398, y: 160 }
    try { const stored = JSON.parse(localStorage.getItem(key) || "null"); if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) saved = stored } catch { /* Start at the default corner. */ }
    place(saved)
    const keepVisible = () => place(position.current)
    const observer = new ResizeObserver(keepVisible)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener("resize", keepVisible)
    return () => { observer.disconnect(); window.removeEventListener("resize", keepVisible); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [mounted, key, place])
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.id) return
    const next = { x: active.origin.x + event.clientX - active.x, y: active.origin.y + event.clientY - active.y }
    position.current = next
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { frame.current = null; place(next) })
  }
  const finish = () => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    drag.current = null
    panel.current?.removeAttribute("data-dragging")
    place(position.current, true)
  }
  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (event.key === "Home") { event.preventDefault(); reset(); return }
    if (!delta[event.key]) return
    event.preventDefault()
    const [x, y] = delta[event.key]; const step = event.shiftKey ? 48 : 16
    place({ x: position.current.x + x * step, y: position.current.y + y * step }, true)
  }
  if (!mounted) return null
  return createPortal(
    <aside ref={panel} className="planner-workload-panel print:hidden" aria-label={`${title} workload`} data-testid="planner-workload" data-collapsed={collapsed}>
      <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button type="button" className="flex min-w-0 flex-1 touch-none select-none items-center gap-2 rounded-lg px-1.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing" aria-label={`Move ${title} panel`} title="Drag to move. Arrow keys move; Shift moves further; Home resets."
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position.current } }; panel.current?.setAttribute("data-dragging", "true") }}
          onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyboardMove}>
          <Grip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><BarChart3 className="h-4 w-4" /></span>
          <span className="min-w-0"><strong className="block truncate text-[13px]">{title}</strong><span className="block text-[10px] text-muted-foreground">{collapsed ? `${fmt(totals.parts)} parts · ${fmt(totals.pcs)} pcs` : "Drag this header · click a bar to filter"}</span></span>
        </button>
        <button type="button" onClick={reset} className="tube-icon-button !h-8 !w-8" aria-label="Reset workload panel position" title="Reset position"><RotateCcw size={13} /></button>
        <button type="button" onClick={() => setCollapsed(value => !value)} className="tube-icon-button !h-8 !w-8" aria-expanded={!collapsed} aria-label={collapsed ? "Expand workload panel" : "Minimize workload panel"}><ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", !collapsed && "rotate-180")} /></button>
      </header>
      {selectedLabel ? <button type="button" onClick={() => onSelect(null)} className="mx-3 my-2 flex w-[calc(100%-1.5rem)] items-center justify-between gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary" aria-label="Clear workload queue filter"><span>Queue: {selectedLabel}</span><X size={14} /></button> : null}
      {!collapsed ? <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
        <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-muted/30 py-2.5 text-center">
          <div><strong className="block text-lg tabular-nums">{fmt(totals.parts)}</strong><span className="text-[10px] text-muted-foreground">Queue parts</span></div>
          <div><strong className="block text-lg tabular-nums">{fmt(totals.pcs)}</strong><span className="text-[10px] text-muted-foreground">Pieces</span></div>
          <div><strong className="block text-lg tabular-nums">{fmt(totals.load, unit === "m" ? 1 : 0)}{totals.unknown ? "+" : ""}</strong><span className="text-[10px] text-muted-foreground">{unit} {totals.unknown ? "known" : "queued"}</span></div>
        </div>
        <div className="my-3 flex flex-wrap items-center justify-between gap-2">
          <select aria-label="Group workload by" value={grouping} onChange={event => { onSelect(null); onGrouping(event.target.value as WorkloadGrouping) }} className="h-8 min-w-0 rounded-lg border border-input bg-card px-2 text-xs">
            <option value="release">Release winder</option><option value="machine">{stage === "WINDER" ? "Planned machine" : `${title.replace(" queue", "")} machine`}</option>
          </select>
          {unit !== "pcs" ? <div className="tube-segment !h-8 text-xs" role="group" aria-label="Workload bar measure"><button type="button" aria-pressed={measure === "load"} onClick={() => setMeasure("load")}>{unit}</button><button type="button" aria-pressed={measure === "pcs"} onClick={() => setMeasure("pcs")}>pcs</button></div> : null}
        </div>
        {rows.length > 6 ? <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Find workload machine" placeholder="Find machine…" className="mb-2 h-8 w-full rounded-lg border border-input bg-card px-2 text-xs" /> : null}
        <div className="space-y-1.5" aria-busy={refreshing}>
          {visible.map(row => <button type="button" key={row.id} disabled={refreshing} data-testid={`workload-bar:${row.id}`} aria-pressed={selected === row.id} onClick={() => onSelect(selected === row.id ? null : row.id)} className={cn("w-full rounded-xl border px-2.5 py-2 text-left transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring", selected === row.id ? "border-primary bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/50", selected && selected !== row.id && "opacity-60")}>
            <span className="flex items-baseline justify-between gap-3 text-xs"><strong className="truncate">{row.label}</strong><span className="shrink-0 font-semibold tabular-nums">{fmt(measure === "pcs" ? row.pcs : row.load, measure === "load" && unit === "m" ? 1 : 0)} {measure === "pcs" ? "pcs" : unit}{measure === "load" && row.unknown ? "+" : ""}</span></span>
            <span className="my-1.5 block h-2.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${100 * (measure === "pcs" ? row.pcs : row.load) / max}%` }} /></span>
            <span className="flex flex-wrap justify-between gap-x-2 text-[10px] text-muted-foreground"><span>{fmt(row.parts)} {row.parts === 1 ? "part" : "parts"} · {fmt(row.cards)} {row.cards === 1 ? "card" : "cards"} · {fmt(row.pcs)} pcs</span><span>{row.waiting ? `${row.ready} ready · ${row.waiting} upstream` : "Ready to plan"}</span></span>
          </button>)}
          {!visible.length ? <p className="rounded-xl bg-muted/40 p-4 text-center text-xs text-muted-foreground">{rows.length ? "No matching machines." : "The queue is clear for this stage."}</p> : null}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{refreshing ? "Refreshing queue… " : ""}Bars compare queued load, including missed slots. They do not measure machine utilization. {grouping === "release" ? "Release winder is the job’s origin; it does not assign this stage." : "Work without a machine stays unassigned."}{totals.unknown ? ` ${totals.unknown} parts need load data; use pieces for a complete comparison.` : ""}</p>
      </div> : null}
    </aside>, document.body,
  )
}
