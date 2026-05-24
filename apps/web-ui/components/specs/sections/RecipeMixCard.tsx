type RecipeMixCardProps = {
  children: React.ReactNode
}

export function RecipeMixCard({ children }: RecipeMixCardProps) {
  return (
    <section id="sheet-recipe" className="rounded-[34px] border border-[#d9e2ef] bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      {children}
    </section>
  )
}
