# Plan — Cursor CLI (`cursor-agent`) as an autopilot heterogeneous runner

> **Status**: reviewed — 3 rounds / 6 generations, 44 blockers accepted and repaired, all
> terminal verdicts CONDITIONAL. Awaiting Board approval (see Review log).
> **Owner**: cookys
> **Branch**: (unassigned — cut from `develop` @ `cd3f5f85` at implementation time)
> **Frame**: L-size. One new dispatch rail + its qualification path.
> **logical_plan_id**: `cursor-cli-adaptor-2026-08-26`

## 0. Context / thesis

Autopilot's heterogeneous rails today are six per-vendor CLIs, each with its own auth, its own
flag dialect, and its own failure modes: `codex`, `agy`, `grok`, `cc-shim`, `pi`, `qoderclicn`.
Adding a vendor means adding a rail.

Cursor's CLI (`cursor-agent`) is different in kind: **one OAuth login exposes ~60 models across
five vendors** — `cursor-grok-4.6-*`, `gpt-5.3-codex-*`, `claude-opus-5-*`, `gemini-3.7-flash-high`,
`composer-2.5`. One adaptor therefore buys most of the decorrelation matrix that currently costs
four separate installs and four separate credential stores.

Throughput was measured before proposing this (§6.1), and the CLI's headless contract was
probe-verified rather than read off `--help` (§0.1). This plan is the wiring + qualification
path; it does **not** claim cursor is routable — that is Stage 1's job.

### 0.1 Probe-verified facts (2026-08-26, `cursor-agent 2026.08.11-e8db854`)

Each row was produced by running the tool, not by reading documentation.

| # | Fact | How |
|---|------|-----|
| P1 | Installed at `~/.local/bin/cursor-agent`; logged in, `apiKeySource: "login"` | `--version`, `status` |
| P2 | Headless print mode works with `-p --output-format stream-json` | full event stream captured |
| P3 | **`--trust` is mandatory headlessly** — without it the run aborts on workspace trust | run in an untrusted dir |
| P4 | **Process cwd is honored** — the `system/init` event echoes it | init event |
| P5 | **`--workspace <abs>` anchors edits** — run from `/tmp` with `--workspace $D`, the edit landed in `$D`, nothing was written to `/tmp` | S2 spike, throwaway git repo |
| P6 | **Edit-only by default** — the agent edited and did not commit; `git status` showed `M target.txt` | same S2 spike |
| P7 | **`-p` reads the prompt from stdin** | `echo … \| cursor-agent -p …` returned the exact string |
| P8 | **`-f/--force` auto-approves tool calls headlessly** | S2 spike completed a write with no prompt |
| P9 | **`--mode ask` refused to write** when explicitly told to overwrite a file; file unchanged | S2a spike (see R-3 for the limit of this evidence) |
| P10 | `result` event carries `usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}` and `duration_ms` | probe |
| P11 | **`--stream-partial-output` is not per-token**: only 3 `thinking` deltas, all inside 1 ms; assistant text arrives as one non-delta message | raw stream capture |
| P14 | **`--list-models`**: rc 0, **208 stdout lines, stderr empty**. Line 1 `Available models`, line 2 blank, then 204 entries of the exact form `<id> - <display name>`. Also confirms the P15 hazard directly: `grep -c 'cursor-grok-4.6-low'` returns **2**, `grep -c '^cursor-grok-4.6-low '` returns **1**. | probe, raw output retained |
| P15 | The id set contains **strict-prefix pairs** (`cursor-grok-4.6-low` is a prefix of `cursor-grok-4.6-low-fast`), so any substring test over this output is unsound. | derived from the P14 receipt |
| P13 | **`--output-format text` returns clean assistant prose on stdout, stderr empty** — the S2a run (`-p --trust --mode ask --output-format text --model cursor-grok-4.6-low-fast`) returned only the answer text. The `--model` flag itself is exercised by every run in §6.1 and §0.1. | S2a spike + §6.1 runs |
| P12 | Effort is encoded in the **model id**, not a flag — **behaviorally**: `--reasoning-effort high` and `--effort high` are each rejected with `error: unknown option`, while the suffixed ids `-low`, `-low-fast`, `-high-fast` all ran to a `result` event (§6.1). The `--help` bracket-override syntax is **not** claimed here: nothing in this plan uses it and it has no probe. | flag-rejection probe + the §6.1 runs |

**P4+P5+P6 together are the load-bearing result**: cursor is a *grok/qoder-shaped rail* — honors
the target directory, leaves edits uncommitted, wrapper commits, verdict read from git artifacts.
It needs none of agy's absolute-path anchor machinery.

## 1. Problem

There is no way to dispatch work to any Cursor-hosted model from autopilot. Every model behind
that one subscription is unreachable by `dispatch-hetero.sh`, `dispatch-review.sh`, and
`dispatch-author.sh`.

Worse, the models are **actively mis-routable**: `set_runner_flags()`
(`scripts/dispatch-hetero.sh:1670-1682`) auto-selects on substring, so a caller who types
`--model cursor-grok-4.6-low` today is silently routed to the xAI `grok` CLI, and
`--model gpt-5.3-codex-low` to the OpenAI `codex` CLI. Both fail late and confusingly.

## 2. OKR / KRs

**O**: One Cursor rail, honestly scoped — dispatchable, never silently mis-routed, and not
routable until it has earned it.

- **KR1**: `scripts/dispatch-hetero.sh --runner cursor --model <id>` reaches `status: committed`
  on a real edit task in an isolated worktree, and `--runner auto --model cursor-grok-4.6-low`
  reaches **no** rail (explicit precondition failure, not a silent grok dispatch).
- **KR2**: `dispatch-review.sh --runner cursor` and `dispatch-author.sh --runner cursor` both
  return a parsed verdict / authored output on a real call.
- **KR3**: `src/harness/capabilities/cursor.json` exists and records only what a probe produced
  — nothing is `verified` without a receipt.
- **KR4**: `scripts/engine-qualify.sh implementer` runs to a recorded outcome against the cursor
  rail. Passing is not a KR; **running it and recording the honest result** is.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10; built-ins only. No new npm dependency in this plan.
- Every cursor invocation passes `--trust`; without it the run aborts on workspace trust (P3).
- Cursor has **no** `--reasoning-effort` flag. Effort is the model-id suffix. Do NOT add
  `--reasoning-effort`, `--no-auto-update`, or any flag not present in `cursor-agent --help`.
- `--runner cursor` is **explicit-only**, and `auto` must **fail closed** on it: a model id with
  the `cursor-` prefix reaching the `auto` branch is a `die_precondition` naming
  `--runner cursor`, never a silent selection. `auto` must never *select* cursor — which is a
  different requirement from leaving the branch untouched, and the branch does get this one guard.
- Phase 1's default lane is **non-fast**. `-fast` is opt-in via `--cursor-fast` until its billing
  rate and quota behavior are known (§8 Q1). Throughput alone does not authorize a default.
- The cursor rail is **EDIT-ONLY**: the agent never commits, pushes, or opens a PR; the wrapper
  commits and a separate review verifies (identical rail contract to `grok` and `qoderclicn`).
- The model-id ladder is **not uniform** across families (`cursor-grok-4.5` has only
  `-high`/`-high-fast`). Any effort→model-id mapping must be validated against a live
  `cursor-agent --list-models` and fail closed on a miss — never hardcoded blind.
- Canonical scripts and their `platforms/codex/plugin/` mirrors stay byte-parallel.
- No new trust machinery (ADR-0001). Verification is re-derivation from git artifacts.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`, with **one deliberate `auto` behavior change**.
  Every existing `--runner` value keeps its behavior. `--runner auto` changes for exactly the
  ids in the Phase 1 table: `cursor-grok-4.6-*` and `gpt-5.3-codex-*` previously routed silently
  to the xAI `grok` / OpenAI `codex` CLIs — which do not serve them — and now fail closed with
  exit 2. That is repairing the §1 mis-route, not breaking a contract anyone could rely on, so
  no consumer migration follows. Because `gpt-5.3-codex-*` ids are genuinely ambiguous (the
  native codex CLI has its own `gpt-5.3-codex` family), the guard's message must name **both**
  `--runner codex` and `--runner cursor` and let the caller choose; a `cursor-*` id names
  `--runner cursor` only.
- **Dependency decision**: `none`. `cursor-agent` is an external CLI the operator installs and
  authenticates, exactly like `grok` / `codex` / `qoderclicn`; it enters the tree as a
  `command -v` precondition, not as a package.

## 3. File-structure map

### 3a. `scripts/dispatch-hetero.sh` — the `IS_CURSOR` flag, threaded like `IS_QODER`

The complete site list, grepped from the live file at `cd3f5f85`. Each is the `IS_QODER` /
`QODER_BIN` line that the cursor equivalent sits beside.

| Line | Responsibility |
|---|---|
| 21–22, 52, 77 | header usage block: `--runner` enum, the `--cursor-bin` **and `--cursor-fast`** seams, output-JSON `runner` enum. `--cursor-fast` is runner-scoped: passing it with any runner other than `cursor` is a `die_precondition`, same posture as `--endpoint` with a non-`cc-shim` runner (line 1829). |
| 123 | `CURSOR_BIN="cursor-agent"` default |
| ~173 | `IS_CURSOR=0` module-scope default |
| 707, 727 | runner label + the "no rail selected" guard in the early resolver |
| 1376, 1439, 1465 | the three other `runner=` label resolvers |
| 1473 | log-format selection (`jsonl` — cursor emits stream-json) |
| 1539 | `--cursor-bin` argv seam |
| 1660, 1667, 1682 | flag init, `cursor) IS_CURSOR=1 ;;` case, `--runner must be one of …` message |
| **~1679** | **the `auto`-branch fail-closed guard** → `die_precondition` naming `--runner cursor`, placed before the `*grok*` / `*gpt*` tests. Match semantics are defined **once**, here, and every other site quotes this row rather than restating it: **(a) prefix-open** — *any* `cursor-*` id fails closed, in or out of the Phase 1 table (so `cursor-grok-4.5-high` cannot reach `*grok*` either), message names `--runner cursor`; **(b) table-closed** — a non-prefixed id fails closed iff `cursor_is_enabled_id "$model"`, message names **both** `--runner codex` and `--runner cursor` (§2.6). Asymmetric on purpose: a `cursor-` prefix is unambiguous so it can be closed openly, while a bare `gpt-5.3-codex-*` id is a real native-codex family and must not be over-captured. The guard carries no id list of its own. |
| — | **Single source rule**: the enabled-id set is defined once, executably, in `scripts/lib/cursor-model.sh` (§4 Phase 1). The auto guard queries it, the negative-control test enumerates it, and the mapper produces from it. Three hand-maintained copies would drift while the test stayed green — that drift is the failure this row exists to prevent. | |
| ~1690 (post-parse) | **effort resolution**: when `IS_CURSOR=1` and `--model` names a family alias (`grok46` / `codex53`) rather than a full id, call `cursor_model_for "$CURSOR_BIN" "$MODEL" "$EFFORT" "$CURSOR_FAST"` and overwrite `MODEL`. A full model id passes through untouched. |
| 1539 (2nd seam) | `--cursor-fast` argv flag → `CURSOR_FAST=1` (default 0). **It never silently no-ops**: `--cursor-fast` together with a `--model` that is already a full id is a `die_precondition` ("`--cursor-fast` applies only when --model names a family alias; pass the `-fast` id directly"), because the mapper is bypassed on that path and the flag would otherwise be accepted and ignored. |
| 1786, 1807 | the two aggregate "no rail" guards |
| 1894–1895 | `command -v "$CURSOR_BIN"` precondition |
| 2114 | `local_runner="cursor"` |
| **2925** | **the invocation block** — inserted after the `IS_QODER` block (§4 Phase 2) |
| 3045 | `_runner_label` chain |
| 3428, 3436 | shared runner-name resolver for passive capture |
| 3894–3895 | `declare -p` exported-var list (`CURSOR_BIN`, `IS_CURSOR`) |

Line 1679 (`IS_QODER=1` inside the `auto` branch) has no cursor *selection* counterpart — the
cursor line added there is a refusal, not a route.

### 3b. Other files

| File | Responsibility |
|---|---|
| `scripts/lib/cursor-model.sh` (new) | `(family, effort, fast) → model id`, validated against `--list-models`. Sibling of `lib/grok-effort.sh`, different mechanism. |
| `scripts/dispatch-review.sh` | `--runner` allowlist at lines 33, 96, 201, 202; reviewer profile note at 60. Blind-review allowlist at 205 is **out of scope** (see §7 / R-3). |
| `scripts/dispatch-author.sh` | `--runner` allowlist at lines 40, 71, 681, 682. |
| `schemas/review-loop-contract.schema.json` | runner enum, 6 occurrences (lines 100, 131, 288, 392, 480, 511). **Phase 3**, not Phase 2 — these are what make `cursor` a routable review-loop role rather than a base-dispatch receipt field. |
| `src/readiness/probe.js:59`, `src/readiness/status.js:129` | runner id map + the runner-name regex. **Not** `status.js:42-49` — that is `resolveConfiguredRunner`, a model-*family*→native-runner map; adding cursor there would misclassify a Cursor-hosted OpenAI or xAI model's family identity. |
| `scripts/resolve-review-loop.sh` | four hard runner allowlists — verification_author (263-266), plan_reviewer and plan_deep_reviewer (344-349), panel/implementer tuples (538-581). **Only the panel/implementer tuples get a cursor entry, only in Phase 5, and only on a recorded Stage-1 pass**; the other three stay closed for this plan. A cursor entry is what lets a seat be *assigned*, so admission must exceed neither the qualification scope nor the qualification outcome (§4 Phase 3 matrix). |
| `scripts/probe-engine-capability.sh` | runner-specific binary and live-probe branches; the binary is `cursor-agent`, not `cursor`, so a name-derived fallthrough probes the wrong command. |
| `scripts/dispatch-status.js:172-174` | usage-key normalization accepts `cache_read_input_tokens` / `cached_tokens` / `cacheReadInputTokens` but **not** Cursor's `cacheReadTokens` (P10), so cache accounting silently reads null. |
| `scripts/engine-qualify.js:2784` | bin-flag map: `case 'cursor': return '--cursor-bin';` |
| `scripts/engine-scorecard.js`, `scripts/engine-qualify.sh` | **Checked at `cd3f5f85`, no cursor site needed.** `engine-scorecard.js`'s only runner-shaped enum is `TRANSCRIPT_PROVIDERS` (line 74, `import-transcripts` only) — the KR4 `record` path does not validate a runner against a list; `engine-qualify.sh` has no runner enum at all and passes through to `engine-qualify.js`. Recorded because KR4's recording step runs *after* the live spend, where a late rejection would be most expensive. |
| `scripts/dispatch-plan-review.js:87` | runner allowlist (and its codex mirror). |
| `references/hetero-dispatch.md` | runner table row (near line 535), the `runner` enum prose at 115, the max-output-tokens table at 98–99. |
| `src/harness/capabilities/cursor.json` (new) | capability record. Starts `status: "unverified"`, `harness_level: "H0"`. |
| `platforms/codex/plugin/**` mirrors | byte-parity for every touched canonical script. |
| `docs/scripts-inventory.md`, `CLAUDE.md` grouped list | one row + one basename for `lib/cursor-model.sh` (enforced by `check-claude-md-inventory.js`). |
| `CHANGELOG.md`, `.claude-plugin/plugin.json` | **PATCH** bump — a new runner is shipped-code hardening, not a new skill or agent. |

## 4. Phases

### Phase 1 — model-id mapper (S)

Write `scripts/lib/cursor-model.sh`. It is the **single executable source** for what this plan
enables, and provides three entry points over one table:

- `cursor_model_for(bin, family, effort, fast)` — resolve a family alias to an id.
- `cursor_enabled_ids()` — enumerate every id the table can produce, i.e. the table **closed
  under `fast`** (both `gpt-5.3-codex-low` and `gpt-5.3-codex-low-fast`).
- `cursor_is_enabled_id(id)` — membership predicate; what the §3a auto guard calls.

The last two are **pure table operations**: no binary argument, no subprocess, no network. The
auto guard runs on *every* `dispatch-hetero.sh` invocation, so making routing depend on a live
`--list-models` call would put a subprocess and a failure mode on the path of every unrelated
dispatch. Live inventory access belongs to `cursor_model_for` alone, which runs only when a
cursor model is actually being resolved.

The closure matters: `--cursor-fast` makes `-fast` ids reachable, so a match set built from the
non-fast rows alone leaves `gpt-5.3-codex-low-fast` mis-routing to the codex CLI — the §1 hole
in its third and narrowest form.

Baseline table for the two families this plan enables:

| effort | grok-4.6 | codex |
|---|---|---|
| low | `cursor-grok-4.6-low` | `gpt-5.3-codex-low` |
| medium | `cursor-grok-4.6-medium` | `gpt-5.3-codex` |
| high | `cursor-grok-4.6-high` | `gpt-5.3-codex-high` |
| xhigh | `cursor-grok-4.6-xhigh` | `gpt-5.3-codex-xhigh` |
| max | `cursor-grok-4.6-xhigh` (ceiling) | `gpt-5.3-codex-xhigh` (ceiling) |

`--cursor-fast` sets `fast=1`, which appends `-fast`; **the default is non-fast** (Global
Constraint 6). Two behaviors are mandatory, both learned from `lib/grok-effort.sh`'s
recorded history:

1. **Validate against the live inventory of the binary that will actually run.**
   `cursor_model_for` takes the resolved binary as an explicit first argument — the same
   `$CURSOR_BIN` the invocation uses, so `--cursor-bin` retargets validation and execution
   together and the test seam works. Parse `"$CURSOR_BIN" --list-models` (P14: skip the header
   and the blank line, take field 1 of each `<id> - <name>` entry) into a **set of complete id
   tokens** and require **string equality**. Never a substring or `grep` containment test:
   `cursor-grok-4.6-low` is a strict prefix of `cursor-grok-4.6-low-fast` (P15), so a removed or
   renamed non-fast id would still validate against its fast variant and the fail-closed
   guarantee would be silently void. Cache per process+binary. A miss is a hard `die_precondition`, never
   a silent downgrade — the ladder is non-uniform (Global Constraint 5) and it moves.
2. **Announce every clamp on stderr** (`max` → `xhigh`), suppressible with `DISPATCH_QUIET=1`.
   Silent under-delivery against a recorded roster is the failure `grok-effort.sh` exists to
   document.

**Consumer** (this is not a standalone library): `scripts/dispatch-hetero.sh` calls it at the
post-parse effort-resolution site in §3a, fed by the existing `$EFFORT` and the new
`$CURSOR_FAST`. A caller who passes a full model id bypasses the mapper entirely; a caller who
passes a family alias gets it resolved. That call site is what makes the 1→2 dependency real.

**Acceptance**: `cursor_model_for "$CURSOR_BIN" grok46 max 0` prints `cursor-grok-4.6-xhigh` **and** a clamp
note on stderr; `cursor_model_for "$CURSOR_BIN" grok46 low 0` prints `cursor-grok-4.6-low` (not `-low-fast`);
an unknown family exits non-zero; a fabricated id fails the inventory check; and — the P15 regression — asking for a
non-fast id whose entry has been removed from a stubbed inventory that still contains its
`-fast` variant **fails**, proving the check is equality and not containment.

### Phase 2 — the `dispatch-hetero.sh` rail (L)

Thread `IS_CURSOR` through every site in §3a, then insert after the `IS_QODER` block at 2925.

**Phase 2 carries exactly the contracts base dispatch needs, and no admission.** That is
`src/readiness/probe.js:59` and `status.js:129` plus the codex mirrors, with
`check-canonical-invariants.sh` attached to this phase's acceptance. The
`review-loop-contract.schema.json` runner enum moves to **Phase 3**: those 6 sites are what make
`cursor` a *routable review-loop role*, not a base-dispatch receipt field, so validating it here
would leave Phase 2 contract-inconsistent — a roster the schema accepts and no wrapper can run.

`resolve-review-loop.sh` is touched in neither Phase 2 nor Phase 3 — roster admission lands in
**Phase 5**, on a recorded Stage-1 pass. Two rules, in order: **admission must not precede
executability** (so not Phase 2, which has no wrapper) and **admission must not precede
qualification** (so not Phase 3, which has no recorded outcome). The first is asserted at the
Phase 3 boundary; the second is what makes Phase 5 the admission site.

```bash
elif [ "$IS_CURSOR" -eq 1 ]; then
  # cursor-agent (Cursor CLI). Probe-verified 2026-08-26 (2026.08.11-e8db854), see
  # docs/plans/2026-08-26-cursor-cli-adaptor.md §0.1:
  #   P4/P5 cwd AND --workspace anchor edits → no agy-style absolute-path anchor.
  #   P6 edit-only by default → wrapper commits, same rail as grok/qoderclicn.
  #   P3 --trust is MANDATORY headlessly. P8 -f auto-approves tools. P7 -p reads stdin.
  #   P12 effort is the MODEL ID, not a flag — do NOT add --reasoning-effort.
  CURSOR_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction …) ===
… identical text to GROK_EDIT_ONLY / QODER_EDIT_ONLY …
===

"
  CURSOR_PROMPT_FILE="$(mktemp -t dispatch-hetero-cursor-prompt-XXXXXX)"
  printf '%s' "${CURSOR_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$CURSOR_PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec "$2" -p --trust --force --workspace "$1" \
      --model "$4" --output-format stream-json < "$3"' \
      _ "$WT" "$CURSOR_BIN" "$CURSOR_PROMPT_FILE" "$MODEL"
  rm -f "$CURSOR_PROMPT_FILE"
```

Prompt goes via **stdin** (P7), not argv — the same ARG_MAX reasoning that put grok on
`--prompt-file` and qoder on stdin.

**Acceptance (= KR1)**: on a throwaway branch, a one-file edit task returns
`{"status":"committed","runner":"cursor",…}` with a clean tree; and
`hooks/tests/dispatch-hetero-cursor-routing.test.sh` passes: every id in `cursor_enabled_ids`
(including `gpt-5.3-codex-low-fast`) plus the class-(a) and non-over-capture cases behave as
§3a's match-semantics row specifies, with no rail binary invoked.

### Phase 3 — review + author rails, enums, adapter (S)

Everything not needed by base dispatch — Phase 2 took only the schema enum and readiness maps.
Here: `dispatch-review.sh` / `dispatch-author.sh` allowlists, the
`review-loop-contract.schema.json` runner enum (6 sites), `probe-engine-capability.sh`,
`dispatch-status.js`'s `cacheReadTokens` key, `engine-qualify.js`'s bin-flag map, and the
plan-review allowlist — each with its codex mirror. **Not** `resolve-review-loop.sh` — see below.

**Roster admission does NOT happen in this phase.** Phase 3 makes cursor *executable* by the
review and author wrappers; it does not make cursor *assignable* by the resolver. That
separation is the whole point of the rule — admitting a rail two phases before its qualification
runs would leave a rail that failed Stage 1, or never ran it, still assignable as an
implementer: wiring treated as authority to route, the exact prohibition this plan invokes
against reviewer-class seats. So `resolve-review-loop.sh` is untouched until **Phase 5**, and the
admission matrix is frozen here:

| allowlist | cursor entry | why |
|---|---|---|
| panel/implementer tuples (538-581) | **only on a recorded Stage-1 pass** (Phase 5), and **pinned to the qualified model id** | the sole role this plan qualifies |
| `verification_author` (263-266) | **never**, this plan | no verification_author qualification |
| `plan_reviewer` / `plan_deep_reviewer` (344-349) | **never**, this plan | no reviewer qualification |

Because the implementer tuple validation is shared, admission is implemented as a **role-aware
guard**, not a bare enum widening: `cursor` is accepted for the implementer role and rejected
for every reviewer-class role and for dual occupancy (§8 Q2), each with a negative test.

> **SUPERSEDED 2026-08-27 by a Board-authorized change (v2.34.43).** The freeze above and the
> admission matrix it carries are no longer the shipped contract. The Board asked for per-role
> heterogeneous routing and for cursor to be routable at `review`/`plan`/`consult`/`discuss`
> *today*, before Phase 5. `resolve-review-loop.sh` was therefore touched ahead of Phase 5, which
> is a deliberate deviation from this plan, authorized by that ask — not drift.
>
> What changed, and why the matrix above cannot simply be re-read as still true:
>
> - **The enum layer stopped being the gate.** This plan (and v2.34.42's CHANGELOG) reasoned that
>   "the schema enum is what makes a runner *assignable*, so it belongs with admission". On a
>   fresh heterogeneous consult (`codex`/`gpt-5.6-sol`, high) that reasoning was overturned: a
>   runner enum is a **syntax table** — it already carries runners with no per-role qualification
>   evidence — and was never capable of expressing a per-role permission. All six sites now carry
>   `cursor` on both the schema and shell sides.
> - **Admission became the gate, and it is role-aware in the way this matrix wanted.** A seat
>   naming a runner in `UNQUALIFIED_RUNNERS` is refused (exit 3) unless
>   `$AUTOPILOT_QUALIFICATION_OVERRIDE` carries an unexpired entry matching engine + runner +
>   **role** exactly. So the matrix's "never, this plan" rows are still honoured *by default* —
>   cursor cannot hold a reviewer-class seat — but they are no longer absolute: an explicit,
>   recorded, expiring operator override can open one, per role, and is announced as
>   evidence-free and listed in `override_admitted_seats`. That is the Board's Ruling 1 shape,
>   not an earned qualification, and nothing downstream may read it as one.
> - **Dual occupancy is now real.** The rule this plan froze — a roster placing cursor in both an
>   implementer and a reviewer-class seat is rejected — turned out to have been **implemented
>   nowhere**: `resolve-review-loop.sh` contained no occurrence of `cursor` at all, so dual
>   occupancy was rejected only incidentally, because cursor was unspellable in every enum. It is
>   now an actual tested rule (`allow_same_runner_dual_seat`, default off), scoped to
>   override-admitted runners and keyed on the **runner** rather than the model family.
>
> **Phase 5 is unchanged and still outstanding.** Stage-1 implementer qualification has not run;
> no live `cursor-agent` model call has been made; KR1/KR2/KR4 receipts are still owed. What
> Phase 5 must now deliver is a *recorded qualification* that removes `cursor` from
> `UNQUALIFIED_RUNNERS` for the implementer role — pinned to the qualified model id, exactly as
> the matrix row says — so that routing it stops needing an override. Until then the honest
> description is: cursor is shipped, executable, unqualified, and routable only by an explicit
> operator decision. See `hooks/tests/resolve-review-loop-role-admission.test.sh` for the
> executable contract.

**Model contract**: both wrappers require an **explicit full `--model` id** for `--runner
cursor` — there is no cursor default and no family-alias resolution on these rails (the mapper
and `--cursor-fast` are `dispatch-hetero.sh`-only). A missing or alias `--model` is a
`die_precondition`. Both acceptance commands below therefore carry `--model`.

**Variable contract**: `CURSOR_BIN` is `dispatch-hetero.sh`-local. `dispatch-review.sh` and
`dispatch-author.sh` already carry a single `BIN` with a `--bin` override, and the cursor rail
uses **`$BIN`** there — no second variable, no bypassable override. Per rail the sites are:
**binary init** (`BIN` defaults to `cursor-agent` when the runner is `cursor`), **override**
(the existing `--bin`, no new flag), **precondition**
(`command -v "$BIN"`, mirroring the grok/qoder checks), **invocation** (below), **capture**
(stdout and stderr to separate temp files), **failure mapping** (non-zero → `precondition_failed`
for author, `no_verdict` for review; quota/auth strings routed through each script's existing
`quota_status` classifier), and the **codex mirror** of each.

**Transport is bound, not left open** (P13): both rails use `--output-format text`, never
stream-json, so `dispatch-review.sh`'s anchored plain `VERDICT:` parser and
`dispatch-author.sh`'s raw-text expectation both consume stdout unchanged. Exact argv:

```
"$BIN" -p --trust --mode ask --model "$MODEL" --output-format text < "$PROMPT"
```

run from a scratch cwd, no `--force`, stdout and stderr captured separately (the reviewer parses
stdout only — same split qoder needed for its benign git-repo stderr). Non-zero exit, empty
stdout, or an unanchored verdict block fails closed as `no_verdict`; no salvage from stderr.

**Acceptance (= KR2)**, both rails, receipts retained:
- `dispatch-review.sh --runner cursor` returns `status: reviewed` with a parsed `VERDICT:`; a
  deliberately mangled response returns `no_verdict` rather than a coerced pass.
- `dispatch-author.sh --runner cursor` returns its success status with **non-empty** authored
  stdout; a forced-failure case (nonzero exit or empty stdout) maps to `precondition_failed` per
  the failure mapping above, never to a success with an empty body.
- **Boundary check**: every runner `resolve-review-loop.sh` accepts is executable by its
  downstream dispatcher — asserted here, where executability is established. It holds trivially
  for cursor at this point (no admission yet) and must still hold after Phase 5 adds one.

### Phase 4 — capability record + docs + release (S)

`src/harness/capabilities/cursor.json` written from Phase 2/3 receipts only: `status`
`unverified`, `harness_level` `H0`, `read_only_dispatch` / `headless_usage` set from what
actually ran, everything else `unverified`. Do **not** copy `grok.json`'s verified fields.
Then `hetero-dispatch.md`, `scripts-inventory.md`, `CLAUDE.md` list, `CHANGELOG.md`, PATCH bump,
`scripts/preflight-release.sh`.

**Acceptance (= KR3)**: `check-claude-md-inventory.js`, `check-canonical-invariants.sh`,
`check-contract-schema.js`, and `preflight-release.sh` all pass.

**Phase 4 is not the last release gate.** Phase 5 may change shipped resolver code (admission on
a pass), so the two exit paths ship differently: on a **recorded fail** Phase 4's release is
final and Phase 5 adds only evidence; on a **recorded pass** Phase 5 re-runs the full set —
CHANGELOG, version bump, mirror parity, `check-contract-schema.js`, `preflight-release.sh` —
because it touched code after the previous release.

### Phase 5 — Stage-1 implementer qualification (H — the real cost)

Per `autopilot:engine-onboarding`, Stage 0 must be **re-run on the frozen id**, not inherited.
§0.1's probes ran on `cursor-grok-4.6-low-fast` and `cursor-grok-4.6-low`; they establish that
the *rail* works, not that this qualification's model does, and `--list-models` containment of a
token is inventory, not behavior. So G0 (real call), G0.5 (identity captured from the init and
`result` `model` fields), G1 (real edit-only file change), and G2 (`dispatch-hetero.sh` returns
`committed`) are each re-executed with `--model cursor-grok-4.6-high-fast` and their receipts
appended to the evidence bundle before the suite starts.
Stage 0.5 is decided in advance: **self-qualify** — there is no shipped default for cursor.

Run `scripts/engine-qualify.sh implementer` against `--runner cursor` on **one frozen model id:
`cursor-grok-4.6-high-fast`**. The suite's shape is fixed by the qualifier, not by this plan:
**6 case families** (greenfield-spec, red-to-green, test-integrity trap, scope trap, security
canary, no-op honesty) × 2 cases × 2 trials = 24, zero tolerance on
integrity/fabrication/contract/oracle-miss. "Families" there means *case* families; it is
unrelated to the two *model* families Phase 1 maps.

The frozen id is a `-fast` lane **for qualification only**: §6.1 shows the non-fast lane's
time-to-first-flush ranging 12–55 s, which makes 24 live-rail cases impractical. This is
independent of Global Constraint 6's routing default — evidence binds to this exact id and does
not transfer to `cursor-grok-4.6-high` or any other suffix.
Append the operator-run Stage-0 probe receipts to `probe-receipts.jsonl` first (runner path,
`--version`, exact `--list-models` containment of the frozen token, rc, timestamp).

**Admission lands here, conditionally and model-pinned.** On a recorded pass, add the role-aware
cursor entry to `resolve-review-loop.sh`'s panel/implementer tuples (§3b matrix) with its
negative tests and its codex mirror. The entry admits the **pair** (`runner: cursor`,
`model: cursor-grok-4.6-high-fast`), never the bare runner: qualification evidence binds to an
exact deployment identity and does not transfer between model ids (Phase 5, §7), so a
runner-scoped entry would let `cursor-grok-4.6-low` take an implementer seat on evidence earned
by a different model. Any implementer seat naming a different cursor model id is rejected until
it is separately qualified and recorded. On a recorded fail, the entry is **not** added and cursor remains unassignable —
the rail stays shipped, executable, and unrouted, which is the correct end state for an engine
that did not qualify.

**Acceptance (= KR4)**: an outcome is recorded via `engine-scorecard.js record` — pass **or**
fail — and the resolver's cursor entry exists **iff** that outcome is a pass. A failure is a
successful phase; suppressing it is not.

**Dependency map**: 1 → 2 → 3 → 4 → 5. Phase 1 is the only one runnable in isolation.

## 5. Test / validation

| What | Gate | Kind |
|---|---|---|
| model-id mapper, incl. clamp note + inventory miss | new `hooks/tests/cursor-model.test.sh` | script |
| auto-routing guard, all classes + process-level oracle | new `hooks/tests/dispatch-hetero-cursor-routing.test.sh` (Phase 2 acceptance) | script |
| cursor rejected in both implementer and reviewer-class seats | negative case, same routing test file | script |
| resolver admission, **split by recorded outcome** — (i) before qualification and (ii) after a recorded *fail*: cursor rejected as implementer; (iii) after a recorded *pass*: accepted **only** for `cursor-grok-4.6-high-fast`, every other cursor model id still rejected; reviewer-class roles and dual occupancy rejected in all three | new `hooks/tests/resolve-review-loop-cursor-admission.test.sh` (Phase 5) | script |
| `--runner auto` never selects cursor | negative case in the same test | script |
| e2e committed dispatch | Phase 2 acceptance, throwaway branch | human-run, receipt kept |
| review/author rails | Phase 3 acceptance | human-run, receipt kept |
| schema/inventory/mirror parity | `check-contract-schema.js`, `check-claude-md-inventory.js`, `check-canonical-invariants.sh`, `preflight-release.sh` | script |
| implementer qualification | `engine-qualify.sh implementer` | script, live spend |

The `auto`-never-selects-cursor negative control is the single most important test here. It
lives in a new `hooks/tests/dispatch-hetero-cursor-routing.test.sh` — **not** in
`cursor-model.test.sh`, which exercises the mapper function and cannot observe
`dispatch-hetero.sh`'s `auto` branch. It **enumerates `cursor_enabled_ids`** rather than restating a list, so adding a mapper row
extends the test automatically. Per id it asserts exit 2, the right message, and a
**process-level oracle**: with `grok`, `codex`, `agy`, **and `cursor-agent`** shadowed by recording stubs on `PATH`,
**no rail binary is invoked at all** — including cursor's own, since the guard must refuse
without dispatching anywhere — an exit-2-with-the-right-string assertion alone would pass
against an implementation that dispatched first and failed after. It additionally covers the two
class-(a) cases the enumeration does not reach: an out-of-table `cursor-*` id
(`cursor-grok-4.5-high` → fails closed, prefix-open) and a bare non-prefixed non-table id
(`gpt-5.2` → routes to codex as before, proving the guard does **not** over-capture).

## 6. Risks + inversion

*What would guarantee this fails?*

- **R-1 🔴 Someone "helpfully" adds cursor to the `auto` branch.** Every cursor model id contains
  `grok`, `gpt`, `codex`, or `claude`; auto-selection cannot disambiguate vendor-hosted from
  vendor-native. *Mitigation*: the negative-control test in §5 + a comment at line 1679 stating
  the prohibition and why.
- **R-2 🟠 The model-id ladder moves.** `lib/grok-effort.sh` records exactly this: a clamp
  written against one probe went stale for a month and silently under-delivered. *Mitigation*:
  Phase 1's live `--list-models` validation and fail-closed miss.
- **R-3 🟠 `--mode ask` read-only is not proven tamper-resistant.** P9 is **one cooperative
  probe**: the agent said ask mode is read-only and the file was unchanged. That is evidence of
  refusal, not evidence of server-side enforcement against an adversarial or injected prompt.
  *Mitigation*: cursor is deliberately excluded from the blind-review allowlist
  (`dispatch-review.sh:205`) in this plan; admitting it needs its own adversarial probe.
- **R-4 🟠 Decorrelation is nominal, not real, if cursor serves both seats of a review loop.**
  Different model families, but one vendor, one auth, one server-side prompt layer.
  *Mitigation*: frozen as a present-tense rule (§8 Q2) — a roster with cursor in both an
  implementer and a reviewer-class seat is rejected, with a negative test in Phase 3. Widening
  it is a Board decision; the default is closed, not open.
- **R-5 🟠 A comment can break a shipped script and nothing notices.** Found while preparing this
  plan: `74bd15bc` ("comment-only … no executable logic changed", QC-Verdict PASS, two hetero
  review seats) embedded `plan-review/*/state.json` inside a `/** … */` block — the `*/`
  terminated the comment and `scripts/dispatch-plan-review.js` plus its codex mirror stopped
  parsing entirely for a day. *Mitigation*: **out of scope here, split to a follow-up PATCH** — a repo-wide `node --check`
sweep gate is unrelated to cursor and belongs with the repair of the breakage itself. Recorded
in this plan only as the reason that repair happened (Review log).
- **R-6 🟡 Throughput ≠ cost.** §6.1's numbers say `-fast` is 3–4× faster. They say nothing about
  billing rate or quota. *Mitigation*: Phase 1's default is non-fast (Global Constraint 6); a flip needs the cost answer.
- **R-7 🟡 The rail lands and is never routed to.** Phases 1–4 are cheap; Phase 5 is expensive,
  so it is the one that gets deferred — leaving a rail that exists and does nothing, which is
  precisely the CLAUDE.md "a script existing is not evidence it is running" family.
  *Mitigation*: KR4 is stated as *record an outcome*, so deferral is visible as an unmet KR.

## 6.1 Measured throughput (context for §8 Q1)

`--stream-partial-output` is not per-token (P11), so an inter-token decode rate is not
measurable from this CLI. The only defensible figure is end-to-end
`usage.outputTokens / result.duration_ms`, which includes queueing, reasoning tokens, and
server buffering. `outputTokens` appears to include thinking tokens; `inputTokens` sits at
~15.7k on every run because Cursor injects its own harness prompt.

n=3 per model, identical ~900-word prose prompt, `--mode ask`, sequential:

| Model | e2e tok/s (median) | range | time-to-first-flush (median) |
|---|---|---|---|
| `cursor-grok-4.6-low` | 27.7 | 19.0 – 53.3 | 27.8 s (12.0 – 54.6) |
| `cursor-grok-4.6-low-fast` | 104.2 | 56.6 – 126.9 | 11.2 s (10.5 – 11.3) |
| `cursor-grok-4.6-high-fast` | 84.2 | 78.5 – 103.3 | 11.6 s (11.0 – 12.2) |

(`-high-fast`'s display name is literally "Cursor Grok 4.6 Fast", so both readings of "4.6 fast"
were measured.) Reading, stated as observation rather than mechanism: in this sample the `-fast` variants had
both higher end-to-end throughput and markedly **less variable** time-to-first-flush (σ ≈ 0.4 s
vs. a 12–55 s spread on plain `low`). A queueing explanation would fit that shape, but n=3
cannot establish it, and the billing implications remain unknown either way. Effort appears to
cost less than the lane: `high-fast` (84) is ~20% under `low-fast` (104) and
still ~3× plain `low` (28). n=3 is thin and the ranges overlap; treat the medians as direction,
not as rates.

## 7. Out of scope

- Any model family other than `cursor-grok-4.6-*` and `gpt-5.3-codex-*` in Phase 1's table
  (Claude / Gemini / Composer ids are reachable by passing an explicit `--model`, but get no
  effort mapping in this plan).
- The blind-review allowlist (`dispatch-review.sh:205`) — blocked on R-3.
- Reviewer, verification_author, owner, or explorer qualification. Implementer only.
- Cursor's `--resume` / `--continue` session-reuse rail. The flags exist; wiring them is a
  separate plan.
- `--plugin-dir` / cursor-as-a-plugin-host (an H-level harness question, not a runner question).
- Changing any routing default or roster to prefer cursor.
- Flipping `-fast` to default (§8 Q1).
- A cursor transcript adapter (`transcript-adapters/`). `retro-review-loop.js` accepts only
  `--claude-root` / `--codex-root`, so an adapter would have no transcript source to read; adding
  one is a retro-analytics change, not a runner change.
- The repo-wide `node --check` gate (R-5) — its own follow-up PATCH.

## 8. Open questions (Board only)

- **Q1** (a later default flip, not a blocker): Phase 1 ships **non-fast by default** with
  `--cursor-fast` opt-in, because `-fast`'s billing rate and quota behavior are unverified.
  Once they are known, should the default flip? Nothing in Phases 1-5 waits on this answer.
- **Q2** (frozen conservatively for now; the Board may widen it): a roster placing cursor in
  **both** an implementer and a reviewer-class seat is **rejected**, with a negative test in
  Phase 3. Different model families are not decorrelation when the seats share one vendor, one
  auth, and one server-side prompt layer (R-4). This is moot while §7 keeps cursor
  implementer-only, and it is written as a present-tense rule so it does not silently become
  permitted the day a reviewer qualification lands. Should the Board authorize dual occupancy?

## Review log

- **R0 author**: Claude Opus 5 (1M), session 3b029952, 2026-08-26. Sources: live probes of
  `cursor-agent 2026.08.11-e8db854` (§0.1), grep inventory of `scripts/dispatch-hetero.sh` and
  the runner-enum consumers at `cd3f5f85`, `autopilot:engine-onboarding`, `references/plan-template.md`.
- **Manifest**: `docs/plans/2026-08-26-cursor-cli-adaptor.plan-review-manifest.json`
- **Frozen rubric**: `docs/plans/2026-08-26-cursor-cli-adaptor.rubric.md`
- **Pre-review note**: `scripts/dispatch-plan-review.js` did not parse at `cd3f5f85` (R-5). It
  was repaired before this plan could be dispatched; that repair is a separate PATCH-class
  change and is not part of this plan's phases.
- **Generation 1** (2026-08-26): 3 seats, all `transport_status: success` / `parser_status: strict`
  on attempt 1 — `codex/gpt-5.6-sol` (openai), `cc-shim/GLM-5.2` (zhipu), `cc-shim/MiniMax-M3`
  (minimax). Verdict **CONDITIONAL**, 16 findings, **9 candidate blockers**, 7 backlog candidates.
  Dispositions in `2026-08-26-cursor-cli-adaptor.g1-disposition.json`: all 9 blockers
  `accepted_blocker`, 5 backlog items `accepted_nonblocking`. Four claims were spot-verified
  against the tree before acceptance (`status.js:42-49` is a family map; `resolve-review-loop.sh`
  carries four runner allowlists; `retro-review-loop.js` accepts only claude/codex roots;
  `dispatch-status.js:174` lacks `cacheReadTokens`). Two seats converged independently on the
  auto-branch contradiction and two on the Phase 5 family ambiguity.
- **Generation 2** (2026-08-26, **terminal** — `generation_cap_requires_depth_0_adjudication`):
  same 3 seats, all transports successful (sol `strict`; GLM and MiniMax via the `extracted`
  salvage path). Verdict **CONDITIONAL**, 11 findings, **6 candidate blockers**, 5 backlog.
  Dispositions in `…g2-disposition.json`: all 6 `accepted_blocker`, bounded repair applied.
  The load-bearing one is GLM's R2: the generation-1 repair closed only the `cursor-`-prefixed
  mis-route, while §1 names two — `gpt-5.3-codex-low` still reached the codex rail, untested.
  The guard is now closed-world over the Phase 1 table. Plan 21331 → 28906 bytes (1.36×).
- **Round 2 — a deliberate, Board-authorized re-open.** The controller caps a `logical_plan_id`
  at two generations and cannot be raised (`max-generations cannot exceed hard cap 2`), and the
  plan-template forbids resetting a logical plan by swapping ticket or session. The Board
  directed review to continue to a clean verdict, so the **repaired** plan was re-opened under a
  new identity, `cursor-cli-adaptor-2026-08-26-r2` (manifest `…r2-manifest.json`, same rubric,
  same three seats). Recorded here rather than done quietly: the rule exists to stop a losing
  verdict being escaped, and this is the opposite — every prior verdict and disposition stands.
- **R2/Generation 1** (2026-08-26): sol and GLM `strict`, MiniMax `extracted`. **CONDITIONAL**,
  13 findings, **6 candidate blockers**, all `accepted_blocker` (`…r2g1-disposition.json`). The
  decisive pair: sol asked for one *executable* source for the enabled-id set, and GLM showed
  why — `--cursor-fast` makes `gpt-5.3-codex-low-fast` reachable, and the exact-table match set
  did not contain it, so §1's mis-route survived in a third and narrower form that the
  negative-control test would have blessed. `cursor_enabled_ids` / `cursor_is_enabled_id` now
  hold the set once; guard, mapper, and test all derive from it. R1 was closed with a new probe
  (`--reasoning-effort` and `--effort` are each `unknown option`) rather than a hedge.
- **R2/Generation 2** (terminal): **CONDITIONAL**, 11 findings, **7 blockers**, all
  `accepted_blocker` (`…r2g2-disposition.json`). Four were internal contradictions left by my own
  previous repairs (the Phase 2/3 ownership of the resolver allowlists stated both ways; the
  guard's match scope stated three ways). Two were new and load-bearing: GLM caught that framing
  a missing allowlist entry as a defect read as *add to all four* — which would have made
  reviewer-class seats assignable to a rail with no reviewer qualification, wiring treated as
  authority to route; and sol caught that dual-seat cursor occupancy was left to a Board question
  while admission was already proceeding. Admission is now pinned to the panel/implementer tuples
  only, and dual occupancy is a frozen present-tense rejection.
- **Round 3** — same re-open rationale as round 2, identity `cursor-cli-adaptor-2026-08-26-r3`.
- **R3/Generation 1** (2026-08-26): all three seats `strict`. **CONDITIONAL**, 13 findings,
  **9 blockers**, all `accepted_blocker` (`…r3g1-disposition.json`). Two were decisive.
  GLM showed the inventory check was specified as *containment* and that this is unsound here —
  the real `--list-models` output has strict-prefix pairs, so a removed `cursor-grok-4.6-low`
  would still validate against `cursor-grok-4.6-low-fast`; recorded as hazard P15 with the
  measured counts (2 vs 1), now an equality check with a regression case. GLM also caught the
  plan breaking its own rule: Phase 3 admitted cursor to the implementer roster two phases
  before Stage 1 ran, so an unqualified rail would have stayed assignable. Admission moved to
  Phase 5 and made conditional on the recorded outcome. Both seats independently flagged that
  `--list-models` itself was an unprobed flag carrying a load-bearing guarantee — closed with
  probe P14 rather than a hedge.
- **R3/Generation 2** (terminal): all three seats `strict`. **CONDITIONAL**, 11 findings,
  **7 blockers**, all `accepted_blocker` (`…r3g2-disposition.json`). Both seats converged on the
  same gap: admission was runner-scoped while qualification is model-scoped, so a pass on
  `cursor-grok-4.6-high-fast` would have authorized `cursor-grok-4.6-low` — against this plan's
  own non-transfer note. Admission now pins the pair. sol also caught a real design error: the
  auto guard runs on every dispatch, so a subprocess in the membership predicate would put a
  live `--list-models` call on the path of every unrelated dispatch; the table operations are
  now pure.

### Loop trajectory (recorded because it is itself a finding)

| round / gen | seats parsing | blockers | disposition |
|---|---|---|---|
| r1 g1 | 3/3 | 9 | all accepted, repaired |
| r1 g2 (terminal) | 3/3 | 6 | all accepted, repaired |
| r2 g1 | 3/3 | 6 | all accepted, repaired |
| r2 g2 (terminal) | 3/3 | 7 | all accepted, repaired |
| r3 g1 | 3/3 | 9 | all accepted, repaired |
| r3 g2 (terminal) | 3/3 | 7 | all accepted, repaired |

Six generations, 44 accepted blockers, zero rejected. The count is **not converging toward
zero**, and after six generations the honest conclusion is that it will not: each repair enlarges
the plan's surface, and a panel asked to find blockers against a nine-rule rubric finds them in
the new text. What *has* changed is the class of defect — round 1 found contradictions between a
goal and its own constraint; round 3 found that admission was runner-scoped where qualification
is model-scoped. Both are real, but only the first kind runs out.

Recorded so the next reader does not mistake a terminal CONDITIONAL for a failed plan, or read
"more rounds" as the way to reach approval. **Approval is the Board's decision on a plan whose
known defects have been dispositioned, not a verdict the panel will eventually hand over.**
