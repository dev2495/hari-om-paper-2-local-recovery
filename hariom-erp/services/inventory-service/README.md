# Inventory Service

## Purpose
Ledger-style inventory tracking for Hari Om Paper ERP.

## Philosophy

### Transaction-Based
Every stock movement = one transaction
- **INWARD**: Stock received (+)
- **ISSUE_PRODUCTION**: Stock issued to production (-)
- **PRODUCTION_RETURN**: Stock returned from production (+)
- **FG_INWARD**: Finished goods produced (+)
- **DISPATCH**: Goods dispatched to customer (-)

### Computed Balances
**Never store hard balance. Always compute.**

```
Balance = SUM(qty_change) for all transactions
```

**Why?**
- No sync issues
- Full audit trail
- Simple to debug
- Scalable

### Simple Design
- No WIP tracking (handled by Production Service)
- No stage-wise inventory
- No real-time complexity
- Pure accounting

## How It Works

### Example Ledger
```
Transaction 1: INWARD +500 kg (Purchase)
Balance: 500 kg

Transaction 2: ISSUE -100 kg (Production Job #123)
Balance: 400 kg

Transaction 3: FG_INWARD +1000 pcs (Production Job #123)
Balance: 400 kg + 1000 pcs

Transaction 4: DISPATCH -500 pcs (Sale)
Balance: 400 kg + 500 pcs
```

### Stock Calculation
All balances computed in real-time:
```python
item_balance = SUM(transactions.qty_change)
batch_balance = SUM(transactions.qty_change for batch)
```

## Database Tables

### item_master
What we stock:
- Papers (230 GSM, 301 GSM, etc.)
- Adhesives (TL4, Alcosol)
- Parchment
- Finished Goods (tubes)

### stock_batch
Batch/lot tracking:
- Reel barcodes
- Adhesive drums
- FG lots

### stock_transaction ⭐
The ledger:
- All movements recorded here
- Running balance computed
- Full history preserved

## API Endpoints

### Items
- `GET /items` - List items with balances
- `POST /items` - Create item (Admin)

### Inward (GRN)
- `POST /inward` - Record stock receipt

### Issue
- `POST /issue` - Issue to production

### Reel Master (Step 5)
- `POST /reels/inward` - Inward a paper reel
- `GET /reels?status=&plant_id=` - List reels by scope
- `GET /reels/{id}` - Reel detail

### Reel Issues (Step 5)
- `POST /reel-issues` - Issue reel to Plant + Winder + Shift
- `GET /reel-issues?plant_id=&winder_machine_id=&winder=&shift=&issue_date=&status=&issue_ids=&date_from=&date_to=` - List reel issues
- `POST /reel-issues/{id}/close` - Close issue with `consumed_weight_kg`

### Reel Scan Events (Step 6A)
- `POST /reels/{id}/scan` - Log non-blocking scan event (`INWARD_SCAN|ISSUE_SCAN|CLOSE_SCAN`)
- `GET /reels/{id}/scans?limit=&offset=` - Reel scan timeline

### Inventory Valuation (Step 6B)
- `GET /inventory/valuation/summary` - RM/WIP/FG valuation summary (read-only)
- `GET /inventory/valuation/reels` - Per-reel remaining-weight valuation

### FG Inward
- `POST /fg-inward` - Record finished goods

### Dispatch
- `POST /dispatch` - Dispatch to customer

### Ledger
- `GET /ledger?item_id=` - Item history
- `GET /ledger?batch_id=` - Batch history

### Balance
- `GET /balance/{item_id}` - Item balance
- `GET /batch-balance/{batch_id}` - Batch balance
- `GET /all-balances` - All items

## Integration

### Production Service (8004)
When reels issued:
```
POST /inventory/issue
{
  "item_id": "...",
  "batch_id": "...",
  "qty": 100,
  "production_job_id": "..."
}
```

When FG produced:
```
POST /inventory/fg-inward
{
  "item_id": "...",
  "batch_no": "FG-LOT-001",
  "qty": 1000,
  "production_job_id": "..."
}
```

Step 5 reel integration:
```
POST /inventory/reel-issues
{
  "reel_id": "...",
  "winder_machine_id": "...",
  "shift": "A",
  "issue_date": "2026-02-27",
  "issued_weight_kg": 250
}
```

```
POST /inventory/reel-issues/{id}/close
{
  "consumed_weight_kg": 210
}
```

Notes:
- Reel issue is not linked to job card.
- Reel `current_weight_kg` is reduced only at close.
- Reconciliation is analytical in production-service and never blocks production.
- Scan events are observational only and never mutate stock.
- Valuation is read-only intelligence only (no ledger/accounting mutation).
- Cost resolution order: reel `unit_cost` -> item `unit_cost` -> `0.0` with `UNAVAILABLE` in response.

### Dispatch Service (Future)
```
POST /inventory/dispatch
{
  "item_id": "...",
  "batch_id": "...",
  "qty": 500,
  "dispatch_ref": "DIS-001"
}
```

## Security
- JWT required
- Store role: Inward/issue
- Admin: Full access
- Others: Read-only

## Why Not WIP?

Production Service (8004) already tracks:
- Reel → Bamboo flow
- Weight at each stage
- Oven shrinkage
- Bamboo loss detection

Inventory only tracks:
- What's in store
- What's issued
- What's produced
- What's dispatched

**Separation of concerns.**

## Development

```bash
cd services/inventory-service
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:password@localhost:5432/inventorydb
export JWT_SECRET=your_secret
alembic upgrade head
uvicorn src.main:app --reload --port 8005
```

## Docker

```bash
cd hariom-erp
docker compose up -d inventory-service
```

## Seed Data

Pre-loaded items:
- PAPER-230: 230 GSM Paper
- PAPER-301: 301 GSM Paper
- PAPER-351: 351 GSM Paper
- ADH-TL4: TL4 Adhesive
- ADH-ALC: Alcosol Adhesive
- FG-TUBE-110: Paper Tube

Plus 1 sample inward batch:
- REEL-230-001: 500 kg

## Ledger Philosophy

Like a bank account:
- Deposits = Inward
- Withdrawals = Issue/Dispatch
- Balance = Sum of all transactions

Simple. Reliable. Auditable.

---

**Hari Om Paper ERP - Inventory**  
*Transaction-based. Computed balances. Pure accounting.*
