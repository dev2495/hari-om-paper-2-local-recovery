"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Side sheet on a computer, bottom sheet on a phone (same content, one component). Built on the
 * Radix dialog, so focus is trapped, Esc closes and the page behind is inert.
 */
export function Sheet({ open, onOpenChange, title, description, eyebrow, children, footer, wide = false, testId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  testId?: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tube-overlay fixed inset-0 z-50 bg-[hsl(224_30%_6%/.42)] backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            "fixed z-50 flex flex-col border-border bg-popover text-popover-foreground shadow-[var(--shadow-premium)] outline-none",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t [animation:enter-up_260ms_var(--ease-workspace)_both]",
            "sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:[animation:sheet-in-right_240ms_var(--ease-workspace)_both]",
            wide ? "sm:w-[min(640px,100vw)]" : "sm:w-[min(468px,100vw)]",
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden" aria-hidden="true" />
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-3 sm:px-5 sm:pt-5">
            <div className="min-w-0">
              {eyebrow ? <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{eyebrow}</div> : null}
              <DialogPrimitive.Title className="text-[17px] font-semibold leading-6 tracking-tight text-foreground">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9">
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
          {footer ? <footer className="shrink-0 border-t border-border bg-[hsl(var(--surface-2))] px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
