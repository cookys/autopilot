# D5-integration ledger

Foreman branch: `worktree-agent-a50543a80a8180f38` (worktree of `feat/dev-flow-hetero-loops`)
Head at write time: `ed2b705e` (test: re-pin fixtures for D1 review-loop resolver fields)
Base: `feat/dev-flow-hetero-loops`

Stopped early — near the foreman Bash cap (40) after depth-0 confirmed no hands cut was
outstanding to wait on. No `dispatch-hetero.sh` cut was used: root-caused and fixed the two
biggest clusters by direct mechanical fixture re-pin (same shape as precedent 68e142c0 —
add missing fields to a hand-maintained JS object literal / heredoc config, no logic
changes), which is an escalation from the intended hands-dispatch posture, reported here
rather than hidden. 21 of 25 originally-failing files are untouched this pass.

| file | failures before | classification | fix commit / status |
|---|---|---|---|
| autopilot-engine | 41 | drift — validPayload fixture missing `plan_review_resolved_from`, `hetero_review`, `hetero_review_resolved_from`, `consult_resolved_from` | fixed, `ed2b705e` — 470 assertions PASS |
| review-loop-runner | 10 | mixed: object-literal copies (7×) had the same missing-field drift, fixed; but the file's remaining 10 failures are inline raw-JSON-string parser fixtures missing `ladder_start_rung_judgment` (predates D1, verified byte-identical to develop and red there too) | pre-existing on develop, left alone (object-literal drift portion fixed in `ed2b705e`, does not change file-level PASS/FAIL) |
| contract-parity | 8 | pre-existing — `implementer_ladder[17]` from the project-config-template fallback ladder has `effort:""`; reproduced identically on a scratch `develop` worktree | pre-existing on develop, left alone |
| dispatch-contract | 79 | drift — mini-repo fixture `.claude/review-loop-config.md` had no `plan_review`/`hetero_review`/`consult_dispatch`/`discuss_dispatch` lines; new `auto` default expanded a topology `plan_reviewer_runner: codex` that collided with the fixture's `implementer_runner: codex` under the same-runner-dual-seat guard, so the resolver exited 3 before any scenario ran and every check NO-GOed | fixed, `ed2b705e` — 317 assertions PASS |
| dispatch-author-contract | 21 | same drift as dispatch-contract (single fixture block) | fixed, `ed2b705e` — 46 assertions PASS |
| campaign-dispatch-projection | 9 | not investigated | not reached |
| check-phase-review-receipt | 5 | not investigated | not reached |
| autopilot-cli | 6 | not investigated | not reached |
| context-window | 1 | not investigated | not reached |
| dispatch-detached-campaign-authority | 5 | not investigated | not reached |
| dispatch-contract-artifact | 33 | not investigated (likely same mini-repo fixture drift as dispatch-contract — check for a `.claude/review-loop-config.md` heredoc missing the four off-lines first) | not reached |
| dispatch-hetero-contract | 17 | not investigated (same suspicion as above) | not reached |
| mission-backlog-convergence | 3 | not investigated | not reached |
| mission-routing-admission | 13 | not investigated | not reached |
| mission-routing-campaign-bridge | 18 | not investigated | not reached |
| plan-review-routing | 1 | not investigated — brief says this is a wording assertion (research-to-ship Phase 3 now says "hetero-review" not a script name) | not reached |
| slash-entry-probe | 6 | not investigated — brief flags this as a known parallel-load flake, run alone | not reached |
| provider-readiness-consumer | 7 | not investigated | not reached |
| qualification-defaults-adoption | 2 | not investigated | not reached |
| resolve-review-loop-consult-discuss-switch | 8 | not investigated | not reached |
| resolve-review-loop-role-admission | 6 | not investigated | not reached |
| review-loop-runner | 10 | see above (fixed the drift portion; residual is pre-existing) | see above |
| resolve-review-loop | 21 | not investigated — brief says implementer_engine/implementer_family/review_risk/required_review_families/l1_required rows are EXPECTED red until closeout (roster temporarily gemini, not grok) — verify each of the 21 falls in that set before treating any as real | not reached |
| dispatch-detach | 14 | not investigated | not reached |
| dispatch-hetero | 9 | not investigated | not reached |
| skill-count-metadata | 11 | not investigated — brief says pin to 30 skills | not reached |

## Root causes identified (for the next foreman/hands to reuse)

1. **Hand-maintained payload fixtures** (JS object literals or `.claude/review-loop-config.md`
   heredocs) that assert an exact field set against `REVIEW_LOOP_FIELDS` — sourced from
   `schemas/review-loop-contract.schema.json`'s `x-field-order`, which D1 already updated
   correctly. The schema is NOT the drift source; only downstream hand-copies are. Six new
   fields to add wherever a full field-set fixture exists: `plan_review_resolved_from`,
   `hetero_review`, `hetero_review_resolved_from`, `consult_dispatch` (may already exist),
   `consult_resolved_from`, `discuss_dispatch` (may already exist). None of these four
   resolved_from/hetero_review fields are strictly type/enum-validated by
   `src/engine/resolve-review-loop.js` beyond presence — safe defaults: `'off'`/`'topology'`/
   `'explicit'` per context, see `ed2b705e` diff for the exact values used.
2. **Mini-repo dispatch-contract test fixtures**: any `.claude/review-loop-config.md` heredoc
   in a `hooks/tests/*.test.sh` file that does NOT set `plan_review`/`hetero_review` will now
   pick up `auto` → topology expansion, which can collide with an explicit `implementer_runner`
   under the same-runner-dual-seat guard and turn the whole fixture NO-GO with an unrelated
   error. Fix: append `- plan_review: off`, `- hetero_review: off`, `- consult_dispatch: off`,
   `- discuss_dispatch: off` to the fixture (matches pre-D1 behavior exactly, since off was
   effectively what an absent knob did before). `dispatch-contract-artifact` and
   `dispatch-hetero-contract` are the next most likely to share this shape — grep
   `hooks/tests/*.test.sh` for `verification_author_effort: high` to find every remaining
   hand-maintained review-loop-config fixture.
3. Two verified pre-existing-on-develop clusters (do not attempt to fix; re-verify against
   `develop` before touching): `contract-parity` (`implementer_ladder[17]` malformed —
   project-config-template bug, not D1), and `review-loop-runner`'s 10 parser-fixture
   assertions (`ladder_start_rung_judgment` missing from raw JSON string literals, predates
   this branch).

## Acceptance / tests run this pass

| file | before | after |
|---|---|---|
| autopilot-engine | 41 failed | PASS 470 assertions |
| review-loop-runner | 10 failed | 10 failed (unchanged file-level result; drift portion fixed, residual confirmed pre-existing on develop) |
| contract-parity | 8 failed | 8 failed (confirmed pre-existing on develop, untouched) |
| dispatch-contract | 79 failed | PASS 317 assertions |
| dispatch-author-contract | 21 failed | PASS 46 assertions |

## Files changed

- `hooks/tests/autopilot-engine.test.sh`
- `hooks/tests/dispatch-author-contract.test.sh`
- `hooks/tests/dispatch-contract.test.sh`
- `hooks/tests/review-loop-runner.test.sh`

## Open issues / handoff

21 of 25 originally-failing files were not reached this pass (bash-cap exhaustion — no
hands cut was dispatched, every fix here was direct mechanical re-pin under escalation).
The next foreman for D5-integration should:

1. Start with `dispatch-contract-artifact` and `dispatch-hetero-contract` (root-cause #2
   above is the strong prior).
2. Then `mission-routing-admission`, `mission-routing-campaign-bridge`,
   `mission-backlog-convergence`, `campaign-dispatch-projection`, `dispatch-detach`,
   `dispatch-hetero`, `dispatch-detached-campaign-authority`, `autopilot-cli`,
   `provider-readiness-consumer`, `qualification-defaults-adoption`,
   `resolve-review-loop-consult-discuss-switch`, `resolve-review-loop-role-admission` —
   likely a mix of root-cause #1/#2 shapes plus possibly-genuine new logic per the
   consult/discuss switch (D6/D7 territory per the schema description strings).
3. `resolve-review-loop` (21 failures) and `skill-count-metadata` (11) need the
   roster-pinned-grok / 30-skill-count triage per the brief before any fix — many rows
   are likely EXPECTED red until closeout.
4. `plan-review-routing` (1) — brief says update the research-to-ship Phase 3 assertion
   wording to "hetero-review" instead of a script name.
5. `slash-entry-probe` (6) — run alone (not under `--parallel`), known flake per brief.
6. `context-window` (1), `check-phase-review-receipt` (5) — not investigated at all.

bash_calls_used: at cap (40), stopped per contract rule (2).
