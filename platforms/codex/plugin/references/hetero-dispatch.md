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
5. **Every brief carries a scale budget (gate 5).** The Task Prompt's HOW MUCH element MUST state a LOC-delta / files-touched ceiling (see [`skills/ceo-agent/references/task-prompt-templates.md`](../skills/ceo-agent/references/task-prompt-templates.md) § HOW MUCH). A worker that would exceed it STOPS and returns an `[ESCALATION]` to re-scope — it never silently grinds past the budget. A brief with no budget is incomplete.
6. **No bare multi-hour autonomous loop (gate 4).** A hetero implement/review loop that runs for hours MUST have a named depth-0 clock owner armed with the sensing watcher and the convergence brake ([`scripts/check-loop-convergence.js`](../scripts/check-loop-convergence.js) — gates 1 + 3; see [`skills/ceo-agent/references/level-front-door.md`](../skills/ceo-agent/references/level-front-door.md) § 裸跑禁令). Unwatched hours-long self-directed loops are the banned "bare run" shape.

## Script

```bash
scripts/dispatch-hetero.sh --branch feat/<task> --prompt-file /tmp/task.md \
    [--model "Gemini 3.5 Flash (High)"] [--base develop] [--timeout 9m]
```

JSON to stdout: `{status, runner, model, containment, contained, branch, base, commit, files_changed, insertions, deletions, worktree, agent_log, error, duplex}` (`runner` is `"codex"`, `"agy"`, `"grok"`, `"cc-shim"`, or `"pi"` per `--runner auto|codex|agy|grok|cc-shim|pi` — `auto` routes `*gpt*`/`*codex*` → codex, `*grok*`/`*composer*` → grok, else agy; `model` echoes `--model`; `containment`/`contained` carry teardown-hygiene provenance; `duplex` is `"rpc"` for `pi` and `null` for all other runners; all **engine provenance** the caller records in its run-summary ledger; consumed by the `/l5` impl row, [`skills/ceo-agent/references/level-front-door.md`](../skills/ceo-agent/references/level-front-door.md)). Exit 0 = committed + clean tree + agent exit 0 (worktree auto-removed; **branch survives** for review/merge). Exit 1 = ran but did not yield a reviewable clean commit (`dirty` / `failure` / `no_op` / `question_suspected` — see Outcome states; worktree **kept** for inspection). Exit 2 = precondition failure. The agent's stdout/stderr are written to a temp file; **`agent_log` contains that file's path, not the log text** — read the file to inspect agent output.

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

### pi (RPC duplex)

`--runner pi` drives `pi --mode rpc` in a dedicated supervisory process
([`scripts/lib/pi-rpc-run.js`](../scripts/lib/pi-rpc-run.js)). The supervisor spawns
`pi --mode rpc --provider <provider> --model <model> --session-dir <dir>`, forwards the
native JSONL event stream verbatim to the dispatch log (`agent_end`, `message_end`,
`tool_execution_*`, ...), and prepends an EDIT-ONLY harness directive to the task prompt. The
dispatch declares `log_format: "pi-rpc"` and emits ADDITIVE `duplex: "rpc"` in both final
JSON and manifest for contract-aware consumers. **pi RPC is a persistent server — it does NOT
exit after `agent_end`** (it waits for the next prompt), so the supervisor proactively shuts it
down on `agent_end` (stdin EOF → SIGTERM → SIGKILL) and scores success on the OBSERVED
`agent_end` + prompt response, never on pi's self-exit code (waiting for that would deadlock —
verified live 2026-07-11).

Usage is derived from declared `pi-rpc` parsing only: `message_end` messages are parsed from
`message.usage` and aggregated (`input`/`output`/`cacheRead`), with `usage_source: "pi-rpc"`.
`pi-rpc` is intentionally separated from the generic JSONL scanner so nested `cost` fields cannot
pollute totals. A stalled stream gets one report-only `supervisor_stall_probe` steer injection
(`no_event_timeout`) and remains report-only by default unless `PI_RPC_MAX_SECS` is set.
Evidence + residuals: [`docs/projects/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md`](../docs/projects/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md). The trust rails
(`worktree` isolation, wrapper-commit, artifact verification) remain unchanged.

### Deferred — stream-json "live question" rail (spike-gated, NOT built)

A richer signal — a *live* "the model is asking a question" event from `--output-format stream-json` — is **deferred behind an existence spike, not committed**. `claude -p --output-format stream-json` is known to emit `assistant` / `tool_use` / `tool_result` / `result`; whether any of `claude` / `codex exec` / `gemini -p` emits a **machine-distinguishable** "asking a question" event is unverified. **Before any parser code**, a spike must capture real runs and answer "does the event even exist." If it does not, the rail is invalid (a question-mark heuristic would be scrape-equivalent) and stays unbuilt. Recorded sample files are the spike deliverable; any future parser is tested against the recording, never a live CLI. Tracked in the plan's §8, not here.

After exit 0: review `git diff <base>..<branch>` through quality-pipeline, then merge or discard the branch.

### Cleanup (caller's responsibility — both are deliberate persistence)

- `agent_log` file: persists on every path (it is the only record of agent output, including on success). `rm` it after reading.
- Kept worktrees (exit 1, or `--keep-worktree`): `git worktree remove --force <path>` **then `git branch -D <branch>`** (the JSON `branch` field) when done — `git worktree remove` does NOT delete the branch, so a non-success dispatch leaves a stale `hetero/<name>` branch otherwise. If the script was interrupted mid-run, the worktree may be orphaned — `git worktree list` / `git worktree prune` to find and clear, then `git branch -D` the orphan branch.
- Interrupt trap: `scripts/dispatch-hetero.sh` installs a `TERM` trap (and an `INT` trap for the atypical parent-only-INT case) that self-reaps its worktree + branch if the run is killed mid-agy, disarming once agy returns. A **Ctrl-C** (INT to the whole process group) does NOT hit the trap — agy dies and the run routes through the normal `question_suspected` exit-1 path with the worktree **kept for inspection** (verified empirically 2026-06-22).

## Mid-run observability — run manifest + [`scripts/dispatch-status.js`](../scripts/dispatch-status.js)

A dispatch is no longer fire-and-forget (Stage 1, BACKLOG "Dispatch observability"). At START,
`dispatch-hetero.sh` and `dispatch-review.sh` write a **run manifest** to
`${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}/<run-id>.manifest.json`
(run_id, live log path, worktree, lock path, predicted containment, pid) and announce
`run_id=… manifest=…` on stderr — BEFORE blocking on the worker. The worker's event stream was
always streamed live to the log file; the manifest is what makes it findable mid-flight.

```bash
scripts/dispatch-status.js --run <run-id>      # one JSON line: phase/alive/stall/tokens/files
scripts/dispatch-status.js --list              # all manifests (started/ended)
scripts/dispatch-status.js --log <p> --summary # parse-only (events/tool_calls/tokens)
scripts/dispatch-status.js --reap [--days N] [--dry-run]  # retention reaper (see below)
```

- **Liveness** (advisory ordering): flock probe on the worktree lifetime lock (same contract as
  `_wt_is_live`; survives detach — the child inherits the fd) → cgroup scope → pid. Any positive
  signal ⇒ `alive:true` / `phase:"running"`; finalized manifest (`ended_at`) ⇒ `"exited"`.
- **Stall**: `alive` AND log mtime age > `--stall-secs` (default 180) ⇒ `stall:true`. Report-only —
  Stage 1 has NO auto-kill; killing stays the caller's call (`--gc`, `dispatch-batch.sh reap`).
- **Telemetry honesty**: events/tool_calls/tokens are parsed from the HARNESS event stream
  (codex-chrome `tokens used` footer — empirically fixtured; generic JSONL key scan), NEVER from
  worker self-report. The stream format is **dispatcher-declared** (manifest `log_format` /
  `--format`, derived from the invocation flags the dispatcher itself chose), never content-
  sniffed — a worker printing JSON usage lines into a plain-text log cannot promote its own
  output into telemetry. Formats carrying no signal (agy pseudo-TTY, cc-shim plain text) yield
  honest `null`, not fabricated numbers. `files_touched` is git-artifact-derived from the worktree.
- **Final JSON**: `dispatch-hetero.sh` output gains ADDITIVE `run_id` / `usage` / `wall_secs`
  (usage via `dispatch-status.js --usage-only`, embedded fail-safe — any parse failure ⇒ `null`).
  `dispatch-review.sh`'s final JSON is deliberately UNCHANGED (strict `additionalProperties:false`
  schema, v2.32.19 SSOT) — correlate a review run via its `raw_log` path and derive usage post-hoc
  with `--usage-only`.
- **Trust boundary unchanged**: all of this is SCHEDULING telemetry. Verdicts still come from git
  artifacts + fail-closed parsers only. Disable manifests with `AUTOPILOT_DISPATCH_MANIFEST=0`.

## Residue retention — startup log prune + manifest reaper

Dispatch residue used to accumulate with NO retention until it exhausted the host's `/tmp`
per-user quota (usrquota) and silently broke every harness Bash call on the machine
(2026-07-13 incident: 1910 `dispatch-review-log-*` + 616 test-fixture logs + 126
`pi-rpc-session-*` + 602 manifests ≈ 21 GiB). Two mechanisms now bound it:

- **Startup log prune** (`scripts/lib/prune-tmp-residue.sh`): each dispatch script
  (`dispatch-hetero.sh` / `dispatch-review.sh` / `dispatch-author.sh` / `dispatch-explore.sh`)
  best-effort prunes ITS OWN aged `${TMPDIR}` residue (raw logs, prompt temps, scratch cwds,
  pi sessions) at startup — items older than `${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}` days,
  own-user only, `-maxdepth 1`, fixed name prefixes. `0` disables. LOGS AND SCRATCH ONLY —
  worktrees are never blind-mtime-pruned (they carry a liveness lock; see next bullet).
- **Manifest reaper** (`dispatch-status.js --reap [--days N] [--dry-run]`, default 7 days):
  scans the runs dir; a LIVE run (flock/pid/scope probe) is never touched regardless of age;
  not-live manifests older than `--days` are deleted; a failure-kept worktree is removed ONLY
  on a DEFINITIVE dead lock verdict + the `.autopilot-worktree` marker + a free worktree lock
  (the `gc_stale_worktrees` eligibility contract), then the owner repo gets `git worktree
  prune`. Unmarked dirs and unparseable manifests are never deleted. Complements (not
  replaces) `dispatch-hetero.sh --gc`, which stays the config-gated worktree-only reaper.

## Wired engines (runners) — how to pick one

`--runner` (or `implementer_runner`/`reviewer_runner` in `.claude/review-loop-config.md`):

| Runner | Engine / models | Implementer | Reviewer | How to invoke / notes |
|--------|-----------------|:-:|:-:|------|
| `codex` | OpenAI `gpt-*`/`*codex*` | ✅ self-commits, can run build/test mid-turn | ✅ | default; `--effort` reasoning. Auto-selected for `*gpt*`/`*codex*` models. |
| `agy` | Google Gemini (Antigravity CLI) | ✅ can run build/test (sync foreground; auto-managed to completion, bounded by `--print-timeout` — the old "run_command 10s cap" is REFUTED on 1.0.14, see portability § 2026-07-02) | ✅ | needs interactive auth; absolute-worktree anchor (agy `-p` ignores cwd). Gotcha: no cross-call `&`/`nohup` bg jobs (each `run_command` = isolated subshell, reaps its children) — run long tasks as ONE sync command. |
| `grok` | xAI `grok-4.5` (upstream renamed from `grok-build`, verified 2026-07-14), `grok-composer-2.5-fast` | ✅ EDIT-ONLY + wrapper-commit | ✅ read-only (scratch cwd) | needs `grok login`. HONORS `--cwd` (no anchor). Composer 2.5 lives in the grok CLI on the Grok Build plan. Auto-selected for `*grok*`/`*composer*`. |
| `cc-shim` | Claude Code CLI → **any Anthropic-compatible endpoint** (`MiniMax-M3`, GLM, …) | ✅ EDIT-ONLY + wrapper-commit | ✅ read-only (scratch cwd, no skip-perms) | **EXPLICIT-only**. Set `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in env (NOT `ANTHROPIC_API_KEY` — it's unset so it can't override the shim token). Prompt via STDIN. For an IMPLEMENTER the MODEL writes the code, not the driver family. **MiniMax-M3 reviewer-calibrated** (10/10 known-bad, 0 false-pass-on-critical, 3/3 clean). **GLM-5.2**: endpoint verified but 529-overloaded as of 2026-06-30 — full loop unverified. |
| `pi` | `pi` coding agent RPC mode (`v0.80.6`), MiniMax provider | ✅ EDIT-ONLY + wrapper-commit + duplex supervision | ❌ NOT wired (implementer-only — `dispatch-review.sh` rejects `--runner pi`; do NOT count pi toward reviewer/qc-panel family coverage) | **EXPLICIT-only** (declarative via `implementer_runner: pi` in `review-loop-config.md`, or hand-typed `--runner pi`; never auto-routed). `--provider` defaults `minimax` (env `PI_RPC_PROVIDER` override), `--pi-bin` test seam, `PI_MODELS_JSON` precondition path override for auth lookup, native `pi-rpc` stream + report-only stall probe. |

Full per-runner usage recipes (incl. the cc-shim env setup and which models are clean) live in
[`../project-config-template/review-loop-config.md`](../project-config-template/review-loop-config.md) § Gotchas.
The resolver's `family_of()` recognises openai/anthropic/google/xai/minimax/zhipu for the
decorrelation overlap check.

## Peer consult — the codex plugin channel (Claude Code only, capability-gated)

When the official OpenAI codex plugin (`openai/codex-plugin-cc`) is installed AND the
host is Claude Code, a THIRD posture exists alongside write-rails and review-rails:
**peer consult** — a quick, repo-grounded second opinion that lands as advice in
context, not as a verified artifact.

- Channels: the `codex:codex-rescue` subagent via the Agent tool, or
  `codex-companion.mjs task --model <m> --effort <e>` directly. Both ride a shared
  app-server broker (structured protocol — no stdout scraping, no late-flush class;
  threads are resumable across calls).
- Measured profile (first-round spike, 2026-07-05, small-n): a repo-grounded
  technical assessment returned in ~9s vs ~50s–5min for an equivalent question
  through `dispatch-author.sh`/`dispatch-explore.sh`. Use it when the deliverable is
  an OPINION (design sanity check, "am I missing a failure mode", second diagnosis
  pass) and latency matters.
- **Trust boundary (non-negotiable)**: consult output is ADVICE — it never
  substitutes qc@depth-0, artifact verification, or the decorrelated review rails.
  Labor (implementation, harness authoring) stays on the write/authoring rails with
  worktree isolation and artifact verification.
- **The plugin's own review channel is NOT integrated** (`/codex:review` is
  model-locked to GPT-5.3-Codex-Spark with no --model flag, and has not passed the
  `evals/known-bad` calibration bar) — see the BACKLOG entry for the gate. Keep the
  plugin's stop-time review gate DISABLED (it overlaps autopilot's pre-push qc-gate).
- Degradation: plugin absent / non-CC host → fall back to `dispatch-explore.sh`
  (repo-grounded answer with read-probe) or `dispatch-author.sh` (raw authoring
  prompt). The consult posture is optional leverage, never a dependency.

## Reading the repo — [`scripts/dispatch-explore.sh`](../scripts/dispatch-explore.sh)

`dispatch-hetero.sh` (write) and `dispatch-review.sh` (review a diff fed as **text**) both **avoid** letting the engine read the worktree. The opposite posture — you *want* a hetero engine to **read the real repo** and answer grounded (capability discovery, broad-context review, "what does this codebase actually do") — is [`scripts/dispatch-explore.sh`](../scripts/dispatch-explore.sh). The repo is trusted here; reading it is the point.

**Why a script — the silent-guess trap.** Each read path has one non-obvious rail that, if skipped, makes the engine **read nothing and guess instead**, then report confident wrong "facts" (a map-only agy once "fact-checked" the real 24 skills down to an invented 23, and declared an existing skill missing). Both rails are baked in:

| Engine | Failure if naive | Baked-in recipe |
|--------|------------------|-----------------|
| **codex** | `--sandbox read-only` needs **bubblewrap** to exec the file-read commands; when `bwrap` is absent the sandbox fails *before* file access and codex falls back to guessing | detect `bwrap`: present → `--sandbox read-only`; absent → `--dangerously-bypass-approvals-and-sandbox` + a loud stderr note (bypass is OK here — repo trusted, read-only intent — but NEVER in `dispatch-review.sh`'s untrusted-diff path). Always `-C <repo>`. |
| **agy** | `agy -p` **ignores the process cwd** (invents a `~/.gemini` scratch project), so a relative-path prompt reads nothing | the prompt PREPENDS `Your ABSOLUTE working directory is <repo>` + an explicit absolute-path read-list; output captured via `script -qec` pseudo-TTY (the #76/#408 stdout-drop rail). Correct arg order: prompt right after `-p`, `--model` LAST (a `--model` wedged before the prompt makes agy answer "I am running on \<model\>" instead of the task). |

**Fail-loud read probe (the autopilot guard — never trust self-report).** Before any answer is trusted, a fresh unguessable token is written to a sentinel file in the repo and the engine is told to echo it on a `READ-PROBE:` line. No match ⇒ the engine could not read ⇒ `status:read_failed`, exit 3, and the guessed body is **withheld**, never returned as valid. This makes "the engine silently guessed" a hard error instead of a plausible-looking lie — the same fail-closed stance as Invariant 2. (`--no-probe` exists for smoke tests only.)

**Read-INTENT, not write-PROOF.** Only the codex `--sandbox read-only` path (bwrap present) actually *prevents* writes; agy has no read-only mode and the codex bypass path is unsandboxed. So rather than over-claim read-only, the script snapshots `git status --porcelain` before/after and, if the engine touched any tracked or untracked(non-ignored) file, returns `status:explored_dirty` (exit 4) + a loud stderr warning — detect-by-artifact (Invariant 2) applied to "did it stay read-only." (One blind spot: writes confined to already-gitignored paths, which porcelain can't see without an unbounded `--ignored` walk — run on a clean tree.) `sudo apt install bubblewrap` upgrades the codex path to genuinely write-proof.

```bash
scripts/dispatch-explore.sh --runner codex|agy --model <name> --prompt-file <file> \
    [--repo <dir>] [--effort xhigh] [--timeout 9m]
# JSON: {runner, model, status: explored|explored_dirty|read_failed|precondition_failed, read_probe, sandbox, repo_modified, raw_log, error}
# exit 0 = explored (clean) · 4 = explored_dirty (answer present but repo was written — read-intent violated) · 3 = read_failed (body withheld) · 2 = precondition
```

> Optional: `sudo apt install bubblewrap` lets codex read under its proper `--sandbox read-only` instead of the bypass — the script auto-detects and switches; nothing else changes.

## Role-prompt reuse (engine-neutral bodies)

[`.opencode/agent-bodies/*.body.md`](../.opencode/agent-bodies/) are frontmatter-free role prompts generated for OpenCode — but plain markdown is engine-neutral. Feeding `reviewer.body.md` + a diff to `agy -p` yields a methodology-carrying heterogeneous reviewer with zero new files. (The directory is named for its primary consumer; this secondary use is intentional.)

## Unverified — spike before asserting

- ~~agy with the autopilot plugin installed: do skills load in `-p` mode?~~ **Resolved 2026-06-11: NO** — verified negative (probe + tool-inventory; see [`multi-agent-portability.md`](multi-agent-portability.md) § agy spike). Invariant 4 ("the contract is the prompt") is therefore a necessity, not a preference. Interactive-mode loading untested.

### Skill transport is now a MEASURED capability, not an assumption (v2.31.2)

Because native skill loading in `-p`/`exec` is a verified negative for the current runners, autopilot no
longer *assumes* anything about skills-inside-the-executor. `dispatch-hetero.sh --skill-mode
off|prompt|native|auto` + `--skill <name>` makes transport explicit: **`prompt`** prepends a bounded
skill pack (selected `SKILL.md` bodies, ≤ a byte budget, path-traversal-guarded) to the implementer
prompt; **`native`** is a **precondition** that consults the capability store and REFUSES unless a bench
has recorded `skill_transport.native = supported` (so it can never silently claim an unavailable
mechanism); **`auto`** uses native only when bench-supported+fresh, else prompt, else off; **`off`**
(default) is byte-identical to prior behavior. `scripts/bench-engine-capability.sh` is the only thing
that may record native/prompt-pack support, and only from an actual passing bench. Reviewers
(`dispatch-review.sh`) NEVER receive a skill pack (verifier isolation). See CLAUDE.md inventory for the
three capability-state scripts.
- agy `-p` exposes `define_subagent` / `invoke_subagent` / `manage_subagents` — a native subagent surface inside the headless executor. Semantics unprobed; could matter if a dispatched phase wants its own fan-out.
- Other engines' headless equivalence (`gemini` CLI, `codex` CLI, `opencode run`): same spike shape as the agy one — prove full agentic loop + flags before writing them here.

## Shell-level guard for raw agy calls

The guarded installer only protects its own path. For raw `agy plugin install/uninstall` typed in a shell, source [`scripts/agy-shell-guard.zsh`](../scripts/agy-shell-guard.zsh) in your `~/.zshrc` — it blocks plugin operations while any symlink sits in `~/.gemini/config/plugins/` (the agy ≤ 1.0.7 data-loss kill condition; see [`multi-agent-portability.md`](multi-agent-portability.md) § agy spike). Note: `agy -p` dispatch (this doc's subject) was never the dangerous path — the wrapper passes it straight through.

## QC panel judges ride the same recipe

`scripts/qc-panel.js` (task-tree engine P4) dispatches its Gemini judge via the same
`agy -p` plumbing this doc describes — read-only judging in a throwaway dir with only
the intended inputs, file-write verdict, `--print-timeout 8m`,
`--dangerously-skip-permissions`. The judge path never mutates a repo, so the worktree
rail is replaced by the throwaway-dir rail; everything else (artifact-based verification,
never trust self-report) carries over. Spike caveats: `multi-agent-portability.md` §7.

For reviewer isolation, the engine supports a `--spec-file <file>` flag to pass the original task specification as a trusted baseline. This solves structural reviewer non-convergence by scoping the review against dispatcher-authored bounds, while keeping the diff itself as the only untrusted input.

## No skill yet — deliberately

Two real uses so far. Per the distill philosophy (extract skills from recurring practice, not speculatively), the skill wrapper waits for recurrence — trigger tracked in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
