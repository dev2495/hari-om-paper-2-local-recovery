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
      "Use Jump to workspace or Command/Ctrl + K to find a workflow by name. The sun/moon button switches light and dark in one click; Appearance settings has System (follow the device) and table density.",
      "Open the notification center for recent operational messages.",
      "Use the guide button in the header to understand the page you are on.",
    ],
    controlChecks: [
      "Check that pending approvals, QC holds, and dispatch queues are reviewed daily.",
      "Verify that books lock status is visible before editing historical stock.",
    ],
    outputs: ["Clean shift handoff", "Open exception list", "Confirmed plant scope"],
    relatedRoutes: ["/sales-orders", "/planning/board", "/inventory/stock-control", "/reports/owner"],
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
      { label: "Cancel or short close", detail: "Nothing released or dispatched yet: Cancel order withdraws the whole order. Work started: Short close drops the quantity not yet released; job cards already released finish and the order closes when they are dispatched. Both need a reason from Masters › Reason codes (Order cancel / short close); Other needs a note. Customer hold stays the reversible pause." },
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
      "Use the order's ⋯ menu or the order page to cancel or short close it with a reason code.",
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
    flowTitle: "Purchasing flow: requisition → PO → Owner approval → goods inward & GRN → incoming QC",
    steps: [
      { label: "Requisition", detail: "Tools, spares and other materials start as a requisition (Purchasing → Purchase requisitions). The Owner approves it from PO approvals or the inbox; an approved request becomes the PO with one click. Paper, adhesive, parchment and packing can be ordered directly." },
      { label: "Create draft", detail: "Select RM/PM or OT. The server reserves RP-PM/nn or OT/nn; users never type the PO number. Each line has only the material, ordered quantity and rate; quality is checked at inward against the material standard." },
      { label: "Submit revision", detail: "The complete vendor, lines, rates, specifications and dates become a review snapshot." },
      { label: "Approve", detail: "A different authorized user approves or rejects that exact revision." },
      { label: "Revise changes", detail: "Any later vendor, quantity, rate, specification or delivery change creates a new revision and needs approval again." },
      { label: "Receive & QC", detail: "From the approved PO press Receive goods: the GRN opens with vendor and PO filled. Every reel/coil gets its AT label; the lot then waits in Incoming QC until it passes." },
    ],
    fieldRules: [
      "Paper ordered and fulfilled quantity is kg. The PO asks only for the ordered quantity: no expected reel count, tare weight or quality specification.",
      "An approved rate is immutable evidence and cannot be overwritten during inward.",
      "Batch price belongs to inward stock. Planning standard costs never overwrite PO rates, invoice rates or historical batch valuation.",
      "Draft edits require a reason and version check after the first approval.",
      "Net kg is the paper alone; stock, the PO balance and the invoice settle on it. Inward asks only for net kg.",
      "Notifications: the Owner is told when a requisition or PO is submitted; stores are told when a PO is approved.",
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
    relatedRoutes: ["/purchase/requisitions", "/purchase/new", "/purchase/approvals", "/purchase/inward", "/purchase/scheduler"],
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
      { label: "Record challan and invoice", detail: "Enter the supplier challan number (always required), then invoice number, date, quantity and rate, or mark invoice pending to save held physical stock. A challan number the same supplier already used shows a warning, not a block." },
      { label: "Weigh every lot", detail: "The grid opens with 10 empty rows (Add 10 more for big loads). Enter or paste vendor reel number, net kg and measured width for every physical reel or coil; empty rows are left out." },
      { label: "Post once", detail: "The server rechecks the PO balance and creates one inward number (P/26/001 paper, A/26/001 adhesive, IN/26/001 everything else; restarting every financial year on 1 April), one stock identity and one label per physical unit." },
    ],
    fieldRules: [
      "Sum of individual net weights is the received quantity in kg. Add another material for mixed loads.",
      "Tab moves between lot fields. Enter advances through inputs; Enter at the last lot field appends a new row. Paste columns: vendor reel number, net kg, width mm, form.",
      "One reel or coil equals one lot, one AT number and one saved label; label reprints never create stock.",
      "Invoice-pending and any rate or quantity difference stay commercially held until an authorized decision.",
      "Measured width outside the approved PO width tolerance opens a separate specification case with lot-level evidence.",
      "Received quantity follows the PO line's open quantity (ordered − already received). Receiving more than that needs a written reason, kept on the GRN.",
    ],
    primaryActions: ["Preview controls before posting.", "Validate the entered receipt, review every result and use Post goods inward once. Changing a field invalidates the old preview and requires validation again.", "Prepare the saved AT label batch, then open the 4 × 2 inch PDF and print at actual size. Set copies and enter a reason for a reprint; reprinting never creates stock.", "Open Stores → GRN register and labels to attach invoices, pass or hold QC, approve manual receipts or reprint labels."],
    controlChecks: ["Verify total kg against the open PO line; give a reason if it is more.", "Verify each vendor reel number is unique for that supplier.", "Resolve QC and commercial holds independently."],
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
    title: "RM Inward Calendar Guide",
    eyebrow: "Plan RM arrivals; the Owner approves them",
    summary: "One calendar for paper, chemicals and packing: forward demand from orders and planned job cards against stock, QC-pending lots and dated arrivals, day by day. Arrivals the Owner approves become draft POs ready to send.",
    flowTitle: "Demand to arrival",
    steps: [
      { label: "Read the shortages", detail: "Each material row shows stock now, QC pending, days of cover and the next shortage date. A rose cell is the first day the projected balance goes below zero (or below the minimum stock, when a policy has one). Late demand shows on today." },
      { label: "Propose arrivals", detail: "Planner, Store or the plant head clicks a day and enters qty, vendor and a note, or presses Suggest arrivals: the day before each shortage, rounded up to MOQ, from the item's last vendor." },
      { label: "Owner approves", detail: "The Owner approves one arrival, a week or every visible one. Approval makes or extends a draft PO per vendor per week, tagged Scheduled by Owner, with dated delivery rows." },
      { label: "Send and receive", detail: "The purchase desk sends the draft (WhatsApp, email, PDF or print). If nothing changed since the Owner approved, no second approval is needed. Vendor confirms → arrival → GRN with location → incoming QC → stock." },
    ],
    fieldRules: [
      "Cover counts usable stock, QC-pending lots after a day, open PO delivery rows (remaining qty only) and Owner-approved arrivals not yet on a PO. Received quantity moves into stock and is never counted twice.",
      "A missing rate never stops a draft: the vendor's last PO rate is used, else the RM costing rate, else the line says rate needed.",
      "Floor problems in the demand are warnings, never blocks.",
    ],
    primaryActions: ["Pick 4, 8 or 12 weeks and the material class.", "Add or suggest arrivals.", "Owner: approve arrivals.", "Open the scheduled drafts in Purchase orders."],
    controlChecks: ["Changing qty, date, vendor or rate after approval sends the PO back for the Owner's approval.", "Moving an arrival on a PO already sent asks before changing the PO.", "Every chip and colour also carries a word."],
    outputs: ["Owner-approved arrivals", "Scheduled draft POs per vendor and week", "Dated delivery rows"],
    relatedRoutes: ["/purchase", "/purchase/supplier-deliveries", "/purchase/inward", "/inventory/stock-alert-policies"],
  },
  {
    id: "stock-alerts",
    route: "/inventory/stock-alert-policies",
    title: "Stock Alert Policy Guide",
    eyebrow: "Versioned stock thresholds",
    summary: "Define the single effective safety, reorder and target stock policy used by alerts and the RM inward calendar for each material and plant.",
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
    outputs: ["Effective policy version", "Deduplicated alert episode", "Calendar minimum stock and MOQ"],
    relatedRoutes: ["/inventory/stock-alerts", "/purchase/scheduler", "/purchase"],
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
    relatedRoutes: ["/purchase/scheduler", "/purchase/new", "/system/audit"],
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
      "Material issue is by the Amigo inward number printed on the label (GRN / AT number). Reels and coils go to the floor whole by AT number and are used in full; adhesive, parchment and packing are issued by quantity for a shift. Nothing returns from the floor.",
      "Inward is physical stock received against a PO and put in a location. The RM inward calendar is the plan: it compares forward demand with stock and arrivals to say what to buy and when. The calendar never moves stock.",
    ],
    primaryActions: [
      "Review inventory summary by material type.",
      "Use Stock counts & book for counts, corrections and the stock book.",
      "Open genealogy when a batch or finished product needs traceability.",
    ],
    controlChecks: [
      "Do not issue blocked or QC-held stock.",
      "Confirm vendor and price are present on inward batch.",
      "Reconcile stock before books lock.",
    ],
    outputs: ["Current stock", "Batch ledger", "Reconciliation basis"],
    relatedRoutes: ["/purchase/inward", "/inventory/production-issue", "/inventory/stock-control", "/inventory/genealogy"],
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
    title: "Issue to Floor Guide",
    eyebrow: "Store to floor, by shift",
    summary: "Material goes to the floor every day for a shift — never to a machine or a job card — and is consumed in full. The job card records what the floor made; the monthly stock count settles real consumption.",
    flowTitle: "Daily floor issue",
    steps: [
      { label: "Reel → slitter", detail: "Scan the AT label of a reel and issue it whole for the shift. It goes to the slitter." },
      { label: "Slitting card", detail: "When the reel is slit, write its slitting card: coils made and wastage kg (like a job card)." },
      { label: "Coil → winders", detail: "A bought coil goes straight to the production winders for the shift." },
      { label: "Other material", detail: "Adhesive and packing are issued by Amigo inward number and quantity for the shift. Parchment is issued by choosing the colour and the kg (no coil number); plastic in kg, boxes in pieces." },
    ],
    fieldRules: [
      "Only the shift and date are asked — no winder, machine or job card.",
      "A reel or coil goes out whole; what goes to the floor is consumed in full and nothing comes back to store.",
      "There is no direct link between material issued and a job card: the job card is the floor's truth, the issue is what left the store, and the stock count is the final truth for consumption.",
      "Older issues made to a machine (before floor issue) are closed once from the Older open issues list.",
    ],
    primaryActions: [
      "Issue reels and coils to the floor (Reel & coil issue).",
      "Write each reel's slitting card.",
      "Issue adhesive, parchment and packing to the floor (Material issue).",
      "Review the Slitting report for coils made and wastage %.",
    ],
    controlChecks: [
      "Only QC-cleared stock can be issued.",
      "Every reel sent to the slitter needs its slitting card; pending cards are listed on the issue page and in the report.",
      "Month-end close compares what was issued with the spec and with the month-end count.",
    ],
    outputs: ["Floor issue ledger (by shift)", "Slitting cards", "Slitting report", "Month-end close figures"],
    relatedRoutes: ["/inventory/reels/issue", "/reports/slitting", "/production/reconciliation", "/inventory/stock-control"],
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
      { label: "Find cards", detail: "The queue search looks in the card number, customer name and customer code, order and PO number, size, colour and product code. The Filters pop-up adds machine, due date, customer, colour, size, quantity range and card flags; active filters show as chips you can remove one by one, and the count reads \"12 of 40 cards\"." },
      { label: "Save a view", detail: "Set the filters and sort once, then save them as a view: for you only or for everyone in this plant, for this stage or all stages. Views sit as badges next to All, Due ≤3d and Overdue; one click applies one, and the last view used is remembered per stage. Rename, edit, reorder or delete views from the pop-up (another person's plant view is read-only)." },
      { label: "Move several", detail: "Tick the cards (shift-click selects a range, Select all takes the whole filter) and drag any ticked card onto a machine and shift or onto a calendar day. All of them go in queue order in one step; if one cannot be placed, nothing moves and the message says which card and why." },
      { label: "Open job", detail: "Open the existing released job card and confirm its saved schedule before execution." },
      { label: "Planning overview", detail: "Planning › Planning overview shows every planned slot of a period (Yesterday → +5 days, Today, Next 3 days, This week, custom) against what the floor logged for that card, stage, day and shift: Done in slot, Partly, Moved, Not run, Running now, Upcoming. Rows are machines grouped by stage, columns are days × Shift A/B; each slot block shows card, customer code, quantity and a made-vs-planned bar; split plans read part 1/2. Tap a slot for its runs and open the job card or the planner board from there." },
      { label: "Silent slots", detail: "A slot that passes with nothing logged shows 'Back to queue in N h' and goes back to the queue 36 h after its shift ends. Nothing blocks the floor; the job card log is the truth. A card's Oven opens for planning only once its Winding has a slot, and Process once Oven has one (queues show such cards as waiting)." },
      { label: "Print sheets", detail: "Print on the overview (or the planner's Print button) opens one A4 shop-floor sheet per stage: tick stages (or All stages), days, shifts and machines, or print only the slots you selected. Each sheet lists card, customer and code, size, colour, quantity in the stage unit and pieces, due date, a Made column and signature lines." },
    ],
    fieldRules: [
      "Winder capacity is measured in meters made per shift.",
      "The release winder is a hint. Any available winder in the selected plant can be planned; geometry and mandrel mismatches appear as setup warnings. Capacity, unavailable machines, plant permissions and QC holds remain enforced.",
      "Plant scope must be selected for write actions when role requires it.",
      "A card's Oven step opens for planning only once its Winding has a slot, and Process once Oven has one. Until then the card sits at the bottom of the queue with a lock and \"Waiting for the winding plan\"; it cannot be ticked or dragged. Hide or show these cards from the Filters pop-up.",
      "Split plan cuts one planned part into two time slots (first part in pcs, the rest goes to part 2); the card stays one card. Splitting into a new card is done from the job card page.",
    ],
    primaryActions: [
      "Open Planning overview, Winder, Oven, Process or Slitting from the sidebar. The Planning workspace selector changes stage while preserving the selected date and focused order. Saved board URLs remain supported.",
      "Use the stage workspaces for winder, oven, process or slitting; open dispatch from its separate workspace.",
      "Drag or release demand into the correct machine window.",
      "Use the quick badges or a saved view to narrow the queue; open Filters for the full set and to save a view.",
      "Tick several queue cards and drag one of them to place all of them together; over-capacity drops still ask first and show the total load.",
      "Open generated job card link before handing to production.",
    ],
    controlChecks: [
      "Capacity shown on cards should match machine settings.",
      "Review material availability before scheduling urgent orders.",
      "Do not ignore QC or stock holds while planning. There is no separate packing or final QC step: packing follows Process on the same line, and the two QC readings at Process are the final check before dispatch.",
    ],
    outputs: ["Shift schedule", "Machine queue", "Job card handoff", "Shop-floor planning sheets"],
    relatedRoutes: ["/planning/overview", "/planning/print", "/sales-orders", "/production/job-cards", "/production/entry", "/reports/planning", "/reports/production"],
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
      { label: "Plan status", detail: "The job card list shows where the plan stands for the current stage: planned (date · shift), running, plan in parts, slot passed, not planned or waiting for the previous stage's plan. It is information only: the floor can always log a run, and it is matched to the plan by date and shift." },
      { label: "Plan for this card", detail: "On the job card, the Plan panel lists each planner slot (a split plan has parts) with what was logged in it, runs on another day or shift, and stages still to be planned." },
    ],
    fieldRules: [
      "Split into a new card makes a separate job card (own number, lot, print, QC and dispatch). To run one card over more shifts, days or machines, use Split plan on the planner instead.",
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
    relatedRoutes: ["/inventory/production-issue", "/production/entry", "/quality", "/inventory/genealogy"],
  },
  {
    id: "quality",
    route: "/quality",
    title: "Quality Control Guide",
    eyebrow: "Incoming, in-process and returns",
    summary: "The QC desk shows what needs QC now: incoming lots to inspect, floor runs waiting for QC readings, readings flagged outside their band, inward holds that need a decision, and customer returns.",
    flowTitle: "QC flow",
    steps: [
      { label: "Incoming", detail: "Inspect each GRN lot on the checks listed for its material standard only (no certificate or sample fields). Reels of one inward line can be entered reel-wise in one table, each with its own pass / hold decision. Inside every band → released; any reading outside → flagged and held, and a held reel cannot be issued." },
      { label: "In-process", detail: "Operators log QC on the job card / floor entry page: each winding / oven / process run needs at least 2 readings per check (more may be added); the next stage takes a run once its QC is done. A reading outside its band is saved and flagged, never held. Quality › In-process QC lists every flagged reading stage by stage (Excel export) and the runs still waiting for readings." },
      { label: "Holds", detail: "Holds & inspections lists held inward lots (and any job-card hold made before floor readings were flagged instead of held) with the decision each needs." },
      { label: "Returns", detail: "Customer returns are held on arrival, decided by QC (rework, sort, accept, scrap) and followed to closure with root cause and corrective action." },
    ],
    fieldRules: [
      "Material standards: QC keeps the list of checks per material type (paper, parchment, adhesive, packing…) — add, rename or switch a check off. QC does not set bands.",
      "Bands are set in Masters: on each master row (QC band button) for one line, or for a group (paper variety, parchment company, parchment colour), or for all of a type in Masters › Inward QC tolerances. The most specific band wins; a check with no band is recorded only.",
      "Every band change is saved as a new version with who, when and why. Lots already received keep the band they arrived with.",
      "Process stage rules hold the seasonal winding, oven and process tolerances (both seasons preset). Saving creates a new version; job cards released after that use it, released cards keep theirs.",
      "A supervisor may let the next stage take a batch before its QC with a written reason; it is flagged on the batch.",
    ],
    primaryActions: [
      "Work the QC desk queues: Inspect incoming lots, Add QC on waiting batches.",
      "Decide held lots (re-inspect, concession or return to supplier).",
      "Record and follow customer returns.",
    ],
    controlChecks: [
      "Held stock cannot be issued or dispatched.",
      "Moisture checks are optional on stage QC; a missing reading is flagged, not blocking.",
      "Review failure trends in Quality analytics.",
    ],
    outputs: ["Released or held lots", "QC-accepted batches", "Return cases with corrective action"],
    relatedRoutes: ["/quality/incoming", "/quality/stage", "/quality/results", "/quality/returns", "/quality/material-standards", "/masters/inward-qc"],
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
      { label: "Verify QC", detail: "Confirm no active hold remains and the card closed Process with its two QC readings in. That is the final check; there is no separate final QC step." },
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
    id: "stock-counts",
    route: "/inventory/stock-control",
    title: "Stock Counts and Book Guide",
    eyebrow: "Count, correct, read the book",
    summary: "One Stock place: spot counts any time, the month-end count, corrections and the stock book. Anyone signed in may count; only the Owner approves, and approval changes the stock.",
    flowTitle: "Count to stock",
    steps: [
      { label: "Start a count", detail: "Spot count: pick racks or items, any day. Month-end count: one per plant per month, covering every location, the Unassigned bucket and items kept without labels." },
      { label: "Count racks", detail: "Scan the rack label, then each reel or lot. Bulk lots take a counted qty; loose stock without a label is added by item and qty. Rack done marks what was not found as missing." },
      { label: "Submit", detail: "Anyone may submit. Counting is then locked. The review labels stock issued or received during the count, so moving stock is not called missing." },
      { label: "Owner approves", detail: "Approval posts one correction with exact reels and lots, moves wrong-place lots, and for the month-end count becomes the month's stock certificate, dated on the month's last day." },
    ],
    fieldRules: [
      "Nothing returns from the floor: whatever is issued counts as used on its issue date.",
      "Stock found without a known lot is added on QC hold; incoming QC stays the only gate for issue.",
      "A reel the system says was issued but is found in store is never un-issued: the Owner leaves it as used or adds it as new stock on QC hold.",
      "Corrections outside a count are raised by Store, RM issue, GRN or the plant head with a reason, and posted only when the Owner approves.",
    ],
    primaryActions: ["Start a spot or month-end count.", "Raise a correction.", "Read the stock book for a month.", "Open Locations to print rack labels."],
    controlChecks: ["A closed month takes no stock movements; ask the Owner to re-open it.", "Totals are per unit: kilograms never include pieces.", "Opening loads are only for go-live (Owner or Admin)."],
    outputs: ["Approved count with every line logged", "Posted corrections", "Month's stock certificate", "Stock book per item"],
    relatedRoutes: ["/inventory/locations", "/production/reconciliation", "/inventory/ledger", "/inventory/reels/issue"],
  },
  {
    id: "locations",
    route: "/inventory/locations",
    title: "Locations and Rack Labels Guide",
    eyebrow: "Where stock sits",
    summary: "Every rack, bay or store area is a location with a printed QR. Goods inward puts stock in the RM store unless another rack is chosen; moves and counts work by scanning the rack, then the lots.",
    flowTitle: "Rack to stock",
    steps: [
      { label: "Set up racks", detail: "Store, the plant head, Owner or Admin create, rename or close locations. A location that holds stock cannot be removed." },
      { label: "Print labels", detail: "Pick racks and print the label sheet: big code, plain name and the QR. The phone camera opens the rack page." },
      { label: "Put away and move", detail: "Scan the rack, tap Move stock here and scan the lots. A held lot may move but stays held. Nothing moves to or from the floor." },
      { label: "Count a rack", detail: "Count this rack starts or joins a spot count for it." },
    ],
    fieldRules: [
      "Each plant has one receiving default, the RM store. A GRN line without a location goes there.",
      "Location never changes QC status.",
      "Stock with no location shows as Unassigned until it is put away.",
    ],
    primaryActions: ["Create or edit a location.", "Print rack labels.", "Put away unassigned stock.", "Open a rack to see what is on it."],
    controlChecks: ["A location of another plant or a closed location is refused at inward.", "Issue desks show Pick from <location> beside each lot."],
    outputs: ["Rack list with stock", "QR label sheet", "Move history"],
    relatedRoutes: ["/inventory/stock-control", "/purchase/inward", "/scan", "/inventory/production-issue"],
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
      { label: "Plan vs actual", detail: "Reports › Plan vs actual compares every floor run with its planned slot: same day, shift and machine, and card times inside the planned shift. It lists runs entered before planning and planned slots that passed with no entry." },
      { label: "Planning performance", detail: "Reports › Planning performance shows how well the plan held for a period: planned slots done in their own shift, card stages finished by their planned time, runs logged before planning, missed slots and average machine load, per day, stage, machine and shift, with the cards that finished late. Excel exports every table." },
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
    relatedRoutes: ["/reports/owner", "/reports/production", "/reports/planning", "/reports/plan-vs-actual", "/reports/inventory", "/production/reconciliation"],
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
      "Vendor details beyond code and name are optional. GSTIN (15 characters: state code + PAN + 3), PAN, IFSC and PIN are checked for format only when filled; a GSTIN fills PAN and state. GSTIN, PAN, state and contact print on the PO.",
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
    summary: "Control user access, role separation, plant setup, machine setup, background jobs and audit visibility from system screens.",
    flowTitle: "Governance flow",
    steps: [
      { label: "Set users", detail: "Create users with role and plant access matching real responsibility." },
      { label: "Set machines", detail: "Maintain machine and capacity settings for planner accuracy." },
      { label: "Watch background jobs", detail: "Check the daily owner pack and hourly checks ran; usage limits for month-end live under Month-end close." },
      { label: "Review audit", detail: "Use audit log to answer who changed what and when." },
    ],
    fieldRules: [
      "Only owner/admin should manage users and system setup.",
      "Machine capacity changes should be tested in planner before client use.",
      "Locations are managed in Stores; usage limits in Month-end close.",
      "Audit trail should be reviewed after sensitive changes.",
    ],
    primaryActions: [
      "Manage users and roles.",
      "Open Background jobs to check scheduled runs.",
      "Review audit events.",
      "Maintain machine and plant setup.",
    ],
    controlChecks: [
      "Verify two admin accounts remain usable.",
      "Do not expose credentials on the public login page.",
      "Confirm role guards block restricted reports.",
    ],
    outputs: ["User access", "Machine setup", "Job health", "Audit evidence"],
    relatedRoutes: ["/system/scheduler", "/system/audit", "/production/reconciliation/limits", "/inventory/locations", "/dashboard"],
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
    relatedRoutes: ["/inventory", "/quality", "/logistics/dispatch", "/inventory/stock-control"],
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
        detail: "The theme follows your device (System) until you change it. Click the sun/moon button in the top bar to switch between light and dark in one click. Open Appearance settings to choose Light, Dark or System again; density changes table spacing on supported pages. Job cards, spec print views and anything you print stay white paper."
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
      "/production/job-cards",
      "/logistics/dispatch"
    ]
  },
  {
    id: "supplier-promises",
    route: "/purchase/supplier-deliveries",
    title: "Expected Arrivals Guide",
    eyebrow: "What vendors should deliver, and when",
    summary: "Every open dated delivery row of an approved PO, grouped Overdue, Today, This week and Later, each with Make GRN prefilled for that PO line.",
    flowTitle: "Arrival to stock",
    steps: [
      { label: "Check today", detail: "Overdue and Today come first. Each row shows vendor, PO, item, qty still open and whether the vendor confirmed the date." },
      { label: "Confirm or move a date", detail: "When the vendor confirms, mark the row confirmed. A changed date needs a reason; the original promise stays in the history." },
      { label: "Make GRN", detail: "Opens Goods inward for that PO line. The GRN fills the oldest delivery rows first and puts the stock in a location (the RM store by default)." },
    ],
    fieldRules: [
      "Received quantity comes from GRNs; it is never typed here.",
      "Hand-made POs get delivery rows from each line's expected date, else the PO date.",
    ],
    primaryActions: ["Confirm an arrival.", "Change a date with a reason.", "Make the GRN."],
    controlChecks: ["Do not schedule more than the PO line still has open.", "A delivery promise never clears a QC hold."],
    outputs: ["Arrivals by day", "Promise history", "Partial receipt balances"],
    relatedRoutes: ["/purchase", "/purchase/inward", "/purchase/scheduler"],
  },
  {
    id: "month-end-close",
    route: "/production/reconciliation",
    title: "Month-end Close Guide",
    eyebrow: "Spec, issued and counted use, then close",
    summary: "For each material: what the spec allows, what the store issued to the floor and what the month-end count says was used. The Owner closes the month once the count is approved and every item outside its limit has a note.",
    flowTitle: "Close checklist",
    steps: [
      { label: "Month has ended", detail: "The running month shows only the floor gap so far. A month can be closed from the 1st of the next month (IST)." },
      { label: "Month-end count approved", detail: "Actual use = opening + received − sent back − closing, from the approved month-end count." },
      { label: "Notes on items outside the limit", detail: "Expected = spec + normal wastage. Floor gap = issued − expected; store gap = what the count found short or extra. Each OVER or UNDER item needs a note from the plant head or Owner." },
      { label: "Owner closes", detail: "Earlier months must be closed first. The figures are frozen, and floor and store entries dated in the month are refused. Re-open is Owner only, with a reason." },
    ],
    fieldRules: [
      "Every number is in the item's own unit; totals never add pieces into kilograms.",
      "Spec rows whose material has no stock item are listed separately with a link to fix the master or recipe.",
      "March closes the financial year; 1 April opens from the 31 March closing.",
    ],
    primaryActions: ["Pick the month (default: the oldest month not closed).", "Open an item's drawer to see the job cards, issues and count lines behind each number.", "Add a note.", "Close the month."],
    controlChecks: [
      "Nothing returns from the floor: issued is used.",
      "Changing usage limits never changes a closed month.",
      "Every close and re-open is kept in the history.",
      "Only closed months are locked. An earlier month left open still takes GRNs and issues; they move the later closed months' live figures (shown as \"Changed after close\") while the frozen figures stay. To count or close that earlier month, re-open the later months first.",
    ],
    outputs: ["Frozen month figures", "Notes per item", "Close history", "Financial year view"],
    relatedRoutes: ["/production/reconciliation/limits", "/inventory/stock-control", "/inventory/ledger", "/reports/owner"],
  },
  {
    id: "usage-limits",
    route: "/production/reconciliation/limits",
    title: "Usage Limits Guide",
    eyebrow: "How far use may differ from spec",
    summary: "Per plant and material type: normal wastage % added to the spec, the allowed gap % and a minimum gap in the item's unit so tiny quantities do not flag.",
    flowTitle: "Limit to status",
    steps: [
      { label: "Expected use", detail: "Spec × (1 + normal wastage % ÷ 100). Paper starts at 7%, everything else at 0%." },
      { label: "Allowed gap", detail: "The larger of allowed gap % of expected (7% to start) and the minimum gap: paper 5 kg, adhesive 0.5 kg, parchment 1 kg, packing 10 in its unit, other 5." },
      { label: "Status", detail: "OK inside the allowed gap; OVER or UNDER outside it; not known until the month-end count is approved." },
    ],
    fieldRules: ["Owner and Admin edit; everyone else reads.", "Changes apply to open months only; closed months keep the limits they closed with."],
    primaryActions: ["Pick the plant.", "Edit the three fields of a material type and read the example line."],
    controlChecks: ["These are not QC tolerances; QC bands live in Quality."],
    outputs: ["Usage limits per plant and material type"],
    relatedRoutes: ["/production/reconciliation", "/quality/material-standards"],
  },

  {
    id: "scan",
    route: "/scan",
    title: "QR Scan Guide",
    eyebrow: "One scan, the right page for your role",
    summary: "Every new job card and label QR is a link. The phone's own Camera app (iPhone too) opens it; after sign-in you land on the page your role works on for that card, lot or tool.",
    flowTitle: "What a scan opens",
    steps: [
      { label: "Job card", detail: "Opens the card's floor entry: Log output and Log QC." },
      { label: "Lot waiting for QC", detail: "QC, inward QC, store and the plant head land on incoming QC for that lot." },
      { label: "Cleared reel or coil", detail: "Store and raw-material issue staff land on Reel & coil issue with the reel already picked." },
      { label: "Cleared adhesive, parchment or packing lot", detail: "Store and raw-material issue staff land on Material issue with the lot already picked." },
      { label: "Everyone else", detail: "Sees the lot card: item, plant, status in words, quantity left, received date, inward number, last QC and the next step." },
    ],
    fieldRules: [
      "Signed out or idle for 15 minutes: sign in and the same page opens.",
      "A label from another plant switches to that plant when your login has it, and says so; otherwise the page tells you the plant your login cannot open.",
      "In-app scan boxes and handheld scanners read new links and older labels alike.",
      "Labels printed before this change still work inside the app; reprint them for the phone camera.",
    ],
    primaryActions: [
      "Point the phone camera at the QR and tap the link.",
      "If the label cannot be read, type the AT, lot or card number into the box on this page.",
    ],
    controlChecks: [
      "The issue desks still refuse lots that are not cleared by incoming QC.",
      "Each page keeps its own role check; a scan never opens a page your role cannot use.",
    ],
    outputs: ["The right page for the scanned card, lot or tool"],
    relatedRoutes: ["/production/entry", "/inventory/reels/issue", "/inventory/production-issue", "/quality/incoming"],
  },
]

const routeGuideMap: Array<{ pattern: RegExp; guideId: string }> = [
  { pattern: /^\/settings\/production-season(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/help\/appearance(?:\/.*)?$/, guideId: "appearance" },
  { pattern: /^\/sales-orders\/pending(?:\/.*)?$/, guideId: "customer-calendar" },
  { pattern: /^\/purchase\/supplier-deliveries(?:\/.*)?$/, guideId: "supplier-promises" },
  { pattern: /^\/production\/reconciliation\/limits(?:\/.*)?$/, guideId: "usage-limits" },
  { pattern: /^\/dashboard(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/control-tower(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/landing(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/help(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/scan(?:\/.*)?$/, guideId: "scan" },
  { pattern: /^\/sales-orders(?:\/.*)?$/, guideId: "sales" },
  { pattern: /^\/(?:specs|specifications)(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/purchase\/scheduler(?:\/.*)?$/, guideId: "purchase-scheduler" },
  { pattern: /^\/purchase\/(?:inward|receipts)(?:\/.*)?$/, guideId: "purchase-inward" },
  { pattern: /^\/purchase\/(?:discrepancies|debit-notes)(?:\/.*)?$/, guideId: "purchase-commercial" },
  { pattern: /^\/purchase(?:\/.*)?$/, guideId: "purchase" },
  { pattern: /^\/analytics\/mrp(?:\/.*)?$/, guideId: "purchase-scheduler" },
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
  { pattern: /^\/inventory\/lifecycle(?:\/.*)?$/, guideId: "stock-counts" },
  { pattern: /^\/inventory\/ledger(?:\/.*)?$/, guideId: "stock-counts" },
  { pattern: /^\/inventory\/stock-control(?:\/.*)?$/, guideId: "stock-counts" },
  { pattern: /^\/inventory\/counts(?:\/.*)?$/, guideId: "stock-counts" },
  { pattern: /^\/inventory\/locations(?:\/.*)?$/, guideId: "locations" },
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
  { pattern: /^\/production\/reconciliation(?:\/.*)?$/, guideId: "month-end-close" },
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
