type ValidationFooterProps = {
  children: React.ReactNode
  forceOpen?: boolean
}

export function ValidationFooter({ children, forceOpen = false }: ValidationFooterProps) {
  return (
    <details id="sheet-validation" open={forceOpen} className="rounded-[30px] border border-[#d9e2ef] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Validation</p>
          <p className="mt-2 text-sm text-slate-600">Final footer and release checks only. Keep this out of the way until the sheet is ready.</p>
        </div>
        <span className="rounded-full border border-[#d9e2ef] bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Expand when needed
        </span>
      </summary>
      <div className="border-t border-[#e4ebf3] px-5 py-5">{children}</div>
    </details>
  )
}
