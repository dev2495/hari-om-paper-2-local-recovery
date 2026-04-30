# TinyPod Staging Deployment

This folder runs Hari Om ERP as a temporary client-testing stack on TinyPod:

- `erp-app`: one supervised container for web UI, BFF, and ERP services.
- `postgres`: persistent Postgres container with one database per ERP domain.
- Public exposure: only the web UI on port `13000`.
- Internal API routing: web `/api/*` rewrites to BFF at `127.0.0.1:14000`.

## Cost Target

Use TinyPod hosted compute at `2 CPU / 4 GB RAM / 10 GB storage`.

Expected monthly burn from TinyPod pricing:

- CPU: `2 x $2.00 = $4.00/mo`
- RAM: `4 x $1.50 = $6.00/mo`
- Storage: `10 x $0.05 = $0.50/mo`
- Total: `$10.50/mo`

Top up `$10` first for short testing and add `$5` if the client test needs a full month.

## TinyPod Setup

1. Push the repo to a `staging` branch.
2. In TinyPod, create a Docker Compose project from GitHub.
3. Select `deploy/tinypod/docker-compose.yml`.
4. Set resources on `erp-app` to `2 CPU / 4 GB RAM`.
5. Set storage for Postgres named volume to at least `10 GB`.
6. Add the environment variables from `.env.tinypod.example`.
7. Deploy and use the generated `*.tinypod.app` URL.

If TinyPod only shows the paste-based Compose flow, paste
`deploy/tinypod/docker-compose.remote.yml`. It uses the public GitHub
`staging` branch as the remote Docker build context while keeping Postgres in
the same project.

## Local Dry Run

```bash
cd "Hari Om Paper 2 Local"
cp deploy/tinypod/.env.tinypod.example deploy/tinypod/.env.tinypod.local
# Edit deploy/tinypod/.env.tinypod.local with real local-only secrets.
docker compose --env-file deploy/tinypod/.env.tinypod.local -f deploy/tinypod/docker-compose.yml up --build
```

Smoke test:

```bash
BASE_URL=http://127.0.0.1:13000 \
ADMIN_EMAIL=admin@hariom.com \
ADMIN_PASSWORD="<your-password>" \
bash scripts/tinypod_smoke.sh
```

## Operating Rules

- Use scrubbed/demo data only unless the client explicitly approves otherwise.
- Keep `SEED_DEMO_USERS=false` on public staging URLs to avoid predictable demo credentials.
- Keep secrets only in TinyPod env vars.
- Before destructive testing, use TinyPod backup/export controls or run `pg_dump` from the Postgres container.
- Final on-prem deployment can reuse this compose wrapper, with the same env variables and a company-server Postgres volume.
