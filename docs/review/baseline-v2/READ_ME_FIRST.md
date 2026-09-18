# Recovered original Hari Om V2 acceptance source

Recovered on 18 September 2026 from the original HARI_OM_FUNCTIONAL_AUDIT_PACKAGE_V2.zip, also preserved byte-for-byte inside the previous HARI_OM_GO_LIVE_REVIEW_PACKAGE.zip under prior_handoffs/. This is NOT a newly reconstructed requirement list.

## Contents and integrity

REQUIREMENTS_V2.json contains 56 unique requirements. ACCEPTANCE_TESTS_V2.json contains 192 unique acceptance scenarios. All requirement/test cross-references resolve. The seven extracted original documents match their original SHA-256 manifest. RECOVERY_VERIFICATION.json records the file hashes and archive provenance. ORIGINAL_SHA256_MANIFEST.json also names files that remain only in the full original archive, not in this focused recovery ZIP.

## Important status distinction

The original documents preserve their planning-time NOT_STARTED / NOT_RUN statuses. These are NOT a fresh verdict on subsequent implementation. Keep the originals immutable, and record the current results in a separate evidence overlay keyed to each original ID. Preserve the additive RR01-RR36 cases. Do not discard valid recent test evidence, relabel all original cases PASS, or require needless reruns solely because the baseline is historically NOT_RUN.

These are detailed acceptance definitions, not an executable test runner. Map them to the real automated tests and explicit human UAT procedures. Use exact tested source/build/image identities and retained evidence. A handoff/package validator is not an application test.

## Agent import

Copy the non-secret original requirements/tests and relevant plans into an appropriate versioned documentation directory (for example docs/review/baseline-v2/). Inspect ignore rules and fix only the specific document exclusion. Never broadly force-add .env files, databases, runtime passwords, browser authentication state or private traces.

Update V2_PACK_PROVENANCE.md to identify this recovered source and its archive hash. Reconcile it with ACCEPTANCE_MAPPING.md and earlier RR evidence, marking each current case PASS with evidence, FAIL, BLOCKED, NOT_RUN, or explicitly scoped out with owner-approved rationale in the overlay. New evidence must not alter the historical original documents.

## Boundary

The recovery operation changed no repository, application, database, provider configuration or deployment. It only extracted original files and checked archive/file integrity and register structure.
