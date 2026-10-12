# Spike — how far Claude Code's native worktree placement can be steered (2026-10-12)

Question from `docs/backlog/worktree-and-handoff-placement-has-no-rule.md` (Direction, bullet 2).
Method: a `claude-code-guide` subagent (sonnet) read the official docs and cited each claim; depth-0 then
re-read the decisive section itself (`https://code.claude.com/docs/en/hooks`, WorktreeCreate /
WorktreeRemove, fetched 2026-10-12) and confirmed every hook row below. Rows marked *agent-cited* were not
re-read by depth-0.

| Capability | Answer | Name / syntax | Source |
|---|---|---|---|
| Default location | `<repo>/.claude/worktrees/<name>/`, branch `worktree-<name>` | — | `worktrees.md` (agent-cited) |
| `EnterWorktree` args | `{name?, path?}`; no base-ref argument. `path` outside `.claude/worktrees/` asks the user | — | `agent-sdk/typescript.md#enterworktree`, `tools-reference.md` (agent-cited) |
| `claude -w [name]` | name, `#123` or PR URL (`pr-<n>`) | `--worktree` | `cli-reference.md` (agent-cited) |
| Settings that move the path | none for the CLI; `worktree.location` is read only by Desktop SSH | `worktree.location` | `settings-reference.md` (agent-cited) |
| Other settings | `worktree.baseRef` = `fresh` (origin default branch) \| `head`; `symlinkDirectories`, `sparsePaths`, `bgIsolation`; `.worktreeinclude` | — | `settings-reference.md` (agent-cited) |
| **WorktreeCreate hook** | Fires for `--worktree`, `EnterWorktree`, subagent `isolation: "worktree"`, workflow agents, background sessions, remote-control worktree mode. Input adds `name`. A command hook prints the path on stdout (last line); an HTTP hook returns `hookSpecificOutput.worktreePath`. Failure or no path fails creation. **Replaces git creation entirely**; `.worktreeinclude` is not processed. Paths with `.`/`..` or through a symlink below the repo root are refused (v2.1.216+). No matcher support | `WorktreeCreate` | hooks.md (re-read) |
| `git worktree add` via Bash | WorktreeCreate does **not** fire; only a `PreToolUse` Bash hook sees it | — | hooks.md (re-read) |
| **WorktreeRemove hook** | Fires only for hook-created worktrees, on interactive exit / `ExitWorktree` / background-session delete / remote-control cleanup. **Not** when a subagent or workflow agent finishes: those hook-created worktrees are kept and must be removed by the owner. Claude Code never deletes a branch of a hook-created worktree. Input adds `worktree_path`; exit code decides; JSON discarded | `WorktreeRemove` | hooks.md (re-read) |
| Branch name | not configurable (no key or argument documented) | — | `worktrees.md` (agent-cited) |

## What a plugin can enforce

- **Choose the path: yes, only via a `WorktreeCreate` hook**, and then it owns everything git did: `git worktree
  add` (path and branch), the `.worktreeinclude` copy, and removal (a paired `WorktreeRemove`, plus its own reaping
  for subagent / workflow worktrees, which Claude Code no longer removes).
- **Veto: yes** (non-zero exit fails creation).
- **Observe or block a hand-run `git worktree add`: only a `PreToolUse` Bash hook.**
- **Settings: no path control** for CLI sessions.

## Consequence for the design

Taking over native creation is a large surface (every `isolation: "worktree"` subagent and every background
session would go through autopilot code, and their cleanup becomes autopilot's job). A smaller first step that
needs no takeover: keep Claude Code's `<repo>/.claude/worktrees/<name>` as the one root for hand and native
worktrees, make the rails say where theirs go, and check name/branch/task agreement at task start.

## Follow-up for direction C — does Claude Code's sweep touch foreign worktrees in `.claude/worktrees/`?

Re-read by depth-0: `https://code.claude.com/docs/en/worktrees`, "Clean up subagent and background-session
worktrees", fetched 2026-10-12. Quoted:

> Claude Code writes a marker into the git metadata of every worktree it creates with git, and the sweep keeps any
> worktree without one, including a worktree a `WorktreeCreate` hook created.

and, in the list of cases the sweep leaves in place:

> You created the worktree yourself with `git worktree add`, even if you then ran a `--worktree <name>` session in
> it and backgrounded that session.

So a rail worktree placed under `<main checkout>/.claude/worktrees/` by `git worktree add` is never removed by the
periodic sweep. Two further facts from the same page that matter for C:

- `EnterWorktree` into a path under the repository's `.claude/worktrees/` does not ask the user; a path outside it
  does (v2.1.206+). Rail worktrees moving there makes them enterable without a prompt.
- A worktree in the default location does not load the `CLAUDE.md` / `.claude/rules/` at its own root for a
  subagent reading files there; project skills/agents/commands read through to the main checkout when the worktree
  has none. Neither changes what a rail's headless runner loads (it is launched with its own cwd).

Still to check inside the repo (plan, not docs): tree walkers that recurse from the main checkout root (they now
see nested worktrees under `.claude/worktrees/`), the residue registry kinds keyed on `/tmp` prefixes, and the
reapers' unmarked-recovery `case` on the basename.

## Follow-up for direction C — is a hand launched under `.claude/worktrees/` put under isolation?

Run 2026-10-12, Claude Code 2.1.296, script [`spike-isolation.sh`](spike-isolation.sh) (its paths point at the session scratchpad): a scratch repo
with `.claude/worktrees/` gitignored, `git worktree add -b spike-x <repo>/.claude/worktrees/spike-x`, then from
inside it `claude -p --model claude-haiku-5-5 --permission-mode bypassPermissions --allowedTools=Bash` asked to run
`git status --short && git log -1 --oneline && git -C ../../.. log -1 --oneline`. Result: rc 0, both log lines
printed (`1a4ce12 ignore` twice) — the compound command and the `git -C` into the main checkout both ran.

So a plain launch in a `git worktree add` worktree under `.claude/worktrees/` is not isolated; only `--worktree`,
`EnterWorktree` and resume of such a session are (as the docs list). Rail hands launched there keep today's
command freedom. The isolation checks this session hit all along come from this session itself being a
`--worktree`/`EnterWorktree` session, not from the location.
