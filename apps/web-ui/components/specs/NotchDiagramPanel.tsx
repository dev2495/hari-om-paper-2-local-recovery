import { clamp } from "@/lib/spec-sheet"

type DiagramData = {
  title?: string
  tubeLengthMm?: number
  notchDistanceMm?: number
  notchDepthMm?: number
  notchType?: string
  tubeDirection?: string
}

type NotchDiagramPanelProps = {
  data: DiagramData
  compact?: boolean
  editable?: boolean
  onNotchDistanceChange?: (value: number) => void
  onNotchDepthChange?: (value: number) => void
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function NotchDiagramPanel({
  data,
  compact = false,
  editable = false,
  onNotchDistanceChange,
  onNotchDepthChange,
}: NotchDiagramPanelProps) {
  const tubeLengthMm = Math.max(asNumber(data?.tubeLengthMm, 0), 1)
  const notchDistanceMm = clamp(asNumber(data?.notchDistanceMm, tubeLengthMm * 0.07), 0, tubeLengthMm)
  const notchDepthMm = Math.max(asNumber(data?.notchDepthMm, 0), 0)
  const remainingLengthMm = Math.max(tubeLengthMm - notchDistanceMm, 0)

  const baselineLeft = 30
  const baselineRight = 390
  const baselineWidth = baselineRight - baselineLeft
  const baselineY = 108
  const notchX = baselineLeft + (notchDistanceMm / tubeLengthMm) * baselineWidth
  const notchDepthPx = clamp((notchDepthMm / Math.max(tubeLengthMm * 0.08, 8)) * 54, 10, 42)
  const notchTipY = baselineY + notchDepthPx

  const formatMm = (value: number) => `${value.toFixed(2)} mm`

  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Notch Diagram</h3>
          <p className="mt-1 text-xs text-slate-500">{data?.title || "Reference sketch"}</p>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>Type: {data?.notchType || "NONE"}</div>
          <div>Direction: {data?.tubeDirection || "--"}</div>
        </div>
      </div>

      <svg viewBox="0 0 420 190" className={`w-full ${compact ? "h-36" : "h-52"}`} role="img" aria-label="Scaled notch geometry preview">
        <defs>
          <marker id="notch-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
          </marker>
          <marker id="notch-arrow-red" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#dc2626" />
          </marker>
        </defs>

        <line x1={baselineLeft} y1={baselineY} x2={baselineRight} y2={baselineY} stroke="#0f172a" strokeWidth="3" />
        <line x1={baselineLeft} y1={baselineY - 8} x2={baselineLeft} y2={baselineY + 8} stroke="#0f172a" strokeWidth="2" />
        <line x1={baselineRight} y1={baselineY - 8} x2={baselineRight} y2={baselineY + 8} stroke="#0f172a" strokeWidth="2" />

        <line x1={notchX} y1={52} x2={notchX} y2={notchTipY + 12} stroke="#0891b2" strokeWidth="1.6" strokeDasharray="5 4" />
        <polyline
          points={`${notchX - 18},${baselineY} ${notchX},${notchTipY} ${notchX + 18},${baselineY}`}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2.4"
        />

        <line
          x1={baselineLeft}
          y1={38}
          x2={notchX}
          y2={38}
          stroke="#64748b"
          strokeWidth="1.2"
          markerStart="url(#notch-arrow)"
          markerEnd="url(#notch-arrow)"
        />
        <line x1={baselineLeft} y1={32} x2={baselineLeft} y2={44} stroke="#64748b" strokeWidth="1.2" />
        <line x1={notchX} y1={32} x2={notchX} y2={44} stroke="#64748b" strokeWidth="1.2" />
        <text x={(baselineLeft + notchX) / 2} y={30} textAnchor="middle" fontSize="11" fill="#334155">
          {formatMm(notchDistanceMm)}
        </text>

        <line
          x1={notchX}
          y1={152}
          x2={baselineRight}
          y2={152}
          stroke="#64748b"
          strokeWidth="1.2"
          markerStart="url(#notch-arrow)"
          markerEnd="url(#notch-arrow)"
        />
        <line x1={notchX} y1={146} x2={notchX} y2={158} stroke="#64748b" strokeWidth="1.2" />
        <line x1={baselineRight} y1={146} x2={baselineRight} y2={158} stroke="#64748b" strokeWidth="1.2" />
        <text x={(notchX + baselineRight) / 2} y={146} textAnchor="middle" fontSize="11" fill="#334155">
          Remaining {formatMm(remainingLengthMm)}
        </text>

        <line
          x1={notchX + 30}
          y1={baselineY}
          x2={notchX + 30}
          y2={notchTipY}
          stroke="#dc2626"
          strokeWidth="1.2"
          markerStart="url(#notch-arrow-red)"
          markerEnd="url(#notch-arrow-red)"
        />
        <line x1={notchX + 24} y1={baselineY} x2={notchX + 36} y2={baselineY} stroke="#dc2626" strokeWidth="1.2" />
        <line x1={notchX + 24} y1={notchTipY} x2={notchX + 36} y2={notchTipY} stroke="#dc2626" strokeWidth="1.2" />
        <text x={notchX + 42} y={(baselineY + notchTipY) / 2} fontSize="11" fill="#991b1b">
          {formatMm(notchDepthMm)}
        </text>

        <text x={baselineLeft} y={176} fontSize="11" fill="#334155">
          Tube Length: {formatMm(tubeLengthMm)}
        </text>
        <text x={baselineLeft} y={92} fontSize="11" fill="#0f172a">
          Start edge
        </text>
        <text x={baselineRight - 44} y={92} fontSize="11" fill="#0f172a">
          End edge
        </text>
        <text x={notchX - 28} y={baselineY + 28} fontSize="11" fill="#0369a1">
          Notch point
        </text>
      </svg>

      {editable ? (
        <div className="mt-4 grid gap-3 text-xs text-slate-600 md:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notch Distance</span>
            <input
              type="range"
              min={0}
              max={Math.max(tubeLengthMm, 1)}
              step={0.1}
              value={notchDistanceMm}
              onChange={(event) => onNotchDistanceChange?.(asNumber(event.target.value, notchDistanceMm))}
              className="w-full accent-cyan-700"
            />
            <span>{formatMm(notchDistanceMm)}</span>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notch Depth</span>
            <input
              type="range"
              min={0}
              max={Math.max(20, notchDepthMm + 4)}
              step={0.1}
              value={notchDepthMm}
              onChange={(event) => onNotchDepthChange?.(asNumber(event.target.value, notchDepthMm))}
              className="w-full accent-rose-600"
            />
            <span>{formatMm(notchDepthMm)}</span>
          </label>
        </div>
      ) : null}
    </div>
  )
}
