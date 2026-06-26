# Heterogeneous Dispatch — outbound shell-out to non-Claude engines

Claude Code dispatching another coding engine (Antigravity `agy` + Gemini, verified; others by the same pattern once spiked) as a **headless implementer**, via Bash. This is the outbound counterpart of [`multi-agent-portability.md`](multi-agent-portability.md)'s hosting story: autopilot doesn't just *run on* many agents — a Claude Code session can *dispatch across* them.

Empirical basis: [`multi-agent-portability.md`](multi-agent-portability.md) § "Verified by Spike (agy 1.0.5 headless dispatch, 2026-06-11)". First production use: the `_bodies` relocation (merged `a83c04a`), implemented by Gemini 3.5 Flash from a six-element Task Prompt.

## When to reach for it

- **Decorrelated second opinion** — a different model family reviewing or re-deriving reduces same-family blind spots (the same independence logic as [`blind-dispatch.md`](blind-dispatch.md), applied to model choice).
- **Cost arbitrage** — flash-class models for mechanical, well-specified implementation or research fan-out.
- **Engine diversity probing** — checking whether a behavior is model-specific.

Not for: anything needing autopilot skills inside the executor (unverified — see Unverified below), or tasks too fuzzy for a six-element contract (fix the contract first; that's the planner's job).

## Invariants (non-negotiable)

1. **Worktree isolation is mandatory, not advisory.** agy has no `--allowedTools`-grade granular allowlist; `--dangerously-skip-permissions` is all-or-nothing. [`scripts/dispatch-hetero.sh`](../scripts/dispatch-hetero.sh) hard-codes this rail — there is no flag to run in the main checkout.
2. **Verify by artifacts, never by self-report.** Observed failure mode: the agent claimed success while skipping the requested commit-hash output. The script reports commit presence, diff stats, and tree cleanliness from `git`, not from the agent's prose.
3. **Verdict stays at depth 0.** The shelled-out engine implements; the dispatching Claude Code session reviews the branch diff (quality-pipeline) before merge. A hetero implementer never self-certifies — same invariant as [`blind-dispatch.md`](blind-dispatch.md) § Nested dispatch.
4. **The contract is the prompt.** The executor has no autopilot plugin; methodology travels inside the six-element Task Prompt (goal / scope / input / output / acceptance / boundaries). Planner output is the native input format.

## Script

```bash
scripts/dispatch-hetero.sh --branch feat/<task> --prompt-file /tmp/task.md \
    [--model "Gemini 3.5 Flash (High)"] [--base develop] [--timeout 9m]
```

JSON to stdout: `{status, runner, model, branch, base, commit, files_changed, insertions, deletions, worktree, agent_log, error}` (`runner` is always `"agy"`, `model` echoes `--model` — **engine provenance** the caller records in its run-summary ledger; consumed by the `/l5` impl row, [`skills/ceo-agent/references/level-front-door.md`](../skills/ceo-agent/references/level-front-door.md)). Exit 0 = committed + clean tree + agent exit 0 (worktree auto-removed; **branch survives** for review/merge). Exit 1 = ran but did not yield a reviewable clean commit (`dirty` / `failure` / `no_op` / `question_suspected` — see Outcome states; worktree **kept** for inspection). Exit 2 = precondition failure. The agent's stdout/stderr are written to a temp file; **`agent_log` contains that file's path, not the log text** — read the file to inspect agent output.

### Outcome states

The no-commit case is **split by how the worker ended** so a legitimate no-op task is not confused with a stalled/paused one. The split is CLI-agnostic — it reads git artifacts + the already-captured `AGENT_EXIT`, with **zero stream parsing** (no `--output-format` / no question-mark heuristic; a heuristic on the assistant stream would be scrape-equivalent and is out of scope).

| `status` | Condition | Meaning | Exit |
|----------|-----------|---------|------|
| `committed` | new commit + clean tree + agent exit 0 | **success** — the only path that returns 0; branch is ready for review/merge | 0 |
| `failure` | new commit + clean tree but agent **exit ≠ 0** | the worker left a commit but ended abnormally; **not** scored success (a non-zero exit is never `committed`) | 1 |
| `dirty` | new commit but tree left uncommitted-dirty | the worker committed then kept editing; not a reviewable clean state | 1 |
| `no_op` | **no** new commit + agent **exit 0** | the agent legitimately judged nothing was needed; not a dispatch failure. **(agy/Gemini, pre-v2.25.9: a `no_op` here usually meant agy invented a scratch project instead of editing the worktree — agy `-p` ignores process cwd. Fixed v2.25.9: the agy directive now PREPENDS an absolute-worktree anchor, so agy edits in place — verified single- and multi-file. A `no_op` from agy now means what it says.)** | 1 |
| `question_suspected` | **no** new commit + (timeout **or** exit ≠ 0) | the worker likely **paused on a clarifying question** (auto-approve / `--dangerously-skip-permissions` does *not* silence the model's own question — see [`blind-dispatch.md`](blind-dispatch.md) § "Clarifying questions survive auto-approve") or otherwise stalled | 1 |

The caller distinguishes "nothing needed" (`no_op`) from "blind hang" (`question_suspected`) at ~20 lines of shell, surfacing the real pain — a silently hung worker — without any new always-on LLM or stream parser in the dispatch path.

### Deferred — stream-json "live question" rail (spike-gated, NOT built)

A richer signal — a *live* "the model is asking a question" event from `--output-format stream-json` — is **deferred behind an existence spike, not committed**. `claude -p --output-format stream-json` is known to emit `assistant` / `tool_use` / `tool_result` / `result`; whether any of `claude` / `codex exec` / `gemini -p` emits a **machine-distinguishable** "asking a question" event is unverified. **Before any parser code**, a spike must capture real runs and answer "does the event even exist." If it does not, the rail is invalid (a question-mark heuristic would be scrape-equivalent) and stays unbuilt. Recorded sample files are the spike deliverable; any future parser is tested against the recording, never a live CLI. Tracked in the plan's §8, not here.

After exit 0: review `git diff <base>..<branch>` through quality-pipeline, then merge or discard the branch.

### Cleanup (caller's responsibility — both are deliberate persistence)

- `agent_log` file: persists on every path (it is the only record of agent output, including on success). `rm` it after reading.
- Kept worktrees (exit 1, or `--keep-worktree`): `git worktree remove --force <path>` **then `git branch -D <branch>`** (the JSON `branch` field) when done — `git worktree remove` does NOT delete the branch, so a non-success dispatch leaves a stale `hetero/<name>` branch otherwise. If the script was interrupted mid-run, the worktree may be orphaned — `git worktree list` / `git worktree prune` to find and clear, then `git branch -D` the orphan branch.
- Interrupt trap: `scripts/dispatch-hetero.sh` installs a `TERM` trap (and an `INT` trap for the atypical parent-only-INT case) that self-reaps its worktree + branch if the run is killed mid-agy, disarming once agy returns. A **Ctrl-C** (INT to the whole process group) does NOT hit the trap — agy dies and the run routes through the normal `question_suspected` exit-1 path with the worktree **kept for inspection** (verified empirically 2026-06-22).

## Role-prompt reuse (engine-neutral bodies)

[`.opencode/agent-bodies/*.body.md`](../.opencode/agent-bodies/) are frontmatter-free role prompts generated for OpenCode — but plain markdown is engine-neutral. Feeding `reviewer.body.md` + a diff to `agy -p` yields a methodology-carrying heterogeneous reviewer with zero new files. (The directory is named for its primary consumer; this secondary use is intentional.)

## Unverified — spike before asserting

- ~~agy with the autopilot plugin installed: do skills load in `-p` mode?~~ **Resolved 2026-06-11: NO** — verified negative (probe + tool-inventory; see [`multi-agent-portability.md`](multi-agent-portability.md) § agy spike). Invariant 4 ("the contract is the prompt") is therefore a necessity, not a preference. Interactive-mode loading untested.
- agy `-p` exposes `define_subagent` / `invoke_subagent` / `manage_subagents` — a native subagent surface inside the headless executor. Semantics unprobed; could matter if a dispatched phase wants its own fan-out.
- Other engines' headless equivalence (`gemini` CLI, `codex` CLI, `opencode run`): same spike shape as the agy one — prove full agentic loop + flags before writing them here.

## Shell-level guard for raw agy calls

The guarded installer only protects its own path. For raw `agy plugin install/uninstall` typed in a shell, source [`scripts/agy-shell-guard.zsh`](../scripts/agy-shell-guard.zsh) in your `~/.zshrc` — it blocks plugin operations while any symlink sits in `~/.gemini/config/plugins/` (the agy ≤ 1.0.7 data-loss kill condition; see [`multi-agent-portability.md`](multi-agent-portability.md) § agy spike). Note: `agy -p` dispatch (this doc's subject) was never the dangerous path — the wrapper passes it straight through.

## QC panel judges ride the same recipe

`scripts/qc-panel.sh` (task-tree engine P4) dispatches its Gemini judge via the same
`agy -p` plumbing this doc describes — read-only judging in a throwaway dir with only
the intended inputs, file-write verdict, `--print-timeout 8m`,
`--dangerously-skip-permissions`. The judge path never mutates a repo, so the worktree
rail is replaced by the throwaway-dir rail; everything else (artifact-based verification,
never trust self-report) carries over. Spike caveats: `multi-agent-portability.md` §7.

## No skill yet — deliberately

Two real uses so far. Per the distill philosophy (extract skills from recurring practice, not speculatively), the skill wrapper waits for recurrence — trigger tracked in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
