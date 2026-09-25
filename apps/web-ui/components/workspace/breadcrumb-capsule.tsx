"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react"

export type Crumb = { label: string; href?: string; icon?: LucideIcon }

/**
 * "Where am I" capsule: back, section › workspace › page. Segments animate in on
 * every route change; each earlier segment is a link one level up.
 */
export function BreadcrumbCapsule({ crumbs, routeKey, backHref }: { crumbs: Crumb[]; routeKey: string; backHref?: string }) {
  const router = useRouter()
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back()
    else if (backHref) router.push(backHref)
    else router.back()
  }
  const LeadIcon = crumbs[0]?.icon
  return (
    <nav aria-label="Breadcrumb" className="tube-crumbs">
      <button type="button" onClick={goBack} className="tube-crumbs-back" aria-label="Go back" title="Back">
        <ArrowLeft />
      </button>
      <ol key={routeKey}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${index}`} style={{ ["--crumb-index" as any]: index }}>
              {index > 0 ? <ChevronRight className="tube-crumbs-sep" aria-hidden="true" /> : null}
              {last || !crumb.href ? (
                <span aria-current={last ? "page" : undefined} className={last ? "is-current" : undefined}>
                  {index === 0 && LeadIcon ? <LeadIcon aria-hidden="true" /> : null}
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href}>
                  {index === 0 && LeadIcon ? <LeadIcon aria-hidden="true" /> : null}
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
