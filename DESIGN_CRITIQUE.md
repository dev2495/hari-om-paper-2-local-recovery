# Hari Om Paper TubeOS — Full System Design Critique

**Reviewed:** Web UI (`apps/web-ui`) — live app at `localhost:13000` plus source code.
**Focus:** Foundation, consistency, accessibility, page-level polish, and a concrete roadmap to a cohesive, beautiful system.
**Reviewer:** Design critique pass (April 18, 2026).

---

## Executive summary

You have a genuinely ambitious design direction — a premium glass-on-cream aesthetic with a teal/amber identity, strong numeric typography, and a clear "control room" framing. That identity *works*. The rendered Specifications screen has a confident shape: big typographic numbers for factory-floor scanning, a two-column split between commercial inputs and computed reference, and a clear adhesive breakdown block.

But the system as it stands today is **~60% of the way to that vision, held back by three structural problems**:

1. **Token drift.** A disciplined HSL token layer exists in `globals.css`, but the pages almost never consume it. They hardcode Tailwind palette classes (`slate-950`, `cyan-950`, `amber-900`, `rose-200`…) and even raw hex (`#cfd9e6`, `#e6dccd`, `#faf6ee`) directly in JSX. Every page re-decides what "primary" looks like, so the system looks close but never the same twice.
2. **Primitives ignored.** `components/ui/button.tsx` and `components/ui/input.tsx` exist with six variants and solid defaults — the most important screen (`SpecSheetDocument`, 2,754 lines) uses raw `<button>` and `<select>` elements instead. There is no `Table`, `Select`, `Badge`, `Tooltip`, `Label`, `FormField`, `Toast`, or `Separator` primitive at all.
3. **Decoration overload.** Eyebrow labels (10–11 px, uppercase, 0.18–0.30 em tracking) were a strong accent; they now appear 6–10 times per page and have stopped being hierarchy. Shadow, radius, gradient, and blur are all used at intensity on every card at once — so nothing elevates.

Fix those three, and the rest of the polish falls into place quickly. The client will read the result as "finished," not "in progress."

---

## Overall impression (2-second test)

**What draws the eye first on the live `/specifications/new` screen:** the left card stack — "MND-110.65-110×122×150" in bold display type, followed by "110.65 mm / 0.910 / 247.69 g." That's **correct**; computed reference is the most valuable read.

**What competes unfairly:** the eyebrow labels (`CLIENT REQUIREMENT`, `MATERIAL RULE SHEET`, `SHEET REFERENCE`, `MANDREL ID BAND`, `RECIPE-LED OD`, `WET DIVISOR`, `PAPER`, `WET / DRY TUBE`, `DRY DELTA`, `ALLOWED PARCHMENT FAMILIES`, `ADHESIVE BREAKDOWN`, `2 SELECTED`, `RATIO 100%`) — I count 13+ in one viewport, all styled the same. They flatten to background noise.

**Emotional read:** premium, considered, a little overcooked. The cream background + teal accent is on-brand for paper manufacturing and differentiates from generic "SaaS dashboard blue." Keep it.

**Clarity of purpose:** good. "Start with the commercial ask. The whole sheet derives from this block." is an excellent operator prompt. Keep copy like this — it teaches the mental model.

---

## What works well — keep these

- **Identity.** The cream/teal/amber trio is distinctive and appropriate for the domain.
- **Numeric display.** `text-3xl … tracking-tight` for computed numbers with tiny contextual labels below is excellent for factory-floor readability.
- **Status taxonomy.** `lib/erp-appearance.ts` centralizes status-badge styling for 25+ states with icon, color, dot, and border. That's a real design-system artifact. Protect it.
- **Shell pattern.** `ExecutiveHero` + `MetricRail` + `Panel` + `StatusBadge` + `EmptyState` in `components/erp/shell.tsx` is the right move for an ERP. Use it everywhere it isn't already.
- **Sidebar collapse model.** Hover-to-expand with a pin toggle is a good space-saving pattern for a nav with 10+ items.
- **Copy voice.** "Balanced within band," "Outside tolerance," "Adhesive weight updates from the live paper total only" — the microcopy teaches. Don't lose this when rationalizing.
- **Module appearance map** (`MODULE_APPEARANCES`) that pairs eyebrow + title + description + gradient per module is a nice unifier.

---

## Foundation gaps — fix these first

Everything downstream depends on this layer. Every hour spent here saves five hours of per-page polish.

### 1. Token drift — the single highest-leverage fix

Your `globals.css` defines a clean HSL token layer:

```css
--background: 43 47% 96%;       /* cream */
--foreground: 220 30% 12%;      /* near-black */
--primary:    192 76% 31%;      /* teal-800 */
--accent:     22 80% 63%;       /* warm orange */
--muted:      34 37% 93%;
--border:     36 29% 84%;
--ring:       192 76% 31%;
```

And `tailwind.config.js` wires them to `bg-primary`, `text-foreground`, `border-border`, etc. **Almost nothing uses them.**

Grep hits in the codebase:
- `bg-slate-950`, `text-slate-950`, `border-slate-200`, `bg-slate-50` — hundreds of occurrences.
- `bg-cyan-950`, `text-cyan-700`, `border-cyan-200` — dozens.
- `amber-900`, `emerald-50`, `rose-200`, `indigo-500`, `violet-950`, `sky-500`, `teal-600`, `orange-600` — all appear.
- Raw hex in `SpecSheetDocument.tsx`: `#cfd9e6`, `#d6dfeb`, `#d9e2ef`, `#e2d5bf`, `#e4ebf3`, `#e6dccd`, `#faf6ee`, `#f6eedf`.

**Consequences visible in the screenshot:**
- Login page uses `teal-600` focus rings. Layout uses `cyan-700/70` and `cyan-950`. Primary `--ring` token resolves to `hsl(192 76% 31%)`. Three cyans on three screens, none the same.
- The Specifications hero card is `#e6dccd / #faf6ee`; the `erp-panel` utility is `rgba(255,255,255,0.76)`; the `Card` primitive is `bg-card` = `hsl(0 0% 100%)`. Three surfaces that should read as "white card" read as three different creams.

**Severity:** 🔴 Critical. This is why the app feels "close but not the same" from screen to screen.

**Fix:**

1. Freeze a real palette (see Appendix A) and expand the token set to include `surface-raised`, `surface-sunken`, `surface-inverted`, `border-subtle`, `border-strong`, `text-subtle`, `text-muted`, `success`, `warning`, `danger`, `info`.
2. Add a lint rule (`eslint-plugin-tailwindcss` with a custom allowlist) that forbids raw palette classes and raw hex in JSX — only token classes allowed, with exceptions for data-viz palettes.
3. Do one bulk codemod: `slate-950 → foreground`, `slate-600 → text-muted-foreground`, `slate-200 → border`, `cyan-*` accents → `primary`, etc.
4. Delete the `.panel`, `.hero`, `.card`, `.button`, `.input`, `.field`, `.page-shell` utility classes in `globals.css` — they're legacy from the login page and collide with Tailwind class names.

### 2. Typography system is unfinished

**Problems:**
- Font stack: `--font-heading: "DIN Alternate", "Trebuchet MS", "Avenir Next", sans-serif`. DIN Alternate ships only on Apple platforms. Windows falls back to Trebuchet MS (a very different tone); Linux/Chrome OS falls back to generic sans-serif. **No web font is loaded.** The brand look doesn't travel.
- No type scale. Sizes appear as `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl`, `text-6xl`, plus inline `text-[10px]`, `text-[11px]`, `text-[1.35rem]`, `text-[2rem]` — at least 14 distinct sizes in play.
- Uppercase eyebrow pattern is overused: `text-[10px]|[11px] font-bold|semibold uppercase tracking-[0.14em|0.16em|0.18em|0.22em|0.24em|0.28em|0.30em|0.32em]` — 8 different tracking values for what should be one eyebrow style.

**Severity:** 🟡 Moderate.

**Fix:**

Self-host a pair of web fonts via `next/font`. Recommended:

```tsx
// app/layout.tsx
import { Inter, Space_Grotesk } from "next/font/google"
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" })
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" })
```

Then codify a type scale (names matter — they become vocabulary):

| Token                | Size     | Line-height | Weight | Tracking  | Use                               |
|----------------------|----------|-------------|--------|-----------|-----------------------------------|
| `display-xl`         | 56 / 60  | 1.02        | 600    | -0.03 em  | Dashboard hero H1                 |
| `display-lg`         | 40 / 44  | 1.05        | 600    | -0.03 em  | Page titles                       |
| `display-md`         | 32 / 36  | 1.1         | 600    | -0.02 em  | Panel titles                      |
| `heading-lg`         | 24 / 28  | 1.2         | 600    | -0.01 em  | Section titles                    |
| `heading-md`         | 20 / 24  | 1.25        | 600    | 0         | Card titles                       |
| `heading-sm`         | 16 / 20  | 1.3         | 600    | 0         | Sub-section titles                |
| `metric-xl`          | 48 / 52  | 1           | 600    | -0.02 em  | KPI numbers                       |
| `metric-lg`          | 32 / 36  | 1           | 600    | -0.02 em  | Computed numbers                  |
| `body-lg`            | 16 / 24  | 1.5         | 400    | 0         | Form field values, descriptions   |
| `body-md`            | 14 / 22  | 1.5         | 400    | 0         | Table cells, default body         |
| `body-sm`            | 13 / 20  | 1.5         | 400    | 0         | Secondary copy                    |
| `caption`            | 12 / 16  | 1.35        | 500    | 0         | Helper text                       |
| `eyebrow`            | 11 / 14  | 1.2         | 600    | +0.14 em  | Section eyebrows (one style only) |
| `label`              | 13 / 18  | 1.3         | 500    | 0         | Form labels                       |
| `mono`               | 13 / 20  | 1.5         | 500    | 0         | Codes, IDs, machine tags          |

**Rule: eyebrows appear at most once per panel.** Chip/pill labels (`2 SELECTED`, `RATIO 100%`, allowed-parchment chips) should use sentence case, not an eyebrow style.

### 3. Color system is fragmented

You have at least **nine** coexisting color ramps: slate, cyan, teal, sky, emerald, amber, orange, rose, violet, indigo. That is a palette for an illustration app, not a manufacturing ERP.

| Purpose         | Current reality                                    | Proposed single source         |
|-----------------|----------------------------------------------------|--------------------------------|
| Neutrals        | `slate-*` (everywhere)                             | `neutral-*` (use slate as-is, alias it) |
| Brand / primary | `cyan-*`, `teal-*`, `sky-*`                        | `primary-*` (one cyan ramp)    |
| Accent          | `amber-*`, `orange-*`                              | `accent-*` (one amber ramp)    |
| Success         | `emerald-*`                                        | `success-*`                    |
| Warning         | `amber-*` (conflicts with accent!)                 | `warning-*` (split from accent)|
| Danger          | `rose-*`                                           | `danger-*`                     |
| Info            | `sky-*`, `indigo-*`, `violet-*`                    | `info-*`                       |
| Stage: Winder   | `cyan-*`                                           | `stage-winder` (bind to info)  |
| Stage: Oven     | `orange-*`                                         | `stage-oven` (bind to warning) |
| Stage: Process  | `indigo-*`                                         | `stage-process`                |
| Stage: Packing  | `emerald-*`                                        | `stage-packing` (bind to success) |
| Stage: QC       | `amber-*`                                          | `stage-qc` (bind to warning)   |
| Stage: Dispatch | `sky-*`                                            | `stage-dispatch` (bind to info)|

**Severity:** 🟡 Moderate.

**Fix:** Seven semantic roles + six stage colors. Everything else becomes neutral. Document the mapping once in `lib/design-tokens.ts` and have `STAGE_APPEARANCES` and `STATUS_APPEARANCES` consume it.

### 4. Radius overload

Distinct border-radius values found in the codebase:
`rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full`, and bracket values: `rounded-[10px]`, `[12px]`, `[20px]`, `[28px]`, `[30px]`, `[32px]`, `[34px]`, `[1rem]`, `[1.15rem]`, `[1.2rem]`, `[1.25rem]`, `[1.3rem]`, `[1.35rem]`, `[1.4rem]`, `[1.5rem]`, `[1.55rem]`, `[1.6rem]`, `[1.7rem]`, `[1.75rem]`, `[2rem]`.

**That's 20+ radii.** `var(--radius)` is defined as `0.85rem` and almost nobody consumes it.

**Severity:** 🟡 Moderate — visible inconsistency.

**Fix:** Collapse to five tokens and forbid arbitrary values:

| Token        | Value     | Use                                     |
|--------------|-----------|-----------------------------------------|
| `radius-xs`  | 6 px      | Tags, inline pills                      |
| `radius-sm`  | 10 px     | Inputs, buttons, small controls         |
| `radius-md`  | 16 px     | Cards, small panels                     |
| `radius-lg`  | 24 px     | Major panels, dialogs                   |
| `radius-xl`  | 32 px     | Hero / framing surfaces only            |
| `radius-full`| 9999 px   | Pills, avatars, round chips             |

### 5. Shadow inflation

`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-inner`, `shadow-premium`, `shadow-premium-hover`, plus a generous number of inline arbitrary shadows (`shadow-[0_24px_80px_rgba(15,23,42,0.24)]`, `shadow-[0_20px_70px_rgba(15,23,42,0.12)]`, `shadow-[0_20px_60px_rgba(15,23,42,0.07)]`, `shadow-[0_18px_50px_rgba(15,23,42,0.06)]`, `shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]`).

The premium-shadow pattern (heavy inset + heavy drop) is on **every panel**. If everything elevates, nothing does.

**Severity:** 🟡 Moderate.

**Fix:** Three shadows total.

```css
--shadow-1: 0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.04);   /* resting */
--shadow-2: 0 6px 16px -4px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.05); /* cards */
--shadow-3: 0 20px 50px -20px rgba(15,23,42,0.25), 0 8px 16px -8px rgba(15,23,42,0.10); /* modals, popovers */
```

Reserve `shadow-3` for floating surfaces (modal, popover, toast, dropdown). Default cards get `shadow-2`. Inline surfaces get `shadow-1` or none. Delete the `shadow-premium*` tokens.

### 6. Spacing scale

No tokens beyond Tailwind's default. That's fine — just make a rule:

- Inside a card: use multiples of `4 px` from 4 to 24 (`p-1` .. `p-6`).
- Between cards in a column: always `gap-6` (24 px).
- Between sections on a page: always `gap-8` (32 px) or `space-y-7` once system-wide.
- Page container: `max-w-[1680px]` (already used in layout — good). Inner padding: `px-4 md:px-6`. Keep this.

Current reality: `space-y-5`, `space-y-6`, `space-y-7`, `gap-2`, `gap-3`, `gap-4`, `gap-5`, `gap-6`, `gap-8`, all mixed. Pick two vertical rhythms (inner = 6, outer = 8) and enforce.

### 7. Motion

One keyframe (`animate-enter-up`), used only for toasts. Everywhere else: `transition`, `transition-all`, `transition-colors`, with durations `150`, `200`, `220`, `300` mixed. No easing consistency.

**Severity:** 🟢 Minor now, but critical for the "premium" feel.

**Fix:** Three durations, two easings.

```css
--ease-out:   cubic-bezier(0.2, 0.8, 0.2, 1);   /* enter, hover */
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1);   /* complex transforms */
--dur-fast:   120 ms;    /* hover, focus, color */
--dur-base:   220 ms;    /* panel, popover, tab switch */
--dur-slow:   380 ms;    /* modal, drawer */
```

Respect `prefers-reduced-motion` by wrapping all non-essential motion in a media query.

---

## Component gaps

### Primitives that exist but are bypassed

| Primitive | Where it exists | Where it's skipped |
|-----------|-----------------|--------------------|
| `Button`  | `components/ui/button.tsx` — 6 variants, 4 sizes | Login, SpecSheetDocument (all action buttons are raw `<button>`), most pages override className so aggressively the variant is meaningless |
| `Input`   | `components/ui/input.tsx` | SpecSheetDocument, JobCards, most forms use raw `<input>` with `h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm` or similar. The primitive is essentially dead code. |
| `Card`    | `components/ui/card.tsx` | Used ~zero times in the app; everyone uses `<section className="rounded-[…] border border-… bg-white/… p-… shadow-…">` inline |

### Primitives that are missing entirely

| Missing    | Needed for                                                                             |
|------------|----------------------------------------------------------------------------------------|
| `Select`   | Every dropdown (Radix Select or a custom headless wrapper) — replace native `<select>` |
| `Combobox` | Customer picker, mandrel picker, paper picker (these have 100+ options)                |
| `Label`    | Proper `<label htmlFor>` with consistent spacing                                       |
| `FormField`| Label + input + helper + error, one primitive                                          |
| `Badge`    | Tone variants beyond `StatusBadge`'s status-only use                                   |
| `Table`    | One headless table primitive — CrudTable and every hand-rolled `<table>` consume it    |
| `Tooltip`  | Currently using the native `title` attribute. Replace with Radix Tooltip.              |
| `Popover`  | For combobox, filter stacks                                                            |
| `Toast`    | Currently inline JSX in the layout. Use Radix Toast or `sonner`.                       |
| `Skeleton` | The layout has one inline pulse skeleton; generalize it.                               |
| `Separator`| Replace the manual `border-b` divs                                                     |
| `Kbd`      | For keyboard shortcuts in the command palette (see below)                              |
| `Alert`    | The amber/rose/cyan inline alert divs are rebuilt per page                             |

### Action recommended: rebuild the primitives as a real design system

Option A (pragmatic, fast): adopt `shadcn/ui` properly — you already have Radix + CVA + Tailwind. Copy-paste the rest of the primitives (`select`, `popover`, `command`, `dropdown-menu`, `tooltip`, `table`, `badge`, `label`, `alert`, `skeleton`, `separator`, `toast`). 3–4 days of work.

Option B (branded): wrap shadcn/ui with brand tokens so the primitives already look like TubeOS.

Either way, **gate merges on primitive usage** (ESLint rule: no raw `<button>`, `<input>`, `<select>`, `<table>` in `app/` or `components/forms/`).

---

## Page-by-page critique

### Login (`/login`)

Visually the strongest screen — dark left panel + light right form + teal accents is confident and on-brand.

| Finding                                                                                               | Severity   | Fix                                                                                 |
|-------------------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------|
| Uses a completely different palette and radii from the rest of the app (`teal-600`, `rounded-[32px]`) | 🟡 Moderate | Migrate to tokens after the foundation fix — keep the visual treatment, change the source |
| Demo credentials prefilled in state (`"admin@hariom.com" / "admin123"`)                               | 🟡 Moderate | Either gate behind `NODE_ENV !== "production"` or add a visible "Demo login" button |
| No forgot-password, no MFA path                                                                       | 🟢 Minor    | Design stubs for these flows now, wire later                                        |
| No "Signing in…" spinner, only text swap                                                              | 🟢 Minor    | Add a small spinner next to the text                                                |
| `h-12 w-full rounded-2xl border border-slate-200 bg-slate-50` input is inconsistent with the rest of the app's `rounded-lg border-[#cfd9e6] bg-white` input | 🟡 Moderate | Tokenize, single Input primitive |
| The "Scope / Planning / Accounting" preview tiles are decorative and don't set real expectation       | 🟢 Minor    | Either make them rotate through real stat snapshots, or replace with a small product-benefit list |

### Dashboard (`/dashboard`)

| Finding | Severity | Fix |
|---|---|---|
| Hero gradient `from-slate-950 via-cyan-950 to-amber-900` is gorgeous but doesn't match the `MODULE_APPEARANCES.dashboard.accent` (`from-cyan-950 via-sky-800 to-emerald-500`) — the dashboard's hero is bespoke and doesn't use `ExecutiveHero` | 🟡 Moderate | Use `ExecutiveHero` on the dashboard. If the current gradient is preferred, update `MODULE_APPEARANCES.dashboard` to match. |
| 9 workspace cards shown in a 3×3 grid with identical visual weight and identical hover animation | 🟡 Moderate | Group them: "Operate" (Sales, Planning, Production, Dispatch), "Know" (Inventory, Analytics), "Define" (Specs, Masters, System). Add subtle separator labels. |
| `Live runtime is using BFF 14000, web 13000, and direct service ports 18001-18008` at the bottom — this is developer chrome leaking into user UI | 🔴 Critical | Remove in prod build or hide behind `process.env.NODE_ENV === "development"` |
| No actual KPIs on the dashboard — just a menu | 🟡 Moderate | Replace 3 of the 9 workspace cards with MetricCards (Open orders, Due-today job cards, RM days-of-supply). Keep the grid, just mix in signal. |
| The text `text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-100` on dark gradient is ~3.8:1 contrast — fails WCAG AA for small text | 🟡 Moderate | Lift to `text-cyan-50` or `text-white/90` |

### Sales Orders (`/sales-orders`)

Good shell usage (`ExecutiveHero` + `MetricRail` + `Panel`). Two specific issues:

| Finding | Severity | Fix |
|---|---|---|
| Release-planning dialog opens inline in the same page; its draft rows are built in local state. Complex enough to deserve its own surface (drawer or dedicated route) | 🟡 Moderate | Turn into a right-side drawer; let operator see the SO context while choosing winder + qty |
| Search uses `<input className="w-64 bg-transparent text-sm outline-none">` — no focus ring, no keyboard affordance | 🟡 Moderate | Use `Input` primitive or wrap with the same focus treatment as the header search |
| No date range filter on SO list; only text search + deferred filter | 🟢 Minor | Add a date-range picker (needed for month-end ops) |

### Job Cards (`/production/job-cards`)

The table is where operators will spend real time. It has issues.

| Finding | Severity | Fix |
|---|---|---|
| 3 stacked `StatusBadge`s in the "Current Stage" column make each row ~120 px tall and visually noisy | 🟡 Moderate | Combine into one badge with a stage + status compound ("Winder · Planned"); expose the planner-gate reason as a small warning chip only when not READY |
| Table has no column sorting, no column visibility control, no pagination — just a 250-row cap | 🔴 Critical for scale | Adopt `@tanstack/react-table` (headless) + one `<Table>` primitive. Add sorting, filtering, pagination, and saved views |
| Raw `<select>` for status filter — native styling on macOS vs Windows looks very different | 🟡 Moderate | Replace with Radix Select |
| "No target winder", "No shift", "No plan date" fall-throughs aren't visually differentiated from real values; they look equally authoritative | 🟡 Moderate | Use muted foreground + italic, or a "—" dash with a tooltip explaining what's missing |
| The search field + status select are right-aligned in a `Panel`'s action slot; on mobile they wrap under the title and look abandoned | 🟢 Minor | Move filters into a `StickyFilterBar` below the hero (already defined in `shell.tsx`, used elsewhere) |

### Specifications → New (`/specifications/new`) — the screenshot

This is the most business-critical screen and the most over-decorated one.

**Working well:**
- Two-column commercial-vs-computed layout is correct.
- Big computed numbers read instantly.
- The adhesive breakdown's dual-input pattern (name + ratio) is clear.
- The "Ratio 100%" pill is a smart live-validation nudge.

**Problems ranked by severity:**

| Finding | Severity | Fix |
|---|---|---|
| 13+ eyebrow labels in one viewport | 🔴 Critical | Reduce to 2: one per column header ("Client requirement" / "Material rule sheet"). Use sentence-case labels on tiles ("Sheet reference", "Mandrel ID band"). |
| 4 "computed reference" tiles look identical to the editable dropdowns above them — user can't tell what's clickable vs output | 🔴 Critical | Visually separate: computed tiles get no border, `bg-muted/60`, a small "computed" chip, and a subtle calculator icon. Editable fields keep the bordered-input treatment. |
| "Sheet Reference" card styled at display-text weight but is a derived string — competes with the dashboard hero H1 for importance | 🟡 Moderate | One notch smaller (`metric-lg` not `display-md`) |
| "-250.00 g / Outside tolerance" — the single most critical alarm on the page — is styled as a muted peach tile, not an alert | 🔴 Critical | Use `danger` tone: filled red/rose background, white text, AlertTriangle icon, and an explicit one-click "Why?" that links to the tolerance band explanation |
| All form fields are `rounded-2xl` with hex border `#cfd9e6` and white bg — the visual affordance for "editable" is almost invisible on a cream page | 🔴 Critical | Add a subtle bg tint (`bg-input` token) and stronger idle border; raise focus to a 2 px teal ring with offset (already tokenized, just use it) |
| `MasterLinkRow` (Customer master / Tube sizes / Mandrels) links are placed immediately after the section title, suggesting navigation, not "open this master in a new tab to check data" — low discoverability | 🟡 Moderate | Move to a secondary "Related masters" chip strip in a sidecar, or use `<ExternalLink>` icon to make the intent explicit |
| "Add Component" button at the bottom right of the adhesive card is styled differently from the "Save Draft" button in the header (dark pill vs dark pill vs outline vs white-with-border — 4 button variants on one screen) | 🟡 Moderate | Codify 3 variants: primary (dark), secondary (white+border), ghost (transparent+hover). Destructive (obsolete, remove) gets its own. Kill everything else. |
| The header strip with "Glue 15.0% / Parchment 1.5% / Wet divisor 0.910" uses chips — but these are read-only computed values, not filters. Readers try to click them. | 🟢 Minor | Drop the chip affordance; render as `label: value` inline text under the H1 |
| Right-column "Allowed parchment families" chips (AMMA, CHINA, SAGAR) are multi-select but don't read as selectable — the active state is also a subtle yellow that doesn't stand out. | 🟡 Moderate | Use `ToggleGroup` (Radix) with an obvious active fill and a check icon on selected chips |
| The spec document is 2,754 lines in one file. Hard to iterate on design. | 🔴 Critical from a maintenance POV | Decompose into: `SpecHeader`, `ClientRequirementBlock`, `MaterialRuleSheet`, `AdhesiveBreakdown`, `RecipeBuilder`, `ProcessGuidance`, `NotchTooling`, `PackingRules`, `TrialPanel`, `SpecActions`. Each <300 lines. |

### Masters (CRUD tables)

The `CrudTable` component has a lot of structure (workspace-nav, describe card, stat card, search, table) packed into one page — it looks important but fights for attention on a page that should be a quiet database editor.

| Finding | Severity | Fix |
|---|---|---|
| Workspace-nav pill strip + Master Data Workspace section + stat card + search bar + table = 4 stacked `rounded-[2rem]` cards before any data | 🟡 Moderate | Collapse to 2: a slim header (title + description + stat inline) and a table panel. Drop the workspace-nav into the layout's breadcrumb. |
| `Plus` icon + "Add New" button is a primary dark pill on slate-900 — primary brand is teal. Every "Add New" in the app is this off-brand slate-black. | 🟡 Moderate | Primary actions use the teal primary token. Reserve slate-black for secondary "open detail" buttons. |
| Hover state on rows (`hover:bg-slate-50/80`) is 80% transparent on cream — barely visible | 🟢 Minor | Use `bg-muted` at full opacity for row hover |
| `filteredData.length === data.length ? "All rows visible" : "${...} of ${...} rows visible"` is a **good** piece of microcopy — keep it | ✅ — | — |
| Edit and delete icon buttons sit in the last column; on tablets the table overflows and users miss them | 🟡 Moderate | Sticky right column, or move actions to a row-click detail view on small screens |

### Header + sidebar (`(dashboard)/layout.tsx`)

| Finding | Severity | Fix |
|---|---|---|
| Collapsed sidebar has no tooltip (it uses the native `title` attribute which appears after a 2-second delay on hover — feels broken) | 🔴 Critical | Wrap each collapsed nav item in a Radix Tooltip with 120 ms delay |
| The quick-nav pill strip (Dashboard, Sales Orders, Job Cards, Specifications) is hidden at `xl` breakpoint and below — users on 15-inch laptops (≈ 1440 px) may not see it | 🟡 Moderate | Show at `lg` or higher; drop the redundant "TubeOS Workspace" label to fit |
| Logout button in header is `variant="outline"` rounded-full — fine. But `PlantSwitcher compact` sits beside it styled as a free-floating div without the same border treatment. | 🟢 Minor | Give both the same pill-chrome |
| The sidebar's "Approval Inbox" block at the bottom is static copy (no real badge, no real count) | 🟡 Moderate | Wire to a real pending-approvals query; if none, hide the block |
| Mobile nav is a drawer that covers the whole screen — the dim overlay is `bg-slate-950/40 backdrop-blur-sm` which is good, but the drawer has its own `erp-panel` treatment with a cream background that feels like "still on the main page." | 🟢 Minor | Give the mobile drawer a distinct surface (dark slate bg, white text) so the context switch is obvious |

### Executive hero (`ExecutiveHero`)

The split-left-copy / right-card pattern is good. But:

| Finding | Severity | Fix |
|---|---|---|
| Right side's inner panel is always dark slate (`bg-slate-950/90`) regardless of module appearance; the outer gradient changes per module (cyan→emerald for sales, slate→indigo for analytics, etc.) — contrast between outer and inner is jarring | 🟡 Moderate | Use a subtle inner tint drawn from the module's accent, not uniform slate |
| On mobile / narrow screens the aside stacks below the copy and becomes a giant dark block; it's not useful there | 🟡 Moderate | Collapse the aside on `< xl` to a one-line summary, or hide entirely |

### Metric rail / cards

| Finding | Severity | Fix |
|---|---|---|
| 6 tone options (`slate/cyan/emerald/amber/rose/violet`) are freely chosen per card without semantic meaning | 🟡 Moderate | Enforce mapping: neutral = slate, positive = emerald, attention = amber, critical = rose. Drop `violet` and `cyan`. |
| KPI icon tile is a heavy gradient (`from-{color}-950 to-{color}-700`) at `p-3` — it dominates the card. The number, which is the point, has to compete with it. | 🟡 Moderate | Lighten the icon tile (soft tint, not gradient), make the number larger |
| No trend arrow, no sparkline, no "vs last period" secondary stat | 🟢 Minor | Add a small delta row (↑ 4% vs last week) under the metric; optional sparkline strip at the card bottom |

### Empty and loading states

| Finding | Severity | Fix |
|---|---|---|
| `EmptyState` is a grey rounded rectangle with a single line of text. No illustration, no icon, no next action. | 🟢 Minor | Add: 1 line of title, 1 line of subtitle, optional CTA button, optional icon. Keep it small. |
| Loading states are inconsistent: sometimes a skeleton (layout.tsx has one), sometimes "Loading…" text, sometimes nothing | 🟡 Moderate | Create `Skeleton` primitive and use it for everything that renders async data |

---

## Accessibility audit (WCAG 2.1 AA)

### Contrast failures observed or likely

- `text-slate-400` on `bg-dashboard-mesh` (nearly-white cream) — ~3.2:1 — **fails AA** for body text (needs 4.5:1). Used for section eyebrows and field captions throughout.
- `text-cyan-100/70` on the dashboard dark gradient — ~3.8:1 — **fails AA** for 11 px text.
- `text-[10px] text-cyan-700/70` on cream — **fails AA** on small text.
- `bg-cyan-50 border-cyan-100 text-cyan-950` info alerts — **passes AA**, good.
- `bg-rose-50 text-rose-700` error alerts — **passes AA**, good.

**Fix:** Pass every `text-slate-400`, `text-slate-500`, and `text-*-100` class through a contrast check against the surface it sits on. Replace failing pairs with `text-muted-foreground` (token, `hsl(220 12% 40%)`) which passes at 4.6:1 on both cream and white.

### Keyboard & focus

- Focus ring token exists (`--ring: 192 76% 31%`). The Button and Input primitives use it (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`). **But most pages use raw `<button>` / `<input>` and skip focus-visible entirely.**
- Sidebar pin toggle, mobile menu button, logout pill, row action icons — none have explicit focus states.
- The collapsed sidebar buttons use `title` for naming — that attribute is announced by screen readers only if there's no visible text and no aria-label, which is unreliable across ATs.

**Fix:** Add `aria-label` to every icon-only button. Add `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2` to all interactive elements. Run an `eslint-plugin-jsx-a11y` pass with rules enabled.

### Labels & forms

- SpecSheetDocument uses `<FieldLabel>` above fields but doesn't associate it via `htmlFor`/`id`. Screen readers don't know the label belongs to the input.
- Boolean fields render as `<select>` with "Yes/No" options — should be checkbox or switch with an accessible label.
- Error messages are shown inline but don't use `aria-describedby` to link back to the offending field.

**Fix:** Build a real `FormField` primitive with `id`, `label htmlFor`, `aria-describedby` for help text and errors, and `aria-invalid` on the input.

### Color-only signaling

- `MetricCard` tones communicate status by color gradient alone. Operators with red-green color deficiency can't tell a "rose" card from an "amber" one on first glance.
- Status badges include an icon — **good**.
- Toast types (success/error/info) include no icon in the shown markup — **bad**.

**Fix:** Add icons to toasts (CheckCircle2 / AlertTriangle / Info). Add an icon or symbol to MetricCard's header when tone is warning/danger.

### Target sizing

- Row action icons (`h-4 w-4` icon in a button with `h-9 w-9` wrapper) — 36 × 36 px. **Below WCAG 2.5.5 AAA minimum of 44 × 44, acceptable at AA.**
- Sidebar collapsed items (`px-0 py-2.5`) — ~36 × 40 px. **Acceptable.**
- Header search input `h-10` — 40 px. **Acceptable.**
- StatusBadge height — ~22 px — it's not a primary target, but if clickable (filtering), needs to be enlarged.

### Motion

No `prefers-reduced-motion` respect anywhere. Toast uses `animate-enter-up`, sidebar has `transition-all duration-300`, dashboard cards have `hover:-translate-y-1`. Users with vestibular disorders will want these suppressed.

**Fix:** Global CSS:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Responsive & density

### Breakpoint gaps

The layout uses `lg:` (1024 px) as the desktop/mobile switch. The iPad Air landscape (~1180 px wide, factory supervisor-use) crosses this — but the tablet portrait (~820 px) falls into mobile view, which squashes the spec sheet into a single column.

**Fix:**

- Design explicitly for 3 classes: phone (<768), tablet (768–1279), desktop (≥1280).
- The spec sheet's 2-column layout should become a tab layout on tablet (Client requirement | Material rule sheet | Adhesive breakdown as sibling tabs) rather than linear scroll.
- Sidebar should auto-collapse at `lg` to `xl` and expand only at `xl`+.

### Data density

For an operational ERP, density is a feature. Two specific asks:

- Add a "compact mode" toggle in user preferences that reduces vertical padding in tables and panels (`p-6` → `p-3`, `h-10` inputs → `h-9`).
- For dashboards and planning views, support a "display-wall" density where font sizes bump up 20% and contrast is pushed for shop-floor screens.

---

## Cross-cutting consistency issues (ranked by business impact)

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 1 | Token drift (hex + palette colors hardcoded everywhere) | Every screen looks subtly different | One codemod pass + lint rule (see Foundation #1) |
| 2 | Primitive bypass (`<button>`, `<select>`, `<input>` raw) | Each screen has its own chrome | Finish shadcn/ui adoption + lint rule (Primitive section) |
| 3 | SpecSheetDocument monolith | Hard to iterate, reproduces its own chrome | Decompose into ~10 named components |
| 4 | Uppercase eyebrow overuse | Flattens hierarchy, "trying too hard" | One eyebrow per panel, sentence case for labels |
| 5 | No Form primitive | Every form rebuilds labels/errors differently | Build `FormField` + `Label` + `FieldError` + `HelpText` |
| 6 | No Table primitive | Every data page has its own table chrome | Build `Table` on tanstack-react-table |
| 7 | No Select/Combobox primitive | Native `<select>` looks wrong on Windows | Adopt Radix Select + `cmdk` Combobox |
| 8 | Inconsistent shadows and radii | Every card feels "slightly different" | 5 radii, 3 shadows (see Foundation #4, #5) |
| 9 | Port numbers in dashboard body | Reveals dev chrome to real users | Gate on NODE_ENV |
| 10 | `localStorage` used directly in layout for sidebar preference | Works, but untyped + no SSR guard | Move to a typed `useLocalStorage` hook, already you have `if (typeof window !== "undefined")` pattern |

---

## Priority roadmap

### P0 — Do first. Unlocks everything else. (≈ 5–7 engineer-days + 3 design-days)

1. **Palette, tokens, and scales.** Define the semantic tokens (surface/text/border/success/warning/danger/info/primary/accent + 6 stage colors). Extend `tailwind.config.js` to expose them. Update `globals.css`.
2. **Type system.** Self-host Inter + Space Grotesk via `next/font`. Codify the 15-row type scale as Tailwind `text-display-lg`, `text-metric-xl`, etc.
3. **Radius + shadow + motion tokens.** Collapse to 5 radii, 3 shadows, 3 durations.
4. **Kill `.panel`/`.hero`/`.card`/`.button`/`.input`/`.field`/`.page-shell` legacy utilities** in `globals.css`.
5. **Add ESLint rules** forbidding raw Tailwind palette colors + raw hex in JSX.

### P1 — Consistency pass. (≈ 8–10 engineer-days)

6. **Finish shadcn/ui adoption**: Select, Combobox, Label, FormField, Badge, Table, Tooltip, Popover, DropdownMenu, Toast, Skeleton, Separator, Alert, Switch, Checkbox, Radio, Dialog-polish, Drawer.
7. **Migrate `SpecSheetDocument` to use Input + Button + Select + FormField primitives.** No direct hex remaining.
8. **Decompose `SpecSheetDocument`** into ~10 named subcomponents.
9. **Unify page shell**: every page opens with `ExecutiveHero` + `MetricRail` (optional) + `Panel`(s). Retire custom page shells in Specifications, Masters, etc.
10. **Unify tables**: `CrudTable`, job-card table, inventory tables all consume `<Table>` primitive built on tanstack-react-table with sort/filter/paginate.

### P2 — Quality pass. (≈ 5–7 engineer-days + 2 design-days)

11. **Accessibility pass**: focus-visible, aria-label on icon buttons, FormField for inputs, contrast fixes, `prefers-reduced-motion`.
12. **Empty / loading / error state system**: `EmptyState`, `Skeleton`, `ErrorBoundary` with illustrations (or minimal icons) and CTAs.
13. **Tooltip replacement** for native `title` attributes across the sidebar.
14. **Responsive pass** for tablet/supervisor devices. Specs sheet tabbed on tablet. Sidebar auto-collapse.
15. **Command palette (⌘K)** — replace the header search with a `cmdk` command palette that surfaces pages + recent records + actions.

### P3 — Polish. (≈ 4–6 engineer-days + 2–3 design-days)

16. **Hero art direction** per module: custom illustration or pattern, not just gradients.
17. **Chart styling pass**: Recharts tokens already exist in `ERP_CHART_THEME`; refine grid/axis/tooltip consistent with the new palette.
18. **Density mode** toggle in user prefs (compact ↔ comfortable ↔ display-wall).
19. **Dark mode**. The token system makes this almost free once P0 is done; operators on night shift will thank you.
20. **Micro-interactions**: panel enter motion, skeleton shimmer, successful-save confetti-free subtle confirmation.

**Total:** ~25–35 engineer-days + ~10 design-days for a complete overhaul. You can ship P0 + P1 in ~3 weeks and the system will already feel dramatically more cohesive.

---

## Concrete code-level fixes (examples)

### Fix 1: extend tokens (drop into `globals.css`)

```css
@layer base {
  :root {
    /* Surface */
    --surface-base:        43 47% 96%;  /* cream page */
    --surface-raised:      0  0% 100%;  /* cards on cream */
    --surface-sunken:      34 37% 93%;  /* inputs / inline wells */
    --surface-inverted:    220 30% 8%;  /* dark panels */

    /* Text */
    --text-primary:        220 30% 12%;
    --text-secondary:      220 12% 40%;
    --text-tertiary:       220 10% 55%;
    --text-inverted:       0 0% 100%;
    --text-placeholder:    220 10% 62%;

    /* Border */
    --border-subtle:       36 29% 88%;
    --border-default:      36 29% 82%;
    --border-strong:       220 10% 60%;
    --border-focus:        192 76% 31%;

    /* Accents (semantic) */
    --primary-500:         192 76% 31%;
    --primary-600:         192 76% 26%;
    --primary-50:          192 80% 96%;
    --accent-500:          22 80% 55%;
    --success-500:         152 55% 36%;
    --success-50:          152 55% 94%;
    --warning-500:         35 85% 48%;
    --warning-50:          35 85% 94%;
    --danger-500:          0 72% 48%;
    --danger-50:           0 72% 96%;
    --info-500:            210 78% 46%;
    --info-50:             210 78% 96%;

    /* Radii */
    --radius-xs: 6px;
    --radius-sm: 10px;
    --radius-md: 16px;
    --radius-lg: 24px;
    --radius-xl: 32px;

    /* Shadows */
    --shadow-1: 0 1px 2px rgb(15 23 42 / 0.06), 0 1px 3px rgb(15 23 42 / 0.04);
    --shadow-2: 0 6px 16px -4px rgb(15 23 42 / 0.10), 0 2px 6px rgb(15 23 42 / 0.05);
    --shadow-3: 0 20px 50px -20px rgb(15 23 42 / 0.25), 0 8px 16px -8px rgb(15 23 42 / 0.10);
  }
}
```

Then in `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      surface: {
        DEFAULT: "hsl(var(--surface-base))",
        raised:  "hsl(var(--surface-raised))",
        sunken:  "hsl(var(--surface-sunken))",
        inverted:"hsl(var(--surface-inverted))",
      },
      fg: {
        DEFAULT:   "hsl(var(--text-primary))",
        secondary: "hsl(var(--text-secondary))",
        tertiary:  "hsl(var(--text-tertiary))",
        inverted:  "hsl(var(--text-inverted))",
      },
      border: {
        DEFAULT: "hsl(var(--border-default))",
        subtle:  "hsl(var(--border-subtle))",
        strong:  "hsl(var(--border-strong))",
      },
      primary:   { DEFAULT: "hsl(var(--primary-500))", 50: "hsl(var(--primary-50))" },
      accent:    { DEFAULT: "hsl(var(--accent-500))" },
      success:   { DEFAULT: "hsl(var(--success-500))", 50: "hsl(var(--success-50))" },
      warning:   { DEFAULT: "hsl(var(--warning-500))", 50: "hsl(var(--warning-50))" },
      danger:    { DEFAULT: "hsl(var(--danger-500))", 50: "hsl(var(--danger-50))" },
      info:      { DEFAULT: "hsl(var(--info-500))", 50: "hsl(var(--info-50))" },
    },
    borderRadius: {
      xs: "var(--radius-xs)",
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
    },
    boxShadow: {
      1: "var(--shadow-1)",
      2: "var(--shadow-2)",
      3: "var(--shadow-3)",
    },
  },
},
```

### Fix 2: a `FormField` primitive

```tsx
// components/ui/form-field.tsx
import { forwardRef, useId } from "react"
import { cn } from "@/lib/utils"

export interface FormFieldProps {
  label: string
  helpText?: string
  error?: string
  required?: boolean
  children: (props: { id: string; "aria-describedby": string; "aria-invalid": boolean }) => React.ReactNode
  className?: string
}

export const FormField = ({ label, helpText, error, required, children, className }: FormFieldProps) => {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [helpText && helpId, error && errorId].filter(Boolean).join(" ")
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy || undefined as any, "aria-invalid": !!error })}
      {helpText ? <p id={helpId} className="text-xs text-fg-tertiary">{helpText}</p> : null}
      {error ? <p id={errorId} className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}
```

Usage in spec sheet:

```tsx
<FormField label="Client / Party Name" required>
  {(ids) => (
    <Select {...ids} value={form.customerId} onValueChange={...}>
      ...
    </Select>
  )}
</FormField>
```

### Fix 3: computed-tile vs editable-field treatment

```tsx
// components/ui/computed-tile.tsx — for read-only derived values
export function ComputedTile({ label, value, hint, tone = "neutral" }: {
  label: string; value: string; hint?: string
  tone?: "neutral" | "success" | "warning" | "danger"
}) {
  const toneClass = {
    neutral: "bg-surface-sunken text-fg",
    success: "bg-success-50 text-success",
    warning: "bg-warning-50 text-warning",
    danger:  "bg-danger-50 text-danger",
  }[tone]
  return (
    <div className={cn("rounded-md p-4", toneClass)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
        <CalculatorIcon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-xs text-fg-tertiary">{hint}</div> : null}
    </div>
  )
}
```

Apply to Sheet Reference, Mandrel ID Band, Recipe-led OD, Wet Divisor, Paper, Wet/Dry tube, **Dry Delta (tone="danger" when outside tolerance)**.

### Fix 4: tolerance alarm (the -250 g problem)

```tsx
<ComputedTile
  label="Dry delta"
  value={`${dryDelta.toFixed(2)} g`}
  tone={Math.abs(dryDelta) > 50 ? "danger" : Math.abs(dryDelta) > 20 ? "warning" : "success"}
  hint={
    Math.abs(dryDelta) > 50
      ? "Outside tolerance — recipe needs adjustment"
      : Math.abs(dryDelta) > 20
      ? "Approaching tolerance band"
      : "Within tolerance"
  }
/>
```

Pair with an `Alert` at the top of the material rule sheet when any computed value is danger-class:

```tsx
{anyDanger && (
  <Alert tone="danger" icon={AlertTriangle}>
    <AlertTitle>Recipe outside tolerance</AlertTitle>
    <AlertDescription>
      Dry delta is {dryDelta.toFixed(2)} g against a ±50 g band. Adjust paper mix or adhesive ratio.
    </AlertDescription>
    <AlertAction onClick={openTolerancePanel}>Explain the bands</AlertAction>
  </Alert>
)}
```

### Fix 5: kill the leaked port numbers

```tsx
// app/(dashboard)/dashboard/page.tsx
{process.env.NODE_ENV === "development" ? (
  <section className="rounded-3xl border border-cyan-100 bg-cyan-50/70 p-5 text-sm text-cyan-950 shadow-sm">
    Dev build · BFF :14000 · Web :13000 · Services :18001-18008
  </section>
) : null}
```

### Fix 6: ESLint rule to catch palette drift

```js
// .eslintrc.cjs
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "Literal[value=/\\b(slate|cyan|sky|teal|amber|orange|rose|emerald|indigo|violet|fuchsia|pink|red|blue|green|yellow)-(50|100|200|300|400|500|600|700|800|900|950)\\b/]",
        "message": "Use design tokens (primary, success, warning, danger, fg, border, surface) instead of raw Tailwind palette colors."
      },
      {
        "selector": "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
        "message": "Use design tokens instead of raw hex colors in JSX."
      }
    ]
  }
}
```

(Expect a large batch of warnings initially; allow `data-viz/*` files and `lib/erp-appearance.ts` as exceptions.)

---

## Appendix A — proposed palette

Based on your existing cream/teal/amber identity:

| Token           | Light                  | Dark (future)          |
|-----------------|------------------------|------------------------|
| `surface`       | `#F7F4EE` (cream)      | `#0B1115` (near-black) |
| `surface-raised`| `#FFFFFF`              | `#141B21`              |
| `surface-sunken`| `#EFE9DB`              | `#080D11`              |
| `surface-inverted`| `#0B1115`            | `#FFFFFF`              |
| `fg`            | `#121722`              | `#F5F5F7`              |
| `fg-secondary`  | `#5A6472`              | `#AEB4BE`              |
| `fg-tertiary`   | `#7E8592`              | `#7D8392`              |
| `border`        | `#DED4BF`              | `#1F2630`              |
| `border-strong` | `#93A0B5`              | `#3A4553`              |
| `primary`       | `#0B7285` (teal-800)   | `#3AB7C9`              |
| `accent`        | `#E0752B` (warm amber) | `#EE9A50`              |
| `success`       | `#2A8359`              | `#4BB785`              |
| `warning`       | `#C37B10`              | `#F2A84C`              |
| `danger`        | `#C23A2C`              | `#EF6B5F`              |
| `info`          | `#2A6AB4`              | `#6AA4E6`              |

Stage colors (for `STAGE_APPEARANCES`):

| Stage    | Light bg   | Border     | Text       | Dot        |
|----------|------------|------------|------------|------------|
| Winder   | `#E0F3F6`  | `#A6D6DF`  | `#0B5A68`  | `#1199AA`  |
| Oven     | `#FDEEDE`  | `#F3C596`  | `#8C4A10`  | `#E2801A`  |
| Process  | `#E8E7FD`  | `#BEBAF2`  | `#2E297E`  | `#6B66D6`  |
| Packing  | `#E4F4EC`  | `#9ED5B6`  | `#205E3F`  | `#3B9A6A`  |
| QC       | `#FDF0DC`  | `#EDC985`  | `#7A4A08`  | `#C78A14`  |
| Dispatch | `#E0EEFB`  | `#A9CBEE`  | `#1A4A7B`  | `#3876BC`  |

---

## Appendix B — files touched by priority

**P0 (tokens, foundation):**
- `apps/web-ui/app/globals.css`
- `apps/web-ui/tailwind.config.js`
- `apps/web-ui/app/layout.tsx` (font loading)
- `apps/web-ui/lib/design-tokens.ts` (new)
- `.eslintrc.cjs`

**P1 (primitives + consistency):**
- `apps/web-ui/components/ui/*` (add select, combobox, label, form-field, badge, table, tooltip, popover, dropdown, toast, skeleton, separator, alert, switch, checkbox, radio, drawer)
- `apps/web-ui/components/specs/SpecSheetDocument.tsx` (decompose)
- `apps/web-ui/components/common/crud-table.tsx` (consume Table primitive)
- All `apps/web-ui/app/(dashboard)/**/page.tsx` (migrate raw elements → primitives)

**P2 (quality):**
- `apps/web-ui/components/erp/shell.tsx` (Empty/Skeleton/Tooltip pass)
- `apps/web-ui/app/(dashboard)/layout.tsx` (tooltip for collapsed sidebar, cmdk, breakpoints)

**P3 (polish):**
- Hero illustrations in `public/`
- Chart tokens in `lib/erp-appearance.ts`
- Dark mode token set in `globals.css`

---

## Final word

You're much closer than this document makes it sound. The identity is there, the information architecture is thoughtful, the domain-specific design moves (big computed numbers, status taxonomy, tolerance framing) are already correct. The work ahead is **disciplining** what already exists, not reinventing it: one palette, one type scale, one primitive set, one shell, one density.

After P0 alone you will notice screens suddenly look like siblings. After P1, the client will call it finished. The rest is polish you can ship in background passes.
