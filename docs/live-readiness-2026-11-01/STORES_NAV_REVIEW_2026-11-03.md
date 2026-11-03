# Stores & inventory: design critique and accessibility review (3 Nov 2026)

Report only, nothing changed. Sources: live screenshots (Material items, Stock alert policies, Stock overview), `apps/web-ui/app/(dashboard)/layout.tsx` (sidebar), `lib/module-navigation.ts` (sub-tabs), `inventory/items/page.tsx`, `inventory/stock-alert-policies/page.tsx`, `routers/items.py`.

## What each page actually does

| Page (sidebar name) | Route | Real job | Who |
|---|---|---|---|
| Goods inward | /purchase/inward | Receive paper / material against a PO or manual, print reel labels | Store, GRN |
| GRN register & labels | /purchase/receipts | Saved receipts, invoices pending, QC, label reprints | Store, Accounts, QC |
| Reel & coil issue | /inventory/reels/issue | Issue reels/coils to the floor | Store, RMIssue |
| Material issue | /inventory/production-issue | Issue adhesive, parchment, packing to the floor | Store, RMIssue |
| Issue history | /inventory/issue-history | Log of every issue, CSV | many |
| Stock counts & book | /inventory/stock-control | Counts, corrections, stock book, locations (4 tabs) | everyone |
| Opening stock | /inventory/opening-stock | Go-live stock (one-time) | Owner, Admin |
| Inventory | /inventory | **Stock overview** (read and jump) + tabs **Material items** and **Goods inward** | most |
| Genealogy | /inventory/genealogy | Reel lineage, trace | most |
| Manual FG | /inventory/fg-inward | FG in outside job close (rework, returns) | Owner, Admin, PH |
| Stock alert policies | /inventory/stock-alert-policies | Versioned safety/reorder/target/lead/MOQ per material, maker-checker | Owner, Admin, PH |
| Stock Alerts | /inventory/stock-alerts | Breach inbox | many |
| RM Costing | /inventory/rm-costing | Standard cost versions | Owner, Admin |
| Dispatch | /logistics/dispatch | Packing handoff, challans | Dispatch, Sales |

## Your question: Material items vs Stock alert policies

Yes, they overlap, and it is worse than duplication: **two places write the same numbers.**
- **Material items** is the stock item list: one row per material with stock, plus a "Create item" form and an "MRP policy" panel. That panel saves Reorder, Safety and Lead days **straight onto the item**, with no reason and no second person.
- **Stock alert policies** sets the same three numbers, plus target, MOQ, order multiple and recipients, as a **versioned draft that a second person activates**, with a reason code. Activation **overwrites** the item's reorder/safety/lead ("aligns existing item reorder fields").
- Result: a value typed on Material items is silently replaced the next time a policy is activated, and the policy's audit trail misses changes made on Material items. The live screens show every item at `R 0 · S 0 · Lead 0 d` and 0 active policies, so nothing is set either way yet. This is the right moment to pick one.
- Material items is **not** an adjustment page. It never changes stock. Stock changes live in Stock counts & book › Corrections, Goods inward, the issue desks and Opening stock. It is a **catalogue page**. Its "Create item" form is also a back door: materials normally come from Masters (papers, parchments, packaging sync into items on their own). A hand-made item such as `KRAFT-352-500PB` (0 kg, next to the real `352` with 27,242 kg) is how duplicates appear.

## Design critique

### Overall impression
The pages work, and the visuals are calm and consistent. The biggest problem is the information architecture: 14 sidebar entries under Stores & inventory, several doing parts of the same job, and labels that describe the system ("Governance", "Precedence: Item → plant", "Deterministic effective rule", "deduplicated breach episodes") rather than the store's work.

### Usability
| Finding | Severity | Recommendation |
|---|---|---|
| Reorder/safety/lead editable in two places that overwrite each other (above) | 🔴 Critical | Keep **one** owner: Stock alert policies (it has maker-checker and reasons). Make Material items show the active policy read-only, with a "Change in stock rules" link. |
| "Create item" on Material items bypasses Masters, which leads to duplicate paper items | 🔴 Critical | Hide Create for synced types (paper, parchment, packaging, adhesive); keep it only for Tool / Other, or send the user to the right Master. |
| **Goods inward appears 3 times**: sidebar item, tab under Inventory, and a card on Stock overview | 🟡 Moderate | Keep the sidebar item; drop the Inventory tab (a tab that jumps to another section is disorienting: the sidebar highlight moves). The overview card can stay as a shortcut. |
| 14 flat entries in one group; daily desks (inward, issue) mixed with one-time (Opening stock) and owner setup (RM Costing, policies) | 🟡 Moderate | Group into 4 (see proposal). |
| "Inventory" entry's description says "Raw material inward, reel issue, balances, and valuation", which is out of date (it is now the stock overview) | 🟡 Moderate | Rename the entry to **Stock overview**, with the description "What is in stock, what is held, and where". |
| Issue desks split into 3 entries (Reel & coil issue, Material issue, Issue history) | 🟢 Minor | One entry **Issue to floor** with tabs Reels & coils / Other materials / History (the sub-tab system already exists in module-navigation). |
| "Stock alert policies" and "Stock Alerts" are separate entries with the same icon | 🟢 Minor | One entry **Stock alerts** with tabs Inbox / Rules. |
| Dispatch sits under Stores | 🟢 Minor | Move to its own **Dispatch** group (or Sales), next to challans. |
| Manual FG under Stores while FG normally comes from job close | 🟢 Minor | Put it as a tab under Dispatch / FG stock, labelled "FG in without a job card". |
| Opening stock stays in the daily menu after go-live | 🟢 Minor | After the go-live month closes, move it under Stock counts & book (or System). |

### Wording (plain-language rewrite)
| Now | Better |
|---|---|
| Governance · MRP policy | Reorder levels |
| "Select an item from the catalog to govern alerts." | "Pick a material to see its reorder levels." |
| R 0 · S 0 · Lead 0 d | Reorder 0 kg · Safety 0 kg · 0 days |
| Stock policy authority · "Previewing saves nothing and sends nothing; evaluation creates deduplicated breach episodes." | "Set when a material counts as low. A second person switches each change on. Check now sends alerts for anything below its level." |
| Precedence: Item → plant · "Deterministic effective rule" | Remove the card (users don't act on it). Show "Materials without a rule: N" instead. |
| Draft policy version / Policy version register | New rule / Rules and history |
| Recovery margin kg / Cooldown hours / Recipient roles (comma separated) | "Clear the alert when stock is this much above reorder" / "Remind again after (hours)" / a role picker, not free text |
| Activate as checker | Switch on (second person) |
| Inventory item master (Catalog) | Materials |
| Delete (on items with stock) | Switch off. The server already refuses while stock is on hand; say so before the click. |

### Visual hierarchy
- **Material items:** the eye goes first to the big "Create item" form (left), but the store's real need is the list (right). Put the list first, full width, with Create (when allowed) as a button that opens a sheet.
- **Stock alert policies:** three summary cards lead, and one of them ("Precedence") is not actionable. The form is long (10 fields) before the user sees that there are 0 rules. Lead with "Materials without a rule" and the list, with Add rule as a sheet.
- **Stock overview:** good. Big numbers, then actions. Its "Held / blocked 3,192 kg" card should link to the held reels.

### Consistency
| Element | Issue | Recommendation |
|---|---|---|
| Sidebar casing | "Stock Alerts", "RM Costing", "Manual FG" vs sentence case elsewhere | Sentence case everywhere: Stock alerts, RM costing |
| Icons | `Package` used for Goods inward, Opening stock, Inventory, Manual FG; `ShieldCheck` for policies, alerts and PO approvals | One distinct icon per entry |
| Page shells | Stock alert policies uses the Procurement shell (eyebrow "Stock policy authority"); Material items uses its own card layout | Same stores page header for all stores pages |
| Units | Policies say kg for all materials ("All paper thresholds are canonical kg"), but packing is PCS | Show each material's own unit |

### Proposed sidebar (Stores & inventory, 14 entries become 7)
1. **Goods inward**: tabs Receive / GRN register & labels
2. **Issue to floor**: tabs Reels & coils / Other materials / History
3. **Stock overview**: tabs Overview / Materials / Genealogy
4. **Stock counts & book**: tabs Counts / Corrections / Stock book / Locations (+ Opening stock after go-live)
5. **Stock alerts**: tabs Inbox / Reorder rules
6. **RM costing** (Owner, Admin)
7. Dispatch and Manual FG move to a **Dispatch** group.

Old routes keep working through redirects (the app already does this for retired pages in `lib/retired-routes.ts`).

## Accessibility audit (WCAG 2.1 AA)
**Issues found:** 8 | **Critical:** 1 | **Major:** 4 | **Minor:** 3. Based on code and screenshots. Contrast values are estimated from the design tokens and not measured; a screen-reader pass was not done.

| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| 1 | Material items "MRP policy": the three number inputs (reorder, safety, lead) have **no label**, only a placeholder that disappears once typed | 3.3.2, 1.3.1 | 🔴 Critical | Visible labels (Field component), units in the label |
| 2 | Row buttons "Edit" / "Delete" repeat on every row with no item in their name; a screen reader hears "Edit, Edit, Edit…" | 2.4.6, 4.1.2 | 🟡 Major | `aria-label="Edit 351 Kraft 350 GSM"` |
| 3 | Row pill buttons are about 28 px tall | 2.5.5 (AAA) / 2.5.8 | 🟡 Major | 44 px on touch (store staff use tablets) |
| 4 | Delete uses `window.confirm` with technical text ("Soft-delete item…") | 3.3.4 | 🟡 Major | In-app confirm with plain words and the reason it may be refused |
| 5 | Policy: "Recipient roles" is free text, comma separated; typos are silent | 3.3.1, 3.3.3 | 🟡 Major | Role checkboxes |
| 6 | Grey helper text (`text-muted-foreground`, 11–12 px) on tinted cyan panels | 1.4.3 | 🟢 Minor | Check the ratio; use 13 px and a darker tone on tinted backgrounds |
| 7 | Policy card labels at 9 px uppercase ("SAFETY / REORDER / TARGET") | 1.4.4 | 🟢 Minor | 11 px minimum |
| 8 | "R / S / d" abbreviations in the item table | 3.1.4 (AAA) | 🟢 Minor | Spell out, or use `<abbr title>` |

Works well: the sidebar has a skip target (`main#workspace-content` with tabIndex), the Opening stock and Stock alert policies forms use real `<label>`s, inputs are 44 px tall, focus styles are present, and status is shown with words as well as colour (On hold / Cleared).

## Priority recommendations
1. **One home for reorder levels** (Stock alert policies, renamed "Reorder rules"); Material items shows them read-only. This stops silent overwrites.
2. **Stop hand-made duplicate items**: Create item only for Tool / Other; switch off `KRAFT-352-500PB`-style strays.
3. **Regroup the Stores menu into 7 entries with tabs**, remove the duplicate Goods inward tab, and rename Inventory to Stock overview.
4. **Plain-language pass** on Material items and Stock alert policies (table above).
5. Fix the accessibility items 1–5.

## Built (3 Nov 2026, same day)
- **Sidebar:** Stores & inventory now has 6 entries with tabs: Goods inward (Receive goods · GRN register & labels), Issue to floor (Reels & coils · Adhesive, parchment, packing · Issue history), Stock overview (Overview · Materials · Reel trace), Stock counts & book (Counts · Corrections · Stock book · Locations · Opening stock), Stock alerts (Alerts · Reorder rules), RM costing. Dispatch is its own group (Dispatch · FG in without a job card). Every tab carries its page's roles; an entry opens on the first tab that person may see (e.g. Accounts → GRN register). No page or route was removed.
- **Materials** (was Material items): list first with type filter, search, in-stock and switched-off toggles, Low / OK chips, stats (materials, in stock, low, no reorder level); a detail sheet with stock, read-only reorder level (link to Reorder rules), incoming QC checks in plain words; Switch off with in-app confirm (disabled while stock is on hand). The MRP policy edit panel is gone. Add is only for tools / other materials (Owner, Admin), and points to Masters for paper, parchment, adhesive and packing.
- **Reorder rules** (was Stock alert policies): one table of every material and its rule, a "Waiting for a second person" list with Switch on (disabled on your own rule), a form in plain words (Reorder at, Safety, Fill up to, lead time, minimum order, multiples, who is told as checkboxes, More settings for clear margin and reminder hours, reason code), units per material. Opened from Materials with that material preselected.
- **Stock alerts:** Low now / Critical / Back to normal, "I'll handle it" and "Open POs"; an empty state that says when no rules exist.
- **Stock overview:** six plain shortcuts (no duplicates), held-stock tile goes to Incoming QC.
- **Shared fix:** `Panel` body padding override now works (it was ignored because `cn` only joins classes), which also fixes Stock counts, Corrections, Stock book and the count review lists.
- **Help guide** text for Stock overview / Materials and Stock alerts / Reorder rules rewritten to match.
- Checks: web type-check clean, `npm test` (static + unit) passes, navigation test extended for the new tabs and role filtering, pages walked in the browser on the local stack (all API calls 200).
