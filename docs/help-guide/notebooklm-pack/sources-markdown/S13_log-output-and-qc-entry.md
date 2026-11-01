HARI OM TUBEOS HELP GUIDE - Chapter 13: Log output and QC entry
Section: Production, quality and dispatch. Accurate as of 31 October 2026. Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).
Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter 13.

# Log output and QC entry

> **What it is:** The two short floor forms: **Log output** (how many were made and rejected on a run) and **Log QC** (the readings for a run). Same pages on a phone and a PC.
> **Who uses it:** Operator, Plant Manager, QC and In-process QC, Owner and Admin. Planners can open the pages and view runs.
> **Where:** Sidebar > Operations > Log output (/production/entry) and Log QC (/production/entry?mode=qc). Scanning a printed card's QR opens /production/entry/<card>.

## At a glance
- Find the card by **scanning its QR**, typing its number (26/10/315, or 26-10-315), or picking it from **Open cards**.
- **Log output** asks only for date, shift, machine, operator, times (optional), made and rejected. Good = Made − Rejected. There are no QC fields on it.
- **The operator list shows only the stage's own people.** Winding lists active employees of the WINDER department, Oven of OVEN, Process of PROCESS (set in Masters › Employees). Log QC asks for the operator who took the readings the same way.
- **Every "why" is a reason code.** Rejected pieces, cutting loss, over-production, carryover, taking batches before QC, voiding a run and changing saved readings each pick a code from Masters › Reason codes, with an optional note.
- **Log QC** asks for the readings: **at least 2 readings per required check** (moisture is optional). **Operators log QC too**; no separate inspector is needed.
- A reading **outside its band is saved and flagged, never held**. The run is accepted, the next stage can take it, and on Process its pcs are packed into boxes that show **QC flagged**.
- An operator's run goes **to the supervisor** (plant manager, Owner or Admin), who checks and submits it. A supervisor's own run posts straight away.

## The flow

Flow diagram: One run on the floor
Steps: 1. Scan card QR (done by Operator) -> 2. Pick stage -> 3. Log output (done by Operator) - made, rejected -> 4. Send to supervisor -> 5. Submit run (done by Plant Manager) -> 6. Log QC (done by Operator/QC) - 2 readings per check -> 7. Next stage can take it
If it goes wrong after 'Log QC': 1. Reading out of band -> 2. Saved and flagged - not held
If it goes wrong after 'Log output': 1. Log QC for this run now (done by Operator)

QC can be logged straight after the run (the saved screen offers **Log QC for run W#3 now**), later from the card, or from the QC desk. A run with its readings still due waits; the next stage takes only runs whose QC is recorded.


Flow diagram: A Process run becomes boxes
Steps: 1. Log output on Process (done by Operator) -> 2. Submit run (done by Plant Manager) -> 3. Log QC (done by Operator/QC) - 2 readings per check -> 4. Full boxes packed - box code and QR -> 5. Print box labels (done by Operator)
If it goes wrong after 'Full boxes packed': 1. Pcs left over -> 2. Next run fills next box

On Process the last step of a run is packing. As soon as a run's readings are done, its good pcs fill boxes of the spec's qty per box. See "Job cards" for box codes and labels.


Flow diagram: Old links
Steps: 1. Supervisor entry link -> 2. Floor entry - Log output
If it goes wrong after 'Supervisor entry link': 1. EOD entry link -> 2. Floor entry - Log output
If it goes wrong after 'Supervisor entry link': 1. Order tracker link -> 2. Orders list


## Screen tour

[Screenshot "log-output": Floor entry page on a PC with the Scan the card's QR button, a card number box and the Open cards list]
*Figure: Floor entry, opened from the Log output link. A large green "Scan the card's QR" button, a box to type the card number or customer with an Open button, and the list of open cards.*

What you see:

1. **Title**: "Floor entry" (from the **Log output** link) or "Log output" / "Log QC" when the page was opened for one of them. On Log QC a button **Log output instead** switches over (and **Log QC instead** the other way).
2. **Scan the card's QR**: opens the phone or laptop camera. Point it at the QR on the printed job card.
3. **Card number box** ("26/10/…  or customer") and **Open**. Numbers typed with dashes, dots or spaces read as 26/10/315. Typing a customer or order opens the first open card that matches.
4. **Open cards**: newest open cards first, 100 at a time ("Newest 99 open cards"), each with number, flag count (amber), customer, colour, pcs, current stage and status (**Running**, **In queue**, **Scheduled**). **Show older cards** loads more.
5. **Error lines** in red when the scan or number is wrong: "That is a rack label…, not a job card", "That QR is on a material or tool label, not a job card", "Job card 26/10/315 is closed (completed). No more runs can be logged on it." (with **View the card**), or "No open job card 26/10/999".

[Screenshot "log-qc": Log QC picker page on a PC with the Log output instead button]
*Figure: Log QC. The same picker; the subtitle reads "Scan the card, pick the run, type the readings. Out of band is flagged, never held."*

[Screenshot "m-log-output": Floor entry on a phone, big scan button and the open cards list]
*Figure: Floor entry on a phone. The scan button and number box fill the width; open cards are large rows for fingers.*

[Screenshot "m-log-qc": Log QC on a phone with the Log output instead button]
*Figure: Log QC on a phone. Same layout as on the PC.*

[Screenshot "log-output-operator": Log output form with the Operator list filtered to the Winding department]
*Figure: The Log output form on Winding. Under Who and when, the Operator drop-down (Choose operator) lists only active employees of the Winder department with their codes; the machine list shows only winders. Below are Made, Rejected, the green Good box and the Why rejected? reason picker.*

What you see:

1. **Operator**: names with the employee code, for example "Suresh Patel · EMP-014". People of other departments are not offered, and the server refuses them if sent.
2. **Machine**: only the active machines of this stage.
3. **Why rejected?**: the reason picker appears as soon as Rejected is above 0.

[Screenshot "reason-picker": Reason picker open, showing the Floor rejection codes with a search box and the note field]
*Figure: The reason picker used everywhere in the app. A button reads "Choose why"; opened, it shows a Search reasons box and the list of codes, each with its label on the first line and the code under it (for example Winding loose · WL). Under it is a Note box marked (optional), or marked * when the code is an OTHER code.*

What you see:

1. **Choose why**: click (or press the down arrow) to open the list. Type in **Search reasons** to narrow it.
2. **Each row**: the label and the code. A tick marks the chosen one.
3. **Note**: optional, except for OTHER codes, which need at least 5 characters ("Write a short note (at least 5 characters) for Other.").
4. If the list is empty: "No reasons are set up for this list. Add them in Masters › Reason codes."

After a card is opened (described in words; no screenshot of the forms):

- **On a phone** (/production/entry/<card>): the card's number, customer and size; its stages as tabs; two big buttons **Log output** and **Log QC**; the stage's recent runs (newest first); and what still needs QC. A card of another plant switches your active plant if you are allowed. A closed card is read-only; a completed card still takes QC readings.
- **On a PC**: the job card page opens with the form in a side panel ("Log output · 26/10/315 · Sharma Tubes Pvt Ltd · no QC fields here", or "Log QC · at least 2 readings per check · out of band is flagged, not held").

**Log output form** sections:

1. **Stage tabs** (Winding, Oven, Process; closed stages show "Closed · 90 bamboo").
2. **Who and when**: **Date** (**Today**, **Yesterday**, or **Other date**), **Shift** (**Shift A** 08–20, **Shift B** 20–08), the machine (**Winder no.**, **Oven no.**, **Line no.**; only active machines of this stage's department), **Operator** (**Choose operator**; only active employees whose department in Masters › Employees is this stage, operators first; the last one is remembered), and **Start time** / **End time** ("Times are optional"; the cycle time is shown). If nobody is set up, an amber line says "No active employee in the Winding department — set the department in Masters › Employees."
3. **How many**: on Process first **Bamboo taken from Oven** with "N ready from Oven · 1 bamboo = 10 pcs". Then **Made** and **Rejected** in the stage unit (bamboo for Winding and Oven, pcs for Process). A green box shows **Good = Made − Rejected**. A **Plan match** box shows where the run lands against the plan.
4. **Process balance** (Process only): "9 bamboo × 10 pcs = 90 pcs · all pieces accounted for", or an amber count-gap line ("4 pcs short — it still saves and the run is flagged for the owner"). **Cutting loss (pcs, if any)** with a button to count the gap as cutting loss; a cutting loss needs a reason.
5. **Why rejected?**: a reason picker for the list **Floor rejection** when anything is rejected: WL Winding loose, PG Pasting / glue, ID I.D. out, OD O.D. out, LN Length out, WT Weight out, CS C.S. low, DM Damage / dent, MS Moisture, NT Notch, RJ-OTHER Other (write a note). When only a cutting loss is typed, the same picker asks "Why were 4 pcs lost in cutting?"; with both it asks "Why rejected or lost in cutting?". **Save** stays off until a code is picked.
6. **Why is this outside the plan?** (amber box, only when needed): shows when output goes above the planned quantity +10%, when pieces are held over (carryover), or when batches are taken before their QC. Pick a code from the list **Override**: OV-CUST-EXTRA Customer accepts extra, OV-SETUP-LOSS Extra for setup or cutting loss, OV-PLAN-CHANGE Plan changed on the floor, OV-URGENT Urgent order run early, OV-MACHINE-SWAP Run on another machine, OV-OTHER.
7. **Save run** (supervisor roles: "Saving posts the run straight away") or **Send to supervisor** (operator: "Your run goes to the supervisor, who checks and submits it").

**Log QC form** sections:

1. **Stage tabs**. A stage without checks is greyed: "No QC checks on this stage"; Final QC says "Process QC is the final QC".
2. **Run**: the run waiting for QC is picked first. Runs still **with supervisor** can take QC too. **QC without a run** is for a check between runs, at the start of a shift, or on held pieces.
3. **Readings table**: one column per check with its allowed band, one row per sample (S1, S2…). Cells turn green in band and red out of band. **Add another sample** adds a row. A check named Remark or Notes is written in words ("Note — write in words") and is never judged.
4. **Operator who took the readings**: the same department list as on Log output.
5. **Instrument ID** where a check needs a calibrated instrument.
6. **Why are recorded readings changed?** (only when you change readings already saved; list **Entry correction / void / reopen**, for example EC-WRONG-QTY) and **Remark** (optional — what you saw, in plain words). "Adding new readings needs no reason; changing recorded ones does."
7. The save line: "All readings in band." or "Saves with 2 flagged readings — not held." and the button **Save QC** (or **Save QC · flagged**).

[Screenshot "dlg-log-output-card": Floor entry card page for 26/10/313]
*Figure: Floor entry after opening card 26/10/313. The four stage tabs (Winding, Oven, Process, Dispatch) show how many are good. Big buttons **Log output** and **Log QC** sit under the progress bar. A yellow **Still needs QC** box lists runs waiting for readings.*

1. **Stage tabs**: pick the stage you are working on. Each shows good pieces against the target.
2. **Progress bar**: how much of the stage is done.
3. **Log output / Log QC**: the two actions you use on the floor. A small badge shows how many QC checks are waiting.
4. **Close Winding**: stays locked with a reason (here "QC readings short") until the checks are done.
5. **Still needs QC**: runs that have output but not enough QC readings yet.
6. **Winding runs**: every run, newest first, with **Add QC**, cancel and history buttons.

[Screenshot "dlg-log-qc-card": Log QC side panel]
*Figure: The **Log QC** panel. At least two readings per check (S1, S2). Each check shows its allowed band, for example I.D. 76.2 to 76.5 mm. Out-of-band readings are flagged, not held.*

1. **Stage tabs**: choose Winding, Oven or Process.
2. **Run list**: pick the run to check, or **QC without a run** for a check between runs, at start of shift or on held pieces.
3. **Readings**: type each measurement in its own box. Green means in band; amber with a flag means outside the band. It still saves.
4. **Save QC**: stays grey until at least one reading is typed. The footer says what is still needed.

## Step by step

### How to log a run on a phone
Roles: Operator, Plant Manager, Owner, Admin.

1. Scan the QR on the printed job card with the phone camera (or open **Log output** and tap **Scan the card's QR**). Log in if asked; you come back to the card.
2. Tap the stage tab, then **Log output**.
3. Check **Date** and **Shift**. They default to the shift running now (see the night-shift rule below).
4. Tap the machine and pick the **Operator**. Only people of this stage's department are listed. Times are optional.
5. Type **Made** and **Rejected**. If you rejected anything, tap **Choose why** under **Why rejected?** and pick the code (for example WL Winding loose).
6. On Process, type **Bamboo taken from Oven**. If the pieces do not match bamboo × pcs per bamboo, type any **Cutting loss** and pick its reason code, or leave the gap: it saves and is flagged.
7. If an amber box **Why is this outside the plan?** appears (above target +10%, carryover, or taking batches before QC), pick an **Override** code. Only a plant manager, Owner or Admin may take batches before their QC.
8. Tap **Send to supervisor** (operator) or **Save run** (supervisor). The saved screen shows "Run W#3 sent to the supervisor" or "Run W#3 saved", with Made, Rejected, Good and the plan match.
9. Tap **Log QC for run W#3 now**, **Log another run**, or **Done**.

### How to log a run on a PC
1. Open the job card (Job Cards list, click the row). Or use the row menu **Log output**.
2. Click **Log output** in the action bar. The form opens in a side panel.
3. Fill it as above and save.
4. A plant manager can also type a whole paper card at once: **Output log** tab > **Whole printed card** (running totals of every stage; only what is new is posted).

### How to log QC readings
Roles: Operator, QC, In-process QC, Plant Manager, Owner, Admin.

1. Open the card and click **Log QC** (or scan with **Log QC** open). The button shows "N waiting" when runs need readings.
2. Pick the stage tab and the **Run** (the waiting run is already picked). Pick the **Operator who took the readings**.
3. Type at least 2 readings for every required check, one per sample row. Use **Add another sample** for more.
4. If a cell turns red, check the value. If it is right, keep it: "It still saves — the run is flagged, not held, and the next stage can take it."
5. Type the **Instrument ID** if asked. Add a **Remark** if you saw something.
6. Click **Save QC**. The saved screen shows "QC saved · run W#3 · all in band" or "flagged", lists the flags under **Flagged, not held**, and says which runs still wait for QC.
7. On Process, saving the readings also packs the run's good pcs into boxes. New boxes appear on the card's **Dispatch** tab, ready for their labels.

### How a supervisor submits operators' runs
Roles: Plant Manager, Owner, Admin.

1. Open the card, **Output log** tab. Runs marked **With supervisor** are drafts; they do not count yet.
2. Check each one; edit it if needed (an operator can edit only their own drafts).
3. Use the tick action ("Checked — post this run"). The run now counts.
4. A stage cannot close while any run is still with the supervisor.

### How to correct a mistake
- **A draft run**: edit it (operator: own drafts only; supervisor: any).
- **A submitted run**: void it with a reason code ("Why is it voided?", list **Entry correction / void / reopen**: EC-WRONG-QTY, EC-WRONG-OPERATOR, EC-WRONG-MACHINE, EC-DUPLICATE, EC-WRONG-CARD, EC-OTHER), then log it again. Output already used by the next stage cannot be voided, and a Process run whose pcs are already in a box cannot be voided. Every save of a run is kept under **Revision history**.
- **QC readings**: open Log QC on the same run, change the value and pick **Why are recorded readings changed?**. Adding more readings needs no reason.
- **Wrong operator on a saved run**: void it with EC-WRONG-OPERATOR and log it again with the right person.

## Rules the system enforces
- **Floor entry roles**: Operator, Plant Manager, QC, In-process QC, Planner, Owner and Admin can open the floor pages. Logging runs: Operator, Plant Manager, Owner, Admin ("Your role can view runs but not log them" for others). QC and In-process QC may add QC readings only. (Blocks.)
- **Required on a run**: date, shift (Shift A or Shift B only), operator, made > 0; a **Floor rejection** code if rejected > 0; a code for any cutting loss; Process bamboo taken. Old runs saved with OT read as RJ-OTHER. (Blocks.)
- **Operator of the stage's department.** Every run and every QC entry, on phone and PC, needs an active employee whose department is the stage (Winding → WINDER, Oven → OVEN, Process → PROCESS). Anyone else is refused: "Ravi is not in the Winding department (Oven in Masters › Employees). Choose an operator of the Winding department." (Blocks.)
- **Reasons are codes, never free text.** Every reason on these forms picks an active code of the right list and plant; OTHER codes need a note of at least 5 characters. Free text alone is refused. (Blocks.)
- **Rejected cannot be more than made.** (Blocks.)
- **Above 110% of target** needs an **Override** code ("Output goes above the planned quantity +10%"). Carryover and taking batches before QC need one too; one code covers all of them on a run. (Blocks until chosen.)
- **Card times never block.** Start and end are optional; an end before the start is saved and flagged. (Flag only.)
- **Planning never blocks.** A run on a stage with no planner slot is saved and flagged "Run before planning". The floor never picks a slot; the server places the run in the slot of its date and shift. (Flag only.)
- **Count gap** on Process (pieces ≠ bamboo × pcs per bamboo) is a warning and a flag, never a block. If the spec has no pcs per bamboo, Process cannot be saved: "This card's spec has no pieces per bamboo… Ask the planner to correct the spec." (Flag; blocks only without pcs per bamboo.)
- **QC gate between stages.** The next stage can take only QC-cleared output (output whose readings are done, in band or not): "Only 60 bamboo of Winding output is QC-cleared; 30 more is waiting for Winding QC. Record that batch's QC first, or a supervisor can override with a reason." Only a plant manager, Owner or Admin may override, with an **Override** code that stays on the run. (Blocks, supervisor override.)
- **Boxes from QC-cleared Process pcs.** Process good pcs go into boxes only after their run's readings are done. (Automatic.)
- **2 readings per required check** for a run to be QC done, and for a stage to close (including a short close). Moisture is optional; a missing optional reading is flagged for the owner. (Blocks the close and the next stage.)
- **Out-of-band reading** saves, flags the run and appears on the card, the boxes holding that run's pcs, the dispatch register, the order and Quality › In-process QC. No hold is made and dispatch is never blocked by it. (Flag only.)
- **Future dates refused**: "<date> is in the future. Use the date the shift started." (Blocks.)
- **Closed month**: runs dated in a closed month are refused ("<Month> is closed. Ask the owner to re-open it."). QC-only checks are not affected. (Blocks.)
- **Cancelled cards** take nothing. **Completed cards** take QC readings only. (Blocks.)
- **Drafts on the device.** Every floor form keeps what you typed on the phone or PC until it is saved; reopening shows a "Draft restored" bar with a discard option. (Automatic.)

**Canonical shift and the night-floor date.** There are two shifts: **Shift A** 08:00–20:00 and **Shift B** 20:00–08:00 (India time). Shift names written as "A", "Shift A" or "shift-a" are all read as Shift A. The date of a run is **the day the shift started**: a run at 01:30 on 31 Oct belongs to Shift B of **30 Oct**, and the form picks 30 Oct by itself. When you change the shift on the form, the date follows (at 10:00, choosing Shift B gives last night's date). Times before 08:00 on Shift B are stored on the next calendar day.

**Old pages that now redirect.** "Supervisor entry" (/production/supervisor-entry) and "EOD entry" (/production/eod-entry) open Floor entry; a link that named a card opens that card. Old printed QR codes still work. The old Order tracker (/planning/tracker) opens the Orders list with the matching filter.

## Sample
Night shift, card 26/10/315 (Sharma Tubes Pvt Ltd, 76.4 x 81 x 150, BLUE, 10 pcs per bamboo).

| Field | Value typed | Result |
|---|---|---|
| Time on the clock | 01:30, 31 Oct | Date 30 Oct, Shift B (automatic) |
| Stage / machine | Process / Line 1 | Plan match: As planned · 30 Oct · Shift B |
| Bamboo taken from Oven | 9 | 9 × 10 = 90 pcs possible |
| Operator | Suresh Patel (Process department) | Accepted; a winder operator would not be listed |
| Made / Rejected | 86 / 2, reason OD O.D. out | Good = 84 pcs |
| Cutting loss | 4, reason picked with note "end trimming" | all pieces accounted for (86 + 4) |
| Saved by | Operator | "Run P#2 sent to the supervisor" |

QC on run P#2: I.D. 76.5 and 76.9 mm against band 76.2–76.5. The second reading is red; the operator saves. Result: "QC saved · run P#2 · flagged", "I.D. 76.9 mm (band 76.2–76.5) · S2". The run is accepted; the flag shows on the card and in In-process QC. The spec packs 48 pcs per box and 20 pcs from run P#1 were waiting, so 20 + 84 = 104 pcs fill boxes B2610315-002 (20 from P#1 + 28 from P#2) and B2610315-003 (48 from P#2); 8 pcs wait for the next run. Both boxes show **QC flagged** because they hold pcs of P#2, and both can still ship.

## Common questions
**Q: The scan opened "That QR is on a material or tool label". What now?** A: You scanned a reel, lot or tool label. Scan the QR on the printed job card.

**Q: It is 2 a.m. Why does the form say yesterday's date?** A: The run belongs to Shift B, which started yesterday at 20:00. That is correct.

**Q: Do I have to fill start and end time?** A: No. They are optional and never stop a save.

**Q: My reading is outside the band. Will the card stop?** A: No. It is saved and flagged, also on the boxes of that run. Only a hold placed on purpose on the Quality pages stops a card.

**Q: My name is not in the Operator list.** A: Your department in Masters › Employees is not this stage, or you are inactive. Ask the Owner or Admin to set your department (for example PROCESS).

**Q: Save stays grey after I typed Rejected.** A: Pick a code under **Why rejected?**. With RJ-OTHER, also write a note of at least 5 characters.

**Q: Why did Log QC on Process make new boxes?** A: Pcs go into boxes once their readings are done. Print the labels from the card's Dispatch tab.

**Q: Why can't the next stage take my batch?** A: Its QC is not done yet. Add at least 2 readings for every required check on that run, or ask the supervisor to override with a reason.

**Q: I saved a run but it does not count.** A: It is with the supervisor. A plant manager, Owner or Admin must submit it.

**Q: I typed the wrong quantity on a submitted run.** A: Ask the supervisor to void it with a reason, then log it again. If the next stage already used that output, it cannot be voided.

**Q: Where is the old Supervisor entry page?** A: It now opens Floor entry. Use Log output.

## Related chapters
- Job cards
- Planner
- Quality
- Job card manager
- Masters (Employees, Reason codes)
