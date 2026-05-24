type SpecSheetPrintProps = {
  enabled: boolean
}

export function SpecSheetPrint({ enabled }: SpecSheetPrintProps) {
  if (!enabled) return null

  return (
    <style jsx global>{`
      @media print {
        aside, header, [data-print-hidden="true"] {
          display: none !important;
        }
        main {
          padding: 0 !important;
        }
        body {
          background: white !important;
        }
      }
    `}</style>
  )
}
