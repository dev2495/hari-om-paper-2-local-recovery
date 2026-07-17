# Specification Weight Reconciliation — 125 × 137 × 120 Tube

## Correct governing rule

The 15% material allowance contains **both adhesive and parchment**. Parchment is not added again on top of the 15%.

For a 230.00 g finished-dry target with a 0.910 divisor:

| Step | Calculation | Result |
|---|---:|---:|
| Wet target | 230.00 ÷ 0.910 | 252.75 g |
| Combined additions | 230.00 × 15% | 34.50 g |
| Parchment | 230.00 × 1.5% | 3.45 g |
| Adhesive | 34.50 − 3.45 | 31.05 g |
| Wet paper target | 252.75 − 34.50 | 218.25 g |

With the client recipe, geometric paper mass is 224.61 g. Therefore:

| Reconciliation | Result |
|---|---:|
| Selected paper | 224.61 g |
| Adhesive + parchment | 31.05 + 3.45 = 34.50 g |
| Winding mass | 259.11 g |
| Modeled finished dry at 9% loss | 235.79 g |
| Client scale reading | 232.00 g |
| Scale reading vs model | −3.79 g |
| Scale reading vs 230 g target | +2.00 g (inside 227–233 g band) |

## What the 232 g reading means

The 232 g result is credible, but it cannot be produced by the configured 9% loss and the 224.61 g geometric paper mass at the same time. It implies one of two equivalent reconciliations:

1. Effective total drying loss was 10.46%, not 9.00%; or
2. At the configured 9% loss, actual paper mass was 220.45 g, which is 4.17 g (1.86%) below the master-GSM geometry result.

The remaining difference can come from actual reel GSM, actual wound diameter/tension, adhesive pickup, parchment mass, moisture/conditioning, or scale timing. The ERP must show these as measured-versus-model variances and must not silently rescale paper masters to force a match.

## Data issue found

The live adhesive masters are named `VINSOL/20100`, `ALCOSOL/30100`, and `TL4 LV/21100`, while the recipe screen previously showed legacy labels such as `TL-4 (20100)` and `Vinsol (30100)`. The specification now resolves selections back to the active master by ID/product token and displays the current master name, applied grams, and solid-content reference.

## ERP corrections implemented

- Removed parchment double-counting.
- Corrected the target paper result from 214.80 g to 218.25 g.
- Corrected adhesive from 34.50 g to 31.05 g; parchment remains 3.45 g.
- Corrected the selected recipe from 262.56/238.93 g to 259.11/235.79 g (winding/model dry).
- Added live adhesive component grams to the always-visible recipe summary.
- Added measured finished-dry entry and automatic loss/paper reconciliation.
- Removed the geometry-generated 262 g default target when a tube size is selected.

