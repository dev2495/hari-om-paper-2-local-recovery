type DeltaPillProps = {
  value: number
  tolerance?: number
  suffix?: string
  className?: string
}

export function DeltaPill({ value, tolerance = 3, suffix = "g", className = "" }: DeltaPillProps) {
  const numericValue = Number(value || 0)
  const withinTolerance = Math.abs(numericValue) <= tolerance
  const toneClass = withinTolerance
    ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"

  return (
    <span className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold ${toneClass} ${className}`}>
      {numericValue > 0 ? "+" : ""}
      {numericValue.toFixed(2)} {suffix}
    </span>
  )
}
