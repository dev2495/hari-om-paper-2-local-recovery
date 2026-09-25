type NotchingCardProps = {
  children: React.ReactNode
  forceOpen?: boolean
}

export function NotchingCard({ children, forceOpen = false }: NotchingCardProps) {
  return (
    <details id="sheet-notch-tooling" open={forceOpen} className="rounded-2xl border border-[#d7dfdc] bg-card shadow-[0_12px_35px_rgba(25,51,57,0.06)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[11.5px] font-semibold text-muted-foreground">Notch + Tooling</p>
          <p className="mt-1 text-xs text-muted-foreground">Only the downstream tooling fields that still matter to the job card and print sheet.</p>
        </div>
        <span className="rounded-md border border-[#d7dfdc] bg-[#f8faf9] px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
          Expand when needed
        </span>
      </summary>
      <div className="border-t border-[#e4ebe8] px-4 py-4">{children}</div>
    </details>
  )
}
