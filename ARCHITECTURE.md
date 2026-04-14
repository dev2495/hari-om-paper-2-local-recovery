# Hari Om ERP Architecture

## Purpose

This repository runs the local Hari Om Paper ERP stack that was rebuilt from surviving source, SSD backups, runtime artifacts, and Codex session history.

The immediate goal is stability:

- keep the direct local runtime bootable on the original ports
- keep the web UI and BFF aligned with the recovered microservices
- keep master-driven manufacturing flows, especially the specification sheet, documented inside the repo

## Runtime Topology

The local direct runtime is started by `start_all.sh` and delegates into `hariom-erp/scripts/direct/start.sh`.

Primary ports:

- web UI: `13000`
- BFF API: `14000`
- auth service: `18001`
- masterdata service: `18002`
- spec service: `18003`
- production service: `18004`
- inventory service: `18005`
- analytics service: `18007`
- sales service: `18008`

The browser talks to the Next.js web UI. The web UI talks to the BFF on `14000`. The BFF fans out to the individual FastAPI services.

## Main Apps

### `apps/web-ui`

Next.js App Router frontend.

Key responsibilities:

- login and plant-aware session shell
- dashboard, analytics, reports, planner, inventory, dispatch, job cards
- specification sheet workspace with recipe suggestion, notch tooling, and packing handoff

Key files:

- `apps/web-ui/app/(dashboard)/layout.tsx`
- `apps/web-ui/components/specs/SpecSheetDocument.tsx`
- `apps/web-ui/components/specs/NotchDiagramPanel.tsx`
- `apps/web-ui/components/specs/spec-sheet-utils.ts`

### `apps/bff-api`

Python BFF layer that normalizes routes used by the frontend and proxies to the service tier.

Key responsibility:

- keep frontend route expectations stable while backend services remain split by domain

## Services

### Auth Service

Owns users, plants, roles, and JWT issuance.

### Masterdata Service

Owns:

- papers
- adhesives
- parchments
- tube sizes
- mandrels
- customers
- packaging masters
- tooling masters

Important recovery note:

- plant scoping depends on alias resolution in `hariom-erp/services/masterdata-service/src/utils/auth.py`
- recovered databases contain mixed plant IDs such as `PLANT-1` and lowercase UUID plant IDs
- alias resolution must therefore include both canonical and lowercase UUID forms

### Spec Service

Owns:

- specification records
- recipe versions and layers
- spec profile snapshots

The spec profile is the canonical place for recovered UI-level manufacturing details that do not map cleanly to first-class columns yet.

### Production Service

Owns:

- planning board
- job cards
- stage assignment and output
- reconciliation summaries

### Inventory Service

Owns:

- inward
- issue
- ledger
- reel and lot traceability

### Sales Service

Owns:

- sales orders
- approvals
- release state

### Analytics Service

Owns:

- dashboard aggregates
- production, inventory, loss, dispatch, and sales analytics endpoints

## Data Flow

Typical specification flow:

1. User opens `/specifications/new`
2. Web UI loads masters from BFF-backed endpoints
3. User selects customer, tube size, mandrel, papers, adhesives, notch setup, and packing masters
4. UI derives manufacturing preview values locally
5. Save writes spec columns plus a richer `profile` snapshot
6. Recipe layers are persisted as the trial recipe structure

Typical production flow:

1. Sales order is approved and released
2. Production planner builds job cards and stage queues
3. Job card truth drives material issue, output, reconciliation, packing, and dispatch

## Current Recovery Constraints

- The stack is not a verified byte-for-byte April 10 snapshot.
- It is a source-grounded recovery from surviving local artifacts.
- Business logic for the spec sheet is partly recovered from March Codex session prompts and partly from surviving code.
- Some surfaces still need fidelity work to match the last polished UI exactly.
