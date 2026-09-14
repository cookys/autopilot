# Pin store hardening: fsync, orphaned temp files, and re-validation of stored rows

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a report of a `pins.jsonl` lost or corrupted by power loss (not a process kill), a store directory accumulating `.pins.jsonl.tmp.*` litter, or the first consumer that reads the pin store without going through `readPinRows`.
- **Context**: the QC panel (GLM-5.2, 2026-09-11) raised four Suggestion-level items against the v1 pin store, all reproduced at depth 0 and all hardening rather than regressions. (a) `writeSnapshot` does `writeFileSync` → `renameSync` with no `fsync` of the temp file or the directory, so a power loss — not the process-level interruption the spec covers — can still roll the file back; `appendRow` has the same posture, so this is a store-wide question, not a pin-specific one. (b) A SIGKILL inside the write→rename window orphans `.pins.jsonl.tmp.<pid>.<hrtime>`; the `catch → unlinkSync` only cleans thrown errors. Verified: the litter never corrupts `pins.jsonl`, since readers open that path only. (c) `readPinRows` now fails loudly on an unparsable line (v2.36.24) but still does not schema-validate a row it CAN parse, so a hand-edited row with a date in `expires` or a ninth key is read back and persisted through the next snapshot. No CLI input can produce one, and the file is 0600 operator-owned. (d) `listPins` treats `--role ''` as absent and returns everything, matching the existing falsy-option idiom.
- **Effort**: S each; (a) is the only one that changes a shared primitive and should be decided for `jsonl-store.js` as a whole.
- **Source**: depth-0 QC panel on the operator pin store, 2026-09-11.

