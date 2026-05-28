# Vendor + Customer Master — Design Critique & Redesign Report

**Date:** 2026-05-28
**Project:** Hari Om Paper 2
**Files in scope:** `/master/vendors` (aliased to `/master/suppliers`), `/master/customers`.
**Mockups:** `mockups/master-redesign/{index,vendor-master,customer-master}.html`. Open `mockups/master-redesign/index.html`.

---

## 0. TL;DR

The current vendor/customer screens treat a relationship master as an HTML form. They show *who*, but not *who matters, why, or what we owe them*. The redesign turns each master into a **relationship cockpit**:

1. KPI strip at the top (so the owner sees the shape of the supplier/customer book in one glance).
2. A real data grid with filters, sort, status pills, and inline status toggles.
3. A **detail drawer** that slides in when you click a row — single-column row → tabs (Overview · Contacts · Addresses · Transactions · Performance).
4. Contacts are nested under their parent, not floating in a separate table.
5. Add-vendor / add-customer is a **modal**, not a right-rail panel — frees up table real estate.
6. CSV import, CSV export, bulk activate/deactivate.
7. Vendor page surfaces **OTIF in, lead time, quality compliance, total spend, last GRN**.
8. Customer page surfaces **OTIF out, open orders, AR outstanding, risk pill, last dispatch, lifetime revenue**.

The mockups are pure HTML + the existing `shared.css` from the reports suite. No build step, no JS.

---

## 1. Critique of the current screens

What the screenshot shows:

- Three competing regions on the same page: a sparse table on the left, a sticky "Create vendor details" panel on the right (~30% of the viewport), and a "Selected vendor" contact strip wedged at the bottom.
- Vendor row shows: Vendor name + code, GST (`-`), PAN (`-`), Address (free text), and two icons (edit / power-off).
- No KPIs. No filters beyond a tiny search box. No sort indicators on the column headers. No bulk actions. No export.
- The "Add vendor" panel sits there permanently consuming pixels, whether or not the user wants to add a vendor.
- The "selected vendor" contact section is **physically detached** from the parent row — the spatial relationship between vendor and its contacts is broken.
- Edit happens inline via a pencil icon, but there is no visible "save / discard" affordance in the row.
- The `power-off` icon has no label or tooltip; it's not obvious whether it deactivates or deletes.
- No primary-contact concept; the contact list is a flat array.
- No transactional context at all — you can't see how much we've bought from a vendor, when, or whether they were on-time.
- The same UI is used for the customer page (it's a copy of the vendors page with renamed fields), so the same problems apply.

Specific pain points captured from the screen:

| # | Problem | Impact |
| --- | --- | --- |
| 1 | Add-form panel is always visible | Wastes ~30% of the viewport when not adding. |
| 2 | Contact section visually divorced from parent | Users don't realise the contacts belong to the row above. |
| 3 | No KPI / overview strip | Owner has no idea how the supplier book is composed. |
| 4 | No filters beyond search | Cannot answer "show me all inactive parchment vendors". |
| 5 | No transactional signals | Cannot answer "which vendor is hurting OTIF this month?". |
| 6 | Power-off icon is unlabelled | Activation/deactivation is risky. |
| 7 | No bulk import | Onboarding a new plant means typing every row by hand. |
| 8 | No bulk activate/deactivate | Year-end cleanup is one-row-at-a-time. |
| 9 | No primary-contact concept | Any of N contacts could be the "the person to call". |
| 10 | Same shell for vendors and customers | OK as code reuse, terrible for UX — the two relationships need different signals. |

---

## 2. System design — the redesign

### 2.1 Page anatomy

Both pages share the same skeleton:

```
┌────────────────────────────────────────────────────────────────────┐
│  HERO BAR   eyebrow · title · 4 KPI tiles (relationship-specific) │
├────────────────────────────────────────────────────────────────────┤
│  FILTER SPINE   search · category · status · state · import · export · + New │
├────────────────────────────────────────────────────────────────────┤
│  DATA GRID   sortable columns · status pills · row-click → drawer │
├──────────────────────────────────────┬─────────────────────────────┤
│  Grid continues                       │  DETAIL DRAWER             │
│                                       │  (slides in when a row is  │
│                                       │   selected, otherwise hidden) │
│                                       │  Tabs: Overview · Contacts │
│                                       │  · Addresses · Transactions │
│                                       │  · Performance              │
└──────────────────────────────────────┴─────────────────────────────┘
```

### 2.2 KPI tiles (top of each page)

**Vendor master KPIs**
| Tile | Source | Why it matters |
| --- | --- | --- |
| **Total active vendors** | count rows where `is_active` | Health of the supplier book. |
| **Lifetime spend (12mo)** | sum of GRNs × rate | Concentration / negotiation leverage. |
| **Vendor OTIF (in)** | avg of `received_on - po_due_date <= 0` | Did our suppliers deliver on time? |
| **Quality compliance** | passed inspections / total inspections | Inbound quality drift. |

**Customer master KPIs**
| Tile | Source | Why it matters |
| --- | --- | --- |
| **Total active customers** | count rows where `is_active` | Demand side of the book. |
| **Open AR (₹)** | sum of unpaid invoices | Working-capital pressure. |
| **OTIF (out, 30d)** | reuse the reports OTIF math | Service posture. |
| **At-risk customers** | count where `risk in {watch, critical}` | Who needs a phone call. |

### 2.3 Filter spine

- Free-text search across `code`, `name`, `gst`, `pan`, `phone`, `email`, `address`.
- Category select (RM supplier / Parchment / Adhesive / Packaging / FG buyer / Service vendor).
- Status select (Active / Inactive / All).
- State select (GST-based, optional).
- "Show only with overdue items" toggle (vendor side) / "Show only with open AR" toggle (customer side).
- **Export CSV** — downloads the currently-filtered slice.
- **Import CSV** — opens a modal that lets the user paste/upload, with a preview-then-commit step.
- **+ New** — opens a modal for fast vendor/customer creation.

### 2.4 Data grid

**Vendor grid columns**: Code · Name · Category · GST · PAN · Primary contact · Last GRN · Lifetime spend · OTIF · Status · Actions.

**Customer grid columns**: Code · Name · Risk · Primary contact · Open orders · Outstanding ₹ · OTIF · Last dispatch · Status · Actions.

- Status pill: `ACTIVE` (emerald) / `INACTIVE` (slate) / `WATCH` (amber) / `CRITICAL` (rose).
- Row action overflow menu: Edit · Deactivate · Delete (soft-delete with reason).
- Click a row → opens the **detail drawer** on the right.
- Click the column header → sorts; second click reverses.
- Multi-select checkbox column on the left for bulk activate/deactivate.

### 2.5 Detail drawer (the key UX win)

Drawer slides in from the right (≈480 px wide) when a row is selected. The grid stays visible on the left so the user keeps context. Drawer has five tabs:

1. **Overview** — Code · Name · Category · GST · PAN · Address · Primary contact · "since" date · last-updated audit row.
2. **Contacts** — primary contact at the top with a "primary" pill. Other contacts listed below with inline edit. "+ Add contact" at the bottom.
3. **Addresses** — billing + ship-to (customer) / billing + pickup (vendor). Multiple addresses with default flag.
4. **Transactions** — last 10 GRNs (vendor) / last 10 orders (customer). Each row links into the existing detail surface.
5. **Performance** — small metric strip with the relationship-specific KPIs (vendor: OTIF / lead time / defects; customer: OTIF / NPS / payment cycle days).

Drawer footer: "Edit" → switches the tab into edit mode (saves to the same endpoint as the table inline edit). "Deactivate" with confirmation. "Delete" only enabled when there are no open transactions.

### 2.6 Modals (instead of right-rail forms)

- **+ New vendor** — modal with vendor name, code, category, GST, PAN, address, primary contact (name + phone + email). Two-column compact layout. Save button at the bottom right.
- **+ New customer** — same shape with customer-specific fields (credit limit, default payment terms, ship-to address).
- **Import CSV** — drop zone + paste textarea → preview table → commit button. Reports per-row validation errors before commit.

### 2.7 Data shape that powers the redesign

The current backend exposes:

- `GET /api/master/vendors` (and similarly for customers)
- `POST/PUT/DELETE /api/master/vendors/{id}`
- `GET /api/master/vendors/{id}/contacts`
- `POST/PUT/DELETE /api/master/vendors/{id}/contacts/{contactId}`

What we need to add for the redesign (deferred until UI approval):

- `category` column on `vendor` / `customer` (nullable, enum).
- `is_active` column (already exists conceptually but should be a real column rather than the power-off "delete" path).
- `primary_contact_id` column on `vendor` / `customer` (FK into the contacts table).
- A roll-up endpoint per master: `GET /api/master/vendors/summary` and `GET /api/master/customers/summary` — returns the KPI strip values + per-vendor / per-customer aggregates (last GRN date, lifetime spend, OTIF, etc.) in a single call.
- CSV import endpoint: `POST /api/master/vendors/import` accepting a multipart CSV, dry-run preview mode.

### 2.8 What's intentionally NOT in scope for the mockups

- Wiring backend endpoints. (Mockups are presentation-only; wiring comes after the mockups are approved.)
- Multi-currency / FX. Indian rupees only.
- Per-contact role taxonomy. We just have "primary" vs not.
- Email / phone validation rules — handled at save time by Pydantic, not visible in the mockup.

---

## 3. What the user sees

Open `mockups/master-redesign/index.html` and pick one of the two mockups:

- **`vendor-master.html`** — vendor cockpit.
- **`customer-master.html`** — customer cockpit.

Each mockup shows two states simultaneously:

1. Top half: the grid + filter spine, with the row "ABC Tube Industries" selected.
2. Bottom half (drawer area): the detail drawer in its open state, with all five tabs collapsed-but-visible so the reviewer can see the full information architecture in one screenshot.

Also includes:

- One floating preview of the "+ New vendor" modal at ~70% opacity at the bottom-right so the create flow is visible without leaving the page.
- One floating preview of the "Import CSV" modal on the customer mockup.

---

## 4. Implementation plan (post-approval, NOT done in this pass)

If the mockups are approved, the wiring phase is:

1. **Backend**
   - Add `category`, `is_active`, `primary_contact_id` columns + Alembic migration.
   - Add `GET /api/master/vendors/summary` and `GET /api/master/customers/summary` aggregate endpoints.
   - Add CSV import endpoints with dry-run mode.
   - All endpoints honour the existing plant-scope + RoleGate patterns.
2. **Frontend primitives** (small additions)
   - `DataGrid` component with sortable headers + selection state.
   - `DetailDrawer` component with tab strip.
   - `Modal` component (or extend the existing dialog primitive).
   - `CsvImport` component (paste / upload, preview, commit).
3. **Pages**
   - Rebuild `/master/vendors` against the new primitives.
   - Rebuild `/master/customers` against the new primitives.
   - `/master/suppliers` continues to re-export `/master/vendors` for backwards-compat.
4. **Verification**
   - `tsc` clean.
   - `next lint` clean.
   - `next build` succeeds with new routes.
   - Manual smoke through the full Add → Edit → Add Contact → Deactivate → CSV Import cycle.

---

## 5. Recommendation

Approve the mockups. The redesign:

- Stays within Hari Om's existing tech (no new deps).
- Reuses the reports-suite shared.css so the design language stays unified.
- Makes the vendor/customer book a relationship cockpit instead of an HTML form.
- Surfaces operational truth (OTIF, AR, last transaction) where it belongs — right next to the relationship.
- Backwards-compatible: every existing endpoint is reused; only additive backend work is needed (one summary endpoint per master + three new columns + CSV import).

Once you greenlight, the wiring work is ~1 day for the backend additions and ~1-2 days for the frontend pages.
