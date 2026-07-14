# Hari Om ERP — AWS Production Completion Report

**Completed:** 15 July 2026 (IST)  
**Live URL:** https://35-154-224-14.sslip.io  
**AWS region:** Asia Pacific (Mumbai), `ap-south-1`  
**Compute:** EC2 `t4g.medium` — 2 vCPU, 4 GiB RAM  
**Instance:** `i-06ce9a80ff0d8ee68` in `ap-south-1a`  
**Storage:** 38 GiB root EBS, 30% used at final verification

## Release decision

**GREEN for the requested production scope.** The reviewed application and infrastructure fixes are deployed on the replacement AWS host. The live readiness endpoint reports every required service `UP`; TLS, redirects, security headers, backup, restore drill, monitoring agents, database scope, authenticated flows, and mobile layouts were verified against the public AWS deployment.

This release contains the requested Railway user, master, specification, and reference data. It intentionally contains no migrated sales, purchase, production, dispatch, stock movement, opening-stock, or reconciliation transactions.

## Restored data proof

- Users: 6; roles: 8; permissions: 19; plants: 3.
- Customers: 23; suppliers: 21; machines: 14; mandrels: 14; tube sizes: 56; tools: 54.
- Paper masters: 10; adhesives: 3; parchment colours: 120; parchment vendors: 5.
- Specification sheets: 3; recipe headers: 3; recipe layers: 42; dynamic specification values: 177.
- Inventory locations: 6; item masters: 8; inventory quality templates: 21.
- Migrated notifications and historical tool-usage logs: 0; these non-master records were removed from the production scope.
- Sales orders, dispatches, production jobs/job cards, purchase orders/receipts, stock batches/transactions, opening loads, reservations, certifications, carry-forwards, and monthly reconciliation records: 0, as intended by the migration scope.

## Application and business-flow closure

- Plant CRUD is authenticated; Owner/Admin writes are enforced using the effective acting-session role.
- Dispatch sealing uses durable idempotency and recoverable checkpoints across production, inventory, and sales.
- Reservation create/release/consume is connected through BFF and UI.
- Purchase plant selection no longer sends the invalid `ALL` write scope.
- Analytics and Customer 360 use canonical source APIs and surface upstream failures instead of synthetic zeroes.
- Stock close, physical certification, variance posting, carry-forward, opening stock, and monthly reconciliation math are covered by regression tests; carry-forward does not double-post inventory.
- Dispatch documents use controlled plant/customer legal master data and block sealing when required identity is missing.
- Password policy, login rate limiting, production cookie flags, acting-role controls, CSP, and permissions policy are enabled.
- BFF production import coverage now loads every router; the missing session-claims dependency found during the replacement-host start was fixed and regression-tested.

## Verification evidence

- Backend regression: 187 passed across BFF, auth, master, spec, sales, inventory, production, and analytics.
- Web regression: 34 passed; dependency audit: 0 vulnerabilities.
- Lint: 0 warnings/errors; TypeScript: passed.
- Production Next.js build: 102 routes generated successfully on both Mac and ARM EC2.
- Public readiness: HTTP 200 with auth, masterdata, spec, production, inventory, analytics, and sales all `UP`.
- Public TLS: valid certificate; raw IP HTTP redirects permanently to HTTPS.
- Security headers: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy present.
- Unauthenticated plant GET and POST: both HTTP 401.
- Authenticated Owner checks: `/api/auth/me`, plants, owner analytics, and ALL-plant stock statement returned HTTP 200.
- Mobile 390 px checks: Owner, Purchase, Stock Control, Reservations, Reconciliation, Reports, and Plants have no document-level horizontal overflow. Final Stock Control measurement: client width 390, scroll width 390, zero console warnings/errors.

## Recovery and operations proof

- Latest Railway-era backup was checksum-verified and all seven databases restored into the production PostgreSQL volume.
- A new post-cleanup backup was uploaded with server-side encryption to S3 at `database/20260714T204441Z/hariom-erp-20260714T204441Z.tar.gz`.
- The new backup was checksum-verified and restored into an isolated PostgreSQL drill container; all seven databases passed.
- Backup, restore-drill, and health-metric systemd timers are enabled.
- Amazon CloudWatch Agent is installed, configured, and active.
- Docker base artifacts are pinned by immutable digest for Node, PostgreSQL, and Caddy.
- Repeatable first-boot secret generation and latest-backup production restore scripts are committed.

## Privacy and access closure

- Only the Mac's public SSH key was uploaded to CloudShell.
- EC2 Instance Connect granted that public key for approximately 60 seconds; it was not persisted in `authorized_keys`.
- The private SSH key never left the Mac.
- The short-lived browser verification token and local temporary response files were deleted after testing.
- No saved password was read or changed.

## Final operating notes

- Use https://35-154-224-14.sslip.io until a permanent domain is selected.
- The first real transactional entries should follow normal approvals; do not seed demo transactions into production.
- Because this is a cost-controlled single-node design, S3 backup, restore-drill, route health, disk, memory, and EC2 alarms are the recovery controls. The scheduled restore drill must remain green.
