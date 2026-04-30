# Admin Landing — Design Spec

**Route.** `/landing/admin` (with redirect from `/` when role = admin)
**Audience.** System administrator. Could be the founder wearing two hats today, but designed for a dedicated admin role tomorrow.
**Promise.** In one screen: *the system is healthy, no data is corrupting, no integration is broken, and here are the levers I have to fix anything that is.*

---

## 1. Why this page exists (and doesn't today)

The current dashboard treats the user generically. Admins have a completely different question: *not "is the business okay" but "is the platform okay".* They need:

- Health metrics (latency, error rate, DB pool, cache, queue depth)
- Integrity signals (orphaned records, schema drift)
- People & sessions
- Background-job status
- Knobs they can pull (clear cache, rebuild index, kick a session)
- Audit trail
- Configuration: feature flags, integrations, API keys

Today: none of this exists in the UI. Admins would have to SSH into the box. That's fine for one founder; not fine for a real installation.

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Admin Console                                       Tue · 21 Apr 2026 · 14:08 IST │
│  System green · 132 ms p95 · 0 critical alerts · 8 active users                    │
│                                          Window [ Last 1h ▾ ]   Env [ prod ▾ ]     │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ HEALTH RAIL                                                                      │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐   │
│  │ STATUS   │ LATENCY  │ ERROR    │ DB POOL  │ CACHE    │ QUEUE    │ STORAGE  │   │
│  │          │ p95      │ RATE     │ in-use   │ HIT %    │ DEPTH    │ USED     │   │
│  │ ● GREEN  │ 132 ms   │ 0.04%    │ 14 / 50  │ 96.2%    │ 7        │ 41 / 200 │   │
│  │ all svc  │ ▂▃▃▄▃▂▃  │ ▂▁▁▂▁▂▁  │ ▃▄▄▅▄▄▃  │ ▇▇▇▆▇▇▇  │ ▂▂▃▂▃▂▂  │ GB ▆▆▇▇  │   │
│  │ up       │ target<200│ target<1%│ healthy  │ healthy  │ healthy  │ 21%      │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ SERVICES — 8 services, 1 row each                                                │
│  ┌──────────────────┬──────┬──────┬──────┬──────┬──────────────┬──────────────┐   │
│  │ SERVICE          │ STAT │ p95  │ RPS  │ ERR% │ LAST DEPLOY  │ ACTIONS      │   │
│  │ bff-api  :14000  │ ● UP │ 132  │ 14.2 │ 0.04 │ 4h ago v0.42 │ logs · restart│   │
│  │ web-ui   :13000  │ ● UP │  48  │  8.1 │ 0.00 │ 4h ago       │ logs          │   │
│  │ planning :18001  │ ● UP │  92  │  3.4 │ 0.10 │ 1d ago       │ logs · restart│   │
│  │ qc-svc   :18002  │ ● UP │  61  │  1.0 │ 0.00 │ 3d ago       │ logs          │   │
│  │ inv-svc  :18003  │ ● UP │  74  │  2.1 │ 0.00 │ 3d ago       │ logs          │   │
│  │ disp-svc :18004  │ ● UP │  58  │  0.8 │ 0.00 │ 5d ago       │ logs          │   │
│  │ recon    :18005  │ ◐ WARN│ 410 │  0.3 │ 1.20 │ 7d ago       │ logs · restart│   │
│  │ ml-stub  :18008  │ ● UP │  22  │  0.1 │ 0.00 │ 12d ago      │ logs          │   │
│  └──────────────────┴──────┴──────┴──────┴──────┴──────────────┴──────────────┘   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ INFRASTRUCTURE — 2-up                                                            │
│  ┌─────────────────────────────────┬──────────────────────────────────────────┐   │
│  │ HOST                             │ DATABASE                                  │   │
│  │ CPU  ████████░░░░░ 38%           │ Connections   14 / 50                     │   │
│  │ MEM  ████████████░ 71%           │ Long queries  2 (>1s in last 5m) ⚠       │   │
│  │ DISK ████░░░░░░░░░ 21%           │ Locks         0                           │   │
│  │ NET  in 4.2 / out 1.8 MB/s       │ Replication lag  0.8s                     │   │
│  │ Uptime 12d 4h                    │ DB size  18.4 GB                          │   │
│  │ Load avg 1m/5m/15m  1.4/1.1/0.9  │ Last backup  03:00 IST today  ✓          │   │
│  └─────────────────────────────────┴──────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ DATA INTEGRITY                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ ✓ All foreign keys consistent (last check 14:00)                          │    │
│  │ ✓ No orphan job_card rows                                                  │    │
│  │ ⚠ 3 release_lot rows missing customer_snapshot — will block analytics      │    │
│  │   [ Show rows ] [ Auto-fix ]                                               │    │
│  │ ✓ Schema migrations: 142 applied, 0 pending                                │    │
│  │ ✓ All API contracts valid (BFF ↔ services)                                 │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ BACKGROUND JOBS                                                                  │
│  ┌─────────────────────┬──────────┬──────────────┬──────────────┬────────────┐    │
│  │ JOB                  │ STATUS   │ LAST RUN     │ NEXT RUN     │ ACTIONS    │    │
│  │ mrp-recompute        │ ● OK     │ 02:00 today  │ 02:00 tmrw   │ run now    │    │
│  │ owner-pack-cache     │ ● OK     │ 14:05 (3m)   │ 14:10        │ run now    │    │
│  │ analytics-rollup     │ ● OK     │ 13:00        │ 15:00        │ run now    │    │
│  │ tracker-dwell-calc   │ ● OK     │ 14:08 (40s)  │ 14:09        │ run now    │    │
│  │ webhook-retries      │ ◐ WARN   │ 14:00 (2 fail)│ 14:15        │ logs · run │    │
│  │ daily-backup         │ ● OK     │ 03:00        │ 03:00 tmrw   │ run now    │    │
│  └─────────────────────┴──────────┴──────────────┴──────────────┴────────────┘    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ ACTIVE SESSIONS                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ Total 8 · Owner 1 · Admin 1 · Planner 2 · Supervisor 3 · Sales 1          │    │
│  │ Yash (owner)        Mac · Chrome   Plant A   since 13:42  [ kick ]        │    │
│  │ Devarsh (admin)     Mac · Chrome   ALL       since 14:00  ← you           │    │
│  │ Priya (planner)     iPad · Safari  Plant A   since 09:10  [ kick ]        │    │
│  │ … 5 more                                                                    │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ QUICK ACTIONS                          │ ◉ AUDIT LOG (last 20)                  │
│  [ Clear cache · all keys ]                │ 14:07 priya  released JC-00428         │
│  [ Clear cache · scoped ▾ ]                │ 14:05 yash   updated SO-002104         │
│  [ Rebuild search index ]                  │ 14:01 system mrp-recompute success     │
│  [ Flush queue · dead letters ]            │ 13:58 admin  cleared cache (analytics) │
│  [ Recompute analytics ]                   │ 13:55 priya  scheduled JC-00427        │
│  [ Reload feature flags ]                  │ 13:42 yash   logged in                 │
│  [ Snapshot DB (manual backup) ]           │ 13:40 admin  enabled flag mrp-v2       │
│  [ Open prometheus → ]  [ Open logs → ]    │ … (shows last 20, [ Open full → ])    │
│                                             │                                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ◉ FEATURE FLAGS                          │ ◉ INTEGRATIONS                          │
│  Flag                          State       │ Service       Status   Last call        │
│  planner-v2                    ● ON        │ Tally         ● OK     2m ago           │
│  mrp-v2                        ● ON        │ WhatsApp      ● OK     14m ago          │
│  analytics-anomaly-engine      ◯ OFF       │ Razorpay      ● OK     1h ago           │
│  printable-jc-a5               ◯ OFF       │ S3 backups    ● OK     11h ago          │
│  dark-mode                     ◯ OFF       │ Sentry        ● OK     30s ago          │
│  [ Manage flags → ]                        │ [ Manage → ]                             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Status banner

Top one-liner. Synthesizes overall health with three claims: *system color · p95 latency · alert count*. Click → opens `/admin/status` (full status page, P1).

### 3.2 Health rail (`KpiCard` reused)

Seven cards. Each has: value, sparkline, target indicator (green if within target, amber if drifting, rose if breached). Sparkline range follows the time window picker.

### 3.3 Services table

One row per service. Columns: name+port, status dot, p95, rps, error%, last deploy, action menu. Restart action is gated by an explicit "Are you sure" modal (services restart in 8s; user is told what cascades).

### 3.4 Infrastructure panels

Two compact panels: Host (CPU/MEM/DISK/NET/uptime/load) and Database (connections/long queries/locks/replication lag/size/last backup).

### 3.5 Data integrity panel

Auto-checked rules. Each row is a check with a result, last-run time, and inline fix. "Auto-fix" runs a server-side rectification routine and shows a diff before committing.

### 3.6 Background jobs table

Each cron / queue worker. Status, last run + duration, next scheduled, actions. "Run now" is fire-and-forget with a toast.

### 3.7 Active sessions

Current logged-in users with role, device, plant scope, login time. "Kick" terminates the session (P1 — needs session store like Redis).

### 3.8 Quick actions

Vertical button stack. **Every destructive action requires a confirm modal** that lists what it will do and impact (e.g., "Clear all cache: ~140 MB, page loads will be slower for 30s"). Non-destructive actions execute immediately with a toast.

### 3.9 Audit log

Tail of recent actions. Most recent at top. Each row: time, actor, verb, object. Click row → opens audit detail with before/after diff. Filter by actor / verb / object on the full audit page.

### 3.10 Feature flags

Toggle list. Server-stored. Toggle = optimistic UI + server confirm + audit entry. Each flag has a description shown on hover.

### 3.11 Integrations

Each connected external service: status dot, last successful call, error if any. Click row → integration detail (config, recent calls, retry).

---

## 4. Data & API

```
GET /api/admin/health
  → { status: 'GREEN', services: [...], host: {...}, db: {...}, integrity: [...], jobs: [...], sessions: [...], integrations: [...] }

GET /api/admin/audit?limit=20
  → [{ ts, actor, verb, object, before, after }, ...]

GET /api/admin/flags  → [{ key, state, description, updatedBy, updatedAt }, ...]
PATCH /api/admin/flags/:key  { state }

POST /api/admin/cache/clear  { scope?: string[] }   → { keysCleared, bytes }
POST /api/admin/index/rebuild  { index: 'jobs' | 'specs' | ... }
POST /api/admin/queue/flush  { queue: 'webhook-retries' | ... }
POST /api/admin/jobs/:name/run-now
POST /api/admin/services/:name/restart
POST /api/admin/sessions/:id/kick
POST /api/admin/db/snapshot
POST /api/admin/integrity/auto-fix  { check: string }

WS  /api/admin/stream  → live ticks for health rail + audit tail
```

**Polling vs streaming.** Health rail + services table use a websocket stream pushing every 2s. Audit log uses websocket too — each new entry slides in. Everything else polls every 30s.

**Permissions.** All `/api/admin/*` endpoints check `role = admin`. Restart, kick, snapshot, clear-cache emit audit entries automatically.

---

## 5. Quick-action confirmations

Every destructive action opens a confirm modal:

```
┌─ Clear all cache? ──────────────────────────────────────────────┐
│ This will invalidate:                                            │
│   • analytics aggregates (~92 MB)                                │
│   • owner pack snapshot (~14 MB)                                 │
│   • MRP run cache (~28 MB)                                       │
│   • spec rendering cache (~6 MB)                                 │
│ Total: ~140 MB                                                   │
│                                                                   │
│ Impact: next page loads will be slower for ~30 seconds while     │
│ caches warm. No data is lost.                                    │
│                                                                   │
│ Audited as: admin · cleared cache (all)                          │
│                                                                   │
│ [ Cancel ]                              [ Yes, clear cache ]     │
└──────────────────────────────────────────────────────────────────┘
```

The same pattern for restart-service (cascading downtime), kick-session (user is logged out immediately), snapshot-db (~30s freeze).

---

## 6. Motion

- Health rail values tick smoothly (use `useCountUp` 250ms).
- New audit entry slides in from top with subtle highlight (200ms hold, then fade to normal background).
- Service status dot transitions: pulse green → solid amber if WARN appears, ring + pulse rose if DOWN.
- Quick action confirms with a soft modal (240ms), success toast bounces in (180ms spring).
- `prefers-reduced-motion` collapses everything to instant.

---

## 7. Accessibility

- Status dots include text label ("UP", "WARN", "DOWN") — never color alone.
- Tables are keyboard-navigable, action buttons reachable via Tab.
- Confirm modals trap focus, Esc cancels, Enter does NOT auto-confirm (admin-grade safety).
- Audit log readable by screen reader as "14:07 Priya released job card JC-00428".
- Toggles for feature flags use proper `<button role="switch" aria-checked>`.

---

## 8. Phasing

**P0 (5–6 days):** Status banner, health rail, services table (status only — no restart yet), infrastructure panels, data-integrity panel (read-only), background jobs (status only), audit log (last 20), quick actions (only "clear cache" + "rebuild index" + "open prometheus"). One websocket stream for health.

**P1 (4–5 days):** Service restart, session kick, integrity auto-fix, run-job-now, quick actions (queue flush, recompute analytics, snapshot DB), feature flags toggle, full audit page.

**P2 (3 days):** Integrations management UI, alerting (route to Slack/email), API key management, RBAC editor.

---

## 9. Trade-offs & revisit

| Decision | Trade-off | Revisit when |
|---|---|---|
| Single websocket for health stream | Simple, one socket per admin tab | Multiple tabs open → use shared worker |
| Audit entries inline on this page | Easy to glance | Audit volume grows — page becomes its own surface |
| Quick actions in a vertical stack | Discoverable, easy to scan | If the list grows past 12, group into accordions by category |
| Auto-fix routines hardcoded server-side | Safest | Allow admin to script fixes — never; kept hardcoded as a guardrail |
| Confirm dialogs everywhere | Slight friction | Don't reduce; admins are one keypress away from breaking prod |
| All metrics from BFF | Couples BFF to admin UI | Stand up a small `/admin-metrics` service that reads Prom + DB directly |

---

## 10. Open questions

1. **Source of truth for metrics.** Are we standing up Prometheus/Grafana, or rolling our own? P0 assumes a thin server-side scraper that returns instantaneous values + 1h history.
2. **Service restart mechanism.** systemd? Docker compose? Will determine whether `restart` is a single API call or a multi-step orchestration.
3. **RBAC.** Today is `admin = god`. Multi-tenant or multi-plant admin scoping?
4. **Backup destination.** S3 already? Encryption keys?
5. **Audit retention.** Keep forever, or purge > 1 year?

Defaults assumed: thin scraper for P0, systemd-style restart, single admin role for P0, S3 with KMS in P1, audit retained 2 years then archived.
