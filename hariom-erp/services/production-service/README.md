# Production Tracking Service

## Purpose
EOD (End-of-Day) job card digitization for production tracking in Hari Om Paper ERP.

## Philosophy

### NOT Real-Time MES
This service is **NOT** a Manufacturing Execution System:
- ❌ No real-time scanning
- ❌ No machine-level logging
- ❌ No complex WIP tracking
- ❌ No coil-level tracking

### EOD Job Entry
Instead, we follow **shift summary accounting**:
- ✅ Operator fills physical job card during shift
- ✅ At end of shift, data is entered into system
- ✅ System automatically calculates all metrics
- ✅ Management reviews reports and variances

## How It Works

### Physical Job Card → Digital

**Operator records on physical card:**
- Date and shift
- Spec and recipe used
- Reels consumed (barcodes)
- Bamboo quantity produced
- Oven weight in/out
- Tubes produced
- Scrap counts
- Quality measurements (CS)

**System automatically calculates:**
- Oven shrinkage %
- Tubes per bamboo
- Material efficiency
- **Bamboo loss detection** ⭐
- Variance vs expected

### Bamboo Loss Detection ⭐ (CRITICAL FEATURE)

**The Problem:** Bamboos get lost in production process

**The Solution:** Weight-based detection

```
Logic:
1. Expected weight = bamboo_qty × 15kg (average)
2. Actual weight = oven_output_weight
3. Weight loss = Expected - Actual
4. Missing bamboo = Weight loss / 15kg

Example:
- 100 bamboos produced
- Expected: 1500kg (100 × 15kg)
- Actual oven output: 1425kg
- Loss: 75kg
- Missing: ~5 bamboos (75 ÷ 15)

Alert threshold: >5% loss triggers warning
```

## API Endpoints

### Job Management
- `POST /jobs` - Create job (Production/Admin)
- `GET /jobs` - List jobs (all authenticated)
- `GET /jobs/{id}` - Get job details
- `PUT /jobs/{id}` - Update job (Production/Admin)
- `DELETE /jobs/{id}` - Delete job (Admin)

### Reel Tracking
- `POST /jobs/{id}/reels` - Add reel issue
- `GET /jobs/{id}/reels` - List reels for job

### Reports & Calculations
- `GET /jobs/{id}/shrink` - Oven shrinkage report
- `GET /jobs/{id}/yield` - Yield report
- `GET /jobs/{id}/loss` - **Bamboo loss detection** ⭐
- `GET /jobs/{id}/variance` - Variance analysis
- `GET /jobs/{id}/summary` - Complete job summary

### Step 4 Planning Backbone
- `POST /sales-orders` - Create planning sales order (Owner/Admin/PlantManager/Planner)
- `POST /job-cards` - Create job card from planning sales order
- `GET /planning/queues?stage=WINDER|OVEN|PROCESS|PACKING` - Stage queue (owner/admin supports `plant_id=ALL`)
- `POST /job-cards/{id}/assign-machine` - Assign compatible machine/sequence to current or future stage (`stage` optional in payload)
- `POST /job-cards/{id}/stage-output` - Enter stage output for any selected stage (`stage` optional in payload, supports optional `reel_issue_ids`)

### Step 5 Reel Reconciliation Foundation
- `GET /reconciliation/winder-shift?plant_id=&winder_machine_id=&shift=&date=YYYY-MM-DD`
  - Advisory-only reconciliation for issued reel weight vs WINDER stage FG/scrap output.
  - No execution blocking, no inventory enforcement.

### Step 6 Loss Classification (Advisory)
- `GET /reconciliation/{job_card_id}/loss-breakup?plant_id=...`
  - Returns issued/consumed/expected/FG/scrap metrics and heuristic bucket split:
    - `EXPECTED_SHRINKAGE`
    - `PROCESS_LOSS`
    - `OPERATOR_VARIANCE`
    - `REEL_QUALITY_VARIANCE`
    - `UNEXPLAINED`
  - Diagnostics include `heuristic_notes`, `inputs_missing`, and `advisory_only=true`.
  - Endpoint never blocks workflow and never mutates execution state.

Step 4 remains non-MES and manual-planner driven:
- No auto-scheduling engine
- No PLC/machine telemetry integration
- No inventory deduction in this step
- Multi-stage pre-planning is supported (planner can pre-plan WINDER/OVEN/PROCESS/PACKING before execution data entry).
- Planning is non-gated: queues do not depend on previous-stage output timing.
- Stage-output is non-blocking on sequence; out-of-order completion is allowed and can be flagged downstream by analytics.
- Reel issue linkage on stage-output is logging-only (`reel_issue_ids` can be empty).
- Reconciliation endpoint computes loss and alert-flag analytically; it never blocks planning/execution.

## Calculation Formulas

### Shrinkage
```
shrink_kg = oven_input - oven_output
shrink_percent = (shrink_kg / oven_input) × 100
```

### Yield
```
tubes_per_bamboo = tubes_produced / bamboo_produced
```

### Bamboo Loss Detection ⭐
```
expected_weight = bamboo_qty × 15kg
weight_loss = expected_weight - oven_output
missing_bamboo = weight_loss / 15kg
alert = loss_percent > 5%
```

### Material Efficiency
```
efficiency = (finished_weight / reel_weight) × 100
```

## Database Schema

### production_job (Main Table)
- Job identification (date, shift, operator)
- Foreign keys (spec_id, recipe_id, mandrel_id)
- Raw material (total_reel_weight_issued)
- Bamboo stage (qty, scrap, weight)
- Oven stage (input/output weight)
- Finishing (tubes, scrap, finished_weight)
- Quality (actual_cs)
- Notes

### reel_issues (Reel Consumption)
- job_id (FK)
- reel_barcode
- weight_used

## Business Rules

### Who Can Create Jobs?
- Production role: Create and update jobs
- Admin: Full access including delete
- Others: Read-only (view reports)

### Data Entry
- All weight fields required
- Scrap defaults to 0
- CS optional (for trial jobs)

### Calculations
- Automatic on API call
- No stored calculated values
- Real-time computation

## Security
- JWT authentication (shared secret)
- Role-based access
- All endpoints protected

## Integration
- References spec-service (spec_id, recipe_id)
- References masterdata (mandrel_id)
- No cross-service calls (UUID references only)

## Sample Data
Pre-loaded with 1 sample job:
- Date: Today
- Shift: Day
- Operator: John Doe
- 120 bamboos → 1000 tubes
- Reels: 4 reels × 450kg
- CS: 520N

## Development

```bash
cd services/production-service
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:password@localhost:5432/productiondb
export JWT_SECRET=your_secret
alembic upgrade head
uvicorn src.main:app --reload --port 8004
```

## Docker

```bash
cd hariom-erp
docker compose up -d production-service
```

## Weight-Based Accountability

This service focuses on **weight accountability** rather than quantity tracking:

1. **Input Accountability**: Reel weight issued
2. **Process Accountability**: Oven shrinkage
3. **Output Accountability**: Finished weight
4. **Loss Detection**: Missing bamboo calculation

By tracking weight at each stage, we can:
- Detect material loss
- Identify process inefficiencies
- Compare actual vs expected
- Hold operators accountable

## Why Not Real-Time?

Real-time MES systems require:
- Barcode scanners at every station
- Machine integration (PLCs)
- Complex data synchronization
- High infrastructure cost

EOD approach:
- Simple data entry
- Batch processing
- Lower infrastructure
- Focus on summary metrics
- Easier adoption by operators

## Next Steps

Future enhancements:
- Bulk job entry (multiple shifts)
- Production dashboards
- Operator performance reports
- Trend analysis
- Integration with payroll (piece-rate)

---

**Hari Om Paper ERP - Production Tracking**  
*Simple. Effective. Weight-accountable.*
