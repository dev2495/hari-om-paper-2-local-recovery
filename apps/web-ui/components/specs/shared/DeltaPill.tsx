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
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-800"

  return (
    <span className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold ${toneClass} ${className}`}>
      {numericValue > 0 ? "+" : ""}
      {numericValue.toFixed(2)} {suffix}
    </span>
  )
}
