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
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[1.3rem] border border-slate-200 bg-white/80 px-4 py-12 text-center",
        className,
      )}
    >
      <LoaderCircle className="h-6 w-6 animate-spin text-cyan-800" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <div className="mt-2 grid w-full max-w-xl gap-2">
        <div className="h-3 animate-pulse rounded-full bg-slate-200" />
        <div className="h-3 w-4/5 animate-pulse rounded-full bg-slate-100" />
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
      className={cn("rounded-[1.3rem] border border-rose-200 bg-rose-50 px-4 py-6 text-rose-950", className)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm leading-6 text-rose-800">{message}</p>
          {onRetry ? (
            <Button type="button" variant="outline" className="h-9 rounded-xl border-rose-200 bg-white" onClick={onRetry}>
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
        "flex flex-col items-center justify-center gap-3 rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center",
        className,
      )}
    >
      <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {message ? <p className="max-w-xl text-sm leading-6 text-slate-500">{message}</p> : null}
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
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600" aria-label="Pagination">
      <span>{label || `Page ${page}`}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={!hasNext} onClick={onNext}>
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
