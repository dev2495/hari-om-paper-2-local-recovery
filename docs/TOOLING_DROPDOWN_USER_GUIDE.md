# Tooling Dropdown List - User Guide

**Live system:** https://35-154-224-14.sslip.io/masters/tools

**Users who can maintain lists:** Admin, Owner, and Plant Manager

## Before You Start

1. Sign in with an Admin, Owner, or Plant Manager account.
2. Select a specific plant from the top bar. Do not use **All plants** while editing master data.
3. Open **Masters > Tools**.

## Add a New Dropdown Value

1. Select **Add Tool**, or select **Edit** on an existing tool.
2. Choose one of the five fixed tool categories: **Notch, Blade, Holder, V + Flat, or Punch**.
3. Find the attribute to maintain, such as Type, Design, Degree, Blade Type, or Punch.
4. Select **Manage list** beside that attribute.
5. Enter the new value and select **Add**.
6. The new value is selected automatically. Complete the remaining tool details and select **Save**.

**Example:** To add Degree 65, open a Notch tool, select **Manage list** beside Degree, enter `65`, and select **Add**.

## Rename a Value

1. Open **Manage list** for the attribute.
2. Select the pencil icon beside the value.
3. Enter the corrected value and select **Save**.

The corrected value becomes available anywhere that master list is used.

## Discontinue or Restore a Value

- **Discontinue:** Select **Discontinue** beside the value. It is hidden from new tool and spec-sheet selections, while existing records keep their history.
- **Reactivate:** Open the same **Manage list** and select **Reactivate** beside the discontinued value.

Use Discontinue instead of deleting a value. This preserves old specifications, production records, and traceability.

## Direction, Distance, and Depth

- **Notch Direction** is an editable dropdown. On the lower **Editable Dropdown Registry**, choose category **Notch** and field **notch_direction**. Add, rename, discontinue, or reactivate values there.
- **Notch Distance** is a numeric input on the specification sheet.
- **Notch Depth** is a numeric input on the specification sheet.

Distance and Depth are measurements, so they are entered directly and are not maintained as dropdown lists.

## What Cannot Be Changed

The five tool categories are fixed and cannot be added, renamed, or removed:

1. Notch
2. Blade
3. Holder
4. V + Flat
5. Punch

Users can create any number of tool definitions and physical tool assets under these categories.

## Troubleshooting

- **Manage list is missing or disabled:** Select a specific plant and confirm the account is Admin, Owner, or Plant Manager.
- **Value already exists:** Use the existing value or rename the existing entry. Duplicate values are blocked.
- **A discontinued value is not in a dropdown:** Open Manage list or the registry and reactivate it.
- **A change is not visible immediately:** Close and reopen the tool form, then confirm the correct plant is selected.

## Verified Behaviour

- List, add, rename, discontinue, and reactivate controls are available to client Owner and Plant Manager roles.
- Changes are plant-scoped and feed the corresponding tool and specification-sheet dropdowns.
- Existing historical records remain traceable when a value is discontinued or renamed.
- AWS production accepted a real Owner-role dropdown update after deployment.
