# Hari Om ERP Security Review — 18 July 2026

## Decision

The reviewed source at commit `b133a74` passes the local security and production-flow gates. Browser authentication is now cookie-only, active sessions use rotated 15-minute JWTs, and inactivity ends the session after 15 minutes. The Python and production web dependency audits report zero known vulnerabilities.

## Security changes completed

- Removed JavaScript-readable bearer-token storage and cleans up the former `hariom_access_token` key from existing browsers.
- Login and acting-role responses no longer expose access tokens in JSON.
- Stores base and acting tokens only in `HttpOnly`, `Secure`, `SameSite=Lax` cookies with a 900-second lifetime.
- Rotates a new 15-minute JWT after real user activity; a timer checks idle state but does not silently extend the cookie.
- Returns inactive, expired, or forged sessions to the login page and clears both cookies.
- Adds `Cache-Control: no-store, private` to authentication/session responses.
- Adds an origin and `Sec-Fetch-Site` guard for cookie-authenticated mutations.
- Restricts accepted production hostnames and disables OpenAPI/Swagger/Redoc in production.
- Removes internal wildcard credentialed CORS middleware; browser traffic remains behind the BFF.
- Rejects known public/default JWT secrets in production across every service and removes legacy-secret fallback in production.
- Replaces the vulnerable `python-jose`/ECDSA dependency chain with PyJWT `2.13.0` and upgrades the service framework/runtime pins.
- Adds COOP/CORP response headers and a 10 MB reverse-proxy request-body limit while retaining HSTS, CSP, frame, MIME, referrer, and permissions headers.

## Verification

| Gate | Result |
|---|---|
| Python/BFF/service tests | 200 passed |
| Hard-cutover two-plant workflow | 114 passed, 0 failed |
| Full sales-to-reconciliation cycle | 7 passed, 0 failed |
| Web math/contract tests | 37 passed |
| Help and canonical-route coverage | 112 routes, 18 guides; passed |
| ESLint and TypeScript | passed |
| Next.js production build | 102 routes; passed |
| Python dependency audit | 0 known vulnerabilities |
| Production npm dependency audit | 0 known vulnerabilities |
| Real session rotation probe | JWT rotated; 900-second token TTL; bearer absent from JSON |

## AWS production deployment — 20 July 2026

- Deployed source commit `b133a74` to the dedicated Yash AWS account `982503294277` in `ap-south-1`.
- Live endpoint: `https://35-154-224-14.sslip.io`.
- Public `/healthz` returned HTTP 200 with `auth`, `masterdata`, `spec`, `production`, `inventory`, `analytics`, and `sales` all `UP`.
- The application container was rebuilt and recreated successfully; PostgreSQL remained healthy and was not recreated.
- The production `.env` and PostgreSQL volume were preserved during the source overlay.
- The deployed Caddyfile SHA-256 (`b96f2c24b13874061fdf621dc3b5d63426e8e5b1ea409b6a2fda5d97d22b1c96`) exactly matched the committed local source.
- Public responses include CSP, HSTS, COOP, CORP, frame, MIME, referrer, and permissions-policy headers.
- The public unauthenticated session probe `/api/auth/me` returned HTTP 401 as required.
- BFF Swagger and OpenAPI routes returned HTTP 404 inside the production container; internal service ports remain unexposed.
- EC2 ingress remains limited to HTTP/HTTPS publicly and SSH through the AWS EC2 Instance Connect address range; no personal-IP SSH rule was added.

## Business-integrity security fixes found during the review

- Dispatch fulfillment now locks only the sales-order line, avoiding PostgreSQL's outer-join `FOR UPDATE` failure after inventory posting.
- Dispatch request IDs are treated as globally unique, matching the database constraint; a cross-plant collision returns a controlled conflict instead of a server error.
- Dispatch automation uses the sealed production orchestrator only, preventing a second inventory dispatch posting.
- Inventory location responses use UUID-safe plant serialization instead of failing with a 500 on real rows.
- The dispatch page, operational dashboard, role landing, and system audit use the active plant instead of silently issuing disabled/unscoped queries.

## Residual operating controls

- Keep EC2, S3 backup, restore-drill, disk, memory, and public readiness alarms enabled because this is a cost-controlled single-host deployment.
- Do not place JWTs, database passwords, internal-event tokens, or bootstrap passwords in Git, browser storage, screenshots, or support messages.
- Keep ports for PostgreSQL and internal services private; expose only Caddy on 80/443.
- Review users and plant scopes when staff responsibilities change, and deactivate departed users immediately.
