# Tools in TubeOS: what exists today

Read-only review of code at commit `2cb8028` (31 Oct 2026). No code, config or data was changed. Live numbers come from read-only queries on the local season databases (`hariom_nverify_season_*`).

---

## Executive summary

TubeOS treats a "tool" as one of **five fixed notching tool categories: Notch, Blade, Holder, V + Flat and Punch**. Each category has **definitions** in the Tool master (for example "Plain blade, 0.5 thick, 300 long"). Separately, it can hold **physical units**, one record per tool, each with an asset number and a QR label. Mandrels are a different master: they are dimensions only, with no physical units and no lifecycle.

**There is no page called "tool inward ledger".** The closest thing is the **Inward** button on each definition in **Masters > Physical tools** (`/masters/tools`). It posts a GRN-style "tool receipt" and creates one QR asset per unit. Inward history appears only as an `INWARD` line in each asset's **Details / label** timeline. There is no list of receipts, and no API to read receipts back.

Tool inward is **not connected to purchasing, stock or costing**. A tool bought through purchase requisition, then PO, then GRN lands as a stock quantity of a "Tool" material item, with a rate. Those items are kept out of the stock book, counts and opening stock. The store then has to inward the same tool again on the Physical tools page, where there is no rate, no PO link field and no check against the GRN.

After inward, the lifecycle covers issue to a job card stage, usage recorded automatically when the stage is completed, return, maintenance, blade grinding (V0, V1, V2...), move between locations, and scrap. All of it is logged per asset. The **Tooling ledger** report (`/reports/tooling`) summarises it, but it has no filters, some tiles are mislabelled, and one idempotency bug can double-count output.

Live local data: 16 tool definitions (8 Blade, 4 Notch, 2 Holder, 2 V + Flat, no Punch). All 16 were back-filled from spec sheets with no attribute values. There is 1 physical asset (a Blade, AVAILABLE) from 1 receipt (27 Oct, with no supplier, PO or invoice). There are 0 issues, 0 usage, 0 definition log events, 20 mandrels, 0 Tool-type material items and 0 tool requisitions.

---

## 1. What a "tool" is

### 1.1 Two different things are called "tools"

| | Tool definition (master) | Physical tool asset | "Tool" material item (purchasing) |
|---|---|---|---|
| What it is | A type of tool and its measurements | One real tool, with a QR label | A purchasable stock item of type `TOOL` |
| Where | Masters > Physical tools (top table) | Same page, "Inwarded tools and lifecycle" table | Inventory > Material items, Purchase requisitions, PO, GRN |
| Service / table | masterdata `tool_master` | inventory `tool_assets` | inventory `item_master` (type TOOL) |
| Used by | Spec sheet notch fields, job card print | Job card stage "Physical Tool Issue", tooling report | Requisition, then PO (OT series), then GRN |
| Linked to the others? | Asset keeps `tool_definition_id` plus a snapshot | Yes, to its definition | **No link to definitions or assets** |

### 1.2 The five fixed categories and their "points"

Fixed in code: `hariom-erp/services/masterdata-service/src/routers/tool.py:25-31`. Inventory uses the same list: `inventory-service/src/routers/tool_assets.py:18`. Users cannot add a category. The category of a definition cannot change after creation (`tool.py:706-709`).

| Category | Points (fields) allowed | Required | Dropdown (registry) fields |
|---|---|---|---|
| Notch | type, thickness, design, degree | all four | type, design, degree, notch_direction |
| Blade | type, thickness, height, length | type, thickness, length | type |
| Holder | thickness, height, length | thickness, length | none |
| V + Flat | length, thickness | both | none |
| Punch | punch | punch | punch |

Sources: `tool.py:34-38` (option fields), `tool.py:52-65` (points and required points). Default dropdown values are seeded at service start (`tool.py:40-47`, `masterdata-service/src/main.py:752-777`). Examples are Notch type Bottom LHS / Bottom RHS / Top RHS and Blade type Plain / Half Serration / Full Serration. Notch distance and depth are numeric spec fields, not dropdowns.

**Definition fields** (`masterdata-service/src/models.py:344-367`): category, name (unique per plant and category), attribute_values (the points), spec_text, department (default COMMON), status `ACTIVE` or `DISCONTINUED`, `active` (soft-delete flag), usage_count, and timestamps. No code, maintenance date or location is kept on a definition. That is deliberate; the comment is at `models.py:363-365`.

**Spec back-fill:** on every masterdata start, `tool_backfill.backfill_tools_from_specs()` creates a definition for every tool name found in spec sheets that is missing from the master. The definition is created with **empty points** (`masterdata-service/src/tool_backfill.py:30-83`). All 16 live definitions came from this.

### 1.3 Physical asset identity and QR labels

Created by inward (`tool_assets.py:202-218`):

- **Asset number** is `TA-<YYMMDD of receipt date>-<8 random hex>`, for example `TA-261027-3F9A12BC` (`tool_assets.py:203`). It is not sequential.
- **QR value** is `hariom://tool/<asset no>` (`tool_assets.py:206`). The printed QR encodes a phone link, `<origin>/scan?c=hariom://tool/...` (`buildScanUrl`, `masters/tools/page.tsx:603`). The server works out the same `scan_url` (`tool_assets.py:151`).
- **Label** (`masters/tools/page.tsx:324-332`, printed through a pop-up window) shows HARI OM PAPER PRODUCTS, the asset no, the definition name, the category, the location and the QR.
- **Scanning:** `/scan` routes a tool label to `/masters/tools?asset=<no>` and finds which plant holds it. For anyone other than Owner or Admin it says "The tools register opens for the Owner and Admin only" (`app/(dashboard)/scan/page.tsx:245-247, 484`). The page also has a camera "Scan QR" button (`masters/tools/page.tsx:269-322`).

**Asset statuses** (`tool_assets.py:17`): `AVAILABLE`, `ISSUED`, `MAINTENANCE`, `GRINDING_OUT`, `SCRAP`. Each asset also carries a location (from Location Master), grind_version (V0 and up), usage_count, produced_qty, scrap_qty, current_job_card_id, received_at and retired_at.

### 1.4 Mandrels

`Masters > Mandrels` (`app/(dashboard)/masters/mandrels/page.tsx`) is a plain table. It shows only OD (mm) and Length (mm). The code is generated as `OD<od>-L<len>` (`masterdata-service/src/routers/mandrel.py:43-48`). Writes are Admin-only (Owner passes as a super role) (`mandrel.py:86,124,166`). A mandrel has no physical asset, QR, location, issue or usage. In spec sheets it narrows tube sizes to plus or minus 1 mm.

---

## 2. The tool inward "ledger"

### 2.1 Where it lives

| What the user sees | Route | Sidebar | Notes |
|---|---|---|---|
| **Inward** button on a definition row | `/masters/tools` | Foundation > Masters (Owner, Admin only, `layout.tsx:266-273`), then the "Physical tools" tab (`components/master/masters-nav.tsx:20`) | Enabled only for ACTIVE definitions and one selected plant (`masters/tools/page.tsx:460`) |
| Asset register "Inwarded tools and lifecycle" | same page | same | Lists assets, up to 200 by default (`tool_assets.py:231`) |
| Per-asset **Details / label** timeline | same page (dialog) | same | Shows the `INWARD` event with date and actor. The receipt no., supplier and location at inward are **not shown** (`page.tsx:604`) |
| Tooling ledger report | `/reports/tooling` | Reports > Tooling ledger (PlantManager, plus Owner and Admin, `layout.tsx:262`) | Totals per asset. **No inward dates, receipts or suppliers** |

**There is no receipt list, inward register, or "GET receipts" API.** `tool_receipts` rows are written (`tool_assets.py:188-199`) but no endpoint reads them back. To answer "what tools came in this month, from whom", someone would need the database.

### 2.2 How a tool comes in today: two paths, not connected

**Path A: direct tool inward (creates QR assets)**

1. On Masters > Physical tools, click **Inward** on a definition (`page.tsx:206-217`).
2. The dialog "Inward physical tool" (`page.tsx:564-575`) asks for:
   - Receipt date (required)
   - Quantity, 1 to 500 (required)
   - Supplier (free text, optional)
   - Receipt / GRN no (optional; auto `TGRN-YYYYMMDD-XXXXXX` if blank, `tool_assets.py:185`)
   - Location Master position (required)
3. The browser posts to the BFF `POST /api/inventory/tools/receipts` (`apps/bff-api/src/routes/inventory.py:760-801`). The BFF:
   - fetches the definition from masterdata and refuses it unless status is ACTIVE and active is true (`inventory.py:23-25, 769-781`);
   - **overwrites** category, name and attribute snapshot with the master's values, so a stale browser cannot change them (`inventory.py:26-34`).
4. Inventory `POST /inventory/tools/receipts` (`tool_assets.py:173-221`, roles Admin, Owner, Store):
   - checks the location is active in this plant;
   - checks the receipt no. is unique per plant (409 if not);
   - writes one `tool_receipts` header and N `tool_assets` (status AVAILABLE, at the location, V0), plus one `INWARD` event per asset.
5. A notification "Tool inward posted" goes to Owner, Admin, Store and Production (`inventory.py:791-800`).

**What a receipt records** (`tool_receipts`, migration `inventory-service/alembic/versions/008_physical_tooling_lifecycle.py:33-41`):

| Column | Filled from the UI? |
|---|---|
| receipt_no, receipt_date, location_id, plant_id | yes |
| supplier_name | yes (free text, not the vendor master) |
| po_reference, invoice_reference, notes | **no**: the API accepts them (`tool_assets.py:101-113`) but the dialog has no fields |
| created_by (user name), created_at | automatic |
| **rate / value / tax / quantity on header** | **not stored at all** (quantity is only the count of assets) |

**Path B: purchase (rate and cost, but no QR asset)**

1. Add an item of type **Tool** under Inventory > Material items.
2. Raise it in **Purchasing > Purchase requisitions** (`/purchase/requisitions`, visible to everyone; `layout.tsx:164`; the page groups items under "Tools / spares", `purchase/requisitions/page.tsx:35`). Anyone signed in can submit (`inventory-service/src/routers/requisitions.py:45-68`).
3. **Owner only** approves or rejects, with a reason and a version check (`requisitions.py:70-85`).
4. Create the PO. A Tool or Other item, or the OT series, **must** link an approved requisition, and material, unit and quantity must match it (`inventory-service/src/routers/purchase.py:821-829`).
5. Receive against the PO (GRN) with rate, as for any material. Manual GRN and old bulk inward refuse Tool items (`routers/manual_receipts.py:63-64`, `routers/inward.py:275-276`).
6. That stock is then **excluded** from the stock book (`services/stock_control.py:466`), counts (`services/stock_lots.py:50`), corrections (`routers/stock_control.py:2357`) and opening stock (`services/opening_stock.py:59`).

**Nothing joins A and B.** No code in inventory refers to `ToolReceipt` or `ToolAsset` outside `tool_assets.py`. So:

- A PO-bought tool does not create QR assets.
- A direct inward does not consume or reference the GRN.
- The PO reference cannot be entered in the UI.
- Tool cost never reaches the asset, the job card or the tooling report.

### 2.3 Links to stores, stock and costing (summary)

| Topic | Today |
|---|---|
| Location | Asset location must be a Location Master row (`tool_assets.py:43-51`). Move is recorded as an event |
| Stock book / counts | Tools are excluded. Physical tool assets are never counted in stock counts |
| Month-end close | The BFF does **not** apply the closed-month guard to tool receipts (`assert_not_backdated` is imported at `inventory.py:8` but not called in `receive_tool_assets`). Any receipt date, past or future, is accepted |
| Costing | No rate or value on tool receipts or assets. No tool cost per tube, no depreciation, no grinding cost |
| Vendor | Supplier is free text, not linked to the vendor master |

---

## 3. The rest of the lifecycle

### 3.1 Actions, rules and who can do them

All are under `/api/inventory/tools/assets/{id}/...` (BFF `inventory.py:804-885`), which calls inventory `tool_assets.py`. Owner and Admin pass every role check (`inventory-service/src/utils/auth.py:7,177-188`).

| Action | Allowed from status | Result | Server roles (plus Owner/Admin) | Code |
|---|---|---|---|---|
| Inward | n/a | new AVAILABLE assets | Store | `tool_assets.py:173-221` |
| Move | any except SCRAP | location changes; MOVE event | Store, Production | `:292-302` |
| Issue | AVAILABLE only | ISSUED, linked to job card and stage; assignment opened | Store, Production, PlantManager, Operator | `:305-320` |
| Usage (automatic) | ISSUED to the same job card | adds good/scrap qty, usage_count +1 | Production, PlantManager, Operator, ProductionEffects | `:323-350` |
| Return | needs an OPEN assignment | AVAILABLE; assignment closed | Store, Production, PlantManager, Operator | `:353-366` |
| Maintenance | AVAILABLE (also MAINTENANCE again) | MAINTENANCE | Store | `:396-405` |
| Complete maintenance | MAINTENANCE | AVAILABLE | Store | `:408-416` |
| Grinding out | Blade and AVAILABLE | GRINDING_OUT | Store | `:369-380` |
| Grinding return | Blade and GRINDING_OUT | AVAILABLE, grind_version +1 | Store | `:383-393` |
| Scrap | anything except ISSUED | SCRAP, retired_at set; no undo | Store | `:419-431` |

The BFF adds a check on issue: the job card must exist and the stage must be one of the card's stages (`inventory.py:16-20, 824-850`). It does **not** check whether the card is open, cancelled or closed.

### 3.2 Issue to the floor

- **From the job card:** a "Physical Tool Issue" box appears on the current-stage logging panel and in the Winder, Oven and Process sections of `JobCardDocument` (`components/production/JobCardDocument.tsx:2138, 2742, 2910, 3025`). This covers the job card page and phone entry. The dropdown lists **every AVAILABLE asset of every category** (`:2483`), not just the tools the spec calls for. Issuing writes the asset IDs into the stage's `tool_asset_ids` (`:2491-2493`). **There is no Return button on the job card.**
- **From Masters > Physical tools:** the Issue dialog has a job card dropdown (any 200 cards, any status) and stages Slitting, Winder, Oven, Process, Packing and QC (`masters/tools/page.tsx:590-591`). DISPATCH is missing in the UI but allowed by the server (`tool_assets.py:19`).
- There is no issue to a **machine** as such. The link is job card plus stage only.

### 3.3 Usage counting (automatic)

When a stage is completed, production posts usage for each asset issued to that card and stage:

- Direct save path: `production-service/src/routers/planning.py:9247-9257`.
- Completion worker: `production-service/src/completion_worker.py:76-82`.

Both call `_record_physical_tool_usage` (`planning.py:3264-3324`). It reads `tool_asset_ids` from the stage, or else asks inventory which assets are issued to the card and stage. It posts `good_qty` and `scrap_qty` with a key of `jobcard:stage:segment:asset` (`:3316`). The worker posts **once per segment**, using segment quantities. So "usage runs" in the report means segment postings, not job cards.

### 3.4 Grinding, repair and scrap

- **Grinding** applies to Blades only. The asset keeps its number and the version goes up on return. There is no vendor, challan, returnable gate pass, cost or expected-return date.
- **"Maintenance"** is the repair state. There is no reason, vendor or cost field. The UI sends no remarks, even though the API accepts `notes`.
- **Scrap** is one click in the UI, with no confirmation and no reason, and it cannot be undone.
- **Transfers:** Move changes location within the plant only. There is no plant-to-plant transfer.

### 3.5 The Tooling ledger report (`/reports/tooling`)

Page: `apps/web-ui/app/(dashboard)/reports/tooling/page.tsx`. It merges two APIs:

- master `GET /master/tools/report` (`tool.py:493-563`);
- inventory `GET /inventory/tools/report/summary` (`tool_assets.py:434-526`).

**There are no filters**: no date range, category, status, location or plant picker beyond the global plant. There is no export or print.

| Section | What it shows | How computed |
|---|---|---|
| Hero chips | physical assets, available, grinding out | live counts of `tool_assets` by status |
| KPI "Active definitions" | ACTIVE definitions | master `tool_master` count |
| KPI "Available assets" | AVAILABLE assets | asset count |
| KPI **"Grinding cycles"** | actually the **number of blades currently out for grinding**, not cycles (`page.tsx:60`) | status GRINDING_OUT count |
| KPI "Actual output" | sum of produced_qty over all assets | `tool_assets.produced_qty` |
| Category Status Matrix | definitions per category, status and "usage" | usage = spec sheets that picked the definition (`SPEC_SELECTED`), not production |
| Top Usage | definition log events grouped by tool and event; shows "planned pcs" | `tool_usage_log`. "planned pcs" is `production_qty`, which **nothing writes**, so it is always 0 (`page.tsx:119`). `PRODUCTION_USED` is never emitted anywhere |
| Asset output by category | assets, available, issued, grinding, scrap, output per category | `tool_assets` grouped (`tool_assets.py:477-482`). Maintenance is counted but not shown |
| Lifetime output by physical tool | every asset, with version, runs, good, scrap and status | asset counters, sorted by output |
| Output by blade grinding version | per asset and version: runs, good, scrap, last used | sums of `PRODUCTION_USAGE` events grouped by the version stamped on each event (`tool_assets.py:445-476`) |
| Recent Tool Trace | last 50 definition events (spec selections, master status changes) | `tool_usage_log`. Physical events do not appear here |

---

## 4. Roles, approvals, validation and audit

### 4.1 Who can do what

| Action | Server allows | Can they reach it in the UI? |
|---|---|---|
| Create/edit/discontinue/disable a definition; edit dropdown registry | Owner, Admin, PlantManager (`tool.py:39`) | Masters is in the sidebar for Owner and Admin only. A PlantManager has to type the URL |
| Inward, maintenance, grinding, scrap | Owner, Admin, Store | **Store has no sidebar route** to Masters, and `/scan` tells Store "Owner and Admin only". PlantManager gets 403 |
| Issue / return | + Store, Production, PlantManager, Operator | Issue from the job card works for floor roles. Return only from Masters |
| Mandrel create/edit/disable | Owner, Admin | Masters |
| Tool requisition | anyone signed in; Owner decides | Purchasing > Purchase requisitions |
| Tooling ledger report | any signed-in user (GET has no role check) | sidebar: PlantManager, Owner, Admin |
| Spec "tool selected" log | Admin, Owner, PlantManager, Planner, Sales, Production (`tool.py:579`) | SpecMaker is not listed, so a SpecMaker's spec save shows an error toast for the tooling trace |

The UI does not hide lifecycle buttons by role. A user who can open the page sees every button, and the server refuses with 403.

### 4.2 Approvals

- **Only tool requisitions need approval** (Owner). The PO then follows its own approval.
- **Direct tool inward, scrap and grinding need no approval.** There is no maker-checker.

### 4.3 What blocks and what warns

Blocks:

- inward of a non-active definition;
- inward without an active location;
- duplicate receipt no.;
- quantity outside 1 to 500;
- issue of a non-AVAILABLE asset;
- issue to a stage that is not on the card;
- usage unless the asset is issued to that card;
- grinding of a non-Blade;
- scrap of an ISSUED tool;
- move of a SCRAP tool;
- duplicate definition name in a category;
- missing required points;
- a changed category;
- duplicate dropdown value;
- a Tool PO without an approved requisition;
- a Tool item on a manual GRN.

There are no warnings in the tool flow. Everything above is a hard refusal.

### 4.4 Audit trail

- **`tool_asset_events`** is the per-asset log: type, from/to status, job card, stage, quantities, grind version, metadata, actor name and time (`tool_assets.py:67-98`). It is append-only in code. The timeline dialog shows it, but not the metadata (receipt no., notes).
- **`tool_usage_log`** is the definition log: STATUS_CHANGE on create, status change and disable; SPEC_SELECTED on spec save. Edits to name or points are **not** logged here (`tool.py:733`), and the 16 back-filled definitions have no log rows.
- **System > Audit:** both services install the shared ORM audit outbox (`inventory-service/src/database.py:50`, `masterdata-service/src/database.py`). Every row write, including option edits, is captured there with the actor.
- Assignment rows store issued_at and returned_at but not who issued or returned. The "who" is only in the events.

---

## 5. Data model and API

### 5.1 Tables

| Service / DB | Table | Key columns |
|---|---|---|
| masterdata | `tool_master` | id, category, name, attribute_values (JSON), spec_text, department, status, active, usage_count, plant_id; unique (plant, category, name) |
| masterdata | `tool_attribute_option` | category, field_key, value, active, sort_order, plant_id; unique (plant, category, field, value) |
| masterdata | `tool_usage_log` | tool_id, category, tool_name, event_type, source_type/id/ref, production_qty, actor, notes, metadata_json |
| masterdata | `mandrel` | mandrel_code, outer_diameter_mm, od_tolerance_mm, length_mm, material, active, plant_id |
| inventory | `tool_receipts` | receipt_no, receipt_date, supplier_name, po_reference, invoice_reference, location_id, notes, created_by, plant_id |
| inventory | `tool_assets` | asset_no, qr_value, tool_definition_id (no FK; different DB), category, definition_name, attribute_snapshot, status, location_id, receipt_id, grind_version, usage_count, produced_qty, scrap_qty, current_job_card_id, received_at, retired_at, plant_id |
| inventory | `tool_asset_events` | asset_id, event_type, from/to_status, source_id, job_card_id, stage_type, good/scrap_qty, grind_version, metadata_json, actor, event_at |
| inventory | `tool_asset_assignments` | asset_id, job_card_id, stage_type, issued_at, returned_at, status OPEN/CLOSED, good/scrap_qty, usage_key (unique), notes |
| inventory | `purchase_requisitions` | pr_no, item_id, quantity, uom, reason, requested_by, status, decided_by, purchase_order_id, history |
| production | job card stage `entry_snapshot.tool_asset_ids` | comma list of asset IDs issued per stage |

Schema: `inventory-service/alembic/versions/008_physical_tooling_lifecycle.py`; models `inventory-service/src/models.py:149-248`, `masterdata-service/src/models.py:99-117, 344-410`.

### 5.2 Endpoints (browser to BFF to service)

| BFF (`/api/...`) | Service | Purpose |
|---|---|---|
| GET/POST `master/tools`, PUT/DELETE `master/tools/{id}`, POST `master/tools/{id}/status` | masterdata `/master/tools...` | definitions (DELETE is a soft disable) |
| GET `master/tools/categories`, GET/POST `master/tools/options`, PUT `master/tools/options/{id}` | masterdata | categories and dropdown registry |
| GET `master/tools/logs`, GET `master/tools/report`, POST `master/tools/log-usage`, POST `master/tools/backfill-from-specs` | masterdata | definition log, report, spec trace, back-fill |
| POST `inventory/tools/receipts` | inventory `/inventory/tools/receipts` (BFF validates master) | inward |
| GET `inventory/tools/assets`, GET `inventory/tools/assets/{id}` | inventory `/inventory/tools`, `/inventory/tools/{id}` | asset list (search, category, status, job_card_id, stage_type, limit) and asset with events |
| POST `inventory/tools/assets/{id}/move, issue, usage, return, grinding-out, grinding-return, maintenance, maintenance-complete, scrap` | inventory same | lifecycle |
| GET `inventory/tools/report` | inventory `/inventory/tools/report/summary` | asset report |
| `master/mandrels` CRUD | masterdata `/master/mandrels` | mandrels |
| `inventory/purchase/requisitions` (GET/POST, POST `{id}/decision`) | inventory | requisitions |

Web client map: `apps/web-ui/lib/api.ts:270-283, 585-597`.

---

## 6. Gaps, oddities and risks

### 6.1 Missing screens and abilities

1. **No tool inward register.** There is no list of tool receipts (date, receipt no., supplier, definition, qty, location, who), no GET API for `tool_receipts`, and no export. The asset timeline does not show the receipt no. or supplier (`masters/tools/page.tsx:604`).
2. **Purchasing and physical tools are disconnected** (section 2.2). This invites double entry, and there is no way to prove that every PO-bought tool received a QR label.
3. **No cost anywhere on physical tools.** There is no rate, value or depreciation, and grinding or maintenance costs are not captured.
4. **PO / invoice reference and notes** are stored by the API but cannot be entered in the inward dialog (`page.tsx:569-571` versus `tool_assets.py:104-106`).
5. **Store cannot get to the tool page** from the sidebar or a scan, although the server makes Store the main inward and maintenance role. PlantManager can edit definitions but cannot inward, grind or scrap.
6. **No Return on the job card.** Tools stay ISSUED after the job is done unless an Owner or Admin returns them on the Masters page.
7. **No reason or confirmation** for Scrap, Maintenance or Grinding. The `notes` field exists in the API, but the UI never sends it. Scrap is irreversible.
8. **No plant-to-plant transfer, no machine assignment, and no tool life or regrind limit** (for example "blade due for grinding after N tubes"). Physical tools are never counted in stock counts.
9. **Disabled definitions cannot be re-enabled** from the UI. The API supports `active: true` on PUT, but there is no button.
10. **Mandrels have no physical tracking** (no asset, QR or usage).
11. **The Tooling ledger has no filters or export**, and no per-job-card or per-customer view for complaint tracing.

### 6.2 Bugs and inconsistencies

1. **Possible double count of output on retry (risk).** `record_tool_usage` overwrites the assignment's single `usage_key` with each new segment key (`tool_assets.py:342`). The idempotency lookup checks only that column (`:326-331`). Suppose the completion worker posts segments 1 and 2, then fails and retries. Segment 1's key is no longer stored, so its quantity is added again. Separately, the direct save path posts the **whole-stage** quantity (`planning.py:3288`) while the worker posts **per-segment** quantities. This should be tested before tool output is relied on.
2. **A return before usage is posted** makes the usage post fail with 409 ("Tool must be issued to this job card", `tool_assets.py:332-333`). The worker then keeps retrying, or the save shows "tool usage not posted yet" (`planning.py:8312-8334`).
3. **Issue does not check job card status.** Cancelled or closed cards can receive tools (BFF `inventory.py:16-20`). The Masters issue dialog lists any 200 cards.
4. **The job card picker ignores the spec.** Any available asset of any category can be issued to any stage (`JobCardDocument.tsx:2483`). There is no check that the blade or notch matches the spec's tooling.
5. **Report labels:**
   - "Grinding cycles" is really "blades out now" (`reports/tooling/page.tsx:60`).
   - "planned pcs" is always 0 (`:119`).
   - The master report's `maintenance` and `scrap` summary keys can never be non-zero, because definitions only have ACTIVE and DISCONTINUED (`tool.py:536-541`). The page reads them into unused variables (`page.tsx:34-35`).
   - The Masters "Usage: spec/job logs" column counts spec selections only.
6. **Asset list is capped at 200** on Masters (`tool_assets.py:231`; the page passes no limit). Older assets only show up when searched for.
7. **Closed month not enforced** on tool receipts. Backdated or future receipt dates are accepted.
8. **Back-filled definitions have no points.** All 16 live definitions are like this, so the first edit of each one forces the required points to be filled in. Spec dropdowns show bare names.
9. **Renaming a dropdown value** changes the registry only. Existing definitions keep the old text in `attribute_values`.
10. **Mandrel duplicate check is global**, not per plant (`mandrel.py:95-97`), while the database unique key is per plant.
11. **The "Recent Tool Events" table on the Masters page** shows definition logs, not physical asset events (`masters/tools/page.tsx:624-658`), and it is empty in live data.

### 6.3 Docs and tests out of date

- `docs/TOOLING_LIFECYCLE_CLIENT_GUIDE.md`:
  - shows sequential asset numbers like `TA-260714-001` (line 96); the real numbers are random hex;
  - says "Confirm the return location if requested" (line 128); return has no location;
  - says "Use the remarks field on the event" (line 138); the UI has no remarks.
- `docs/TOOLING_IMPLEMENTATION_REPORT.md` and `TOOLING_LIFECYCLE_CHECKLIST.md` still describe the Railway deployment and "Masters > Tools".
- `TESTING_GUIDE.md` has no tooling section.
- `apps/web-ui/e2e/tooling-lifecycle.spec.cjs` is stale and will probably fail:
  - it expects the heading "Tooling Master" (line 29), but the page says "Physical tools" (`masters/tools/page.tsx:341`);
  - it opens `/production/supervisor-entry` (line 83), which now redirects to the floor entry picker.

### 6.4 Suggested next steps (for the owner to decide; none started)

1. Add a **Tool inward register** page with a receipts list, filters and CSV.
2. Link tool receipts to a PO/GRN line, and carry the rate onto each asset.
3. Give Store a sidebar entry to the tool register.
4. Add **Return** on the job card.
5. Make Scrap ask for a reason and confirmation.
6. Fix the usage idempotency (store one key per usage event, not one per assignment).
7. Correct the report labels and add filters.
8. Refresh the client guide and the e2e test.
