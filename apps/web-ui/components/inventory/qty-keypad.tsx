"use client"

import { Delete } from "lucide-react"

import { cn } from "@/lib/utils"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const

/** Number pad for counting bulk lots on a phone: big keys, the unit beside the number, no keyboard pop-up. */
export function QtyKeypad({ value, onChange, unit, wholeOnly = false, hint, testId = "qty-keypad" }: {
  value: string; onChange: (value: string) => void; unit: string; wholeOnly?: boolean; hint?: string; testId?: string
}) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === "back") return onChange(value.slice(0, -1))
    if (key === ".") {
      if (wholeOnly || value.includes(".")) return
      return onChange(value ? `${value}.` : "0.")
    }
    const next = value === "0" ? key : `${value}${key}`
    const [, decimals = ""] = next.split(".")
    if (decimals.length > 3 || next.replace(".", "").length > 9) return
    onChange(next)
  }
  const shown = value ? Number(value.endsWith(".") ? value.slice(0, -1) : value).toLocaleString("en-IN", { maximumFractionDigits: 3 }) + (value.endsWith(".") ? "." : "") : "0"
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-center gap-2 rounded-2xl border border-border bg-[hsl(var(--surface-2))] px-4 py-4" aria-live="polite">
        <span className={cn("text-[40px] font-semibold leading-none tabular-nums tracking-tight", value ? "text-foreground" : "text-muted-foreground")} data-testid={`${testId}-value`}>{shown}</span>
        <span className="text-[18px] font-semibold text-muted-foreground">{unit}</span>
      </div>
      {hint ? <p className="mt-2 text-center text-[12.5px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            disabled={key === "." && wholeOnly}
            aria-label={key === "back" ? "Delete last digit" : key === "." ? "Decimal point" : key}
            className="grid h-14 place-items-center rounded-xl border border-border bg-card text-[22px] font-semibold tabular-nums text-foreground shadow-[var(--shadow-xs)] transition-transform active:scale-95 disabled:opacity-30 motion-reduce:transition-none"
            data-testid={`${testId}-${key === "." ? "dot" : key}`}
          >
            {key === "back" ? <Delete className="h-5 w-5" aria-hidden="true" /> : key}
          </button>
        ))}
      </div>
    </div>
  )
}
