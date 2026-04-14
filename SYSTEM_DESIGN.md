# Hari Om ERP System Design

## Design Goals

- master-driven data entry instead of free text wherever possible
- job-card truth as the operational backbone
- spec sheet as the bridge between sales intent, recipe logic, manufacturing setup, and dispatch handoff
- keep formulas explicit and visible in the UI so operators do not need external spreadsheets for the main flow

## Specification Sheet Design

The specification sheet is intended to be a compact production workspace, not a generic CRUD form.

### Inputs That Should Stay User-Driven

- customer
- tube size
- mandrel
- required CS
- dry tube weight
- drying loss override
- parchment selection
- candidate paper pool
- adhesive selection and ratio split
- notch setup details
- packing quantities and selected masters

### Values That Should Be Derived

- manufacturing ID from mandrel outer diameter
- manufacturing OD from wall thickness built from recipe rows
- paper target from dry target less fixed adhesive and parchment allowances
- wet weight from dry weight divided by retained-weight factor
- wet weight per mm from wet weight and tube length
- bamboo recommendation from tube length and bamboo constraints
- bamboo wet weight from wet weight per mm and selected bamboo length

### Fixed Material Assumptions

- adhesive base: `15%` of dry tube weight
- parchment base: `1.5%` of dry tube weight
- drying loss default: `9.5%`

Derived paper target:

- `paper_target = dry_weight * (1 - 0.15 - 0.015)`

Wet weight:

- `wet_weight = dry_weight / (1 - drying_loss_percent / 100)`

Wet weight per mm:

- `wet_weight_per_mm = wet_weight / tube_length_mm`

## Bamboo Design

Current rule set:

- bamboo lengths scanned from `1390` to `1560`
- increments of `10`
- fixed cut loss of `40`
- best candidate is the one with maximum tubes per bamboo, then minimum trim waste, then shorter bamboo if tied

## Master-Driven Design

Recovered packaging model:

- box master
- plastic sheet master
- fadda master

Recovered notch/tooling model:

- holder
- blade
- groove
- punch
- tochha
- wider tool
- die

Recovered paper model:

- GSM
- strength type/value
- category
- estimated or stored thickness

## UI Surface Design

The intended spec-sheet layout has four persistent responsibilities:

1. top workspace slab for orientation and global rules
2. main left editing surface with limited direct inputs
3. sticky right preview rail for commercial, manufacturing, recipe, and packing truth
4. notch tooling and packing areas that feed downstream job-card/setup decisions

The page should not duplicate the same value in multiple editable places.

## Plant Scoping Design

Recovered data uses mixed plant identifiers across sources:

- symbolic IDs like `PLANT-1`
- UUID-like IDs such as `00000000-0000-0000-0000-0000000000a1`

Plant-aware queries therefore must resolve aliases rather than rely on one exact string match.
