"use client"

import Link from "next/link"
import { Check, ChevronDown, Search } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import { filterReasons, reasonNeedsNote, reasonProblem, type ReasonRow, type ReasonValue } from "./reason-rules"
import { useReasonList } from "./use-reason-codes"

/**
 * Reason picker (owner decision 4, 1 Nov 2026: every "why" is a code from Masters › Reason codes).
 *
 * Searchable list of the plant's active codes in one category, an optional note (required when the code
 * contains OTHER) and inline validation. `compact` is the dense form for dialogs and floor phone screens.
 * Pass `rows` to reuse a list already loaded; otherwise it loads `category` for `plantId`.
 */
export function ReasonPicker({
  category,
  value,
  onChange,
  plantId,
  rows: givenRows,
  label = "Reason",
  required = true,
  compact = false,
  showErrors = false,
  disabled = false,
  hideNote = false,
  notePlaceholder,
  testIdPrefix = "reason",
  className,
}: {
  category: string
  value: ReasonValue
  onChange: (value: ReasonValue) => void
  plantId?: string | null
  rows?: ReasonRow[]
  label?: string
  required?: boolean
  compact?: boolean
  showErrors?: boolean
  disabled?: boolean
  hideNote?: boolean
  notePlaceholder?: string
  testIdPrefix?: string
  className?: string
}) {
  const list = useReasonList(category, plantId, !givenRows)
  const rows = useMemo(() => givenRows || list.data || [], [givenRows, list.data])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const noteId = useId()
  const chosen = rows.find((row) => row.code === value.code)
  const options = useMemo(() => filterReasons(rows, search), [rows, search])
  const needsNote = reasonNeedsNote(value.code)
  const problem = showErrors ? reasonProblem(value, required) : null
  const loading = !givenRows && list.isLoading
  const failed = !givenRows && list.isError

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, options.findIndex((row) => row.code === value.code)))
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    const close = (event: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => { window.clearTimeout(timer); document.removeEventListener("mousedown", close) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (row: ReasonRow) => {
    onChange({ code: row.code, note: value.note })
    setOpen(false)
    setSearch("")
  }
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (event.key === "Enter") { event.preventDefault(); if (options[active]) pick(options[active]) }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false) }
  }

  const text = compact ? "text-[13px]" : "text-[14px] sm:text-[13px]"
  const height = compact ? "min-h-10" : "min-h-11 sm:min-h-10"
  return (
    <div className={cn("grid min-w-0", compact ? "gap-1.5" : "gap-2", className)} data-testid={`${testIdPrefix}-picker`}>
      <div ref={boxRef} className="relative grid min-w-0 gap-1">
        <span className={cn("font-medium", compact ? "text-[12.5px]" : "text-[13px]")} id={`${listId}-label`}>
          {label} {required ? <span aria-hidden>*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
        </span>
        {loading ? (
          <span role="status" data-no-mirror className="text-[12.5px] text-muted-foreground">Loading reasons…</span>
        ) : failed ? (
          <span role="alert" className="text-[12.5px] text-signal-rose-ink">
            Reasons could not be loaded.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void list.refetch()}>Try again</button>
          </span>
        ) : !rows.some((row) => row.active !== false && row.is_active !== false) ? (
          <span className="text-[12.5px] text-muted-foreground" data-testid={`${testIdPrefix}-empty`}>
            No reasons are set up for this list.{" "}
            <Link href={`/masters/reason-codes?category=${encodeURIComponent(category)}`} className="font-semibold text-primary underline">Add them in Masters › Reason codes</Link>.
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-labelledby={`${listId}-label`}
              data-testid={`${testIdPrefix}-reason`}
              data-value={value.code}
              onClick={() => setOpen((v) => !v)}
              onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true) } }}
              className={cn(
                "flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-card px-3 text-left disabled:opacity-60",
                height, text,
                problem && !value.code ? "border-signal-rose-line" : "border-input",
              )}
            >
              <span className={cn("min-w-0 truncate", chosen ? "" : "text-muted-foreground")}>
                {chosen ? <>{chosen.label} <span className="font-mono text-[11px] text-muted-foreground">{chosen.code}</span></> : value.code || "Choose why"}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            {open ? (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <label className="flex items-center gap-2 border-b border-border px-3">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setActive(0) }}
                    onKeyDown={onKey}
                    placeholder="Search reasons"
                    aria-label="Search reasons"
                    aria-controls={listId}
                    data-testid={`${testIdPrefix}-search`}
                    className={cn("w-full min-w-0 bg-transparent py-2 outline-none", text)}
                  />
                </label>
                <ul id={listId} role="listbox" aria-labelledby={`${listId}-label`} className="max-h-64 overflow-y-auto py-1">
                  {options.length ? options.map((row, index) => (
                    <li
                      key={row.id || row.code}
                      role="option"
                      aria-selected={row.code === value.code}
                      data-testid={`${testIdPrefix}-option-${row.code}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => { event.preventDefault(); pick(row) }}
                      className={cn("flex cursor-pointer items-center justify-between gap-2 px-3", compact ? "py-2" : "py-2.5 sm:py-2", text, index === active ? "bg-muted" : "")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{row.label || row.code}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">{row.code}</span>
                      </span>
                      {row.code === value.code ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                    </li>
                  )) : <li className={cn("px-3 py-2 text-muted-foreground", text)}>No reason matches “{search}”.</li>}
                </ul>
              </div>
            ) : null}
          </>
        )}
        {problem && !value.code ? <span role="alert" data-no-mirror className="text-[12px] text-signal-rose-ink" data-testid={`${testIdPrefix}-error`}>{problem}</span> : null}
      </div>
      {hideNote ? null : (
        <label className="grid min-w-0 gap-1" htmlFor={noteId}>
          <span className={cn("font-medium", compact ? "text-[12.5px]" : "text-[13px]")}>
            Note {needsNote ? <span aria-hidden>*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
          </span>
          <textarea
            id={noteId}
            data-testid={`${testIdPrefix}-note`}
            value={value.note}
            disabled={disabled}
            onChange={(event) => onChange({ code: value.code, note: event.target.value })}
            rows={compact ? 1 : 2}
            maxLength={500}
            aria-invalid={Boolean(problem && value.code) || undefined}
            placeholder={needsNote ? "Say what happened (needed for Other)" : notePlaceholder || "Anything to add (optional)"}
            className={cn("w-full min-w-0 rounded-lg border bg-card px-3 py-2", text, problem && value.code ? "border-signal-rose-line" : "border-input")}
          />
          {problem && value.code ? <span role="alert" data-no-mirror className="text-[12px] text-signal-rose-ink" data-testid={`${testIdPrefix}-error`}>{problem}</span> : null}
        </label>
      )}
    </div>
  )
}

export default ReasonPicker
