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

JSON to stdout: `{status, branch, base, commit, files_changed, insertions, deletions, worktree, agent_log, error}`. Exit 0 = committed + clean tree (worktree auto-removed; **branch survives** for review/merge). Exit 1 = ran but `no_commit` / `dirty` (worktree **kept** for inspection). Exit 2 = precondition failure. The agent's stdout/stderr are written to a temp file; **`agent_log` contains that file's path, not the log text** — read the file to inspect agent output.

After exit 0: review `git diff <base>..<branch>` through quality-pipeline, then merge or discard the branch.

### Cleanup (caller's responsibility — both are deliberate persistence)

- `agent_log` file: persists on every path (it is the only record of agent output, including on success). `rm` it after reading.
- Kept worktrees (exit 1, or `--keep-worktree`): `git worktree remove --force <path>` when done. If the script was interrupted mid-run, the worktree may be orphaned — `git worktree list` / `git worktree prune` to find and clear.

## Role-prompt reuse (engine-neutral bodies)

[`.opencode/agent-bodies/*.body.md`](../.opencode/agent-bodies/) are frontmatter-free role prompts generated for OpenCode — but plain markdown is engine-neutral. Feeding `reviewer.body.md` + a diff to `agy -p` yields a methodology-carrying heterogeneous reviewer with zero new files. (The directory is named for its primary consumer; this secondary use is intentional.)

## Unverified — spike before asserting

- ~~agy with the autopilot plugin installed: do skills load in `-p` mode?~~ **Resolved 2026-06-11: NO** — verified negative (probe + tool-inventory; see [`multi-agent-portability.md`](multi-agent-portability.md) § agy spike). Invariant 4 ("the contract is the prompt") is therefore a necessity, not a preference. Interactive-mode loading untested.
- agy `-p` exposes `define_subagent` / `invoke_subagent` / `manage_subagents` — a native subagent surface inside the headless executor. Semantics unprobed; could matter if a dispatched phase wants its own fan-out.
- Other engines' headless equivalence (`gemini` CLI, `codex` CLI, `opencode run`): same spike shape as the agy one — prove full agentic loop + flags before writing them here.

## No skill yet — deliberately

Two real uses so far. Per the distill philosophy (extract skills from recurring practice, not speculatively), the skill wrapper waits for recurrence — trigger tracked in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
