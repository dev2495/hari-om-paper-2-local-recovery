export type GuideStep = {
  label: string
  detail: string
}

export type GuideContent = {
  id: string
  route: string
  title: string
  eyebrow: string
  summary: string
  flowTitle: string
  steps: GuideStep[]
  fieldRules: string[]
  primaryActions: string[]
  controlChecks: string[]
  outputs: string[]
  relatedRoutes: string[]
}

const guides: GuideContent[] = [
  {
    id: "dashboard",
    route: "/dashboard",
    title: "Control Room Guide",
    eyebrow: "Daily start point",
    summary: "Use this page to read company posture before opening any transaction screen.",
    flowTitle: "Daily management loop",
    steps: [
      { label: "Review alerts", detail: "Start with overdue orders, stock risk, QC holds, and plant blockers." },
      { label: "Pick scope", detail: "Switch role or plant only when the task needs a narrower operating view." },
      { label: "Open work", detail: "Move into sales, planning, inventory, quality, or dispatch from the current exception." },
      { label: "Close loop", detail: "Return here after action to confirm the signal moved." },
    ],
    fieldRules: [
      "Plant switcher controls write scope for plant users.",
      "Owner and Admin can read all plants and still use plant filters for execution.",
      "Critical alerts should be cleared by completing the source workflow, not by hiding the alert.",
    ],
    primaryActions: [
      "Use Jump to workspace or Command/Ctrl + K to find a workflow by name. Open Appearance settings for Light, Dark or System and table density.",
      "Open the notification center for recent operational messages.",
      "Use the guide button in the header to understand the page you are on.",
    ],
    controlChecks: [
      "Check that pending approvals, QC holds, and dispatch queues are reviewed daily.",
      "Verify that books lock status is visible before editing historical stock.",
    ],
    outputs: ["Clean shift handoff", "Open exception list", "Confirmed plant scope"],
    relatedRoutes: ["/sales-orders", "/planning/board", "/inventory/lifecycle", "/reports/owner"],
  },
  {
    id: "sales",
    route: "/sales-orders",
    title: "Sales Order and Release Guide",
    eyebrow: "Customer demand to planner queue",
    summary: "Capture customer demand, confirm the specification, approve the order, and release it to planning only when the commercial details are correct.",
    flowTitle: "Order release flow",
    steps: [
      { label: "Create order", detail: "Select customer, product specification, parchment, quantity, and due date." },
      { label: "Approve", detail: "Approver validates demand, customer terms, and any exception notes." },
      { label: "Release", detail: "Select a winder number or name as a release hint. The released job enters the planning queue; the planner may use another available winder." },
      { label: "Track", detail: "Tracking page follows the order through job card, FG, QC, and dispatch." },
    ],
    fieldRules: [
      "Customer and specification must be selected from masters.",
      "Parchment display is color first, then company, so operators can scan quickly.",
      "Due date should be realistic for stock, capacity, and pending QC holds.",
    ],
    primaryActions: [
      "Create new order from Sales Orders.",
      "Approve and release selected approved orders.",
      "Open order audit to review who changed demand or release status.",
    ],
    controlChecks: [
      "Do not release an order without a valid specification.",
      "Review partial release quantity before sending to planning.",
      "Use tracking before dispatch if customer asks for status.",
    ],
    outputs: ["Approved demand", "Planner release", "Order audit trail"],
    relatedRoutes: ["/sales-orders/new", "/planning/board?section=winder", "/production/job-cards", "/logistics/dispatch"],
  },
  {
    id: "specifications",
    route: "/specifications",
    title: "Specification Guide",
    eyebrow: "Product truth",
    summary: "Build and maintain the product recipe that drives sales, planning, production, QC, and consumption variance.",
    flowTitle: "Specification control flow",
    steps: [
      { label: "Select masters", detail: "Pick paper, mandrel, adhesive, parchment, and packing masters." },
      { label: "Confirm math", detail: "Validate OD, length, GSM, ply recipe, and machine assumptions." },
      { label: "Save spec", detail: "Approved specs become selectable in sales and job cards." },
      { label: "Use in execution", detail: "Recipe theory is compared against actual consumption after production." },
    ],
    fieldRules: [
      "Masters hold identity and dimensions; price is captured only at inward batch level.",
      "Mandrel master uses length in mm and OD in mm only.",
      "Do not change an active spec casually; create a corrected version when commercial history matters.",
    ],
    primaryActions: [
      "Create a new spec before taking a new product order.",
      "Preview the spec sheet output for operator and customer clarity.",
      "Use audit history when a formula or master value is questioned.",
    ],
    controlChecks: [
      "Confirm spec dimensions match customer PO.",
      "Confirm material masters have active stock before release.",
      "QC should test final product against the same spec.",
    ],
    outputs: ["Approved product spec", "Recipe theory", "Printable spec sheet"],
    relatedRoutes: ["/sales-orders/new", "/masters/papers", "/quality", "/reports/production"],
  },
  {
    id: "purchase",
    route: "/purchase",
    title: "Purchase and Vendor Guide",
    eyebrow: "Procurement control",
    summary: "Create a numbered PO draft, submit its immutable revision for maker-checker approval, and revise any vendor-agreed change before stores receive it.",
    flowTitle: "Controlled PO flow",
    steps: [
      { label: "Create draft", detail: "Select RM/PM or OT. The server reserves RP-PM/nn or OT/nn; users never type the PO number." },
      { label: "Submit revision", detail: "The complete vendor, lines, rates, specifications and dates become a review snapshot." },
      { label: "Approve", detail: "A different authorized user approves or rejects that exact revision." },
      { label: "Revise changes", detail: "Any later vendor, quantity, rate, specification or delivery change creates a new revision and needs approval again." },
    ],
    fieldRules: [
      "Paper ordered and fulfilled quantity is kg; expected reel or coil count is a separate planning field.",
      "An approved rate is immutable evidence and cannot be overwritten during inward.",
      "Batch price belongs to inward stock. Planning standard costs never overwrite PO rates, invoice rates or historical batch valuation.",
      "Draft edits require a reason and version check after the first approval.",
    ],
    primaryActions: [
      "Search all matching orders on the server; use the page-size selector and numbered pagination. Search and page state are kept in the URL.",
      "Create one or more PO lines.",
      "Submit a complete draft for approval.",
      "Print the saved PO or open its revision history.",
      "Open Purchase registers for full Excel exports or A3/A4 PDFs. Wide registers repeat document identity across column sections so every field stays readable.",
    ],
    controlChecks: [
      "Confirm the supplier, category and plant before submission.",
      "Confirm each line’s saved unit, rate per unit and physical count. KG and PCS totals are separate; cancelled and rejected orders do not add to open requirement.",
      "Verify the current revision is approved before asking stores to receive it.",
    ],
    outputs: ["Automatic PO number", "Approved revision", "Printable saved PO"],
    relatedRoutes: ["/purchase/new", "/purchase/approvals", "/purchase/inward", "/purchase/scheduler"],
  },
  {
    id: "purchase-inward",
    route: "/purchase/inward",
    title: "Manual and PO-Linked Inward Guide",
    eyebrow: "Measured kg and physical identity",
    summary: "Open Stores → Goods inward. Choose vendor and either an approved system PO or Manual GRN without PO. Enter multiple materials with one measured and labelled lot per physical reel or coil.",
    flowTitle: "Receipt to usable stock",
    steps: [
      { label: "Choose receipt source", detail: "Select vendor, then approved PO and material lines. For a manual GRN, select materials directly and explain why no PO exists; a separate checker must approve it." },
      { label: "Record invoice", detail: "Enter invoice number, date, quantity and rate, or mark invoice pending to save held physical stock." },
      { label: "Weigh every lot", detail: "Enter or paste vendor reel number, net kg, measured width and optional gross/tare for every physical reel or coil, then review the staged rows." },
      { label: "Post once", detail: "The server rechecks balance and creates one GRN, one stock identity and one immutable label record per physical unit." },
    ],
    fieldRules: [
      "Sum of individual net weights is the received quantity in kg. Add another material for mixed loads.",
      "Tab moves between lot fields. Enter advances through inputs; Enter at the last lot field appends a new row. Paste columns: vendor number, net kg, width mm, form, gross kg, tare kg, vendor batch.",
      "One reel or coil equals one lot, one AT number and one saved label; label reprints never create stock.",
      "Invoice-pending and any rate or quantity difference stay commercially held until an authorized decision.",
      "Measured width outside the approved PO width tolerance opens a separate specification case with lot-level evidence.",
      "Gross minus tare must equal entered net kg within weighing precision when all three are supplied.",
    ],
    primaryActions: ["Preview controls before posting.", "Validate the entered receipt, review every result and use Post goods inward once. Changing a field invalidates the old preview and requires validation again.", "Prepare the saved AT label batch, then open the 4 × 2 inch PDF and print at actual size. Set copies and enter a reason for a reprint; reprinting never creates stock.", "Open Stores → GRN register and labels to attach invoices, pass or hold QC, approve manual receipts or reprint labels."],
    controlChecks: ["Verify total kg does not exceed the open PO line.", "Verify each vendor reel number is unique for that supplier.", "Resolve QC and commercial holds independently."],
    outputs: ["Manual or PO-linked GRN", "Physical lot identities", "Saved labels", "Invoice comparison cases"],
    relatedRoutes: ["/purchase", "/purchase/discrepancies", "/purchase/registers", "/inventory/genealogy"],
  },
  {
    id: "purchase-commercial",
    route: "/purchase/discrepancies",
    title: "Invoice Difference and Debit Note Guide",
    eyebrow: "Commercial exception control",
    summary: "Track each invoice rate, quantity or specification difference without changing the approved PO, hiding favorable variances, or mixing a stock decision with a financial claim.",
    flowTitle: "Difference to settlement",
    steps: [
      { label: "Review case", detail: "Compare the receipt, invoice and approved revision at the saved allocation quantity." },
      { label: "Decide stock", detail: "Accept the difference or explicitly release material while the claim remains open; QC is still independent." },
      { label: "Open claim", detail: "Select positive rate differences for one vendor and create a numbered debit-note draft." },
      { label: "Approve and settle", detail: "Submit, approve, issue and record corrected invoice, credit note, adjustment or write-off references." },
    ],
    fieldRules: ["Positive and favorable differences remain separate.", "Quantity differences are visible but do not become a fabricated rate claim.", "A receipt maker cannot approve their own commercial exception.", "Partial settlement leaves the remaining claim open."],
    primaryActions: ["Record an audit reason for every decision.", "Create one debit note per vendor.", "Print or export the saved claim record."],
    controlChecks: ["Do not clear QC by accepting a price.", "Do not change PO or invoice evidence to force a match.", "Confirm settlement amount never exceeds open claim value."],
    outputs: ["Difference history", "Stock release decision", "Debit-note register", "Settlement balance"],
    relatedRoutes: ["/purchase/inward", "/purchase/debit-notes", "/purchase/registers", "/system/audit"],
  },
  {
    id: "purchase-scheduler",
    route: "/purchase/scheduler",
    title: "Monthly RM Scheduler Guide",
    eyebrow: "Calendar planning",
    summary: "Build a date-by-material kg plan from live stock, demand and open PO supply; review spreadsheet imports before they become plan entries or PO drafts.",
    flowTitle: "Target to PO draft",
    steps: [
      { label: "Review open sales demand", detail: "Refresh material requirements from approved open sales orders and the existing BOM calculator. Unreleased units are reduced by accepted allocated finished goods before BOM calculation. Active jobs use frozen BOMs less item-specific net issues. Missing recipes, material mappings or shared consumption attribution block automatic MRP." },
      { label: "Review MRP", detail: "The server shows usable opening stock, committed PO supply, net need, rounding and data gaps." },
      { label: "Place entries", detail: "Choose a date on the monthly calendar, enter arrival kg and assign a vendor. Stage suggested shortages, distribute a monthly target, or switch to the workbook grid. Export Excel or print the month." },
      { label: "Approve and convert", detail: "Submit the plan, approve its version, review vendor assignments, then create traceable PO drafts." },
    ],
    fieldRules: ["Choose the worksheet and KG or MT unit. Only the first daily RM block imports; lower finished-goods tables are excluded. Map each material header or explicitly exclude a helper column. Duplicate material/date cells are summed before staging.", "Unknown item/vendor codes remain blocked rows; no fuzzy master creation.", "Physical count never calculates actual kg.", "Only approved plan entries convert, and retries cannot duplicate POs."],
    primaryActions: ["Import the supplied workbook or canonical template.", "Enter kg directly in calendar cells.", "Run explainable MRP.", "Generate PO drafts grouped by vendor and series."],
    controlChecks: ["Do not double count opening stock and live stock.", "Keep held stock outside usable supply.", "Review MOQ and order-multiple overage before conversion."],
    outputs: ["Versioned month plan", "MRP explanation", "Vendor grouping", "Linked PO drafts"],
    relatedRoutes: ["/analytics/mrp", "/purchase/new", "/purchase", "/inventory/stock-alert-policies"],
  },
  {
    id: "stock-alerts",
    route: "/inventory/stock-alert-policies",
    title: "Stock Alert Policy Guide",
    eyebrow: "Versioned stock thresholds",
    summary: "Define the single effective safety, reorder and target stock policy used by alerts, MRP and procurement planning for each material and plant.",
    flowTitle: "Policy to alert episode",
    steps: [
      { label: "Create draft", detail: "Select a material and enter safety, reorder, target, recovery, lead time, MOQ and order multiple in kg." },
      { label: "Validate order", detail: "Target must be at least reorder, and reorder at least safety." },
      { label: "Activate", detail: "An authorized activation supersedes the previous policy version while preserving history." },
      { label: "Work alerts", detail: "Evaluate usable stock, then acknowledge, assign, snooze or follow the source shortage to a PO draft." },
    ],
    fieldRules: ["Policies are plant and item scoped.", "QC-held, blocked and commercial-held stock is excluded from usable stock.", "Acknowledging an alert never changes stock.", "Recovery uses the saved recovery margin to prevent repeated alert noise."],
    primaryActions: ["Save policy draft.", "Activate a reviewed version.", "Evaluate alerts.", "Open the alert inbox."],
    controlChecks: ["Confirm units are kg.", "Confirm recipients and cooldown.", "Review existing open PO coverage before buying again."],
    outputs: ["Effective policy version", "Deduplicated alert episode", "MRP threshold input"],
    relatedRoutes: ["/inventory/stock-alerts", "/analytics/mrp", "/purchase/scheduler", "/purchase"],
  },
  {
    id: "rm-costing",
    route: "/inventory/rm-costing",
    title: "RM Costing Sheet Guide",
    eyebrow: "Owner / Admin planning cost",
    summary: "Maintain a separate, versioned standard costing sheet for each raw material without changing PO rates, invoice rates or historical stock valuation.",
    flowTitle: "Cost draft to active version",
    steps: [
      { label: "Choose material", detail: "Open the current base and landed planning cost for one raw material." },
      { label: "Build cost", detail: "Enter base cost and typed freight, duty, handling, discount or other components with explicit bases." },
      { label: "Review impact", detail: "Check normalized currency/kg, effective date, change reason and version history." },
      { label: "Activate", detail: "An actual Owner or Admin activates the immutable version; restore creates a new draft instead of rewriting history." },
    ],
    fieldRules: ["Only an actual Owner or Admin in an administrative role may create, activate or restore costing versions.", "Percent, per-kg and fixed-per-lot components use explicit calculation modes.", "Active standard cost is for estimates and planning; it never overwrites receipt or issued-stock cost."],
    primaryActions: ["Create a cost draft.", "Activate an effective version.", "Inspect complete history.", "Restore an old version as a new draft."],
    controlChecks: ["Record a clear change reason.", "Use a positive reference kg for fixed-per-lot charges.", "Verify the landed cost and effective date before activation."],
    outputs: ["Active RM cost version", "Component calculation", "Complete immutable history"],
    relatedRoutes: ["/purchase/scheduler", "/analytics/mrp", "/purchase/new", "/system/audit"],
  },
  {
    id: "inventory",
    route: "/inventory",
    title: "Inventory and Opening Stock Guide",
    eyebrow: "Stock truth",
    summary: "Control opening setup, inward batches, issue to WIP, FG receipt, adjustments, and ledger visibility from one stock discipline.",
    flowTitle: "Stock lifecycle",
    steps: [
      { label: "Opening", detail: "Enter first-time company stock balances with material, batch, vendor, and valuation." },
      { label: "Inward", detail: "Receive batches with price and vendor at transaction level." },
      { label: "Issue", detail: "Issue only selected stock to job cards or production stages." },
      { label: "Reconcile", detail: "Compare physical stock, ledger, WIP, FG, and consumption variance." },
    ],
    fieldRules: [
      "No master should carry a price column.",
      "Batch number is generated by the system during inward.",
      "Opening stock should be used only for first-time setup or approved migration.",
    ],
    primaryActions: [
      "Review inventory summary by material type.",
      "Use stock lifecycle for close and carry-forward posture.",
      "Open genealogy when a batch or finished product needs traceability.",
    ],
    controlChecks: [
      "Do not issue blocked or QC-held stock.",
      "Confirm vendor and price are present on inward batch.",
      "Reconcile stock before books lock.",
    ],
    outputs: ["Current stock", "Batch ledger", "Reconciliation basis"],
    relatedRoutes: ["/inventory/raw-material-inward", "/inventory/production-issue", "/inventory/lifecycle", "/inventory/genealogy"],
  },
  {
    id: "raw-inward",
    route: "/inventory/raw-material-inward",
    title: "Raw Material Inward Guide",
    eyebrow: "Batch receiving",
    summary: "Receive material into stock with system batch number, vendor, quantity, and price for valuation and consumption tracking.",
    flowTitle: "Inward batch flow",
    steps: [
      { label: "Select material", detail: "Pick material type and master item." },
      { label: "Tag vendor", detail: "Select the supplier from vendor master before saving." },
      { label: "Enter batch facts", detail: "Quantity, rate, invoice reference, and date belong to the inward batch." },
      { label: "Post stock", detail: "System creates stock ledger and makes the batch available." },
    ],
    fieldRules: [
      "Batch number is automatic and should not be typed by users.",
      "Price is required at inward and can vary between batches.",
      "Vendor is mandatory for all inward entries.",
    ],
    primaryActions: [
      "Use scan or form entry depending on material type.",
      "Save inward only after confirming quantity and unit.",
      "Print or record batch label where the shop floor needs it.",
    ],
    controlChecks: [
      "Reject inward if vendor is missing.",
      "Verify rate before posting because it affects valuation.",
      "Check that received quantity appears in inventory after save.",
    ],
    outputs: ["Auto batch number", "Vendor-linked stock", "Batch price ledger"],
    relatedRoutes: ["/purchase", "/inventory", "/inventory/genealogy", "/reports/inventory"],
  },
  {
    id: "production-issue",
    route: "/inventory/production-issue",
    title: "Production Issue and WIP Movement Guide",
    eyebrow: "Stock to job card",
    summary: "Move selected stock from store into WIP against the job card so consumption, variance, and genealogy remain traceable.",
    flowTitle: "WIP stock movement",
    steps: [
      { label: "Pick job card", detail: "Use the job card as the production demand document." },
      { label: "Select batches", detail: "Choose available paper, adhesive, mandrel, parchment, packing, or reels." },
      { label: "Issue to stage", detail: "Move stock into the correct process stage before consumption." },
      { label: "Compare actuals", detail: "Supervisor close records actual output and waste for variance." },
    ],
    fieldRules: [
      "Issue movement must reference a job card.",
      "WIP stock should remain visible until the stage is completed or reversed.",
      "Consumption variance should compare actual issue and output against spec theory.",
    ],
    primaryActions: [
      "Issue selected batches to the active job card.",
      "Review WIP balance before closing the process.",
      "Open genealogy for batch-to-FG traceability.",
    ],
    controlChecks: [
      "Do not issue more than available stock.",
      "Record QC check after each process stage before moving forward.",
      "Investigate variance outside tolerance before month close.",
    ],
    outputs: ["WIP ledger", "Job-card consumption", "Variance base"],
    relatedRoutes: ["/production/job-cards", "/production/supervisor-entry", "/quality", "/inventory/genealogy"],
  },
  {
    id: "planning",
    route: "/planning/board",
    title: "Planner and Winder Capacity Guide",
    eyebrow: "Capacity to schedule",
    summary: "Plan released demand by machine and shift using meter-based capacity and drag-down scheduling controls.",
    flowTitle: "Planner execution flow",
    steps: [
      { label: "Load demand", detail: "Released sales orders appear in the planner queue." },
      { label: "Check meters", detail: "Winder capacity is shown in meters per shift." },
      { label: "Schedule", detail: "Choose a winder and shift, then schedule. Demand larger than a slot is split across capacity slots; piece totals stay equal to the released quantity." },
      { label: "Open job", detail: "Open the existing released job card and confirm its saved schedule before execution." },
    ],
    fieldRules: [
      "Winder capacity is measured in meters made per shift.",
      "The release winder is a hint. Any available winder in the selected plant can be planned; geometry and mandrel mismatches appear as setup warnings. Capacity, unavailable machines, plant permissions and QC holds remain enforced.",
      "Plant scope must be selected for write actions when role requires it.",
    ],
    primaryActions: [
      "Open Planning overview, Winder, Oven, Process or Slitting from the sidebar. The Planning workspace selector changes stage while preserving the selected date and focused order. Saved board URLs remain supported.",
      "Use the stage workspaces for winder, oven, process or slitting; open dispatch from its separate workspace.",
      "Drag or release demand into the correct machine window.",
      "Open generated job card link before handing to production.",
    ],
    controlChecks: [
      "Capacity shown on cards should match machine settings.",
      "Review material availability before scheduling urgent orders.",
      "Do not ignore QC or stock holds while planning. Packing measurements do not replace final QC. Dispatch requires a current passing final inspection.",
    ],
    outputs: ["Shift schedule", "Machine queue", "Job card handoff"],
    relatedRoutes: ["/sales-orders", "/production/job-cards", "/production/supervisor-entry", "/reports/production"],
  },
  {
    id: "job-cards",
    route: "/production/job-cards",
    title: "Job Card Guide",
    eyebrow: "Execution packet",
    summary: "Use job cards as the single shop-floor document connecting released sales demand, recipe, issued stock, QC checks, and final output.",
    flowTitle: "Job-card execution flow",
    steps: [
      { label: "Open job", detail: "Planner-created job card carries order, spec, machine, and quantity." },
      { label: "Issue stock", detail: "Store issues selected batches into WIP for this job." },
      { label: "Run process", detail: "Operator records stage completion, output, waste, and remarks." },
      { label: "Close output", detail: "Approved output moves to FG or next process after QC." },
    ],
    fieldRules: [
      "Job card ID should drive production issue and supervisor entry.",
      "Each process completion should have a basic QC checkpoint.",
      "Final product must pass full spec QC before unrestricted dispatch.",
    ],
    primaryActions: [
      "Print the job card for shop-floor use.",
      "Open supervisor entry from job card when recording output.",
      "Review audit and genealogy when material questions arise.",
    ],
    controlChecks: [
      "Confirm issued material matches the job card recipe.",
      "Verify output, scrap, and hold quantity before close.",
      "Do not dispatch FG that still has QC hold.",
    ],
    outputs: ["Execution packet", "Stage actuals", "FG or WIP movement"],
    relatedRoutes: ["/inventory/production-issue", "/production/supervisor-entry", "/quality", "/inventory/genealogy"],
  },
  {
    id: "quality",
    route: "/quality",
    title: "Quality Control Guide",
    eyebrow: "Stage and final inspection",
    summary: "Run basic QC at each process completion and full product specification QC before finished goods are released.",
    flowTitle: "QC decision flow",
    steps: [
      { label: "Stage check", detail: "Record quick process QC after each completion." },
      { label: "Final spec", detail: "Check length, OD, color, finish, packing, and customer-specific requirements." },
      { label: "Decision", detail: "Pass, hold, rework, or reject with remarks and evidence." },
      { label: "Release", detail: "Only passed stock moves to unrestricted FG or dispatch." },
    ],
    fieldRules: [
      "QC decisions should reference job card, batch, or FG lot.",
      "Hold and reject reasons must be clear enough for audit.",
      "Final QC should compare against the saved specification, not memory.",
      "Mark an item or stage criterion Critical: cannot be waived before approval when required by the client. Failed critical checks cannot be released by a reason, administrator concession or stage override. Existing lots and jobs keep their frozen rules.",
      "Editing an approved item profile opens a new draft. Save it for review and approve separately; receipts continue using the prior approved revision until then.",
    ],
    primaryActions: [
      "Create stage QC checks during supervisor completion.",
      "Create final product QC before dispatch.",
      "Use holds to block bad stock without losing traceability.",
    ],
    controlChecks: [
      "Confirm QC hold prevents dispatch.",
      "Review repeated defects through reports.",
      "Attach remarks for every failed or reworked quantity.",
    ],
    outputs: ["QC pass", "QC hold", "Rework or reject trail"],
    relatedRoutes: ["/production/supervisor-entry", "/production/job-cards", "/inventory/genealogy", "/logistics/dispatch"],
  },
  {
    id: "dispatch",
    route: "/logistics/dispatch",
    title: "Dispatch Guide",
    eyebrow: "FG to customer",
    summary: "Pack, verify, and dispatch finished goods only after production, inventory, and quality controls are complete.",
    flowTitle: "Dispatch handoff flow",
    steps: [
      { label: "Pick FG", detail: "Select finished goods lot or job card output ready for dispatch." },
      { label: "Verify QC", detail: "Confirm no active hold remains and a current complete final QC inspection has passed. Packing measurements alone do not release the job." },
      { label: "Prepare shipment", detail: "Select the remaining quantity to ship, review packing and customer details, then enter vehicle, transporter and LR information. Phone screens show the same fields in stacked sections." },
      { label: "Post dispatch", detail: "Seal once. Only this shipment's quantity moves out; sales fulfillment and remaining FG update. Open the sealed shipment to print its challan. A retry of the same request does not post stock twice." },
    ],
    fieldRules: [
      "Dispatch should reference customer order and FG lot.",
      "Blocked or QC-held stock must not ship.",
      "Packing box color label comes from the packing master color field.",
      "The challan and inventory movement use the same India business date, frozen when the shipment is sealed.",
    ],
    primaryActions: [
      "Create dispatch from ready FG.",
      "Print dispatch document for shipment.",
      "Review dispatch history for customer follow-up.",
    ],
    controlChecks: [
      "Confirm customer, quantity, and lot before posting.",
      "Verify available FG balance after partial dispatch.",
      "Check transport details before final print.",
    ],
    outputs: ["Dispatch document", "FG stock out", "Customer shipment trail"],
    relatedRoutes: ["/sales-orders", "/quality", "/reports/sales", "/inventory/genealogy"],
  },
  {
    id: "stock-lifecycle",
    route: "/inventory/lifecycle",
    title: "Stock Lifecycle and Ledger Guide",
    eyebrow: "Month-end discipline",
    summary: "Manage opening stock, daily movement, certification, carry-forward, reconciliation, and lock without breaking the stock audit trail.",
    flowTitle: "Ledger close flow",
    steps: [
      { label: "Opening setup", detail: "Enter first-time balances once, with valuation and batch references." },
      { label: "Daily movement", detail: "Inward, issue, WIP, FG, dispatch, and adjustment feed the ledger." },
      { label: "Certify", detail: "Review physical and system balances." },
      { label: "Lock", detail: "Carry forward approved balances and freeze closed period edits." },
    ],
    fieldRules: [
      "Opening stock requires owner/admin control.",
      "Ledger lock should happen after reconciliation and variance review.",
      "Adjustments require a reason, date, and approver trail.",
    ],
    primaryActions: [
      "Use lifecycle hub before and after month close.",
      "Review consumption variance before locking.",
      "Carry forward only approved balances.",
    ],
    controlChecks: [
      "No negative stock after close.",
      "No unreviewed WIP remains hidden.",
      "Variance exceptions have explanation or correction.",
    ],
    outputs: ["Locked ledger", "Carry-forward stock", "Close audit evidence"],
    relatedRoutes: ["/inventory", "/reports/inventory", "/reports/production", "/system/audit"],
  },
  {
    id: "genealogy",
    route: "/inventory/genealogy",
    title: "Genealogy and Trace Guide",
    eyebrow: "Batch lineage",
    summary: "Trace material from vendor inward through issue, WIP, production, QC, FG, and dispatch.",
    flowTitle: "Traceability flow",
    steps: [
      { label: "Start from batch", detail: "Search inward batch, reel, job card, or FG lot." },
      { label: "Follow movement", detail: "Review issue, stage completion, slit children, and WIP links." },
      { label: "Check QC", detail: "Read hold, pass, rework, and reject events." },
      { label: "Find shipment", detail: "Connect FG to customer dispatch if shipped." },
    ],
    fieldRules: [
      "Trace depends on posting movements through system screens.",
      "Manual adjustments should include enough reference to explain lineage.",
      "Use job card ID when tracing production consumption.",
    ],
    primaryActions: [
      "Search by job card or batch.",
      "Open related document from trace events.",
      "Use trace for customer complaint and internal audit.",
    ],
    controlChecks: [
      "Verify vendor and inward date for raw material complaints.",
      "Confirm QC decision before blaming production.",
      "Trace all child reels or lots for partial dispatch cases.",
    ],
    outputs: ["Batch history", "Customer complaint evidence", "Audit-ready lineage"],
    relatedRoutes: ["/inventory/raw-material-inward", "/inventory/production-issue", "/quality", "/logistics/dispatch"],
  },
  {
    id: "reports",
    route: "/reports",
    title: "Reports and Variance Guide",
    eyebrow: "Management review",
    summary: "Use reports to review production, inventory, sales, plants, exceptions, and consumption variance after real transactions are posted.",
    flowTitle: "Reporting loop",
    steps: [
      { label: "Select report", detail: "Open owner, production, inventory, sales, or plant reports." },
      { label: "Filter period", detail: "Use plant, date, and status filters to isolate the question." },
      { label: "Review exception", detail: "Trace abnormal stock, WIP, QC, or variance back to documents." },
      { label: "Act", detail: "Correct source workflow or approve the business decision." },
    ],
    fieldRules: [
      "Reports should not be used to edit data directly.",
      "Consumption variance depends on complete issue and output posting.",
      "Owner reports can read all plants; plant reports help compare execution.",
    ],
    primaryActions: [
      "Review owner pack daily.",
      "Review stock and variance before ledger lock.",
      "Open source documents from report exceptions where available.",
    ],
    controlChecks: [
      "Investigate negative or stale WIP.",
      "Review high variance before month close.",
      "Confirm dispatch and sales numbers reconcile.",
    ],
    outputs: ["Management pack", "Variance list", "Exception follow-up"],
    relatedRoutes: ["/reports/owner", "/reports/production", "/reports/inventory", "/inventory/lifecycle"],
  },
  {
    id: "masters",
    route: "/masters/papers",
    title: "Masters and Contact Directory Guide",
    eyebrow: "Clean reference data",
    summary: "Maintain identity data only in masters while batch price, stock, and transaction facts remain in inward and operating flows.",
    flowTitle: "Master data flow",
    steps: [
      { label: "Create party", detail: "Customer and vendor masters store name, code, tax, address, and contacts." },
      { label: "Create item", detail: "Material masters store item identity and dimensions, not prices." },
      { label: "Use in flow", detail: "Sales, inward, spec, and dispatch consume these clean records." },
      { label: "Directory", detail: "Contact tables feed the searchable contact directory." },
    ],
    fieldRules: [
      "No price column should exist in master tables.",
      "Parchment companies are separate from actual vendor master.",
      "Customer and vendor contact rows require contact name, number, and email when available.",
    ],
    primaryActions: [
      "Create customer or vendor before transaction entry.",
      "Update contacts from the party master.",
      "Remove parchment company only when no sub parchment exists under it.",
    ],
    controlChecks: [
      "Check duplicate customer and vendor codes.",
      "Confirm GST, PAN, and address fields before billing or dispatch.",
      "Keep vendor master separate from parchment company list.",
    ],
    outputs: ["Clean master record", "Contact directory", "Selectable transaction data"],
    relatedRoutes: ["/masters/customers", "/masters/vendors", "/masters/parchments", "/sales-orders/new", "/inventory/raw-material-inward"],
  },
  {
    id: "system",
    route: "/system/users",
    title: "System, Users, and Audit Guide",
    eyebrow: "Governance",
    summary: "Control user access, role separation, plant setup, machine setup, tolerance settings, and audit visibility from system screens.",
    flowTitle: "Governance flow",
    steps: [
      { label: "Set users", detail: "Create users with role and plant access matching real responsibility." },
      { label: "Set machines", detail: "Maintain machine and capacity settings for planner accuracy." },
      { label: "Set tolerances", detail: "Maintain per-plant variance bands used by reconciliation and close." },
      { label: "Review audit", detail: "Use audit log to answer who changed what and when." },
    ],
    fieldRules: [
      "Only owner/admin should manage users and system setup.",
      "Machine capacity changes should be tested in planner before client use.",
      "Tolerance changes should be reviewed before month close because they affect variance gates.",
      "Audit trail should be reviewed after sensitive changes.",
    ],
    primaryActions: [
      "Manage users and roles.",
      "Open tolerance editor for plant variance bands.",
      "Review audit events.",
      "Maintain machine and plant setup.",
    ],
    controlChecks: [
      "Verify two admin accounts remain usable.",
      "Do not expose credentials on the public login page.",
      "Confirm role guards block restricted reports.",
    ],
    outputs: ["User access", "Machine setup", "Tolerance policy", "Audit evidence"],
    relatedRoutes: ["/system/tolerances", "/system/audit", "/planning/board", "/reports/owner", "/dashboard"],
  },
  {
    id: "mrp",
    route: "/analytics/mrp",
    title: "MRP and Shortage Guide",
    eyebrow: "Material planning",
    summary: "Convert released demand and current stock into shortage visibility before purchasing or urgent scheduling.",
    flowTitle: "MRP signal flow",
    steps: [
      { label: "Read demand", detail: "Sales releases and planner jobs create material requirement." },
      { label: "Read stock", detail: "Available and WIP balances reduce net shortage." },
      { label: "Draft buy", detail: "Shortage items become purchase work." },
      { label: "Receive", detail: "Inward closes the shortage only when posted." },
    ],
    fieldRules: [
      "MRP is only as accurate as current stock and open job cards.",
      "Vendor is selected during purchase and inward, not in parchment company masters.",
      "Shortage should be reviewed before promising urgent due dates.",
    ],
    primaryActions: [
      "Open shortage list before purchase.",
      "Compare shortage against current production queue.",
      "Move confirmed buys into inward once received.",
    ],
    controlChecks: [
      "Check stale WIP before buying extra material.",
      "Review alternate stock before creating urgent purchase.",
      "Validate rate on inward after purchase.",
    ],
    outputs: ["Shortage signal", "Purchase action", "Material availability"],
    relatedRoutes: ["/purchase", "/inventory/raw-material-inward", "/planning/board", "/reports/inventory"],
  },
  {
    id: "manual-fg",
    route: "/inventory/fg-inward",
    title: "Manual FG Inward Guide",
    eyebrow: "Controlled exception",
    summary: "Use manual FG inward only for approved rework, returns, migration, or correction cases outside the normal job-close flow.",
    flowTitle: "Manual FG control flow",
    steps: [
      { label: "Pick reason", detail: "Choose why FG is being entered manually." },
      { label: "Link context", detail: "Reference job card, customer return, or approval note where possible." },
      { label: "QC check", detail: "Hold or inspect stock before unrestricted dispatch." },
      { label: "Post FG", detail: "FG balance updates with audit evidence." },
    ],
    fieldRules: [
      "Normal production should create FG from job close, not manual inward.",
      "Manual FG requires a clear reason.",
      "QC status should be visible before dispatch.",
    ],
    primaryActions: [
      "Record approved exception stock.",
      "Attach useful notes for audit.",
      "Review genealogy after manual FG posting.",
    ],
    controlChecks: [
      "Confirm quantity and item match approval.",
      "Avoid duplicate FG if job close already posted.",
      "Review manual entries during stock reconciliation.",
    ],
    outputs: ["Exception FG balance", "Audit reason", "QC-aware dispatch stock"],
    relatedRoutes: ["/inventory", "/quality", "/logistics/dispatch", "/inventory/lifecycle"],
  },

  {
    id: "appearance",
    route: "/help/appearance",
    title: "Workspace and Appearance Guide",
    eyebrow: "Find the right page, choose your plant and make the workspace comfortable on your device",
    summary: "Find the right page, choose your plant and make the workspace comfortable on your device.",
    flowTitle: "Working sequence",
    steps: [
      {
        label: "Choose a workspace",
        detail: "Open a named group in the left navigation. The active module shows its detailed pages underneath. On a phone, open the menu button; Escape or Close returns focus to it."
      },
      {
        label: "Find a task",
        detail: "Use Jump to workspace or Command/Ctrl + K. Search for a workflow, then press Enter or move into the results with Arrow Down. The search opens pages; it does not create or submit records."
      },
      {
        label: "Set appearance",
        detail: "Open Appearance settings in the top bar. Choose Light, Dark or System. System follows your device preference. Density changes table spacing on supported pages."
      },
      {
        label: "Keep your context",
        detail: "Use the plant and role selectors deliberately. Collapse the sidebar when you need more calendar space. Hovering over it does not move the work area."
      }
    ],
    fieldRules: [
      "Preferences are stored on this browser and device, separately from your login.",
      "All plants is a read scope; select one plant before entering purchases or receipts.",
      "Dense calendars and wide tables scroll inside their own panels. Reduced-motion system preferences suppress transitions."
    ],
    primaryActions: [
      "Open the book icon for help about the current page.",
      "Share the purchase-register URL to retain search, status and page size.",
      "Use keyboard Tab and visible focus to move between actions."
    ],
    controlChecks: [
      "Check the current plant before each transaction.",
      "Unavailable data is not a zero balance or an all-clear.",
      "Theme and density do not alter business permissions or records."
    ],
    outputs: [
      "Device appearance preference",
      "Named workspace navigation"
    ],
    relatedRoutes: [
      "/dashboard",
      "/purchase",
      "/help"
    ]
  },
  {
    id: "customer-calendar",
    route: "/sales-orders/pending",
    title: "Customer PO Calendar Guide",
    eyebrow: "Review pending customer commitments and schedule every line of a PO without losing existing releases",
    summary: "Review pending customer commitments and schedule every line of a PO without losing existing releases.",
    flowTitle: "Working sequence",
    steps: [
      {
        label: "Find the PO",
        detail: "Use Pending Orders to review in-scope demand and the earliest commitment. Open the saved customer order to work on its calendar."
      },
      {
        label: "Plan the lines",
        detail: "Use the whole-order calendar to place quantity and date splits for each line. Keep the line unit visible; one line cannot borrow another line’s unfulfilled quantity."
      },
      {
        label: "Review changes",
        detail: "Preview before saving. Read the dates, quantities and any locked or already-started work. A group date shift previews affected commitments and the work that stays fixed."
      },
      {
        label: "Commit and release",
        detail: "Save the reviewed version. If another user changed the order, reload and review again. Release only the intended quantity to the selected winder queue, then follow job cards and production. The selected winder is a hint and can be changed by the planner; capability mismatches are warnings."
      }
    ],
    fieldRules: [
      "Scheduled demand and released jobs are related records, not interchangeable quantities.",
      "Partial releases remain allocated when other dates are rescheduled.",
      "Started or locked work is not silently shifted by a group move.",
      "Calendar placement is not proof of available machine capacity or QC clearance."
    ],
    primaryActions: [
      "Open all lines of the saved order in the calendar.",
      "Preview a date or quantity change.",
      "Use the tracker to inspect released jobs and the dispatch desk for completed stock."
    ],
    controlChecks: [
      "Compare scheduled totals with the remaining line quantity.",
      "Read conflicts instead of overwriting a newer version.",
      "Verify the order’s actual production and quality records before promising dispatch."
    ],
    outputs: [
      "Saved customer commitments",
      "Versioned calendar changes",
      "Preserved release allocations"
    ],
    relatedRoutes: [
      "/sales-orders",
      "/planning/board",
      "/planning/tracker",
      "/logistics/dispatch"
    ]
  },
  {
    id: "supplier-promises",
    route: "/purchase/supplier-deliveries",
    title: "Supplier Delivery Schedule Guide",
    eyebrow: "Track vendor promises, confirmed arrivals and partial receipt allocation against approved PO lines",
    summary: "Track vendor promises, confirmed arrivals and partial receipt allocation against approved PO lines.",
    flowTitle: "Working sequence",
    steps: [
      {
        label: "Select the order",
        detail: "Open the supplier delivery workspace for one plant and select the approved PO line."
      },
      {
        label: "Record the promise",
        detail: "Record the promised arrival date, quantity and confirmation state. Keep original promises available in the history when the vendor revises a date."
      },
      {
        label: "Review revisions",
        detail: "Provide a reason for date or quantity changes. Refresh before retrying a stale version. Cancel only eligible unreceived commitments."
      },
      {
        label: "Receive and reconcile",
        detail: "Post physical receipts through Goods inward. Receipt allocations drive received quantities; partial GRNs leave a visible open balance on the schedule."
      }
    ],
    fieldRules: [
      "Only confirmed future supply is counted on its arrival date in MRP.",
      "Tentative, undated or overdue arrivals are not treated as guaranteed usable future stock.",
      "Schedule received quantity comes from receipt allocations; do not enter it independently."
    ],
    primaryActions: [
      "Confirm an arrival.",
      "Revise a promise with a reason.",
      "Open the linked receipt or PO history."
    ],
    controlChecks: [
      "Avoid scheduling more than the open PO balance.",
      "Keep late supply distinct from stock already on hand.",
      "Do not clear commercial or QC holds through a delivery promise."
    ],
    outputs: [
      "Canonical supply calendar",
      "Original promise history",
      "Partial receipt balances"
    ],
    relatedRoutes: [
      "/purchase",
      "/purchase/inward",
      "/purchase/scheduler"
    ]
  },
  {
    id: "reconciliation",
    route: "/production/reconciliation",
    title: "Monthly Reconciliation Guide",
    eyebrow: "Compare actual material consumption with the recorded production evidence before closing a period",
    summary: "Compare actual material consumption with the recorded production evidence before closing a period.",
    flowTitle: "Working sequence",
    steps: [
      {
        label: "Review the month",
        detail: "Select the plant and month on Monthly close. Review open issues and the period state before entering corrections."
      },
      {
        label: "Enter actuals",
        detail: "Open Actual entry from the sidebar under Reconciliation. Review material rows, enter supported actual quantities and costs, and explain differences."
      },
      {
        label: "Investigate drift",
        detail: "Open Weekly drift for the selected week. Use the source records to understand the variance instead of adjusting a number simply to eliminate it."
      },
      {
        label: "Close and review",
        detail: "Complete the established close checks using the authorized role. Use Close history to inspect earlier decisions; a closed period cannot be bypassed by changing the page."
      }
    ],
    fieldRules: [
      "Monthly close, Actual entry, Weekly drift and Close history are separate pages with their own URLs.",
      "Actual consumption and theoretical recipe consumption remain separate measures.",
      "Locked books constrain historical stock mutations."
    ],
    primaryActions: [
      "Open material actuals.",
      "Record a reason and submit eligible corrections.",
      "Review close history and lock posture."
    ],
    controlChecks: [
      "Do not change a historical rate to hide a variance.",
      "Resolve outstanding exceptions before requesting close.",
      "Confirm the plant and period on each entry."
    ],
    outputs: [
      "Actual consumption evidence",
      "Variance explanation",
      "Audited close history"
    ],
    relatedRoutes: [
      "/production/reconciliation/actuals",
      "/production/reconciliation/drift",
      "/production/reconciliation/history",
      "/inventory/lifecycle"
    ]
  }
,

]

const routeGuideMap: Array<{ pattern: RegExp; guideId: string }> = [
  { pattern: /^\/help\/appearance(?:\/.*)?$/, guideId: "appearance" },
  { pattern: /^\/sales-orders\/pending(?:\/.*)?$/, guideId: "customer-calendar" },
  { pattern: /^\/purchase\/supplier-deliveries(?:\/.*)?$/, guideId: "supplier-promises" },
  { pattern: /^\/dashboard(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/control-tower(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/landing(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/help(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/sales-orders(?:\/.*)?$/, guideId: "sales" },
  { pattern: /^\/(?:specs|specifications)(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/purchase\/scheduler(?:\/.*)?$/, guideId: "purchase-scheduler" },
  { pattern: /^\/purchase\/(?:inward|receipts)(?:\/.*)?$/, guideId: "purchase-inward" },
  { pattern: /^\/purchase\/(?:discrepancies|debit-notes)(?:\/.*)?$/, guideId: "purchase-commercial" },
  { pattern: /^\/purchase(?:\/.*)?$/, guideId: "purchase" },
  { pattern: /^\/analytics\/mrp(?:\/.*)?$/, guideId: "mrp" },
  { pattern: /^\/analytics(?:-|\/|$)/, guideId: "reports" },
  { pattern: /^\/inventory-rm-inward(?:\/.*)?$/, guideId: "raw-inward" },
  { pattern: /^\/inventory-reels-issue(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory-reel-trace(?:\/.*)?$/, guideId: "genealogy" },
  { pattern: /^\/inventory-valuation(?:\/.*)?$/, guideId: "inventory" },
  { pattern: /^\/inventory\/(?:raw-material-inward|reels\/inward)(?:\/.*)?$/, guideId: "purchase-inward" },
  { pattern: /^\/inventory\/stock-alert(?:-policies|s)(?:\/.*)?$/, guideId: "stock-alerts" },
  { pattern: /^\/inventory\/rm-costing(?:\/.*)?$/, guideId: "rm-costing" },
  { pattern: /^\/inventory\/reels\/issue(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory\/production-issue(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory\/lifecycle(?:\/.*)?$/, guideId: "stock-lifecycle" },
  { pattern: /^\/inventory\/ledger(?:\/.*)?$/, guideId: "stock-lifecycle" },
  { pattern: /^\/inventory\/stock-control(?:\/.*)?$/, guideId: "stock-lifecycle" },
  { pattern: /^\/inventory\/genealogy(?:\/.*)?$/, guideId: "genealogy" },
  { pattern: /^\/inventory\/fg-inward(?:\/.*)?$/, guideId: "manual-fg" },
  { pattern: /^\/inventory(?:\/.*)?$/, guideId: "inventory" },
  { pattern: /^\/(?:planning\/board|planning|production\/planner)(?:\/.*)?$/, guideId: "planning" },
  { pattern: /^\/job-cards(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/job-cards(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/entry(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/eod-entry(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/supervisor-entry(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/operations(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/reconciliation(?:\/.*)?$/, guideId: "reconciliation" },
  { pattern: /^\/quality(?:\/.*)?$/, guideId: "quality" },
  { pattern: /^\/(?:dispatch|logistics\/dispatch)(?:\/.*)?$/, guideId: "dispatch" },
  { pattern: /^\/reports(?:\/.*)?$/, guideId: "reports" },
  { pattern: /^\/masters?(?:\/.*)?$/, guideId: "masters" },
  { pattern: /^\/system(?:\/.*)?$/, guideId: "system" },
]

export function getAllGuides() {
  return guides
}

export function getGuideById(id: string) {
  return guides.find((guide) => guide.id === id) || guides[0]
}

export function getGuideForRoute(route: string | null | undefined) {
  const normalizedPath = normalizeRoute(route)
  const matched = routeGuideMap.find((entry) => entry.pattern.test(normalizedPath))
  return getGuideById(matched?.guideId || "dashboard")
}

export function normalizeRoute(route: string | null | undefined) {
  const raw = String(route || "/dashboard").trim() || "/dashboard"
  try {
    const parsed = raw.startsWith("http") ? new URL(raw).pathname : raw.split("?")[0]
    return parsed.startsWith("/") ? parsed : `/${parsed}`
  } catch {
    return raw.startsWith("/") ? raw.split("?")[0] : `/${raw.split("?")[0]}`
  }
}
