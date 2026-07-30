# Phase 3 — Binary Path Risk

## Goal

Binary-only diff paths reach the existing risk-domain and checklist rules.

## Tasks

- [ ] Add an unquoted protected binary-path fixture.
- [ ] Add quoted/space-containing binary-path fixtures.
- [ ] Prove current path collection misses the protected binary change.
- [ ] Parse `diff --git` headers as a fallback without regressing `---/+++` or rename handling.
- [ ] Preserve a genuine top-level `b/` path.

## Verification

Acceptance patterns A2 + A5:

```bash
bash hooks/tests/classify-diff-risk.test.sh
bash hooks/tests/classify-diff-risk-filename-space.test.sh
```
