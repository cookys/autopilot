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
7. **Input must fit the engine's context window (gate 7).** Every rail runs the context-window gate before spawning a runner; an over-budget unit fails closed rather than letting the engine compact its way through. See § Context-window gate.

## Runner choice and guidance profile are separate

Heterogeneous dispatch chooses a runner; capability admission decides whether that exact
model/runner/configuration/deployment may hold the requested role; the execution-profile compiler
then chooses `guided` or `autonomous`. A strong model is not admitted merely because its name
appears in a static routing table, and a guided profile cannot turn an unqualified model into an
owner or reviewer. Fallback repeats admission and profile resolution for the replacement identity
instead of inheriting the failed engine's grant.

[`scripts/dispatch-local-openai.js`](../scripts/dispatch-local-openai.js) is a deliberately narrower
adapter. It sends one bounded author/reviewer prompt with no repository tools, under a protected
roster, deny-by-default egress, pre/post identity binding, a one-slot lease, capacity checks, and
cancellation/recovery checks. It is not a `dispatch-hetero.sh --runner`, implementer, owner, or
agentic harness. The generic transport contract has fake-server coverage; no live local runtime
row or local agentic runner is claimed in this release.

## Context-window gate

[`scripts/check-context-window.js`](../scripts/check-context-window.js) (+ the sourceable wrapper [`scripts/lib/context-window.sh`](../scripts/lib/context-window.sh)) answers one question before anything is spent: **does the input we are about to feed this engine fit its context window?**

Why it exists — measured on this machine, not assumed. A read-only scan of 1231 headless `codex_exec` dispatch sessions (90 days, `~/.codex/sessions`, real `event_msg.token_count` telemetry):

| Signal | Value |
|--------|-------|
| Total dispatch tokens | 788.0M — **98.4% of it input** |
| Sessions that hit a context wall (compaction) | 53 (**4.3%**) |
| Tokens burned by those 53 | **322.9M = 41.0% of the whole corpus** |
| Of those 53, `gpt-5.3-codex-spark` | **52** (observed window 121600) |

The cost driver is oversized input meeting a small window — not output volume, and **not** review-loop round count (a measured 76-round cluster cost 7.9M; a 41-round cluster cost 60.9M because it fed 5.4M/15.9M single-turn inputs). This gate replaces `dispatch-review.sh`'s former hardcoded 96 KB advisory, which was engine-agnostic and therefore meaningless: the same 400 KB diff overflows spark's 121600 window and sits comfortably inside grok-4.5's 500000.

```bash
# Standalone
scripts/check-context-window.js --model gpt-5.3-codex-spark --file prompt.txt --file diff.txt
# → {verdict: OK|OVER_BUDGET|UNKNOWN_WINDOW, window, window_source, estimated_tokens, threshold_tokens, ...}
# exit 0 = may dispatch · 1 = blocked · 2 = usage error

# On any rail (default mode = block)
scripts/dispatch-hetero.sh --model X --prompt-file p.txt --context-window warn
AUTOPILOT_CONTEXT_WINDOW_GATE=off scripts/dispatch-review.sh ...
```

Rules that make it safe to leave on:

- **The estimator rounds UP** (bytes ÷ 3.5, the repo's blended divisor). Under-estimating is the one direction that silently defeats the gate.
- **Window resolution order**: `--window` > a recorded `context_window` capability observation > the built-in observed-default table > unknown. The table is seeded from real runtime telemetry, never vendor claims, and records the **minimum** where a model was observed with more than one window (spark: 121600 and 258400 → 121600 wins).
- **Unknown window never blocks** by default — a new engine must not become undispatchable because nobody has observed it yet. `--strict` flips this for callers that want it.
- **The gate is a cost control, not a security boundary.** If the gate itself cannot run (no node, script missing), it warns and lets the dispatch through rather than turning a tooling fault into a dispatch outage. Only a real `OVER_BUDGET` blocks.
- **Reason strings carry no double quotes** — they are interpolated into shell-assembled JSON by the rails.

Recording an observed window (so the gate stops guessing from the table):

```bash
echo '{"schema_version":1,"observed_at":"...Z","runner":"codex","model":"<id>","role":"implementer",
  "capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0},
                "context_window":{"total_tokens":121600,"evidence":"token_count.model_context_window"}}}' \
  | scripts/engine-capability-state.js record --file /dev/stdin
```

`context_window` merges **role-agnostically** (a window belongs to the model, not the seat) and a `null` reading never clobbers a valid one.

[`scripts/resolve-review-loop.sh --input-bytes N`](../scripts/resolve-review-loop.sh) reports — never rewrites — a roster seat whose window cannot hold `N` bytes, appending to the existing `capability_warnings` array. Same posture as the quota path: the resolver states the fact, the consumer decides per `on_engine_unavailable`. No new contract field exists, so `check-context-window.js` stays the single source of window truth.

## Script

```bash
scripts/dispatch-hetero.sh --branch feat/<task> --prompt-file /tmp/task.md \
    [--model "Gemini 3.5 Flash (High)"] [--base develop] [--timeout 9m]
```

JSON to stdout: `{status, runner, model, containment, contained, branch, base, commit, files_changed, insertions, deletions, worktree, agent_log, error, duplex}` (`runner` is `"codex"`, `"agy"`, `"grok"`, `"cc-shim"`, `"pi"`, or `"qoderclicn"` per `--runner auto|codex|agy|grok|cc-shim|pi|qoderclicn` — `auto` routes `*gpt*`/`*codex*` → codex, `*grok*`/`*composer*` → grok, `*qwen*`/`*qwq*` → qoderclicn, else agy; `model` echoes `--model`; `containment`/`contained` carry teardown-hygiene provenance; `duplex` is `"rpc"` for `pi` and `null` for all other runners; all **engine provenance** the caller records in its run-summary ledger; consumed by the `/l5` impl row, [`skills/ceo-agent/references/level-front-door.md`](../skills/ceo-agent/references/level-front-door.md)). Exit 0 = committed + clean tree + agent exit 0 (worktree auto-removed; **branch survives** for review/merge). Exit 1 = ran but did not yield a reviewable clean commit (`dirty` / `failure` / `no_op` / `question_suspected` — see Outcome states; worktree **kept** for inspection). Exit 2 = precondition failure. The agent's stdout/stderr are written to a temp file; **`agent_log` contains that file's path, not the log text** — read the file to inspect agent output.

### Outcome states

The no-commit case is **split by how the worker ended** so a legitimate no-op task is not confused with a stalled/paused one. The split is CLI-agnostic — it reads git artifacts + the already-captured `AGENT_EXIT`, with **zero stream parsing** (no `--output-format` / no question-mark heuristic; a heuristic on the assistant stream would be scrape-equivalent and is out of scope).

| `status` | Condition | Meaning | Exit |
|----------|-----------|---------|------|
| `committed` | new commit + clean tree + agent exit 0 | **success** — the only path that returns 0; branch is ready for review/merge | 0 |
| `failure` | new commit + clean tree but agent **exit ≠ 0** | the worker left a commit but ended abnormally; **not** scored success (a non-zero exit is never `committed`) | 1 |
| `dirty` | new commit but tree left uncommitted-dirty | the worker committed then kept editing; not a reviewable clean state | 1 |
| `no_op` | **no** new commit + agent **exit 0** | the agent legitimately judged nothing was needed; not a dispatch failure. **(agy/Gemini, pre-v2.25.9: a `no_op` here usually meant agy invented a scratch project instead of editing the worktree — agy `-p` ignores process cwd. Fixed v2.25.9: the agy directive now PREPENDS an absolute-worktree anchor, so agy edits in place — verified single- and multi-file. A `no_op` from agy now means what it says.)** | 1 |
| `question_suspected` | **no** new commit + (timeout **or** exit ≠ 0) | the worker likely **paused on a clarifying question** (auto-approve / `--dangerously-skip-permissions` does *not* silence the model's own question — see [`blind-dispatch.md`](blind-dispatch.md) § "Clarifying questions survive auto-approve") or otherwise stalled | 1 |
| `engine_unavailable` | worker exit ≠ 0 (would have been `failure` or `question_suspected`) **and** the error log classifies as a known engine-unavailability signal (`quota_exhausted` / `rate_limited` / `auth_failed` / `overloaded`) | the runner hit a quota/auth/overload death (e.g. grok HTTP 402), not a clarifying question or code failure; worktree **kept** | 1 |

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
Evidence + residuals: [`docs/projects/_archive/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md`](https://github.com/cookys/autopilot/blob/develop/docs/projects/_archive/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md). The trust rails
(`worktree` isolation, wrapper-commit, artifact verification) remain unchanged.

### Directive reachability (Phase 2 — advisory nudge channel)

Depth-0 can queue a one-way **advisory** directive to a running stage's lease holder via the R0
ledger ([`scripts/run-ledger.sh`](../scripts/run-ledger.sh) `directive-send` / `directive-poll` /
`directive-ack`): `directive-send` binds the nudge to the target stage's CURRENT lease
(generation+nonce) and **refuses if no stage is leased** — you cannot nudge a stage nobody holds.
Every send is terminalized by exactly one ack row (`directive_delivered`, or `directive_expired`
with reason `run_ended` / `stale_generation` — the stale reason covers BOTH a generation advance
and a same-generation nonce mismatch, i.e. a fenced/replaced writer) — a directive never vanishes
silently. This holds across ledger rotation too: `directive-poll`/`directive-ack` scan the rotated
`<ledger>.N` segments, so a directive whose row rotated out of the live ledger stays visible and
still terminalizes. Delivery is **queue-and-deliver-at-boundary**, never a hard interrupt. How far a directive actually reaches
depends on the runner:

| Runner | Reachability | Mechanism |
|--------|--------------|-----------|
| `pi` (RPC duplex) | **mid-run** | the supervisor ([`pi-rpc-run.js`](../scripts/lib/pi-rpc-run.js)) polls the ledger on its own cadence (`PI_RPC_DIRECTIVE_POLL_SECS`, default 5s), **validates the directive's bound lease (generation+nonce) against the CURRENT lease before steering** — a stale directive is never steered to the current worker, only terminalized as expired — then delivers a native RPC `steer` prefixed `[depth-0 directive] …` and acks `directive_delivered` **from the supervisor** (never the worker; an ack failure is emitted as a `supervisor_directive_ack_failed` log event, not swallowed). At shutdown any still-pending directive is `directive_expired(run_ended)` — the expiry runs AFTER the child teardown ladder is armed, so a lock-contended ledger can't delay worker teardown. Enabled only when `--ledger/--run-id/--stage` are all passed (`dispatch-hetero.sh --runner pi` forwards its own coords automatically) — otherwise byte-identical to before. |
| CC foreman (dev-flow inline) | **stage boundary** | the foreman polls its own run-id at each stage boundary (before `stage-acquire` of the next stage), honors + records, then acks. |
| one-shot batch runners (`codex exec` / `agy -p` / `grok` / `cc-shim`) | **UNREACHABLE mid-run** | no duplex channel — a directive can only shape the **NEXT** round's dispatch prompt. No pretend-channel is offered. |

AUTHORITY LINES (non-negotiable): a directive is **advisory** — the lease holder keeps the stage,
there is **no auto-kill on non-response** (Stage 3 scheduling/steer stays BACKLOG'd), and the
read-only [`watch-foreman.js`](../scripts/watch-foreman.js) NEVER gains a directive-send surface
(its no-`child_process` / report-only invariant is unchanged). The delivering supervisor — not the
worker — writes every ack (worker bytes stay JSON-escaped inside tool events, so a worker can't
forge its own delivery).

### Deferred — stream-json "live question" rail (spike-gated, NOT built)

A richer signal — a *live* "the model is asking a question" event from `--output-format stream-json` — is **deferred behind an existence spike, not committed**. `claude -p --output-format stream-json` is known to emit `assistant` / `tool_use` / `tool_result` / `result`; whether any of `claude` / `codex exec` / `gemini -p` emits a **machine-distinguishable** "asking a question" event is unverified. **Before any parser code**, a spike must capture real runs and answer "does the event even exist." If it does not, the rail is invalid (a question-mark heuristic would be scrape-equivalent) and stays unbuilt. Recorded sample files are the spike deliverable; any future parser is tested against the recording, never a live CLI. Tracked in the plan's §8, not here.

After exit 0: review `git diff <base>..<branch>` through quality-pipeline, then merge or discard the branch.

## Task status and explicit merge closeout

For managed L5/L6 root runs, merge permission and task completion are different facts. Persist the
exact task evidence bundle at
`${AUTOPILOT_TASK_STATUS_DIR:-${TMPDIR:-/tmp}/autopilot-task-status}/<root_run_id>.json`, then
query it without mutating refs or worktrees:

```bash
node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id"
task_status_receipt="$(mktemp)"
node "$autopilot_root/bin/autopilot.js" status task \
  --root-run-id "$root_run_id" --json >"$task_status_receipt"
node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(v.can_merge!==true)process.exit(1)' \
  "$task_status_receipt"
```

Human output starts with `DONE` only when the receipt's full `can_close` predicate is true.
Otherwise it starts with `NOT DONE`, the first blocker, and the next action. Always read the four
states independently:

```text
NOT DONE product_merged=true consumer_updated=true pushed=false zero_residue=false
Blocker: pushed_false
Next action: push the required integration ref after explicit approval
```

### Direction is data, not prose

A merge intent names every direction explicitly. For example, this sequence integrates safety
work into the product branch, then advances the consumer branch; it does not imply or permit the
reverse edge:

```json
{
  "edges": [
    {
      "sequence": 1,
      "source_ref": "refs/heads/safety",
      "target_ref": "refs/heads/develop",
      "mode": "no-ff"
    },
    {
      "sequence": 2,
      "source_ref": "refs/heads/develop",
      "source_from_edge": 1,
      "target_ref": "refs/heads/peo",
      "mode": "ff-only"
    }
  ],
  "forbidden_reverse_edges": [
    {
      "source_ref": "refs/heads/peo",
      "target_ref": "refs/heads/develop"
    }
  ]
}
```

`buildMergeIntent()` resolves refs/worktrees and seals this contract.
`preflightMergeIntent()` is strictly read-only: it inventories staged, unstaged, untracked, and
ambiguous target paths; compares incoming paths; and returns `safe`, `overlapping`, `ambiguous`, or
`blocked`. It never checks out, merges, stashes, resets, pushes, or deletes anything.

Mutation has a separate front door. The request file must carry the exact `{manifest, seal}`,
the caller's matching `manifest_seal`, the digest-valid preflight receipt, and exact
`approved_preservation` paths:

```bash
node "$autopilot_root/bin/autopilot.js" merge execute \
  --request /path/to/sealed-merge-request.json --json
```

Execution revalidates every endpoint, target symbolic ref, worktree/repository binding, dirty
inventory, and protected bytes before each edge. It runs only the declared `no-ff` or `ff-only`
mode and emits a content-digested execution receipt. It does not push, delete branches/worktrees,
or drop stashes. Run task status freshly before merge, after merge, and immediately before L5/L6
marker clear; a previously green receipt cannot authorize a later mutation boundary.

### Cleanup (caller's responsibility — both are deliberate persistence)

- `agent_log` file: persists on every path (it is the only record of agent output, including on success). `rm` it after reading.
- Kept managed worktrees (exit 1, or `--keep-worktree`): inspect, then immediately use the exact root-run lifecycle below. Do not bypass its write-ahead branch inventory with a manual `git worktree remove --force`, and never use a bare `git branch -D`.
- Interrupt trap: `scripts/dispatch-hetero.sh` installs a `TERM` trap (and an `INT` trap for the atypical parent-only-INT case) that self-reaps its worktree + branch if the run is killed mid-agy, disarming once agy returns. A **Ctrl-C** (INT to the whole process group) does NOT hit the trap — agy dies and the run routes through the normal `question_suspected` exit-1 path with the worktree **kept for inspection** (verified empirically 2026-06-22).

## Managed root-run lifecycle

The stable resource identity is `git-common-dir:<canonical-path>` plus the
campaign `root_run_id`. The canonical campaign controller derives that root
from the sealed `campaign_id` and injects it through
`AUTOPILOT_WORKTREE_ROOT_RUN_ID` on every initial, repair, and resumed
implementation dispatch. This resource channel is deliberately separate from
the manifest's `AUTOPILOT_ROOT_RUN_ID`: the latter remains the current foreman
trace root so `watch-foreman.js --root <foreman-run-id>` continues to observe
its leaves. All schema-2 implementation descendants inherit the worktree root
unchanged. The managed campaign adapter also normalizes dispatch depth to a
positive decimal before spawning the leaf; zero or malformed inherited depth
cannot disable the budget block.
An explicitly managed dispatch admits that root durably before publishing a
pending record or creating a branch/worktree. A direct one-shot dispatch with
no explicit worktree root keeps the legacy cleanup path and does not create
lifecycle authority as a side effect.
`max_leaf_worktrees_per_root` (default `4`) limits simultaneous retained
schema-2 leaves for that identity; repository lifecycle locking serializes
admission, reconciliation, scan, and reap. A budget rejection is a
pre-spend `precondition_failed`, not permission to create another root id.

Once depth 0 has inspected a retained result, disposition it immediately:

```bash
: "${lifecycle_artifact_dir:?set a caller-owned durable artifact directory}"
: "${campaign_id:?bind the admitted sealed campaign_id}"
[[ "$campaign_id" =~ ^campaign-v1-[0-9a-f]{64}$ ]] \
  || { printf '%s\n' 'invalid lifecycle campaign_id' >&2; exit 2; }
root_run_id="$campaign_id"
lifecycle_dir="$(mktemp -d "$lifecycle_artifact_dir/root-$root_run_id.XXXXXX")" \
  || exit 2
worktree_result="$lifecycle_dir/worktrees.json"
branch_result="$lifecycle_dir/branches.json"
receipt="$lifecycle_dir/residue-receipt.json"
bash "$autopilot_root/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$consumer_repo" --root-run-id "$root_run_id" --yes \
  >"$worktree_result" || exit $?
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap \
  --repo "$consumer_repo" --into "$integration_target" \
  --inventory-file "$worktree_result" --yes >"$branch_result" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" issue \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --worktree-result "$worktree_result" --branch-result "$branch_result" \
  --out "$receipt" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" check \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --receipt "$receipt" || exit $?
node -e '
const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (value.zero_residue !== true) process.exit(1);
' "$receipt" || { printf '%s\n' 'lifecycle residue remains' >&2; exit 1; }
```

The artifact directory belongs to depth 0, must survive leaf cleanup, and is
recorded in the run summary for LSM consumption. Every attempt uses a unique
mode-0700 `root-<id>.*` directory, so a failed step cannot fall through to a
stale receipt. The validated id is prefixed with `root-` before path
construction, so the otherwise valid ids `.` and `..` cannot traverse the
artifact root. `check` exit 0 means the
receipt is structurally valid and fresh; depth 0 must also read
`zero_residue`. A fresh `false` is an exact lifecycle blocker, not a pass.

The worktree controller removes only exact clean/dead owned leaves and writes
durable branch/tip inventory before removal. Dirty, live, malformed, legacy,
unsupported, pending, or raced states remain visible blockers. Resolve the
reported state (for example commit/preserve dirty work or stop a live owner)
and rerun the same exact-root sequence; never force-remove past it. If an
exact branch is not contained, rerun the branch disposition with
`--ack-preserved <branch@tip>` only after an explicit preservation handoff;
never broaden a regex to make it disappear.

Automatic managed success cleanup targets only the completing leaf. An explicit
`--keep-worktree` is a bounded lease and is rejected unless
`--retain-owner`, `--retain-reason`, and future `--retain-until` are all
present. The schema-2 marker stores the owner, reason digest, and expiry.
Later budget reconciliation counts that leaf but cannot remove it before depth
0 dispositions it. Inventory
copy publication is protected by a write-ahead intent: pre-authority copies may
be rolled back and a post-authority trailing intent may be cleared only when
both copies still match. Missing, malformed, or extra evidence never gains
authority during load and still fails closed.
Managed `INT`/`TERM` follows the same journal-before-remove rule and never
deletes the branch in the trap. The final targeted reap is bound to the tip
captured by the first journal step; a hook or race that advances the branch is
preserved for explicit disposition instead of creating a second membership.
Exact branch disposition inherits and verifies the same lifecycle lock fd for
its controller rescan, then holds that lock through validation and destructive
disposition, so a new managed leaf cannot enter between canonical inventory and
branch action.

Managed implementation campaigns keep one branch and one retained worktree
across the initial mutation and every authorized repair. A repair passes the
exact prior commit as `--base` and the exact retained checkout through
`--reuse-worktree` plus the controller-bound `--expected-worktree-instance`
digest; creating a successor branch is not a retry mechanism. Grok
repairs additionally pass the first call's UUID through `--resume-session`.
Runners without a verified resume API may start a new provider conversation in
the same checkout, but the campaign receipt must name
`provider_session_non_reuse_reason`. The retained checkout is removed without
`--force` on terminal success. Dirty or unverifiable state blocks cleanup.

Finding IDs and accepted invariants are carried across repair prompts. The same
normalized finding may authorize one bounded repair; seeing it again stops at
`awaiting_convergence_adjudication` before another runner call. Renamed finding
sets that fail to shrink for two repair rounds stop at the same gate. Durable
`git_candidate` references include the exact repair lineage so a new process
after compaction can restore branch, worktree, provider session, lease, churn,
and input-measurement identity rather than redispatching from transcript memory.

Before first anchor creation, the controller admits the root into a private
repo-level registry (`initializing` then `active`). An active registered root
can never be reinitialized when its per-root evidence disappears. The
controller then cross-binds a random per-root nonce plus the journal
directory's birth-time/device/inode generation between a mode-0600 anchor under the Git
common directory and a mode-0600 sentinel inside the private mode-0700
branch-inventory directory. Each immutable inventory record is also mirrored
under the separate anchor directory and compared byte-for-byte on every load.
The monotonic authority is a canonical JSON Git blob reached through
`refs/autopilot/lifecycle-roots/<root-key>` and advanced with `git update-ref`
compare-and-swap. It carries the generation plus every record key/content
digest, and permanently binds the admitted journal's
nonce/birth-time/device/inode.
Anchor and registry are updated afterward and may only be repaired
forward from that ref; the sentinel keeps immutable directory identity. A kill
after the authority CAS is recoverable, and coordinated stale snapshots of the
ordinary anchor+registry files cannot roll the Git authority back. A copied
sentinel cannot bless a replacement directory, an individual or mirrored pair
cannot disappear silently, and a missing active anchor is never rebuilt from
the sentinel. A pre-anchor journal is imported only when its directory is
owner-private mode 0700 and every imported record is owner-owned mode 0600.
Empty exact inventory is accepted only after these bindings and a fresh
controller scan prove no unresolved journal branch. A same-owner adversary that
can also rewrite the authority ref and Git object database is outside this
local proof boundary.
Crash-recovery claims cover process death and `SIGKILL`. Without explicit host
and filesystem fsync guarantees, power loss may require manual recovery and
must fail closed rather than prove zero residue.

Managed successful leaves use this controller for automatic cleanup: exact
branch/tip evidence is committed before the worktree is removed. The legacy
direct remover remains only for unmanaged depth-zero dispatches.

`LifecycleResidueReceipt` binds the current repository identity, root id,
worktree observation, exact branch inventory, and disposition journal. It is
freshness-checked before handoff to the lifecycle state machine, but it proves
resource disposition only: it never computes task `can_close`, generation
advance, merge authority, or finish authority.

## Repo-branch lifecycle

`scripts/reap-dispatch-branches.sh` is the preserve-first lifecycle rail for dispatch-owned **local** branches. Its built-in anchored grammar is:

* `ceo-integration-candidate-r<N>` — integration candidates.
* `ceo-<task>-r<N>-<YYYYMMDD>` — dated intermediate rounds.
* `agent/<task>-r<N>-<YYYYMMDD>` — dated unit rounds.
* Repeated `--pattern <bash-ere>` adds an explicit local family; an empty ERE is rejected because it would match every local branch. Batch `unit-*` branches are intentionally out of scope and remain owned by `dispatch-batch.sh`.

`scan` emits JSON classification without destructive mutation (it may create
owned coordination lock files). `check` is the finish-flow gate: exit 0 means
no unacknowledged ahead integration candidate; exit 1 means depth 0 must
integrate, explicitly preserve, or discard. `--ack <branch>` records
preservation against the exact current tip; malformed, missing, or moved-tip
acks are pruned fail-closed.

Durable acknowledgement and destructive reap currently support SHA-1 object-format repositories only (40 lowercase hexadecimal object IDs). On SHA-256 repositories `scan` remains available/read-only, but a durable `check --ack` is unavailable (non-40-hex stored acks are pruned and re-arm the gate) and `reap --yes` fails closed during tip validation before any ref deletion.

`scan` reports containment against the authoritative integration target first, otherwise against a canonical maximal live candidate target (one canonical candidate per same-tip group; non-maximal candidate tips cannot become sole containment proof). `reap` is dry-run unless `--yes` is supplied, and it only deletes branches contained by the authoritative integration target. `--reap-superseded` exposes supersession in the preview but never authorizes deletion of an uncontained branch; discard is manual depth-0/human work after preservation. Before deletion the tool creates and verifies one positive-ref full-history bundle, checks every head, and revalidates exact tip + containment + complete worktree occupancy around the compare-delete CAS. If post-delete proof invalidates, exact-ref restoration is attempted only with a prepared `update-ref --stdin` transaction using `option no-deref`; a raced direct ref or symref aborts/fails closed rather than being overwritten, and the verified bundle remains the authoritative recovery artifact. Git has no transaction spanning ref and worktree metadata, so a hostile concurrent actor can still race after the final validation; the script never overclaims stronger serialization.

Exit 2 is a usage/environment failure. Bundles default under the git common dir; a relative `--bundle-dir` resolves against the repo root, never caller CWD. The tool never touches remote refs and never treats a name match alone as deletion authority.

Signal-handler orphan paths use the private state root `${AUTOPILOT_ORPHAN_STATE_DIR:-${TMPDIR:-/tmp}/autopilot-${UID}}`. It must be a real owner-owned mode-0700 directory; unsafe mode, symlink, non-directory, or foreign ownership fails startup closed with exit 2. `--gc` retries only exact registered own-user worktrees and holds the normal lifetime-flock proof through removal, so a live or unsafe/unsupported lock preserves the worktree and its retry entry.

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
- **Trace lineage contract (telemetry only):** dispatchers inherit lineage from incoming env
  (`AUTOPILOT_PARENT_RUN_ID`, `AUTOPILOT_ROOT_RUN_ID`, `AUTOPILOT_DISPATCH_DEPTH`) and stamp
  each manifest with `parent_run_id` + `root_run_id` + `depth` so dispatch trees are auditable.
- **HONEST BOUNDARY (observability scope):** lineage spans only layers passing through
  `dispatch-hetero.sh` / `dispatch-review.sh`; engine-internal spawns (e.g. codex `spawn_agent`,
  agy recursion) and depth-0-only tooling do not appear unless they emit one of those
  dispatch manifests.

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
| `qoderclicn` | Qoder CLI CN → Alibaba `Qwen3.8-Max-Preview` (also gateways GLM-5.2 / DeepSeek-V4 / Kimi / MiniMax-M2.7) | ✅ EDIT-ONLY + wrapper-commit | ✅ read-only (scratch cwd, `--tools ""`) | needs Qoder CLI CN auth (`~/.qoder-cn`). HONORS `-w`/`--cwd` (no anchor — grok-shaped, NOT agy). Prompt via STDIN; `-p` print mode; effort → `--reasoning-effort`; `--qoder-bin` test seam. Reviewer splits STDOUT/STDERR (a benign `fatal: not a git repository` on stderr from the non-git scratch cwd stays out of the parse). Auto-selected for `*qwen*`/`*qwq*`. Spike-verified 2026-07-24 (edit-only + `-w` honored, both paths e2e-passed on Qwen3.8-Max-Preview). |

For AUTHORING flows, prefer `anthropic-compatible` when the request is a large single-shot payload where `cc-shim` (Claude Code CLI transport) can stall or fail with 529-style endpoint pathologies. This path runs the same direct `dispatch-anthropic-review.js --raw` transport with `MINIMAX_API_KEY`/`ANTHROPIC_COMPATIBLE_AUTH_TOKEN`, and it resolves credentials by endpoint name the same way as cc-shim when `--endpoint <name>` is supplied.

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
