export type ModuleLink = {
  name: string
  /** A page, or a tab of a page ("/inventory/stock-control?tab=book"). */
  href: string
  /** Other pages that belong under this link (a count's own pages sit under Counts). */
  also?: string[]
  /** For a tab link: the tab the page opens on when the address has no tab. */
  defaultTab?: boolean
}

const pathOf = (href: string) => href.split("?")[0]
const queryOf = (href: string) => new URLSearchParams(href.split("?")[1] || "")

/** The longest page of the link (its own path or one of `also`) that contains the path, else "". */
export function moduleLinkBase(link: ModuleLink, pathname: string): string {
  return [pathOf(link.href), ...(link.also || [])]
    .filter((base) => pathname === base || pathname.startsWith(base + "/"))
    .sort((a, b) => b.length - a.length)[0] || ""
}

/** Does the path belong to this module link (its page, a sub-page, or one of `also`)? */
export function moduleLinkCovers(link: ModuleLink, pathname: string): boolean {
  return Boolean(moduleLinkBase(link, pathname))
}

/** The module link a page belongs to. On the page itself a tab link wins when the address has its tab
 * (the default tab when it has none); deeper pages take the longest link they sit under, so
 * /inventory/counts/<id> marks Counts and /production/reconciliation/limits marks Usage limits. */
export function activeModuleLink(links: ModuleLink[] | undefined, pathname: string, search = ""): ModuleLink | undefined {
  const list = links || []
  const current = new URLSearchParams(search.replace(/^\?/, ""))
  const onPage = list.filter((link) => pathOf(link.href) === pathname)
  if (onPage.length) {
    const exact = onPage.find((link) => {
      const wanted = Array.from(queryOf(link.href).entries())
      return wanted.length > 0 && wanted.every(([key, value]) => current.get(key) === value)
    })
    return exact || onPage.find((link) => !queryOf(link.href).toString()) || onPage.find((link) => link.defaultTab) || onPage[0]
  }
  let best: ModuleLink | undefined
  let bestLength = 0
  for (const link of list) {
    const base = moduleLinkBase(link, pathname)
    if (base && (base.length > bestLength || (base.length === bestLength && link.defaultTab))) {
      best = link
      bestLength = base.length
    }
  }
  return best
}

export const MODULE_NAVIGATION: Record<string, ModuleLink[]> = {
  // Sales reads the order close reasons it picks from (Owner and Admin manage them; Masters links them too).
  "/sales-orders": [
    { name: "Orders", href: "/sales-orders" },
    { name: "Order close reasons", href: "/masters/order-close-reasons" },
  ],
  "/planning/board": [
    { name: "Planning overview", href: "/planning/overview" },
    { name: "Winder planning", href: "/planning/winder" },
    { name: "Oven planning", href: "/planning/oven" },
    { name: "Process planning", href: "/planning/process" },
    { name: "Slitting planning", href: "/planning/slitting" },
  ],
  "/quality": [
    { name: "Incoming QC", href: "/quality/incoming" },
    { name: "In-process QC", href: "/quality/stage" },
    { name: "Holds & inspections", href: "/quality/results" },
    { name: "Customer complaints", href: "/quality/returns" },
    { name: "Material standards", href: "/quality/material-standards" },
    { name: "Process stage rules", href: "/quality/stage-rules" },
    { name: "Quality analytics", href: "/reports/quality" },
  ],
  "/masters/papers": [
    {
      "name": "Papers",
      "href": "/masters/papers"
    },
    {
      "name": "Mandrels",
      "href": "/masters/mandrels"
    },
    {
      "name": "Tube sizes",
      "href": "/masters/tube-sizes"
    },
    {
      "name": "Parchments",
      "href": "/masters/parchments"
    },
    {
      "name": "Adhesives",
      "href": "/masters/adhesives"
    },
    {
      "name": "Packaging",
      "href": "/masters/packaging"
    },
    {
      "name": "Inward QC tolerances",
      "href": "/masters/inward-qc"
    },
    {
      "name": "Physical tools",
      "href": "/masters/tools"
    },
    {
      "name": "Customers",
      "href": "/masters/customers"
    },
    {
      "name": "Vendors",
      "href": "/masters/vendors"
    },
    {
      "name": "Contact directory",
      "href": "/masters/contact-directory"
    },
    {
      "name": "Employees",
      "href": "/masters/employees"
    },
    {
      "name": "Shifts",
      "href": "/masters/shifts"
    },
    {
      "name": "Holidays",
      "href": "/masters/holidays"
    },
    {
      "name": "Reason codes",
      "href": "/masters/reason-codes"
    },
    {
      "name": "Order close reasons",
      "href": "/masters/order-close-reasons"
    }
  ],
  "/system/users": [
    {
      "name": "Users",
      "href": "/system/users"
    },
    {
      "name": "Roles & access",
      "href": "/system/roles"
    },
    {
      "name": "Plants",
      "href": "/system/plants"
    },
    {
      "name": "Machines",
      "href": "/system/machines"
    },
    {
      "name": "Background jobs",
      "href": "/system/scheduler"
    }
  ],
  // Month-end close (client 2026-10-28): usage limits moved here from System.
  "/production/reconciliation": [
    {
      "name": "Month-end close",
      "href": "/production/reconciliation"
    },
    {
      "name": "Usage limits",
      "href": "/production/reconciliation/limits"
    }
  ],
  // One Stock place (client 2026-10-28): the hub's three tabs and locations. A count and its racks
  // (/inventory/counts/<id>/...) sit under Counts.
  "/inventory/stock-control": [
    {
      "name": "Counts",
      "href": "/inventory/stock-control?tab=counts",
      "also": ["/inventory/counts"],
      "defaultTab": true
    },
    {
      "name": "Corrections",
      "href": "/inventory/stock-control?tab=corrections"
    },
    {
      "name": "Stock book",
      "href": "/inventory/stock-control?tab=book"
    },
    {
      "name": "Locations",
      "href": "/inventory/locations"
    }
  ],
  "/inventory": [
    {
      "name": "Stock overview",
      "href": "/inventory"
    },
    {
      "name": "Material items",
      "href": "/inventory/items"
    },
    {
      "name": "Goods inward",
      "href": "/purchase/inward"
    }
  ]
}
