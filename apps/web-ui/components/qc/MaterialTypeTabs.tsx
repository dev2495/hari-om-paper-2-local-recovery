"use client"

import { cn } from "@/lib/utils"

/** Material types with inward QC standards; finished-good returns keep their own form. */
export const MATERIAL_TYPES = [
  { value: "RAW_PAPER", label: "Paper", group: "Paper variety", subgroup: null as string | null },
  { value: "PARCHMENT", label: "Parchment", group: "Company", subgroup: "Colour" },
  { value: "ADHESIVE", label: "Adhesive", group: "Adhesive variety", subgroup: null },
  { value: "PACKAGING", label: "Packing", group: "Packing kind", subgroup: null },
  { value: "TOOL", label: "Tools", group: "Tool category", subgroup: null },
  { value: "OTHER", label: "Other", group: "Group", subgroup: null },
]

export const materialTypeMeta = (value: string) => MATERIAL_TYPES.find((type) => type.value === value) || MATERIAL_TYPES[0]

export function MaterialTypeTabs({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="tablist" aria-label="Material type" className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/60 p-1" data-testid="material-type-tabs">
      {MATERIAL_TYPES.map((type) => {
        const active = type.value === value
        return (
          <button
            key={type.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(type.value)}
            className={cn(
              "min-h-9 rounded-lg px-3.5 text-[13px] font-semibold transition-colors duration-150",
              active ? "bg-card text-foreground shadow-[var(--shadow-xs)] ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {type.label}
          </button>
        )
      })}
    </div>
  )
}
