# ERP System Testing Guide

## Quick Start

### 1. Start All Services
```bash
cd "/Users/devarshthakkar/Documents/Hari Om Paper"
./start_all.sh
```

### 2. Stop All Services
```bash
cd "/Users/devarshthakkar/Documents/Hari Om Paper"
./stop_all.sh
```

## Service URLs

- **Web UI**: http://127.0.0.1:13000/login
- **Main API (BFF)**: http://127.0.0.1:14000/health
- **Auth Service**: http://localhost:18001
- **Master Data**: http://localhost:18002
- **Spec Service**: http://localhost:18003
- **Production**: http://localhost:18004
- **Inventory**: http://localhost:18005
- **Analytics**: http://localhost:18007
- **Sales**: http://localhost:18008

## API Documentation

- **Swagger UI**: http://127.0.0.1:14000/docs
- **ReDoc**: http://127.0.0.1:14000/redoc

## Testing the System

### 1. Health Check
```bash
curl http://localhost:14000/health
```

### 2. Login as Admin
```bash
curl -X POST http://localhost:14000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "release.admin@hariom.com", "password": "admin123"}'
```

### 3. Get Users
```bash
# First login to get token
TOKEN=$(curl -s -X POST http://localhost:14000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "release.admin@hariom.com", "password": "admin123"}' | \
  jq -r '.access_token')

# Get users
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:14000/api/auth/users
```

### 4. Check Plants
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:14000/api/auth/plants
```

### 5. Create Sales Order
```bash
curl -X POST http://localhost:14000/api/sales/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Plant-ID: 00000000-0000-0000-0000-0000000000a1" \
  -d '{
    "customer_id": "00000000-0000-0000-0000-000000000001",
    "order_date": "2026-03-19",
    "delivery_date": "2026-03-25",
    "items": [
      {
        "item_id": "00000000-0000-0000-0000-000000000001",
        "quantity": 100,
        "unit_price": 50.00
      }
    ]
  }'
```

### 6. Get Job Cards
```bash
curl -H "Authorization: Bearer $TOKEN" \
  -H "X-Plant-ID: 00000000-0000-0000-0000-0000000000a1" \
  http://localhost:14000/api/production/planning/job-cards
```

### 7. Run Full E2E Validation
```bash
cd "/Users/devarshthakkar/Documents/Hari Om Paper"
source hariom-erp/.venv-direct/bin/activate
python scripts/e2e_hard_cutover_validation.py
```

## Test Users

| Role | Email | Password |
|------|-------|----------|
| Admin | release.admin@hariom.com | admin123 |
| Owner | release.owner@hariom.com | owner123 |
| Plant Manager A | release.plantmanager.a@hariom.com | managera123 |
| Plant Manager B | release.plantmanager.b@hariom.com | managerb123 |
| Planner A | release.planner.a@hariom.com | plannera123 |
| Production A | release.production.a@hariom.com | productiona123 |
| Store A | release.store.a@hariom.com | storea123 |
| Dispatch A | release.dispatch.a@hariom.com | dispatcha123 |
| QC A | release.qc.a@hariom.com | qca123 |
| Sales Maker A | release.salesmaker.a@hariom.com | salesmakera123 |
| Sales Approver A | release.salesapprover.a@hariom.com | salesapprovera123 |

## Common Workflows

### 1. Complete Sales to Production Flow
1. Login as Sales Maker → Create Sales Order
2. Login as Sales Approver → Approve and Release Order
3. Login as Planner → Create Job Card from Released Order
4. Login as Production → Execute Job Card stages
5. Login as QC → Perform Quality Inspection
6. Login as Dispatch → Create Dispatch

### 2. Check Analytics Reports
```bash
# Get Owner token
OWNER_TOKEN=$(curl -s -X POST http://localhost:14000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "release.owner@hariom.com", "password": "owner123"}' | \
  jq -r '.access_token')

# Get production report
curl -H "Authorization: Bearer $OWNER_TOKEN" \
  "http://localhost:14000/api/analytics/reports/production"

# Get sales report
curl -H "Authorization: Bearer $OWNER_TOKEN" \
  "http://localhost:14000/api/analytics/reports/sales"

# Get plant compare report
curl -H "Authorization: Bearer $OWNER_TOKEN" \
  "http://localhost:14000/api/analytics/reports/plant-compare"
```

## Debugging

### Check Logs
```bash
# Real-time log monitoring
tail -f /tmp/bff.log &
tail -f /tmp/production.log &
tail -f /tmp/sales.log &
tail -f /tmp/analytics.log &

# Check specific service logs
cat /tmp/auth.log | grep ERROR
cat /tmp/production.log | grep ERROR
```

### Common Issues

1. **Port already in use**: Run `./stop_all.sh` first
2. **Database connection error**: Ensure PostgreSQL is running
3. **403 Forbidden**: Check user roles and permissions
4. **502 Bad Gateway**: Check if downstream services are running

### Service Dependencies
```
Auth Service (18001) - No dependencies
Master Data (18002) - Depends on Auth
Spec Service (18003) - Depends on Auth
Production (18004) - Depends on Auth, Master, Spec, Sales, Inventory
Inventory (18005) - Depends on Auth
Sales (18008) - Depends on Auth, Production, Inventory, Spec
Analytics (18007) - Depends on Production, Master, Sales, Inventory
BFF API (14000) - Depends on ALL services
```

## Performance Testing

### Load Test with curl
```bash
# Simple load test
for i in {1..100}; do
  curl -s http://localhost:14000/health > /dev/null
  echo "Request $i completed"
done
```

### Monitor Resource Usage
```bash
# Check memory usage
ps aux | grep uvicorn

# Check port usage
lsof -i :14000
lsof -i :18004
```
