# Planner & Tracker — System Design

**Scope.** Redesigns `/planning/board` into a three-stage tabbed planner (Winder / Oven / Process) that uses the full page, plus a new `/production/tracker` page for live WIP visibility and a printable Job Card layout. Supersedes the current stub planner. Paired with the fixes in `DESIGN_CRITIQUE.md` — both should ship together so the new planner lands on a clean design system.

**Non-goals.** Packing / QC / Dispatch planning (they are pull-based from prior stage output, not schedulable in the same way). Reconciliation UI — separate workstream.

---

## 1. Goals

1. **One glass-pane per stage.** A planner opens the page, picks Winder / Oven / Process, and sees every machine for the stage, shift-by-shift, for the next 3 days, with a drag-pool on the left of everything still to be scheduled.
2. **Capacity is the source of truth.** Every drop checks shift capacity in bamboo pcs (winder), hours (oven), or kg/hr (process). If a card doesn't fit, the system proposes a split — auto, with manual override.
3. **Parallel stage planning.** A job released from sales → production appears in all three tabs' open-queues simultaneously. Supervisor entry at one stage removes the card from that stage only — it stays visible in the other tabs until that stage's entry lands.
4. **Zero-hunt tracker.** For every released jobcard, answer "where is it right now, how long has it been there, is it stuck" in ≤ 2 seconds.
5. **Printable Job Card.** Clean A4/A5 print sheet a winder operator can read at the machine.

---

## 2. Domain primitives (what the UI must model)

| Concept | Definition | Fields the UI cares about |
|---|---|---|
| **Release Lot** | Bundle of job cards released from sales to production at once | `release_ref`, `released_at`, `priority`, `customer_name`, list of JC ids |
| **Job Card** | One production unit — one spec × one target qty | `jc_ref`, `product_spec` (OD/ID/length/wall), `tube_qty`, `bamboo_qty_required`, `due_date`, `customer`, `assigned_winder_id`, `current_stage`, `blocked_reason` |
| **Machine** | A physical asset at a stage | `code`, `stage` (WINDER/OVEN/PROCESS), `capacity_per_shift_bamboo` (winder only), `throughput_per_hour` (oven/process), `status` (UP/DOWN/MAINT) |
| **Shift** | Production slot | `shift_code` (A/B/C), `date`, `start_time`, `end_time`, `operator_name` |
| **Schedule Slot** | One jobcard pinned to (machine × shift × date) with a quantity | `jc_id`, `machine_id`, `shift_code`, `plan_date`, `planned_bamboo_qty`, `sequence` (order within shift), `status` (PLANNED / IN_PROGRESS / DONE / CANCELED) |
| **Stage Entry** | Supervisor confirms a stage has actually happened for a JC | `jc_id`, `stage`, `entered_at`, `actual_qty`, `actual_machine_id` |

**Key invariant.** A JC is gone from a stage's planner only when an Entry exists for that stage. "Planned but not entered" = still visible. This is what lets the three tabs run in parallel.

---

## 3. URL & information architecture

```
/planning/board                 → redirects to /planning/board/winder
/planning/board/winder          → Winder tab
/planning/board/oven            → Oven tab
/planning/board/process         → Process tab
/planning/board?date=2026-04-18 → preserves selected anchor date
/planning/board?jc=JC-00421     → opens planner with that card highlighted

/production/tracker             → live WIP tracker
/production/tracker/:jcId       → drill-in per jobcard

/production/job-cards/:id/print → printable A4 job card
```

Preserve tab + date + filter state in the URL so planners can link each other to the exact board state.

---

## 4. Page layout — planner

### 4.1 Page chrome (full bleed, no sidebar overlap)

The dashboard sidebar is collapsible today — **auto-collapse it on `/planning/board/*`** so the planner gets the full width. Planners live on this page for hours; the sidebar is a distraction.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ← Production / Planning Board                                       [◐ collapse nav]   │  ← slim breadcrumb (36px)
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  [Winder • 24 queued]  [Oven • 8 queued]  [Process • 5 queued]    Today | + 1d | + 2d  │  ← tab strip + date window
│  ─────────────────                                                                       │
│  [ Apr 18 · Apr 19 · Apr 20 ]   Search JC/customer/spec…   🔍   Filter ▾   Shift A/B/C  │  ← context bar
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- Tab strip uses `Tabs` from `@/components/ui/tabs` (already shadcn-based). Active tab gets stage color (Winder cyan, Oven orange, Process indigo per `STAGE_APPEARANCES`).
- Each tab label shows a live count — pulsing dot if count > 0 and unscheduled > 24h.
- Date window defaults to next 3 days (today + 2). Arrow keys jog the window. "Today" pill snaps back.

### 4.2 Body — Winder tab

```
┌──────────────────────┬─────────────────────────────────────────────────────────────────┐
│ OPEN QUEUE            │ SCHEDULE                                                         │
│ (scrollable)          │                                                                  │
│                       │          Shift A       Shift B       Shift C     Shift A  …   │
│                       │          Apr 18        Apr 18        Apr 18      Apr 19         │
│ ▸ WINDER M1  (3)      │ M1 ▸  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│    ┌─────────────┐    │       │ JC-418   │ │ JC-421   │ │  empty   │ │  empty   │      │
│    │ JC-422 …    │    │       │ 320 bmb  │ │ 180 bmb  │ │          │ │          │      │
│    │ 500 bmb     │    │       │ ■■■■■□□  │ │ ■■■□□□□  │ │ □□□□□□   │ │ □□□□□□   │      │
│    │ due Apr 22  │    │       │ 64% cap  │ │ 36% cap  │ │ 0% cap   │ │ 0% cap   │      │
│    │ M1 ▸ Shift A│    │       └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│    └─────────────┘    │ M2 ▸  ┌──────────┐ ┌──────────┐ ...                              │
│    ┌─────────────┐    │ M3 ▸  ...                                                        │
│    │ JC-423 …    │    │ M4 ▸  (down — maintenance 14:00-18:00)                           │
│    │ 420 bmb ⚠   │    │ M5 ▸  ...                                                        │
│    └─────────────┘    │                                                                  │
│                       │                                                                  │
│ ▸ WINDER M2  (5)      │                                                                  │
│    …                  │                                                                  │
│                       │                                                                  │
│ ▸ UNASSIGNED (2)      │                                                                  │
│    …                  │                                                                  │
└──────────────────────┴─────────────────────────────────────────────────────────────────┘
  ← 22% width            ← 78% width, horizontally scrollable if >7 shifts visible
```

**Left column — machine-grouped queue.**

- Each jobcard in the release already carries `assigned_winder_machine_id` (from the release step). The queue groups by that assignment — one accordion per winder with the machines it's targeted at.
- An **Unassigned** group at the bottom catches cards without an assignment (operations edge case — they have to be routed manually).
- Each card in the queue shows: `JC-REF`, bamboo required, due date, target winder + shift hint if one was preferred. Color bar on the left = stage tone (cyan for winder). `⚠` appears if due within 24h or if bamboo qty > single-shift capacity (i.e., card **must** split).

**Right column — schedule grid.**

- **Rows = machines**, one row per winder. Machine header on the left has the code, a capacity pill (e.g., `500 bmb/shift`), and a status dot (UP green / DOWN red / MAINT amber).
- **Columns = shifts**, 3 shifts × 3 days = 9 columns rendered. Horizontal scroll if more machines with wider schedules.
- Each slot shows the pinned JCs **stacked vertically** in sequence order, with a per-slot capacity bar underneath showing total allocated / capacity. Background turns amber at ≥85%, rose at 100%, rose-flashing at >100%.

### 4.3 Body — Oven / Process tabs

Same layout except:

- **Left column is a single flat queue** (no machine grouping) — order by due date then release date. Oven and process routing is less fixed; planner picks freely.
- **Right column rows** are still one machine per row. Capacity is hourly, not per-shift, so the slot shows `allocated_hours / shift_hours` bars. Under the slot, a compact "timeline within shift" strip lets the planner see *when in the shift* jobs are scheduled (useful for oven which has long cycles).

### 4.4 Card anatomy (shared between queue and schedule)

```
┌─ queue card ─────────────┐   ┌─ slot card ──────────┐
│ ┃ JC-00421               │   │ ┃ JC-00421           │
│ ┃ 73×1.7 T·280mm         │   │ ┃ 320 bmb · 18A      │
│ ┃ 320 bmb · 1,250 tubes  │   │ ┃ ■■■■■■□ 64%        │
│ ┃ Due Apr 22 · Acme      │   └──────────────────────┘
│ ┃ W‑M1 · Shift A hint    │
└──────────────────────────┘
   ▲ stage color bar              ▲ same color but compressed
```

**Hover** (150ms delay) opens a **floating detail panel** (Radix Popover, right-anchored) with the full jobcard: spec sheet thumbnail, bamboo math, parchment/adhesive recipe, customer, due date, operator notes, and a mini stage-progress strip showing what's already done. `⇧ click` pins the panel open.

**Right-click** (context menu): *Open JC · Print job card · Unschedule · Lock slot · Split here · Assign different winder · Copy link*.

---

## 5. Interaction design

### 5.1 Drag and drop

**Library.** `@dnd-kit/core` + `@dnd-kit/sortable`. Chosen over `react-beautiful-dnd` (deprecated) and `react-dnd` (heavy, dated). `dnd-kit` gives: keyboard drag (Space to grab, arrows to move, Enter to drop), accessible live region, smooth transform animations, sensor customization. Wrap in Framer Motion's `LayoutGroup` for snappy re-order animations when cards jump shift.

**Zones.**

- Queue items are draggable. Queue groups (per-winder accordions) are *not* reorderable — they're fixed by machine.
- Drop zones = each `(machine × shift × date)` slot.
- Within a slot, cards are sortable (drag to reorder sequence).
- Cross-drag: queue → slot, slot → slot, slot → queue (unschedule).

**Feedback stack during a drag:**

1. **Pickup.** Card lifts with `scale(1.04)` + `shadow-xl`, cursor becomes grabbing, source position shows a dashed ghost outline so the planner remembers where it came from.
2. **Valid drop hover.** Target slot gets a cyan glow ring (stage tone), shows a projected capacity bar that previews *after drop*: e.g., "if dropped here: 84% capacity". Cards already in the slot nudge down to make room (Framer layout transition, 180ms ease-out).
3. **Invalid drop hover.** Target slot shows rose ring + reason chip: `Machine down · 14:00–18:00` / `Over capacity — will split` / `Cannot route here — winder only`. For over-capacity, still **allowed** but triggers the split modal on drop.
4. **Drop.** 220ms spring to final position. The placed card "settles" with a subtle bounce. The slot's capacity bar animates from old → new fill level over 400ms. The queue card fades out, and if the queue group is empty, the accordion collapses.
5. **Keyboard parity.** Every interaction has a keyboard path: Tab into queue, Space to grab, arrow keys navigate slots (with a visible focus ring in the target), Enter to drop, Esc to cancel.

### 5.2 Auto-split & manual split

Triggered when a drop would push slot allocation > 100%.

**Modal** opens anchored to the dropped card:

```
Split JC-00421 — 500 bamboo pcs
This shift (M1 · 18 Apr · A) only has 180 bmb free.

┌─────────────────────────┐  ← Option A (default, pre-selected)
│ AUTO                    │
│ ● 180 bmb → 18A         │
│ ● 320 bmb → 18B         │
│ (fills current, rolls    │
│  remainder to next)      │
└─────────────────────────┘
┌─────────────────────────┐  ← Option B
│ MANUAL                  │
│ Split at: [ 180 ] bmb   │
│ First part →  18A       │
│ Second part → [18B ▾]   │
│ Third part?  + add      │
└─────────────────────────┘

[ Preview capacity impact ]
  Before: M1/18A 100%, M1/18B 0%
  After:  M1/18A 100%, M1/18B 64%

[ Cancel ]       [ Confirm split ]
```

- Manual lets the planner pick any split point and any destination shift for each part, including cross-machine ("split to M2 Shift A").
- Confirming creates two (or N) schedule_slot rows linked to the same JC with `split_parent_id`. The queue card is removed; two placed cards appear with a subtle "chain" icon linking them.
- Undo (Cmd/Ctrl-Z) rolls back the split.

### 5.3 Filters & search

A filter bar sits above the schedule grid (not inside the card body). Pills for: `Due ≤ 2 days`, `Over capacity`, `Customer…`, `Product family…`, `Operator…`, `Split jobs`. Search is fuzzy across JC ref / customer / spec.

Filters fade-out non-matching cards to 20% opacity rather than removing them — context is preserved.

### 5.4 Stage completion → auto-remove

When `POST /api/stage-entries` lands for a JC at stage=WINDER, the websocket/push to the planner:

1. Fades the planned card out of the Winder schedule (`opacity 0 → translateY(-8px)`, 300ms).
2. Records a "completed this shift" chip under the slot so the capacity history remains readable.
3. The same JC stays untouched in Oven and Process tabs. If a downstream stage was scheduled on a specific oven or process machine, the tracker starts counting handoff time.

If the actual machine / shift differs from plan, show a variance badge on the completed chip (`planned M1/A, actual M2/B`) and log it.

---

## 6. Capacity & scheduling logic

### 6.1 Data

```
Machine.capacity_per_shift_bamboo   (winder)       — e.g., 500
Machine.throughput_per_hour         (oven, process) — e.g., oven 80 tubes/hr
Shift.hours                         — usually 8
JC.bamboo_qty_required              (computed from spec × qty × wastage %)
```

### 6.2 Allocation model

```
allocated_bamboo(machine, shift, date) = Σ planned_bamboo_qty over schedule_slots
                                         where status ∈ {PLANNED, IN_PROGRESS}

remaining(machine, shift, date) = capacity_per_shift_bamboo - allocated_bamboo(…)

for oven/process:
  allocated_hours(…) = Σ (planned_qty / throughput_per_hour)
  remaining_hours(…) = shift.hours - allocated_hours(…)
```

### 6.3 Edge cases the UI must handle

| Scenario | Behavior |
|---|---|
| Machine marked DOWN mid-day | Slots after the break time flash rose; planner is prompted to reshuffle. The schedule grid greys out the unavailable hours within the shift. |
| Operator not assigned | Shift cell shows dashed outline + "No operator — assign?" link-button. |
| JC bamboo > single-shift capacity for any winder | Queue card shows `⚠ must-split` chip. Drag triggers split modal immediately. |
| Two planners editing simultaneously | Optimistic UI with conflict reconciliation — if the server rejects a drop because the slot changed, the card snaps back with a toast `Slot changed by Priya just now — reposition`. |
| Priority override | Right-click → `Lock slot` prevents auto-algorithms from touching it. Lock icon renders on the card. |
| Maintenance window | Blocks a time-range inside a shift. UI shades those hours within the slot and reduces effective capacity. |

### 6.4 Suggestion engine (P1, optional)

A "⚡ Auto-fit" button in the queue group runs a first-fit-decreasing packer per winder queue and proposes a full schedule for the next 3 days. It never commits — it previews as a diff overlay that the planner can accept/reject per card. Uses due-date + bamboo-qty as weights. Document the heuristic in the ADR.

---

## 7. Tracker page `/production/tracker`

### 7.1 Purpose

"Where is every released jobcard right now? Which are stuck?" No planning here — pure visibility.

### 7.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Production Tracker                                          [Export CSV] [Print]│
│  142 released · 87 WIP · 12 stuck · 43 completed (30d)                            │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ KPI RAIL                                                                       │
│  ┌────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐ │
│  │ Winder WIP │ Oven WIP   │ Process WIP│ Packing WIP│ QC hold    │ Dispatch Q │ │
│  │    34      │    18      │    22      │     9      │     3      │    4       │ │
│  │ avg 1.2d   │ avg 0.9d   │ avg 1.4d   │ avg 0.3d   │ avg 2.1d ⚠ │ avg 0.4d   │ │
│  └────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘ │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ FLOW PIPELINE (Sankey-ish, animated)                                           │
│    Released → Winder → Oven → Process → Packing → QC → Dispatch → Done            │
│    [142]→────[34]─────[18]────[22]──────[9]─────[3]───[4]──────[43]              │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ STUCK & AT-RISK (12)                                                           │
│    ┌──────────────────────────────────────────────────────────────────────────┐   │
│    │ JC-00403  73×1.7×280  Acme Packaging  ⚠ 3.2d in Oven  Last move Apr 14   │   │
│    │ JC-00391  ...                                                              │   │
│    └──────────────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ ALL RELEASED — timeline view          Group by: [Customer ▾] Filter: [Stage ▾]│
│    JC-00418  ●━━━━━━●━━━━━●━━━━━━○ ··· ○ ··· ○   (Winder done, Oven in progress) │
│    JC-00421  ●━━━━━━●━━○ ··· ○ ··· ○ ··· ○       (at Oven)                       │
│    JC-00422  ●━━━━━●━━━━━●━━━━━●━━━━━●━━━━━● ✔  (Completed)                      │
│    JC-00427  ●━○ ··· ○ ··· ○ ··· ○ ··· ○ ··· ○  (Just released)                  │
│                                                                                    │
│    legend: ● done    ○ pending    ━━ connector     ⚡ current     ⚠ stuck          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Components

- **KPI rail** reuses `MetricRail` + `MetricCard` (see `components/erp/shell.tsx`). Subtitle shows avg dwell time with amber/rose thresholds.
- **Flow pipeline** is a horizontal Sankey built in Recharts or SVG; counts animate (spring) when data refreshes. Click a segment → filters the list below.
- **Stuck & at-risk** is `ExceptionList` already in shell — JCs whose dwell at the current stage exceeds a configurable threshold (default: 2× stage's P50 dwell).
- **All released timeline** — each row is one JC with 7 stage dots connected by lines. Dots fill as stages complete. The "current" dot pulses. Hover = dwell time at each dot. Click = drill into `/production/tracker/:jcId`.
- **Drill-in page** shows the JC timeline vertically with timestamps, operator, machine, qty in vs. out at each stage, variance vs. plan, attachments (photos, notes). Print button jumps to `/production/job-cards/:id/print`.

### 7.4 Data

Tracker is read-mostly, driven by one query: `GET /api/jobcards/tracker?from=…&to=…`. Returns, for each JC, the full stage_entries timeline + current stage + dwell calcs already computed on the server so the client stays thin.

### 7.5 Refresh

Polled every 30s when tab is visible, plus a websocket push on any `stage_entry` write. Stale UI is unacceptable for WIP visibility.

---

## 8. Printable Job Card `/production/job-cards/:id/print`

### 8.1 Purpose

Operator walks to the machine with a printed sheet. Must be legible at arm's length, survive a greasy floor, fit A4 portrait (with an A5 option for small machines).

### 8.2 Layout (A4 portrait)

```
┌───────────────────────────────────────────────────────────────────┐
│  HARI OM PAPER TUBES       JOB CARD             JC-00421          │
│  ──────────────────────────────────────────────────────────────── │
│  CUSTOMER      Acme Packaging Pvt. Ltd.    DUE    22 Apr 2026     │
│  SALES ORDER   SO-002104                   RELEASE RL-00087       │
│                                                                    │
│  ┃ SPEC                                    ┃ QUANTITIES            │
│  OD      73 mm ± 0.3                       Tubes      1,250        │
│  ID      69.6 mm                           Bamboo     320 pcs      │
│  Wall    1.7 mm                            Parchment  ████ kg     │
│  Length  280 mm ± 1                        Adhesive   ██ kg        │
│  Ply     4                                                          │
│                                                                    │
│  ┃ SCHEDULE                                                        │
│  Winder   W-M1     Shift A      18 Apr    Operator: Rajesh         │
│  Oven     O-3      Shift B      18 Apr                              │
│  Process  P-1      Shift A      19 Apr                              │
│                                                                    │
│  ┃ RECIPE                                                          │
│  ┌──────┬──────────────┬──────────┬────────────┐                  │
│  │  Ply │  Parchment   │  GSM     │  Adhesive  │                  │
│  │  1   │  Kraft Brown │  120     │  PVA 5%    │                  │
│  │  2   │  Kraft White │  100     │  PVA 5%    │                  │
│  │  3   │  Kraft Brown │  120     │  PVA 5%    │                  │
│  │  4   │  Label Print │  80      │  PVA 3%    │                  │
│  └──────┴──────────────┴──────────┴────────────┘                  │
│                                                                    │
│  ┃ QC TOLERANCES                                                   │
│  OD  72.7–73.3 mm    Wall  1.5–1.9 mm    Length  279–281 mm        │
│                                                                    │
│  ┃ SUPERVISOR ENTRY (write in)                                     │
│  Actual tubes: _______   Bamboo used: _______   Start: _____       │
│  End: _____   Defects: _______________________________________      │
│  Signature: ________________________                                │
│                                                                    │
│  ────────────────────────────────────────────────────────────────  │
│  Printed 18 Apr 2026 15:42 · v2 · Hari Om TubeOS                   │
└───────────────────────────────────────────────────────────────────┘
```

### 8.3 Implementation

- Dedicated route, `@media print` stylesheet. No dashboard chrome.
- Uses `react-to-print` or browser native `window.print()` — no PDF pipeline needed in v1. A2 PDF via `puppeteer` can come in v2 if operators want digital copies.
- Large, high-contrast type (14pt body, 22pt JC ref), thick dividers, no grey-on-grey.
- A5 variant is a URL flag `?size=A5`. Reduces recipe table density, removes redundant customer block.

---

## 9. API contracts (additions)

All under `/api/planning/*`:

```
GET    /api/planning/board?stage=WINDER&from=2026-04-18&days=3
       → { machines: [...], shifts: [...], slots: [...], queue: [...], capacities: {...} }

POST   /api/planning/slots
       { jc_id, machine_id, shift_code, plan_date, planned_bamboo_qty, sequence }
       → schedule_slot

PATCH  /api/planning/slots/:id
       { machine_id?, shift_code?, plan_date?, planned_bamboo_qty?, sequence?, locked? }

DELETE /api/planning/slots/:id   → unschedule

POST   /api/planning/slots/split
       { slot_id, splits: [{ qty, machine_id, shift_code, plan_date }, …] }
       → [schedule_slot, …]

POST   /api/planning/slots/auto-fit
       { stage, date_range } → preview only, returns proposed diff

GET    /api/production/tracker?from=…&to=…&stage=…
       → [{ jc, stage_history, current_stage, dwell_days, stuck }, …]

GET    /api/jobcards/:id/print   → JSON the print page renders
```

Authorization: scheduling endpoints require `role in {planner, supervisor, admin}`. Tracker is read-all.

**Realtime.** Add a lightweight SSE stream at `/api/planning/stream?stage=…` that pushes `slot_created / slot_updated / stage_entry_logged` events. Planner subscribes on mount, unsubscribes on tab change. Falls back to 10s polling if SSE fails.

---

## 10. Data model additions

```sql
-- schedule_slot (new)
CREATE TABLE schedule_slot (
  id                  uuid PK,
  jc_id               uuid FK → job_card.id,
  machine_id          uuid FK → machine.id,
  shift_code          text,
  plan_date           date,
  planned_bamboo_qty  numeric,   -- for winder
  planned_hours       numeric,   -- for oven/process
  sequence            int,       -- order within a shift
  split_parent_id     uuid NULL FK → schedule_slot.id,
  locked              bool default false,
  status              text,      -- PLANNED / IN_PROGRESS / DONE / CANCELED
  created_by, created_at, updated_at
);
CREATE INDEX ON schedule_slot (machine_id, plan_date, shift_code);
CREATE INDEX ON schedule_slot (jc_id);

-- machine additions
ALTER TABLE machine ADD COLUMN capacity_per_shift_bamboo numeric;
ALTER TABLE machine ADD COLUMN throughput_per_hour numeric;
ALTER TABLE machine ADD COLUMN status text default 'UP';

-- downtime windows (for MAINT / DOWN)
CREATE TABLE machine_downtime (
  id, machine_id FK, starts_at tstz, ends_at tstz, reason text
);
```

No changes to existing job_card, release_lot, stage_entry tables — they already carry the fields the UI reads.

---

## 11. State management (frontend)

- `TanStack Query` keeps remote state. One query per tab (`['planner', stage, windowStart]`) with 30s staleTime, invalidated on every mutation + SSE event.
- Local drag state lives in a `PlannerContext` (React Context + reducer) — holds `draggingCardId`, `activeDropTarget`, `previewAllocation`. Keeps TanStack cache clean.
- Optimistic updates for slot create/move/delete. Rollback with `onError`.
- Split modal is controlled by URL state (`?split=slotId`) so refreshing doesn't lose it.

---

## 12. Motion spec

Tokens (add to `tailwind.config.js`):

```js
transitionTimingFunction: {
  'planner-out': 'cubic-bezier(0.22, 1, 0.36, 1)',     // overshoot-free landing
  'planner-in':  'cubic-bezier(0.4, 0, 0.2, 1)',        // standard ease-in-out
},
transitionDuration: {
  pickup: '120ms',
  settle: '220ms',
  capacity: '400ms',
  swap: '180ms',
},
```

- **Pickup**: 120ms ease-out, scale 1→1.04, shadow-sm → shadow-xl.
- **Hovering a valid target**: 180ms nudge of resident cards.
- **Drop**: 220ms spring (Framer `{ type: 'spring', stiffness: 420, damping: 32 }`).
- **Capacity bar refill**: 400ms cubic.
- **Tab switch**: cross-fade 200ms, not slide — planners switch often, sliding gets tiring.
- **`prefers-reduced-motion`**: collapses everything to opacity fades, disables spring. Already required by the critique doc.

---

## 13. Accessibility

- **Keyboard drag**: handled by `dnd-kit` — Space grabs, arrows move between slots, Enter confirms, Esc cancels, Tab exits. A persistent live region announces moves: "JC-00421 moved from Queue to Winder M1 Shift A, 18 April."
- **Focus order**: tabs → date window → search → filter pills → queue groups → schedule grid → row headers → slots → cards-in-slot.
- **ARIA roles**: Queue = `role="list"`. Each slot = `role="gridcell"` with `aria-label="Machine M1, Shift A, 18 April, 64% allocated"`.
- **Contrast**: capacity fill bars must hit 3:1 against the card surface. Over-capacity rose: `hsl(0 85% 55%)` on `hsl(0 0% 100%)` = 4.8:1 ✓.
- **Color-blind safety**: capacity uses fill + percentage text + icon (✓ / ⚠ / ✗). Never color-only.
- **Target size**: drag handles ≥ 40×40 on touch (operators may use tablets on the floor).

---

## 14. Performance

- 24 winders × 9 shifts × ~10 cards per shift = ~2160 DOM nodes per tab max. Fine with virtualization disabled; if planners start stacking 20+ cards per shift, wrap with `react-window` per-row.
- Queue can grow — virtualize the queue if > 100 items.
- Debounce capacity recomputes on drag-over to one per animation frame.
- Memoize the schedule matrix; only cells in the dragged card's machine + adjacent shifts re-render during drag.

---

## 15. Phasing

**P0 — must ship together (est. 10–12 engineer-days):**

1. Route scaffold + tabs + date window + filter bar.
2. Winder tab with machine-grouped queue, 3-day schedule grid, drag/drop with capacity check, hover detail popover, right-click menu.
3. `/api/planning/board`, `/api/planning/slots` (POST/PATCH/DELETE), `schedule_slot` table.
4. Stage-entry → auto-remove via SSE.
5. Printable job card.

**P1 — follow-up (8–10 engineer-days):**

6. Oven + Process tabs (single-queue variant).
7. Split modal (auto + manual) + split API.
8. Tracker page with KPI rail, Sankey, stuck list, timeline view.
9. Keyboard DnD full parity + live region.
10. Lock/unlock slots, maintenance windows.

**P2 — nice-to-have (5–7 days):**

11. Auto-fit suggestion engine (preview diff).
12. A5 print variant + PDF pipeline.
13. Mobile/tablet read-only view for floor supervisors.

---

## 16. Trade-offs & what to revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| Single `schedule_slot` table for all stages | Simpler queries, but winder uses `bamboo_qty` and oven uses `hours` — nullable columns feel sloppy | Stages diverge further (e.g., process gains multi-variable planning) → split per-stage tables |
| SSE over WebSocket | Simpler, one-way suffices for now | Bi-directional collab features (co-editing cursors, presence) → upgrade |
| Client-side capacity math | Instant feedback during drag | Server becomes authoritative source in conflicts → move hot-path to server with WebAssembly cache |
| Auto-split defaults to fill-current-roll-rest | Fastest for planner; may not match shop-floor preference | After 2 weeks usage — log split patterns, adjust default |
| One queue per winder on Winder tab | Matches how releases get assigned today | If routing rules change (e.g., unassigned release pool) — add "unassigned" treatment as first-class |
| 3-day fixed window | Most planners think in shift+next-2-days | Power users want week-at-a-glance → add a "week" density toggle |
| Tabs over a single combined stage view | Cognitive load is lower per tab | Planners keep flipping tabs for the same JC → consider a stacked lanes view in P2 |

---

## 17. Links to existing code to reuse

- `components/erp/shell.tsx` — ExecutiveHero, MetricRail/MetricCard, Panel, ExceptionList, StatusBadge, EmptyState. Use all of these; don't rebuild.
- `lib/erp-appearance.ts` — STAGE_APPEARANCES, STATUS_APPEARANCES, ERP_CHART_THEME. Drive all stage tones from here.
- `components/ui/tabs.tsx` — tab strip.
- `components/ui/button.tsx` — all CTA buttons. No raw `<button>` anywhere.
- `components/ui/dialog.tsx` — split modal, print preview.
- `hooks/use-production.ts` — extend with `useSchedule(stage, date)`, `useScheduleMutations()`.

**Must fix before this lands** (carry-over from `DESIGN_CRITIQUE.md`):

- Extend token palette (primary teal, stage semantic tokens) — the planner leans on them hard.
- Add `FormField` primitive — the split modal uses it.
- Ban raw hex via ESLint rule — the planner must not regress.

---

## 18. Open questions for you

A few things that would sharpen the spec but aren't blockers:

1. **Shift definitions.** Are all 3 shifts always 8h starting at fixed times, or does each machine have its own shift schedule? (Affects whether shifts are global or per-machine.)
2. **Cross-day splits.** If a job spans a shift boundary mid-run, is that a split (two slots) or one slot with a time range? Today's assumption: two slots.
3. **Release priority.** Is there an explicit priority field on a release, or is due-date the only signal? (Auto-fit needs a weight.)
4. **Bamboo interchange.** Does a winder quote capacity strictly in bamboo pcs, or are there conversions between bamboo and tube count that vary by spec? (Affects the capacity unit shown on cards.)
5. **Print localization.** Hindi / Gujarati on the printable? (Affects font + layout allowance.)

Default assumptions made in this doc: 3 global 8h shifts A/B/C, splits are new rows, due-date drives priority, capacity is pure bamboo pcs, print is English.

---

## Final word

This design lands three things in one move: a **planner that fills the page and handles all three stages in parallel**, a **tracker that makes "where is it stuck" a 2-second answer**, and a **print layout the floor can actually use**. The capacity math and auto-split give the planner real leverage — they stop hunting for space and start making calls. Ship P0 + `DESIGN_CRITIQUE.md`'s foundation fixes together; that's the shortest path to a planner board that feels, in your words, perfect throughout.
