# Phase 4 — Added-Lines Secret Scan

## Goal

Commit-time secret scanning blocks introduction, not removal, of matching content.

## Tasks

- [x] Plant an existing committed secret-like fixture and stage only its deletion.
- [x] Prove the current hook blocks that deletion.
- [x] Restrict scanning to added hunk content, excluding `+++`.
- [x] Prove adding the same secret remains blocked and redacted.
- [x] Preserve clean commit and unexpected-infrastructure fail-open behavior.

## Verification

Acceptance patterns A2 + A5:

```bash
bash hooks/tests/secret-scan-diff.test.sh
bash hooks/tests/reenabled-blockers.test.sh
```
