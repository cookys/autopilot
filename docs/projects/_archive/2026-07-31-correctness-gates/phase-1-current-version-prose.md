# Phase 1 — Current-Version Prose

## Goal

Historical CHANGELOG justifications cannot permanently bypass the north-star growth gate.

## Tasks

- [ ] Add a fixture with an old justification and none in the current section.
- [ ] Prove the planted case false-greens before the repair.
- [ ] Scope the search from `## v<current>` to the next `## v`.
- [ ] Prove a current-section justification still passes.
- [ ] Prove under-threshold behavior is unchanged.

## Verification

Acceptance patterns A2 + A1:

```bash
bash hooks/tests/preflight-release-routing.test.sh
```
