# Plan — G37: account aliases and automatic account switching for headless and lane `claude`

> Status: drafted, not yet plan-reviewed | Owner: PM (the PM session) | Author: hands lane `g37plan` | Branch: `hands/g37plan/1` (base `2893b37b0`) | Frame: plan only; implementers are dispatched after review.

## 0. Context / thesis

The operator's Claude subscription accounts hit the 5-hour or 7-day limit. Today the operator must log in to another account by hand. The PM wants two things: (a) every autopilot path that spawns `claude -p` picks the alias with the most headroom and moves to the next on a 429; (b) the PM can move an interactive lane off an exhausted account without the operator.

Prior decisions this plan builds on (not re-opened here):
- Config dir location `~/.config/autopilot/accounts/<alias>/claude`, same alias names on every host, registry holds no secret (PM scope item 1).
- codeforge G36 already ships the alias grammar `^[a-z0-9-]{1,24}$` and reads `AUTOPILOT_ACCOUNT` (codeforge `src/usage/alias.rs:12-26`; comment there: "set by autopilot's account-pinned dispatch, G37"). G36 attributes usage per config dir, hence one alias = one config dir.
- ADR-0001: verification over attestation. The audit log (scope item 5) is an operational record of which alias ran, not a trust chain. No hash chains or receipts.
- Memory traps that shape the design: [claude-cli-config-dir-reset-trap] (never hand a child the real `~/.claude`), [paid-batch-credential-copy-expires] (a one-shot copy of `.credentials.json` stops refreshing after ~3 h; a long-lived token avoids this class entirely).

## 1. Problem

Goal: a quota-aware, fail-closed account layer under every `claude` spawn that uses the operator's subscription, plus a lane re-open tool. Not the artifact (a registry file) but the behaviours: right alias picked, 429 handled, bad token stops loudly, ambient login never used by accident, aliases (never tokens) in the log.

## 2. OKR / KRs

1. KR1: With two registered aliases A (tight) and B (roomy) in a tempdir fixture, every wired rail launches `claude` with B; after B returns a 429 shim response the same call retries on A and the audit shows `B rate_limited -> A ok`.
2. KR2: A fake token never reaches success and never falls back to ambient OAuth: the child result is `is_error` 401 (observed 2026-11-03, see 4.0 S1), the rail exits non-zero, and a decoy ambient credential is never read (negative control N1).
3. KR3: `git grep` finds zero `claude -p` / `claude --print` / `spawnSync('claude'…)` sites outside the registry file `scripts/lib/claude-spawn-sites.json` (gate, negative control N8).
4. KR4: Outside the token file itself, no token bytes appear in any artifact, log, audit line, status output, cooldown file, argv capture, or leftover attempt temp file (negative control N5).
5. KR5: A malformed enabled alias stops the run (exit 2) and is never routed around (N2b). KR6: With the registry present, every wired caller (A1-A12) goes through the account layer; there is no dual path (N9).
6. KR7: The operator checklist (section 9) runs end to end for two real aliases.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node >= 20.10, built-ins only, for EVERY new script, including the `claude` test shim (a Node script with a node shebang placed first on PATH) and the rails test (`node:test` plus `child_process`). No new `.sh` file is added.
- Alias grammar is exactly `^[a-z0-9-]{1,24}$`. Aliases of the shapes `acct-<8 lowercase hex>` and `codex-<8 lowercase hex>` are reserved (codeforge fallback names, `alias.rs:51-55`) and are refused at registration.
- The token is passed to a child only through the child's environment variable `CLAUDE_CODE_OAUTH_TOKEN`. It is never placed in argv, a shell variable of a bash rail, a log, an audit line, a JSON receipt, or a tmux command line.
- A child launched through the account layer never receives the real `~/.claude`, never receives `CLAUDE_CONFIG_DIR` pointing at it, and never has `HOME` equal to or inside the operator's real home. Before launch the alias dir, its `claude/` and `home/` are resolved with `realpath`; a link, or a resolved path that equals/contains/lies inside the real home or the real `~/.claude`, is refused.
- Child stdout and stderr are scrubbed of the exact token value (including a match split across chunks) BEFORE any artifact or forwarded stream is written; a scrub hit is recorded as outcome `token_scrubbed` and the run exits non-zero.
- Fail closed: any failure to resolve alias, token file, config dir, or env produces a non-zero exit and a one-line stderr reason. There is no branch that continues with ambient credentials once the account layer is active.
- Tests use `mktemp -d` roots, fake tokens (the literal prefix `FAKE-`), and a `claude` shim on PATH. No test reads `~/.claude`, `~/.config/autopilot`, or a real token.
- Audit lines contain the alias, purpose tag, attempt number, outcome class, and timestamps only (no quota class, used fraction, run id or mode).
- Any enabled alias with a token-file or config-dir problem makes the whole run fail (exit 2, one-line stderr reason, no spawn); it is never skipped in favour of another alias. Operators park an alias with `enabled:false`.
- A structured child error (`is_error:true` or an `api_error_status`) always yields a non-zero wrapper exit, even when the child exited 0.
- Automated tests use the Node `claude` shim only; a real-binary run is an operator-run, opt-in spike transcript outside every suite.
- Every new check ships a negative control shown red before green (`CLAUDE.md` rule; evidence-discipline section 58).

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. Behaviour changes only when the registry file exists (opt-in by presence). Without it the existing seeded-`.credentials.json` path is untouched. This is an unconfigured default, not a compat shim; once an operator creates the registry the old path is not consulted by ANY caller, including the qualification exam, A4 and A7 (no dual path, no dual-read).
- **Dependency decision**: `platform/stdlib`. Node built-ins only; no new package.

## 3. File-structure map

New files:
- `scripts/lib/account-registry.js` — load/validate registry, alias grammar, reserved names, token-file permission checks, paths. Pure functions plus a thin CLI (`list`, `check`).
- `scripts/lib/account-quota.js` — read codeforge quota snapshots (read-only), alias-to-snapshot matching, headroom and tight classification.
- `scripts/lib/account-cooldown.js` — local 429 cooldown state (per alias), live-state dir.
- `scripts/lib/account-pick.js` — pick algorithm (pure) over registry + quota + cooldown + exclude list.
- `scripts/lib/account-env.js` — build the child env (allowlist, scrub list, token injection), pure and testable.
- `scripts/claude-account.js` — CLI: `pick`, `env-check`, `run` (pick, spawn, classify, 429 fallback, audit), `exec` (resolve alias then exec a command with the account env, for lane use), `status`, `selftest`.
- `scripts/lane-reopen.js` — lane re-open tool (tmux window with `claude-account.js exec`), see 5.7.
- `scripts/lib/account-audit.js` — append-only audit writer (alias-only), reader for `status`.
- `scripts/lib/claude-spawn-sites.json` + `scripts/check-claude-spawn-sites.js` — the complete-spawn-site registry and its gate.
- `scripts/lib/account-fixtures/claude-shim.js` — Node test shim (node shebang, placed first on PATH as `claude`): records argv, env NAMES and a sha256-first-8 fingerprint of the presented token (never the token), emits canned envelopes.
- Tests: `scripts/lib/account-registry.test.js`, `account-quota.test.js`, `account-pick.test.js`, `account-env.test.js`, `scripts/claude-account.test.js`, `scripts/lane-reopen.test.js`, `scripts/check-claude-spawn-sites.test.js`, `scripts/account-rails.test.js` (Node, node:test; drives every wired caller with the shim).

Modified files (wiring, one unit each, disjoint):
- `scripts/dispatch-review.sh` (claude-native arm 1928-1961), `scripts/dispatch-author.sh` (1401-1432), `scripts/dispatch-hetero.sh` (2418-2430 preflight, 3930-3942 worker), `scripts/probe-engine-capability.sh` (480-486), `scripts/qualification-review-provider.js` (claude arm ~1549 and env handoff ~1700), `scripts/qc-panel.js` (23, 325, 490, 698, 929), `scripts/probe-todo-tools-pin.js` (52), `scripts/benchmark-hook-latency.js` (218-236), `scripts/probe-skill-frontmatter-portability.sh` (381-386, decision in 4.1), the evals runners listed in 4.1 group E, `scripts/run-eval-batch.sh`, `scripts/run-skill-opt.sh`.
- Codex mirrors under `platforms/codex/plugin/scripts/` for every changed shipped script (`scripts/sync-codex-plugin-skills.sh`).
- Docs and inventory: `docs/scripts-inventory.md`, `CLAUDE.md` grouped name list (`check-claude-md-inventory.js`), `references/hetero-dispatch.md`, `scripts/lib/config-keys.json` (+ `check-config-docs.js`), `CHANGELOG.md` (version held at 3.0.0 per owner memory: no bump).

## 4. Current state (investigation, with file:line)

### 4.0 Facts about the `claude` CLI (verified 2026-11-03 on `claude 2.1.317`)

| # | Fact | Evidence |
|---|------|----------|
| F1 | `claude setup-token` exists: "Set up a long-lived authentication token (requires Claude subscription)", options `-h` only. | `claude --help` command list line "setup-token  Set up a long-lived authentication token"; `claude setup-token --help` printed exactly that text. It was not executed. |
| F2 | `claude auth` has subcommands `login`, `logout`, `status`. | `claude auth --help`. |
| F3 | The env var name `CLAUDE_CODE_OAUTH_TOKEN` is present in the installed binary (156 occurrences), alongside `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_OAUTH_SCOPES`, `CLAUDE_CODE_OAUTH_CLIENT_ID`. | `strings -a ~/.local/share/claude/versions/2.1.317 \| grep -oE "CLAUDE_CODE_OAUTH_[A-Z_]+"`. Name only; `claude --help` does not document it. Same technique as commit `2f7888042`. |
| F4 | `--bare` reads Anthropic auth "strictly `ANTHROPIC_API_KEY` or apiKeyHelper (OAuth and keychain are never read)". So `--bare` callers are outside this plan. | `claude --help` `--bare` text. |
| F5 | Fake token behaviour, run in an `env -i` child with empty `HOME` and empty `CLAUDE_CONFIG_DIR`: `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-FAKEFAKEFAKE claude -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config` exits 1; envelope has `type:"result"`, `is_error:true`, `api_error_status:401`, `terminal_reason:"api_error"`, `result:"Failed to authenticate. API Error: 401 OAuth access token is invalid."`. The child wrote `.claude.json`, `backups/`, `plugins/`, `projects/`, `sessions/` into the empty config dir (so a persistent per-alias dir accumulates normal state). | Run by the author of this plan; no real credential existed in that env, so it proves "a bad token fails with 401 and a structured envelope", not yet "no fallback when an ambient login exists" (that is S2). |

What is NOT established (written as Spikes, not facts, per `CLAUDE.md` "Don't claim ... env vars"):
- S1 What `setup-token` prints and how long the token lives (the CLI help says "long-lived"; the lifetime and whether it is inference-only are unverified). Operator step O3 records the observed behaviour.
- S2 Precedence when both `CLAUDE_CODE_OAUTH_TOKEN` and a `.credentials.json` exist in the effective config dir or `$HOME/.claude`. Design does not depend on the answer (5.5 D4 removes the second source), but N1/O6 measure it.
- S3 The real shape of a subscription limit error under `claude -p` (HTTP 429 vs a text-only "usage limit" with exit 1). Repo evidence: a real one "cannot be forced under `claude -p`" and was simulated with a pass-through proxy (`docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/01-subagentstop-on-quota-error.md:9-21`, `rate_limit_error`). Existing classifiers: `scripts/dispatch-hetero.sh:4261` `ALLOW = {429,503,529,402}` reading `api_error_status`; `scripts/engine-capability-state.js` `classify-error` (line ~1985 `quota_exhausted`); eval regexes `evals/skill-onoff/d0gate/cc.js:103` `QUOTA_RE`. Phase P0 pins the shape with the proxy and widens the classifier to match.
- S4 Whether `claude -p --output-format stream-json` carries rate-limit headroom (a `rate_limit` event or similar) that could refresh headroom without a statusline. Unknown; only matters for the open question OQ2.

### 4.1 Every site that spawns `claude` (acceptance: none missing)

Method: `git grep` over `scripts/ src/ bin/ hooks/ evals/` for `claude -p`, `claude --print`, `spawn*(…claude…)`, `CC_BIN`, `claudeBin`, `claude-native`, `runner-binary`, `CLAUDE_CONFIG_DIR`, `.credentials.json`. `hooks/` (non-test), `bin/`, `src/runners/`, `src/engine/` (except one file) contain no `claude` spawn. `scripts/lib/runner-binary.js:58` only maps `claude-native -> claude` to read `--version`; it does not run a model. Re-verified by P6's gate.

Group A — Anthropic subscription OAuth, native auth (IN SCOPE, the account layer replaces the credential source):

| # | Site | Auth today | `CLAUDE_CONFIG_DIR` today |
|---|------|-----------|---------------------------|
| A1 | `scripts/dispatch-hetero.sh:3930-3942` (claude-native worker; preflight `:2418-2430`) | Copy of `.credentials.json` from `$CLAUDE_CONFIG_DIR` or `~/.claude`, made by `seed-claude-config.js`; env scrubbed of 22 provider/auth names (`:3932-3937`, commit `2f7888042`), including `CLAUDE_CODE_OAUTH_TOKEN` | Fresh 0700 dir `claude-config-XXXX` under `$TMPDIR`, removed after the worker (`:3945-3946`) |
| A2 | `scripts/dispatch-review.sh:1928-1961` (claude-native reviewer; also reached via `hetero-review-loop.js:545/1555`, `dispatch-experience-critic.sh:101`) | Same seeded copy (`:1949`); no env scrub beyond the child-session vars | Seeded 0700 dir (`:1952`), removed `:1957` |
| A3 | `scripts/dispatch-author.sh:1401-1432` (claude-native raw-prompt rail; the transport for `dispatch-consult.sh`, `dispatch-discuss.js`, `dispatch-plan-review.js:72,89`) | Same seeded copy (`:1417`) | Seeded 0700 dir (`:1424`) |
| A4 | `scripts/probe-engine-capability.sh:480-486` (claude-native probe) | Ambient: nothing set, whatever the caller's env/`~/.claude` holds (comment `:476-477` says so on purpose) | Inherited |
| A5 | `scripts/qualification-review-provider.js:1549-1556` (claude kind; header `:60-70`) | Broker passes `CLAUDE_CONFIG_DIR` through `--provider-env`; convention dir `~/.autopilot/exam-claude-config` with `.credentials.json` only (memory trap, header `:64-68`) | Set by broker |
| A6 | `scripts/qc-panel.js:23,325,490,698,929` (`QC_CLAUDE_BIN` default `claude`, `env: process.env`) — dormant (memory `task-tree-qc-panel-dormant`) | Ambient | Inherited |
| A7 | `scripts/probe-todo-tools-pin.js:52-55` | Ambient, inherited on purpose (`:46-49`) | Inherited |
| A8 | `scripts/benchmark-hook-latency.js:218-236` | `fs.copyFileSync` of a credentials file into a per-run dir (`:228`); `BENCH_CREDENTIALS` seam (`:27`) | Per-run mktemp dir (`cleanEnv` `:217-221`) |
| A9 | `scripts/run-eval-batch.sh:112-147,158` (PATH wrapper `claude`; `run_eval.py` of the external skill-creator spawns `claude -p`) | Ambient (inherits env) | Inherited |
| A10 | `scripts/run-skill-opt.sh:3,20,73-78` (reads `~/.claude/.credentials.json`; bare `claude` from PATH via `subprocess.Popen`) | Ambient plus `CRED_FILE` | Inherited |
| A11 | `scripts/probe-skill-frontmatter-portability.sh:380-386` (`claude plugin validate`, `claude --bare … -p`) | `--bare`: API key only (F4), so no OAuth is used | `$ROOT/claude-config` |
| A12 | evals runners: `evals/context-budget-t2/run-t2-eval.js:79-81` (`CLAUDE_EVAL_CONFIG_DIR`), `evals/orchestration/run-orchestration-eval.sh:225,421-424` and `evals/pipeline-bench/run-pipeline-bench.sh:130-133,201` (copy `$HOME/.claude/.credentials.json` into a scratch home), `evals/orchestration/run-p2-batch.js:16,294,480`, `evals/orchestration/run-t14-gate-batch.js:228-237`, `evals/skill-onoff/run-skill-onoff-eval.sh:264-267`, `evals/skill-onoff/d0gate/cc.js:132` + `cell.js:90`, `evals/skill-onoff/d0gate-v2/cc-v2.js:141`, `evals/run-trigger-test.sh:33,56`, `evals/reviewer-bench/panel-cmd-claude.sh`, `panel-cmd-contract-claude.sh`, `panel-cmd-syscontract-claude.sh` | Each copies the operator's `.credentials.json` into a scratch config dir, or inherits | Scratch dir per cell |

Dispositions for the ambient/exam sites (no dual path, `claude-spawn-sites.json` records each): A4 `probe-engine-capability.sh` — wired (the probe measures what dispatch would use, so it uses the account layer; the old "ambient on purpose" comment is rewritten). A5 qualification exam — wired: with a registry the exam resolves an alias and the `exam-claude-config` credentials-only dir is not consulted; without a registry it is unchanged. A7 `probe-todo-tools-pin.js` — wired for auth only: the account env is built, and the probe's measured settings variables stay in the allowlist; its "inherit env on purpose" comment (`:46-49`) is narrowed to settings, not credentials.

Group B — Not Anthropic subscription (OUT OF SCOPE, listed so the inventory is complete; P6 registers them as `out_of_scope` with a reason):
- B1 cc-shim arms (a third-party endpoint with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`; HOME redirected, `CLAUDE_CONFIG_DIR` unset): `dispatch-hetero.sh:3948`, `dispatch-review.sh:1914`, `dispatch-author.sh:1393`, `probe-engine-capability.sh:475`.
- B2 `src/engine/profile-runtime.js:596` (`--bare`, requires `ANTHROPIC_API_KEY`, `:492`): API billing, not subscription.
- B3 `scripts/dev-setup.sh:383` (`claude plugin marketplace add`): no model call.
- B4 `scripts/lib/runner-binary.js` `--version` calls (no model call).
- B5 Evidence recipes under `docs/plans/evidence/*/administration/*/run.sh` via `scripts/lib/qualify-stage-credentials.sh` (stage credentials for a one-off qualification run). Wired later by hand only if an operator wants an alias for an exam; not in this plan's phases.

Shared auth helpers (affected, not spawn sites):
- `scripts/lib/seed-claude-config.js:34-52` — builds the seeded dir from the real config dir's `.credentials.json`. After this plan the three dispatch rails stop calling it when the account layer is active (it remains the unconfigured-default path).
- `scripts/lib/auth-stop.js` / `.sh` — "first authentication failure stops a paid batch", exit 6, structured 401 detection (header `:11-14`). Callers: `bench-engine-capability.sh`, `benchmark-hook-latency.js`, `claude-call-capture.js`, `qualification-sweep.sh`, `run-eval-batch.sh`, `run-grok-implementer-ab.sh`, `run-skill-opt.sh`. A fake-token 401 must keep tripping it (it is the loud failure the plan relies on). 429 / limit text is not an auth failure there (header `:36-37` excludes 403 and permission errors; 429 is not in the table) and stays so: a limit on one alias is a switch trigger, not a batch stop, while a 401 on the chosen alias is an operator-visible stop.
- `scripts/lib/claude-call-capture*.{js,sh}`, `scripts/lib/headless-seat-derive.js` — wrap or label claude calls; they do not choose credentials. No change.

### 4.2 Existing rate-limit handling

Rails already classify structured errors (`dispatch-hetero.sh:4261-4311`, `4813-4890`, classes `rate_limited`/`quota_exhausted`/`auth_failed`) and write a quota side-effect to engine-capability state, but never retry on another credential. `dispatch-author.sh:552-560` has `transport_status` = `quota | timeout | exit_failure`. P3 reuses `engine-capability-state.js classify-error` instead of a second regex table.

### 4.3 G36 quota snapshots (read-only investigation of `~/projects/codeforge`, HEAD `806903b`)

- Written by: the codeforge statusline on every run that sees `rate_limits` in its stdin JSON (`src/cli/statusline.rs:299-320`, input read at `:401-408`: `rate_limits.five_hour.used_percentage`, `.resets_at`, same for `seven_day`; percentage is divided by 100 before storing). Throttled to once per 30 s unless a percentage changes (`src/usage/quota.rs` `WRITE_EVERY_MS`).
- Path: `<live_base>/codeforge/usage/quota/<alias>.json`. `<live_base>` = `$AUTOPILOT_LIVE_DIR`, else `$XDG_RUNTIME_DIR/autopilot`, else `/dev/shm/autopilot-<uid>`, else `/tmp/autopilot-<uid>` (first RAM-backed), else `~/.autopilot` (`src/live.rs:46-98`). The Node twin already exists: `scripts/lib/live-state-dir.js` `resolveLiveDir()`. Snapshot dir on this host would be `$XDG_RUNTIME_DIR/autopilot/codeforge/usage/quota/` (not present at investigation time: no snapshot written yet).
- Format (schema `codeforge.quota/1`, spec `codeforge/doc/plans/2026-11-03-usage-collector.md` Phase 1): JSON keys exactly `schema, alias, root, written_at_ms, five_hour, seven_day`. `five_hour`/`seven_day` are `{pct, resets_at}` or `null`. `pct` is a fraction 0.0-1.5 (`quota.rs` `window_from` accepts `0.0..=1.5`), `resets_at` is unix seconds, `written_at_ms` unix milliseconds. `root` = first 8 hex of sha256 of the canonical config-dir path bytes (`alias.rs:29-33`), or null. Files are 0600 in a 0700 dir; reader limits: first 16 name-sorted `*.json`, <= 4 KiB, no symlinks, file stem must equal the body `alias`.
- Staleness rules to mirror: a window whose `resets_at` has passed is unknown; a snapshot older than 6 h is dropped (`MAX_AGE_MS`).
- Alias to snapshot mapping: key is the alias in the file name. The alias is the writer's `AUTOPILOT_ACCOUNT` if valid, else `acct-<hash8(config dir)>` (`alias.rs:49-55`). So a lane started with both `AUTOPILOT_ACCOUNT=<alias>` and `CLAUDE_CONFIG_DIR=<alias dir>` writes `<alias>.json` with `root == hash8(<alias dir>)`. Our picker requires both to match (`snapshot.alias == alias` and, when `root` is non-null, `root == hash8(canonical alias config dir)`); a mismatch is reported as `snapshot_root_mismatch` and the snapshot is ignored.
- Key limitation: the statusline runs only in interactive sessions, not under `claude -p`. A headless-only alias gets no snapshot, and a snapshot is at most as fresh as the last interactive render. Therefore "no snapshot" and "stale snapshot" are first-class states in the picker (section 5.3), and the local 429 cooldown (5.4) carries the headless signal.
- G36 is read-only for this plan: no codeforge change.

## 5. Design

### 5.1 Registry and token store

```
~/.config/autopilot/accounts/            0700   (override: $AUTOPILOT_ACCOUNTS_DIR, tests use it)
  registry.json                          0600   no secret
  <alias>/                               0700
    token                                0600   the setup-token output, one line, no newline required
    claude/                              0700   CLAUDE_CONFIG_DIR for this alias (persistent)
    home/                                0700   HOME for children of this alias (empty besides what claude writes)
```

`registry.json`:
```json
{"schema":"autopilot.accounts/1","accounts":[{"alias":"main","enabled":true,"priority":10},{"alias":"spare","enabled":true,"priority":20}]}
```
Only `alias`, `enabled`, `priority` (lower = preferred on a tie). No path fields: paths are derived from the alias, so there is nothing to mis-point. Unknown keys are a validation error.

Validation (`account-registry.js check`), run for EVERY enabled alias on every invocation; any failure exits 2 with one line naming the alias and reason, before any spawn:
- alias grammar and reserved shapes; duplicates; `enabled` boolean.
- `registry.json` mode must be 0600-or-tighter, root dir 0700; not a symlink (`lstat`), owned by the current uid.
- `registry.json` unknown keys at any level are an error.
- realpath rule: `<alias>/`, `claude/` and `home/` are `lstat`ed (no symlinks) and `realpath`ed; each must be inside the accounts dir and must NOT equal, contain, or lie inside the real home (`os.homedir()` resolved) or the real `~/.claude` / `$CLAUDE_CONFIG_DIR` of the caller. `home/` must not contain `.claude/.credentials.json` or a `.claude` link (credential source). Failure: `path_escapes_isolation`.
- for an enabled alias: `<alias>/token` exists, regular file, not symlink, owned by uid, mode `& 0o077 == 0`, size 1..4096, no whitespace inside, single line. The check reads the token only to measure shape; it never prints it.
- `<alias>/claude/` exists or is created 0700; it must NOT contain `.credentials.json` (D4). Presence is an error `config_dir_has_credentials`.

### 5.2 Env builder (`account-env.js`)

Input: alias, registry paths, caller env. Output: a fresh env object (allowlist, not blacklist):
- Carried from the caller: `PATH`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `TZ`, and the autopilot child-session vars the rails already pass (`AUTOPILOT_PARENT_SESSION_ID`, `AUTOPILOT_CHILD_SESSION_ID`, `AUTOPILOT_SESSION_MODE_DIR`, `FLEET_*`, `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`) via an explicit list kept in one constant. Anything not listed is dropped. This replaces the 22-name scrub list of `dispatch-hetero.sh:3937` with a stronger rule (everything not allowlisted is gone, so a future provider variable cannot leak in).
- Git/ssh/gh passthrough (explicit, tested; needed because hetero workers commit/push and lanes use git): env names carried: `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_SSH_COMMAND`, `GH_TOKEN`, `GH_HOST`. Set by the builder to the REAL files, read-only references, not copies: `GIT_CONFIG_GLOBAL=<real home>/.gitconfig` (when it exists), `GH_CONFIG_DIR=<real home>/.config/gh` (when it exists). ssh: the builder writes `<alias>/home/.ssh/config` containing `Include <real home>/.ssh/config` and symlinks `known_hosts` and `id_*` files; these links are allowed ONLY under `home/.ssh/` (the realpath rule exempts `.ssh/` entries and nothing else). `.npmrc` is not passed. The real `~/.claude`, `~/.claude.json` and `~/.config/autopilot` are never linked or referenced. Test T-GIT: inside the account env, `git config user.email` equals the real value, a `git commit` and `git push` to a tempdir bare remote over a `file://`-and-ssh-config fixture succeed, and `ls $HOME/.claude` fails. Red first: with an empty home the `git config user.email` assertion fails.
- Set: `CLAUDE_CODE_OAUTH_TOKEN=<token file content>`, `CLAUDE_CONFIG_DIR=<alias>/claude`, `HOME=<alias>/home`, `AUTOPILOT_ACCOUNT=<alias>`.
- Explicitly deleted even if somehow allowlisted: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, all `CLAUDE_CODE_USE_*`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` (names from F3 and commit `2f7888042`).

### 5.3 Pick algorithm (`account-pick.js`, pure)

Inputs: enabled aliases, quota snapshots, cooldowns, `exclude` set, `now`.
1. Drop `exclude` and aliases in cooldown (`cooldown_until > now`).
2. Per alias compute `used = max(five_hour.pct, seven_day.pct)` over windows that are present and not past `resets_at`; snapshot older than 6 h or missing is `unknown`.
3. Classes: `ok` (known, `used < 0.90`), `unknown`, `tight` (known, `used >= 0.90`, the PM's rule: 5h or 7d any >= 90%).
4. Order: `ok` by `used` ascending (most remaining first), then `unknown` by `priority`, then `tight` by `used` ascending. Tie by `priority`, then alias.
5. Return the first with the reason `{alias, class, used, source: snapshot|none}`. If only `tight` remain, still return the least tight with `class:"tight"` and audit outcome `all_tight`; the 429 loop then decides. A knob `accounts.refuse_all_tight` (default false) turns that into a fail-closed stop. If nothing remains: exit 3 `no_account_available` listing each alias and why it was dropped (capacity reasons only: cooldown, already tried, excluded). A token/config-dir failure is never a drop reason (5.5).

### 5.4 Run wrapper and 429 fallback (`claude-account.js run`)

```
node scripts/claude-account.js run --purpose <tag> [--alias A] [--max-attempts N=3]
     [--stdin FILE] [--stdout FILE] [--stderr FILE] [--cwd DIR] [--timeout SECS] -- claude <argv...>
```
Before the loop: `env-check` runs for every enabled alias (5.1); any failure exits 2, no spawn. Loop (attempt k of N): pick (excluding aliases already tried, cooling, or over `max_attempts`) -> spawn the argv with the built env (stdin from the file, stdout/stderr to attempt-private temp files) -> classify:
- `ok`: child exit 0 and (for `--output-format json`) `is_error` not true and no `api_error_status`. Copy attempt files to the final `--stdout/--stderr`; exit 0.
- `rate_limited`: `api_error_status == 429`, or `classify-error` returns `rate_limited`/`quota_exhausted` for the claude subscription shapes pinned by S3. Write cooldown for the alias (until the snapshot's earliest future `resets_at` among the tight windows, else now + 30 min), audit, try the next alias.
- `auth_failed`: `api_error_status == 401` or the auth-stop table matches. Fail closed immediately: no further alias is tried (a bad token is an operator problem, not a capacity problem), exit 6 with `STOP_AUTH alias=<A>` so `auth-stop` semantics hold. This is the "fake or expired token" rule.
- anything else (timeout 124, other exit): copy the attempt files out, exit with the child's code, except that a structured error envelope (`is_error:true` or `api_error_status`) with child exit 0 maps to exit 5 `child_error`. No switch (a model or prompt error will not be fixed by another account). Env/config resolution failures print one stderr line and exit 2.
When attempts or aliases run out after only `rate_limited` results: exit 4 `all_accounts_limited`.

Attempt files are written 0600 in a 0700 temp dir and removed in `finally`. Token scrub: child stdout/stderr are read through a streaming filter that holds back the last `len(token)-1` bytes across chunk boundaries and replaces any exact token match with `[token-scrubbed]`; if a match was replaced the attempt outcome is `token_scrubbed` and the wrapper exits 7 after writing only scrubbed bytes. Nothing unscrubbed ever reaches a file or the forwarded stream. The final `--stdout/--stderr` get only the last attempt's bytes, so rails that parse the envelope see one clean result.

`exec` subcommand: `claude-account.js exec [--alias A | --pick] [--purpose T] -- <cmd...>` resolves the alias exactly as above but `execve`-style replaces the process (spawn with `stdio: inherit`, forward the exit code). Used by `lane-reopen.js` and by rails that cannot hand over stdin (none expected).

`env-check`, `status`: `env-check --alias A` runs the 5.1 validation for one alias and prints `ok alias=A mode=0600 config_dir=… credentials_present=no`; `status` prints per-alias class/used/cooldown, never a token.

### 5.5 Fail-closed conditions (each has a negative control in section 6)

1. Registry present but invalid -> exit 2, no spawn.
2. Registry present, no enabled alias, or every alias dropped -> exit 3, no spawn, no fallback to `seed-claude-config.js`.
3. Token file missing, empty, wrong mode, symlink, wrong owner, contains whitespace, or a config-dir/home isolation failure (5.1) for ANY enabled alias -> exit 2 for the whole invocation (`run`, `pick`, `exec`, `env-check`), alias and reason on stderr, no spawn. It is never skipped in favour of another alias. `env-check --any` means "every enabled alias passes".
4. `<alias>/claude/.credentials.json` exists -> refuse (D4).
5. Child result 401 -> exit 6, no next alias.
6. Rail precondition: when the registry exists, rails must go through `claude-account.js run`; a rail that still sees `AUTOPILOT_ACCOUNT_MODE` unset and a registry file present calls `claude-account.js env-check --any` and dies with `die_precondition` if it fails (so a rail cannot silently drop to the seeded path because of a broken registry). A4, A5, A7 included.
7. `AUTOPILOT_ACCOUNT_MODE=off` (or `accounts.mode=off`) is the only way to use the legacy path while a registry exists. It is explicit and is logged to the audit with outcome `mode_off` (an operator escape hatch, not a fallback).

D4 (design decision): an alias config dir holds no `.credentials.json`, ever, and `HOME` is a per-alias empty dir. So even if `claude` consults `$HOME/.claude` or the config dir for stored OAuth when the token is rejected, there is nothing to find. This makes S2 non-blocking and is verified by N1.

### 5.6 Audit (`account-audit.js`)

File: `$XDG_STATE_HOME/autopilot/accounts-audit.jsonl` (default `~/.local/state/autopilot/…`), 0600, append-only via `O_APPEND`. One line per attempt, exactly these keys and no others:
`{"ts":1793000000000,"ts_local":"2026-11-03T…+08:00","alias":"spare","purpose":"dispatch-review","attempt":2,"outcome":"rate_limited"}`.
`outcome` vocabulary (closed set; every other record kind folds into it): `ok`, `rate_limited`, `auth_failed`, `child_error`, `timeout`, `other_failure`, `token_scrubbed`, `all_tight`, `all_limited`, `no_account`, `invalid_config`, `quota_schema_unsupported`, `mode_off`. The writer enforces the key allowlist and the outcome set (an extra key or unknown outcome is rejected, negative control N5b) and rejects any value containing the live token or matching `sk-ant-`. Pick class, used fraction, run id and mode are never written; if the PM wants them they appear on stderr or in `status` output only. Human views render UTC+8.

### 5.7 Lane re-open tool (`scripts/lane-reopen.js`)

```
node scripts/lane-reopen.js --alias <A> --cwd <dir> [--session <tmux-session>] [--window <name>] [--dry-run] -- [claude args…]
node scripts/lane-reopen.js --pick --cwd <dir> …
```
Behaviour: validates the alias (5.1), then asks tmux for a new window running the command line `node <abs>/scripts/claude-account.js exec --alias <A> --purpose lane -- claude <args>` in `--cwd`. The tmux command line carries the alias only; the token is read inside `exec` and exists only in the `claude` child's environment (`tmux new-window -e` would put it in the tmux client argv, so it is not used). Output: one line `reopened alias=<A> window=<session>:<name>`; `--dry-run` prints the exact command line (alias only) and exits 0. It does not kill the old lane; the PM does that after confirming the new one is up (kept separate on purpose: the PM can decide when). Lane config dir is the alias's persistent `claude/` so G36 attributes usage to the alias. `AUTOPILOT_ACCOUNT` is set by `exec`, giving the codeforge statusline the alias it needs (4.3), and `root` matches automatically.
Interactive first-run state (theme, onboarding, trust dialog) for a fresh alias config dir: the memory note on interactive drivability says the scratch dir needs `hasCompletedOnboarding`, `lastOnboardingVersion`, `oauthAccount`, `theme`, `bypassPermissionsModeAccepted` copied into `.claude.json`. For an alias dir this is a one-time operator step (O5) done by running the lane once by hand; the tool does not copy from the real `~/.claude.json`. Whether a token-only interactive session still stops at onboarding is Spike S5 (O5 observes it).

### 5.8 Configuration

`~/.autopilot/config.json` keys (registered in `scripts/lib/config-keys.json`, checked by `check-config-docs.js`): `accounts.mode` = `auto` (default when the registry exists) | `off`, `accounts.refuse_all_tight` (bool, default false), `accounts.cooldown_default_minutes` (default 30), `accounts.max_attempts` (default 3; N16 pins it). Env overrides: `AUTOPILOT_ACCOUNT_MODE`, `AUTOPILOT_ACCOUNTS_DIR`. Resolution through `scripts/lib/resolve-config.sh` / the existing JS config reader, not a new reader.

### 5.9 Spawn-site gate (`check-claude-spawn-sites.js`)

`git grep` the patterns of section 4.1 and require each hit file:range to be in `claude-spawn-sites.json` with `status: wired | out_of_scope(reason)`. A hit in an unlisted file is a failure `unregistered_claude_spawn`. A `wired` entry must also contain a call to `claude-account.js` in the same file (string check), else `wired_site_not_wired`. Hooked into `scripts/validate.sh` and `affected-suites.js`.

## 6. Negative controls (every one shown red before green)

| ID | New check | Deliberately broken case that must be blocked |
|----|-----------|-----------------------------------------------|
| N1 | no ambient fallback (the most important) | Tempdir "operator home" with a decoy `~/.claude/.credentials.json` (fake bytes) and a `claude` shim that, if it sees that decoy path via `HOME`/`CLAUDE_CONFIG_DIR`/cwd walk, exits 0 with a success envelope. Registry alias `a` has token `FAKE-bad`; shim returns 401 for that token. Expected: `run` exits 6, shim log shows `HOME` != decoy home, `CLAUDE_CONFIG_DIR` = alias dir, decoy never opened. Red first by temporarily making the env builder pass the caller's `HOME`: the shim then reads the decoy and the test must fail. |
| N2 | token file checks | token file 0644, symlink, wrong owner (injected `lstat` fake), whitespace, empty -> `env-check` exit 2; red-first: remove each check, the matching case must fail. N2b: two enabled aliases, preferred one with a 0644 token, healthy second: `run` exits 2 and the shim spawn counter is 0 (red-first by restoring a skip branch); same with a broken config dir. |
| N3 | reserved/invalid alias | `Acct-1`, `acct-1a2b3c4d`, `codex-1a2b3c4d`, 25-char alias, `../x`, empty -> registry check fails; boundary rows `acct-1a2b3c4` (7 hex) and `acct-1a2b3c4d5` (9 hex) are accepted. Red-first: drop the `codex-` pattern, its row fails. |
| N4 | config dir with credentials | create `<alias>/claude/.credentials.json` -> exit 2 `config_dir_has_credentials`. |
| N5 | no token leak | The shim normally prints env names plus fingerprint only. A second shim mode deliberately prints the token (plain, and split across two chunks) to stdout and stderr; `run` must exit 7, and a recursive scan of the whole tempdir finds the token bytes ONLY in `<alias>/token` (not in audit, final or intermediate attempt files, `status`, cooldown files, shim argv capture). Red first: disable the scrub, the scan finds the token. Also: token placed in argv fails the argv assertion. N5b: audit writer rejects an extra key (`used`, `run`, `mode`, `class`), an unknown outcome, the token, and `sk-ant-` shapes. |
| N6 | 429 fallback switches, 401 does not | shim returns 429 for alias B, success for A: exit 0, audit `B rate_limited` then `A ok`. Shim returns 401 for B: exit 6 and A is never spawned (shim spawn counter == 1). Red first: invert the classifier. |
| N7 | all limited | both 429 -> exit 4, no third attempt past `max_attempts`, cooldown file written for both; a following `pick` skips both until `cooldown_until`. |
| N8 | spawn-site gate | add an unregistered `claude -p` line to a fixture tree -> `unregistered_claude_spawn`; list a `wired` file without the `claude-account.js` call -> `wired_site_not_wired`. |
| N9 | registry present, no legacy path, ALL callers | `account-rails.test.js` iterates the full list: dispatch-review, dispatch-author, dispatch-hetero (claude-native), probe-engine-capability (A4), qualification-review-provider claude kind (A5), qc-panel (A6), probe-todo-tools-pin (A7), benchmark-hook-latency (A8), run-eval-batch (A9), run-skill-opt (A10), and the A12 eval runners (`run-t2-eval`, `run-orchestration-eval`, `run-pipeline-bench`, `run-p2-batch`, `run-t14-gate-batch`, `run-skill-onoff-eval`, `d0gate/cc`, `d0gate-v2/cc-v2`, `run-trigger-test`, `reviewer-bench` panel scripts). With a broken registry the shim spawn counter is 0 and the caller exits non-zero; with a good one the shim sees the alias token fingerprint. Per caller mutation test: remove its account-layer call, the test fails. Credentials-copy rule: a mutation that re-adds a copy of `~/.claude/.credentials.json` (decoy) in any W4/W5 caller makes the decoy-read assertion fail. |
| N10 | pick order | table of fixtures: tight excluded when an `ok` exists; `unknown` after `ok`; stale (>6 h) snapshot is `unknown`, expired window ignored; root mismatch ignored. Red first: threshold `> 0.90` instead of `>= 0.90` fails the boundary row at exactly 0.90. |
| N11 | lane tool leaks token to tmux | `--dry-run` output and a fake `tmux` shim argv capture must not contain the token. |
| N17 | realpath isolation | tempdir cases: `<alias>/home` symlinked to the fake real home; `claude/` symlinked to a fake `~/.claude`; alias dir inside the fake home; `home/.claude/.credentials.json` populated -> each exits 2 `path_escapes_isolation`. Red-first: skip realpath, case passes wrongly. |
| N13 | registry file checks | `registry.json` 0644, symlink, foreign owner (injected), unknown top-level and per-account key -> exit 2; red-first per check. |
| N14 | `refuse_all_tight` | config true, all aliases at 0.95: `pick`/`run` exit 3, spawn counter 0; config false: picks least tight and audits `all_tight`. Red-first: ignore the knob. |
| N15 | unsupported snapshot schema | snapshot with `schema:"codeforge.quota/9"`: class `unknown`, audit outcome `quota_schema_unsupported`, no crash. Red-first: accept any schema. |
| N16 | `max_attempts` | config 2, three aliases all 429: exactly 2 spawns, exit 4, third untried; red-first: loop without the bound. |
| N12 | env allowlist | caller env containing `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, a made-up `CLAUDE_CODE_NEWPROVIDER_X` -> none reach the shim. |

## 7. Test strategy

- Unit (Node `node:test`, no network): registry, quota reader (fixtures copied from codeforge's documented shape, with a `written_at_ms` boundary table), pick, env, audit, cooldown. Pure functions get `now`, `env`, `fs`-like arguments injected (the codeforge lesson: no process-env seams that race).
- Integration: `scripts/claude-account.test.js` with `claude-shim.js` that records `argv`, selected env names (never values), the token's sha256-first-8 (so tests can assert which token was presented without printing it), and replies from a script of canned envelopes (`ok`, `429`, `401`, hang).
- Rail tests: `scripts/account-rails.test.js` runs each wired caller in a tempdir git repo with the shim first on PATH and a fake registry; asserts which alias/token fingerprint reached the shim. Uses the existing dispatch test harness patterns (`hooks/tests/` dispatch-review/author/hetero suites); mutation check per rail (remove the wiring, test must fail).
- The suite uses the Node shim only. `selftest` (without `--real-binary`) runs against the shim. The real-binary 401 observation (F5) is an opt-in spike transcript run by hand (`selftest --real-binary`, O6), excluded from `affected-suites.js` and `validate.sh`, and its transcript goes into the P8 note.
- Quota path: test seam `AUTOPILOT_LIVE_DIR` pointing into the tempdir; never `/run/user`.
- Never run `bash hooks/tests/run.sh` per node; each hand uses `node scripts/affected-suites.js --run --files <changed>` (campaign convention). The full suite runs once, alone, before merge.

## 8. Phases

Dependency map: P0 -> (P1 || P2 || P5) -> P3 -> (W1 || W2 || W3 || W4 || W5 || P4) -> P6 -> P7 -> P8 (operator).
Interface freeze: P0 writes `scripts/lib/account-interfaces.md` content into section 5 (already above); P1, P2, P5 code against it and are file-disjoint.

| Phase | Size | Owner / parallel group | Scope | Acceptance |
|-------|------|------------------------|-------|-----------|
| P0 Spikes | S | 1 hand, first | S2 decoy probe (fabricated decoy only), S3 limit shape via the existing pass-through proxy recipe (`docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/01-...md`), S4 stream-json headroom check with a fake token (expect none), widen `engine-capability-state.js classify-error` only if S3 shows a gap (own test + negative control). Evidence under `docs/plans/evidence/2026-11-xx-g37-account-spikes/`. | Each spike has a written observed result; S3 shape pinned as test fixtures; unresolved ones are listed in section 10 with their blast radius. |
| P1 Registry + token store | M | Group 1 (parallel with P2, P5) | `account-registry.js` (+ CLI `list`, `check`; it never creates a token file, only the operator does, O3), realpath rule, tests, N2/N3/N4/N13/N17. | `node scripts/lib/account-registry.js check` prints `ok` on a fixture, each of N2-N4 red-then-green. |
| P2 Quota reader + pick + cooldown | M | Group 1 | `account-quota.js`, `account-cooldown.js`, `account-pick.js`, tests, N10, N7 cooldown half, N14 pick half, N15. Reuses `live-state-dir.js`. | Fixture table in 4.3 shape passes; boundary 0.90 pinned; expired window and 6 h staleness pinned; `used` unknown rows pinned. |
| P5 Audit + status | S | Group 1 | `account-audit.js` (key allowlist, outcome set), token-leak guard, `status` rendering (UTC+8), N5b. | Writer rejects token/`sk-ant-` shapes; `status` output contains no secret. |
| P3 Env + run wrapper | L | after P1, P2, P5 (single hand; shared state) | `account-env.js`, `claude-account.js` (`pick`, `env-check`, `run`, `exec`, `status`, `selftest`), Node shim, token scrub, N1, N2b, N5, N6, N7, N12, N14, N16, N17, T-GIT. | All listed controls red-first/green on the shim only; exit-code table in the script header (0 ok, 2 invalid/config, 3 none available, 4 all limited, 5 child error, 6 auth stop, 7 token scrubbed). |
| W1 Wire `dispatch-review.sh` | S | after P3, parallel (files disjoint) | Replace the claude-native arm (1928-1961) with `claude-account.js run` when the registry exists; keep `seed-claude-config.js` for the unconfigured default; N9 for this rail; codex mirror sync. | Rail test asserts alias/token fingerprint at the shim; broken-registry case spawns nothing. |
| W2 Wire `dispatch-author.sh` | S | parallel | Same for 1401-1432. Consult/discuss/plan-review inherit. | Same as W1. |
| W3 Wire `dispatch-hetero.sh` | M | parallel | Preflight 2418-2430 becomes `env-check --any`; worker 3930-3942 goes through `run`; cleanup/abort paths no longer need the seeded dir when active; `--gate-rules` settings path preserved. | Same as W1 plus T-GIT in the worker env and gate-rules argument preserved (existing suite stays green via `affected-suites`). |
| W4 Wire JS/probe callers | M | parallel | `probe-engine-capability.sh` (A4), `qualification-review-provider.js` claude kind (A5: with a registry the exam goes through the account layer, no dedicated-dir path), `qc-panel.js`, `probe-todo-tools-pin.js` (A7), `benchmark-hook-latency.js` (drop its credentials copy). | Each covered by N9 incl. mutation test; with no registry the exam is byte-identical to today. |
| W5 Wire evals + shell wrappers | M | parallel | The A9, A10, A12 runners: replace "copy `.credentials.json`" with an alias (`--alias` or pick), keep the scratch HOME/CONFIG isolation. `probe-skill-frontmatter-portability.sh` stays `--bare` and is registered `out_of_scope` (F4). | No runner copies `~/.claude/.credentials.json` when the registry exists (N9 credentials-copy mutation); eval suites still pass under shim. |
| P4 Lane re-open tool | M | after P3, parallel with W1-W5 | `scripts/lane-reopen.js`, fake-tmux tests, N11. | `--dry-run` shows alias-only command; fake tmux receives no token; opens a window in a real tmux in O5 only. |
| P6 Spawn-site gate + inventory | S | after W1-W5 and P4 | `check-claude-spawn-sites.js`, `claude-spawn-sites.json` (all of 4.1), wire into `validate.sh`, N8. | Gate green on the tree; N8 red-first; adding a `claude -p` anywhere unregistered fails. |
| P7 Docs, config keys, inventory | S | last, 1 hand | `docs/scripts-inventory.md` rows, `CLAUDE.md` grouped names, `references/hetero-dispatch.md` (claude-native auth section), `config-keys.json`, `CHANGELOG.md` (no version bump while 3.0.0 is held), Codex mirrors, `profiles` hash chain only if a dev-flow/ceo-agent SKILL.md changes (it should not; skill `profiles-hash-repin` applies if it does). | `check-claude-md-inventory.js`, `check-config-docs.js`, `check-reference-sizes.js`, `check-readme-parity.js` green. |
| P8 Real-alias verification | S | operator (section 9) | Two real aliases, 429 simulated through the proxy recipe, one lane re-open. | O1-O10 results pasted into a verification note; real-binary spike (O6) transcript attached. |

Total estimate: 1 L + 6 M + 5 S + 1 operator S. With the parallel groups, about 4 waves of hands (P0; P1/P2/P5; P3; W1-W5+P4; P6/P7).

Parallel safety: Group 1 files are disjoint (`account-registry*`, `account-quota*|cooldown*|pick*`, `account-audit*`). W1-W5 and P4 touch disjoint files; the shared mirror files under `platforms/codex/plugin/scripts/` are written only by `sync-codex-plugin-skills.sh`, run once in P7 by a single hand (so W units do not collide on mirrors; each W unit leaves its mirror stale until P7, and `check-canonical-invariants.sh` is run at P7 only).

## 9. Operator checklist (PM forwards to the operator; every command is run by the operator)

Pre-reads: `<A>` = the first alias (e.g. `main`), `<B>` = the second (e.g. `spare`). Aliases are lowercase `[a-z0-9-]`, <= 24 chars, not shaped `acct-<8 hex>` or `codex-<8 hex>`.

O1. Create the directories (no secret yet):
```
umask 077
mkdir -p ~/.config/autopilot/accounts/<A>/claude ~/.config/autopilot/accounts/<A>/home
mkdir -p ~/.config/autopilot/accounts/<B>/claude ~/.config/autopilot/accounts/<B>/home
chmod 700 ~/.config/autopilot ~/.config/autopilot/accounts ~/.config/autopilot/accounts/<A> ~/.config/autopilot/accounts/<B>
```
Expected: `stat -c '%a %n' ~/.config/autopilot/accounts/<A>` prints `700 …`.

O2. Write the registry (no secret):
```
cat > ~/.config/autopilot/accounts/registry.json <<'EOF'
{"schema":"autopilot.accounts/1","accounts":[{"alias":"<A>","enabled":true,"priority":10},{"alias":"<B>","enabled":true,"priority":20}]}
EOF
chmod 600 ~/.config/autopilot/accounts/registry.json
```

O3. Generate each token, one account at a time. For alias `<A>`: log in to that Claude account in a browser/terminal as usual, then in a terminal run `claude setup-token` and follow its prompts (do this only after `claude auth status` shows the account you intend). It prints a long-lived token once. Paste it into the file without echoing it to the shell history:
```
read -rs T; printf '%s' "$T" > ~/.config/autopilot/accounts/<A>/token; unset T
chmod 600 ~/.config/autopilot/accounts/<A>/token
stat -c '%a %U %n' ~/.config/autopilot/accounts/<A>/token
```
Expected: `600 <you> …/token`. Repeat for `<B>` with the other account. Record (no token) what `setup-token` printed about expiry (Spike S1).

O4. Validate the registry: `node scripts/claude-account.js env-check --alias <A>` and `--alias <B>`. Expected each: `ok alias=<A> mode=0600 config_dir=…/<A>/claude credentials_present=no`. Then `node scripts/claude-account.js status`. Expected: one line per alias with `class=unknown` (no snapshot yet) and no token text.

O5. First interactive start per alias (one-time onboarding of its config dir): `node scripts/lane-reopen.js --alias <A> --cwd ~/projects/autopilot --dry-run` (prints an alias-only command), then without `--dry-run` inside tmux. Expected: a new tmux window with `claude` running as account `<A>`; complete the theme/trust prompts once; type `/status`; the statusline row shows alias `<A>` if codeforge is active. Note whether it asked for login (Spike S5).

O6. Opt-in spike transcript (not part of any suite): fake-token no-fallback proof against your real login (spends nothing):
```
node scripts/claude-account.js selftest --real-binary
```
Expected: exit 0 and the line `selftest: fake token -> 401, ambient login not used`. Paste the transcript into the P8 note. This runs a child with a `FAKE-` token and your real `~/.claude` untouched and unreferenced; it must not answer the prompt.

O7. Real headless call per alias: `node scripts/claude-account.js run --alias <A> --purpose operator-check --stdout /tmp/g37-a.json -- claude -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config`, same for `<B>`. Expected: exit 0, `/tmp/g37-a.json` has `"is_error":false`; `node scripts/claude-account.js status` then shows an audit line per call (alias only).

O8. Picker check: `node scripts/claude-account.js pick --purpose operator-check`. Expected: prints the alias with more headroom when codeforge snapshots exist (`ls /run/user/$(id -u)/autopilot/codeforge/usage/quota/`), else the lower `priority` number with `class=unknown`.

O9. Limit simulation (no real exhaustion needed): `node scripts/claude-account.js selftest --simulate-429 <A>` (runs through the S3 proxy recipe). Expected: `A rate_limited -> B ok`, and `node scripts/claude-account.js status` shows `<A>` cooling down.

O10. Rollback if anything looks wrong: `mv ~/.config/autopilot/accounts/registry.json ~/.config/autopilot/accounts/registry.json.off`. Expected: rails return to the old seeded behaviour on the next call (`AUTOPILOT_ACCOUNT_MODE=off` does the same for one shell).

Token hygiene for the operator: if a token is ever pasted into a chat, a log, or a command line, treat it as leaked and regenerate it (O3) after revoking the old one in the Claude account settings.

## 10. Risks + inversion

What would guarantee failure:
1. Silent ambient fallback after wiring (a rail keeps a second path). Mitigations: N1, N9, the 5.5 rule "no branch continues", per-rail mutation test, spawn-site gate N8.
2. Snapshot never exists for headless-only aliases, so picking is blind (4.3). Mitigation: `unknown` class + priority order + local 429 cooldown; OQ2 covers a headless refresh signal. Failure mode if left: always the first alias until it 429s, then switch; costs one wasted call per limit window, bounded by cooldown.
3. Token semantics differ from assumption (precedence S2, lifetime S1, interactive onboarding S5, limit shape S3). Mitigation: P0 spikes before any wiring; design does not depend on S2 (D4).
4. A limit error is classified as success or generic failure so no switch happens. Mitigation: P0 pins the shape; classifier is table-driven with fixtures; unknown-shaped failure is NOT switched (audited as `other_failure`), erring toward not burning accounts on prompt errors.
5. Cooldown deadlock: all aliases cooled while the window has actually reset. Mitigation: cooldown ends at the snapshot's `resets_at` when known, default 30 min otherwise, `status` shows it, `claude-account.js cooldown --clear <alias>` exists for the operator.
6. Concurrent rails race on cooldown/audit files. Mitigation: O_APPEND for audit; cooldown files one per alias, rename-replace.
7. Token in a bash rail's memory or `ps`. Mitigation: the bash rails never read the token; they call `claude-account.js run`, which reads it; N5.
8. Test touching the real store (family in `evidence-discipline`). Mitigation: all paths via `AUTOPILOT_ACCOUNTS_DIR`/`AUTOPILOT_LIVE_DIR`/`XDG_STATE_HOME` set by the harness; a test asserts the resolved dirs start with the tempdir, and `$HOME` is replaced in every test.
9. Max-subscription terms: using several accounts to route around limits may conflict with provider terms. Out of the engineering scope but flagged for the operator (OQ6).
10. Shared-config-dir state: interactive lanes under one alias share one `claude/` dir; two lanes on the same alias is normal (same as one account today).

Inversion check: "what if the token expires mid-batch" -> 401 -> exit 6 STOP_AUTH with the alias name -> the batch stops loudly (existing `auth-stop` behaviour), operator re-runs O3 for that alias. "What if the registry file is deleted" -> legacy path, intentionally (explicit rollback). "What if codeforge changes the snapshot schema" -> `codeforge.quota/1` is checked; an unknown schema makes all snapshots `unknown` with an audited with outcome `quota_schema_unsupported` (N15), never a crash.

## 11. Out of scope

- Any change to `~/projects/codeforge` or to the G36 snapshot format.
- Codex, Kimi, agy and other non-Claude runners; cc-shim third-party endpoints; `--bare` API-key paths (group B).
- Automatic movement of a running interactive lane (the PM triggers `lane-reopen.js`; no auto-kill).
- Creating tokens (only the operator runs `setup-token`), reading or copying `.credentials.json`, rotating or revoking tokens.
- Fleet-wide aggregation of headroom across hosts (waits for codeforge fleet kv).
- Per-token usage attribution inside one config dir.

## 12. Open questions

OQ1 (Board): when every alias is `tight`, fail closed (`accounts.refuse_all_tight=true`) or still try the least tight? Proposed default: try, because 90% is not exhausted. Needs PM/operator choice.
OQ2: should headless runs refresh headroom (needs S4: a stream-json rate-limit event) or is the interactive statusline plus the 429 cooldown enough? Proposed: enough for v1.
OQ3: `priority` tie-break and the registry's `enabled` flag: is a per-purpose pin needed (for example, exams always on `main`)? Proposed: no in v1; `--alias` already pins per call.
OQ4: should the alias be carried into dispatch result JSON (`alias` field) for the PM's view? It is not secret and codeforge uses it, but it widens dispatch result schemas (`check-contract-schema.js`). Proposed: audit only in v1.
OQ5: cooldown default 30 min vs using the 5-hour window's `resets_at` when only a 429 (no snapshot) is known. Proposed: 30 min, then the next call retries and re-learns.
OQ6 (Board, not engineering): whether routing across multiple subscription accounts is acceptable under the provider's usage terms.
OQ7: the evidence recipes (group B5) keep their own staging; add an alias option later?

## 13. Self-review

- Scope coverage: PM item 1 (registry, token file 0600, per-alias config dir, location) -> 5.1, P1, O1-O3. Item 2 (detection by alias: G36 snapshot >= 90%, and 429) -> 4.3, 5.3, 5.4, P2/P3. Item 3 (auto pick on every spawn path, next on 429, fail closed on bad token, never ambient) -> 4.1 table, 5.4, 5.5, W1-W5, N1, N6, N9. Item 4 (lane re-open, token only in child env) -> 5.7, P4, N11. Item 5 (audit alias-only) -> 5.6, P5, N5. Investigation asks: spawn-site inventory (4.1) with gate (5.9, P6); existing auth/env (2f7888042, auth-stop, seed-claude-config) -> 4.1, 4.2; `setup-token`/env var facts and spikes -> 4.0; the two memory traps -> section 0, D4, 5.1; quota to alias mapping -> 4.3.
- Placeholder scan: no unresolved markers in load-bearing steps. `<A>`/`<B>` in section 9 are deliberate operator inputs; `2026-11-xx` in the P0 evidence directory name is filled by the P0 hand with the run date.
- Dependency map: stated at the head of section 8; W and P4 depend on P3 only through the CLI contract (5.4), frozen here.
- Risks + inversion: section 10. Out of scope: section 11.
- Known weak points of this plan itself: F5 proves a bad token fails with 401 only in an environment that had no ambient credential; the decisive "ambient login exists and is still not used" case is deferred to N1 (shim) and O6 (real binary). The limit-error shape (S3) is unverified on a real exhausted account.

## Review log

- Generation 1 (astra + Fable): CONDITIONAL, 16 findings, all accepted; repaired in the follow-up commit: F1/F16 -> 2.5, 3; F2/F13 -> 2.5, 5.4, N5; F3 -> 2.5, 5.1, N17; F4/F8 -> 2.5, 5.5 item 3, N2b; F5 -> 5.4; F6/F12 -> 2.5, 7, O6; F7/F9 -> 5.6, N5b; F10 -> 5.2, T-GIT; F11 -> 2.6, 4.1, W4; F14 -> N3, section 9; F15 -> N13-N16, N9.
- R0 author: hands lane `g37plan`, 2026-11-03. Plan-review manifest and frozen rubric: not yet created. Controller generations: none. Dispositions: none.
