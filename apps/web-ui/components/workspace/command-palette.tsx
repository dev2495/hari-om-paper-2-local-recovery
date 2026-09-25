"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWorkspaceCommandPalette } from "@/hooks/use-workspace"
import { cn } from "@/lib/utils"

type PaletteItem = {
  kind?: string
  label: string
  href: string
  subtitle?: string
}

type PaletteWarning = {
  source?: string
  message?: string
}

function Section({
  title,
  items,
  onSelect,
}: {
  title: string
  items: PaletteItem[]
  onSelect: (item: PaletteItem) => void
}) {
  if (!items.length) return null

  return (
    <section className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={`${title}-${item.kind || "item"}-${item.href}-${item.label}`}
            type="button"
            onClick={() => onSelect(item)}
            className="flex w-full items-start gap-3 rounded-[1.1rem] border border-border bg-card/85 px-4 py-3 text-left transition hover:border-signal-cyan-line hover:bg-signal-cyan-soft/60"
          >
            <div className="mt-0.5 rounded-xl bg-muted p-2 text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{item.label}</p>
              {item.subtitle ? <p className="mt-1 text-xs text-muted-foreground">{item.subtitle}</p> : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export function WorkspaceCommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { data, isLoading } = useWorkspaceCommandPalette(query, open)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery("")
    }
  }, [open])

  const sections = useMemo(
    () => [
      { title: "Navigation", items: Array.isArray(data?.nav) ? data.nav : [] },
      { title: "Quick Actions", items: Array.isArray(data?.actions) ? data.actions : [] },
      { title: "Recent", items: Array.isArray(data?.recent) ? data.recent : [] },
      { title: "Records", items: Array.isArray(data?.entities) ? data.entities : [] },
    ],
    [data],
  )

  const hasResults = sections.some((section) => section.items.length > 0)
  const warnings = Array.isArray(data?.warnings) ? (data.warnings as PaletteWarning[]) : []

  const handleSelect = (item: PaletteItem) => {
    setOpen(false)
    router.push(item.href)
  }

  return (
    <>
      <button
        type="button"
        data-testid="workspace-command-trigger"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-11 min-w-[260px] items-center gap-3 rounded-[1.1rem] border border-border bg-card/90 px-4 text-left shadow-sm transition hover:border-border hover:bg-card",
          "sm:min-w-[360px] xl:min-w-[430px]",
        )}
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm text-muted-foreground">Search navigation, quick actions, orders, job cards, specs…</span>
        <span className="hidden rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground sm:inline-flex">
          Cmd/Ctrl K
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl overflow-hidden rounded-[1.7rem] border border-border/60 bg-muted p-0 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.6)]">
          <DialogHeader className="border-b border-border bg-card/90 px-6 py-5">
            <DialogTitle className="text-xl text-foreground">Workspace Search</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Find pages, actions, recent activity, and ERP records from one command palette.
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-border bg-card/80 px-6 py-4">
            <div className="flex items-center gap-3 rounded-[1rem] border border-border bg-card px-4 py-3 shadow-sm">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sales orders, job cards, inventory items, or actions"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-5">
            {isLoading ? <div className="rounded-[1.2rem] border border-border bg-card p-6 text-sm text-muted-foreground">Searching workspace…</div> : null}
            {!isLoading && warnings.length ? (
              <div className="rounded-[1.2rem] border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-sm text-signal-amber-ink">
                <p className="font-semibold">Partial workspace results</p>
                <div className="mt-2 space-y-1 text-xs text-signal-amber-ink">
                  {warnings.map((warning, index) => (
                    <p key={`${warning.source || "warning"}-${index}`}>
                      {warning.source || "workspace"}: {warning.message || "Temporarily unavailable"}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {!isLoading && hasResults
              ? sections.map((section) => <Section key={section.title} title={section.title} items={section.items} onSelect={handleSelect} />)
              : null}
            {!isLoading && !hasResults ? (
              <div className="rounded-[1.2rem] border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                No matching pages, actions, or records were found.
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
