"use client"

import { useMemo, useState } from "react"

import { isMasterOptionActive } from "@/lib/spec-sheet"

type PaperOption = {
  id: string
  code?: string | null
  variety?: string | null
  category?: string | null
  gsm?: number | string | null
}

type PaperPickerProps = {
  value: string
  papers: PaperOption[]
  disabled?: boolean
  onChange: (paperId: string) => void
  className?: string
}

function labelForPaper(paper?: PaperOption | null) {
  if (!paper) return ""
  const code = paper.code || "NO-CODE"
  const variety = paper.variety || paper.category || "Paper"
  const gsm = paper.gsm ? `${paper.gsm} GSM` : "GSM pending"
  return `${code} | ${variety} | ${gsm}`
}

export function PaperPicker({ value, papers, disabled, onChange, className = "" }: PaperPickerProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const activePapers = useMemo(() => papers.filter(isMasterOptionActive), [papers])
  const selected = useMemo(() => papers.find((paper) => String(paper.id) === String(value)), [papers, value])
  const filteredPapers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return activePapers
    return activePapers.filter((paper) =>
      [paper.code, paper.variety, paper.category, paper.gsm]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle)),
    )
  }, [activePapers, query])

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-[#cfd9e6] bg-white px-3 py-2 text-left text-xs text-slate-900 shadow-sm transition hover:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
      >
        <span className="line-clamp-2">{selected ? labelForPaper(selected) : "Select paper variety"}</span>
        <span className="text-slate-400">v</span>
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 top-[calc(100%+0.35rem)] z-40 w-[min(420px,90vw)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false)
              }}
              placeholder="Search code, variety, or GSM"
              className="h-10 w-full rounded-xl border border-[#cfd9e6] bg-slate-50 px-3 text-sm outline-none focus:border-cyan-400 focus:bg-white"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filteredPapers.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No active paper matches this search.</div>
            ) : (
              filteredPapers.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  onClick={() => {
                    onChange(String(paper.id))
                    setQuery("")
                    setOpen(false)
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-800 hover:bg-cyan-50 hover:text-cyan-900"
                >
                  {labelForPaper(paper)}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
