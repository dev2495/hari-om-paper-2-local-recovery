# What changed on 2 Nov 2026: operator scan, phone floor screens, possible duplicate customers

> **What it is:** an add-on to the help guide for three changes made on 2 Nov 2026: an operator who scans a job card sees only their own stage, the floor screens on a phone are easier to use, and customers with nearly the same name are flagged as a possible duplicate.
> **Who uses it:** Operators, Plant Managers (supervisors), QC and In-process QC, Planners, Sales, Owner and Admin.
> **Where:** Scan (/scan) and the job card floor page (/production/entry/ followed by the card), the **Log output** and **Log QC** forms, Masters > Customers (/masters/customers), Masters > Employees (/masters/employees), Sales orders > New order (/sales-orders/new)

## At a glance
- **An operator sees only their own stage.** When a login that has only the **Operator** role scans or opens a job card, and that login is linked to an employee in Masters > Employees, the card shows only the stage of that employee's department (Winding, Oven or Process). The operator is already picked as themselves in **Log output** and **Log QC**.
- **Everyone else keeps the full form.** Plant Manager (supervisor), Owner, Admin, Planner, QC, In-process QC and every other login see every stage, exactly as before. A login that has Operator plus any other role also sees every stage.
- **An operator who is not linked keeps the full form** with a small blue note: ask the Admin to link the login in Masters > Employees.
- **Phone screens:** the stage tabs (or the operator's single stage) and a **Scan** button stay pinned under the top bar; **Save** and **Cancel** stay pinned at the bottom of the forms; the first number to type is ready with the number keyboard; after saving, the next steps are one tap away (**Log QC for run …**, **Log another run**, **Scan another card**, **Back to card**).
- **Possible duplicate customers** are only flagged: a **Possible duplicate** badge in Masters > Customers, a **Duplicates** filter, a note on the customer's detail panel, and a hint on a new sales order. Nothing is merged and nothing is blocked; users decide.
- No rule changed. The server still decides who may log, which operators a stage lists (only active employees of the stage's department) and what a run or a QC reading must contain.

## The flow
```flow
title: Scanning a job card
Scan card QR [Anyone] -> Card opens -> Operator linked? (Operator-only login) -> Own stage only -> Log output / Log QC (picked as self)
after Card opens: Supervisor, QC, Owner, Admin, Planner -> Every stage -> Full forms as before
after Operator linked?: Not linked -> Every stage -> Blue note: ask the Admin
after Own stage only: Stage not open or closed -> One line why -> Scan another card
```
The link between a login and an employee is the login email written on the employee's row in Masters > Employees. The stage comes from that employee's **Dept**: WINDER is Winding, OVEN is Oven, PROCESS is Process (PACKING is the Packing stage on older cards that still pack on the floor).

```flow
title: Possible duplicate customer
Open Masters > Customers [Sales/Admin] -> Filter Duplicates: Possible duplicates -> Open the customer -> Read the note -> Same customer? -> Deactivate the extra one [Owner/Admin]
after Same customer?: Different units -> Nothing to do
```

## Screen tour
*Screens are described in words; the phone width is 390 pixels.*

### Operator: the card at their stage
*Figure (in words): the card number and customer at the top, then a dark green bar pinned under the top bar reading "Your stage: Oven · 0 of 100 bamboo good · <operator name>" with a **Scan** button beside it; below, the Oven summary (not started, 0 / 100 bamboo, "50 bamboo ready from Winding"), two big buttons **Log output** and **Log QC**, the **Oven runs** list, and at the bottom **Scan another card** and **Open the full job card**.*

What you see:
1. **Card header**: card number (for example 26/10/315), status chip (Running), **Full card** link, customer, size, colour and pcs = bamboo × pcs per bamboo.
2. **Your stage bar** (pinned): your stage name, good so far against the target, and your name. There are no other stage tabs.
3. **Scan** (pinned, right of the bar): opens the floor picker to scan the next card.
4. **Stage summary**: status (not started, running, closed), good / target, rejected, runs with the supervisor, what is ready from the stage before, flagged runs.
5. **Log output** and **Log QC**: open the forms for your stage only.
6. **Still needs QC** (when a run of your stage waits for readings) and **<Stage> runs**: only your stage's runs.

### Operator: the card is not at their stage yet, or their stage is closed
*Figure (in words): the same header and pinned "Your stage" bar, then one grey line with a lock: "This card is at Winding; Oven opens when Winding passes bamboo. Nothing to log here now." There are no Log output or Log QC buttons.*

The line says exactly why, for example:
- "This card is at Winding; Oven opens when Winding passes bamboo."
- "This card is at Winding; Oven opens when Winding QC is recorded (25 bamboo waiting)."
- "Winding is closed on this card (100 bamboo good). The card is at Process now." (the closed stage's runs are still listed, read-only)
- "This card is closed; nothing more to log on Oven." (completed or cancelled card)

### Supervisor and other roles: the full card
*Figure (in words): the card header, then a pinned row of compact stage tabs (Winding 50/100, Oven 0/100, Process 0/1,200, Dispatch 0/1,200) with a small scan icon at the end; a small amber dot on a tab means runs are flagged or waiting for the supervisor. Below: the selected stage's summary, **Log output**, **Log QC**, **Close <stage>** and the runs.*

### Operator not linked
*Figure (in words): above the stage tabs, a blue note: "Your login is not linked to an employee, so every stage is shown. Ask the Admin to link your login in Masters › Employees (your login email on your employee row)."* Other wordings: the employee is in a department that runs no floor stage (QC, Store, General…), or the login email is on two employees in different departments; in both cases every stage is shown until the Admin fixes the row.

### Log output on a phone (operator)
*Figure (in words): a full-screen sheet titled "Log output · Oven" with the card number and customer under it. No stage chips at the top. Date (Today / Yesterday / Other), Shift (A 08–20, B 20–08), Oven no. chips, Operator with the operator's own name already selected, Helper (optional), then **Made (bamboo)** and **Rejected (bamboo)** big number boxes, Good = Made − Rejected and Plan match. A bar pinned at the bottom shows "Still needed: …" and the **Cancel** and **Send to supervisor** buttons.*

When the sheet opens, the **Made** box (on Process, the **Bamboo taken from Oven** box) is focused and scrolled to the middle of the screen so the number keyboard does not hide it. In **Log QC** the first empty reading box is focused the same way. Qty and reading boxes open the number keyboard.

### After saving
*Figure (in words): a green tick, "Run O#1 sent to the supervisor", the card, stage, date and shift, a Made / Rejected / Good box, the plan match line, then four buttons: **Log QC for run O#1 now**, **Log another run**, **Scan another card**, **Back to card**.* After **Save QC** the buttons are **QC for run …** (when another run is waiting), **Log another QC**, **Scan another card** and **Back to card**.

### Masters > Customers: possible duplicates
*Figure (in words): the customer list with a new **Duplicates** filter (All / Possible duplicates (4)). A flagged row shows an amber **Possible duplicate** badge with "of Chokshi Texelin Pvt.Ltd. (WB-CTHOK)" beside it. The detail panel on the right has a **POSSIBLE DUPLICATE** chip and, on **Overview**, an amber note naming the other customer as a link.*

### New sales order: hint
*Figure (in words): under the **Customer** dropdown, a small amber line: "Possible duplicate: Sharma Tubes Private Limited (ST-02) has a similar name. Check you picked the right customer."* The order can still be saved.

## Step by step
### How to link an operator's login (Admin)
1. Make the login in System > Users with the **Operator** role (only that role) and the plant.
2. Open Masters > Employees, find the person's row (or **+ New employee**), open it and press **Edit**.
3. Set **Dept** to the stage they run: WINDER, OVEN or PROCESS.
4. Type the person's login email in **Email**, exactly as they sign in (capital letters and spaces do not matter). Save.
5. The next time the operator opens a card, only their stage shows. To move them to another stage, change the **Dept**.

### How an operator logs a run (Operator)
1. Scan the QR on the printed card (phone camera or **Scan** in the app). The card opens on your stage.
2. If a grey line says the stage is not open, there is nothing to do yet: press **Scan** for the next card.
3. Press **Log output**. Your name is already picked as Operator. Check Date, Shift and machine, type **Made** and **Rejected** (pick a rejection code when anything is rejected).
4. Press **Send to supervisor**. The run waits for the supervisor to check and submit it.
5. On the saved screen press **Log QC for run … now**, type at least 2 readings per check and press **Save QC**; or press **Scan another card**.

### How a supervisor works on the floor (Plant Manager, Owner, Admin)
Nothing changed: every stage is shown, the stage chips are at the top of each form, any department operator can be picked, and **Save run** posts at once. On a phone the stage tabs and the scan icon stay pinned while you scroll.

### How to check possible duplicate customers (Sales, Owner, Admin)
1. Open Masters > Customers and set **Duplicates** to **Possible duplicates**.
2. Open a flagged customer. The **Overview** tab names the other customer(s); press a name to open it.
3. Compare GSTIN, address and orders. If both rows are the same customer, keep the one with the orders and **Deactivate** the other (Owner/Admin). If they are different (another unit or branch), leave both; the badge stays as a reminder.
4. When picking a customer on a new sales order, read the hint under **Customer** if it appears and make sure the right one is picked.

## Rules the system enforces
- Operator scope is a **screen flow only** (no new rule). The server still checks every run and QC reading as before, including that the operator named is an active employee of the stage's department (owner decision of 1 Nov 2026).
- Scope applies only to a login whose **every role is Operator** and whose login email is on exactly one active employee row, in a department that runs a floor stage, in the card's plant. Otherwise the full form shows (with the note for an Operator-only login).
- A stage is "not open yet" for the operator when it has not started and nothing is ready from the stage before it (Winding after Slitting is always open). A running stage stays open for runs and QC.
- A closed stage, a completed card or a cancelled card shows the one-line status and no form to the operator. A supervisor can still add late QC readings to a completed card, as before.
- Old-form cards (made before the batch-entry form) keep their old entry form for everyone.
- Possible duplicates **only flag**: nothing is merged, deactivated or blocked automatically, and a sales order can still be saved for either customer.
- Names are compared after ignoring capital letters, punctuation, spaces and company words at the end (Pvt, Pvt.Ltd., Private Limited, Ltd, Limited, LLP). A small typo still matches (one letter in names under 10 letters, two in longer names; two swapped letters count as one).
- Text in square or round brackets is the unit: different units are different customers ("[Hazira]" and "[Silvassa]" are never flagged). A name without a unit can be flagged against a name with one.
- Names shorter than 5 letters must match exactly.

## Sample
| Customer A | Customer B | Flagged? | Why |
|---|---|---|---|
| Sharma Tubes Pvt Ltd | SHARMA TUBES PRIVATE LIMITED | Yes | same name after case and suffix |
| Reliance Industries Ltd | Relience Industries Limited | Yes | one-letter typo |
| Reliance Polyester Ltd [Silvassa] | Reliance Polyetser Ltd.[ Silvassa ] | Yes | swapped letters, same unit |
| Reliance Industries Limited [Hazira] | Reliance Industries Limited [Silvassa] | No | different units |
| Madelin Enterprises Ltd [Athola] | Madelin Enterprises Ltd [Saily] | No | different units |

Operator example: Ramesh signs in as ramesh.winder@sharmatubes.in (role Operator). His employee row EMP-014 has Dept WINDER and that email. He scans card 26/10/315: he sees "Your stage: Winding · 20 of 60 bamboo good · Ramesh", logs Made 12, Rejected 0, presses **Send to supervisor**, then **Log QC for run W#3 now**. Suresh (Dept OVEN) scans the same card while Winding has passed nothing: he reads "This card is at Winding; Oven opens when Winding passes bamboo." and presses **Scan**.

## Common questions
**Q: I am an operator and I see every stage. Why?** A: Your login is not linked. Read the blue note and ask the Admin to put your login email on your row in Masters > Employees with your department.

**Q: I work on Oven today instead of Winding. How do I log Oven?** A: Ask the Admin to change your **Dept** to OVEN, or ask the supervisor to log the run. The server only lists operators of the stage's own department anyway.

**Q: The card says my stage opens later. Can I log anyway?** A: No form is shown until the stage before passes output (or its QC is recorded). A supervisor can still take a batch before its QC with an override reason, as before.

**Q: Why is my name already picked as Operator?** A: Because your login is linked to your employee row. You can still pick a colleague of the same department if they ran the machine.

**Q: Does the supervisor see anything different?** A: Only the phone layout: stage tabs and scan stay pinned, and the saved screen has **Scan another card** and **Back to card**. The forms and rules are the same.

**Q: Where did "Done" go after saving?** A: It is now **Back to card**. **Scan another card** opens the floor picker straight away.

**Q: Two customers are flagged but they are different plants of the same company.** A: Put the plant in brackets in the name, for example "[Hazira]" and "[Silvassa]"; different units are never flagged. Otherwise leave the badge; it does not block anything.

**Q: Can the system merge two duplicate customers?** A: No. Keep the right one and deactivate the other; old orders keep pointing to the customer they were made for.

## Related chapters
- Mobile use and QR scan
- Log output and Log QC
- Job cards
- Masters and contact directory
- Sales orders
