# Worktree and handoff placement

Where a repo's worktrees and handoff files go, who puts them there, and why the two handoff routes use
different keys. One resolver answers every path question: [`scripts/resolve-repo-placement.js`](../scripts/resolve-repo-placement.js).
Decisions and evidence: [`docs/plans/2026-10-12-worktree-placement.md`](../docs/plans/2026-10-12-worktree-placement.md).

## The rule

**Every worktree of a repo lives under one root: `<main checkout>/.claude/worktrees/`**, whoever creates it.
The main checkout is the parent of the repo's `.git` directory (`git rev-parse --git-common-dir`), found the same
way from the main checkout and from any linked worktree, so every worktree of one repo shares one root and the
path says which repo it belongs to.

| Who creates it | Name under `.claude/worktrees/` | How |
|---|---|---|
| A person, `claude -w <name>`, `EnterWorktree`, a subagent with `isolation: "worktree"` | `<name>` (subagents: `agent-<id>`); branch `worktree-<name>` unless created by hand | Claude Code's own placement; autopilot does not take it over (no `WorktreeCreate` hook) |
| `dispatch-hetero.sh` | `hetero-<branch>-XXXXXX` | `resolve-repo-placement.js worktree --prefix hetero --slug <branch> --from <repo root>` |
| `dispatch-foreman.sh` | `foreman-<run_id>-XXXXXX` | same, `--prefix foreman` |
| `dispatch-batch.sh` (integration worktree) | `batch-integ-<run_id>-XXXXXX` | same, `--prefix batch-integ` |

Claude Code's own behaviour here (names, branch, sweep, prompts, isolation) is from the docs and runs recorded in
[`spike-native-worktree.md`](../docs/plans/evidence/2026-10-12-worktree-placement/spike-native-worktree.md); the
refused `!` pull is gap 8 of [the backlog note](../docs/backlog/worktree-and-handoff-placement-has-no-rule.md).

- **Name a hand-made worktree after its task**, and open a fresh one for the next task instead of branching a new
  task inside the old one. `session-mode.js set --new-task` prints one advisory line when the worktree's directory
  name and its branch share no word (generic words such as `feat`, `fix`, `wip` and digit-only words do not count).
  It never blocks.
- **Fallback**: a repo with no non-bare main checkout (a bare repo, a separate `--git-dir`) keeps rail worktrees in
  the temp dir, and the resolver says so on stderr. So does a main checkout where `.claude/worktrees` cannot be
  created (read-only, or `.claude` is a file). The residue registry still lists those temp prefixes.
- **Stay in the temp dir**: the `verify-red-green.sh` and test-integrity-L1 scratch worktrees. They are
  short-lived, removed by their own script, and never handed to a person.

### What follows from one root

- Rail worktrees carry the `.autopilot-worktree` marker; liveness is the marker's lock, not a process cwd.
  `repo-residue-sweep.js` skips a busy worktree under `.claude/worktrees/` only when it has no valid marker.
- `orchestrator-edit-gate` treats a marked worktree under `.claude/worktrees/` as a dispatch worktree (depth-0
  gated, subagents free), exactly as it treats one in the temp dir. An unmarked one is part of the repo's
  `.claude/` tree, which the gate already allows.
- The main-checkout boundary fingerprint skips `.claude/worktrees/`: each worktree there is another checkout with
  its own review.
- Repo-tree walkers that start at the main checkout (`identifier-scan.js`, `probe-unknown.js`,
  `lib/worktree-activity.js`) skip `.claude/worktrees/`.
- The rails add `/.claude/worktrees/` to the repo's shared `info/exclude`, so a consumer repo that does not ignore
  that path sees no untracked entries. Its tracked `.gitignore` is not edited.
- Claude Code's periodic worktree sweep only removes worktrees it created itself, so it never removes a rail
  worktree there; `EnterWorktree` into `.claude/worktrees/` needs no prompt.

## The session marker follows the session

`session-mode.js set --new-task`, or `set` with `--size`, `--urgent`, `--bug` or `--base-ref` (and no `--level`, or `--level none`),
moves the marker's `repo_root` to the toplevel it runs in
when that toplevel belongs to the same repo (same repo identity), and `stage-advance.js` measures the E1 diff in
that worktree. A cwd in another repo leaves the marker alone. Where `base_ref` is derived (a marker without one,
`set --new-task`), it defaults to the newer of `develop` and `origin/develop` (then `main`, `master`), so a
main checkout that has not pulled does not inflate E1. Any other `set` on an existing marker keeps the `base_ref` it already has (a
size bump never moves the diff base): when the marker was created in a main checkout that lagged, run
`set --new-task` (or pass `--base-ref`) inside the worktree to re-derive it.

## Handoff files

| Route | Path | Key | Consumed by |
|---|---|---|---|
| Active project | `<projects_dir>/<project>/HANDOFF.md` | the project (`resolve-project-paths.sh`) | whoever resumes the project |
| Manual (`/handoff` without a project) | `~/.autopilot/handoff-manual/<repo name>-<8 hex>.md` | `sha1(repo identity)` — **one file per repo**, shared by its worktrees; outside a repo, `sha1(cwd)` | a later session in any worktree of the repo |
| `/clear` hook | `~/.autopilot/handoff/<sha1>.md` | `sha1(realpath of the worktree's toplevel)` — **one file per worktree** | the next session started in that same worktree |

Ask for a path with `resolve-repo-placement.js handoff --route manual|clear [--from <dir>]`; the hooks call its
`clearHandoffKey()`. The keys differ on purpose: the manual handoff is written for a person or a later session to
find from anywhere in the repo, while the `/clear` handoff is injected automatically, and a per-repo key would let a
parallel session in a sibling worktree consume it.

## Bringing the main checkout up to date

A Claude Code session isolated in a worktree (`--worktree`, `EnterWorktree`) cannot move the main checkout's
branch: git refuses to update a branch checked out elsewhere, and the session's isolation refuses git commands
aimed at the main checkout, including the owner's `!` commands typed into that session. After a push, the owner runs
this from a terminal that is not the isolated session:

`repo-residue-sweep.js close-session --yes` prints the line for you when the main checkout lags; the manual form:

```bash
node <plugin>/scripts/resolve-repo-placement.js main --from <any worktree of the repo>
# {"main_checkout": "...", "behind": N, ...}  — N commits behind its upstream
git -C <main_checkout> pull --ff-only
```

## Not covered

- A session in repo A dispatching a rail at repo B: no rule yet (BACKLOG row).
- (done) The pull line is printed automatically: `repo-residue-sweep.js close-session --yes`, which finish-flow's
  Dispatch-branch close-out row already runs, writes it to stderr when the main checkout is behind its upstream.
