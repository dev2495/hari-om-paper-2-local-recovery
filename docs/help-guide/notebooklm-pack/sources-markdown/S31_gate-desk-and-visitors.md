HARI OM TUBEOS HELP GUIDE - Chapter 31: Gate desk and visitors
Section: Gate and documents. Accurate as of 8 November 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 31.

# Gate desk and visitors

> **What it is:** The watchman's phone desk at the plant gate: visitors in and out, photos of every bill or challan that comes in, and photos of the papers of every truck that goes out. Behind it: the Accounts **Bills inbox** for expense bills, the **Gate register** with CSV, and **System › Gates** for gates and their visitor QR posters.
> **Who uses it:** Watchman (the gate desk only), Plant Manager (plant head), Owner and Admin. Store links material bills to GRNs and goods-out photos to challans. The plant head, Owner and Admin file expense bills.
> **Where:** Sidebar > Gate > Gate desk (/gate), Bills inbox (/gate/bills), Gate register (/gate/history), Gates & QR posters (/system/gates). Visitors use the public check-in page from the QR poster (no login).

## At a glance
- **The watchman photographs; the office links.** At the gate nobody types bill numbers or picks challans. The watchman takes the photos, taps what kind of paper it is (and the vehicle number), and saves. **Store** links a material bill to its GRN on Goods inward (**At the gate**), and links a goods-out entry to its challan(s) on the dispatch register (**Gone out at the gate**). Expense bills are filed in the **Bills inbox**.
- **Visitors check themselves in** by scanning the QR poster at the gate with their own phone. They get a pass with a **V-** number and a QR. The watchman checks the ID and taps **Let in** or **Deny** (with a reason). The person they came to meet is told and can reply **Send in**, **Ask to wait** or **Not available**. The host does not have to approve first.
- **Every gate paper gets a GE- number** (for example GE-2611-020) and every visit a **V-** number (V-2611-014). Photos are kept in the Doc Vault and never deleted.
- **A truck is never held for an upload.** Photos taken with a weak network wait on the phone and upload by themselves. The desk shows what is still to upload.
- **Privacy:** visitor phone numbers and photos are seen only by the watchman, the plant head, the Owner and the Admin. Visitor photos are wiped after the plant's retention period (365 days unless the Owner changes it); the visit log stays.

## The flow

Flow diagram: A visitor at the gate
Steps: 1. Scan the QR poster (done by Visitor) - own phone, no login -> 2. Fill the form, get a pass - V-2611-014 -> 3. Show the pass (done by Visitor) -> 4. Check ID, Let in (done by Watchman) -> 5. Host is told (done by Host) - Send in / Ask to wait / Not available -> 6. Visitor leaves, scan the pass or tap Out (done by Watchman)
If it goes wrong after 'Show the pass': 1. Deny with a reason (done by Watchman) - pass shows "Entry not allowed today"
If it goes wrong after 'Fill the form, get a pass (V-2611-014)': 1. No smartphone -> 2. + Visitor at the desk (done by Watchman) -> 3. Check ID, Let in (done by Watchman)



Flow diagram: A bill or challan coming in
Steps: 1. Truck arrives with a bill -> 2. Photograph every page (done by Watchman) -> 3. Tap the kind of bill, vehicle no. -> 4. Save - GE-2611-020 -> 5. Material: At the gate on Goods inward (done by Store) -> 6. Post the GRN (done by Store) - photos linked to GRN and every reel
If it goes wrong after 'Save (GE-2611-020)': 1. Electricity, maintenance, courier, other -> 2. Bills inbox (done by Plant head/Accounts) -> 3. Fill party, bill no., date, amount, cost head -> 4. Filed
If it goes wrong after 'Save (GE-2611-020)': 1. Wrong kind picked -> 2. Wrong type? Move it (done by Store/Plant head) - logged



Flow diagram: A truck going out
Steps: 1. Truck leaves -> 2. Photograph the Tally bill and our challan (done by Watchman) -> 3. Type the vehicle no., tap Gone out -> 4. Gone out at the gate on the dispatch register (done by Store/Dispatch) -> 5. Link the challan, type or confirm the Tally bill no. - s -> 6. Chip Out · Tally T-1189 ✓


The watchman's work ends when the photos are saved. Everything that needs a number from the paper (GRN, vendor, Tally bill no., amount) is filled in later by the office from the same photo.

## Screen tour

[Screenshot "m-gate-picker": Phone gate picker asking which gate you are at, with the Main gate button]
*Figure: The first screen of a shift on the watchman's phone: "Which gate are you at? This phone remembers it for your shift." with one button per gate, for example **Main gate** · G1 · In and out.*

What you see:

1. **Gate buttons**: name, code and what the gate is used for (**In and out**, **In only**, **Out only**). Tap yours. The phone remembers it; **Change gate** at the top of the desk picks another.
2. If the page says "Pick your plant at the top first", pick the plant. If it says "No gate is set up for this plant yet", the Owner or Admin must add one in System › Gates.

[Screenshot "m-gate-inside": Phone gate desk, Inside tab, with count tiles, one visitor waiting, two inside and vehicles with a bill today]
*Figure: The gate desk, **Inside** tab, on a phone. Tiles: Waiting 1, Inside 1, Bills today 8, Out today 5. **Scan a visitor pass** button. Waiting at gate: Anil Mehta, Mehta Engineering Works · Meeting, For Stores, waiting 0 min, V-2611-020, with **Let in** and **Deny**. Inside: Mahesh Shah in red with "After closing", "1 after closing time (19:00)" and "Host: Send in · 5:22 am", with **Out**. Below: Vehicles with a bill today, Material (stores) entries from Bharat Paper Mills, for example GE-2611-028 **Linked to GRN** (GRN P/26/031), each with its photo.*

What you see:

1. **Header**: "Gate desk", the gate name, a refresh button and **Change gate**. The desk refreshes by itself every 15 seconds.
2. **Count tiles**: **Waiting** (visitors at the gate), **Inside** (people inside; red when someone is inside after closing time), **Bills today**, **Out today** (trucks recorded going out). Tap a tile to open its tab.
3. **Tabs**: **Inside**, **Visitor**, **Bill in**, **Goods out**, **Today** (on a computer they read **Inside now**, **+ Visitor**, **+ Bill in**, **+ Goods out**, **Today**).
4. **Upload strip** (when photos are still sending): what is waiting on this phone. "You can keep working; they are kept on this device until sent."
5. **Scan a visitor pass**: opens the camera. A visitor who is inside is marked out; a visitor still waiting is shown so you can let them in or deny.
6. **Waiting at gate**: each visitor with name, company, purpose, whom they came to meet, how long they have waited, the V- number and mobile, and **Let in** / **Deny**.
7. **Inside**: each visitor with the time in and time inside, the host's reply (green **Send in**, amber **Ask to wait**, red **Not available**, or "Host told; no reply yet") and **Out**. "N after closing time (19:00)" and a red **After closing** chip mark people still inside after the gate close time.
8. **Vehicles with a bill today**: each bill entry with a vehicle number, its photos and its status. A card says "Photo uploading…" for a few minutes, "Photo saved · Stores and Accounts open it" when the photo is saved but this login may not open it, or "No photo".

[Screenshot "m-visit-checkin": Phone public check-in form with mobile, name, company, purpose chips and whom to meet]
*Figure: The visitor's own phone after scanning the poster: "Hari Om · visitor check-in", the gate name, "Welcome. Please tell us who you are." (with a Hindi line), then Mobile, Name, From (company), Purpose chips (Delivery, Interview, Meeting, Service / repair, Vendor visit, Other), Whom to meet (Stores chosen), People, Vehicle no., an optional Photo and **Check in**.*

What you see:

1. **Mobile** (10 digits, starting 6, 7, 8 or 9), **Name**, **From (company)** (optional).
2. **Purpose**: the codes of the list **Visit purpose** (VP-DELIVERY Delivery, VP-INTERVIEW Interview, VP-MEETING Meeting, VP-SERVICE Service / repair, VP-VENDOR Vendor visit, VP-OTHER Other, which needs a few words).
3. **Whom to meet**: type a name, or pick a department (Management, Plant head, Stores, Quality, Planning, Dispatch, Sales, Office / admin, Production floor; a department shows only when it has people).
4. **People** (1 to 50), **Vehicle no.** (optional) and **Photo** (optional).
5. A line at the bottom: the number and photo are seen only by the gate and the plant management and kept for one year at most.

[Screenshot "m-visit-pass": Phone visitor pass with Show this to the watchman, the V number and a QR code]
*Figure: The visitor's pass: "Show this to the watchman" (amber), Visitor pass · Main gate, **V-2611-014**, a large QR, and Name, From, To meet, Purpose, Arrived. A button "Add your photo (optional)". "This page updates by itself. Keep it open until you leave."*

What you see:

1. **Status box**: **Show this to the watchman** (waiting), **You are checked in**, **Visit over · thank you**, **Entry not allowed today** (with the reason) or **This pass has expired**. When the host replies, a line says, for example, "Stores: please come in".
2. **Pass number and QR**: the watchman scans this QR when the visitor leaves.
3. **Add your photo (optional)**: works only while the visitor waits at the gate, within 30 minutes of checking in.

[Screenshot "m-gate-visitor": Phone + Visitor form at the desk, filled for a delivery visitor, with Let in now ticked]
*Figure: The **Visitor** tab: "Visitor without a phone". The same fields as the public form (Mobile, Name, From, Purpose, Whom to meet, People, Vehicle no., Photo), a tick **Let in now (ID checked)** and the button **Check in and let in**.*

[Screenshot "m-gate-deny": Deny dialog on the phone with the reason list]
*Figure: **Deny** opens "Not letting Anil Mehta in": pick why from the list **Gate entry denied** (GD-NO-ID No ID shown, GD-HOST-NA Host not available, GD-NO-APPOINTMENT No appointment, GD-NOT-ALLOWED Not allowed in the plant, GD-SAFETY Safety rule not met, GD-OTHER with a note), then **Deny entry** or **Back**.*

[Screenshot "m-gate-bill-in": Phone Bill in tab with two pages photographed, Material chosen, vendor Bharat Paper Mills and vehicle number]
*Figure: The **Bill in** tab: "Bill or challan coming in. Photos only." Two pages photographed (Page 1, Page 2, **Add page**), **Add another bill**, "What kind of bill?" with **Material (stores)** chosen ("Goes to Stores for the GRN (Goods inward › At the gate)"), Vendor Bharat Paper Mills (optional), Vehicle no. GJ 01 AB 1234 (optional) and **Save · send to Stores**.*

What you see:

1. **Bill / challan** photo box: **Take photo** opens the camera; each photo is one page. **Add page** for the next page of the same bill. **Add another bill** when one truck brings two bills (each becomes its own document).
2. **What kind of bill?**: the list **Gate bill type**: **Material (stores)** (GB-MATERIAL), **Courier & post**, **Electricity**, **Maintenance & service**, **Other** (Other needs a few words, for example "water tanker"). The line under it says where it goes.
3. **Vendor** (optional): recent vendors as chips, or type a name and tap **Use "…"**.
4. **Vehicle no.** (optional on a bill in), and **Save · send to Stores** or **Save · send to Accounts**.

[Screenshot "m-gate-today": Phone Today tab with bills and goods and visitors of the day]
*Figure: The **Today** tab: Bills and goods (13): Goods out · GJ 06 TT 4410, GE-2611-030, **Linked to challan DC/26/V-104512**, with its two photos; Material (stores) · Bharat Paper Mills GE-2611-028 **Linked to GRN**; Goods out · GJ 05 VF 8462, GE-2611-027, **With Stores** "Stores links the challan"; each with its photo thumbnails.*

What you see:

1. **Bills and goods**: each entry of the day with its kind, GE- number, time, vehicle, GRN (when linked) and status chip: **With Stores** (a material bill waiting for its GRN, or a goods out waiting for Store to link the challan), **With Accounts**, **Linked to GRN**, **Linked to challan …**, **Filed**, **Void**. Tap a photo to open it.
2. **Visitors**: the visits of the day.
3. A watchman login sees only its own entries of the day (and the self check-ins at its gate). The plant head, Owner and Admin see everything.

[Screenshot "m-gate-goods-out": Phone Goods out tab, Truck going out, with Tally bill and Our challan photos and the vehicle number]
*Figure: The **Goods out** tab: "Truck going out. Photos only. A bill or challan with more pages, or two challans: tap Add page. Stores links this to the challan and adds the Tally bill no." Two photo boxes, **Tally bill** (1 page ✓) and **Our challan** (1 page ✓), each with **Add page**; **Vehicle no.** (required) GJ 06 TT 4410; the button **Gone out**; "The time is taken now. The truck is never held for the upload."*

What you see:

1. **Tally bill** and **Our challan** photo boxes (both required). **Add page** for more pages or a second challan.
2. **Vehicle no.** (required) and **Gone out**. The watchman does not pick the challan and does not type the Tally bill number.
3. Below the form, the trucks recorded today. A goods-out entry is **With Stores** until Store links it, then **Linked to challan …**.

[Screenshot "gate-bills": Bills inbox with three Electricity bills to file and the filing form with party, bill number, date, amount and cost head]
*Figure: **Bills inbox**: "Expense bills photographed at the gate. Fill in the bill and tap Filed. Nothing goes to stock or the ledger." Tabs **To file 3** and **Filed 0**, a search box (party, bill no., GE no., vehicle). Left: Electricity GE-2611-007, To file, "Party not filled yet". Right: Electricity · GE-2611-007 with Party, Bill number, Bill date, Amount ₹, Cost head, Note, **Filed**, "Wrong type? Move it", the history line, and the gate photo below with zoom, rotate and page buttons.*

[Screenshot "gate-history": Gate register with date, gate, type, status and search filters and a table of visitors, bills and goods out]
*Figure: **Gate register**: "Visitors, bills in and goods out at every gate of the plant." Filters From, To, Gate, Type (Everything, Visitors, Bills in, Goods out), Status, Search, and a **CSV** button. The table shows When, Type, No., Gate, Who / party, Detail, Vehicle, Reference, Status.*

[Screenshot "system-gates": System Gates page with Add a gate form and the Main gate card]
*Figure: **Gates**: "Each gate has a QR poster for visitors to check themselves in." **Add a gate** with Code (G1), Name (Main gate), Used for (In and out / In only / Out only) and **Add gate**. Below, one card per gate: name, code, **In use** or **Switched off**, when the QR last changed, and **QR poster**, the Used-for picker, **Switch off** / **Switch on** and **New QR**.*

[Screenshot "gate-poster": A4 gate poster with the gate name, Visitors scan to check in in English and Hindi, and a large QR]
*Figure: The A4 QR poster: gate code and name, "Visitors: scan to check in" and the Hindi line, a large QR, short steps in English and Hindi, and "No smartphone? Please speak to the watchman." **Print A4** prints it.*

## Step by step

### How to start a shift at the gate
Roles: Watchman (also Plant Manager, Owner, Admin).

1. Sign in on the gate phone. A watchman login opens the gate desk straight away; it cannot open any other page.
2. If asked, pick the plant at the top, then tap your gate. The phone remembers it until **Change gate**.
3. Keep the phone on the network. If photos are waiting to upload, the strip at the top says so.

### How to let a visitor in (self check-in)
1. The visitor scans the QR poster, fills the form and shows the pass. They appear under **Waiting at gate**.
2. Check their ID. Tap **Let in**. The message says "Anil Mehta let in. Stores has been told."
3. The host (the person, or everyone with the department's role) gets a notification "Visitor for you: …" with **Send in**, **Ask to wait** and **Not available**. Their reply shows on the visitor's card and on the visitor's pass.
4. If you cannot let them in, tap **Deny**, pick the reason and tap **Deny entry**. The pass shows "Entry not allowed today" with the reason.

### How to check in a visitor without a smartphone
1. Open **Visitor** (**+ Visitor**). Type the mobile, name and company, tap the purpose, pick whom to meet, set People and the vehicle number. Take a photo if useful.
2. Leave **Let in now (ID checked)** ticked and tap **Check in and let in**, or untick it and tap **Check in · waiting at gate**.
3. The visit gets its V- number; the host is told when the visitor is let in.

### How to mark a visitor out
1. Scan the QR on the visitor's pass with **Scan a visitor pass**, or tap **Out** on their card under **Inside**.
2. The message says "Mahesh Shah marked out." People still inside after the gate close time show **After closing** in red; mark them out when they leave.

### How to photograph a bill or challan coming in
1. Open **Bill in** (**+ Bill in**). Tap **Take photo** and photograph the first page. Tap **Add page** for every further page. If the truck brought a second bill, tap **Add another bill**.
2. Tap what kind of bill it is. Pick **Material (stores)** for anything for the store (paper, adhesive, packing, parts). Pick **Other** and write a few words if nothing fits.
3. Optional: pick or type the vendor, type the vehicle number.
4. Tap **Save · send to Stores** (material) or **Save · send to Accounts** (everything else). The message gives the GE- number: "GE-2611-020 saved · sent to Stores. 2 photos uploading; you can carry on."
5. Store gets "Material at the gate · GE-2611-020" with **Make GRN**. Expense bills go to the Bills inbox with **Open bill**.

### How to record a truck going out
1. Open **Goods out** (**+ Goods out**).
2. Photograph the **Tally bill** and **Our challan** (tap **Add page** for more pages or a second challan).
3. Type the **Vehicle no.** and tap **Gone out**. The time is taken at that moment. Do not wait for the upload; the truck can leave.
4. Store and Dispatch get "Goods out at the gate · GE-…". Store (or Dispatch, or the plant head) links the photos to the challan(s) on the dispatch register (**Gone out at the gate**, button **Link challan**) and types or confirms the Tally bill number. See the Dispatch chapter.

### How to file an expense bill (Bills inbox)
Roles: Plant Manager (plant head), Owner, Admin. (The page is also built for an Accounts role; TubeOS has no Accounts login set up today.)

1. Open **Gate › Bills inbox**. **To file** lists the expense bills, oldest first. Pick one; its gate photo is docked beside the form.
2. Read the photo and fill **Party**, **Bill number**, **Bill date** (not in the future) and **Amount ₹** (zero or more).
3. Pick the **Cost head** (list **Cost head**: CO-ADMIN Office & admin, CO-CIVIL Civil, CO-ELECTRICAL Electrical, CO-HOUSEKEEPING Housekeeping, CO-MECHANICAL Mechanical, CO-TRANSPORT Transport & courier, CO-UTILITIES Utilities, CO-OTHER with a note).
4. Tap **Filed**. "GE-2611-021 filed: … bill 77810, ₹48,620.00, Utilities." The bill moves to **Filed** and stays there with its photo (Doc Vault › Expense bills). A filed bill can still be corrected with **Save changes**.
5. Nothing goes to stock or the ledger. This is a register with the photo.

### How to move a bill that was put in the wrong kind
Roles: Store, GRN, Plant Manager, Owner, Admin (and Accounts).

1. In the Bills inbox, open **Wrong type? Move it**, pick the right type (and a note for Other) and tap **Move**. A material bill goes to Stores for the GRN.
2. The change is logged on the entry. A bill already linked to a GRN, or already filed, cannot change its kind.

### How to set up a gate and its QR poster
Roles: Owner, Admin (one plant selected).

1. Open **System › Gates** (or Gate › Gates & QR posters). Under **Add a gate**, type a short **Code** (G1) and a **Name** (Main gate), choose **Used for** and tap **Add gate**.
2. Tap **QR poster**, then **Print A4**, and put the poster up at the gate.
3. If the QR was copied or posted somewhere it should not be, tap **New QR** and **Make a new QR**. The old printed QR stops working at once: print and put up the new poster straight away.
4. **Switch off** a gate that is not used. Its QR does not work until it is switched on.
5. The gate close time and how long visitor photos are kept are set by the Owner in **System › Plants** (Gate box). See System, roles and audit.
6. Create a **Watchman** login per gate person in **System › Users** (role Watchman, plant = their plant).

### How to read the gate register and export it
Roles: Plant Manager, Owner, Admin.

1. Open **Gate › Gate register**. It opens on the last 7 days.
2. Narrow by **From**, **To**, **Gate**, **Type** and **Status** (pick a type first), or search a name, phone, vehicle, bill or challan.
3. Tap **CSV** for the same rows in a file. The page shows the newest 5,000 rows; narrow the dates for older ones.

## Rules the system enforces
- **BLOCKS:** a watchman login opens only the gate desk; the server refuses every other page. A watchman sees only the entries they made today.
- **BLOCKS:** a bill in needs at least one photo and a kind; **Other** needs a few words. A bill cannot be saved on an **Out only** gate.
- **BLOCKS:** goods out needs the Tally bill photo, the challan photo and the vehicle number.
- **BLOCKS:** a visitor needs a 10-digit Indian mobile, a name of at least 2 letters, a purpose (Other needs a note) and whom to meet. People 1 to 50. One mobile number can have at most 3 open visits; the 4th self check-in is refused ("Please speak to the watchman at the gate").
- **BLOCKS:** only a visitor waiting at the gate can be let in or denied; only a visitor inside can be marked out. Deny needs a **Gate entry denied** reason.
- **BLOCKS:** only the host (the person, their department, the plant head, Owner or Admin) can reply to a visitor notification.
- **BLOCKS:** a switched-off gate, or an old QR after **New QR**, does not open the check-in form ("This gate QR is not in use any more. Ask the watchman to check you in."). Too many tries from one phone: "Too many tries. Wait a minute and try again."
- **BLOCKS:** the public check-in page never fills in a known visitor's details from their number.
- **BLOCKS:** filing an expense bill needs party, bill number, bill date (not in the future), amount (zero or more) and a cost head.
- **AUTOMATIC:** gate entries are numbered **GE-YYMM-NNN** and visits **V-YYMM-NNN**, per plant and month (India time).
- **AUTOMATIC:** a material bill goes to Stores (**With Stores**), every other kind to the Bills inbox (**With Accounts**). A goods out is **With Stores** until Store links it to its challan(s) (**Linked to challan**); Store and Dispatch are notified. Posting a GRN with the gate entry links its photos to the GRN and to every reel and lot (**Linked to GRN**).
- **AUTOMATIC (every 5 minutes):** a material bill with no GRN after 24 hours sends one reminder to Store, GRN and the plant head. A visitor still waiting after 12 hours becomes **Did not come in**. After the gate close time, the Owner gets one list a day of visitors still inside, Dispatch and Store get one list of challans sealed today that have not gone out of the gate, and Store and the plant head get one list of goods-out photos still not linked to a challan. Visitor photos older than the retention period are blanked and voided (the visit log stays).
- **WARNS:** a visitor inside after the gate close time (default 19:00) turns red with **After closing**.
- **NEVER BLOCKS:** the truck is never held for photos. Photos taken offline wait on that phone; the desk says which ones are still to upload.

**Statuses.** Gate entry: **With Stores**, **With Accounts**, **Linked to GRN**, **Linked to challan**, **Filed**, **Void** (and **At the gate**; goods out recorded before 8 Nov 2026 show **Gone out**). Visit: **Waiting at gate**, **Inside**, **Left**, **Denied**, **Did not come in**.

## Sample
Saturday, Main gate, watchman Ramesh.

- 11:43 Bharat Paper Mills' truck GJ 01 AB 1234 brings invoice BPM/2241 (2 pages). Ramesh takes 2 photos, taps **Material (stores)**, picks the vendor and saves: **GE-2611-020 · sent to Stores**. Store gets "Material at the gate". At 14:10 Store picks it under **At the gate** on Goods inward and posts GRN P/26/031; the entry becomes **Linked to GRN** and the bill photo is on the GRN and on each of the 8 reels.
- 11:44 the electricity bill arrives by hand. One photo, **Electricity**, saved as **GE-2611-021 · sent to Accounts**. On Monday the plant head files it: party "Electricity board", bill 77810 3346, 8 Nov 2026, ₹48,620, cost head **CO-UTILITIES**.
- 11:44 Anil Mehta of Mehta Engineering Works scans the poster and gets pass **V-2611-014**, for Stores. Ramesh checks his ID and taps **Let in**. Store replies **Send in** from the notification. At 12:30 Ramesh scans the pass: **Out**.
- 16:20 our truck GJ 06 TT 4410 leaves with challan DC/26/V-1189 and Tally bill T-1189. Ramesh photographs both, types the vehicle number and taps **Gone out** (GE-2611-030). Store picks it under **Gone out at the gate**, ticks challan DC/26/V-1189, types T-1189 from the Tally bill photo and clicks **Link challan**; the dispatch register shows **Out · Tally T-1189 ✓** and the entry **Linked to challan**.

| Number | What | Status at day end |
|---|---|---|
| GE-2611-020 | Material bill, Bharat Paper Mills | Linked to GRN (P/26/031) |
| GE-2611-021 | Electricity bill | With Accounts (filed Monday) |
| V-2611-014 | Anil Mehta, Meeting, Stores | Out |
| GE-2611-030 | Goods out, GJ 06 TT 4410 | Linked to challan DC/26/V-1189 |

## Common questions
**Q: Do I have to type the bill number or the Tally bill number at the gate?** A: No. The watchman only takes photos, taps the kind and (for goods out) types the vehicle number. Store reads the numbers from the photo later.

**Q: The network is down. Can the truck go?** A: Yes. Save the entry; the photos stay on the phone and upload when the network is back. Keep the phone on and on the network. The desk shows what is still to upload.

**Q: The visitor has no smartphone.** A: Use **+ Visitor** and fill the form for them, then **Check in and let in**.

**Q: Must the host approve before I let the visitor in?** A: No. You let them in after checking the ID; the host is told and can reply Send in, Ask to wait or Not available.

**Q: I picked Electricity but it was a material bill.** A: Ask Store or the plant head to use **Wrong type? Move it** in the Bills inbox. The bill then goes to Stores for the GRN.

**Q: The card says "Photo saved · Stores and Accounts open it". Why can't I see it?** A: The same file was already in the vault, or it is a kind your login may not open. The photo is safe.

**Q: Why is a visitor shown in red?** A: They are still inside after the gate close time. Mark them out when they leave; the Owner gets a daily list.

**Q: Who sees the visitors' phone numbers?** A: Only the watchman, the plant head, the Owner and the Admin. Others see them masked (98xxxxxx22).

**Q: The QR poster was posted on social media.** A: The Owner or Admin taps **New QR** in System › Gates and prints the new poster. The old QR stops working at once.

**Q: Can a watchman open the Doc Vault or other pages?** A: No. A watchman login opens only the gate desk, and sees only the photos they took today.

## Related chapters
- Doc Vault
- Goods inward, GRN register and labels (At the gate)
- Dispatch (Gone out at the gate)
- Dashboard and Inbox (action buttons on notifications)
- System, roles and audit (gate settings, Watchman logins)
