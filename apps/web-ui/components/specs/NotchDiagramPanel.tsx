import { useId } from "react"

import { clamp } from "@/lib/spec-sheet"

type DiagramData = {
  title?: string
  tubeLengthMm?: number
  notchDistanceMm?: number
  notchDepthMm?: number
  notchType?: string
  tubeDirection?: string
  /** Optional outer diameter, only used to draw the tube in believable proportion. */
  outerDiameterMm?: number
}

type NotchDiagramPanelProps = {
  data: DiagramData
  compact?: boolean
  editable?: boolean
  onNotchDistanceChange?: (value: number) => void
  onNotchDepthChange?: (value: number) => void
  className?: string
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const INK = "hsl(var(--foreground))"
const DIM = "hsl(var(--muted-foreground))"
const NOTCH = "hsl(var(--chart-5))"
const GUIDE = "hsl(var(--chart-1))"

/**
 * Scaled reference sketch of a notched paper tube: side view with the V-notch cut
 * into the wall, distance from the start edge, depth, remaining length and the
 * winding direction. Theme tokens only, so it reads in dark mode and prints clean.
 */
export function NotchDiagramPanel({
  data,
  compact = false,
  editable = false,
  onNotchDistanceChange,
  onNotchDepthChange,
  className,
}: NotchDiagramPanelProps) {
  const uid = useId().replace(/:/g, "")
  const tubeLengthMm = Math.max(asNumber(data?.tubeLengthMm, 0), 1)
  const notchDistanceMm = clamp(asNumber(data?.notchDistanceMm, 0), 0, tubeLengthMm)
  const notchDepthMm = Math.max(asNumber(data?.notchDepthMm, 0), 0)
  const remainingLengthMm = Math.max(tubeLengthMm - notchDistanceMm, 0)
  const hasNotchGeometry = Boolean(notchDistanceMm > 0 || notchDepthMm > 0 || (data?.notchType && String(data.notchType).toUpperCase() !== "NONE"))
  const direction = String(data?.tubeDirection || "").trim()
  const reversed = /left|rev|anti|ccw|←/i.test(direction)

  const left = 44
  const right = 396
  const width = right - left
  const top = 70
  const odMm = asNumber(data?.outerDiameterMm, 0)
  const bodyHeight = odMm > 0 ? clamp((odMm / tubeLengthMm) * width, 26, 64) : 44
  const bottom = top + bodyHeight
  const notchX = left + (notchDistanceMm / tubeLengthMm) * width
  const depthPx = hasNotchGeometry ? clamp((notchDepthMm / Math.max(odMm || tubeLengthMm * 0.08, 6)) * bodyHeight, 8, bodyHeight * 0.8) : 0
  const halfWidth = clamp(depthPx * 0.75, 7, 16)
  const tipY = top + depthPx
  const fmt = (value: number) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })} mm`
  const bodyPath = hasNotchGeometry
    ? `M${left + 6},${top} L${notchX - halfWidth},${top} L${notchX},${tipY} L${notchX + halfWidth},${top} L${right - 6},${top} Q${right},${top} ${right},${top + 6} L${right},${bottom - 6} Q${right},${bottom} ${right - 6},${bottom} L${left + 6},${bottom} Q${left},${bottom} ${left},${bottom - 6} L${left},${top + 6} Q${left},${top} ${left + 6},${top} Z`
    : `M${left + 6},${top} L${right - 6},${top} Q${right},${top} ${right},${top + 6} L${right},${bottom - 6} Q${right},${bottom} ${right - 6},${bottom} L${left + 6},${bottom} Q${left},${bottom} ${left},${bottom - 6} L${left},${top + 6} Q${left},${top} ${left + 6},${top} Z`

  return (
    <figure className={`notch-diagram rounded-xl border border-border bg-card p-4 ${className || ""}`}>
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">Notch diagram</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{data?.title || "Scaled reference sketch"}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground/80">Type · {data?.notchType || "None"}</span>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground/80">Direction · {direction || "—"}</span>
        </div>
      </figcaption>

      <svg viewBox="0 0 440 200" className={`w-full ${compact ? "h-36" : "h-48"}`} role="img" aria-label={hasNotchGeometry ? `Tube ${fmt(tubeLengthMm)} long, notch at ${fmt(notchDistanceMm)} from the start edge, ${fmt(notchDepthMm)} deep` : "Tube without notch"}>
        <defs>
          <marker id={`${uid}-a`} markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse">
            <path d="M0,0 L7,3.5 L0,7 z" fill={DIM} />
          </marker>
          <marker id={`${uid}-r`} markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse">
            <path d="M0,0 L7,3.5 L0,7 z" fill={NOTCH} />
          </marker>
          <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--muted))" />
            <stop offset="55%" stopColor="hsl(var(--card))" />
            <stop offset="100%" stopColor="hsl(var(--muted))" />
          </linearGradient>
          <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={DIM} strokeOpacity="0.18" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Tube body with the V-notch cut into the top wall */}
        <path d={bodyPath} fill={`url(#${uid}-body)`} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        <path d={bodyPath} fill={`url(#${uid}-hatch)`} stroke="none" />
        <line x1={left + 8} y1={top + bodyHeight / 2} x2={right - 8} y2={top + bodyHeight / 2} stroke={DIM} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="10 4 2 4" />

        {/* Edge ticks */}
        <text x={left} y={bottom + 16} fontSize="10.5" fill={DIM}>Start edge</text>
        <text x={right} y={bottom + 16} fontSize="10.5" fill={DIM} textAnchor="end">End edge</text>

        {/* Overall length */}
        <line x1={left} y1={bottom + 26} x2={left} y2={bottom + 44} stroke={DIM} strokeWidth="1" />
        <line x1={right} y1={bottom + 26} x2={right} y2={bottom + 44} stroke={DIM} strokeWidth="1" />
        <line x1={left + 1} y1={bottom + 38} x2={right - 1} y2={bottom + 38} stroke={DIM} strokeWidth="1" markerStart={`url(#${uid}-a)`} markerEnd={`url(#${uid}-a)`} />
        <rect x={(left + right) / 2 - 56} y={bottom + 30} width="112" height="16" rx="4" fill="hsl(var(--card))" />
        <text x={(left + right) / 2} y={bottom + 42} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle">Length {fmt(tubeLengthMm)}</text>

        {hasNotchGeometry ? (
          <>
            {/* Notch centre line */}
            <line x1={notchX} y1={top - 34} x2={notchX} y2={bottom + 4} stroke={GUIDE} strokeWidth="1" strokeDasharray="4 3" />
            {/* Distance from start edge */}
            <line x1={left} y1={top - 38} x2={left} y2={top - 4} stroke={DIM} strokeWidth="1" />
            <line x1={left + 1} y1={top - 26} x2={notchX - 1} y2={top - 26} stroke={DIM} strokeWidth="1" markerStart={`url(#${uid}-a)`} markerEnd={`url(#${uid}-a)`} />
            <text x={(left + notchX) / 2} y={top - 32} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle">{fmt(notchDistanceMm)}</text>
            {/* Remaining length */}
            <line x1={right} y1={top - 38} x2={right} y2={top - 4} stroke={DIM} strokeWidth="1" />
            <line x1={notchX + 1} y1={top - 12} x2={right - 1} y2={top - 12} stroke={DIM} strokeOpacity="0.7" strokeWidth="1" markerStart={`url(#${uid}-a)`} markerEnd={`url(#${uid}-a)`} />
            <text x={(notchX + right) / 2} y={top - 16} fontSize="10" fill={DIM} textAnchor="middle">Remaining {fmt(remainingLengthMm)}</text>
            {/* Depth callout */}
            <path d={`M${notchX - halfWidth},${top} L${notchX},${tipY} L${notchX + halfWidth},${top}`} fill="none" stroke={NOTCH} strokeWidth="2.2" strokeLinejoin="round" />
            <line x1={notchX + halfWidth + 10} y1={top} x2={notchX + halfWidth + 10} y2={tipY} stroke={NOTCH} strokeWidth="1" markerStart={`url(#${uid}-r)`} markerEnd={`url(#${uid}-r)`} />
            <line x1={notchX + 2} y1={tipY} x2={notchX + halfWidth + 14} y2={tipY} stroke={NOTCH} strokeWidth="0.8" strokeDasharray="2 2" />
            <text x={notchX + halfWidth + 16} y={(top + tipY) / 2 + 4} fontSize="11" fontWeight="600" fill={NOTCH}>{fmt(notchDepthMm)}</text>
          </>
        ) : (
          <text x={(left + right) / 2} y={top - 18} textAnchor="middle" fontSize="12" fill={DIM}>No notch configured for this specification</text>
        )}

        {/* Winding / feed direction */}
        {direction ? (
          <g transform={`translate(${(left + right) / 2 - 36}, ${bottom - 12})`} opacity="0.85">
            <line x1={reversed ? 72 : 0} y1="0" x2={reversed ? 0 : 72} y2="0" stroke={GUIDE} strokeWidth="1.6" markerEnd={`url(#${uid}-a)`} />
          </g>
        ) : null}
      </svg>

      <dl className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-[12px] sm:grid-cols-4">
        {[
          ["Tube length", fmt(tubeLengthMm)],
          ["Notch at", hasNotchGeometry ? fmt(notchDistanceMm) : "—"],
          ["Depth", hasNotchGeometry ? fmt(notchDepthMm) : "—"],
          ["Remaining", hasNotchGeometry ? fmt(remainingLengthMm) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-card px-2.5 py-1.5">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {editable ? (
        <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[12px] font-medium text-muted-foreground">Notch distance</span>
            <input
              type="range"
              min={0}
              max={Math.max(tubeLengthMm, 1)}
              step={0.1}
              value={notchDistanceMm}
              onChange={(event) => onNotchDistanceChange?.(asNumber(event.target.value, notchDistanceMm))}
              className="w-full"
            />
            <span className="tabular-nums">{fmt(notchDistanceMm)}</span>
          </label>
          <label className="space-y-1">
            <span className="block text-[12px] font-medium text-muted-foreground">Notch depth</span>
            <input
              type="range"
              min={0}
              max={Math.max(20, notchDepthMm + 4)}
              step={0.1}
              value={notchDepthMm}
              onChange={(event) => onNotchDepthChange?.(asNumber(event.target.value, notchDepthMm))}
              className="w-full"
            />
            <span className="tabular-nums">{fmt(notchDepthMm)}</span>
          </label>
        </div>
      ) : null}
    </figure>
  )
}
