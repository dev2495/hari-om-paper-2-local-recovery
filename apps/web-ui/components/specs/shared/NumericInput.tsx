"use client"

type NumericInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  unit?: string
}

export function NumericInput({ unit, className = "", disabled, ...props }: NumericInputProps) {
  const baseClass =
    "h-10 w-full rounded-xl border border-[#cfd9e6] bg-white px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
  const input = (
    <input
      {...props}
      type="number"
      disabled={disabled}
      className={unit ? `${baseClass} pr-12 ${className}` : `${baseClass} ${className}`}
    />
  )

  if (!unit) return input

  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {unit}
      </span>
    </div>
  )
}
