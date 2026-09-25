# TubeOS interface conventions

The operating surface is a paper-tube manufacturing workspace: demand, machine capacity, lot identity, measured quantities and controlled handoffs should lead the page. The pearl, ink and teal direction keeps documents legible; brass and semantic status colors identify exceptions without turning the entire application into a warning panel.

## Foundations

Source of truth: `apps/web-ui/app/globals.css`, `app/tubeos.css` and `tailwind.config.js`. Use semantic background/card/foreground/border/primary tokens and signal soft/ink/line pairs. Provide both light and dark values. Do not put a light-only gradient behind semantic text. Charts must retain the same unit and period as the metric they illustrate. Unknown, unavailable and error values must not become zero or an all-clear message.

System typography, tabular numerals and 12px panel radii are the default. The desktop sidebar is 256px, deliberately collapsible to 76px; hover must never resize the workspace. Content padding is 28px on desktop, 20px on tablet and 12px on narrow phones. Main headings scale between 24px and 32px. Dense tables are contained scroll regions, never a reason for document-wide overflow.

## Page purpose and navigation

Use a short task name, one clear description and the actions needed to complete that task. Secondary workspaces belong in grouped navigation. Planning and reconciliation have dedicated route destinations; retain old deep links as compatibility entry points. Keep transient transaction steps inside their own form or dialog. Use the shared PageHeader, panels, query states and pagination components.

Use semantic links for navigation and buttons for actions. Command search and nested navigation inherit their parent workspace permissions. Mobile navigation exposes the role switcher and logout. Authorization remains enforced by server APIs and route gates.

## Interaction and access

Use the existing Radix dialog primitive for focus management, Escape, scroll containment and return focus. Label icon-only actions. Support keyboard entry for scheduling as well as drag/drop. Retain visible focus and reduced-motion behavior. Use deliberate 120-180ms color/size transitions; avoid decorative continuous motion around operational data. Appearance and row-density preferences persist only on the current device.

## Data and scale

Server pagination must return total matching records and stable ordering; summaries must use the full filtered dataset. Keep KG, PCS and other units separate. Store shareable search/status/page state in the URL and reset page on a plant change. Avoid claiming overall system scale from one paginated register. Loading, empty, unavailable, failed, permission-denied and submitted states each need clear feedback.

## Verification and documentation

Check actual authenticated pages in light and dark at desktop, tablet and narrow phone widths. Assert the signed-in shell and expected route so a login redirect cannot pass visual verification. Inspect screenshots for contrast and purpose as well as overflow. Build and restart the candidate before testing, and do not rebuild its output while a browser suite is using it.

Update `lib/guide-content.ts` with user-visible behavior. Regenerate the client handbook using `docs/tools/generate_client_guide.py`. Keep deployment status and remaining acceptance gates explicit in release reports; an attractive screen or healthy endpoint is not full production acceptance.
