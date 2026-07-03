# 2026-07-04 — Review closeout: 7 verified defects + structural risks R1–R3

**Mode**: CEO L6 (hetero impl + hetero verification authoring; depth-0 orchestration + authoritative qc)
**Branch**: `feat/review-closeout-v2.31.10`
**Target version**: v2.31.10 (PATCH — fixes/hardening, no new skill/agent)

## OKR

Close out every finding from the 2026-07-04 whole-repo review in one release:

- **KR1 — Fix-7**: all 7 verified defects fixed + regression-covered where testable:
  1. `skills/ceo-agent/SKILL.md:236-243` DOA table broken (`Resources 2x+` row orphaned after prose).
  2. `hooks/transcript-reader-lib.js:27` `MAX_LINE_BYTES` 1 MB vs `state-checkpoint-lib.js:16` 5 MB — comment claims "match", values drifted.
  3. `hooks/audit-log.js` reads `/dev/stdin` first (documented-ENXIO path; should be fd-0-first like `failure-escalation.js`) + header says PostToolUse/Bash but wired at `.*`.
  4. `hooks/state-checkpoint.sh.bak` tracked dead file — remove.
  5. `src/engine/resolve-review-loop.js` `REVIEW_LOOP_FIELDS` missing `reviewer_endpoint`/`implementer_endpoint` (v2.31.6 fields).
  6. `findJsonObjectCandidates` / `isImmutableGitSha` / `bufferToString` duplicated verbatim across `src/runners/implementer.js` + `src/engine/resolve-review-loop.js` + `autopilot-engine.js` — consolidate into `src/lib/`.
  7. `scripts/check-test-integrity.sh` ~1,880-line Python heredoc → extract to `scripts/lib/test-integrity-l1.py` (behavior-identical; gains lint/test surface).
- **KR2 — Structural risks**: R1/R2/R3 designs decided by a cross-family engine panel, then implemented:
  - R1 bash↔JS contract dual-write (round-trip test vs schema SSOT).
  - R2 untested fail-closed surfaces: `dispatch-anthropic-review.js` (mock-server), `dispatch-explore.sh`, `preflight-portability.sh`.
  - R3 PostToolUse hook layer: undocumented-CC-internals dependency + O(n²) transcript re-read (smoke probe / multiplexer — per panel).
- **KR3 — l3-l6 sugar evaluation**: panel-informed recommendation (alias vs status quo vs merge) — REPORT ONLY, no restructuring without Board approval.
- **KR4 — Prose optimization**: dev-flow/ceo-agent duplicated blocks + always-loaded token cost reduced per panel decision, WITHOUT extracting forcing functions (skill-refactor rules honored).
- **KR5 — Release**: version bumped, CHANGELOG entry, preflight-release + preflight-portability green, merged to develop.

## Phases

| Phase | What | How |
|-------|------|-----|
| P0 | Fix-7 batch | hetero impl (`engine implement-review`) + hetero verification authoring (different family) + depth-0 qc |
| P1 | Cross-family design panel: R1/R2/R3 + l3-l6 + prose | dispatch design questions to codex + agy + grok (+ MiniMax reviewer where useful); depth-0 synthesis (not majority vote) |
| P2 | Implement R1/R2/R3 per panel decision | /l6 pipeline |
| P3 | Prose optimization per panel decision | /l6 pipeline |
| P4 | l3-l6 recommendation | report in final CEO Report |
| L-5 | finish-flow: qc panel, version, CHANGELOG, merge | depth-0 |

## Scope boundary

- IN: the 7 defects, R1/R2/R3 hardening, prose dedup/optimization, release mechanics.
- OUT (explicit): l3-l6 restructuring implementation (Board decision), task-tree graduation, per-event hook multiplexer FULL implementation if panel sizes it L (then → BACKLOG with trigger), domain routing, anything in BACKLOG not named here.

## Source

2026-07-04 whole-repo review (two Explore agents + depth-0 verification of all 7 defect claims).
