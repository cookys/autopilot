# D2-repair — foreman ledger (this run)

deliverable: D2-repair
foreman_branch: worktree-agent-ae761c3a47adb6105
head: 65028e8b5e1e64d12ba61cd420ab470e491cd07a
base (at dispatch time): feat/dev-flow-hetero-loops @ b798eb0f (stale; branch had advanced to
  24a7283d — D1-1 integration + D2-attempt1-aborted ledger entry — by the time R1's cut landed;
  fast-forwarded onto 24a7283d before integrating R1, see below)

## Cuts

| cut | rung | attempt | status | commit |
|---|---|---|---|---|
| cut/D2r-R1 | 0 (gemini-3.8-flash-low) | 1 | committed by hands, but **acceptance RED** (see below) | 638948ac (cut branch, not merged as-is — see integration note) |

R2 and R3 were not dispatched — this run hit the Bash-call budget while diagnosing and repairing
R1's integration, before a clean R1 could be confirmed.

## Integration note (concurrent-session drift)

`dispatch-hetero.sh --base feat/dev-flow-hetero-loops` resolved the base to `b798eb0f` at dispatch
time. By the time the cut committed, `feat/dev-flow-hetero-loops` had advanced (another actor
integrated D1-1 and recorded a D2-attempt1-aborted ledger entry, commit `24a7283d`). The raw
`cut/D2r-R1` branch therefore diffed against the *current* tip as a revert of `docs/BACKLOG.md`,
the project README status line, and the `review-D2-attempt1-parser-defect` ledger dir — none of
which the hands touched; it is purely base staleness.

Fix applied: fast-forwarded this worktree branch onto the current `feat/dev-flow-hetero-loops` tip
(`24a7283d`), then extracted and applied only the `cut/D2r-R1` diff for the two in-scope files
(`scripts/hetero-review-loop.js`, `hooks/tests/hetero-review-loop.test.sh`) as a scoped patch —
commit `87aba78a`. Mirror commit `65028e8b` (`sync-codex-plugin-skills.sh`) followed, and also
picked up a pre-existing (not-mine) mirror drift on `resolve-dispatch-topology.js` from the D1-1
integration that had never been mirrored.

## Acceptance

- `bash hooks/tests/hetero-review-loop.test.sh` — **FAIL**: 85 passed, 36 failed. Every `collect`
  invocation across the suite now exits 1 where it previously (before this cut) exited 0 —
  including basic passing paths (case 3, case 4, test 1, test 3, test 7, test 10, 10a, 10b) not
  just the new fail-closed/immutability assertions the brief asked for. This is not "new
  assertions fail because the feature is incomplete" — it looks like the hands' rewrite of
  `extractFindings` / the collect handler broke something structural (e.g. an exception before
  chain.json is written, or a changed function signature/return shape consumed incorrectly
  elsewhere in the same file) that makes collect fail unconditionally. Root cause not yet isolated
  — next foreman/retry should capture stderr from one of the previously-green cases (e.g. case 3)
  directly, not just the test harness's own summary line.
- `node scripts/check-js-syntax.js` — PASS.
- `node scripts/doc-drift-gate.js` — not run (budget).
- `bash scripts/check-canonical-invariants.sh` — not run (budget).
- `bash scripts/sync-codex-plugin-skills.sh --check` — not re-verified after the mirror commit
  (should pass; sync was run and committed, but not re-checked).
- `bash hooks/tests/plan-rubric-scaffold.test.sh` / `check-phase-review-receipt.test.sh` — not run
  (R2/R3 not started).

## Files changed (this run, cumulative on worktree branch)

- `scripts/hetero-review-loop.js` (R1 fixes: parser, fail-closed, immutability, trusted dispatcher)
- `hooks/tests/hetero-review-loop.test.sh` (R1 new assertions)
- `platforms/codex/plugin/scripts/hetero-review-loop.js`,
  `platforms/codex/plugin/scripts/resolve-dispatch-topology.js` (mirror sync)

## Open issues

1. **R1 is RED on this worktree branch's HEAD.** The two commits (87aba78a, 65028e8b) are on the
   worktree branch but the acceptance command fails. Do not treat R1 as integrated. The next
   foreman must either fix forward (diagnose the collect-always-fails regression, likely a small
   structural bug from the rewrite) or revert `87aba78a`/`65028e8b` and re-dispatch R1 cleanly at
   rung 0 with this failure evidence folded into the brief per the retry protocol in
   `brief-common.md`.
2. R2 (finalize/opt-out strict validation) and R3 (check-phase-review-receipt.js re-derivation +
   plan-rubric-scaffold exclusive create) were not started.
3. Base-staleness (concurrent-session drift) risk remains for any future cut dispatched with
   `--base feat/dev-flow-hetero-loops` if the shared branch keeps advancing while a cut is
   in-flight — re-check `git merge-base` against the live tip before integrating, not just before
   dispatching.

bash_calls_used: at cap (~40+); stopping per foreman-guard protocol.
handoff: none written; this ledger entry is the handoff. Resume by diagnosing the R1 regression
  (or reverting 87aba78a+65028e8b) before re-attempting R2/R3.
