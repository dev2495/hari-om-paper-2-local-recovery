type PackingCardProps = {
  children: React.ReactNode
  forceOpen?: boolean
}

export function PackingCard({ children, forceOpen = false }: PackingCardProps) {
  return (
    <details id="sheet-packing" open={forceOpen} className="rounded-2xl border border-[#d7dfdc] bg-card shadow-[0_12px_35px_rgba(25,51,57,0.06)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[11.5px] font-semibold text-muted-foreground">Packing</p>
          <p className="mt-1 text-xs text-muted-foreground">Box, plastic and fadda masters with floor PCS and inward-weight visibility.</p>
        </div>
        <span className="rounded-md border border-[#d7dfdc] bg-[#f8faf9] px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
          Expand when needed
        </span>
      </summary>
      <div className="border-t border-[#e4ebe8] px-4 py-4">{children}</div>
    </details>
  )
}
