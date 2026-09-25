"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, busy = false, noun = "records" }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void; busy?: boolean; noun?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const numbers = Array.from(new Set([1, page - 1, page, page + 1, pages])).filter(value => value > 0 && value <= pages).sort((a,b) => a-b)
  const start = total ? Math.min(total, (page - 1) * pageSize + 1) : 0
  return <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
    <span role="status" aria-live="polite">{start}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-IN")} {noun}</span>
    <div className="flex max-w-full flex-wrap items-center gap-1">
      {onPageSizeChange ? <label className="mr-2 flex items-center gap-2">Rows<select aria-label="Rows per page" className="h-9 rounded-lg border border-input bg-card px-2 text-foreground" value={pageSize} onChange={event=>onPageSizeChange(Number(event.target.value))}>{[10,25,50,100].map(size=><option key={size} value={size}>{size}</option>)}</select></label> : null}
      <Button variant="outline" size="icon" aria-label="Previous page" disabled={busy || page <= 1} onClick={()=>onPageChange(page-1)}><ChevronLeft size={15} /></Button>
      {numbers.map((number,index)=><span key={number} className="hidden items-center gap-1 sm:inline-flex">{index > 0 && number-numbers[index-1] > 1 ? <span className="px-1">…</span> : null}<Button variant={number === page ? "default" : "ghost"} size="icon" aria-label={`Page ${number}`} aria-current={number === page ? "page" : undefined} disabled={busy} onClick={()=>onPageChange(number)}>{number}</Button></span>)}
      <span className="px-3 sm:hidden">{page} / {pages}</span>
      <Button variant="outline" size="icon" aria-label="Next page" disabled={busy || page >= pages} onClick={()=>onPageChange(page+1)}><ChevronRight size={15} /></Button>
    </div>
  </nav>
}
