"use client"

import { Check, ChevronDown, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

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
  const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, width: 360 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 380), window.innerWidth - 24)
      const left = Math.min(Math.max(rect.left, 12), window.innerWidth - width - 12)
      const roomBelow = window.innerHeight - rect.bottom - 12
      const roomAbove = rect.top - 12
      const estimatedMenuHeight = 420
      const openAbove = roomBelow < 300 && roomAbove > roomBelow
      const top = openAbove
        ? Math.max(12, rect.top - Math.min(estimatedMenuHeight, roomAbove) - 8)
        : rect.bottom + 8
      setMenuStyle({ left, top, width })
    }
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    positionMenu()
    window.addEventListener("resize", positionMenu)
    window.addEventListener("scroll", positionMenu, true)
    document.addEventListener("mousedown", closeOnOutside)
    return () => {
      window.removeEventListener("resize", positionMenu)
      window.removeEventListener("scroll", positionMenu, true)
      document.removeEventListener("mousedown", closeOnOutside)
    }
  }, [open])

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-[#cfd9e6] bg-white px-3 py-2 text-left text-xs text-slate-900 shadow-sm transition hover:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
      >
        <span className="line-clamp-2">{selected ? labelForPaper(selected) : "Select paper master"}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Paper masters"
          style={menuStyle}
          className="fixed z-[1000] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
        >
          <div className="border-b border-slate-100 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <div>
                <p className="text-xs font-bold text-slate-900">Select paper master</p>
                <p className="text-[11px] text-slate-500">Search by code, variety, category, or GSM</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{filteredPapers.length} active</span>
            </div>
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false)
              }}
              placeholder="Search paper masters"
              className="h-10 w-full rounded-xl border border-[#cfd9e6] bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-cyan-400 focus:bg-white"
            />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
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
                  role="option"
                  aria-selected={String(paper.id) === String(value)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-cyan-50 hover:text-cyan-900"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{paper.code || "NO-CODE"}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{paper.variety || paper.category || "Paper"} · {paper.gsm ? `${paper.gsm} GSM` : "GSM pending"}</span>
                  </span>
                  {String(paper.id) === String(value) ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
