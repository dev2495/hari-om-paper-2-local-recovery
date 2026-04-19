# Sales Planner Release Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the PO-style sales-order to planner to supervisor-entry flow so releases stay line-specific, planner scheduling is the execution gate, and planner/tracker/job-card UI exposes the real production state cleanly.

**Architecture:** Reuse the recovered Hari Om flow that already stores PO line items, release lots, job cards, and stage segments. Add missing planner gate helpers in `production-service`, then update the existing sales, planner, tracker, and job-card React surfaces to present that truth with a denser tabbed scheduling UI instead of introducing parallel pages or duplicate status models.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js App Router, React Query, Tailwind CSS, Lucide, dayjs

---

### Task 1: Lock backend execution gating around scheduled segments

**Files:**
- Modify: `hariom-erp/services/production-service/tests/test_planning_validation.py`
- Modify: `hariom-erp/services/production-service/src/routers/planning.py`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- a helper that returns `True` only when the active stage segment is scheduled in the next 3 calendar days
- stage-editability staying blocked when the active stage has no scheduled segment in that window
- the same helper returning `False` for unscheduled or stale segments and `True` for scheduled near-term segments

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest hariom-erp/services/production-service/tests/test_planning_validation.py`
Expected: FAIL on missing helper / mismatched planner gate behavior

- [ ] **Step 3: Write minimal implementation**

Implement a planner-window helper in `planning.py` that:
- treats today through `today + 2 days` as executable
- checks the current active segment for machine assignment, plan date, and non-completed/non-cancelled status
- is reusable by API serialization and UI-facing job-card payload construction

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest hariom-erp/services/production-service/tests/test_planning_validation.py`
Expected: PASS

### Task 2: Expose planner-gate context in job-card planning payloads

**Files:**
- Modify: `hariom-erp/services/production-service/tests/test_planning_validation.py`
- Modify: `hariom-erp/services/production-service/src/routers/planning.py`
- Check: `hariom-erp/services/production-service/src/schemas/planning.py`

- [ ] **Step 1: Write the failing tests**

Add tests for a payload/context builder that emits:
- `planner_gate_ready`
- `planner_gate_reason`
- `active_segment_plan_date`
- `active_segment_machine_id`

for unscheduled, stale, and ready active-stage cases.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest hariom-erp/services/production-service/tests/test_planning_validation.py`
Expected: FAIL because the response fields/context are missing

- [ ] **Step 3: Write minimal implementation**

Extend the planning router serialization so list/detail responses expose planner-gate readiness and reason without changing the fundamental job-card model.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest hariom-erp/services/production-service/tests/test_planning_validation.py`
Expected: PASS

### Task 3: Tighten sales release handoff UX

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/sales-orders/page.tsx`
- Modify: `apps/web-ui/app/(dashboard)/sales-orders/[orderId]/page.tsx`
- Modify: `apps/web-ui/components/sales/sales-order-create-form.tsx`

- [ ] **Step 1: Update the release dialog copy and summary**

Show PO context, selected line count, total release qty, and explicit “target winder per line” framing so users understand this is a demand cut from a long-horizon PO.

- [ ] **Step 2: Route confirmed releases to the canonical planner board**

Replace landing-page redirect after release with `/planning/board?section=winder&order_id=<id>` so release drops users directly into scheduling.

- [ ] **Step 3: Make line-item surfaces clearer**

Keep `product_code` prominent in create/detail/list views and make line rows read like distinct release buckets under one PO.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds for the modified UI

### Task 4: Redesign the planner board around stage tabs and queue clarity

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/planning/board/page.tsx`

- [ ] **Step 1: Reshape the page shell**

Keep the existing route but move to a stronger tabbed top rail, more deliberate hero/status area, and a denser split layout with queue left and lanes center.

- [ ] **Step 2: Differentiate queue behavior by stage**

For `winder`, group/highlight queue cards by assigned target winder from release.
For `oven` and `process`, keep one shared unscheduled queue.

- [ ] **Step 3: Strengthen scheduling cards**

Each card should emphasize:
- product code
- PO/customer reference
- release qty
- bamboo requirement
- pcs per bamboo
- target winder / current machine
- due date
- planner-gate / split posture

- [ ] **Step 4: Improve motion and drag affordance**

Use restrained transitions for:
- tab changes
- drag hover / drop targets
- queue card pickup state
- load-bar emphasis

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds

### Task 5: Upgrade tracker and job-card queue surfaces

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/planning/tracker/page.tsx`
- Modify: `apps/web-ui/app/(dashboard)/production/job-cards/page.tsx`

- [ ] **Step 1: Expand tracker columns and filters**

Expose release lot, sales line, target winder, current stage, WIP qty, blocked reason, and completion/history posture in a clearer tracker grid.

- [ ] **Step 2: Make job-card queue execution-aware**

Surface planner-gate readiness, active plan date, open segment count, and release context so supervisors/planners can see why a card is or is not executable.

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds

### Task 6: Tighten supervisor/job-card execution messaging

**Files:**
- Modify: `apps/web-ui/components/production/JobCardDocument.tsx`
- Modify: `apps/web-ui/app/(dashboard)/production/supervisor-entry/page.tsx`

- [ ] **Step 1: Use planner-gate readiness in the document**

Block editable stage entry unless the active stage segment is scheduled in the next three days and show the exact reason when blocked.

- [ ] **Step 2: Enrich printable/view state**

Prominently show release qty, target winder, assigned shift/date, bamboo math, and release/line references in the header metrics.

- [ ] **Step 3: Update supervisor entry helper copy**

Make the blocking rule explicit: a released job becomes floor-executable only after planner schedules it into the next-three-day window.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds

### Task 7: Final verification

**Files:**
- No code changes required

- [ ] **Step 1: Run backend verification**

Run: `python -m unittest hariom-erp/services/production-service/tests/test_planning_validation.py`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `npm run build`
Expected: Next.js production build completes successfully

- [ ] **Step 3: Review changed flow coverage**

Confirm the implementation now covers:
- multi-line PO create flow with product code
- release popup with per-line qty + winder
- direct handoff to canonical planner board
- queue/lane planner tabs
- stage completion moving work downstream
- tracker/history visibility
- supervisor gate based on scheduled next-3-day segment

