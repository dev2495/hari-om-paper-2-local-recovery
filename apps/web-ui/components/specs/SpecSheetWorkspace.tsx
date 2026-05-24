type SpecSheetWorkspaceProps = {
  children: React.ReactNode
  printMode?: boolean
}

export function SpecSheetWorkspace({ children, printMode = false }: SpecSheetWorkspaceProps) {
  return <div className={printMode ? "mx-auto max-w-[1100px]" : ""}>{children}</div>
}
