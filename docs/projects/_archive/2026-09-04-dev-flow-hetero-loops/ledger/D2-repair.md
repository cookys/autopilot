# D2-repair — foreman ledger (this run, second life)

deliverable: D2-repair
foreman_branch: worktree-agent-a80ee78daa170f2b4
head: b5d3f82e3908ed105cdb1a811a97d7afd60aa47d
base: worktree-agent-ae761c3a47adb6105 @ d0a4b8ec (fast-forwarded in at session start; first
  life's integration of R1 plus its mirror commit and the prior ledger entry), which itself sat on
  feat/dev-flow-hetero-loops @ 24a7283d

## Depth-0 diagnosis carried in (not re-derived)

R1's driver rewrite correctly resolves `dispatch-review.sh` from its own scripts directory unless
`AUTOPILOT_DISPATCH_REVIEW_SCRIPT` is set, but `hooks/tests/hetero-review-loop.test.sh` never
exported that variable, so every `collect` case invoked the real dispatcher and got `no_verdict` on
every seat (85/121 assertions passed, 36 red). Fix routed as a test-side cut, R1b, done directly by
this foreman (no dispatch — it is a diagnosed, scoped test-only repair, not a fresh implementation
task).

## Cuts

| cut | rung | attempt | status | commit |
|---|---|---|---|---|
| R1b (test-side, hand-applied per depth-0 diagnosis) | n/a | 1 | integrated, green | bb4cd830 |
| cut/D2r-R2 | 0 (gemini-3.8-flash-low) | 1 | committed by hands; one test-fixture defect found and hand-repaired, then green | 1006dabd (cut branch) → merged; repair d9dffc09; mirror 6d94af9c |
| cut/D2r-R3 | 0 (gemini-3.8-flash-low) | 1 | committed by hands; one test-fixture syntax bug found and hand-repaired, then green | 25196375 (cut branch) → merged; repair 826ede5b; mirror b5d3f82e |

No cut needed a rung climb — every hands dispatch landed a correct implementation on the first
attempt at rung 0. The three post-integration repairs below were all test-fixture defects the
hands introduced in fixtures they themselves wrote, isolated by running the acceptance suite
directly rather than trusting the hands' own "done" claim (ADR-0001).

### R1b — collect: parser, fail-closed, immutability, trusted dispatcher (test-side repair)
- Exported `AUTOPILOT_DISPATCH_REVIEW_SCRIPT` to the scratch-repo stub by default in test setup;
  kept test 6 (rogue-dispatcher negative control, already present) as the proof that an unset
  variable still falls back to the driver's own directory, never the target repo's checkout.
- Stub JSON fixtures were missing the `verdict` field entirely, which the driver's shape validation
  requires (verdict must be `SHIP-AS-IS`/`FIX-THEN-SHIP`/`null`, not merely absent) — added it.
- `"No issues found."`-style fixtures are non-empty findings text that parses to zero findings,
  which trips the new unconditional fail-closed rule — switched those to an explicit empty string.
- Test 1's four-line-shape fixture had description lines that themselves began with the (lowercase)
  severity word, double-counted by the case-insensitive word-alone matcher — reworded them.

### cut/D2r-R2 — finalize and opt-out: strict validation and binding
Hands correctly implemented: strict findings.json/dispositions validation, pending-chain-entry
requirement, dispositions.json snapshot + sha256 binding in the chain entry, and opt-out
resolved_from sourced from the resolver (not a literal) plus config-path existence check before
hashing. Post-integration repair: case 3 (finalize) reused case 2's `chain.json` by `cp`, but case 2's
successful finalize mutates that file's status to `finalized` in place — the new pending-chain-entry
rule correctly rejected the reused (already-finalized) fixture. Gave case 3 its own fresh pending
chain entry instead of copying case 2's post-finalize artifact. 131/131 assertions green after the
repair (up from 129/131).

### cut/D2r-R3 — check-phase-review-receipt.js re-derivation, plan-rubric-scaffold exclusive create
Hands correctly implemented: mandatory `--phase-base` anchor compared against the chain's own first
entry (never the receipt's own claimed field), re-derivation of the aggregate verdict and
open_findings from findings.json + the dispositions.json snapshot (with sha256 re-verification),
opt-out provenance/digest re-derivation, plan-artifact-mode shape validation, 64 MB git-diff
maxBuffer, and `plan-rubric-scaffold.js` exclusive-create (`wx`) semantics with exit 2 on collision.
Post-integration repair: case 5 (tampering negative control) in the test file had a stray unescaped
double-quote inside a heredoc-built receipt (`\"dispositions_sha256\": "$P5_DISP_SHA\"`), which
broke bash's own heredoc parsing so the whole test file failed to load — fixed the escape. 20/20
assertions green after the repair.

## Acceptance (DONE line, run in full after final integration)

- `bash hooks/tests/plan-rubric-scaffold.test.sh` — **PASS**, 19 assertions.
- `bash hooks/tests/hetero-review-loop.test.sh` — **PASS**, 131 assertions.
- `bash hooks/tests/check-phase-review-receipt.test.sh` — **PASS**, 20 assertions.
- `node scripts/check-js-syntax.js` — **PASS**, 601 files.
- `node scripts/doc-drift-gate.js` — **PASS** (links, fences, script-refs).
- `bash scripts/check-canonical-invariants.sh` — **PASS**, all invariants hold.
- `bash scripts/sync-codex-plugin-skills.sh --check` — **PASS**, in sync (two mirror commits made
  during this run, one after R2's driver edit, one after R3's).

## Files changed (this run, cumulative on worktree branch since b798eb0f)

- `scripts/hetero-review-loop.js` (R1 carried in + R2 finalize/opt-out)
- `hooks/tests/hetero-review-loop.test.sh` (R1b repair + R2 new assertions + case-3 repair)
- `scripts/check-phase-review-receipt.js` (R3 re-derivation + plan-artifact mode)
- `hooks/tests/check-phase-review-receipt.test.sh` (R3 new assertions + case-5 quoting repair)
- `scripts/plan-rubric-scaffold.js` (R3 exclusive-create)
- `hooks/tests/plan-rubric-scaffold.test.sh` (R3 new assertion)
- `platforms/codex/plugin/scripts/{hetero-review-loop,check-phase-review-receipt,plan-rubric-scaffold}.js`
  (mechanical mirror, two sync commits)

`skills/dev-flow/references/hetero-loops.md` was not touched: it already delegates flag contracts
to each script's own `--help` output rather than hardcoding them, so R3's new mandatory
`--phase-base` flag needed no contract-sentence edit there.

## Open issues

None for D2-repair. All three cuts (R1/R1b, R2, R3) are integrated and the full DONE line is green.

bash_calls_used: ~34 of 40.
handoff: none — deliverable complete.
