# Plan — statusline → hook live context feed

> Status: draft (L-2, awaiting L-2.5 plan hetero loop review) · Owner: depth-0 · Branch: `feat/v2.36.1-statusline-live-context-feed` (to be created at L-3) · Frame: dev-flow L · Date: 2026-09-05

## 0. Context / thesis

Claude Code hands its **status line** the truth that it withholds from **hooks**: the resolved model id, the real
context window size (200000 or 1000000), the used percentage, the raw token counts of the last API call, and — since
CC 2.1.205 — one row per running subagent with that subagent's own `contextWindowSize` and `tokenCount`
(`subagentStatusLine`). Hook stdin has none of this (official hooks reference, verified 2026-09-05; GitHub issues
#34340 closed not-planned, #41689 closed unanswered). Every autopilot context gate was therefore built on
inference or gave up:

- `hooks/context-budget.js` infers the window from "observed N ⇒ window > N" (`KNOWN_WINDOWS [200k, 1M]`). It fired
  T2 at 153k on this very session (1M window, 15%), 2026-09-05, exactly the "one spurious fire" its own comment
  admits. Its state file also showed `observedMax: 0` in 20+ sibling sessions (subagent/short sessions never parsed
  a usage row).
- The foreman context ceiling is unmeasurable: the hook exits on `agent_id` because `transcript_path` is the
  parent's (BACKLOG row "Foreman context is not measurable by hook", trigger: "an equivalent per-agent usage
  field"). `tasks[].tokenCount` on the subagent status line **is** that field, arriving through a different door.
- Nothing gates an expensive depth-0 doing research itself. On 2026-09-05 depth-0 (Fable) ran six WebFetch/
  WebSearch calls plus grep bursts in a plain session; `orchestrator-edit-gate` covers only Edit/Write and only
  under an l3–l6 marker; `dispatch-model-guard` guards the opposite direction (dispatching *to* Fable).

On this host the status line is already `codeforge statusline` (`~/.claude/settings.json`). `src/cli/statusline.rs`
parses `context_window.used_percentage` / `context_window_size` to draw the ctx bar and **does not persist them**
(only a `CODEFORGE_DEBUG` dump to `/tmp/codeforge-sl.json`, no session id, multi-session clobber). So the gap is
one hop: codeforge sees the numbers, autopilot's hooks cannot read them.

**Relation to the 2026-07-14 ruling "no window-relative thresholds"**: that panel rejected *percent-of-window as
the budget signal* because it institutionalises the quadratic-cost pathology. This plan keeps the absolute-token
tiers as the cost signal and uses the real window only to (a) delete the inference that mis-fires on 1M sessions
and (b) say the proportion truthfully in the message. It does not reopen the ruling: v2.32.56 already scales the non-explicit tiers to the inferred window
(`scaleTiers`, tests "wrapper end-to-end 1M-scale no T2" / "200K-window still gets T2"); this plan changes only
**where the window number comes from**. Decision formula (unchanged): `W` = window; `t1 = explicit ?? round(100000·W/200000)`;
`t2 = explicit ?? round(150000·W/200000)`; tier fires when `contextTokens ≥ t`. KR1 follows from that formula
with `W` read instead of inferred.

## 1. Problem

Autopilot's context gates act on guesses because the only channel that knows the model and window (the status
line) is not connected to the channel that acts (hooks). Consequences: spurious T2 handoff directives on 1M
sessions, foremen with no context ceiling, and no gate on depth-0 self-research.

## 2. OKR / KRs

- **KR1** — A 1M-window session crossing 150k never receives a T2 directive; a 200K session at 150k still does.
  Verified by `hooks/context-budget.test.js` with live-file fixtures for both windows (red on current code).
- **KR2** — A foreman (l4–l6 marker + `agent_id`) whose `tokenCount ≥ T2` is denied its next Bash by
  `foreman-guard.js` with a handoff directive; verified by a fixture-driven test and one real l4 run recorded in
  the ledger.
- **KR3** — Depth-0 running ≥ 8 consecutive read-class tool calls (WebFetch/WebSearch/Read/Grep/Glob) receives a
  delegate nudge on stderr; on a guarded model (`fable`, `opus`) in `block` mode the 16th is denied. Verified by
  `hooks/depth0-delegate-gate.test.js`.
- **KR4** — No per-tick or per-call state file lands on a non-RAM filesystem when a tmpfs candidate exists;
  verified by a test whose fake `findmnt` reports `ext4` for every candidate and asserts the SSD fallback + one
  warning line.
- **KR5** — Full suite `hooks/tests/run.sh --parallel 4` green (parallel section and serial tail) before each
  deliverable integrates (front-door full-suite-per-deliverable line).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; no new npm dependency in autopilot. Rust side: no new crate beyond what
  codeforge already pulls (serde_json, libc if already present).
- Live-dir resolution order is fixed: `$AUTOPILOT_LIVE_DIR` → `$XDG_RUNTIME_DIR/autopilot` →
  `/dev/shm/autopilot-<uid>` → `/tmp/autopilot-<uid>`. **Every** candidate, the override included, is accepted ONLY if
  `findmnt -T <dir> -o FSTYPE -n` prints `tmpfs` or `ramfs`; if `findmnt` is absent, fall back to longest-prefix
  match in `/proc/mounts`; if neither works the candidate is rejected. When every candidate is rejected, use
  `~/.autopilot/context-budget/` and print exactly one warning line per process. Never assume a path is RAM.
  A rejected override is skipped, not fatal (test: ext4 override + available tmpfs candidate ⇒ tmpfs chosen).
- Two live files, one writer each, no merge: `<live-dir>/context/<sid>.json` (main status line) and
  `<live-dir>/context/<sid>.tasks.json` (subagent status line). Mode 0600, same-directory temp + rename. Each
  carries its own `written_at`; a reader checks freshness of the file it uses, never the other.
- `<sid>` sanitiser is normative = today's `getSessionId()`: take the stdin `session_id` string; replace every
  Unicode scalar value not in `[A-Za-z0-9_-]` with one `_` (per scalar, so a 3-byte char yields one `_`); then keep
  the first 64 scalars; empty input ⇒ `unknown`. Rust and Node both pass the shared vector file
  `hooks/tests/fixtures/session-id-vectors.json` (ASCII, invalid punctuation, CJK, emoji, empty, 70-char).
- Readers accept a live file only if `schema_version` is the integer `1`; missing, non-integer, or any other value
  ⇒ the file is treated as absent (old behaviour). Unknown extra fields are ignored.
- Schemas `schema_version: 1` (frozen for this plan); main file then tasks file:
  ```json
  {"schema_version":1,"session_id":"…","written_at":"<RFC3339>","cc_version":"2.1.260",
   "model":{"id":"claude-fable-5-1","display_name":"Fable"},
   "context_window":{"context_window_size":1000000,"used_percentage":15.7,"total_input_tokens":157171,
                     "current_usage":{"input_tokens":32,"cache_creation_input_tokens":920,"cache_read_input_tokens":82511}}}
  {"schema_version":1,"session_id":"…","written_at":"<RFC3339>",
   "tasks":[{"id":"…","name":"…","type":"…","status":"running","model":"claude-sonnet-5","cwd":"/…",
             "startTime":1757000000000,"contextWindowSize":200000,"tokenCount":57490}]}
  ```
  The tasks file may be absent (no subagent status line configured); `tasks` may be empty.
- Freshness: a reader treats a live file older than 120 s (by its own `written_at`) as absent and falls back to
  the existing transcript/inference path. Silence is never a gate pass.
- Model family for `guarded_models`: `family(id)` = lowercase `id`, strip a leading `claude-`, strip a trailing
  `[…]` suffix, take the text before the first `-`. `claude-fable-5-1` ⇒ `fable`; `claude-opus-4-8[1m]` ⇒ `opus`;
  `claude-sonnet-5` ⇒ `sonnet`. `guarded_models` is compared as exact family membership. One implementation in
  `scripts/lib/live-state-dir.js` (reused by `dispatch-model-guard.js` if its own normaliser differs — audit at P3).
- Existing knobs keep their meaning: `context_budget.{t1,t2,mode}`, `AUTOPILOT_CONTEXT_BUDGET_*`,
  `AUTOPILOT_FOREMAN_GUARD_MODE`. New knobs: `AUTOPILOT_LIVE_DIR`, `AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE=off|warn|block`
  (default `warn`), config `depth0_delegate_gate.{mode,threshold,guarded_models}`.
- Severity vocabulary: 🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion. No trust machinery (ADR-0001).
- Every dispatch prompt starts with `Engine: <model>` (dispatch-model-guard).

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`, with two named default-path deltas. (1) `context-budget` /
  `foreman-guard` with no usable live file: exit status, stdout, stderr identical to v2.36.0 (compatibility test
  diffs all three against a pinned fixture run); only the state-file *location* moves to the resolved live dir
  when one is RAM-backed (owner requirement: no per-call SSD writes), and stays at the legacy path otherwise.
  (2) `depth0-delegate-gate` is a **new** default-on hook: its `warn` nudge is new stderr by design; `block`
  requires a fresh live model. codeforge's rendered status line is unchanged; `subagent-statusline` emits no rows.
- **Dependency decision**: `platform/stdlib`. `findmnt` is util-linux (present on every fleet host); `/proc/mounts`
  is the fallback. No new npm package; Rust uses crates already in `Cargo.lock`.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `codeforge/src/cli/statusline.rs` | after parsing stdin: build the live record and call `live::write_live(...)`; keep rendering unchanged |
| `codeforge/src/cli/subagent_statusline.rs` (new) | `codeforge subagent-statusline`: parse `tasks[]`, merge into the same live file (read-modify-write under the rename), print nothing (default rows) |
| `codeforge/src/live.rs` (new) | live-dir probe (§2.5 order, `findmnt`/`/proc/mounts`), atomic 0600 write, `session_id` sanitiser; unit tests with a fake `findmnt` on `PATH` |
| `codeforge/src/cli/install.rs` | `codeforge install` also writes `subagentStatusLine` into `~/.claude/settings.json` when `statusLine` is codeforge (idempotent) |
| `codeforge/CHANGELOG.md`, `README.md` | document the live file, its schema, knobs |
| `autopilot/scripts/lib/live-state-dir.js` (new) | Node twin of `live.rs`: same probe order, same acceptance rule, `readLive(sessionId)` with freshness check |
| `autopilot/hooks/context-budget.js` / `-lib.js` | consume live file: exact window (drop inference when present), `total_input_tokens` as the signal when transcript lags; move state dir to the live dir; subagent branch uses `tasks[]` |
| `autopilot/hooks/foreman-guard.js` | when marker l4–l6 + `agent_id`: read `tasks[]`, deny Bash/Monitor at `tokenCount ≥ T2` with the handoff directive |
| `autopilot/hooks/depth0-delegate-gate.js` (new, PreToolUse `WebFetch\|WebSearch\|Read\|Grep\|Glob`) | depth-0 read-burst counter; warn at threshold, block on guarded model in `block` mode; counter resets on `Agent`/`Task`/`Skill` PreToolUse |
| `autopilot/hooks/hooks.json` | wire the new hook default-on (direct entry, foreman-guard pattern); add `Agent\|Skill` matcher entry for the counter reset |
| `autopilot/profiles/hook-classes.json`, `profiles/profile-catalog.json`, `platforms/codex/plugin/profiles/profile-catalog.json` | register `depth0-delegate-gate`; repin `hook_classes_sha256` in both catalogs |
| `autopilot/hooks/README.md`, `hooks/settings.example.json`, `docs/scripts-inventory.md`, `CLAUDE.md` (script list) | docs + inventory rows for the new script/hook |
| `autopilot/hooks/*.test.js`, `hooks/tests/*.test.sh` | new/updated tests listed in §5 |
| `autopilot/CHANGELOG.md`, `.claude-plugin/plugin.json` (+ mirrors via `sync-version.js`) | v2.36.1 PATCH: new hook + hardened hooks; hook count 29 (16 default-on / 13 opt-in) |
| `autopilot/docs/BACKLOG.md` | close "Foreman context is not measurable" (trigger met), amend "T3 deny tier" row (subagent deny shipped here, depth-0 deny still deferred) |

## 4. Phases

### P0 — Spike: capture real payloads and pin the id mapping (size S, evidence only)
1. Wrap the status line for one tick: `settings.json` → `statusLine.command` = a script that `tee`s stdin to
   `$XDG_RUNTIME_DIR/autopilot/spike/statusline.json` then execs `codeforge statusline`; same for
   `subagentStatusLine` → `spike/subagent.json`. Run one `Agent` dispatch so `tasks[]` is non-empty.
2. In the same run, a throwaway PreToolUse hook dumps `agent_id` from a subagent fire to `spike/hook.json`.
3. Record in the project ledger whether `tasks[].id` equals the hook's `agent_id`. This decides how
   `foreman-guard.js` matches its row and is a **precondition of P1** (the tasks schema is finalised from it).
4. Restore settings. **Acceptance**: three JSON files in the ledger with real values and a written mapping
   contract: either `tasks[].id == agent_id`, or an exact match on `(model, cwd, startTime)` — all three carried in
   the tasks schema above — with ambiguity (0 or ≥2 rows) ⇒ fail-open plus one stderr diagnostic naming the count.

### P1 — codeforge writes the live file (size L in codeforge; dispatched to a sonnet hands agent)
1. `src/live.rs`: `resolve_live_dir() -> (PathBuf, LiveDirSource)`; probe per §2.5; `write_live(&LiveRecord)`;
   `sanitize_session_id`. Tests: fake `findmnt` script on `PATH` returning `tmpfs` for `/run/user/…` (accept),
   `ext4` for all (fallback + exactly one warning on stderr), `findmnt` missing (uses `/proc/mounts` fixture via
   an env override `CODEFORGE_PROC_MOUNTS` for the test only).
2. `statusline.rs`: after `read_status_input`, build `LiveRecord` from the raw `Value` (do not re-derive from the
   display struct); write on every tick; failures are logged once and never affect rendering.
3. `subagent_statusline.rs`: read one JSON line, extract `tasks[]` fields listed in §2.5, write
   `<sid>.tasks.json` (its own file, its own `written_at`), print nothing. Neither writer touches the other's file.
4. `install.rs`: idempotent `subagentStatusLine` entry. Docs + CHANGELOG.
5. **Acceptance**: `cargo test` green; on this host after `cargo install --path .`, one tick produces
   `<live-dir>/context/<sid>.json` matching §2.5 with `context_window_size: 1000000` for this session, and after
   an `Agent` dispatch the file carries a `tasks[]` row. `findmnt -T` on the chosen dir prints `tmpfs`.

### P2 — autopilot consumes the live file (size L; dispatched, depth-0 reviews receipts)
1. `scripts/lib/live-state-dir.js`: `resolveLiveDir()`, `readLive(sessionId, {maxAgeMs: 120000})`; the probe
   shells `findmnt -T <dir> -o FSTYPE -n` and falls back to `/proc/mounts`; test with a fake `findmnt` on `PATH`.
2. `context-budget.js`: read live first. If `schema_version === 1`, fresh, and `session_id` matches: window = `context_window_size`
   (skip `inferWindowTokens`), contextTokens = `total_input_tokens` unless the transcript row is newer; message
   says `= N% of the 1000k window (statusline)`. Absent/stale ⇒ existing path unchanged. State dir moves to
   `<live-dir>/context-budget/` (env override kept). Tests: RED on current code for "1M live file at 153k fires
   T2"; GREEN after; "200K live file at 150k still fires"; "stale live file ⇒ inference path"; "schema_version 2 /
   missing / malformed ⇒ inference path"; "state file lands in the tmpfs dir"; "absent live ⇒ exit/stdout/stderr
   identical to the v2.36.0 fixture".
3. `foreman-guard.js`: under marker l4–l6 + `agent_id`, read `<sid>.tasks.json` (schema 1, fresh) and find this
   agent's row per the P0 mapping contract;
   if `tokenCount ≥ T2` ⇒ deny with the handoff directive (mode `warn` prints instead). Tests: fixture live file
   with a 160k/200k row ⇒ deny; 90k ⇒ pass; no row ⇒ pass (never gate on silence).
4. **Acceptance**: all `hooks/*.test.js` for the two hooks green; full suite per KR5; ledger has one real l4 run
   where the foreman's row was read (stderr line quoting `tokenCount`).

### P3 — depth-0 delegate gate (size L; dispatched)
1. `hooks/depth0-delegate-gate.js` (PreToolUse, matcher `WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task`):
   skip when `agent_id` present; on read-class tools increment `reads` in `<live-dir>/depth0-gate/<sid>.json`;
   on `Agent`/`Task`/`Skill` reset to 0. At `reads ≥ threshold` (default 8) print
   `depth0-delegate-gate: N consecutive read-class calls at depth-0 — delegate to an Explore/survey subagent
   (model: sonnet) and read only its conclusion`, refire every 8. In `block` mode, when the live file's `model.id`
   matches `guarded_models` (default `fable,opus`) and `reads ≥ 2×threshold` ⇒ deny. Without a live file the
   model is unknown ⇒ never block, only warn.
2. `hooks.json` direct entry (default-on); `hook-classes.json` row `{stem:"depth0-delegate-gate", class:"invariant_effect"}`;
   repin `hook_classes_sha256` in both catalogs; `check-hook-inventory.js --check` green.
3. Tests: below threshold silent; threshold nudge; reset on Agent; block with `claude-fable-5-1` and
   `claude-opus-4-8[1m]`; no block for `claude-sonnet-5`, `fable-ish`, uppercase variants, malformed id, stale file,
   absent file; fail-open on garbage stdin; subagent fire silent.
4. **Acceptance**: `node scripts/check-hook-inventory.js --check` and `node scripts/build-profile-payload.js`
   green; full suite per KR5.

### P4 — docs, inventory, version (size S, depth-0 may edit docs)
1. `hooks/README.md` + `settings.example.json` rows; `docs/scripts-inventory.md` row for `lib/live-state-dir.js`;
   CLAUDE.md script list (`lib/live-state-dir.js` under "Shared JSON & store primitives"); `check-claude-md-inventory.js` green.
2. BACKLOG: close the foreman-context row (trigger met, cite this plan); amend the T3 row.
3. `scripts/sync-version.js --version 2.36.1 --hook-count 29 --skill-count 30`; CHANGELOG v2.36.1 with the
   2026-09-05 spurious-fire evidence; README hooks badge if any.
4. `references/evidence-discipline.md`: one new § "a gate built on inference when the harness already publishes
   the value through another channel" (this incident).
5. **Acceptance**: `bash scripts/preflight-release.sh` green.

Dependencies: P0 → P1 → P2; P3 depends on P1 only (needs `model.id`); P4 last. P1 lives in the codeforge repo and
ships there first (its own commit); autopilot phases pin the codeforge version that wrote the fixture.

## 5. Test / validation

Script-gated: every `*.test.js` above; `hooks/tests/run.sh --parallel 4` full suite per deliverable;
`check-hook-inventory.js --check`; `check-claude-md-inventory.js`; `build-profile-payload.js`; `preflight-release.sh`;
`cargo test` in codeforge. The fake-`findmnt` fallback test is mandatory (owner requirement) and must show the
warning line exactly once.

Human-gated: the P0 id-mapping ruling; the one real l4 run in P2 (depth-0 reads the ledger receipt, not the
foreman's claim).

Red/green: P2 step 2's first test must fail on `develop` (T2 fires at 153k with a 1M live file) before the fix.

## 6. Risks + inversion

What would guarantee failure:
- **`tasks[].id` is not the hook `agent_id`** ⇒ foreman rows never match and P2.3 silently never denies. P0 exists
  to settle this before any code; the fallback match is written down.
- **Status line stops ticking** (hidden during permission prompts, autocomplete) ⇒ stale file. Freshness window
  120 s + fallback to the old path; never a gate pass on silence.
- **Two writers** (`statusline` and `subagent-statusline` ticks interleave) ⇒ torn merge if they shared a file.
  They do not: one file per writer, rename-atomic each, per-file freshness; no read-modify-write anywhere.
- **A host where `/tmp` is SSD and `XDG_RUNTIME_DIR` unset** ⇒ probe must reject `/tmp`; the ext4 fake test
  covers it. macOS (no tmpfs, no findmnt) ⇒ SSD fallback with one warning, documented, not a failure.
- **Two-repo skew**: codeforge older than autopilot ⇒ no live file ⇒ old behaviour; autopilot older ⇒ file
  ignored. Schema version field guards future changes.
- **The gate becomes noise** (depth-0 legitimately reading many files during a review) ⇒ threshold 8, refire 8,
  reset on any delegation, `off` knob; block only on guarded models in explicit `block` mode.

## 7. Out of scope

- Depth-0 T2/T3 **deny** (owner cannot be forced to hand off; BACKLOG T3 row stays).
- Changing what the codeforge status line renders, or the subagent rows' appearance.
- Fleet rollout of codeforge/autopilot versions (P5 rollout is a separate owner-gated item).
- Windows hosts; a non-codeforge status line (a thin `scripts/statusline-live-tee.sh` for hosts without codeforge is a
  BACKLOG candidate, not this plan).
- Replacing `check-context-window.js` (hetero pre-dispatch gate) — different channel, different problem.

## 8. Open questions (Board)

1. Should `depth0-delegate-gate` default to `block` on Fable-class models once P0–P3 are dogfooded, or stay `warn`?
   Plan ships `warn`.
2. Is the codeforge repo in scope for the same hetero code-loop review, or does its own flow apply? Plan assumes
   codeforge's P1 gets one hetero seat via `dispatch-review.sh` on its diff, recorded in this project's ledger.

## Review log

- R0 author: depth-0 (Fable), 2026-09-05. Context brief extracted by an Explore subagent (sonnet).
- logical_plan_id: `statusline-live-context-feed-2026-09-05`
- manifest: `docs/plans/2026-09-05-statusline-live-context-feed.plan-review-manifest.json`; rubric: `….rubric.md` (frozen g1).
- G1 (2026-09-05): sol chair STOP with 9 blockers (R2 R3 R4 R5 R6 R7 R8 R10 R12), MiniMax READY. All nine
  accepted-and-folded: override probed (R2); normative sanitiser + shared vectors (R3); two files, one writer each,
  per-file freshness (R4, R5); honest compat deltas + fixture diff test (R6); tier formula + v2.32.56 lineage (R7);
  P0 mapping contract precedes P1, tasks schema carries cwd/startTime (R8); model-family parser (R10);
  schema_version acceptance rule (R12). Artifact: `docs/projects/2026-09-05-statusline-live-context-feed/ledger/plan-review/g1.stdout.json`.
