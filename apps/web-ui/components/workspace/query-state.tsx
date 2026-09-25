"use client"

import { AlertTriangle, Inbox, LoaderCircle, RotateCcw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function LoadingState({
  label = "Loading this workspace…",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="query-loading"
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
    >
      <div className="flex items-center gap-2 border-b border-border bg-[hsl(var(--surface-2))] px-4 py-2.5">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
        <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="space-y-3 p-4" aria-hidden="true">
        {[92, 78, 86, 64, 72].map((width, index) => (
          <div key={index} className="flex items-center gap-4">
            <div className="skeleton h-3 w-24 shrink-0" />
            <div className="skeleton h-3" style={{ width: `${width}%`, animationDelay: `${index * 80}ms` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ErrorState({
  title = "This workspace could not be loaded",
  message = "Refresh to retry. Values on this page must not be treated as zero while the request is failing.",
  onRetry,
  className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      data-testid="query-error"
      className={cn("animate-fade-in rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-4 text-signal-rose-ink", className)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm leading-6 text-signal-rose-ink">{message}</p>
          {onRetry ? (
            <Button type="button" variant="outline" className="h-8 border-signal-rose-line bg-card" onClick={onRetry}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function EmptyQueryState({
  title = "Nothing to show yet",
  message,
  action,
  className,
}: {
  title?: string
  message?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      data-testid="query-empty"
      className={cn(
        "flex animate-fade-in flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-10 text-center",
        className,
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-muted ring-1 ring-border"><Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" /></span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {message ? <p className="max-w-xl text-sm leading-6 text-muted-foreground">{message}</p> : null}
      {action}
    </div>
  )
}

export function PaginationBar({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  label,
}: {
  page: number
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  label?: string
}) {
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground" aria-label="Pagination">
      <span>{label || `Page ${page}`}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-8" disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button type="button" variant="outline" className="h-8" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </nav>
  )
}

export function QuerySwitch({
  isLoading,
  isError,
  isEmpty,
  loadingLabel,
  emptyTitle,
  emptyMessage,
  errorMessage,
  onRetry,
  children,
}: {
  isLoading?: boolean
  isError?: boolean
  isEmpty?: boolean
  loadingLabel?: string
  emptyTitle?: string
  emptyMessage?: string
  errorMessage?: string
  onRetry?: () => void
  children: ReactNode
}) {
  if (isLoading) return <LoadingState label={loadingLabel} />
  if (isError) return <ErrorState message={errorMessage} onRetry={onRetry} />
  if (isEmpty) return <EmptyQueryState title={emptyTitle} message={emptyMessage} />
  return <>{children}</>
}
