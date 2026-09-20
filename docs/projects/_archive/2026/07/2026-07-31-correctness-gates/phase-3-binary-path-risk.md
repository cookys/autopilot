# Phase 3 — Binary Path Risk

## Goal

Binary-only diff paths reach the existing risk-domain and checklist rules.

## Design

- Parse quoted `diff --git` paths with Git escape decoding and carry the two paths through a
  NUL-delimited boundary so spaces and control characters survive.
- For unquoted headers, select the sole matching `a/<path> b/<path>` pair instead of splitting
  at the first literal ` b/`; this preserves a genuine top-level `b/` component in the filename.

## Tasks

- [x] Add an unquoted protected binary-path fixture.
- [x] Add quoted/space-containing binary-path fixtures.
- [x] Prove current path collection misses the protected binary change.
- [x] Parse `diff --git` headers as a fallback without regressing `---/+++` or rename handling.
- [x] Preserve a genuine top-level `b/` path.

## Verification

Acceptance patterns A2 + A5:

```bash
bash hooks/tests/classify-diff-risk.test.sh
bash hooks/tests/classify-diff-risk-filename-space.test.sh
```
