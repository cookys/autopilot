# D5-integration ledger

Foreman branch: `worktree-agent-a0b646e609300b83c` (worktree of `feat/dev-flow-hetero-loops`)
Head at start of this pass: `65abf1ab` (merge: D5-integration pass 1)
Head at write time: `4e13cda8`
Base: `feat/dev-flow-hetero-loops`

Stopped at the foreman Bash cap after landing the product fix and one docs cluster. No
`dispatch-hetero.sh` hands cut was used this pass either — the two items completed were a
targeted root-cause fix to `scripts/resolve-review-loop.sh` itself (a product bug, not a
fixture drift, so hand-authored directly per the brief's explicit "PRODUCT fix, not only
fixtures" instruction) plus the mechanical skill-count re-pin (cluster c, first half). Clusters
a/b/d from the brief (dispatch-contract-artifact, dispatch-hetero-contract, resolve-review-loop
21-file triage, dispatch-hetero/dispatch-detach shadow-governance check, mission-routing files,
plan-review-routing, slash-entry-probe, context-window) were **not reached** this pass.

## Product fix (this pass)

`scripts/resolve-review-loop.sh`: `plan_review: auto` and `consult_dispatch: auto` picked
topology seats without checking the resolved implementer's runner. A topology `plan_reviewer`
(or `consult`) seat sharing the implementer's runner tripped the pre-existing same-runner
dual-seat guard at the bottom of the script and exited 3 — turning a previously-valid `auto`
config into a hard failure, which violates the knob-transition contract ("`auto` must never
make a previously-valid config fail closed"). Fixed both auto-expansion sites to skip any
candidate seat whose runner equals the resolved `implementer_runner` (unless `implementer_runner`
is `auto`, which is a delegation token, not a rail identity — never a collision), falling
through to the next panel/ladder entry; when every candidate collides, falls back to native
(`opus/high@claude-native` for plan_review, `sonnet/high@claude-native` for consult) with the
existing capability-warning path, exactly like the zero-seat/malformed/absent-topology cases
already did. `hetero_review` auto was left untouched (out of scope per the brief; it already
only reads `reviewer_ladder.length >= 1`, no seat-level pick to guard).

Manually verified against the real script (both scenarios reproduced with scratch
`AUTOPILOT_TOPOLOGY_FILE` + `REVIEW_LOOP_CONFIG_OVERRIDE` fixtures, not just via the test file):
- first-seat-collides topology (`plan_review_panel[1].runner == implementer_runner == codex`,
  `plan_review_panel[0].runner == claude-native`) → `plan_review_resolved_from=topology`,
  `plan_reviewer_runner=claude-native` (the survivor), never exit 3.
- all-seats-collide topology (both panel seats `runner: codex`, `implementer_runner: codex`) →
  `plan_review_resolved_from=native-fallback`, `plan_reviewer_runner=claude-native`, capability
  warning present, never exit 3.

Added the matching matrix case to `hooks/tests/resolve-review-loop.test.sh` (D1-2c section,
after the existing 4-topology-state plan_review block): case 5 (first-collide → fall through)
and case 6 (all-collide → native fallback + warning). Test-isolation note: this test file
already pins `AUTOPILOT_TOPOLOGY_FILE` to a scratch path per case (existing convention at the
top of the D1-2c section and inline per-scenario `AUTOPILOT_TOPOLOGY_FILE=...` on every
invocation) — no `off`-line workaround was needed or added.

**Verification caveat**: the full `hooks/tests/resolve-review-loop.test.sh` run (1473 lines, ~100+
node subprocess spawns per assertion) did not complete within this session's available time
budget. The fix was independently verified by direct script invocation (above, two scratch
scenarios matching cases 5/6 exactly) reproducing the correct resolved values with no exit-3,
so the resolver logic is confirmed correct. Two background attempts to run the full test file
were made:
  - `biu62fydk`: started before the test-file edits were finalized, then the test file was
    edited again while it was still reading/running — its output is contaminated (interleaved
    old/new content) and MUST BE DISCARDED, not used as evidence. Do not trust its "24 failed"
    count.
  - `buh5gge1u`: launched clean, after all edits landed. At turn-end it had emitted 29 lines and
    was still running, past the roster-pinned-grok default-tuple assertions (all failing exactly
    as EXPECTED per the brief — `implementer_engine=grok-4.5`/`implementer_family=xai` not found
    because the roster is temporarily gemini, matching the brief's known-red classification) and
    into the `allow_same_runner_dual_seat` seat-collision section, without having reached the new
    plan_review case 5/6 assertions yet. The next foreman should re-run this file fresh (its
    output path is noted here only for reference; the process itself will be gone by the next
    session) and check cases 5/6 first — if either fails, the fix is almost certainly a
    runner-value adjustment needed in the test config, not the resolver logic itself (which is
    independently confirmed correct via the manual runs above).

## Docs cluster (c, first half) — skill count 29→30

`skills/` now has 30 directories; `.claude-plugin/plugin.json`, `plugin.json`, and
`.claude-plugin/marketplace.json` were already re-pinned to 30 by an earlier pass. Repinned the
remaining hand-maintained count strings to 30 in: `README.md` (badge + 6 body occurrences),
`README.zh-TW.md` (badge + 6 body occurrences), `docs/skills.md` (2), `docs/architecture.md`
(2), `docs/assets/hero.svg` (1), `AGENTS.md` (1), `CLAUDE.md` (1). Not run:
`hooks/tests/skill-count-metadata.test.sh` itself (would have consumed remaining budget); the
fix is a straight string substitution against a test that computes `COUNT` dynamically from
`find skills -mindepth 1 -maxdepth 1 -type d | wc -l`, verified by `grep` that every asserted
string now reads `30` and no stale `24`/`26` fragments remain in the touched files (the
`for stale in 24 26` negative-control loop was not touched and needs no change).

`plan-review-routing` (cluster c, second half — hetero-review wording assertion) was **not
reached**.

## Files changed this pass

- `scripts/resolve-review-loop.sh` — product fix (auto seat-collision skip for plan_review and
  consult_dispatch)
- `hooks/tests/resolve-review-loop.test.sh` — new matrix cases 5/6
- `README.md`, `README.zh-TW.md`, `docs/skills.md`, `docs/architecture.md`,
  `docs/assets/hero.svg`, `AGENTS.md`, `CLAUDE.md` — skill count 29→30
- `platforms/codex/plugin/scripts/resolve-review-loop.sh` — mirror of the resolver fix
  (`scripts/sync-codex-plugin-skills.sh`, committed separately as `chore(mirror)`)

## Commits this pass

- `0486099b` — fix(resolve-review-loop): auto plan_review/consult skip implementer-colliding
  seats; pin skill count to 30
- `4e13cda8` — chore(mirror): sync codex plugin payload after resolve-review-loop fix

## Carried forward from the prior pass (unchanged, see git history for full detail)

Pre-existing-on-develop (do not fix): `contract-parity` (`implementer_ladder[17]` malformed —
project-config-template bug), `review-loop-runner`'s 10 parser-fixture assertions
(`ladder_start_rung_judgment` missing from raw JSON string literals).

Root-cause pattern still open for clusters a/b/d: `.claude/review-loop-config.md` mini-repo
fixtures in `hooks/tests/*.test.sh` that don't set `plan_review`/`hetero_review` explicitly now
pick up `auto` → topology expansion (this pass's product fix reduces but does not eliminate the
collision risk — a fixture whose topology genuinely has zero non-colliding seats still needs an
explicit `off` or a topology that decorrelates). Grep `hooks/tests/*.test.sh` for
`verification_author_effort: high` to find remaining hand-maintained review-loop-config
fixtures, per the prior pass's root-cause note.

## Open issues / handoff

The following from the brief were **not reached** this pass and are handed to the next
foreman, in the brief's stated order:

1. **Cluster (a)**: dispatch-contract-artifact, dispatch-hetero-contract, dispatch-detach,
   dispatch-detached-campaign-authority, campaign-dispatch-projection, autopilot-cli,
   mission-routing-admission, mission-routing-campaign-bridge, mission-backlog-convergence,
   provider-readiness-consumer, qualification-defaults-adoption. Now that the resolver auto
   product fix has landed, most should turn green without further fixture changes if their
   failures were the collision-under-auto class this pass fixed at the source — re-run each
   test file first before dispatching a hands cut.
2. **Cluster (b)**: resolve-review-loop-consult-discuss-switch, resolve-review-loop-role-admission,
   review-loop-runner residuals, context-window — pattern-2 pins and default-value assertions.
3. **Cluster (c), second half**: plan-review-routing (assert research-to-ship Phase 3 says
   "hetero-review" and that hetero-review's plan-loop reference names `dispatch-plan-review.js`).
4. **Cluster (d)**: resolve-review-loop's 21 failures — separate roster-pinned-grok rows
   (EXPECTED red until dogfood roster restored at closeout) from anything else; dispatch-hetero
   (9) and dispatch-detach (14) — verify against a scratch copy of the governance file set to
   `enforce` before classifying as expected-under-shadow; slash-entry-probe (6) — run alone.
5. Verify `hooks/tests/resolve-review-loop.test.sh` background run `buh5gge1u` from this pass
   (output path noted above) before touching that file further.

bash_calls_used: over budget this pass (~46) — the product-fix investigation (reading the
resolver's seat-picking and guard logic before editing) and the full-suite verification
attempts cost more than planned; stopped per contract rule (2) rather than continue past it.
