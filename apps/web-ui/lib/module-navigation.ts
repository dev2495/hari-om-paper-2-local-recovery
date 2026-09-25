export type ModuleLink = { name: string; href: string }

export const MODULE_NAVIGATION: Record<string, ModuleLink[]> = {
  "/planning/board": [
    { name: "Planning overview", href: "/planning/overview" },
    { name: "Winder planning", href: "/planning/winder" },
    { name: "Oven planning", href: "/planning/oven" },
    { name: "Process planning", href: "/planning/process" },
    { name: "Slitting planning", href: "/planning/slitting" },
  ],
  "/quality": [
    {
      "name": "Incoming inspections",
      "href": "/quality/incoming"
    },
    {
      "name": "Production inspections",
      "href": "/quality/stage"
    },
    {
      "name": "Results & dispositions",
      "href": "/quality/results"
    }
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
      "name": "Physical tools",
      "href": "/masters/tools"
    },
    {
      "name": "Customers",
      "href": "/masters/customers"
    },
    {
      "name": "Suppliers",
      "href": "/masters/suppliers"
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
    }
  ],
  "/system/users": [
    {
      "name": "Users",
      "href": "/system/users"
    },
    {
      "name": "Plants",
      "href": "/system/plants"
    },
    {
      "name": "Locations",
      "href": "/system/locations"
    },
    {
      "name": "Machines",
      "href": "/system/machines"
    },
    {
      "name": "Tolerance bands",
      "href": "/system/tolerances"
    },
    {
      "name": "Scheduler",
      "href": "/system/scheduler"
    }
  ],
  "/production/reconciliation": [
    {
      "name": "Monthly close",
      "href": "/production/reconciliation"
    },
    {
      "name": "Actual entry",
      "href": "/production/reconciliation/actuals"
    },
    {
      "name": "Weekly drift",
      "href": "/production/reconciliation/drift"
    },
    {
      "name": "Close history",
      "href": "/production/reconciliation/history"
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
