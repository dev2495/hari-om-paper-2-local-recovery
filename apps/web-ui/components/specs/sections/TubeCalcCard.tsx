type TubeCalcCardProps = {
  children: React.ReactNode
}

export function TubeCalcCard({ children }: TubeCalcCardProps) {
  return (
    <section id="sheet-manufacturing" className="rounded-[34px] border border-[#d9e2ef] bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      {children}
    </section>
  )
}
