type ValidationFooterProps = {
  children: React.ReactNode
  forceOpen?: boolean
}

export function ValidationFooter({ children, forceOpen = false }: ValidationFooterProps) {
  return (
    <details id="sheet-validation" open={forceOpen} className="rounded-2xl border border-[#d7dfdc] bg-white shadow-[0_12px_35px_rgba(25,51,57,0.06)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Validation</p>
          <p className="mt-1 text-xs text-slate-600">Final footer and release checks only. Keep this out of the way until the sheet is ready.</p>
        </div>
        <span className="rounded-md border border-[#d7dfdc] bg-[#f8faf9] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Expand when needed
        </span>
      </summary>
      <div className="border-t border-[#e4ebe8] px-4 py-4">{children}</div>
    </details>
  )
}
