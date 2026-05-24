"use client"

import { useMemo, useState } from "react"

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
  const selected = useMemo(() => papers.find((paper) => String(paper.id) === String(value)), [papers, value])
  const filteredPapers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return papers
    return papers.filter((paper) =>
      [paper.code, paper.variety, paper.category, paper.gsm]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle)),
    )
  }, [papers, query])

  return (
    <div className={`space-y-2 ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        placeholder={selected ? labelForPaper(selected) : "Search code, variety, or GSM"}
        className="h-9 w-full rounded-xl border border-[#cfd9e6] bg-white px-2 text-xs disabled:bg-slate-100"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-xl border border-[#cfd9e6] bg-white px-2 text-xs disabled:bg-slate-100"
      >
        <option value="">{query ? "Select matching paper" : "Select paper"}</option>
        {filteredPapers.map((paper) => (
          <option key={paper.id} value={paper.id}>
            {labelForPaper(paper)}
          </option>
        ))}
      </select>
    </div>
  )
}
