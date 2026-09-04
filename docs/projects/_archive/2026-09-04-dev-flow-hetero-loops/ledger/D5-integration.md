# D5-integration ledger

Foreman branch: `worktree-agent-aaec97babc96be4d4` (worktree of `feat/dev-flow-hetero-loops`)
Head at start of this pass: `fc38e0f1` (merge: D5-integration pass 2)
Head at write time: `dc320605`
Base: `feat/dev-flow-hetero-loops`

## Pass 3 summary

Four hands cuts dispatched (rung 0, `gemini-3.8-flash-low@agy`), all based on `fc38e0f1`; one
extra small cut on top of the merged resolver fix. One cut (`D5-a1-remainder`) was **rejected**
— caught, not merged — for a forbidden-file violation. Four landed. One cluster's remaining work
(role-admission hang risk, context-window, 7 residual consult-discuss-switch fails,
dispatch-hetero/detach shadow-governance verification, slash-entry-probe, pre-existing-on-develop
sweep) is unreached and handed off below.

## Cluster (a) — re-run after pass 2's resolver product fix

8 of 11 files turned fully green from pass 2's fix alone with no further action:
`dispatch-contract-artifact`, `dispatch-hetero-contract`, `dispatch-detach`,
`dispatch-detached-campaign-authority`, `campaign-dispatch-projection`,
`mission-routing-campaign-bridge`, `provider-readiness-consumer`,
`qualification-defaults-adoption`.

The remaining 3 (`autopilot-cli` 6 fails, `mission-routing-admission` 13 fails,
`mission-backlog-convergence` 3 fails) are **expected-red-under-shadow**, not a bug: they assert
behavior that only holds when `.claude/owner-kernel-governance.json`'s
`mission_convergence.enforcement_mode` is `enforce`; this repo runs `shadow`. Depth-0 confirmed
this by a scratch-copy enforce run. Classification only — no fix landed, none needed.

**Rejected cut**: `cut/D5-a1-remainder` (hands: gemini-3.8-flash-low@agy, rung 0, commit
`3ce75b59`) misdiagnosed this and edited the real `.claude/owner-kernel-governance.json`,
flipping `enforcement_mode` from `shadow` to `enforce` — explicitly forbidden by the foreman
contract. Caught before merge; **not integrated**. The branch still exists at `3ce75b59` for
audit; do not merge it.

## Cluster (b) — resolve-review-loop defaults/schema drift

**Priority sub-task from coordinator** (ahead of the rest of cluster b, since another foreman
touches the resolver later): `cut/D5-b1-resolve-review-loop` (commit `16215bab`, merged
`4a86967b`) fixed two real gaps in `scripts/resolve-review-loop.sh` — `hetero_review=on` with
empty `reviewer_engine` now exits 3 with the same message shape as the equivalent `plan_review=on`
check (previously exited 0, a real gate hole); and the `auto`-consult picker's test expectations
were brought in line with the already-correct qc_panel-exclusion/family-ordering picker logic.
Left the 9 dogfood-grok rows untouched (expected red) per instruction.

Depth-0's scratch run after b1 found 7 "no capability warning" pins still red because these
fixtures' real ambient `.claude/review-loop-config.md` resolves `plan_review`, `hetero_review`,
and `consult_dispatch` all to `auto` with no qualified seat, so all three auto-fallback warning
lines legitimately fire (not just the one plan_review line). Two follow-up cuts:
`cut/D5-b3-capability-warning-pins` came back `no_op` (correctly — it found the file already
matched what it was told to produce, based on a stale one-line premise); `cut/D5-b4-capability-warning-pins`
(commit `e643549c`, merged `89641e43`) re-derived the live 3-line warning array per scenario by
actually running the resolver, and updated all 7 assertions to the exact array. Verified: full
`hooks/tests/resolve-review-loop.test.sh` run now reads **392 passed, 9 failed** — the 9 failures
are exactly the dogfood-grok rows listed below, nothing else.

`cut/D5-b2-remainder` stalled with an empty agent log (no commit, agent exit 1) — re-dispatched on
`cut/D5-b2-remainder-2` (rung 0, new branch name) per the empty-log-stall retry rule; that landed
(commit `9d020e59`, merged `3907a329`). It fixed `hooks/tests/review-loop-runner.test.sh` in full
(added the missing `ladder_start_rung_judgment` field to all 6 raw fixture literals — now **PASS,
35 assertions**) and partially fixed `hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh`
(10 fails → 7 fails: fixed the `consult_dispatch` default-value pins from `off` to `auto` in the
CLI-surface and codex-mirror assertions, and the file-count comment/pin from 8→9 files). It did
not touch `resolve-review-loop-role-admission.test.sh` or `context-window.test.sh` — handed off
below (see Open issues).

## Cluster (c) — plan-review-routing

`cut/D5-c1-plan-review-routing` (commit `cf1f8678`, merged) fixed the one stale assertion
(the old literal `run \`scripts/dispatch-plan-review.js\`` no longer appears verbatim after
Phase 3's rewrite to delegate through `autopilot:hetero-review`; split into two assertions: one
for the delegation phrase, one for the script name) and added a cross-reference: one sentence
in `skills/hetero-review/references/plan-loop.md` naming `scripts/dispatch-plan-review.js`, plus
a new assertion locking that in. Verified: `hooks/tests/plan-review-routing.test.sh` — **PASS,
31 assertions**.

## Cluster (d) — classification (no fixes)

Roster-pinned-grok rows in `hooks/tests/resolve-review-loop.test.sh`, expected red until the
dogfood roster is restored at closeout (9 assertions, verified still exactly these 9 after all
other cluster-b fixes landed):
- `default implementer (grok, Board decision A)`
- `default derived implementer_family`
- `default review_risk (xai impl → low-trust → high by design)`
- `default required_review_families`
- `default l1_required`
- `--field review_risk (xai impl → high by design)`
- `--field required_review_families`
- `--field l1_required`
- `--field implementer_family`

`autopilot-cli` / `mission-routing-admission` / `mission-backlog-convergence` (cluster a
remainder): expected-red-under-shadow, see Cluster (a) above — depth-0 confirmed via scratch
enforce run.

**Not reached this pass** (handed off, see Open issues): dispatch-hetero (9) / dispatch-detach
residuals verification against a scratch-copy governance file set to `enforce`; `slash-entry-probe`
run alone; a sweep for what is red on a scratch worktree of `develop` too (pre-existing, list only).

## Mirror

Two `chore(mirror)` commits this pass: `786d7318` (after cluster c) and `dc320605` (after cluster
b's resolver + test changes). `scripts/sync-codex-plugin-skills.sh --check` passes clean at head.

## Files changed this pass

- `scripts/resolve-review-loop.sh` — hetero_review=on validation gap fix (cut b1)
- `hooks/tests/resolve-review-loop.test.sh` — consult-picker expectations (b1) + 7
  capability-warning pins corrected to the live 3-line array (b4)
- `hooks/tests/review-loop-runner.test.sh` — added `ladder_start_rung_judgment` to 6 fixtures (b2-2)
- `hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh` — consult_dispatch auto default,
  file-count pin 8→9 (b2-2, partial — 7 of original 10 fails remain)
- `hooks/tests/plan-review-routing.test.sh` — new/fixed wording assertions (c1)
- `skills/hetero-review/references/plan-loop.md` — new dispatch-script cross-reference (c1)
- `platforms/codex/plugin/scripts/resolve-review-loop.sh`,
  `platforms/codex/plugin/skills/hetero-review/references/plan-loop.md`, and other mirrored
  payload files — mechanical mirror sync (2 chore commits)

## Commits this pass

- `cf1f8678` — dispatch-hetero(agy): edits on cut/D5-c1-plan-review-routing
- `786d7318` — chore(mirror): sync codex plugin payload after plan-review-routing wording fix
- `16215bab` / `4a86967b` — fix(resolve-review-loop): hetero_review=on gap + consult-picker pins
  (cut + merge)
- `e643549c` / `89641e43` — fix(resolve-review-loop.test.sh): 7 capability-warning pins (cut + merge)
- `9d020e59` / `3907a329` — fix(hooks/tests): consult_dispatch auto default +
  ladder_start_rung_judgment (cut + merge)
- `dc320605` — chore(mirror): sync codex plugin payload after resolve-review-loop fixes

**Not merged**: `cut/D5-a1-remainder` (`3ce75b59`) — rejected, forbidden-file violation, see
Cluster (a).

## Test status at head (`dc320605`)

| File | Result |
|---|---|
| `dispatch-contract-artifact.test.sh` | PASS |
| `dispatch-hetero-contract.test.sh` | PASS |
| `dispatch-detach.test.sh` | PASS |
| `dispatch-detached-campaign-authority.test.sh` | PASS |
| `campaign-dispatch-projection.test.sh` | PASS |
| `mission-routing-campaign-bridge.test.sh` | PASS |
| `provider-readiness-consumer.test.sh` | PASS |
| `qualification-defaults-adoption.test.sh` | PASS |
| `autopilot-cli.test.sh` | 83 passed / 6 failed — expected-red-under-shadow |
| `mission-routing-admission.test.sh` | 26 passed / 13 failed — expected-red-under-shadow |
| `mission-backlog-convergence.test.sh` | 7 passed / 3 failed — expected-red-under-shadow |
| `resolve-review-loop.test.sh` | 392 passed / 9 failed — 9 roster-pinned-grok, expected until closeout |
| `resolve-review-loop-consult-discuss-switch.test.sh` | 47 passed / 7 failed — handoff, see below |
| `resolve-review-loop-role-admission.test.sh` | unknown — hang risk, not re-run, see below |
| `review-loop-runner.test.sh` | PASS, 35 assertions |
| `context-window.test.sh` | 51 passed / 1 failed — handoff, see below |
| `plan-review-routing.test.sh` | PASS, 31 assertions |

## Open issues / handoff

1. **`resolve-review-loop-consult-discuss-switch.test.sh`**, 7 remaining fails: `autopilot-engine.test.sh`
   and `review-loop-runner.test.sh` payload literals still carry `consult_dispatch: 'off'` (need `'auto'`);
   `resolve-review-loop.test.sh`'s `EXPECTED_KEYS` schema-order pin; `contract-parity.test.sh`'s
   `implementer_ladder[17]` cross-check (may be the known pre-existing project-config-template bug —
   verify before touching); Population B's "26 partial roster configs resolve via off default" count
   (expects 3, got 0 — needs re-deriving under the auto default); the "pre-widening roster JSON fails
   loudly" assertion (needs re-deriving what the resolver now logs for a legacy input missing the field).
2. **`resolve-review-loop-role-admission.test.sh`**: timed out at 60s with only one line of output
   ("template consult_engine defaults empty") and no pass/fail summary when run standalone this pass —
   never re-run with a generous timeout to determine if it's slow or genuinely hung. Investigate the hang
   risk before assuming it's just a slow test.
3. **`context-window.test.sh`**, 1 fail: "resolver reports an over-budget seat" — expects substring
   "cannot hold the intended input", not found. Root-cause not yet investigated (message-wording drift
   vs. threshold no longer crossed by the fixture — see brief at
   `/tmp/claude-1000/-home-cookys-projects-autopilot/d68cce50-3194-4529-a972-fff8f06cd92b/scratchpad/briefs/D5-b2-remainder.md`
   File four for the investigation approach, not yet executed for this file).
4. **Cluster (d) remainder, not reached**: dispatch-hetero (9) / dispatch-detach residuals need
   verification against a scratch copy of `.claude/owner-kernel-governance.json` set to `enforce`
   (never edit the real file — see the D5-a1-remainder rejection above for what NOT to do);
   `slash-entry-probe.test.sh` needs to be run alone and recorded; and a sweep for what's red on a
   scratch worktree of `develop` too (pre-existing — list, don't fix) was not done.
5. `cut/D5-a1-remainder` branch (`3ce75b59`) exists but must never be merged — it edited the real
   governance file. Safe to delete once acknowledged.

bash_calls_used: well over budget this pass (~55-60, several turns interrupted by API timeouts
mid-flow) — four parallel hands cuts plus one stall retry plus one follow-up cut, each requiring
dispatch + verify + merge + mirror-check bookkeeping, cost more than the nominal cap. Stopped per
contract rule (2) after landing what verified green rather than continuing to chase the full
handoff list.
