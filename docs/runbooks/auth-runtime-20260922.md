# Authentication runtime acceptance — 22 September 2026

## Supported candidate

The candidate container runtime is CPython **3.12.14**, pinned to the official multi-platform `python:3.12.14-slim-bookworm` image digest `sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e`. The main ERP image and TinyPod image merge that interpreter into their existing Node image and assert the exact patch version before building the service environment. The standalone auth image uses the same base.

Do not substitute the distro Python 3.11 interpreter. The isolated auth workload repeatedly crashed on Python 3.11.2 and 3.11.16; an earlier native 3.11 runtime also crashed. The same application dependencies on Python 3.12.14 passed the direct and BFF workloads below. This establishes a tested runtime mitigation, not a proven upstream root cause or unlimited-load guarantee.

Pydantic is pinned to 2.13.5 in the combined requirements. Pydantic, SQLAlchemy, bcrypt, AnyIO and HTTP parser diagnostic changes alone did not resolve the Python 3.11 crash. Those diagnostic versions are not the selected fix. The debug allocator/GDB runtime also eventually crashed and must not be used as a production workaround.

## Evidence

- Identical direct HTTP control on fresh Python 3.11.16: process exited 139 after 853 successful requests, with 12 disconnected workers.
- Python 3.12.14: 3,840 successful direct authenticated requests; then 19,200 successful requests across 12 workers in a longer run.
- Python 3.12.14 through the BFF: 1,920 authenticated requests passed.
- The committed acceptance probe repeats the BFF check and returns a nonzero exit status for failures or incomplete work. It restricts the target to localhost and reads credentials from a private fixture file.

```bash
python3 scripts/verify_auth_concurrency.py \
  --base-url http://127.0.0.1:25000 \
  --fixture reports/browser_e2e_fixture_latest.json
```

Use only a disposable isolated test database. Sign-in audit rows are created; the probe does not change business records. Do not copy fixture credentials into release archives or test logs. The fixture is excluded from the Docker build context.

## Release gates

A successful dependency build is not complete image or live acceptance. Require all of:

1. Complete container image build/export, interpreter assertion and service imports on the deployment architecture.
2. Service regressions and a complete signed-in browser run on the exact candidate; preserve interrupted and failed runs separately.
3. Auth concurrency acceptance on the normal allocator, followed by real-role sign-in/session/plant/permission checks.
4. The existing database migration, procurement backfill, backup/restore and same-order workflow gates.
5. Adequate host and container storage before build/export. A September 22 run stopped when the Mac disk filled and Docker storage became read-only; that result is not a completed browser run or an authentication segfault.

Review the current `reports/flow-20260922/REPORT.md` and machine-readable evidence before release. No AWS deployment is established by these local checks.
