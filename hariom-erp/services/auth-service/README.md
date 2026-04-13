# Auth Service

## Purpose
The Auth Service handles user authentication (JWT-based) and Role-Based Access Control (RBAC) for the Hari Om Paper ERP system.

## Key Features
- **Admin-only user registration**.
- **JWT token issuance** with 24-hour expiry.
- **Role Management**: Pre-seeded roles (Owner, Admin, PlantManager, Sales, Planner, Production, Store, QC, and workflow roles).
- **Plant Master**: Auth-owned plant registry (`/plants`) with soft deactivation.
- **User↔Plant Scope**: default plant + optional multi-plant access for owner/admin users.
- **Reusable `require_role` decorator** for protecting endpoints.

## Environment Variables
- `DATABASE_URL`: Connection string for PostgreSQL.
- `JWT_SECRET`: Secret key for signing tokens.
- `JWT_EXPIRES_MINUTES`: Token lifespan (default: 1440).

## How to Run locally (Docker Compose)
From the project root:
```bash
docker-compose up --build
```

## How to Run locally (Bare Metal)
1. Navigate to `services/auth-service`.
2. Create a virtual environment: `python -m venv venv`.
3. Install dependencies: `pip install -r requirements.txt`.
4. Run migrations: `alembic upgrade head`.
5. Start the service: `uvicorn src.main:app --host 0.0.0.0 --port 8001`.

## API Examples

### Login
```bash
curl -X POST http://localhost:8001/auth/login \
     -F "username=admin@example.com" \
     -F "password=admin_pass"
```

### Register (Admin-only)
```bash
curl -X POST http://localhost:8001/auth/register \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"name": "John Doe", "email": "john@example.com", "password": "password123", "role_names": ["Sales"]}'
```

### Get Me
```bash
curl -X GET http://localhost:8001/auth/me \
     -H "Authorization: Bearer <TOKEN>"
```

## Plant APIs

### List Plants
```bash
curl -X GET http://localhost:8001/plants \
     -H "Authorization: Bearer <OWNER_OR_ADMIN_TOKEN>"
```

### Create Plant
```bash
curl -X POST http://localhost:8001/plants \
     -H "Authorization: Bearer <OWNER_OR_ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"code":"PLANT_C","name":"Plant C","address":"New facility"}'
```

### Update Plant (Soft Deactivate)
```bash
curl -X PATCH http://localhost:8001/plants/<PLANT_UUID> \
     -H "Authorization: Bearer <OWNER_OR_ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"is_active":false}'
```

## JWT Claims
Tokens include:
- `user_id`
- `role` (primary role priority: Owner > Admin > others)
- `plant_id` (nullable for owner-all scope)
- `allowed_plants`
- `roles`
- `permissions`
