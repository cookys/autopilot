# Evidence — round 2 of the same day: three fired BACKLOG rows, three sonnet foremen × independent clones, cursor-grok-4.6-low hands (v2.36.72)

Operator: "照你建議地做" after the post-v2.36.71 `/next` (four units + two verification closeouts proposed). Base `ed3d8b4b`.

## What changed from round 1 (`../2026-09-19-parallel-sonnet-foremen/`)
- `common.md` carries §39–41: every new `*.test.sh` `chmod +x` + `test -x`; the foreman runs the §37 consumer sweep itself in ONE Bash call
  (`for` loop, `< /dev/null`, `sweep.txt`) before REPORT; verify commands each `< /dev/null`.
- Unit D (carry-only ledger segments) was dropped before launch: the explorer confirmed the plan's own §6 ruling — a digest-chain
  linearisation inside the fail-closed reducer (`ARTIFACT_CHAIN_BROKEN`) or a live rewrite of 5 × 2.5 MB production segments — **L**, needs
  its own plan + hetero loop. Row re-sized.
- Unit C's design went through the hetero consult seat (gpt-5.6-sol/codex, `c/consult-q.md` → `c/consult.json`, run from the clone
  because the main checkout's l5 marker refuses non-strict dispatch): **never auto-release** a stranded claim, even when its campaign
  ledger has no intake root — a no-effect release resets the node and lets `mission grant` mint attempt N+1 freely (the v2.36.42 class).
  Brief rewritten to option (ii): `stranded_claim` + exact `recovery` at both layers, claim stays live.
- Two "verify then close" rows closed on evidence (`check-phase-review-receipt.js:1040` compares id/severity/disposition; `:847-869`
  derives seats from sha-verified artifacts; `hetero-review-loop.js:1277` exits 1 on a missing config path, suite case 9 pins it).

## Units
| unit | row | hands | review (claude-fable-5-1) | landed |
|---|---|---|---|---|
| **A** resume-a | disposition resume refuses caller `--branch` — really: the managed `implement` closure never derived the repair branch (`autopilot-engine.js:7394`), so the first in-run repair round of ANY strict campaign hit `caller branch disagrees with campaign stage` | `a@8a11931b` | SHIP-AS-IS, 3🔵 | 1 commit; `buildRepairBranchName` delegates to `expectedBranch` (single owner) |
| **B** migrate-b | cuda-reported table-migration defects (unmapped status → `open`, foreign column dropped, `preserved` assumed, no post-apply gate) | `migrate-b@9645d269`, `-r2@87a29ad2` | FIX-THEN-SHIP 2🟠 (reconciliation was `x === x`; the test read the value back from the same manifest) 4🔵 → r2 | 2 commits |
| **C** c | rejected intake strands the Mission claim silently | `c@df97f2f6`, `c-r2@c739a6e7` | FIX-THEN-SHIP 2🟠 (edited forbidden `src/mission/cli.js` — reverted; engine-layer locator unproven — shared `buildStrandedClaim`) 1🟡 3🔵 → r2 SHIP-AS-IS | 2 commits; foreman hit the 40-call cap before its sweep — depth-0 ran it |

Foreman A caught itself verifying the wrong tree (`git checkout` refused by an occupied worktree, silently) and re-ran against the hand's
worktree. Foreman B repeated round 1's prompt-filename slip (`hand-b.md` vs `hand-migrate-b.md`) and self-retried — the template should
spell the exact filename.

## Depth-0 verdict
- 5 hand cherry-picks, zero conflicts; every diff ⊆ allowed files after r2. Integrated run (`int-suites.txt`, `suites-int.sh`): 20 suites +
  sync/syntax/secret-scan/backlog gate/migrate dry-run — 24 green, 1 red (`dispatch-detached-campaign-authority`, identical failing set at
  base). Consumer sweep (`consumer-sweep-int.txt`): 10 further suites, all green. Full `run.sh`: `full-run-summary.txt`.
- Integration receipts per unit: `*/integration-receipt.json` (recorded in the integration clone with each accepted commit checked out on a
  temp branch — `record-integration.js` needs `accepted == HEAD` on a branch).

## Deferred (🔵, here not BACKLOG)
A: the `implement` closure re-reads the sealed contract from disk to decide strictness (an in-memory field would do); source-text pin in the
new suite. B: `status` kind pass-through; on-disk manifest lacks the gate report (stdout has it); negative-control scope; partial RED notes.
C: require-cycle check for the `runtime.js → campaign-intake.js` import; extra field on the runtime detail; a RED note that describes
rather than quotes.
