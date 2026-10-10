# Residue auto-reap — evidence log (3.0.0-alpha.3, alpha.4)

Contract: [`contract.md`](contract.md) (incl. "Accepted deviations"). Source: peer report from revival.3d, 2026-10-09 (worktree and branch accumulation).

## What shipped

| Req | Commits | Summary |
|-----|---------|---------|
| contract | e7345299 | auto-reap contract and owner rulings |
| R1, R2 | 5fd1494a, merge 94ce4624 | rails stamp `retention_reason` + `retention_expires_at` on every keep path; `repo-residue-sweep.js reap --auto` |
| R3 | e9e7e7a5 | default-on SessionStart hook `residue-auto-reap` (24 h throttle, detached, advisory) |
| R4 | acd0aa90, merge bd03b070 | watcher fields, band `wt N` = `needs_human_count`, Hygiene tab rows, gate update |
| fixes | f4f53b1a, 2ef5f16a, 74f9c3eb | campaign-held/unknown in needs_human; hook `auto_reap` via residue-config; HEAD-preserving and create-only commands; marker-branch-mismatch listing |
| evidence | c10105ac | 209-column capture |

## Review rounds

Reviewers: opus, GLM, MiniMax (hetero panel).

- **Round 1**, two packets (A: R1+R2, B: R3+R4), each x opus/GLM/MiniMax. Opus on packet A returned FIX-THEN-SHIP:
  - F1 data-loss command: a needs_human command could drop commits of a detached worktree. Fixed (2ef5f16a, HEAD-preserving commands).
  - F2 silent marker/branch mismatch. Fixed: listed as needs_human.
  - F4 stale reminder: the watcher list came from a stale auto-run file. Fixed: watcher list from its own scan.
  - Refuted: "campaign journal absent means unreadable" is wrong; an absent journal is an empty map, not `campaign-unknown`.
  - Refuted: "codex mirror module missing"; the module exists.
  - F3 not reproducible: the proposed fixture cannot be built because HEAD is a symbolic ref.
- **Round 2**, delta, opus + GLM: archive-ref overwrite (a second archive of the same name or a detached basename collision could overwrite a ref). Fixed in 74f9c3eb: refs are create-only, detached-worktree refs are `<sanitized-basename>-<head12>`.
- **Round 3**, opus: SHIP-AS-IS.

## Real-session proof

`prove-hook-fires.sh` (this directory), run with a real `claude -p` on 2.1.295, live plugin, no `CLAUDE_CONFIG_DIR`: ALL PASS (11 checks): expired worktree removed and its branch kept; dirty worktree kept and listed in needs_human; 15-day-old `hands/x` deleted with `refs/archive/<date>/hands/x` at the old tip; stamp written; second session within 24 h did not rerun.

## 209-column capture

`residue-hygiene-w209` PASS (row in `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/RESULTS.md`). Band `◌ 待命 │ $535/150 │ dev · wt 1 │ ⓘ`; `check.js` `PASS residue fields=10`; Hygiene tab summary `1 need you · 16 KB · auto 5m ago: −1 wt, 1 branches archived`.

- Band PNG: `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/residue-hygiene-w209-band2/20261009T154910Z/band-209.png`
- Hygiene tab PNG: `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/residue-hygiene-w209-hygiene/20261009T154930Z/band-209.png`
- First capture (docked pane, hygiene slot hidden, check PASS with hygiene ABSENT): `.../residue-hygiene-w209-band/20261009T154812Z/`

## alpha.4 additions (2026-10-10)

Follow-up batches after alpha.3, each hetero-reviewed (opus, GLM, MiniMax, Qwen) until SHIP-AS-IS.

| Change | Commits | Summary |
|--------|---------|---------|
| session ledger | 41a44f85 | `dispatch-hetero.sh` and `dispatch-foreman.sh` append a branch-to-session row to `<git-common-dir>/autopilot/dispatch-branches.jsonl` (flock, fail-open); `reap --auto` compacts it under the same lock |
| `close-session` | 41a44f85, 1977780e, fd29d230, 53fa2105 | `repo-residue-sweep.js close-session --session S --yes` deletes the session's dispatch branches directly (CAS `update-ref -d` with the expected tip); no archive ref |
| archive aging | 53fa2105, 0bc8e71a | archive refs older than `residue.archive_remind_days` (90) are listed in `needs_human` as `archive-ref/archive-old`; never deleted. Dates are real calendar dates |
| unconfigured repos | 53fa2105, 0bc8e71a, 7e617903 | the live mod's no-project line shows `wt N` read from `<git-common-dir>/autopilot-residue-auto.json` (walk up to the first `.git`, no git); an empty or unparseable `.git` ends the walk with 0 |

Deletion rule and the owner's reasoning:

- `close-session` deletes the session's unintegrated dispatch branches and prints `git branch <name> <tip>` per deleted branch. The tip stays reachable until git gc (about 2 weeks), which is the recovery window.
- It keeps checked-out branches (re-checked right before each delete: `checked_out_late`), branches with a live worktree, and campaign-held branches. Ownership follows run ids, so a foreman's hands belong to the foreman's session; a branch name belongs to the owner of its latest ledger row, and that row must match the live ref's lifetime (`ledger_row_stale` otherwise).
- It runs at finish-flow close-out, not at handoff. Owner's reasoning: handoff is not close-out. A handoff passes work to the next session, which may still need those branches; only finish-flow says the work is done.
- The 14-day `reap --auto` path still archives before deleting. Only the explicit close-out deletes without an archive.

Review rounds:

- **Round 1** (ledger and `close-session`): findings on ledger staleness, only the last pointer worktree considered, and a non-CAS delete. Fixed in 1977780e: latest-row ownership with a lifetime match, every marker worktree naming a branch, `update-ref -d` with the expected tip; mutants pinned for sibling `root_run_id`, order-independent transitivity, reused names, two-pointer leases.
- **Round 2**: a branch still at its row's `base_sha` must fit without a reflog; a branch checked out between scan and delete must be kept. Fixed in fd29d230.
- **Round 3** (direct deletion, archive-ref reminders, `wt N` without a watcher; 53fa2105, 0bc8e71a, 7e617903): hetero-reviewed in 3 rounds, merged as 3c91f091.

Guidance for the close-out row (G7) and the `/l4`–`/l6` size at entry (G6) are covered by the g67 ON/OFF suite, SHIP; see `../2026-10-06-stage-graph/README.md`.

## Known limits (BACKLOG rows added at the cut)

- Hygiene tab truncates the dim command line at the pane edge, so the exact command cannot be read or copied in a narrow pane.
- The band reminder shows only where the runs watcher starts (onboarded repos, or `AUTOPILOT_RUNS_WATCH_AUTOSTART=1`); the capture needed that env. Elsewhere the sweep and advisory still run but nothing shows `wt N`.
- The docked panel narrows the band below 160 columns and hides the hygiene slot (seen at 209 columns).
- Existing rows: archive refs never expire; `--gc` removal at 3.0.0 final; finish-flow close-out archive step waits for the v7 eval.
