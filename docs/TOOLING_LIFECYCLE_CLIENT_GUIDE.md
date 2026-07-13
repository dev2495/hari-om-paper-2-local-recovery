# Tooling Lifecycle - Client User Guide

## What this adds

The ERP now treats tooling as both master data and physical stock:

- The tooling master defines what a tool is and which values may be selected in a specification sheet.
- A physical tool is inwarded like a received item and receives its own asset number and QR value.
- The physical tool can be located, issued to a job card, returned, maintained, sent for grinding, returned from grinding, or scrapped.
- Production usage is recorded against the exact physical tool, so tube output can be traced back to the tool asset.

The five categories are fixed and cannot be changed by users:

1. Notch
2. Blade
3. Holder
4. V + Flat
5. Punch

Users can add and edit tool records and the allowed dropdown values under these categories. A category itself is never created as a new master.

## 1. Set up the tooling master

Open **Masters > Tools**.

### Add a tool definition

1. Select **Add Tool**.
2. Select one of the five fixed categories.
3. Select the department and status.
4. Enter the tool name and the category-specific points.
5. Save.

The tool name and points become the selectable value in the specification sheet. Do not create a second category to represent a variation. Create another tool under the correct category.

### Category points

The master supports the points shown below. The exact visible fields change by category.

| Category | Points maintained in the master |
| --- | --- |
| Notch | Type, thickness, design, degree |
| Blade | Type, thickness, height, length |
| Holder | Thickness, height, length |
| V + Flat | Length, thickness |
| Punch | Punch option |

Notch direction, notch distance, and notch depth are process dropdown values maintained in the editable option registry. They are not additional tool categories.

### Manage dropdown values

In the **Editable dropdown registry** section:

1. Select the fixed category.
2. Select the field.
3. Enter the new allowed value.
4. Select **Add**.
5. Use **Edit** beside an existing value when wording or a measurement needs correction.

Only active values appear in the specification sheet. Retire a value by discontinuing the related master record or removing the value from active use according to the plant procedure. Existing records are retained for history.

## 2. Inward a physical tool

Use the **Inward** action beside the tool definition in the tooling master.

Enter:

- Receipt date
- Quantity received
- Location from the Location Master
- Tool definition and its saved attributes, which are carried into the physical record

When saved, the system creates one physical asset record per quantity. Each record has:

- Asset number, for example `TA-260714-AB12CD34`
- QR value, for example `hariom://tool/TA-260714-AB12CD34`
- Tool category and definition name
- Attribute snapshot at the time of inward
- Current status
- Current location
- Grinding version, beginning at `V0`
- Usage count and produced quantity

Print or label the QR value on the physical tool or its storage label. Scanning or searching the asset number opens the same physical record in the ledger.

### Example: inward two blades

1. Open the **Plain Blade** definition.
2. Select **Inward**.
3. Enter receipt date `14-Jul-2026`, quantity `2`, and location `Tool Rack A`.
4. Save.
5. The system creates two separate assets, for example `TA-260714-001` and `TA-260714-002`.

The two assets share the same definition but have independent status, location, usage, and history.

## 3. Use the physical tool lifecycle

The ledger shows the current status and only the actions that are valid for that status.

| Status | Meaning | Available action |
| --- | --- | --- |
| Available | In store and ready for use | Issue, maintain, grinding out for a blade, scrap |
| Issued | Assigned to a job card and stage | Return |
| Maintenance | Temporarily with maintenance | Complete maintenance |
| Grinding out | Blade sent to grinding | Grinding return |
| Scrap | Permanently removed from use | No issue action |

### Issue to production

1. Search or scan the QR/asset number.
2. Select **Issue**.
3. Enter the job card ID.
4. Select the production stage.
5. Save.

The asset becomes **Issued** and the job card stores the exact physical asset ID. A discontinued tool definition or scrapped physical asset cannot be issued.

### Return from production

1. Find the issued asset.
2. Select **Return**.
3. Confirm the return location if requested.

The asset becomes **Available** again. The prior issue remains in its history.

### Maintenance

1. Select **Maintain** for an available asset.
2. Complete the repair or check outside the issue flow.
3. Select **Complete maintenance** when the asset is usable again.

The asset history records both status changes. Use the remarks field on the event when a reason needs to be captured.

### Blade grinding

Grinding is available only for a **Blade**.

1. Return the blade from production if it is currently issued.
2. Select **Grinding out**.
3. Send the same physical blade for sharpening/grinding.
4. Select **Grinding return** when it comes back.

The system keeps the same asset number and increments the grinding version. Example: `V0` before grinding, `V1` after the first grinding return, `V2` after the second return. This preserves the complete blade history instead of creating a false new blade.

## 4. Record production output against the tool

When a job card is completed, the production completion flow reads the physical tool asset IDs assigned to the stage and records the actual completed output against each asset.

The usage record includes:

- Physical asset number
- Job card and stage
- Completion timestamp
- Produced quantity
- Scrap quantity, where entered
- Operator or completion context
- A unique usage key to prevent duplicate counting if the completion is retried

### Example: blade output trace

1. Blade `TA-260714-001` is issued to job card `JC-2026-014` for the notching stage.
2. The job card completes with `1,200` good tubes and `15` scrap tubes.
3. The completion records these quantities against `TA-260714-001`.
4. The blade is returned and sent for grinding.
5. After grinding return, its version shows `V1`; the next job output is added to the same asset with the new version visible in history.

The resulting report answers: **how many tubes did each physical blade produce, how much scrap was associated with it, how many times was it used, and which job cards used it?**

## 5. Use tools in the specification sheet

Open **Specifications > New Specification**.

### Notch and tooling fields

The notch section contains exactly these eight process fields:

1. Notch type
2. Notching blade
3. Notching holder
4. V + Flat
5. Punch
6. Notch direction
7. Notch distance
8. Notch depth

The first five fields are populated from active tool definitions. Direction, distance, and depth are populated from the editable option registry. Discontinued records are not shown.

Tool points are displayed from the master. They are maintained in the master and are not retyped in the specification sheet.

### Mandrel and tube selection

1. Select a mandrel using the searchable mandrel picker.
2. The tube-size picker becomes active.
3. Only tube IDs within plus or minus 1 mm of the mandrel are shown.
4. Select the required matching tube.

The sheet contains the production calculation and controls needed to complete the specification. Suggestion cards are removed; there is no background suggestion calculation or suggestion action.

## 6. Reports and traceability

Open **Reports > Tooling**.

Use the report for:

- Total physical tool assets
- Available, issued, grinding, maintenance, and scrap counts
- Category-level asset status
- Tool usage count
- Produced quantity per physical tool
- Scrap quantity per physical tool
- Grinding version and lifecycle history
- Current job card assignment

### Finding a customer rejection or production issue

1. Start with the customer order, finished-goods lot, or job card.
2. Open the job card and read the physical tool asset IDs on the completed stage.
3. Open each asset from the tooling ledger.
4. Review the tool's inward record, location, issue/return events, maintenance, grinding versions, and production usage.
5. Compare the produced and scrap quantities with the job-card and QC records.

This gives a forward and backward trace: customer rejection to job card, job card to physical tool, physical tool to inward and maintenance history.

## 7. Daily operating checklist

- Add or update tool definitions before a new tool is used.
- Add new dropdown values in the registry instead of typing uncontrolled values.
- Inward every physical tool quantity and assign a Location Master position.
- Label every asset with its asset number/QR value.
- Issue the exact asset to the job card before production.
- Return the asset after use.
- Use grinding out/return only for blades.
- Complete the production job card so output is recorded against the asset.
- Review the tooling report at shift or month end.
- Discontinue definitions or scrap assets instead of deleting historical records.

## Important control

The master definition and the physical asset are different records. A change to a master affects future selection. It does not erase the saved attribute snapshot or history of physical tools that were already inwarded and used.
