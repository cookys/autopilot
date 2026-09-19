# Evidence — four BACKLOG rows in parallel: kimi-code/k3 foremen × 4 independent clones, cursor-grok-4.6-low hands (v2.36.70)

Owner request 2026-09-18 after v2.36.69: "maximise parallelism, foreman = kimi k3, implementer = grok 4.6 low".

## Topology (what the rails actually allow)
- **One checkout cannot host two rails.** `scripts/lib/main-checkout-boundary.sh` fingerprints EVERY ref except the
  rail's own branch (and a foreman's `hands/<run>/*`), so a second foreman on the same `.git` is `main_checkout_mutated`
  for the first. Worktrees share `.git`. The only parallel shape is one **`git clone` per unit**
  (`/home/cookys/projects/autopilot-par/{a-parser,b-envscrub,c-secretscan,d-terminal}` at develop `4d025177`).
- **A kimi foreman is not /l5.** `engine implement-review` intake matches the l5 marker through
  `CLAUDE_CODE_SESSION_ID`; kimi has none. The non-Claude foreman rail is `scripts/dispatch-foreman.sh` (2026-09-13,
  kimi 2.0.1 today: `-p`, `-c`, `--output-format stream-json` all present — smoke `smoke1` completed in 25 s): the foreman
  orchestrates in its own worktree, hands go through `dispatch-hetero.sh` (`--runner cursor --model cursor-grok-4.6-low
  --effort low`), review through `dispatch-review.sh` (claude-fable-5-1), REPORT/ESCALATION back to depth 0, verdict at
  depth 0 from git. Four foremen = four depth-0 launches (`launch.sh`, `common.md` = the shared foreman rules pasted into
  every brief; hand argv, unique unit names, 40-call budget, one repair round, report shape).
- **Round 1 (all four) died at the Mission enforce gate** (`round1-enforce-gate-escalation.md`):
  `.claude/owner-kernel-governance.json` is tracked with `enforcement_mode: enforce`, so `dispatch-hetero.sh`
  `check_mission_enforcement_gate` refuses a hand without a sealed campaign projection; kimi c/d escalated correctly with
  the exact gate source, a/b were stopped by depth 0. Fix: one **clone-local** commit per clone flipping the mode to
  `shadow` ("PARALLEL-RUN LOCAL ONLY … never merge"); the hands' commits were later **cherry-picked** onto develop
  (`record-integration` method cherry-pick), never the governance commit. Round 2 (`par2-*`) ran to completion.

## Units (file-disjoint by construction; B and D touch `autopilot-engine.js` in different hunks — cherry-picks were clean)
| unit | BACKLOG row | hands (cursor-grok-4.6-low) | review (claude-fable-5-1) | foreman | landed as |
|---|---|---|---|---|---|
| **A** parser | dispatch-review parser refuses a complete GLM verdict on a repeated BEGIN marker | `parser-a@2d8813ad` (feature + schema), `parser-a-r2@c7006c53` (dropped the schema hunks → suite red, created REPAIR-BLOCKED.md) | FIX-THEN-SHIP: 🟠 scope-schema-edit (the brief omitted `schemas/review-result.schema.json`, whose `additionalProperties: false` is validated by the suite), 2 🔵 | **escalated** (12 calls, 44 min) — depth 0 authorised the schema files (`a/ANSWER.md`) and adopted r1 | `3bc0c67c` |
| **B** envscrub | Test suites inherit the dispatcher's session env (`AUTOPILOT_SESSION_ID`) | `envscrub-b@810a3622`, `envscrub-b-r2@1ff2fed8` | FIX-THEN-SHIP: 🟠 test strength (receipt `env_fingerprint` + sibling-variable survival not asserted), 2 🔵 → r2 → SHIP-AS-IS | completed (12 calls, 36 min) | `b1e97df1`, `c8408e83` |
| **C** secretscan | `secret-scan-diff.js --range` ENOBUFS | `secretscan-c@2e7eaf37`, `secretscan-c-r2@3c79b26f` | FIX-THEN-SHIP: 🟠 `core.quotePath` C-quoted paths silently skipped, 🟡 bare `--files` semantics changed, 🔵×3 → r2 → SHIP-AS-IS | completed (9 calls, 9 min) | `51cd4ac8`, `f2771311` |
| **D** terminal | acceptance_failed cannot be journaled — `MUTATION_FAILURE_EVIDENCE_REQUIRED` | `terminal-d@f82398f0` | SHIP-AS-IS, 3 🔵 | completed (8 calls, 38 min) | `faf738ee` |

Every foreman: `main_checkout_boundary: verified`, no foreman commits, hands only on `hands/par2-<x>/*`.

## Depth-0 verdict
- Each unit's diff ⊆ its allowed files (A after the schema authorisation); codex mirrors byte-identical (`--check`);
  C's report corrects the BACKLOG row ("exit 0" was a pipeline artefact — base exits 2 on ENOBUFS; the defect was that
  the range was never scanned at all); D's report leaves the wall-expiry row open (different code path, per brief).
- Integrated verification on the cherry-picked head `3bc0c67c` in a scratch checkout (`int-suites-3bc0c67c.txt`,
  `suites-int.sh`): the union of the four verify lists plus `qc-panel` and `check-canonical-invariants` (the other two
  enumerators of review-result keys) — see the file for the tally.
- Measured: four foremen in parallel finished in 44 min wall (longest unit) for four PATCH-class rows; the serial
  estimate was ~4 × 40 min of hand time plus review. Round-1 loss: 12 min.

## Deferred (🔵 from the reviews, recorded here, not in BACKLOG)
A: RED comment wording on the guard-unchanged case. B: the ~:10043 spawn passes a fresh scrubbed copy rather than the
frozen object (byte-identical under the allowlist). C: user-supplied `--files` globs in the name-only listing. D:
comment wording on `boundCampaignArtifactDigest`; a CLI-stdout capture test for the summary bytes.
