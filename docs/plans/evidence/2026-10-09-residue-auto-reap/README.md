# Residue auto-reap — evidence log (3.0.0-alpha.3)

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

## Known limits (BACKLOG rows added at the cut)

- Hygiene tab truncates the dim command line at the pane edge, so the exact command cannot be read or copied in a narrow pane.
- The band reminder shows only where the runs watcher starts (onboarded repos, or `AUTOPILOT_RUNS_WATCH_AUTOSTART=1`); the capture needed that env. Elsewhere the sweep and advisory still run but nothing shows `wt N`.
- The docked panel narrows the band below 160 columns and hides the hygiene slot (seen at 209 columns).
- Existing rows: archive refs never expire; `--gc` removal at 3.0.0 final; finish-flow close-out archive step waits for the v7 eval.
