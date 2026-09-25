"use client"

import type { ReactNode } from "react"
import type { ModuleAppearance } from "@/lib/erp-appearance"

export type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  aside?: ReactNode
  badge?: string
  appearance?: ModuleAppearance
  variant?: "page" | "hero"
  testId?: string
}

export function PageHeader({ title, description, actions, aside, badge, testId }: PageHeaderProps) {
  return <section data-testid={testId || "page-header"} className={aside ? "animate-enter-up grid items-start gap-x-6 gap-y-4 pb-5 xl:grid-cols-[minmax(0,1fr)_320px]" : "animate-enter-up"}>
    <header className={aside ? "tube-page-header !pb-0" : "tube-page-header"}>
      <div className="min-w-0 flex-1 basis-80">
        {badge ? <span className="tube-page-eyebrow">{badge}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="tube-page-actions">{actions}</div> : null}
    </header>
    {aside ? <aside className="tube-header-aside">{aside}</aside> : null}
  </section>
}
