# TubeOS page index: every sidebar page, what it is for and who can see it

Owner and Admin can open every page. A page with no roles listed is open to all signed-in users.


## Sidebar group: Overview

- **Dashboard** (address /dashboard): Control room overview, alerts, and operating posture. Roles that see it: all signed-in users (plus Owner and Admin).
- **Inbox** (address /inbox): Your role's live work queue plus every handoff, hold and approval that involves you. Roles that see it: all signed-in users (plus Owner and Admin).
- **Guide** (address /help): The full handbook, page guides, flow maps and chapter PDFs. Roles that see it: all signed-in users (plus Owner and Admin).

## Sidebar group: Operations

- **Orders** (address /sales-orders): Every sales order by status: fulfilment, job cards, deliveries and one history. Replaces the order tracker. Roles that see it: Owner, Admin, Sales, Planner, PlantManager, Dispatch (plus Owner and Admin).
- **Job Cards** (address /production/job-cards): Track every card: status, stage, plan, QC flags; open a card for its runs, QC, plan and history. Roles that see it: Owner, Admin, Planner, PlantManager, QC, InProcessQC, Operator, Sales, Dispatch (plus Owner and Admin).
- **Job card manager** (address /production/job-cards/manage): Split into a new card, edit qty / colour, force close, emergency insert, cancel — with a preview and a reason. Roles that see it: Owner, Admin, Planner, PlantManager (plus Owner and Admin).
- **Planner** (address /planning/board): Planning overview, machine queues, shift scheduling and Split plan. Roles that see it: Owner, Admin, Planner, PlantManager (plus Owner and Admin).
- **Log output** (address /production/entry): Scan or pick a card, choose the stage and log the run (phone or PC). Roles that see it: Owner, Admin, PlantManager, Operator, Planner (plus Owner and Admin).
- **Log QC** (address /production/entry?mode=qc): Scan or pick a card, choose the stage and enter the QC readings (operators log QC too). Roles that see it: Owner, Admin, PlantManager, Operator, QC, InProcessQC (plus Owner and Admin).
- **Month-end close** (address /production/reconciliation): Count the store, check material use against spec, close the month. Usage limits live here too. Roles that see it: Owner, Admin, PlantManager (plus Owner and Admin).

## Sidebar group: Quality

- **QC desk** (address /quality): What needs QC now: incoming lots, stage checks, holds and returns. Roles that see it: Owner, Admin, PlantManager, QC, InwardQC, InProcessQC, Dispatch, Store, Sales (plus Owner and Admin).
- **Incoming QC** (address /quality/incoming): Inspect GRN lots; out-of-band readings hold the lot. Roles that see it: Owner, Admin, QC, InwardQC (plus Owner and Admin).
- **In-process QC** (address /quality/stage): Flagged readings stage by stage, and runs still waiting for their 2 QC readings. Roles that see it: Owner, Admin, QC, InProcessQC, PlantManager (plus Owner and Admin).
- **Holds & inspections** (address /quality/results): Held inward lots and job cards, with every inspection result. Roles that see it: Owner, Admin, QC, InwardQC, InProcessQC, PlantManager, Store, Sales, Dispatch (plus Owner and Admin).
- **Customer complaints** (address /quality/returns): Complaints and returns: batch, customer, size, qty, reason and status, followed to closure. Roles that see it: Owner, Admin, QC, PlantManager, Store, Sales, Dispatch (plus Owner and Admin).
- **Material standards** (address /quality/material-standards): The checks QC does on each incoming material. Roles that see it: Owner, Admin, QC, InwardQC (plus Owner and Admin).
- **Process stage rules** (address /quality/stage-rules): Seasonal winding, oven and process tolerances, versioned. Roles that see it: Owner, Admin, QC (plus Owner and Admin).
- **Production season** (address /settings/production-season): Global season and release readiness. Roles that see it: Owner only (plus Owner and Admin).

## Sidebar group: Purchasing

- **Purchase orders** (address /purchase): Scheduled drafts to send, POs waiting approval, sent and waiting delivery, and every PO. Roles that see it: Owner, Admin, Store, Planner, PlantManager (plus Owner and Admin).
- **RM inward calendar** (address /purchase/scheduler): Forward RM demand against stock and arrivals, day by day. Propose arrivals; the Owner approves them into draft POs. Roles that see it: Owner, Admin, Store, Planner, PlantManager, GRN (plus Owner and Admin).
- **Expected arrivals** (address /purchase/supplier-deliveries): What vendors should deliver: overdue, today, this week and later, each with Make GRN. Roles that see it: Owner, Admin, Store, Planner, PlantManager, GRN (plus Owner and Admin).
- **Create purchase order** (address /purchase/new): Multi-item PO with automatic numbering and vendor terms. Roles that see it: Owner, Admin, Store, Planner, PlantManager (plus Owner and Admin).
- **Purchase requisitions** (address /purchase/requisitions): Request a tool or material for Owner approval. Roles that see it: all signed-in users (plus Owner and Admin).
- **PO approvals** (address /purchase/approvals): Approve RM arrivals, requisitions and submitted PO revisions. Roles that see it: Owner, Admin (plus Owner and Admin).
- **Invoice differences** (address /purchase/discrepancies): Review rates, quantities and specifications. Roles that see it: Owner, Admin, Store, Accounts, PlantManager (plus Owner and Admin).
- **Debit notes** (address /purchase/debit-notes): Vendor claims, approvals and settlements. Roles that see it: Owner, Admin, Accounts, PlantManager (plus Owner and Admin).
- **Purchase reports** (address /purchase/registers): Excel exports and printable commercial registers. Roles that see it: Owner, Admin, Store, Accounts, Planner, PlantManager (plus Owner and Admin).

## Sidebar group: Stores & inventory

- **Goods inward** (address /purchase/inward): Manual or approved-PO receipt with individual reel and coil labels. Roles that see it: Owner, Admin, Store, PlantManager, GRN (plus Owner and Admin).
- **GRN register & labels** (address /purchase/receipts): Saved receipts, pending invoices, QC and label reprints. Roles that see it: Owner, Admin, Store, PlantManager, Accounts, GRN, InwardQC (plus Owner and Admin).
- **Reel & coil issue** (address /inventory/reels/issue): Issue reels and coils to the floor by shift; each reel gets a slitting card. Roles that see it: Owner, Admin, Store, PlantManager, RMIssue (plus Owner and Admin).
- **Material issue** (address /inventory/production-issue): Issue adhesive, parchment and packing to the floor by shift. Roles that see it: Owner, Admin, Store, PlantManager, RMIssue (plus Owner and Admin).
- **Issue history** (address /inventory/issue-history): Every issue to the floor: shift, material, reel or lot, who issued it and the rack. CSV. Roles that see it: Owner, Admin, Store, PlantManager, RMIssue, Planner, GRN (plus Owner and Admin).
- **Stock counts & book** (address /inventory/stock-control): Spot and month-end counts, corrections, the stock book and locations with rack labels. Roles that see it: all signed-in users (plus Owner and Admin).
- **Opening stock** (address /inventory/opening-stock): Go-live stock already in the plant: reels and lots with new labels, in batches on the go-live date. Roles that see it: Owner, Admin (plus Owner and Admin).
- **Inventory** (address /inventory): Raw material inward, reel issue, balances, and valuation. Roles that see it: Owner, Admin, Store, Planner, PlantManager, GRN, RMIssue (plus Owner and Admin).
- **Genealogy** (address /inventory/genealogy): Reel lineage, slit children, issue scans, and trace exceptions. Roles that see it: Owner, Admin, Store, Planner, PlantManager, Dispatch, GRN, RMIssue (plus Owner and Admin).
- **Manual FG** (address /inventory/fg-inward): Rework yield, returns, and adjustments — manual FG inward outside the job-close flow. Roles that see it: Owner, Admin, PlantManager (plus Owner and Admin).
- **Stock alert policies** (address /inventory/stock-alert-policies): Set material stock thresholds, lead times and replenishment rules. Roles that see it: Owner, Admin, PlantManager (plus Owner and Admin).
- **Stock Alerts** (address /inventory/stock-alerts): Policy-driven stock breach inbox, ownership, and recovery. Roles that see it: Owner, Admin, Store, Planner, PlantManager (plus Owner and Admin).
- **RM Costing** (address /inventory/rm-costing): Owner and Admin standard-cost versions, impact, and audit history. Roles that see it: Owner, Admin (plus Owner and Admin).
- **Dispatch** (address /logistics/dispatch): Packing handoff, challans, and finished-goods release. Roles that see it: Owner, Admin, Dispatch, Sales, Store (plus Owner and Admin).

## Sidebar group: Design

- **Specifications** (address /specifications): Spec sheet workspace, recipe truth, and print-ready outputs. Roles that see it: Owner, Admin (plus Owner and Admin).

## Sidebar group: Reports

- **Intelligence** (address /analytics): Live KPIs for the period and the full report catalog. Roles that see it: Owner, Admin, Planner, PlantManager, Store, Dispatch, Sales, QC (plus Owner and Admin).
- **Owner daily pack** (address /reports/owner): Board pack: order book, dispatch, OTIF, production, stock. Roles that see it: Owner, Admin (plus Owner and Admin).
- **Operations command** (address /reports/operations): Stage throughput, adherence and blockers. Roles that see it: PlantManager, Planner (plus Owner and Admin).
- **Throughput** (address /reports/production): Per-stage and per-machine output. Roles that see it: PlantManager, Planner (plus Owner and Admin).
- **Planning performance** (address /reports/planning): How well the plan held: slots done in their shift, machine load, missed slots and stages finished on time. Roles that see it: PlantManager, Planner (plus Owner and Admin).
- **Plan vs actual** (address /reports/plan-vs-actual): Did each floor run happen on the planned day, shift and machine? Runs before planning and missed slots. Roles that see it: PlantManager, Planner (plus Owner and Admin).
- **Sales pulse** (address /reports/sales): Order flow, OTIF, lead time and customers. Roles that see it: Sales, PlantManager (plus Owner and Admin).
- **Customer 360** (address /reports/customer-360): Per-customer demand, delivery and risk. Roles that see it: Sales (plus Owner and Admin).
- **Inventory intelligence** (address /reports/inventory): Stock value, ageing and velocity. Roles that see it: Store, Planner, PlantManager (plus Owner and Admin).
- **Supplier & reels** (address /reports/loss): Supplier and reel performance, losses. Roles that see it: Store, PlantManager (plus Owner and Admin).
- **Slitting report** (address /reports/slitting): Reels to the slitter: coils made, wastage and pending slitting cards. Roles that see it: Store, PlantManager, Planner (plus Owner and Admin).
- **Quality analytics** (address /reports/quality): Pass rates by stage and material, flagged readings, holds and complaints. Roles that see it: QC, InwardQC, PlantManager (plus Owner and Admin).
- **Dispatch & SLA** (address /reports/dispatch): Dispatch volume, readiness and SLA. Roles that see it: Dispatch, Sales (plus Owner and Admin).
- **Tooling ledger** (address /reports/tooling): Tool assets, grinding and usage trail. Roles that see it: PlantManager (plus Owner and Admin).

## Sidebar group: Foundation

- **Masters** (address /masters/papers): Papers, mandrels, parchments, customers, and supporting masters. Roles that see it: Owner, Admin (plus Owner and Admin).
- **System** (address /system/users): Users, roles, plants, machine setup and background jobs. Roles that see it: Owner, Admin (plus Owner and Admin).
- **Audit** (address /system/audit): Who did what — login, mutation, permission and report trail. Roles that see it: Owner, Admin (plus Owner and Admin).
