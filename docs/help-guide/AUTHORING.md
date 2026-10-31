# Hari Om TubeOS help guide: authoring spec

This spec is for the people (and agents) writing the chapters of the Hari Om TubeOS help guide. The same chapters feed two things:
1. a polished HTML/PDF handbook for users, and
2. a source pack for Google NotebookLM that users chat with as a help bot.

So every chapter must be **accurate to the system as it is on 31 Oct 2026**, **easy to read**, and **fully self-contained as text** (a bot that cannot see images must still understand every screen from your words).

## Audience and tone
- Factory and office staff in an Indian paper tube plant: Sales, Planner, Plant Manager, Operator, QC (incoming and in-process), Store/GRN/RM issue, Dispatch, Accounts, Owner and Admin.
- Plain, short sentences. Say what to click and what happens next. No jargon without a one-line explanation. No marketing words.
- Use the exact labels shown on screen (button names, tab names, column names, sidebar names). Put UI labels in **bold**.
- Use realistic sample values (Indian context: customers like Sharma Tubes Pvt Ltd, suppliers like Bharat Paper Mills, SO numbers like SO/26/10/412, job cards like 26/10/315, tube size 76.4 x 81 x 150, colours BLUE/RED, quantities in pcs, weights in kg, rupees with the rupee sign). Samples must be consistent with how the app formats numbers.

## Truth sources (read before writing; never invent behaviour)
- App code: `apps/web-ui/app/(dashboard)/...` (pages), `apps/web-ui/components/...`, `apps/web-ui/lib/guide-content.ts` (existing in-app guide text, 28 guides, a good base), `apps/web-ui/lib/module-navigation.ts`, `apps/web-ui/app/(dashboard)/layout.tsx` (sidebar, roles per page). Backend services are under `hariom-erp/services/`.
- Screenshots (live, 31 Oct 2026, Owner login, light mode): `docs/help-guide/screens/*.jpg` (1440x900, `m-*.jpg` are phone 390x844). **Look at the screenshots you use** (Read the image file) so your description matches what is really on screen. Customer names in them were relabelled to Sharma Tubes Pvt Ltd.
- Project memory notes with the client's decisions, round by round: `/Users/devarshthakkar/.claude/projects/-Users-devarshthakkar-Downloads-hari-om/memory/` (read MEMORY.md, then the `hariom-client-round-*`, `hariom-unified-pages-proposal.md`, `hariom-season-qc-plan.md` files that touch your chapters). These explain the *rules* (card times never block, qty+auto reject, planner gate never blocks (flagged), out-of-band QC flagged not held for in-process, GRN numbers by April FY, etc.). Where memory and code disagree, **code wins**; if you cannot tell, write the safe wording and list it under "Needs confirmation" in your final report.
- Older docs in `docs/` and `apps/web-ui/public/docs/Hari-Om-TubeOS-Client-Guide.html` (22 Sep) are **out of date**; use only for ideas.

## Chapter file format
One markdown file per chapter in `docs/help-guide/chapters/`, named `NN-slug.md` (your assigned names). Exactly these sections, in this order (skip a section only if truly empty):

```
# <Chapter title>

> **What it is:** one sentence.
> **Who uses it:** roles.
> **Where:** Sidebar > Group > Page  (route like /sales-orders)

## At a glance
3 to 5 bullets: the big things to know.

## The flow
A flow block (syntax below). One or more. Then 1-3 sentences explaining it.

## Screen tour
For each important screen/state:
![Alt: what the screenshot shows](../screens/<file>.jpg)
*Figure: 1-2 sentences describing the screen in words (so a text-only reader sees it).*
Then a numbered list "What you see": 1. **Label**: what it is and what it means. (Numbered by region, top to bottom, left to right.)

## Step by step
### How to <task>
Numbered steps. Each step = one action and its result. Include the roles who can do it, and what the system checks.
(One "How to" per real task. Be complete: create, edit, approve, reject, cancel, print, export, undo/correct.)

## Rules the system enforces
Bullets: every validation, block, warning, auto-calculation, and the exact message or reason code where you know it. Say whether a rule BLOCKS, only WARNS/FLAGS, or is automatic.

## Sample
A worked example with real-looking values (a small table, or a short story: "Sharma Tubes orders 5,000 pcs ... "). Show inputs and outputs.

## Common questions
**Q: ...?** A: ... (5-10 per chapter: things users really get stuck on, "why can't I...", "what does <status> mean", "how do I fix a mistake").

## Related chapters
Bullets linking to other chapters by title.
```

## Flow block syntax (rendered as a diagram, and read as text by the bot)
A fenced block with language `flow`. Optional `title:` line, then one or more chains. Steps are separated by `->`. A step may carry a role tag in square brackets and a short note in parentheses. A branch is written as a second chain starting with `after <step name>:`.

````
```flow
title: Order to dispatch
Create order [Sales] -> Approve [Owner/Admin] -> Release [Sales] (job cards are made) -> Plan [Planner] -> Run stages [Operator] -> QC [QC] -> Pack and dispatch [Dispatch]
after Approve: Reject [Owner/Admin] -> Back to Draft [Sales]
```
````
Keep each chain to 3-8 steps; step names short (1-4 words). Draw the real sequence, including the loops and branches users meet (reject, hold, rework, revise).

## Images
- Reference screenshots with relative path `../screens/<name>.jpg` and ALWAYS write the italic `*Figure:*` description line under it.
- Only use screenshots that exist (list the folder). Use 2-6 per chapter. Do not use `dashboard-dark` or `appearance` outside the Appearance chapter.
- If a key screen is missing (a dialog, a state), do not invent it: describe it in words under the nearest figure and list it under "Missing screenshots" in your final report.

## Quality bar
- A new operator must be able to do the task from your chapter alone. A manager must be able to see what the system enforces.
- No filler, no repeated paragraphs between chapters (link instead). Aim for 900-2000 words per chapter; bigger modules may split into two chapters.
- Facts only: field names, statuses, buttons, rules must exist in the app. Check the code for statuses, reason codes, roles and numbering formats.
- Do not mention internal things users never see (commit SHAs, DB names, service ports, test data).
- Do not use Markdown tables with more than 6 columns. Tables are fine for samples and field lists.
- Final report to the coordinator: list of files written, "Needs confirmation" items, "Missing screenshots". Keep it under 200 words.
