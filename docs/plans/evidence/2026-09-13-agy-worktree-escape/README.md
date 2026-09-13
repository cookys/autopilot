# agy hand escapes its worktree — reproduced 2026-09-13 (agy 1.2.2, gemini-3.8-flash-medium)

Report: `308-8f` (this machine), kimi foreman probe `railprobe-2142` — `dispatch-hetero.sh --runner agy`
built `/tmp/hetero-hands-…` but agy's log said `Repository: /home/cookys/projects/308` and committed to the
main checkout's `feat/homeforge` twice (boundary caught both: `boundary_rejected`, `main_checkout_mutated`).
Their evidence: 308 repo `docs/projects/2026-09-07-homeforge/phase-6-performance/evidence/foreman-rail-probe-20260913/`.

Reproduced here in a scratch repo (`agy-sbx`, linked worktree `agy-wt` on branch `hand`), cwd = the worktree:

| Probe | Command | Where the effect landed | File |
|---|---|---|---|
| 1 | `agy -p "create agy-probe.txt in your current working directory"` | the worktree (file tool honours process cwd) | `probe1.agy.json` |
| 2 | `agy -p "create docs/probe2.md, git add it, commit"` (relative path, like the 308 hand prompt) | **`/home/cookys/projects/autopilot` main checkout** — commit `0725d3c9 probe2` on `develop`, reset with `git reset --keep` before anything else ran | `probe2.agy.json` |
| root | `agy -p "write your workspace root to <abs>"` under the full env and under `env -i PATH HOME TERM` | both: `/home/cookys/projects/autopilot` — so NOT an inherited env var | `root-full-env.txt`, `root-clean-env.txt` |
| 3 | same as 2 with **`--new-project`** | the worktree: `7b4ce08 probe3` on `hand`, main checkouts untouched | `probe3.agy.json` |
| 4 | same as 2 WITHOUT the flag, after 3 | the worktree — because 3 created a conversation entry for this path | `probe4.agy.json`, `last_conversations-entry-after-new-project.txt` |

Mechanism: `~/.gemini/antigravity-cli/cache/last_conversations.json` maps a path to a conversation id. A
path with no entry (every fresh hands worktree) resumes a conversation of an ANCESTOR path (`/tmp` → an old
conversation) and inherits that conversation's repository memory; `run_command` then runs with a model-chosen
`Cwd` in that repository. The process cwd only reaches the file tools. `--new-project` starts the session
clean, which is why probe 3 lands in the worktree and probe 4 afterwards also does.

Fix shipped in v2.36.37: `dispatch-hetero.sh` and `dispatch-explore.sh` launch agy with `--new-project`.
`dispatch-review.sh`'s agy path already runs inside bwrap with its own cwd and app dirs and was not changed.
