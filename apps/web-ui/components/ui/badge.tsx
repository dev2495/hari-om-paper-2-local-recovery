import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-slate-900 text-white",
        secondary: "border-border bg-muted text-muted-foreground",
        outline: "border-border bg-card text-muted-foreground",
        success: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
        warning: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
        destructive: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
        info: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
