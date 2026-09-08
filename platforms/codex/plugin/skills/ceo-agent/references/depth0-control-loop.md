# Depth-0 control loop & run ledger (`/l3 /l4 /l5 /l6`)

> The depth-0 half of the front-door contract: the CEO-owned control loop, the
> Phase L width fan-out loop, the run-summary ledger, and the gotchas. Split out
> of [`level-front-door.md`](level-front-door.md) in v2.36.21 because that file
> grew past the Claude Code Read tool's whole-file cap and could no longer be
> read in one call. Read `level-front-door.md` first for front-door semantics
> and the foreman; this file owns everything depth 0 enforces after dispatch.

## Depth-0 control loop (owned by the CEO, NOT the foreman)

The control loop is enforced at **depth 0** — the child cannot be trusted to
police its own budget (fox/henhouse, Round-2 Ops 🔴 fix). The CEO wraps the
foreman dispatch in a guard it owns:

### -2. Mission routing admission (before every topology effect)

At `/l3` through `/l6` entry, `session-mode.js set` first resolves the consuming repository's
authoritative project governance config and runs `mission-routing-admission.js` against the configured
graph and content-bound source manifest. The admission uses the canonical Mission policy resolver
and execution-graph checker. It binds canonical Git-common-dir repository identity, Mission policy
digest, graph digest, source coverage digest, deliverable count, critical path, batches, and
aggregate reservations before the marker is written.

```bash
# normal entry
node <plugin>/scripts/session-mode.js set --level lN --repo-root <repo>

# topology-only degradation; entry authority remains lN
node <plugin>/scripts/session-mode.js set --level l3 --entry-level lN \
  --fallback solo --repo-root <repo>
node <plugin>/scripts/session-mode.js set --level l3 --entry-level lN \
  --fallback precondition_failed --repo-root <repo>
```

This command must complete before TaskCreate, branch, worktree, runner, model, or inline
implementation effects. `READY` is required in enforce mode. `SHADOW` records `admitted` and
`would_block` but is not authority. `LEGACY` preserves off-mode execution. Corrupt, expired,
absent, or foreign prior session markers are observations only and can never replace the fresh
policy/graph/source check.

Source `Phase`/`P0..PN` headings, modules, tests, verification authoring, reviewer seats, and
retries are provenance/coverage or gates inside caller-authored bounded deliverables. Only
admitted graph nodes become implementation TaskCreates. A fallback, failed test, review round,
or repair consumes the same node's gate-attempt budget; it cannot create a new node or reset
admission. Routing admission is not the durable Mission grant: forward its exact policy/graph
binding into `mission prepare`/`grant` when that runtime is active, without inventing lineage,
root-run, state-path, or grant fields.

### -1. Session-mode marker + depth-0 context discipline (v2.32.27)

At `/l3` through `/l6` entry, depth-0 runs the admitted command above (`clear` happens in
finish-flow closing). The marker carries `level`, `repo_root`, `started_at`, and `expires_at`, and adds the
admission/entry topology binding when Mission is configured. **Every `set` mints a fresh
`started_at`** (`scripts/session-mode.js` stamps `new Date()` unconditionally) — including
the mid-run `--fallback solo|precondition_failed` re-set below, which is why a degraded run
is a new run to anything keyed on it. It
arms these hooks:

- **orchestrator-edit-gate**: depth-0 Edit/Write of product files is a protocol
  violation — dispatch instead. Subagents/foremen pass (hook payload identity).
- **run-approval-gate** (only when `run_approval.mode=ask-once`): turns the run's FIRST
  depth-0 `Task`/`Agent` into a one-time permission ask. See "One confirmation per run".
- **context-budget**: measures the REAL context size. Once T1 (100k) has fired,
  depth-0 MUST checkpoint + `autopilot:handoff` at the next deliverable boundary
  (after a merged unit / qc verdict) and continue in a fresh session — context
  cost ≈ length × remaining messages, quadratic in session length (2026-07-14
  transcript study: 96%+ of tokens were cache_read on unsplit depth-0 sessions).
  At T2 (150k) stop taking on new work and hand off NOW.

Under an active l5/l6 marker, write and author dispatch on the consuming repo are
CONTRACT-GATED (v2.32.36) — this is the session-mode control-loop boundary contract, not
optional guidance:

- Depth-0 freezes an immutable dispatch-unit contract (schema
  `schemas/dispatch-unit-contract.schema.json`) per unit — one semantic decision plus its
  mandatory generated mirrors, base pinned to a full SHA, budgets, allow/deny scope,
  acceptance argv, and the engine role.
- GO is mechanical and pre-spend:
  `node scripts/dispatch-contract.js check --contract <unit.json> --repo <repo> --json`
  (exit 0 GO / 2 schema / 3 policy NO-GO). No LLM override, no silent fallback; a changed
  contract is a new hash and a new GO check.
- Write dispatch: `scripts/dispatch-hetero.sh --strict-contract --contract-file <unit.json>
  --branch <b> --prompt-file <task.md> ...` — base/timeout derive from the contract; caller
  `--base`/`--model`/`--timeout` disagreements are precondition-rejected; post-return the
  dispatcher enforces the artifact boundary (allow/deny/file/diff/output) from git truth and
  EXECUTES the acceptance argv itself (`boundary_rejected` / `acceptance_failed`, worktree
  kept).
- Verification authoring (`/l6`): `scripts/dispatch-author.sh --strict-contract
  --contract-file <unit.json> --repo-root <consuming-repo> --prompt-file <file>` — the checker
  gates with the verification-author role, runner/model derive from the resolved VA tuple, and
  the consuming checkout is containment-proven (any mutation ⇒ `containment_breach` exit 4,
  artifact quarantined, never promoted).
- Prompt-only (non-strict) write/author dispatch on a repo with an active l5/l6 marker fails
  before any runner spawn. Expired or foreign-repo markers do not block.

Corollary (always, hooks on or off): dispatch outputs land in FILES; depth-0
reads only the emitted JSON summary — never scroll raw worker logs into the
depth-0 context.

### 0. Peer consult (optional, Claude Code + codex plugin only)

For quick second opinions during depth-0 judgment (design sanity, alternative
diagnosis, "what am I missing"), the `codex:codex-rescue` subagent is a ~seconds-class
repo-grounded consult channel (see `references/hetero-dispatch.md` § Peer consult).
It is ADVICE only: it never substitutes qc@depth-0 (§3), artifact verification, or
merge authority, and it is absent on non-CC hosts — never a dependency of the loop.

### 1. Budget cap (rounds + wall-clock — v1 only)

- Pick a wall-clock deadline and a round cap before dispatch (a small fixed
  default, e.g. 30 min / 3 rounds, scaled to task size). **Token-estimate budget
  is deferred** (needs a counting source — Open Q3).
- Arm the deadline with a **one-shot background Bash**, not a Monitor sleep loop —
  e.g. `Bash(command: "sleep 1800; echo DEADLINE_HIT", run_in_background: true)`;
  when the `DEADLINE_HIT` notification wakes you, `TaskStop` the foreman if still
  running. (Kill the background timer once the foreman returns normally, else it
  fires a harmless stale event at the cap.) The wall-clock itself is plain
  depth-0 timing (no new primitive). Foremen must not use this timer to wait on
  leaves.
- **On timeout or cap-hit, judge by git artifacts BEFORE acting.** Read the foreman
  worktree branch's commit progress (`git -C <worktree> log`), **never the foreman's
  self-report**, to decide whether it is healthily advancing. Healthily progressing →
  a **one-time** extension is allowed, recorded in the decision log (a second overrun
  is a hard `TaskStop`, no second extension). No commit progress → **immediate
  `TaskStop <agentId>` + escalate.**
- **No progress — or any overrun after the one-time extension → `TaskStop
  <agentId>` then escalate.** The artifact check above is the ONLY branch out of a
  hit cap. Fail-closed: a hit cap is an escalation, never a silent continue (the
  extension is itself an explicit, decision-logged action, not a continue). This is
  also the **foreman-tier stall detector** — a hung foreman trips the depth-0 clock.

### 1.b Quota/session-limit reset preflight recovery (R4)

**Gated on `on_engine_unavailable`** (retrieve the resolved value with
`bash scripts/resolve-review-loop.sh --field on_engine_unavailable` — read it,
never hand-type the policy): this
auto-wakeup path only runs when the resolved key is `solo-fallback` or
`wait-reset`. Under `ask` (the shipped default), the run stops at the quota death
and escalates to the user immediately — report which engine died and the parsed
reset time if available; do **not** schedule a wakeup or silently fall back to
inline/`--solo` labor on the expensive depth-0 session model.

This path is only for **quota/session-limit death** (session model usage/quota hit).
It is distinct from `failure`/`killed` code-death recovery in §2; quota-reset
resurrection must first re-validate quota, then route through the existing R3
`run-ledger.sh resume` branch.

Use this 7-step recovery sequence:

1. Preserve the original session-limit error exactly as an immutable value in
   control-loop state (raw CLI/tool error string), because this text is the source
   of truth for downstream escalation and audit.
2. Parse the reset point from `quota_error_text` and fail fast if unparsable.
   Only parse explicit timestamps/countdowns present in the error string (for example
   `reset=<unix_epoch>` or `retry_after=<seconds>`). If parsing cannot produce a
   concrete deadline, **do not invent a wakeup** — escalate manually using the
   preserved error and continue with the standard failure path.
3. Derive the wake target from parsed reset:
   `wake_at = reset_epoch + buffer_secs + jitter_secs`,
   where `buffer_secs` avoids exact-boundary wake and `jitter_secs` reduces herd
   collisions on shared accounts.
4. Schedule the wakeup using one of the real wakeup primitives:
   - Primary: one-shot `Bash(run_in_background: true)` timer, e.g.
     `Bash(command: "sleep ${delay}; echo QUOTA_WAKEUP", run_in_background: true)`
     — the host task-notification wakes the session; do not Monitor-loop or
     poll from a live turn.
   - Alternate portability path: `"/loop"` with a self-throttled checkpointed prompt
     that waits until `now >= wake_at` before leaving reset mode.
5. On wakeup, run the **separate probe budget** first against the endpoint that maps to
   the quota-limited engine for this recovery path (typically `<quota_limited_endpoint_name>`):
   `node bin/autopilot.js endpoints test <quota_limited_endpoint_name> --json`.
   This is explicit network+auth preflight to avoid immediately spending heavy
   implementation budget.
6. If probe is `outcome: ok`, execute the R3 path:
   `scripts/run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>`.
   This is the required idempotent continuation step; no bespoke resume branch.
7. If probe reports limit still active (`outcome: network_failed` with `http_status: 429`
   or equivalent `still_limited`) or is `auth_failed`/`network_failed` due to auth plane outage, do **not** retry
   immediately. Apply exponential backoff with jitter (`delay *= 2`, capped), reschedule
   via step 4, and re-run step 5 only at the new wake time.

### 2. Outcome → action table

Every foreman / `dispatch-hetero.sh` outcome maps to a defined action — no
outcome is a silent no-op. The first six rows are `dispatch-hetero.sh`'s outcome
vocabulary (see [`references/hetero-dispatch.md`](../../../references/hetero-dispatch.md)
§ "Outcome states"); the final `killed` row is **not** a script status — it is the
CEO's own state after calling `TaskStop <agentId>` at the budget cap (§1), and on
the native `/l4` path an `Agent()` dispatch failure surfaces as a tool error, not
a JSON outcome.

| Outcome | Depth-0 action |
|---------|----------------|
| `committed` | Continue to qc@depth-0 (below). |
| `no_op` | Verify scope was genuinely empty → done, or **retry once** with a sharper brief. |
| `dirty` | Escalate (worker committed then left the tree dirty — not reviewable). |
| `failure` | Escalate (clean commit but abnormal exit — run not trustworthy). |
| `question_suspected` | Escalate (worker likely paused on a clarifying question). |
| `precondition_failed` | **Gated on `on_engine_unavailable`** (from `resolve-review-loop.sh`): `ask` / `wait-reset` → escalate to the user (record in ledger; do **not** auto-`--solo`); `solo-fallback` → run `session-mode.js set --level l3 --entry-level lN --fallback precondition_failed --repo-root <repo>` and fall back inline only if the same Mission admission digest remains. For `/l5`/`/l6` this is a `dispatch-hetero.sh` JSON status; for native `/l4` it is any `Agent()` call failure (a tool error, not JSON). |
| `killed` (budget cap — CEO state, not a script status) | Escalate (see §1). |
| `failed`/`killed` (foreman died before normal outcome emission) | run `run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>` and let it perform recovery: locate last ledger stage, bump generation (`stage-acquire --allow-reopen`), hold resource lock, reconcile by `stage-reconcile` before any redo, adopt git-truth when available, and report `review_round_owed`. If `status=already_applied`, caller must treat as a true no-op recovery replay. On `quarantined`/D resources, resume must refuse the old resource and request a new resource path. |

### 3. qc@depth-0 is THE gate

The foreman runs dev-flow → finish-flow, which has its **own** L-5 qc. That qc is
explicitly **first-pass / non-authoritative**.

The authoritative gate is a **depth-0 QC panel** whose reviewer families/panel
come from `scripts/resolve-review-loop.sh` (`qc_panel` /
`required_review_families` / `min_panel_size`); resolver unavailable → fall back
to 3 reviewers. A homogeneous (all-Claude) panel must not drop below the
resolver's **`min_panel_size`** (default 3) — a panel-size floor emitted
separately from families because lens diversity ≠ family decorrelation
(same-family lenses can share blind spots). Dispatch subagents,
each with a **distinct non-overlapping lens** (e.g. correctness,
security/faithfulness, completeness/edge-cases; for LLM-behavior or
data-into-system changes add a domain lens), each reading the foreman's
**artifacts** (the branch diff) and **citing `file:line`**, default-assuming
broken until proven, per blind-dispatch clause 1
([`references/blind-dispatch.md`](../../../references/blind-dispatch.md)). The CEO
**synthesizes** their findings into the pass/fail verdict and **fixes or reverts
every real issue before integration**. Scale panel composition to resolver output
and blast radius.

**Disjoint-family panel (when `review-loop-config.md` sets a `qc_panel`).** By
default `/l4` stays homogeneous — diverse *lenses*, one *family* — with the
**`min_panel_size` floor** above; resolver unavailable → fall back to 3 reviewers. For
`/l5`/`/l6` (heterogeneous implementer) that is a decorrelation hole: if the
implementer is OpenAI (`gpt-5.3-codex-spark`), a same-family reviewer shares its
blind spots. So resolve the panel from `scripts/resolve-review-loop.sh` (`qc_panel`)
and dispatch a **disjoint-family** set — Claude/Opus via the native Agent tool,
non-Claude vendors via **`scripts/dispatch-review.sh --runner codex|agy`** (read-only;
the agy/Gemini track is verified — agy's write bug is implementer-only). The panel
must span **≥1 family different from the implementer's** (the resolver warns on
overlap). Synthesis is **`union-on-verified-critical`**: any single panelist's
**verified** Critical blocks the gate — **never a majority vote** (a blind-spot catch
is seen by only one track; majority would suppress exactly what decorrelation surfaces);
"verified" = reproduce via the `independent_harness` (execution) for executable claims,
else a depth-0 second-look. A panelist returning `no_verdict` (empty/stdout-drop) is
**fail-closed** — treated as "did not clear", never as a pass. Full rule:
[`skills/quality-pipeline/references/code-review.md`](../../quality-pipeline/references/code-review.md) § "Panel aggregation".

**Provenance + risk (v2.25.11).** The policy is inert without authoritative implementer
provenance at review time — persist a **dispatch manifest** {engine, family, tier, runner,
worktree/artifact id} alongside the diff (the `dispatch-hetero.sh` outcome JSON already carries
`runner`/`model`/`containment`); **missing/unverifiable manifest ⇒ fail-closed to the strictest
tier**. Pass the diff's risk inputs (size, protected-path, oracle-available, security-surface) to
`resolve-review-loop.sh`; at **high `review_risk`** the decorrelated execution oracle (`l1_required`)
and a cross-family panel are mandatory — enforce with `resolve-review-loop.sh --enforce` (exit 3 on
an unsatisfied high-risk gate). This hardens HONEST-but-WEAK implementers only — NOT a malicious
worker (see the test-integrity isolation BACKLOG).

**Two operating rules the panel itself will not enforce for you** (both learned by hitting them,
2026-08-27):

- **Pre-check the reviewer payload before you spend a dispatch.** `scripts/check-blind-evidence.sh
  --payload <spec-file> --json` refuses a payload carrying implementer narrative (blind-evidence rule
  K1). A spec that tells the panel what the author concluded — "the author decided X, judge it", "a
  bypass was found and fixed here" — primes exactly what the blind rail exists to prevent, and
  `dispatch-review.sh` will reject it as `precondition_failed` **after** you have queued the seat.
  Write the questions without the answers, run the checker, then dispatch. State the open design
  questions as questions the reviewer must answer *from the diff*, never as decisions to ratify.
- **Reproduce every finding yourself before forwarding it.** A panel seat reports what it believes it
  read; depth-0 owns what gets acted on. Reproducing takes minutes and does three things a forward
  does not: it upgrades a Major to a Critical when the impact is worse than reported, it catches the
  finding that is simply wrong (a NUL byte in a test fixture misread as a space, claimed to make the
  suite "permanently red" — the suite was green), and it gives the implementer a command to re-run
  rather than a claim to interpret. **Reject on the record**, with the evidence, rather than silently
  dropping — an unadjudicated finding reappears next round.

**The depth-0 qc is DISPATCHED, never the CEO eyeballing the diff inline.** A
single self-read from the CEO's own context is itself only a first-pass and does
**not** clear the gate — the value is *independent adversarial coverage*, not a
second opinion from the same head. (Failure mode, 2026-06 dogfood: CEO self-qc'd a
~700-line merge instead of fanning out reviewers; caught only because the user
flagged it.) **Hold the push/merge until the synthesis is clean.** Not two real
gates — one **adversarial panel** (depth 0) + one self-check (foreman). The
run-summary ledger (below) must show the depth-0 panel **distinct from** the
foreman's first-pass qc.

### 4. Merge-back is owned by depth 0

`dispatch-hetero.sh` (and the foreman pattern) deliberately **never merge** — they
branch off a pinned base and only remove the worktree on success. After the
**authoritative qc verdict passes at depth 0**, the CEO integrates the foreman's
commit. **Mind the base**: the foreman worktree branches off the *tracked* base
(`develop`), NOT the CEO's checked-out HEAD (see Gotchas). When the CEO is on a
feature branch, first verify the foreman base. Prefer an identity-preserving merge
when that base is compatible; this makes containment mechanically provable. A
tactical `git cherry-pick <foreman-commit>` copies a commit but does **not** make
the source branch an ancestor. After cherry-pick, preserve that source (bundle +
exact-tip ack/handoff) until depth 0 explicitly discards it; the reaper must keep
it uncontained. On conflict, retry once, else escalate — never auto-resolve.

After an identity-preserving merge, retire dispatch-owned dated branches through
the deterministic reaper, not an ad-hoc broad branch glob. Reuse finish-flow
L-5.6's exact `autopilot_root` resolver and authoritative `integration_target`
derivation; do not create a second resolver here. If those values have not yet
been resolved, run that L-5.6 procedure first and halt on any ambiguity. Bind the
consumer independently so a plugin-package script is never resolved from its git
root:

```bash
consumer_repo="$(git rev-parse --show-toplevel)"
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap --repo "$consumer_repo" --into "$integration_target" --yes
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap --repo "$consumer_repo" --into "$integration_target" --reap-superseded --dry-run
# Uncontained superseded rounds remain preservation/manual-disposition items.
```

Only branches contained by the authoritative branch are deletion-eligible. Every
deletion is preceded by one verified full-history bundle. Branches outside the
reaper grammar remain explicit preserve-first harness cleanup responsibility.

### 5. Worktree GC

At every L5/L6 deliverable transition, run the task status surface. Run it again before merge, after
merge, and immediately before finish-flow clears the session marker:

```bash
node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id"
```

The caller persists the exact LSM input bundle as
`${AUTOPILOT_TASK_STATUS_DIR:-${TMPDIR:-/tmp}/autopilot-task-status}/<root_run_id>.json`;
the CLI rejects a mismatched/unsafe root id and recomputes live Git/WLB observations rather than
trusting cached booleans.

The four labels `product_merged`, `consumer_updated`, `pushed`, and `zero_residue` are independent.
Only `can_close=true` is `DONE`; Mission terminal or a successful merge alone is never a clean
closeout.

Every non-success outcome (`dirty` / `no_op` / `question_suspected` / `failure`)
**keeps** its worktree by design (caller's cleanup). The CEO reaps kept worktrees
and branches immediately after handling the outcome. For managed schema-2
L5/L6 leaves, keep the campaign `root_run_id` unchanged and use the canonical
controller sequence; manual removal would discard the write-ahead branch
inventory:

```bash
: "${lifecycle_artifact_dir:?set a caller-owned durable artifact directory}"
: "${campaign_id:?bind the admitted sealed campaign_id}"
[[ "$campaign_id" =~ ^campaign-v1-[0-9a-f]{64}$ ]] \
  || { printf '%s\n' 'invalid lifecycle campaign_id' >&2; exit 2; }
root_run_id="$campaign_id"
lifecycle_dir="$(mktemp -d "$lifecycle_artifact_dir/root-$root_run_id.XXXXXX")" \
  || exit 2
bash "$autopilot_root/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$consumer_repo" --root-run-id "$root_run_id" --yes \
  >"$lifecycle_dir/worktrees.json" || exit $?
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap \
  --repo "$consumer_repo" --into "$integration_target" \
  --inventory-file "$lifecycle_dir/worktrees.json" --yes \
  >"$lifecycle_dir/branches.json" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" issue \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --worktree-result "$lifecycle_dir/worktrees.json" \
  --branch-result "$lifecycle_dir/branches.json" \
  --out "$lifecycle_dir/residue-receipt.json" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" check \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --receipt "$lifecycle_dir/residue-receipt.json" || exit $?
node -e '
const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (value.zero_residue !== true) process.exit(1);
' "$lifecycle_dir/residue-receipt.json" \
  || { printf '%s\n' 'lifecycle residue remains' >&2; exit 1; }
```

- Persist the artifact directory outside every leaf and record it in the run
  summary for LSM. Each attempt gets a unique mode-0700 directory, and every
  command is fail-fast so a failed attempt cannot validate a stale prior
  receipt. Bind `root_run_id` explicitly from the admitted sealed
  `campaign_id`; never read the outer foreman lineage or a leaf result for this
  value. Validate the id and add the fixed `root-` prefix before path
  construction. A
  successful `check` proves freshness only; inspect
  `zero_residue` separately. `false` blocks resource closure and names the
  dirty/live/unknown state that must be resolved before rerunning.
- For the `/l5`/`/l6` agy path, the worktree path is in the outcome JSON (`worktree`
  field) and the branch in the `branch` field. For a retained managed leaf, the
  controller sequence above reaps **both** or emits exact blockers; never
  force-remove past a dirty, live, malformed, legacy, unsupported, pending, or
  raced state. For a dated branch covered by `reap-dispatch-branches.sh`, let
  the reaper prove containment, create and verify its bundle, then delete it;
  do not use an unchecked `git branch -D`. On a
  `committed` outcome the worktree is already auto-removed (`worktree: null`); after
  an identity-preserving merge run the contained reaper pass above. After a
  cherry-pick, keep + ack/handoff the uncontained source. Out-of-grammar
  `hetero/<name>` branches require explicit preserve-first inspected cleanup.
- Native Claude foreman worktrees are not schema-2 managed leaves. For a killed
  native foreman, the path is deterministic
  (`.claude/worktrees/agent-<agentId>`); if unknown, discover via a
  `git worktree list` diff (worktree base ≠ HEAD — see memory
  `worktree-dispatch-gotchas`). Preserve its exact branch tip first, then
  `git worktree remove --force <path>` and `git worktree prune`. Never use a bare branch -D.

### 6. Decision ledger + round-end report (autonomous-brain P3)

Every autonomous depth-0 decision (proxy rulings, dispatches, auto-picks,
re-freeze transitions) is appended to the campaign's decision ledger BEFORE the
round ends, with a rationale — a decision the operator cannot read is a decision
that did not happen (KR3; sol shape F12):

```bash
node scripts/decision-ledger.js append --ledger <campaign>/decision-ledger.jsonl \
  --kind decision --json '{"decision_id":"d-N","round":R,"class":"tactical",
  "rationale":"...","reversibility":"two-way"}'
```

At each round boundary render the report — the operator's no-polling window into
the run (代決清單 with veto handles, auto-picks, ask-first queue, stall status,
experience-critic findings):

```bash
node scripts/decision-ledger.js report --ledger <ledger> --round R \
  [--stall <stall.json>] [--critic <critic.json>]
```

#### Ladder probe at the round boundary (unknown-escalation ladder)

Right after the report, run the probe over the same ledger and act **only on `recommend`** — the
DOA table lists which rungs the foreman may climb, it is not a climb-if-budget-left rule
(plan `docs/plans/2026-09-07-unknown-escalation-ladder.md` P4; budgets from
`review-loop-config.md`, work unit = the whole run):

```bash
node scripts/probe-unknown.js classify --ledger <ledger> --work-unit <run> \
  --convergence <convergence.json> --stall <stall.json> --terms <round nouns>
```

- `U1` ⇒ `bash scripts/dispatch-consult.sh --question-file <q> --artifact <a> --ladder-receipt <ledger> --ladder-terms <terms> --ladder-unknown-type <type> --ladder-signals <ids from classify> --ladder-work-unit <run>`.
- `U2` ⇒ dispatch `autopilot:survey` (or its `issue-search` mode for a `why` unknown) **in the background**, keep the round moving on independent work, and when the result is read: `node scripts/probe-unknown.js receipt --ledger <ledger> --rung U2 --unknown-type <type> --terms <terms> --signals <ids> --work-unit <run>`.
- `U3` ⇒ by the classify output's `unknown_type`: `whether` (S5) → `autopilot:think-tank`; `why` (S1/S2/S3 — the `--convergence`/`--stall` inputs above make this a live outcome here) → `autopilot:debugger` PUA; then `receipt … --rung U3 --unknown-type <type> --signals <ids from classify>`.
- The probe never recommends U4 by itself (a spent budget is `none`, never an escalation). U4 is the run's own stop — the stall fuse (§8) or a DOA boundary — and when that stop fires the foreman attaches `ladder_receipts:` (the ledger rows) to the `[ESCALATION]`, so the owner sees the concrete, reviewable climbs, not a summary.
- `none` ⇒ continue; the probe's `reason` (`budget-exhausted` / `not-heterogeneous` / `knob-off`) is printed in the report's Ladder section. Exhaustion never buys a higher rung and never escalates.

Vetoes are the operator's asynchronous authority: `decision-ledger.js veto --id
<decision_id>` refuses every later round that declares that decision in
`based_on_decisions` (enforced by `check-blueprint-conformance.js preflight`,
never by convention). Undoing already-performed work becomes a front-queued
repair unit. The ledger is plain append-only telemetry (ADR-0001): unlogged
decisions are caught by the conformance audit's ledger-INDEPENDENT universe
(dispatch manifests / run-ledger / git), never by trusting the ledger itself.

### 7. Stateless round protocol (autonomous-brain P2)

The depth-0 brain holds no load-bearing state in context — context is a cache,
disk is the store (sol shapes F8/F9: compaction amnesia gets refilled by process
reinvention; the fix is architectural, not mnemonic). Every round:

```
① rehydrate: node scripts/build-rehydration-bundle.js build --contract <c> \
     --ledger <ledger> --manifest-dir /tmp/autopilot-dispatch-runs [--red-lines <f>]
   (five frozen sections, 80KB cap, over-cap = BUILD ERROR — never truncated)
② execute the round (dispatch under the conformance preflight, §-2/§3)
③ persist: every decision → ledger (§6); progress → run-ledger; findings → BACKLOG
④ round boundary: render the report (§6), then RESET context deliberately —
   the next round boots from ① again
```

After any kill/compact/resume, the brain must pass the machine-graded state quiz
BEFORE proceeding: emit `{current_unit_id, four_tuple_digest, owned_pids,
last3_decision_ids}` and grade with `build-rehydration-bundle.js grade` — a
mismatch means the resumed brain's picture of the run differs from disk truth,
and the round refuses to start. Owned processes re-attach from the manifest
table (§5_owned_processes), never from memory — a worker the ledger knows about
is OURS even if the resumed context has never heard of it.

### 8. Stall fuse (autonomous-brain P4)

At each round boundary, classify the burst's delta and consult the fuse before
starting the next round (sol F5/F10: verification consumed the run — but note
the F2 boundary: a mega-batch HAS product delta and is the churn preflight's
kill, not this fuse's):

```bash
git diff --name-only <burst-base>..HEAD > /tmp/burst-names.txt
node scripts/check-stall-fuse.js classify --names /tmp/burst-names.txt \
  # → append {burst_id, product_files, verification_files} to the campaign's bursts.jsonl
node scripts/check-stall-fuse.js check --bursts <campaign>/bursts.jsonl \
  --strike-identity-file <seat-identity.json> --strike-store <capability-store>
node scripts/check-blueprint-conformance.js audit \
  --contract <contract> --intent <intent> --repo <repo> \
  --manifest-dir /tmp/autopilot-dispatch-runs --ledger <ledger> \
  --strike-identity-file <seat-identity.json> --strike-store <capability-store>
```

The strike flags (brain-seat-exam-suite KR3b) make a trip / audit failure also
append ONE identity-keyed strike row to the capability store — 3 strikes since
the seat's last exam pass flip its standing to `requalification_required`
(`engine-capability-state.js brain-status`). Both flags together or neither; a
strike append that cannot complete fails the instrument closed (exit 2).

Tripped ⇒ HALT: no further dispatch this campaign; render the round-end report
with the stall section and stop for the operator. Also immediate-violation:
re-verifying a finding with a full-suite rerun (`reverify.mode:"full-suite"`) —
finding closure re-runs the finding's surface plus the frozen gate set, nothing
more.

### 9. Post-merge experience critic (autonomous-brain P6)

AFTER merge-back (§4) completes — never before — launch the user-persona critic
on the shipped deliverable (methodology: `references/experience-audit.md`; the
script enforces the post-merge guard in-code via git ancestry, so no caller can
turn it into a gate):

```bash
bash scripts/dispatch-experience-critic.sh \
  --deliverable <merged-sha> --integration-ref develop --repo <repo> \
  --instantiation <blueprint's frozen five-question answers> \
  --evidence <rendered-consumption output> --out <critic.json> \
  --runner <r> --model <m> [--endpoint <e>]   # decorrelated family, single round
```

Findings (≤7, stable IDs, BACKLOG-row-ready) feed the round-end report
(`decision-ledger.js report --critic <critic.json>`); the brain appends accepted
rows to docs/BACKLOG.md where `/next`'s queue prices them. `human_only` items go
verbatim to the operator. A "blocking" marker from the critic is stripped and
surfaced as an anomaly — correctness gates alone block.

### Quality-floor conventions (v2.31.11)

The five structural ledger-emission points — playbook no-match; adjudication unvalidatable-REFUTED / unconfirmed-PROOF_BY_TRACE; panel irreversible-disagreement; plan-revision checkpoint trips (risk-counter thresholds); depth-0 override of a dispatched artifact — each emits an `escalation_opened` tree event. See the quality-floor plan (`docs/plans/2026-07-04-quality-floor-engine.md`).

## Phase L: width fan-out control loop (the depth-0 loop driving `dispatch-batch.sh`)

When the foreman decomposes a round into **≥2 file-disjoint units** (fixed cap 3,
`/l4` homogeneous only), the **depth-0 loop** — NOT the foreman, NOT a shell script —
drives the batch. The deterministic git/artifact/merge/telemetry/reap rails live in
[`scripts/dispatch-batch.sh`](../../../scripts/dispatch-batch.sh) (full contract:
[`references/batch-dispatch.md`](../../../references/batch-dispatch.md)); the loop below
is the harness-only half a shell cannot do (it holds N `agentId`s and uses
`Agent`/`Monitor`/`TaskStop`, which are **not shell-callable**).

```
CEO depth-0 loop (clock owner)
├─ 1. dispatch-batch.sh plan  → ENFORCE single-base; collision-safe branches; advisory propose
├─ 2. telemetry t_dispatch    → start the Amdahl clock
├─ 3. Agent(run_in_background, isolation:"worktree") ×N  → hold N agentIds (one per unit)
├─ 4. Monitor for all-N completion (or budget cap → TaskStop ALL + escalate)
├─ 5. telemetry t_all_committed
├─ 6. dispatch-batch.sh verify  → per-unit outcome table + ALL-OR-NOTHING verdict
│        any non-committed OR undeclared touch ⇒ TaskStop survivors, GC worktrees, ESCALATE
├─ 7. qc@depth-0 over the COMBINED diff (the files-only carve-out — review cross-unit coupling)
├─ 8. dispatch-batch.sh merge-back  → merged | serial_collapse (re-run named ids serial) | base_advance_failed (fix base worktree, re-run; do NOT GC)
└─ 9. telemetry t_review_done; GC all unit worktrees + branches (ONLY on `merged`)
```

### Outcome → action table (width layer)

Each unit's `verify` status maps to a defined depth-0 action — extends the §2
single-unit table. **ALL-OR-NOTHING governs the batch verdict.**

| Unit `verify` status | Depth-0 action |
|----------------------|----------------|
| `committed` + disjoint-clean | merge-eligible — but the **batch** merges only if **every** unit qualifies. |
| `committed` but **undeclared touch** (disjoint:false) | **whole batch aborts** — `TaskStop` any survivors, GC, escalate. |
| `no_op` / `dirty` / `failure` (any non-committed) | **whole batch aborts** — same. |
| batch `merge-back` → `serial_collapse` | re-run the named `serial_collapse_ids` as **ONE Tier-1 serial unit** (width collapses to 1 for those ids). **Never** auto-resolve; **never** a coordinated round-2 re-dispatch (breaches blind-dispatch). |
| batch `merge-back` → `base_advance_failed` | units committed cleanly but the base ref did NOT move (dirty base worktree / non-ff / concurrent base move). **Merged nothing — do NOT GC the unit branches** (work is still recoverable). Resolve the base worktree, then re-run `merge-back`. |

### Authorization = the disjointness gate, at two points

- **Plan-time (advisory):** `dispatch-batch.sh plan` runs `check-disjointness propose`
  over the declared scopes → `advisory_disjoint`. **Logged, never the clamp** — the LLM
  is never the gate.
- **Verify-time (authoritative):** `dispatch-batch.sh verify` runs `check-disjointness
  validate` over **git artifacts** per unit. Fail-closed.
- **Single-base-per-batch** is enforced at `plan` (mixed base ⇒ "not a valid
  decomposition"). All siblings fork ONE integration point.

### Reaping width workers — TWO different kill primitives

- **`/l4` homogeneous (Agent-tool workers):** reaped by **`TaskStop <agentId>`** — the
  same primitive as the single-foreman budget cap (§1), applied to each held agentId. On
  batch abort, `TaskStop` **every** survivor, then GC their worktrees
  (`.claude/worktrees/agent-<agentId>`, `--force`; unchanged ones auto-clean). This is the
  homogeneous path that ships.
- **Shell-dispatched (hetero) workers:** reaped by `dispatch-batch.sh reap` (SIGTERM to the
  worker process **group** — `--abort` for the whole batch, `--unit <id>` for one stalled
  unit). This rail exists for the BACKLOG `/l5` parallel path; it is **not** how `/l4`
  homogeneous workers are killed.

### Amdahl telemetry — emitted by the depth-0 loop (named clock owner)

The depth-0 loop (the only component that sees all of dispatch → all-committed →
review-done) emits `t_dispatch / t_all_committed / t_review_done` via
`dispatch-batch.sh telemetry`. `telemetry report` is **cross-run** tuning of the width
cap over time — **never a within-run gate** (a single run never blocks on its own
serial-fraction).

> 🔴 **The S1 carve-out is intact and LOAD-BEARING here.** `verify` (and the `propose`
> advisory) certify **files, not behavior**. Step 7's depth-0 qc reviews the **combined**
> diff for cross-unit semantic coupling **exactly as hard as a single-unit diff** —
> file-disjointness is not a behavior clearance, and a green batch verify must never induce
> reviewer rubber-stamping. This is the dominant failure mode the width cap is designed
> around; do not omit it.

## Run-summary ledger

The foreman returns — and the CEO records in the final CEO Report — a ledger with
one row per step:

| step | runner | model | verdict | work_domain | artifact |
|------|--------|-------|---------|-------------|----------|
| plan | claude | (foreman tier) | n/a | — | (plan doc / inline) |
| impl | claude \| agy | sonnet \| Gemini 3.5 Flash | committed | backend-cli | `<branch>@<sha>` |
| foreman first-pass qc | claude | (foreman tier) | pass (non-authoritative) | — | (qc notes) |
| recovery | claude | (depth-0 tier) | resumed / already_applied / blocked_resource | — | run-ledger resume payload (`run_id`, `resume_point`, `new_generation`, `adoption`) |
| **depth-0 qc panel (authoritative)** | resolver `qc_panel` / claude ×N (homogeneous panel ≥ resolver `min_panel_size`) | (depth-0 tier) | **pass/fail** (synthesized) | — | per-reviewer `file:line` findings over `git diff <base>..<branch>` |

- **`runner`/`model` provenance** for the impl step comes straight from
  `dispatch-hetero.sh`'s outcome JSON (`runner`/`model` fields) for the `/l5`/`/l6`
  path, or is `claude`/`<worker tier>` for the native `/l4` path.
- **`work_domain`** (impl row only) is **telemetry, never a routing input** — the
  deterministic dominant domain of the impl diff from
  `scripts/resolve-review-loop.sh --auto-domain <base>..<commit>` (the `base` +
  `commit` fields from `dispatch-hetero.sh`'s outcome JSON — `base` is the
  immutable SHA passed via `--base`; NOT ambient `HEAD`, which the worktree GC on
  success would break). Values: `rust` \| `backend-cli` \| `frontend` \| `docs` \|
  `mixed`. It records what kind of work ran so per-domain model performance can be
  measured later; it selects no engine. See `scripts/probe-diff-domain.sh`.
- The ledger makes success criterion #3 (depth-0 gate distinct from first-pass)
  and #6 (provenance present) verifiable from the report alone.

**After the ledger, ask once whether this run's posture should become the default** — one
line, not a flow: "把這次的 run_approval 設定存成預設嗎？". On yes, run
`node <plugin>/scripts/run-approval.js persist --mode <mode>`; on anything else, say nothing
further and end. The question exists so a posture that worked can be kept without editing
config by hand, and it is deliberately the ONLY thing that gets written: red lines, the DOA
boundary and the irreversible-operation carve-outs are never persisted from a run outcome.
One good run is evidence about that run, and the moment right after a success is exactly when
an owner is most inclined to agree to anything — so the write is capped at the mode, stays in
machine-local `~/.autopilot/config.json`, and never touches a version-controlled config.

## Gotchas

- **New skills aren't dispatchable until a Claude Code restart** — the plugin
  caches skills at session start. After adding `/l3 /l4 /l5 /l6`, restart before the
  dogfood run.
- **Worktree base default = `origin/develop`, NOT the CEO's HEAD — but selectable via
  `worktree.baseRef`.** See the canonical treatment + the base-currency decision table
  under "Dispatching the foreman" above. Short form: independent task → default `fresh`
  is fine; build-on-un-merged-CEO-work → set `worktree.baseRef:"head"` (CC; in-session,
  no restart) or the portable `git reset --hard <CEO-HEAD-sha>` STEP-0 fallback (verify
  a sentinel, STOP on failure); integrate via cherry-pick (§4). The `/l5`/`/l6` hetero impl is
  a **separate mechanism** — `worktree.baseRef` doesn't reach it; pass
  `--base "$(git rev-parse HEAD)"` to `dispatch-hetero.sh` instead.
- **`git worktree prune` alone is a no-op** on an on-disk worktree — `remove
  --force` first.
- **Cross-platform**: `/lN`, `Agent(run_in_background)`, `TaskStop`, and `Monitor`
  are Claude-Code-deep. On other agents the front-door may degrade to `--solo`
  (inline CEO), but it still runs the same Mission routing admission first. Only the
  offload topology depends on the CC primitives.
