type RecipeMixCardProps = {
  children: React.ReactNode
}

export function RecipeMixCard({ children }: RecipeMixCardProps) {
  return (
    <section id="sheet-recipe" className="scroll-mt-36 rounded-2xl border border-[#d7dfdc] bg-white p-4 shadow-[0_12px_35px_rgba(25,51,57,0.07)] sm:p-5">
      {children}
    </section>
  )
}
