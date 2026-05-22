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
      "Use search to jump to a flow by name.",
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
      { label: "Release", detail: "Released demand becomes planner-ready and gets assigned to a winder route." },
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
    summary: "Use purchase planning to turn shortage signals into vendor-facing procurement work, then receive material through inward batches.",
    flowTitle: "Shortage to inward flow",
    steps: [
      { label: "Read shortage", detail: "MRP and inventory show what material is required and when." },
      { label: "Pick vendor", detail: "Use the vendor master for actual suppliers; parchment companies stay separate." },
      { label: "Receive batch", detail: "Inward captures vendor, quantity, price, and batch details." },
      { label: "Use stock", detail: "Approved batches become available for issue and valuation." },
    ],
    fieldRules: [
      "Every inward transaction must tag an actual vendor.",
      "Batch price belongs to inward stock, not to the master record.",
      "Vendor master contacts feed the contact directory.",
    ],
    primaryActions: [
      "Open MRP before buying if the purchase is stock-driven.",
      "Create or update vendor details before inward.",
      "Use raw material inward to record batch-level price and quantity.",
    ],
    controlChecks: [
      "Match vendor invoice quantity with inward quantity.",
      "Confirm tax and contact details in vendor master when onboarding.",
      "Review purchase shortages before releasing urgent production orders.",
    ],
    outputs: ["Purchase requirement", "Vendor-tagged inward", "Batch valuation"],
    relatedRoutes: ["/analytics/mrp", "/inventory/raw-material-inward", "/masters/vendors", "/inventory"],
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
      { label: "Schedule", detail: "Assign order segments to machine and shift slots." },
      { label: "Create job", detail: "Scheduled work becomes job cards for execution." },
    ],
    fieldRules: [
      "Winder capacity is measured in meters made per shift.",
      "Planner should not schedule over available machine capacity.",
      "Plant scope must be selected for write actions when role requires it.",
    ],
    primaryActions: [
      "Use section controls to move between winder, cutting, and dispatch views.",
      "Drag or release demand into the correct machine window.",
      "Open generated job card link before handing to production.",
    ],
    controlChecks: [
      "Capacity shown on cards should match machine settings.",
      "Review material availability before scheduling urgent orders.",
      "Do not ignore QC or stock holds while planning.",
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
      { label: "Verify QC", detail: "Confirm no active hold remains." },
      { label: "Prepare shipment", detail: "Enter packing, challan, vehicle, and customer dispatch details." },
      { label: "Post dispatch", detail: "Stock moves out and reports update." },
    ],
    fieldRules: [
      "Dispatch should reference customer order and FG lot.",
      "Blocked or QC-held stock must not ship.",
      "Packing box color label comes from the packing master color field.",
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
    summary: "Control user access, role separation, plant setup, machine setup, and audit visibility from system screens.",
    flowTitle: "Governance flow",
    steps: [
      { label: "Set users", detail: "Create users with role and plant access matching real responsibility." },
      { label: "Set machines", detail: "Maintain machine and capacity settings for planner accuracy." },
      { label: "Review audit", detail: "Use audit log to answer who changed what and when." },
      { label: "Control close", detail: "Respect books lock and permission boundaries." },
    ],
    fieldRules: [
      "Only owner/admin should manage users and system setup.",
      "Machine capacity changes should be tested in planner before client use.",
      "Audit trail should be reviewed after sensitive changes.",
    ],
    primaryActions: [
      "Manage users and roles.",
      "Review audit events.",
      "Maintain machine and plant setup.",
    ],
    controlChecks: [
      "Verify two admin accounts remain usable.",
      "Do not expose credentials on the public login page.",
      "Confirm role guards block restricted reports.",
    ],
    outputs: ["User access", "Machine setup", "Audit evidence"],
    relatedRoutes: ["/system/audit", "/planning/board", "/reports/owner", "/dashboard"],
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
]

const routeGuideMap: Array<{ pattern: RegExp; guideId: string }> = [
  { pattern: /^\/dashboard(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/control-tower(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/landing(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/help(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/sales-orders(?:\/.*)?$/, guideId: "sales" },
  { pattern: /^\/(?:specs|specifications)(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/purchase(?:\/.*)?$/, guideId: "purchase" },
  { pattern: /^\/analytics\/mrp(?:\/.*)?$/, guideId: "mrp" },
  { pattern: /^\/analytics(?:-|\/|$)/, guideId: "reports" },
  { pattern: /^\/inventory-rm-inward(?:\/.*)?$/, guideId: "raw-inward" },
  { pattern: /^\/inventory-reels-issue(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory-reel-trace(?:\/.*)?$/, guideId: "genealogy" },
  { pattern: /^\/inventory-valuation(?:\/.*)?$/, guideId: "inventory" },
  { pattern: /^\/inventory\/raw-material-inward(?:\/.*)?$/, guideId: "raw-inward" },
  { pattern: /^\/inventory\/reels\/inward(?:\/.*)?$/, guideId: "raw-inward" },
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
  { pattern: /^\/production\/reconciliation(?:\/.*)?$/, guideId: "stock-lifecycle" },
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
