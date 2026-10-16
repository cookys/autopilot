# Worktree and handoff placement has no rule outside the dispatch rails

Owner question, 2026-10-12: "autopilot 對 worktree 位置沒有規範嗎? 包含多個 repo / project 的 worktree / handoff ... 目前看起來是很混亂靠模型自己處理".
Answer after a repo-wide inventory (an Explore subagent, three citations spot-checked by depth-0): **only the dispatch rails have an enforced rule; everything a person or the model opens by hand is undefined.**

## Inventory (2026-10-12, develop @ 003c4c6b + feat/mods-pane-navigation)

| Artifact | Location rule | Defined at | Status |
|---|---|---|---|
| Hetero dispatch worktree (l5/l6 rails) | `mktemp -u -d -t "hetero-<branch>-XXXXXX"` → `$TMPDIR`/`/tmp` | `scripts/dispatch-hetero.sh:2921` | enforced (script) |
| Foreman worktree | `mktemp -t "foreman-<run_id>-XXXXXX"` | `scripts/dispatch-foreman.sh:268` | enforced |
| Batch integration worktree | `mktemp -t "batch-integ-…"` | `scripts/dispatch-batch.sh:388` | enforced |
| Red/green verify worktrees | `$WT_TMP/head`, `$WT_TMP/base` | `scripts/verify-red-green.sh:629-630` | enforced |
| Test-integrity L1 worktrees | `mkdtemp autopilot-l1-` | `scripts/lib/test-integrity-l1.py:996` | enforced |
| Claude Code native `Agent(isolation:"worktree")` | `<repo>/.claude/worktrees/agent-<agentId>` (platform) | `skills/ceo-agent/references/level-front-door.md:435` | platform behaviour, prose only |
| Native worktree base ref | `worktree.baseRef` setting, default `origin/develop` | `level-front-door.md:514-524` | prose |
| Human / `EnterWorktree` worktrees | nothing | — | **undefined** |
| `.claude/worktrees/` ignored | `.gitignore:17` | — | enforced |
| Handoff, active project | `<projects_dir>/<project>/HANDOFF.md` (`resolve-project-paths.sh`) | `skills/handoff/SKILL.md:32-35` | resolver is a script, the choice is prose, nothing checks it |
| Handoff, fallback | `~/.autopilot/handoff-manual/<repo-or-cwd-name>.md` | `skills/handoff/SKILL.md:36-38` | prose |
| Machine handoff on `/clear` | `~/.autopilot/handoff/<repo-hash>.md` | `hooks/session-handoff.js:37` | hook, default off |
| Session-mode marker | `~/.autopilot/session-mode/<sid>.json` (carries `repo_identity`, `project_key`) | `scripts/session-mode.js:159` | enforced |
| Live state | `$AUTOPILOT_LIVE_DIR` > `$XDG_RUNTIME_DIR/autopilot` > fallbacks | `scripts/lib/live-state-dir.js:10-12` | enforced |
| Foreman run dir | `${TMPDIR:-/tmp}/autopilot-foreman-runs/<run_id>` | `scripts/dispatch-foreman.sh:14,211` | enforced |
| Worktree ownership marker | `$WT/.autopilot-worktree` (+ `.lock`), root = run id | `scripts/lib/worktree-reap.sh:15,168-201` | enforced |
| Branch ledger / lifecycle roots | `<git-common-dir>/autopilot-worktree-*`, `refs/autopilot/lifecycle-roots/…` | `scripts/reap-dispatch-worktrees.sh:83,105-137` | enforced, per repo |
| Evidence | `docs/plans/evidence/<date>-<slug>/` | BACKLOG usage only | prose convention |

Repo identity exists (`scripts/lib/repo-identity.sh:20-30` → `git-common-dir:<realpath>`) but is only written into manifests and reaper keys; it never decides a path.

## Gaps

1. **Two unrelated worktree roots.** Rails: `$TMPDIR/<prefix>-XXXXXX`. Native/hand-made: `<repo>/.claude/worktrees/<name>`. No config key, resolver or doc section states where a worktree goes.
2. **No per-repo / per-project grouping.** Rail worktrees of different repos sit side by side in `/tmp`; the repo is recoverable only from a marker or manifest, not from the path.
3. **Name ↔ branch ↔ task are unrelated for hand-made worktrees.** Live example: this session's worktree is `.claude/worktrees/autocompact-detect` but has `feat/mods-pane-navigation` checked out — after the previous task merged, the next task branched inside the same worktree and nothing objected.
4. **Handoff placement is prose and keyed inconsistently.** The manual fallback keys by directory basename (two repos with the same basename collide; not per worktree); the `/clear` hook keys by repo hash. A session cannot predict where the other route wrote.
5. **Cross-repo dispatch has no rule.** A session in repo A working on repo B has `resolve-project-paths.sh --target <dir>` for documents and nothing for worktrees or handoff.
6. **The session marker's `repo_root` is fixed at creation and never follows the session into a worktree.** Live example (2026-10-12): this session created its marker in the main checkout, then worked in `.claude/worktrees/autocompact-detect`; `stage-advance --to verify` measured E1 with `git diff --numstat <base_ref>` in `repo_root` (`scripts/stage-advance.js:173`), i.e. the main checkout's develop (34 files, 1184 lines — other sessions' merges) instead of the branch (8 files, ~500 lines), and demanded an M→L bump. Worked around by clearing and re-creating the marker from inside the worktree. The resolver above should give the marker the worktree the session actually works in, or E1 should measure the cwd's toplevel when it shares the marker's `repo_identity`.
   6b. **`base_ref` defaults to a stale local branch.** `defaultBaseRef` (`scripts/session-mode.js:692-698`) tries `develop` before `origin/develop`. In a worktree whose main checkout has not pulled, local `develop` lags: on 2026-10-12, `set --new-task` right after a merge pushed `origin/develop` to `4abd667f` stored `base_ref 7586c8dd` (local `develop`, several merges behind), which would again inflate E1. Worked around with `--base-ref 4abd667f`. The default should prefer whichever of the local and remote-tracking branch is ahead, or the remote one when the local one is its ancestor.
7. Related, already filed: orphan / never-registered worktrees are not discovered (BACKLOG "Orphan leaf liveness and resource reconstruction"); `repo-residue-sweep.js:644` only flags `<main>/.claude/worktrees/` for review.

8. **A worktree-isolated session cannot bring the main checkout up to date, not even through the owner's `!` command.** After the mods merge was pushed (2026-10-12), the main checkout's `develop` (the live plugin) stayed two merges behind; `! git -C /home/cookys/projects/autopilot pull --ff-only` was refused by the session's worktree guard, and from inside the worktree git refuses to move a branch checked out elsewhere. The owner had to pull from another terminal. The finish step that pushes should tell the owner that line, or the rule should say where the integration checkout lives. (Resolved 2026-10-17: `repo-residue-sweep.js close-session --yes` prints the line when the main checkout lags.)

Second live example of gap 3 (2026-10-12): the next task (`feat/worktree-placement-rule`) also branched inside `.claude/worktrees/autocompact-detect` — three tasks, one worktree name.

## Direction (not decided — needs a plan, likely L)

- One resolver (`scripts/resolve-worktree-path.*` or a field on `resolve-project-paths.sh`) that every rail and every skill asks: `<root>/<repo-identity-slug>/<task-slug>`; root configurable, default chosen once (in-repo `.claude/worktrees/` vs `$XDG_DATA_HOME`/`~/.autopilot/worktrees/`).
- First find out how far Claude Code's native worktree placement can be steered (`EnterWorktree` arguments, `worktree.*` settings, `isolation:"worktree"` path) — a Spike, not an assumption (CLAUDE.md "Don't claim … without verifying").
- A check at session start / `stage-advance --to intent` (`--new-task`): worktree name and branch agree with the marker's task, or the session is told to open a fresh worktree.
- Handoff keyed by the marker's `repo_identity` (+ worktree path) on both routes, so the manual skill and the `/clear` hook write to one predictable place.
- The rails' `/tmp` worktrees either move under the same root or carry the repo slug in their prefix.

## Disposition (2026-10-12, plan `docs/plans/2026-10-12-worktree-placement.md`, direction C)

The rule now lives in [`references/worktree-placement.md`](../../references/worktree-placement.md).

| Gap | Disposition |
|---|---|
| 1 two unrelated roots | fixed — P2: rails create worktrees under `<main checkout>/.claude/worktrees/` through `scripts/resolve-repo-placement.js`; P4 rule |
| 2 no per-repo grouping | fixed — P2: the path names the repo's main checkout |
| 3 name ↔ branch ↔ task unrelated | fixed as far as the plan goes — P3: `set --new-task` advisory (never blocks); P4 rule |
| 4 handoff keying | fixed — one resolver for both routes (P2), used by the hooks and the handoff skill (P3); the keys differ on purpose (rule § Handoff files) |
| 5 cross-repo dispatch | deferred — BACKLOG "Cross-repo dispatch has no worktree or handoff rule" |
| 6 marker `repo_root` fixed at creation | fixed — P1: the marker follows the session into a worktree of the same repo |
| 6b stale `base_ref` | fixed — P1: newer of the local / remote-tracking pair |
| 7 orphan worktrees not discovered | out of scope — already filed (BACKLOG "Orphan leaf liveness…"); the sweep no longer busy-skips marked rail worktrees under `.claude/worktrees/` |
| 8 owner cannot pull from an isolated session | partly fixed — `resolve-repo-placement.js main` prints how far behind the main checkout is, the rule gives the owner line; finish-flow wiring deferred (BACKLOG "finish-flow does not tell the owner…") |
