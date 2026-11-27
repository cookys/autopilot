#!/usr/bin/env bash
# dispatch-hetero — heterogeneous implementer dispatch (Claude Code → agy
# headless) with MANDATORY git-worktree isolation.
#
# Why a script (not prose): the safety rails must be impossible to skip.
# agy has no `--allowedTools`-grade granular allowlist — its
# `--dangerously-skip-permissions` is all-or-nothing — so mutation work MUST
# run in a throwaway worktree, never the main checkout. And the agent's
# self-report is not evidence: this script verifies by artifacts (commit
# presence, diff stats, tree cleanliness). Empirical basis:
# references/multi-agent-portability.md § "Verified by Spike (agy 1.0.5
# headless dispatch, 2026-06-11)".
#
# Contract: this script only IMPLEMENTS. Verdict stays at depth 0 — the
# dispatching session reviews the branch diff (quality-pipeline) before any
# merge. Committed rounds touching BACKLOG.md or .hippo/ also run
# scripts/check-backlog-single-writer.js --range <base>..<tip> (hand commits
# bypass pre-commit hooks, so single-writer drift is boundary_rejected with
# boundary_code backlog_single_writer). See references/hetero-dispatch.md.
#
# USAGE:
#   scripts/dispatch-hetero.sh --branch <name> --prompt-file <file>
#       [--pin-reason <text>]                 # 1..200 characters, one line; explain an explicit engine pin
#       [--model <id>]                        # no built-in model. An implementer call with no --runner,
#                                             # and no pace selection or strict-contract pin, uses runner local
#                                             # and, when --model is omitted, model qwen. --runner grok with
#                                             # no --model is still grok-4.7 at effort low; --runner codex -> gpt-6.1-terra low,
#                                             # --runner agy -> gemini-4-hydrogen-low low (never carbon),
#                                             # --runner opencode -> opencode-go/beam-free (no variant),
#                                             # cursor/kimi use broker defaults; other runners REQUIRE --model.
#                                             # A gemini-flash[-tier] alias still resolves against the live
#                                             # `agy models` inventory. Explicit --model/--effort always win.
#       [--runner auto|codex|agy|grok|cc-shim|local|pi|cursor|opencode|kimi|claude-native|qoderclicn] # implementer default (no --runner, no pace selection or contract pin): local only when qwen_local resolves ready and the cn gate allows that seat; otherwise grok-4.7.
#                                              #   Other roles stay auto: *gpt*/*codex*→codex,
#                                              #   local: shorthand for cc-shim + --sandbox bwrap + an endpoint that
#                                              #   is qwen_local by default, or --endpoint when that name is listed
#                                              #   in scripts/lib/local-sandbox-endpoints.json. An unlisted
#                                              #   --endpoint is refused (exit 2). A --sandbox other than bwrap
#                                              #   is a precondition conflict. Result and manifest record runner
#                                              #   local, resolved_runner cc-shim, and the endpoint actually used
#                                              #   (qwen_local by default, or the listed --endpoint).
#                                              #   A local run with no --worktree-parent uses a 0700 per-user directory
#                                              #   under $XDG_RUNTIME_DIR if set, else ${TMPDIR:-/tmp}, never inside the repo.
#                                              #   Child env sets ENABLE_TOOL_SEARCH=false, does not set
#                                              #   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, and sets
#                                              #   ANTHROPIC_CUSTOM_HEADERS to the caller's existing headers
#                                              #   plus an x-lane line after them (AUTOPILOT_LANE, or autopilot
#                                              #   when that variable is unset). A lane that is empty, "." or
#                                              #   "..", or that contains "/" or any character outside
#                                              #   [A-Za-z0-9._-] (including CR or LF) is refused (exit 2).
#                                              #   The check runs once and is reused for the token path and
#                                              #   the x-lane header. A non-empty file
#                                              #   $AUTOPILOT_GATEWAY_TOKEN_DIR/<lane> (default
#                                              #   $HOME/.config/local-llm-gateway/tokens) overrides
#                                              #   ANTHROPIC_AUTH_TOKEN with its trimmed contents. Result and
#                                              #   manifest record gateway_token as lane-file or endpoint,
#                                              #   never the token value.
#                                              #   *grok*/*composer*→grok, no --model→grok, else agy (*qwen*/*qwq* refused; use cc-shim + --endpoint).
#                                              #   qoderclicn (EXPLICIT only, never auto): Qoder CLI CN.
#                                              #   Explicit wins (don't rely on name luck).
#                                              #   grok: default grok-4.7 (effort low); also grok-4.5 (ex-grok-build), grok-composer-2.5-fast
#                                              #   cc-shim (EXPLICIT only): Claude Code CLI
#                                              #   driving an Anthropic-compatible endpoint —
#                                              #   needs ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
#                                              #   in env (e.g. MiniMax-M3, GLM-*).
#                                              #   opencode (EXPLICIT only): OpenCode CLI
#                                              #   `opencode run` headless; --model is a
#                                              #   provider/model id from `opencode models`
#                                              #   (e.g. opencode-go/muse-spark-1.3-contributor).
#                                              #   kimi: shared Unix-socket broker; pace eligible.
#                                              #   Default kimi-code/kimi-for-coding; configurable
#                                              #   model grammar. No model-name auto inference.
#                                              #   --kimi-bin selects the local CLI fixture seam.
#                                              #   pi (EXPLICIT only): pi coding agent over RPC
#                                              #   (duplex supervisor scripts/lib/pi-rpc-run.js;
#                                              #   provider default minimax via PI_RPC_PROVIDER).
#                                              #   cursor: shared Unix-socket broker implementer.
#                                              #   Default composer-2.5; composer models only.
#                                              #   Pace may select it; the model-name guard remains.
#       [--pace-role <role>]                   # override the default implementer quota-selection role.
#                                              #   No named runner/model: pace-select chooses by quota
#                                              #   among four cheap seats only (grok-4.7/low,
#                                              #   gpt-6.1-terra/low, gemini-4-hydrogen-low/low,
#                                              #   opencode-go/beam-free/default). Records engine_choice
#                                              #   + pace_choice; pace_unknown retains the existing default.
#                                              #   Named seats win and warn at the ceiling. An explicit
#                                              #   --model/--effort always wins.
#       [--effort xhigh]                       # reasoning effort (low|medium|high|xhigh|max; unpinned codex/grok/agy→low, opencode→none)
#       [--endpoint <name>]                    # cc-shim only (also --endpoint=<name>; last one
#                                              #   wins; @none clears; empty is refused): resolve
#                                              #   creds via resolve-endpoint.sh
#                                              #   (AUTOPILOT_ENDPOINT_<NAME>_*) into
#                                              #   ANTHROPIC_BASE_URL/AUTH_TOKEN; raw env still
#                                              #   used when omitted (byte-identical)
#       [--sandbox off|bwrap]                  # cc-shim only (any other runner is refused). bwrap: the worker
#                                              #   runs inside bubblewrap with `/` read-only, so a write outside
#                                              #   the worker's own directories fails BEFORE it lands (EROFS) instead of
#                                              #   being found afterwards by the main-checkout fingerprint (which still
#                                              #   runs, second layer). Writable, and nothing else: (1) the worktree,
#                                              #   (2) this dispatch's own scratch dir (TMPDIR, the throwaway
#                                              #   CLAUDE_CONFIG_DIR, the result envelope; made and removed per run),
#                                              #   (3) /dev and /proc as bwrap's minimal device/proc mounts. The real
#                                              #   ~/.claude and ~/.claude.json are masked, never writable. Network as
#                                              #   before. Fails closed: no bwrap, bwrap cannot start, or the worktree
#                                              #   sits inside any repo's working tree => precondition_failed, never a
#                                              #   silent run without the sandbox. Result JSON + manifest carry
#                                              #   `sandbox: {mode, writable, denied_writes}`. Default off.
#                                              #   A local implementer seat (scripts/lib/local-sandbox-endpoints.json,
#                                              #   today qwen_local) on cc-shim — and on --runner auto, which
#                                              #   re-resolves to cc-shim when that endpoint is listed — is refused
#                                              #   at runner resolution, BEFORE resolve-endpoint and before any
#                                              #   model call, unless this flag is bwrap
#                                              #   (boundary_code local_implementer_sandbox_required, PM 01M748P8G8).
#                                              #   Read-only rails are not this script. No unsandboxed fallback.
#                                              #   The worktree's `.git` gitfile is bound read-only; the rail also
#                                              #   checks it is unchanged before any git against the worktree
#                                              #   (else boundary_rejected, worktree_gitfile_tampered), sandbox or not; any nested `.git` below the
#                                              #   worktree root is refused too (worktree_nested_repo), and the rail's git runs with fsmonitor and hooksPath off.
#                                              #   references/hetero-dispatch.md § Write sandbox.
#       [--worktree-parent <abs dir>]          # place the new worktree under this directory instead of
#                                              #   <main checkout>/.claude/worktrees (required with --sandbox bwrap
#                                              #   unless --reuse-worktree, except --runner local, which fills this
#                                              #   with a 0700 per-user dir outside the repo when the flag is omitted)
#       [--context-window off|warn|block]      # pre-dispatch context-window gate (default:
#                                              #   block; also AUTOPILOT_CONTEXT_WINDOW_GATE).
#                                              #   Over budget ⇒ fail closed BEFORE the runner
#                                              #   spawns and before the worktree exists.
#                                              #   See references/hetero-dispatch.md
#                                              #   § Context-window gate.
#       [--skill-mode off|prompt|native|auto]  # skill transport mode (default: off)
#       [--skill <name>]                       # repeatable skill name (0+)
#       [--base develop]                       # default
#       [--timeout 9m]                         # wall deadline (default 9m). It kills the worker
#                                              #   unless --idle-timeout was also passed and progress
#                                              #   (output bytes or process-tree CPU) is still inside
#                                              #   that idle window — then one "extend:" line per idle
#                                              #   window and the run continues until idle or --hard-timeout.
#       [--idle-timeout 5m]                    # no output-byte or process-tree CPU growth for
#                                              #   this long kills the worker group (default 5m).
#                                              #   AUTOPILOT_HETERO_SAMPLE_S is the sample period
#                                              #   (default 15; tests set it lower).
#       [--hard-timeout 4h]                    # wall cap even while progress continues
#                                              #   (default 4h, or AUTOPILOT_HETERO_HARD_TIMEOUT).
#       [--gate-rules <file>]                  # claude-native / cc-shim only (any other runner is refused):
#                                              #   per-turn gate for THIS hand. Mints a fresh session id, arms
#                                              #   scripts/per-turn-gate-arm.js (gate-verify --check first; nothing
#                                              #   is written for a bad list) and starts claude with a per-run
#                                              #   --settings file whose Stop hook is hooks/per-turn-gate.js. The gate
#                                              #   file and the settings file are removed when the worker ends
#                                              #   (success, failure, timeout) and by the exit/abort traps. Off unless given.
#       [--role-kit <dir>]                     # claude-native only (any other runner is refused): the child
#                                              #   gets <dir>/role.md as --system-prompt, <dir>/plugin as
#                                              #   --plugin-dir (when present) and the one-line <dir>/tools
#                                              #   allowlist as --tools. Validated before anything is created
#                                              #   (references/hetero-dispatch.md "Role kit"). Off unless given.
#       [--commit-quiet-secs 120]              # implement stage: stop the runner once the branch has
#                                              #   advanced past base, the worktree is clean and the log
#                                              #   has not grown and the agent has no child process for N s (0 disables); ledger note
#                                              #   ended_after_commit_quiet, status committed
#       [--agy-bin agy]                        # alternate binary (test seam)
#       [--grok-bin grok]                      # alternate binary (test seam)
#       [--codex-bin codex]                    # alternate/pinned codex (test seam; avoids a
#                                              #   stale codex earlier in PATH lacking the flag)
#       [--pi-bin pi]                          # alternate/pinned pi executable (test seam)
#       [--cursor-bin cursor-agent]            # retained legacy option; refused by the broker
#       [--opencode-bin opencode]              # alternate/pinned OpenCode CLI (test seam)
#       [--kimi-bin kimi]                      # explicit local Kimi CLI fixture seam; default broker
#       [--qoder-bin qoderclicn]               # alternate/pinned Qoder CLI CN (test seam)
#       [--qoder-config-dir <dir>]             # passed as --config-dir only when set
#       [--cursor-fast]                        # retained legacy option; refused by the broker
#       [--no-campaign]                        # ordinary backlog work outside any campaign.
#                                              #   Under Mission enforce this admits the dispatch
#                                              #   and records campaign_scope=none_declared plus
#                                              #   the enforcement_mode seen. Refused together
#                                              #   with any --campaign-* flag, and refused while
#                                              #   an active l5/l6 session marker says a campaign
#                                              #   is in scope for this repo (PM 01M794CK).
#       [--campaign-contract <path>]            # sealed ICC boundary, prepended to prompt
#       [--campaign-contract-sha256 <digest>]    # intake-bound digest for private snapshot
#       [--campaign-seal <path>]                # intake-validated seal, rechecked at leaf admission
#       [--strict-contract]                     # required together with --contract-file
#       [--contract-file <path>]                # required together with --strict-contract
#       [--conformance-intent <path>]           # REQUIRED when the contract carries
#                                               #   frozen_four_tuple: the round's declared
#                                               #   intent, gated pre-spawn by
#                                               #   check-blueprint-conformance.js preflight
#       [--verify-cmd <shell command>]         # repeatable. Re-run this command at the
#                                               #   committed tip (bash -c). First source
#                                               #   that yields a command wins; see
#                                               #   "Tip verification" below.
#       [--verify-timeout <seconds>]           # per-command tip-verify timeout (positive
#                                               #   integer; default 1800). GNU timeout's
#                                               #   exit 124 is recorded as timeout.
#       [--no-verify-tip]                      # skip tip verification. Result JSON is
#                                               #   "tip_verify": "skipped_by_flag".
#                                               #   Refused together with --verify-cmd.
#                                               #   Ignored under --strict-contract
#                                               #   (that path does not emit tip_verify).
#       [env AUTOPILOT_TIP_VERIFY_REQUIRE=1]   # when no source yields a command,
#                                               #   refuse before the worker starts
#                                               #   (the die_precondition text below).
#                                               #   Unset: a non-empty grace list
#                                               #   (scripts/lib/tip-verify-grace.json)
#                                               #   is "tip_verify": "no_source";
#                                               #   an empty list refuses the same way.
#       [env AUTOPILOT_TIP_VERIFY_GRACE_FILE]  # test-only path of that grace list.
#                                               #   Unset reads the file next to
#                                               #   this script. Not a user knob.
#       [--keep-worktree]                      # keep worktree even on success
#       [--sibling-ref-prefix refs/heads/x/]   # repeatable: a ref namespace the CALLER owns
#                                              #   (e.g. refs/heads/hands/kr1/). Must start with
#                                              #   refs/heads/ and end with /; refs/heads/ alone
#                                              #   is refused. The round fingerprint (fleet
#                                              #   01M788GD) already ignores every other
#                                              #   refs/heads/*, so two dispatch-hetero runs no
#                                              #   longer reject each other for each other's
#                                              #   branches. The flag still drops that namespace
#                                              #   from whatever is measured (the checkout's
#                                              #   branch, --base, and — for a caller that leaves
#                                              #   the scope unset — every ref).
#       [--sibling-path-prefix <dir>/]         # repeatable: a checkout-relative directory the
#                                              #   CALLER writes its own rail I/O into (hand
#                                              #   stderr/result under the checkout, 308-8f).
#                                              #   Pruned from the fingerprint's stat walk only;
#                                              #   refs/diffs/config/hooks/index there still
#                                              #   count. The directory must exist BEFORE the
#                                              #   round (creating it touches the root mtime).
#                                              #   Rail I/O should live OUTSIDE the checkout —
#                                              #   this is the declared exception.
#       [env AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX / _PATH_PREFIX]  # colon-separated defaults
#                                              #   for the two flags above, ADDED to whatever the
#                                              #   CLI gave (never replacing it); a parent rail can
#                                              #   set these in a hand's environment instead of
#                                              #   the hand's own prompt having to pass the flag
#                                              #   (308 BACKLOG #46 — dispatch-foreman.sh sets
#                                              #   AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX to its
#                                              #   own hands/<run>/ namespace for every hand).
#       [--retain-owner <id> --retain-reason <text> --retain-until <epoch>]
#       [--reuse-worktree <absolute-path>]      # campaign repair: reuse an exact retained
#       [--scratch]                             # restricted operators work in a fresh private directory;
#                                                # captured edits are committed through the disposable worktree
#       [--expected-worktree-instance <sha256>] # required identity fence for retained reuse
#       [--resume-session <uuid>]               # Grok repair: resume the exact prior session
#   (`--gc`, `--reap-unmarked`, `--yes` and the `stale_reaper_age_days` setting were removed at 3.0.0;
#    the automatic reaper is `scripts/repo-residue-sweep.js reap --auto --yes`, run by the SessionStart hook.)
#   ⏳ TIMEOUT: the implementer run can take MANY minutes. Under Claude Code's Bash tool,
#   pass a generous `timeout` — the 120s tool default SIGTERMs long runs (exit 143). Persist
#   once with BASH_DEFAULT_TIMEOUT_MS (and BASH_MAX_TIMEOUT_MS) in ~/.claude/settings.json `env`.
#
# OUTPUT: one JSON object on stdout (agent stdout goes to a log file, never
# stdout — keeps the JSON parseable):
#   { "status": "committed" | "no_op" | "question_suspected" | "dirty"
#               | "failure" | "precondition_failed" | "verify_failed",
#     "runner": "codex"|"agy"|"grok"|"cc-shim"|"local"|"pi"|"cursor"|"opencode"|"kimi"|"claude-native"|"qoderclicn", "model": "...",   # engine provenance (model = --model)
#     "resolved_runner": "cc-shim", "endpoint": "<qwen_local by default, or the listed --endpoint>",   # only when --runner local
#     "gateway_token": "lane-file"|"endpoint",   # only when --runner local; which auth source won, never the secret
#     "containment": "...", "contained": true|false,  # teardown-hygiene provenance
#     "branch": "...", "base": "...", "commit": "...|null",
#     "files_changed": N, "insertions": N, "deletions": N,
#     "worktree": "...|null", "agent_log": "..." , "error": "...|null",
#     "timed_out": true|false, "timeout_enforced": true|false,
#     "timeout_kind": "idle"|"hard"            # only when this rail killed the worker
#     "candidate_ref": "<sha>|null"            # worktree HEAD when it moved past base, on a kill
#     "killed_at": {"elapsed_s": N, "last_progress_s_ago": N, "signal": "idle"|"hard"}
#     "timeout_source": "caller"|"contract_wall"|"caller_within_wall"
#       (when present; caller = no-contract --timeout, caller_within_wall = within
#        a Mission contract wall, contract_wall = contract-supplied). The run
#        manifest additionally uses default for an unenforced run.
#     "skill_mode_effective": "...", "skills_injected": [...],
#     "orphan_worktree": "...|null" }          # non-null iff remove failed and dir remains
#
# OUTCOME states (the no-commit case is split by HOW the worker ended so a legit
# no-op task is not confused with a stalled/paused one — see
# references/hetero-dispatch.md § "Outcome states"):
#   committed          — new commit + clean tree + agent exit 0 → success.
#   dirty              — new commit but tree left uncommitted-dirty → failure.
#   no_op              — exit 0, no new commit → agent legitimately judged
#                        nothing was needed; NOT a failure of the dispatch.
#   question_suspected — timeout or non-zero exit, no new commit → worker likely
#                        paused on a clarifying question (auto-approve does NOT
#                        silence the model's own question — see
#                        references/blind-dispatch.md § "Clarifying questions
#                        survive auto-approve") or otherwise stalled.
#   CLI-agnostic: reuses the git read + the already-captured AGENT_EXIT, adds
#   ZERO stream parsing.
#
# EXIT: 0 = committed (new commit + clean tree + agent exit 0; worktree removed
#           unless --keep-worktree; the branch survives for review/merge)
#       1 = ran but did not yield a reviewable clean commit — one of: failure,
#           dirty, no_op, question_suspected (worktree KEPT for inspection — clean up
#           with `git worktree remove`)
#           A kept worktree's marker carries `retention_reason=<token>` and
#           `retention_expires_at=<now + residue.lease_hours (default 72 h)>` (also on boundary_rejected,
#           main_checkout_mutated and the detach-forced keep); an explicit --keep-worktree lease keeps its own
#           expiry. repo-residue-sweep.js reap --auto reads these.
#       2 = precondition failure (nothing was created)
#       3 = verify_failed (a commit exists and the tree was clean and the agent
#           exited 0, but a tip-verify command exited non-zero, timed out, or
#           moved HEAD or refs/heads/<branch> off the committed sha).
#           Distinct from 0. The commit stays on the branch for inspection and
#           the worktree is kept. Not a success.
#
# Tip verification (default on; --strict-contract does not use this path and
# does not emit tip_verify):
# After the rail commits the worker's edits, and only on the path that would
# otherwise be status committed, each command is re-run at that commit. The
# worker's own "green" is not evidence (ADR-0001).
#
# Command source, first that yields at least one command:
#   1. every --verify-cmd <shell command>, in flag order (source "flag");
#   2. the brief (--prompt-file) ## Acceptance section (source "brief");
#   3. the consuming checkout's .claude/quality-gate-config.md section
#      ## Test Command (source "repo_config"), via
#      scripts/lib/tip-verify-repo-default.js;
#   4. none. AUTOPILOT_TIP_VERIFY_REQUIRE=1 refuses before the worker starts
#      (die_precondition, naming --verify-cmd, ## Acceptance, and ## Test Command).
#      Otherwise, if scripts/lib/tip-verify-grace.json has a non-empty repos
#      list, one stderr line is printed before the worker starts:
#      dispatch-hetero: tip verify: <repo> has no default test command; add a fenced bash block under ## Test Command in .claude/quality-gate-config.md (or a fenced block under ## Acceptance in the brief); the tip is not re-verified
#      <repo> is the basename of `git remote get-url origin` minus a trailing
#      .git, else the toplevel directory basename. TIP_VERIFY_SKIP is set and
#      the result is tip_verify:"no_source" (no commands run). An empty grace
#      list refuses with the same die_precondition text.
#      AUTOPILOT_TIP_VERIFY_GRACE_FILE is a test-only path override of the grace
#      list (unset reads the file next to this script; not a user knob).
#      --no-verify-tip opts out and records tip_verify:"skipped_by_flag"
#      (no commands run).
#
# Acceptance extraction (deterministic; the original brief, before skill-pack):
#   put acceptance commands in a fenced block under ## Acceptance.
#   The section is the lines after a line matching ^## Acceptance[[:space:]]*$
#   until the next line matching ^##[[:space:]] or EOF. A longer heading
#   (## Acceptance criteria) does not open the section.
#   Only lines inside a fenced code block directly under that heading are
#   commands. The opener is a trimmed line ``` or ```bash or ```sh; any other
#   ``` line toggles a non-command fence. Inline code in prose is ignored.
#   A fenced line containing a <word> placeholder (<[A-Za-z_][A-Za-z0-9_-]*>)
#   fails extraction with a precondition error naming that line, before the
#   worker starts. Other fenced lines are kept when, after trim, they are
#   non-empty, do not start with #, and the first whitespace-separated token
#   is executable-looking: it starts with ./ or ../ or /, OR it matches
#   ^[A-Za-z][A-Za-z0-9_+-]*$ (no dot, so tip_verify.status is not a command;
#   true, false, sleep, bash, cargo, npm, node, make, pytest, go, env,
#   timeout match). Kept text is the trimmed line, in document order.
#   ## Test Command: lines after ^## Test Command[[:space:]]*$ until the next
#   ^##[[:space:]] or EOF. Read by scripts/lib/tip-verify-repo-default.js.
#   A command counts only inside a fenced code block
#   (a line whose trim starts with ``` opens or closes it; ```bash and ```sh
#   count, other languages do not) or when the whole trimmed line is one
#   inline span `...`. It must pass the same executable-looking check and
#   contain no <word> placeholder (a <[A-Za-z_][A-Za-z0-9_-]*> token). Anything
#   else is not a repo_config source. Prose and a numbered step with an inline
#   span are not commands. A placeholder here is skipped, not a precondition.
#
# Run: `timeout <secs> bash -c <cmd>` in the dispatch worktree, stdin from
# /dev/null, environment without AUTOPILOT_SESSION_ID. --verify-timeout is a
# positive integer (default 1800). GNU timeout exit 124, or a spawn error
# ETIMEDOUT, is tip_verify status "timeout" (a command that itself exits 124
# is also recorded as timeout). Any other non-zero rc is "fail". A spawn
# error other than ETIMEDOUT or ENOENT is "fail" and is decided before the
# exit status; that error's code is included in the command tail. stdout and
# stderr are kept up to 64 MiB (maxBuffer). All commands
# are recorded. If any command times out, tip_verify.status is "timeout"; else
# if any rc is non-zero, "fail"; else "pass". A missing `timeout` binary is
# fail with rc 127. After each command, `git -C <worktree> rev-parse HEAD` and
# `git -C <worktree> rev-parse --verify refs/heads/<branch>` must both still
# equal the committed sha. If either differs, that command is "fail" (rc 1
# when the command itself exited 0) and its tail names the command, the
# expected sha, and both observed shas. Untracked or modified files left by
# the command are not a failure. Result JSON, when this path runs:
#   "tip_verify": { "status": "pass"|"fail"|"timeout", "commit": "<sha>",
#     "source": "flag"|"brief"|"repo_config",
#     "commands": [ { "cmd", "rc", "duration_s", "tail" } ] }
#   tail is the last 40 lines of stdout followed by stderr (one trailing empty
#   line from a final newline is dropped). duration_s is integer seconds.
#   When no source yields a command and the grace list is non-empty,
#   "tip_verify" is the string "no_source" (not an object). An empty grace
#   list, and AUTOPILOT_TIP_VERIFY_REQUIRE=1, refuse that case instead (exit 2).
#   --no-verify-tip sets the string "skipped_by_flag".
# Any non-zero rc or timeout → dispatch status verify_failed, exit 3.
# no_source is not verify_failed.
# The same write_manifest that stamps final_status records compact
# "tip_verify" (the object's status pass|fail|timeout, the string
# no_source|skipped_by_flag, or null when this path never computed one)
# and "tip_verify_source" (flag|brief|repo_config, else null). Source is
# null for no_source, skipped_by_flag, and when tip verify was not computed.
# Command tails stay in the result JSON.

set -uo pipefail

# Test seams: the HETERO_TEST_* knobs below (watchdog / containment fault injection) are
# honoured only when the single test-mode switch is on. Without it any inherited knob is
# dropped here, before it can reach a code path (BL-0099).
if [ "${AUTOPILOT_TEST_ALLOW_HETERO_SEAMS:-}" != "1" ]; then
  unset HETERO_TEST_SYSTEMCTL_KILL_FAIL HETERO_TEST_NO_SETSID HETERO_TEST_NO_JOBCONTROL
fi

# qualified default below (grok-4.7, codex gpt-6.1-terra, agy gemini-4-hydrogen-low, opencode beam-free, cursor/kimi
# broker). Every other runner without a default dies "--model is required". Never default to an expensive seat.
# every other runner without a default die "--model is required". Never default to an expensive seat.
MODEL=""
MODEL_IS_DEFAULT=1
BASE="develop"
TIMEOUT="9m"
IDLE_TIMEOUT="5m"
IDLE_TIMEOUT_SUPPLIED=0
HARD_TIMEOUT=""
HARD_TIMEOUT_SUPPLIED=0
WATCHDOG_IDLE_S=""
WATCHDOG_HARD_S=""
WATCHDOG_SAMPLE_S=""
WATCHDOG_SOFT_S=""
WORKER_TIMEOUT_KIND=""
KILLED_ELAPSED_S=""
KILLED_LAST_PROGRESS_S=""
GATE_RULES_FILE=""     # --gate-rules: per-turn gate rule list for ONE claude-native/cc-shim hand (BL-0306 P2)
GATE_SETTINGS_FILE=""
GATE_ARMED_SESSION=""
ROLE_KIT_DIR=""        # --role-kit: per-role kit dir for ONE claude-native hand (lib/role-kit.sh)
PIN_REASON=""
PIN_REASON_SUPPLIED=0
MODEL_SUPPLIED=0
BASE_SUPPLIED=0
RUNNER_SUPPLIED=0
TIMEOUT_SUPPLIED=0
TIMEOUT_SOURCE=""
WORKER_TIMED_OUT=0
COMMIT_QUIET_SECS=120
COMMIT_QUIET_ENDED=0
AGY_BIN="agy"
GROK_BIN="grok"
CODEX_BIN="codex"    # test seam / explicit pin — resolve a specific codex (PATH ambiguity: a
                     # stale codex earlier in PATH lacks --dangerously-bypass-hook-trust)
# Set only when the matching --*-bin flag was supplied (a value equal to the
# default name is still an explicit override). Read after the parse loop.
BIN_FLAG_AGY=0
BIN_FLAG_GROK=0
BIN_FLAG_PI=0
BIN_FLAG_CODEX=0
BIN_FLAG_CURSOR=0
BIN_FLAG_OPENCODE=0
BIN_FLAG_KIMI=0
BIN_FLAG_QODER=0
QODER_BIN="qoderclicn"  # Qoder CLI CN; explicit --runner qoderclicn only. Test seam: --qoder-bin
QODER_CONFIG_DIR=""     # --qoder-config-dir; empty means the invocation omits --config-dir
MANAGED_CODEX_HOME="" # per-run child home: credentials only, never controller plugins/config
CURSOR_BIN="cursor-agent"  # Cursor CLI runner; test seam via --cursor-bin
OPENCODE_BIN="opencode"    # OpenCode CLI runner (`opencode run`); test seam via --opencode-bin
KIMI_BIN="kimi"            # Local CLI fixture seam only; default Kimi seat uses the broker
KEEP=0
SCRATCH=0
SCRATCH_DIR=""
SCRATCH_WORK_DIR=""
SCRATCH_REJECTED_FILE=""
SCRATCH_FINAL_PROMPT=""
SCRATCH_HOME=""
SCRATCH_CONFIG_DIR=""
WORKER_CWD=""
MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES=()  # --sibling-ref-prefix; read by main_checkout_fingerprint (lib/main-checkout-boundary.sh)
MAIN_CHECKOUT_FP_EXCLUDE_PATHS=()     # --sibling-path-prefix; pruned from the fingerprint's stat walk
# Round scope (fleet 01M788GD): this rail's fingerprint watches the main checkout and this
# round's own refs, not every refs/heads/* in the shared ref store. Foreman leaves it unset.
MAIN_CHECKOUT_FP_REF_SCOPE=round
WRAPPER_COMMITTED=0  # set when the rail's own capture commit is made; gates --expect-wrapper-subject
RETENTION_OWNER=""
RETENTION_REASON=""
RETENTION_REASON_SHA256=""
RETENTION_EXPIRES_AT=""
REUSE_WORKTREE=""
EXPECTED_WORKTREE_INSTANCE=""
RESUME_SESSION_ID=""
PROVIDER_SESSION_ID=""
PROVIDER_SESSION_REUSED=0
WORKTREE_REUSED=0
BRANCH=""
PROMPT_FILE=""
CONTINUATION_CHECKPOINT=""
CONTINUATION_DURABLE=""
CAMPAIGN_CONTRACT_FILE=""
CAMPAIGN_CONTRACT_SHA256=""
CAMPAIGN_SEAL_FILE=""
NO_CAMPAIGN=0
# Set only when enforce admits --no-campaign. Empty otherwise, so the manifest
# and the branch ledger stay byte-identical for every other dispatch.
MISSION_ENFORCEMENT_MODE_SEEN=""
CAMPAIGN_CONTRACT_SNAPSHOT=""
CAMPAIGN_ID=""
MISSION_CAMPAIGN_ID=""
CAMPAIGN_MISSION_MODE=""
MISSION_NOOP_SHORT_CIRCUIT=0
MISSION_NOOP_RECEIPT_DIGEST=""
MISSION_NOOP_GRAPH_NODE=""
CAMPAIGN_STRICT_AUTHORITY=0
CAMPAIGN_PROJECTION_BOUND=0
RUNNER="auto"
PACE_ROLE=""
ENGINE_CHOICE_JSON=""
PACE_CHOICE_JSON=""
ENGINE_PREFLIGHT_JSON=""
EFFORT="xhigh"
EFFORT_EXPLICIT=0
ENDPOINT=""          # optional named endpoint (cc-shim only) → resolve-endpoint.sh
ENDPOINT_SUPPLIED=0
LOCAL_RUNNER=0       # --runner local: public name stays local; the rail is cc-shim
GATEWAY_TOKEN_SOURCE="" # local only: lane-file | endpoint. Never the token bytes.
LOCAL_LEASE_ID="" LOCAL_LEASE_URL="" LOCAL_LEASE_TOKEN_ENV=""
LOCAL_LEASE_STATUS="null" LOCAL_LEASE_GRANTED=0 LOCAL_LEASE_RELEASED=0 LOCAL_LEASE_RELEASE_ATTEMPTED=0 LOCAL_LEASE_DETAIL=""
LOCAL_LEASE_HEARTBEATS=0 LOCAL_LEASE_HEARTBEAT_PID="" LOCAL_LEASE_HEARTBEAT_FILE="" LOCAL_LEASE_HEARTBEAT_SLEEP_FILE=""
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib/repo-identity.sh
# Fail-open: a missing helper only degrades the manifest to repo_identity null (telemetry sidecar).
[ -r "$SELF_DIR/lib/repo-identity.sh" ] && . "$SELF_DIR/lib/repo-identity.sh" || true
# Fail-open: a missing helper only leaves the manifest `lane` null.
[ -r "$SELF_DIR/lib/dispatch-lane.sh" ] && . "$SELF_DIR/lib/dispatch-lane.sh" || true
# G37: the one reading of `claude-account.js env-check` (legacy | active | invalid). Sourced hard (no fail-open):
# a missing copy makes account_layer_state print nothing, and every caller treats anything but legacy/active as invalid.
. "$SELF_DIR/lib/account-state.sh"
# shellcheck source=lib/token-seat.sh
. "$SELF_DIR/lib/token-seat.sh"
# --role-kit: validator wrapper (claude-native only). Sourced hard like account-state.sh.
. "$SELF_DIR/lib/role-kit.sh"
# A TMPDIR that is set but missing is made before anything below uses it (BL-0336); a failure prints its reason and the run carries on.
if declare -F runs_tmpdir_ensure >/dev/null 2>&1; then runs_tmpdir_ensure || true; fi
# Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env (best-effort;
# a rejected/absent file is a no-op and the cc-shim precondition fires normally). Loaded BEFORE
# any endpoint/env consumption. resolution contract stays AUTOPILOT_ENDPOINT_<NAME>_* env vars.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/load-endpoints-env.sh" ] && . "$SELF_DIR/load-endpoints-env.sh" && autopilot_load_endpoints_env || true
# Startup retention prune of OUR OWN aged ${TMPDIR} residue (logs/prompt temps/pi
# sessions — NEVER worktrees; those are lock/marker-gated in worktree-reap.sh /
# dispatch-status.js --reap). Best-effort; AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 disables.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/lib/prune-tmp-residue.sh" ] && . "$SELF_DIR/lib/prune-tmp-residue.sh" \
  && prune_tmp_residue "${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}" \
       'hetero-*-log-*' 'dispatch-hetero-*' 'pi-rpc-session-*' 'hetero-detach-state-*' || true
# Pre-dispatch context-window gate (lib/context-window.sh). Best-effort source: a missing
# helper degrades to "no gate", never to a dispatch outage.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/lib/context-window.sh" ] && . "$SELF_DIR/lib/context-window.sh" || true
# shellcheck source=lib/codeforge-collect.sh
# Best-effort: a missing helper skips usage collect; it never changes the dispatch result.
[ -r "$SELF_DIR/lib/codeforge-collect.sh" ] && . "$SELF_DIR/lib/codeforge-collect.sh" || true
# Collect then delete. Clearing the variable keeps cleanup/abort from collecting twice.
# Defined before the EXIT trap so an early exit can call them.
reap_cnative_config_dir() {
  if [ -n "${CNATIVE_CONFIG_DIR:-}" ]; then
    declare -F codeforge_collect_claude_dir >/dev/null 2>&1 && codeforge_collect_claude_dir "$CNATIVE_CONFIG_DIR" || true
    # Set even when the dir was already gone, so the sandbox reap does not collect a second path.
    _CODEFORGE_CNATIVE_COLLECTED=1
    rm -rf "$CNATIVE_CONFIG_DIR"
    CNATIVE_CONFIG_DIR=""
  fi
  return 0
}
reap_sandbox_config_dir() {
  if [ -n "${SANDBOX_TMP:-}" ]; then
    if [ -s "$SANDBOX_TMP/evidence-notes.md" ] && [ -n "${AUTOPILOT_EVIDENCE_NOTES:-}" ]; then
      cp "$SANDBOX_TMP/evidence-notes.md" "$AUTOPILOT_EVIDENCE_NOTES" || echo "sandbox: failed to copy evidence notes" >&2
    fi
    # Claude-backed runners only. claude-native already collected its seeded dir above.
    if { [ "${IS_CCSHIM:-0}" -eq 1 ] || [ "${IS_CNATIVE:-0}" -eq 1 ]; } && [ -z "${_CODEFORGE_CNATIVE_COLLECTED:-}" ]; then
      declare -F codeforge_collect_claude_dir >/dev/null 2>&1 && codeforge_collect_claude_dir "$SANDBOX_TMP/claude-config" || true
    fi
    rm -rf "$SANDBOX_TMP"
  fi
  SANDBOX_TMP=""
  SANDBOX_ARGV=()
  return 0
}
CONTEXT_WINDOW_GATE=""     # off|warn|block; empty ⇒ AUTOPILOT_CONTEXT_WINDOW_GATE, else block
IS_CODEX=0            # set in runner-selection; init early so emit/die before that are -u-safe
RUNNER_RESOLVED=0     # 1 only after set_runner_flags completes; die_precondition uses this to
                       # distinguish "agy selected" from "resolution never happened" (FINDING 1)
IS_GROK=0
IS_CCSHIM=0           # claude-code CLI pointed at an arbitrary Anthropic-compatible endpoint
IS_PI=0
IS_CNATIVE=0         # claude-native implementer (first-party Claude CLI, native auth) — owner-confirmation gated
IS_QODER=0           # Qoder CLI CN. EXPLICIT only; auto never selects it
CNATIVE_CONFIG_DIR=""  # seeded CLAUDE_CONFIG_DIR (only .credentials.json); removed on every exit path
# G37 W3: account layer state for claude-native. Prints legacy (no registry, or mode off: the seeded
# path below is unchanged) | active (registry present: the worker goes through claude-account.js run and
# the seeded dir is never created) | invalid (registry broken: caller must refuse, nothing is spawned).
# Only the alias metadata is read here; the token never enters this shell.
cnative_account_state() {
  account_layer_state "$SELF_DIR/claude-account.js" hetero-impl
}
PI_BIN="pi"
GROK_PROMPT_FILE=""   # grok-only combined prompt temp; init early so the INT/TERM trap can reap it
PROMPT_SHA256_SEALED="" # sha256 of the exact bytes the selected runner reads; empty until sealed
EFFORT_SENT=""        # final effort actually sent (or "default" when none is); set once before the worker, read by emit/manifest and detach declare -p
QODER_PROMPT_FILE=""  # qoder combined prompt temp; init early so the INT/TERM trap and detach declare -p can reap it
CCSHIM_PROMPT_FILE="" # cc-shim combined prompt temp; same trap-reap rationale
BROKER_TIMEOUT_S=""
BROKER_RESULT=""
BROKER_VERDICT=""
BROKER_REASON=""
BROKER_VERDICT_KIND=""
BROKER_VERDICT_UNKNOWN=""
BROKER_VERDICT_UNKNOWN_SET=0
BROKER_RUNNER=""
OPENCODE_VER=""  # opencode --version line, read once at the pre-spend gate (declare -p carries it to the detached child)
OPENCODE_PROMPT_FILE=""  # opencode combined prompt temp; init early so it is SET for the detach declare -p
KIMI_PROMPT_FILE=""    # kimi combined prompt temp; init early so it is SET for the detach declare -p
REPO_IDENTITY_FIELDS=""   # manifest repo-identity JSON members, cached by repo_identity_resolve_fields; init early so it is SET for the detach declare -p and an ambient value is never copied verbatim (BL-0109)
KIMI_EDIT_ONLY=""       # kimi EDIT-ONLY directive text, computed once at the pre-spend argv
                        # gate and reused verbatim by the run arm; init early for declare -p
                        # (KIMI_ARGV_LIMIT is NOT pre-declared here — it is a user env-override
                        # knob, `${KIMI_ARGV_LIMIT:-120000}`, and only used before any fork; a
                        # top-level empty-string init would clobber an inherited env value.)
CURSOR_FAST=0          # --cursor-fast opt-in (default non-fast); runner-scoped, see usage above
SCAFFOLD_TIER_ARG="auto"      # --scaffold-tier auto|T0|T1|T2 (explicit may only ADD scaffolding)
SCAFFOLD_TIER_EFFECTIVE="off" # recorded in the run manifest
SCAFFOLD_PROMPT_FILE=""       # tier-envelope temp; init early for trap reap
AGY_ENVELOPE=""       # private native JSON stdout; never exposed as agent_log
CCSHIM_ENVELOPE=""    # private claude -p --output-format json stdout; result text is what reaches LOG
SANDBOX="off"          # --sandbox off|bwrap (cc-shim, or the one cloud fallback re-exec)
SANDBOX_SUPPLIED=0
SANDBOX_TMP=""         # bwrap: this dispatch's own writable scratch dir (made by the cc-shim arm, removed after the worker)
# BL-0435: set on the cloud-seat re-exec after a failed endpoint pre-probe. Empty on the first attempt.
FELL_BACK_JSON="${AUTOPILOT_HETERO_FELL_BACK_JSON:-}"
FELL_BACK_LOGGED=0
SANDBOX_ARGV=()        # bwrap: the argv prefix run_worker puts in front of the worker
SANDBOX_DENIED="unknown"  # bwrap: EROFS lines seen in the worker output, else unknown
WORKTREE_PARENT=""     # --worktree-parent: directory the new worktree is created under
PROVIDER_ERROR_RUNNER=""
PROVIDER_ERROR_STATUS=""
PROVIDER_ERROR_FIELD=""
AGY_STDERR=""         # private native stderr, copied to agent_log only on failure
AGY_PARSED=""         # validated derived {response,usage}; native envelope parsed once
AGY_USAGE_JSON="null"
CONTAINMENT="plain"   # plain|setsid|cgroup — set when the worker actually runs
CONTAINED=0           # 1 iff the container was provably reaped empty (setsid-proof only for cgroup)
IDENTITY_DRIFT=0      # 1 iff worker mutated consuming-repo user.name/email via shared .git/config
IDENTITY_PRE_NAME=""  # snapshot of consuming-repo user.name before runner
IDENTITY_PRE_EMAIL="" # snapshot of consuming-repo user.email before runner
IDENTITY_REPO_ROOT="" # host repo root captured at pre-snapshot (for explicit git -C restore)
GITCONFIG_SNAPSHOT_FILE="" # denylist snapshot (lib/gitconfig-containment.sh)
GITCONFIG_DRIFT_KEYS=""    # newline-separated keys the restore put back
SKILL_MODE="off"
SKILLS=()
EFFECTIVE_SKILL_MODE="off"
SKILLS_INJECTED_JSON="[]"
PACKED_PROMPT_TEMP=""
CAMPAIGN_PROMPT_FILE=""
SKILL_PACK_CONTENT_TEMP=""
STRICT_CONTRACT=0
CONTRACT_FILE=""
CONTRACT_FILE_SUPPLIED=0
CONFORMANCE_INTENT_FILE=""
STRICT_CONTRACT_RESULT_FIELDS=0
STRICT_UNIT_ID=""
STRICT_CONTRACT_SHA=""
STRICT_SPEC_SHA=""
STRICT_GO=""
STRICT_ENGINE_ASSURANCE=""
STRICT_SCOPE_ALLOW_PATHS=()
STRICT_SCOPE_DENY_PATHS=()
STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS=()
STRICT_SCOPE_MAX_FILES=""
STRICT_SCOPE_MAX_DIFF_LINES=""
STRICT_OUTPUT_PATHS=()
STRICT_REQUIRED_CHANGE_PATHS=()
STRICT_POSTCHECK_OK=0
STRICT_POSTCHECK_STATUS=""
STRICT_POSTCHECK_ERROR=""
# Tip verification (default on). Arrays exist before detach's declare -p.
NO_VERIFY_TIP=0
VERIFY_TIMEOUT=1800
VERIFY_CMDS=()
TIP_VERIFY_SKIP=0
TIP_VERIFY_SOURCE=""
TIP_VERIFY_CMDS_JSON=""
TIP_VERIFY_RESULT_JSON=""
# ORPHAN_LOG must be set BEFORE the INT/TERM trap is armed (round-2 MiniMax §2f) so a
# trap firing mid-run appends to a real path instead of an undefined one. Keep the
# predictable log and lock inside a private per-user directory: shared /tmp names
# let another user deny service or redirect either path before startup.
ORPHAN_STATE_DIR="${AUTOPILOT_ORPHAN_STATE_DIR:-${TMPDIR:-/tmp}/autopilot-${UID:-$(id -u)}}"
_init_orphan_state_dir() {
  local dir="$1" mode
  if [ -e "$dir" ] || [ -L "$dir" ]; then
    [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  else
    # Two first-ever dispatches can both see "absent"; the loser's mkdir fails with EEXIST. That is not unsafe: re-check the
    # directory the winner made against the same rules (real dir, ours, mode 700) instead of refusing to start.
    { (umask 077; mkdir "$dir" 2>/dev/null) || [ -d "$dir" ]; } && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  fi
  mode="$(stat -c '%a' "$dir" 2>/dev/null || stat -f '%Lp' "$dir" 2>/dev/null)" || return 1
  case "$mode" in 700|0700) ;; *) return 1 ;; esac
}
if ! _init_orphan_state_dir "$ORPHAN_STATE_DIR"; then
  printf 'ERROR: unsafe orphan state directory: %s\n' "$ORPHAN_STATE_DIR" >&2
  exit 2
fi
ORPHAN_LOG="$ORPHAN_STATE_DIR/autopilot-orphan-worktrees.log"

# --- dispatch-observability Stage 1 (run manifest; ALL ADDITIVE) ---
# A START-time manifest under $MANIFEST_DIR_PATH names this run's identity (run_id,
# log path, worktree, lock, predicted containment) so depth-0 / dispatch-status.js can
# locate and liveness-probe the run MID-FLIGHT instead of waiting for the final JSON.
# Best-effort sidecar: a manifest write failure NEVER fails the dispatch. Disable with
# AUTOPILOT_DISPATCH_MANIFEST=0 (legacy byte-identical escape hatch, minus the new
# final-JSON fields). Telemetry only — no verdict/status semantics change.
# BL-0336: the directory comes from scripts/lib/runtime-paths.js (made when absent). Empty = unusable (reason already printed): no manifest.
MANIFEST_DIR_PATH=""
if [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" != "0" ] && declare -F runs_dir_ensure >/dev/null 2>&1 && runs_dir_ensure; then MANIFEST_DIR_PATH="$RUNS_DIR_ENSURED"; fi
DISPATCH_RUN_ID=""
DISPATCH_STARTED_EPOCH=""
MANIFEST_FILE=""
MANIFEST_CONTAINMENT="plain"
MANIFEST_SCOPE_UNIT=""
MANIFEST_MOUNT_CONTAINMENT=""   # private_ns|sudo_private_ns|no_root|refused (01M7E4JC); set where the manifest is first written
MANIFEST_PID_RECORDED=""
MANIFEST_ENDED_AT=""
MANIFEST_ENDED_EPOCH=""
MANIFEST_FINAL_STATUS=""
OUTCOME_ORPHAN=""     # non-empty path when worktree remove failed and dir remains
WT_LOCK_FD=""         # dedicated fd holding exclusive lifetime flock on the worktree lock
WT_BUDGET_LOCK_FD=""  # common-dir creation transaction lock (managed lineage only)
WT_PENDING_RECORD=""  # crash-recovery record published before git worktree add
# --- R1 detach / durable-result plumbing (all OPTIONAL; absent ⇒ byte-identical legacy behavior) ---
# When --ledger/--run-id/--stage are ALL supplied AND detach is on (DISPATCH_DETACH!=0, the
# default), the long-running engine worker is run inside a `setsid` session that SURVIVES the
# caller (the wrapper / 900s-capped bash tool) being killed. That detached session heartbeats to
# the R0 ledger, writes its final outcome JSON atomically to a deterministic result path, and
# records the committed stage — so a killed caller loses no work (recover via run-ledger resume).
# When any coord is absent OR DISPATCH_DETACH=0, NONE of this engages: the inline path below runs
# exactly as it did before R1 (proven byte-identical by the detach test + existing hetero tests).
LEDGER=""
RUN_ID=""
STAGE=""
RESULTS_DIR=""
RESULT_FILE=""
RC_ALARM_LABEL="${AUTOPILOT_RC_ALARM_LABEL:-}"
RC_ALARM_OWNER="${AUTOPILOT_RC_ALARM_OWNER:-}"
EXIT_FILE=""
HEARTBEAT_SECS="${DISPATCH_HEARTBEAT_SECS:-20}"
DETACH_PRECLAIM_GEN=""
DETACH_PRECLAIM_NONCE=""
OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT=""; OUTCOME_ERR=""; OUTCOME_EXIT=1
TARGET_PRECOMMIT_STATUS="skipped"
TARGET_PRECOMMIT_HOOK=""
TARGET_PRECOMMIT_RC=""
TARGET_PRECOMMIT_TAIL="no new commits"
OUTCOME_DISPATCHER_CALLED=1
OUTCOME_MODEL_CALLS=1
OUTCOME_MUTATION_ATTEMPTS=1
OUTCOME_GATE_ATTEMPTS=0
OUTCOME_RESOURCES_CREATED=0
OUTCOME_ZERO_DIFF_RECEIPT_DIGEST=""
CLASSIFIED_ERROR=""   # set by passive_capture (classify-error once per outcome); read by classify_outcome
# FINDING 6 fix (2026-08-22 review repair): AUTOPILOT_STRIKE_WRITER=off is a debug
# escape hatch that suppresses seat_strike_capture's write. Left silent, a suppressed
# strike is indistinguishable from "nothing was strike-eligible" — the exact
# "existing is not evidence it is running" failure family (CLAUDE.md /
# evidence-discipline.md §1). These two vars are set ONLY when a strike WOULD have
# been written and the hatch suppressed it; write_manifest emits them into the
# manifest sidecar (never into this script's own stdout/exit code) so a suppressed
# strike is visible in the run's artifacts. Empty/unset = not suppressed = no
# marker in the manifest at all (default-on behavior stays byte-identical).
STRIKE_WRITER_SUPPRESSED=""
STRIKE_WRITER_SUPPRESSED_SEAT=""
# shellcheck source=/dev/null
. "$SELF_DIR/lib/worktree-reap.sh"
# When dispatch_new claims a Work Order, terminal finalizer must fail closed (never swallow).
_CONT_WO_CLAIMED_ROOT=""
_CONT_WO_CLAIMED_STAGE="implement"
_CONT_WO_PARENT_TRANSFERRED=0
_cont_terminal_on_exit() {
  local _root="${_CONT_WO_CLAIMED_ROOT:-}"
  [ -n "$_root" ] || return 0
  local _status=failed
  # Prefer recorded outcome; committed/success only when outcome says so.
  if [ -n "${OUTCOME_STATUS:-}" ]; then
    case "$OUTCOME_STATUS" in
      success|ok|attached|consumed|committed) _status=success ;;
      *) _status=failed ;;
    esac
  elif [ "${OUTCOME_EXIT:-1}" = "0" ]; then
    _status=success
  fi
  local _term_out _term_st _term_rc _cwd
  _cwd="$(pwd 2>/dev/null || echo .)"
  _term_out="$(node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$_cwd" \
    --root-run-id "$_root" --graph-node "${_CONT_WO_CLAIMED_STAGE:-implement}" --attempt 1 \
    --owner-pid "$$" --runner self --terminal-status "$_status" --disposition consumed 2>/dev/null)" || {
    echo "dispatch-hetero: work order terminal finalizer failed closed for root=$_root" >&2
    return 1
  }
  _term_st="$(printf '%s' "$_term_out" | jq -r '.status // empty' 2>/dev/null || true)"
  if [ "$_term_st" = "written" ]; then return 0; fi
  _term_rc="$(printf '%s' "$_term_out" | jq -r '.reason_code // empty' 2>/dev/null || true)"
  if [ "$_term_st" = "reject" ] && [ "$_term_rc" = "not_found" ]; then return 0; fi
  echo "dispatch-hetero: work order terminal finalizer rejected: ${_term_rc:-$_term_st}" >&2
  return 1
}
# Inline/detached success path: finalize WO before emit; clear claim so EXIT does not re-run.
_cont_finalize_or_die() {
  [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ] || return 0
  if ! _cont_terminal_on_exit; then
    echo "dispatch-hetero: refusing success JSON with nonterminal work order" >&2
    return 1
  fi
  _CONT_WO_CLAIMED_ROOT=""
  return 0
}
cleanup() {
  trap - EXIT
  release_local_lease || true
  [ "${LOCAL_LEASE_GRANTED:-0}" -eq 1 ] && write_manifest "$$" 2>/dev/null || true
  [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
  [ -n "${CAMPAIGN_PROMPT_FILE:-}" ] && rm -f "$CAMPAIGN_PROMPT_FILE"
  [ -n "${_ep_prompt_tmp:-}" ] && rm -f "$_ep_prompt_tmp"
  [ -n "${CAMPAIGN_CONTRACT_SNAPSHOT:-}" ] && rm -f "$CAMPAIGN_CONTRACT_SNAPSHOT"
  [ -n "${SKILL_PACK_CONTENT_TEMP:-}" ] && rm -f "$SKILL_PACK_CONTENT_TEMP"
  [ -n "${AGY_ENVELOPE:-}" ] && rm -f "$AGY_ENVELOPE"
  [ -n "${AGY_STDERR:-}" ] && rm -f "$AGY_STDERR"
  [ -n "${AGY_PARSED:-}" ] && rm -f "$AGY_PARSED"
  [ -n "${CCSHIM_ENVELOPE:-}" ] && rm -f "$CCSHIM_ENVELOPE"
  [ -n "${SCRATCH_DIR:-}" ] && rm -rf -- "$SCRATCH_DIR"
  declare -F _reap_ccshim_env_dir >/dev/null 2>&1 && _reap_ccshim_env_dir
  reap_cnative_config_dir || true
  [ -n "${SCRATCH_CONFIG_DIR:-}" ] && rm -rf -- "$SCRATCH_CONFIG_DIR"
  [ -n "${SCRATCH_HOME:-}" ] && rm -rf -- "$SCRATCH_HOME"
  reap_sandbox_config_dir || true
  [ -n "${GATE_ARMED_SESSION:-}" ] && node "$SELF_DIR/per-turn-gate-arm.js" disarm --session "$GATE_ARMED_SESSION" >/dev/null 2>&1
  [ -n "${GATE_SETTINGS_FILE:-}" ] && rm -f "$GATE_SETTINGS_FILE"
  [ -n "${LOCAL_LEASE_HEARTBEAT_FILE:-}" ] && rm -f "$LOCAL_LEASE_HEARTBEAT_FILE"
  # Fail closed: claimed WO must get a terminal disposition; never swallow finalizer failures.
  # Parent that transferred claim to detached child must not mark WO failed on its EXIT.
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ] && [ "${_CONT_WO_PARENT_TRANSFERRED:-0}" != "1" ]; then
    if ! _cont_terminal_on_exit; then
      echo "dispatch-hetero: terminal finalizer failed closed on exit" >&2
      exit 1
    fi
    _CONT_WO_CLAIMED_ROOT=""
  fi
}
trap cleanup EXIT

local_lease_json() {
  local granted=false released=false id=null detail=null
  [ "$LOCAL_LEASE_GRANTED" -eq 1 ] && granted=true
  [ "$LOCAL_LEASE_RELEASED" -eq 1 ] && released=true
  [ -z "$LOCAL_LEASE_ID" ] || id="\"$(_flat_json_escape "$LOCAL_LEASE_ID")\""
  [ -z "$LOCAL_LEASE_DETAIL" ] || detail="\"$(_flat_json_escape "$LOCAL_LEASE_DETAIL")\""
  if [ -n "$LOCAL_LEASE_HEARTBEAT_FILE" ] && [ -f "$LOCAL_LEASE_HEARTBEAT_FILE" ]; then
    LOCAL_LEASE_HEARTBEATS="$(awk '$0=="." {n++} END {print n+0}' "$LOCAL_LEASE_HEARTBEAT_FILE" 2>/dev/null)"
    LOCAL_LEASE_HEARTBEATS="${LOCAL_LEASE_HEARTBEATS:-0}"
    if [ -z "$LOCAL_LEASE_DETAIL" ] && grep -q '^missed$' "$LOCAL_LEASE_HEARTBEAT_FILE" 2>/dev/null; then
      LOCAL_LEASE_DETAIL="heartbeat_missed"
    fi
  fi
  printf '{"id":%s,"granted":%s,"status":%s,"heartbeats":%s,"released":%s,"detail":%s}' "$id" "$granted" "$LOCAL_LEASE_STATUS" "$LOCAL_LEASE_HEARTBEATS" "$released" "$detail"
}

local_lease_heartbeat_loop() {
  local interval="${AUTOPILOT_LOCAL_LEASE_TTL_S:-180}"
  interval=$((interval / 3)); [ "$interval" -gt 0 ] || interval=1
  while :; do
    sleep "$interval" &
    local sleep_pid=$!
    printf '%s\n' "$sleep_pid" > "$LOCAL_LEASE_HEARTBEAT_SLEEP_FILE"
    wait "$sleep_pid" || break
    if node "$SELF_DIR/lib/local-impl-slot.js" --lease-operation heartbeat --lease-url "$LOCAL_LEASE_URL" --lease-id "$LOCAL_LEASE_ID" --token-env "$LOCAL_LEASE_TOKEN_ENV" >/dev/null 2>&1; then
      printf '.\n' >> "$LOCAL_LEASE_HEARTBEAT_FILE"
    else
      printf 'missed\n' >> "$LOCAL_LEASE_HEARTBEAT_FILE"
    fi
  done
}

release_local_lease() {
  [ "$LOCAL_LEASE_GRANTED" -eq 1 ] || return 0
  local sleep_pid=""
  if [ -r "$LOCAL_LEASE_HEARTBEAT_SLEEP_FILE" ]; then
    IFS= read -r sleep_pid < "$LOCAL_LEASE_HEARTBEAT_SLEEP_FILE" || true
    if [[ "$sleep_pid" =~ ^[0-9]+$ ]] && kill -0 "$sleep_pid" 2>/dev/null && [ "$(cat "/proc/$sleep_pid/comm" 2>/dev/null)" = "sleep" ]; then
      kill "$sleep_pid" 2>/dev/null || true
    fi
  fi
  if [ -n "$LOCAL_LEASE_HEARTBEAT_PID" ]; then
    kill "$LOCAL_LEASE_HEARTBEAT_PID" 2>/dev/null || true
    wait "$LOCAL_LEASE_HEARTBEAT_PID" 2>/dev/null || true
    LOCAL_LEASE_HEARTBEAT_PID=""
  fi
  rm -f -- "$LOCAL_LEASE_HEARTBEAT_SLEEP_FILE"
  if [ "$LOCAL_LEASE_RELEASE_ATTEMPTED" -eq 0 ]; then
    LOCAL_LEASE_RELEASE_ATTEMPTED=1
    if node "$SELF_DIR/lib/local-impl-slot.js" --lease-operation release --lease-url "$LOCAL_LEASE_URL" --lease-id "$LOCAL_LEASE_ID" --token-env "$LOCAL_LEASE_TOKEN_ENV" >/dev/null 2>&1; then
      LOCAL_LEASE_RELEASED=1
    else
      LOCAL_LEASE_DETAIL="release_failed"
    fi
  fi
  return 0
}

usage() { awk 'NR>1 { if ($0 !~ /^#/) exit; print }' "$0" | sed 's/^# \{0,1\}//'; }

# shellcheck source=lib/json-emit.sh
. "$SELF_DIR/lib/json-emit.sh"
# shellcheck source=lib/gitconfig-containment.sh
. "$SELF_DIR/lib/gitconfig-containment.sh"
# shellcheck source=lib/dispatch-branch-ledger.sh
. "$SELF_DIR/lib/dispatch-branch-ledger.sh"
# shellcheck source=lib/worktree-intent.sh
. "$SELF_DIR/lib/worktree-intent.sh"
# shellcheck source=lib/grok-effort.sh
. "$SELF_DIR/lib/grok-effort.sh"
# shellcheck source=lib/cursor-model.sh
. "$SELF_DIR/lib/cursor-model.sh"
# shellcheck source=lib/agy-model-alias.sh
. "$SELF_DIR/lib/agy-model-alias.sh"
# shellcheck source=lib/agy-timeout.sh
. "$SELF_DIR/lib/agy-timeout.sh"
# shellcheck source=lib/runner-fallback-bin.sh
. "$SELF_DIR/lib/runner-fallback-bin.sh"
# shellcheck source=lib/local-sandbox-endpoint.sh
. "$SELF_DIR/lib/local-sandbox-endpoint.sh"

# agy_edit_only_directive <worktree> — the harness directive prepended to every agy task
# prompt. A FUNCTION, not an inline string, because the argv-ceiling guard has to measure the
# exact bytes that will be exec'd and it runs before the worktree exists; a second copy of
# this text would let the guard measure something the dispatch does not actually send.
agy_edit_only_directive() {
  local WT="$1"
  printf '%s' "=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Your ABSOLUTE working directory is: $WT
Every file path in the task below resolves UNDER this directory. Convert every relative
path to absolute by prefixing it with '$WT/', and read/write ONLY absolute paths under
'$WT'. The files to edit ALREADY EXIST there. NEVER create a project, NEVER use a scratch
directory, NEVER use ~/.gemini, NEVER initialise a new git repo — edit the existing files
in place at '$WT'. (agy -p does not honor the process cwd, so this absolute anchor is the
only thing that points your edits at the real worktree instead of an invented scratch dir.)

You run in ONE non-interactive turn and you CANNOT wait for any background task. Therefore
do NOT use run_command / the shell AT ALL — no search, grep, find, ls, cat, install, build,
test, lint, or git. ANY shell command is moved to the background and your turn ends before
your edits are saved (that is the #1 cause of lost work here). Use ONLY your file read/edit
tools, on the exact paths named in the task. Make all file edits, then stop. The harness
commits your edits and a separate review verifies them — ignore any instruction below to
run build/test or to commit.
===

"
}

# Class A: flatten newlines before shared RFC escape (flatten stays VISIBLE here).
_flat_json_escape() { json_escape "$(printf '%s' "$1" | tr '\n' ' ')"; }

extract_json_value() {
  local key="" json=""
  if [ "$#" -eq 1 ]; then
    key="$1"
    json="$(cat)"
  else
    json="${1-}"
    key="${2-}"
  fi
  [ -n "$json" ] || return 1
  printf '%s' "$json" | node -e '
const fs = require("fs");
const key = process.argv[1];
const raw = fs.readFileSync(0, "utf8").trim();
let data;
try { data = JSON.parse(raw); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$key"
}

extract_last_json() {
  node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
for (let i = lines.length - 1; i >= 0; i--) {
  const line = String(lines[i] || "").trim();
  if (!line) continue;
  try {
    JSON.parse(line);
    process.stdout.write(line);
    process.exit(0);
  } catch (e) {}
}
process.exit(1);
'
}

extract_file_json_value() {
  local path="$1" key="$2"
  node -e '
const fs = require("fs");
const path = process.argv[1];
const key = process.argv[2];
let data;
try { data = JSON.parse(fs.readFileSync(path, "utf8")); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$path" "$key"
}

read_contract_array_lines() { # $1=contract-json $2=dot-path
  local contract_path="$1" dot_path="$2"
  node -e '
const fs = require("fs");
const contractPath = process.argv[1];
const dotPath = process.argv[2];
const parts = String(dotPath || "").split(".").filter(Boolean);
let data;
try {
  data = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (e) {
  process.exit(1);
}
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(0);
  }
  cur = cur[part];
}
if (!Array.isArray(cur)) process.exit(0);
for (const value of cur) {
  if (typeof value === "string") {
    console.log(value);
  }
}
' "$contract_path" "$dot_path"
}

json_array_to_lines() {
  local json=""
  if [ "$#" -ge 1 ]; then
    json="$1"
  else
    json="$(cat)"
  fi
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let values;
try {
  values = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}
if (!Array.isArray(values)) process.exit(0);
for (const value of values) {
  if (typeof value === "string") {
    console.log(value);
  }
}'
 <<< "$json"
}

json_array_first() {
  local json=""
  if [ "$#" -ge 1 ]; then
    json="$1"
  else
    json="$(cat)"
  fi
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let values;
try {
  values = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}
if (!Array.isArray(values) || values.length === 0) process.exit(0);
const value = values[0];
if (typeof value === "string") {
  process.stdout.write(value);
} else if (value !== undefined && value !== null) {
  process.stdout.write(String(value));
}
' <<< "$json"
}

normalize_timeout_seconds() {
  node -e '
const v = String(process.argv[1] || "").trim().toLowerCase();
if (!v) process.exit(1);
if (/^\d+$/.test(v)) {
  process.stdout.write(String(parseInt(v, 10)));
  process.exit(0);
}
if (/^\d+\s*s$/.test(v)) {
  process.stdout.write(String(parseInt(v.slice(0, -1), 10)));
  process.exit(0);
}
if (/^\d+\s*m$/.test(v)) {
  const m = parseInt(v, 10);
  process.stdout.write(String(m * 60));
  process.exit(0);
}
process.exit(2);
' "$1"
}

emit() { # status commit files ins del worktree error
  # Identity containment rail (shared emit path — every outcome): compare post-run
  # consuming-repo user.name/email to the pre-run snapshot; restore + flag on drift.
  # A bare `git config user.*` inside a worktree writes through the shared .git/config.
  # Always use git -C "$IDENTITY_REPO_ROOT" so restore does not depend on dispatcher cwd.
  if [ -n "${IDENTITY_REPO_ROOT:-}" ]; then
    local post_name post_email
    # --local: shared .git/config is local scope; empty pre restores inheritance via --unset.
    post_name="$(git -C "$IDENTITY_REPO_ROOT" config --local user.name 2>/dev/null || true)"
    post_email="$(git -C "$IDENTITY_REPO_ROOT" config --local user.email 2>/dev/null || true)"
    if [ "$post_name" != "$IDENTITY_PRE_NAME" ] || [ "$post_email" != "$IDENTITY_PRE_EMAIL" ]; then
      IDENTITY_DRIFT=1
      # Explicit if/else — never fall through to --unset when a non-empty set fails.
      if [ -n "$IDENTITY_PRE_NAME" ]; then
        git -C "$IDENTITY_REPO_ROOT" config --local user.name "$IDENTITY_PRE_NAME" \
          || echo "WARNING: identity restore failed — could not set local user.name" >&2
      else
        git -C "$IDENTITY_REPO_ROOT" config --local --unset user.name 2>/dev/null || true
      fi
      if [ -n "$IDENTITY_PRE_EMAIL" ]; then
        git -C "$IDENTITY_REPO_ROOT" config --local user.email "$IDENTITY_PRE_EMAIL" \
          || echo "WARNING: identity restore failed — could not set local user.email" >&2
      else
        git -C "$IDENTITY_REPO_ROOT" config --local --unset user.email 2>/dev/null || true
      fi
      echo "WARNING: identity drift detected — worker changed the consuming repo's git identity; restored the original values" >&2
    fi
    # Denylist rail (hooksPath, credential.*, remote urls, …). Same shared .git/config.
    # Re-source so a detached child, which serializes emit but not every helper, still has it.
    # shellcheck source=lib/gitconfig-containment.sh
    [ -r "$SELF_DIR/lib/gitconfig-containment.sh" ] && . "$SELF_DIR/lib/gitconfig-containment.sh"
    if [ -n "${GITCONFIG_SNAPSHOT_FILE:-}" ] && [ -f "${GITCONFIG_SNAPSHOT_FILE:-}" ]; then
      local gc_keys="" gc_oneline="" gc_rc=0
      gc_keys="$(gitconfig_containment_restore "$IDENTITY_REPO_ROOT" "$GITCONFIG_SNAPSHOT_FILE")" || gc_rc=$?
      rm -f -- "$GITCONFIG_SNAPSHOT_FILE"
      GITCONFIG_SNAPSHOT_FILE=""
      if [ "$gc_rc" -ne 0 ]; then
        GITCONFIG_RESTORE_FAILED=1
      fi
      if [ -n "$gc_keys" ]; then
        GITCONFIG_DRIFT_KEYS="$gc_keys"
        if [ "$gc_rc" -eq 0 ]; then
          gc_oneline="${gc_keys//$'\n'/ }"
          echo "WARNING: git config drift detected — worker changed: ${gc_oneline}; restored the original values" >&2
        fi
      fi
    fi
  fi
  local commit_json="null" wt_json="null" err_json="null" orphan_json="null"
  local provider_session_json="null" provider_reused_json="false" worktree_reused_json="false"
  local retention_lease_json="null"
  [ -n "${2:-}" ] && commit_json="\"$2\""
  [ -n "${6:-}" ] && wt_json="\"$(_flat_json_escape "$6")\""
  [ -n "${7:-}" ] && err_json="\"$(_flat_json_escape "$7")\""
  [ -n "${OUTCOME_ORPHAN:-}" ] && orphan_json="\"$(_flat_json_escape "$OUTCOME_ORPHAN")\""
  [ -n "${PROVIDER_SESSION_ID:-}" ] \
    && provider_session_json="\"$(_flat_json_escape "$PROVIDER_SESSION_ID")\""
  [ "${PROVIDER_SESSION_REUSED:-0}" -eq 1 ] && provider_reused_json="true"
  [ "${WORKTREE_REUSED:-0}" -eq 1 ] && worktree_reused_json="true"
  if [ -n "${RETENTION_OWNER:-}" ] \
    && [[ "${RETENTION_REASON_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "${RETENTION_EXPIRES_AT:-}" =~ ^[1-9][0-9]*$ ]]; then
    retention_lease_json="$(printf \
      '{"owner":"%s","reason_sha256":"%s","expires_at":%s}' \
      "$(_flat_json_escape "$RETENTION_OWNER")" \
      "$RETENTION_REASON_SHA256" "$RETENTION_EXPIRES_AT")"
  fi
  local strict_unit_json="null" strict_contract_sha_json="null" strict_spec_sha_json="null" strict_go_json="null"
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    [ -n "${STRICT_UNIT_ID:-}" ] && strict_unit_json="\"$(_flat_json_escape "$STRICT_UNIT_ID")\""
    [ -n "${STRICT_CONTRACT_SHA:-}" ] && strict_contract_sha_json="\"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\""
    [ -n "${STRICT_SPEC_SHA:-}" ] && strict_spec_sha_json="\"$(_flat_json_escape "$STRICT_SPEC_SHA")\""
    [ -n "${STRICT_GO:-}" ] && strict_go_json="\"$(_flat_json_escape "$STRICT_GO")\""
  fi
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && runner="claude-native"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && runner="local"
  local contained_json="false"; [ "${CONTAINED:-0}" -eq 1 ] && contained_json="true"
  # --- observability fields (ADDITIVE; consumers tolerate unknown fields — implementer.js
  # validates required-field presence, not a closed set). usage is parsed from the HARNESS
  # event stream in $LOG by dispatch-status.js (--usage-only prints ONE line: an object or
  # `null`, never fails) — NOT worker self-report. Any parse/node failure ⇒ null.
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local usage_json="null" ledger_usage_json="" num_turns_json="null"
  if [ "${AGENT_EXIT:-1}" -eq 0 ] && [ -n "${LOG:-}" ] && [ -r "${LOG:-/nonexistent}" ] \
     && [ -r "$SELF_DIR/dispatch-status.js" ] && command -v node >/dev/null 2>&1; then
    # Format is DECLARED by runner (this script knows its own invocation flags: codex =
    # chrome text, grok = --output-format json, agy = response-only plain log with a
    # separately validated native envelope, cc-shim = plain) — never content-
    # sniffed, so a worker printing JSON/fake-chrome cannot self-report telemetry.
    # AGENT_EXIT==0 gate: on a clean exit the harness footer always owns the log tail,
    # so the parser's tail-anchored token read cannot be spoofed; on an abnormal exit
    # the tail is worker-controlled → usage stays null (honest, not fabricated).
    if [ "${IS_CODEX:-0}" -eq 0 ] && [ "${IS_GROK:-0}" -eq 0 ] \
       && [ "${IS_CCSHIM:-0}" -eq 0 ] && [ "${IS_PI:-0}" -eq 0 ] \
       && [ "${IS_CURSOR:-0}" -eq 0 ] \
       && [ "${IS_OPENCODE:-0}" -eq 0 ] && [ "${IS_KIMI:-0}" -eq 0 ] && [ "${IS_QODER:-0}" -eq 0 ] && [ "${IS_CNATIVE:-0}" -eq 0 ]; then
      usage_json="${AGY_USAGE_JSON:-null}"
    elif [ "${IS_CCSHIM:-0}" -eq 1 ]; then
      # cc-shim: $LOG is plain text with no token counts. $CCSHIM_ENVELOPE is the
      # harness-written envelope — the claude CLI's `--output-format json` stdout
      # captured by THIS script, unreachable from the worker — so its `usage` is the
      # CLI's own count, not worker self-report. Only ONE JSON object with
      # type=="result" and an object `usage` yields a value (four keys, each a
      # non-negative integer, 0 when missing or non-integer); no file, bad JSON, a
      # second document, a wrong type or a missing usage object all keep it null.
      # Two lines: (1) the result-JSON usage (missing keys 0, unchanged contract), (2) the ledger usage
      # (missing keys null: unknown is null, never guessed), handed to the writer via --usage-json.
      local _ccs_out
      _ccs_out="$(node - "${CCSHIM_ENVELOPE:-}" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
let raw;
try { raw = fs.readFileSync(p, 'utf8'); } catch { console.log('null\nnull'); process.exit(0); }
let doc;
try { doc = JSON.parse(raw); } catch { console.log('null\nnull'); process.exit(0); }
if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.type !== 'result') {
  console.log('null\nnull'); process.exit(0);
}
const u = doc.usage;
if (!u || typeof u !== 'object' || Array.isArray(u)) { console.log('null\nnull'); process.exit(0); }
const keys = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const pick = (k, miss) => (Number.isInteger(u[k]) && u[k] >= 0 ? u[k] : miss);
const zero = {}; const raw0 = {};
for (const k of keys) { zero[k] = pick(k, 0); raw0[k] = pick(k, null); }
console.log(JSON.stringify(zero));
console.log(JSON.stringify(raw0));
NODE
)" || _ccs_out="null"
      usage_json="$(printf '%s\n' "$_ccs_out" | sed -n 1p)"
      ledger_usage_json="$(printf '%s\n' "$_ccs_out" | sed -n 2p)"
    else
      local log_format="plain"
      [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
      [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
      [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
      usage_json="$(node "$SELF_DIR/dispatch-status.js" --log "$LOG" --format "$log_format" --usage-only 2>/dev/null)" || usage_json="null"
    fi
    case "$usage_json" in
      '{'*'}') ;;   # single-line JSON object — accepted
      *) usage_json="null"; ledger_usage_json="" ;;
    esac
    # num_turns for the two `claude -p --output-format json` runners (cc-shim,
    # claude-native): the CLI's own count, read from the HARNESS-owned envelope
    # $CCSHIM_ENVELOPE — same trust boundary as the cc-shim usage read above
    # (captured by this script, unreachable from the worker). Missing file, bad
    # JSON, a non-result document or a non-integer num_turns all keep it null.
    # claude-native's usage stays on its plain-log channel above; only num_turns
    # comes from the envelope here.
    if [ "${IS_CCSHIM:-0}" -eq 1 ] || [ "${IS_CNATIVE:-0}" -eq 1 ]; then
      num_turns_json="$(node - "${CCSHIM_ENVELOPE:-}" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
let doc;
try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { process.stdout.write('null'); process.exit(0); }
if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.type !== 'result') { process.stdout.write('null'); process.exit(0); }
const t = doc.num_turns;
process.stdout.write(Number.isInteger(t) && t >= 0 ? String(t) : 'null');
NODE
      )" || num_turns_json="null"
      case "$num_turns_json" in
        ''|*[!0-9]*) num_turns_json="null" ;;
      esac
    fi
  fi
  local wall_json="null"
  [ -n "${DISPATCH_STARTED_EPOCH:-}" ] && wall_json="$(( $(date +%s) - DISPATCH_STARTED_EPOCH ))"
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  local strict_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    strict_fields=", \"unit_id\": $strict_unit_json, \"contract_sha256\": $strict_contract_sha_json, \"spec_sha256\": $strict_spec_sha_json, \"go\": $strict_go_json"
    if [ -n "${STRICT_ENGINE_ASSURANCE:-}" ]; then
      strict_fields+=", \"engine_assurance\": \"$(_flat_json_escape "$STRICT_ENGINE_ASSURANCE")\""
    fi
  fi
  local campaign_fields=""
  if [ "${CAMPAIGN_PROJECTION_BOUND:-0}" -eq 1 ]; then
    campaign_fields=", \"campaign_contract_sha256\": \"$(_flat_json_escape "$CAMPAIGN_CONTRACT_SHA256")\", \"unit_contract_sha256\": \"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\""
  fi
  local strict_boundary_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ] && [ "$1" = "committed" ] && [ "${STRICT_POSTCHECK_OK:-0}" -eq 1 ]; then
    strict_boundary_fields=', "boundary": "ok", "acceptance": "ok"'
  fi
  # First-class boundary_rejected outcome: parseable reason + candidate ref, never
  # collapsed into unknown/mutation_failed. Possibly-effectful tips stay attached.
  local boundary_reject_fields=""
  if [ "$1" = "boundary_rejected" ]; then
    local boundary_reason_json="null" boundary_code_json="\"scope_or_budget_boundary\""
    local possibly_effectful_json="false"
    [ -n "${7:-}" ] && boundary_reason_json="\"$(_flat_json_escape "$7")\""
    [ -n "${2:-}" ] && possibly_effectful_json="true"
    if [ -n "${HANDS_BOUNDARY_CODE:-}" ]; then
      # Structured code from the hands gates. The substring scan below reads the whole error
      # text, which carries filenames the worker chose (round 5, 2026-09-13).
      boundary_code_json="\"${HANDS_BOUNDARY_CODE}\""
    else
    case "${7:-}" in
      *'outside sealed output surface'*) boundary_code_json="\"unauthorized_output_path\"" ;;
      *'missing from changed files'*) boundary_code_json="\"required_output_missing\"" ;;
      *'violates scope'*) boundary_code_json="\"scope_violation\"" ;;
      *'budget exceeded'*) boundary_code_json="\"budget_exceeded\"" ;;
      *'missing scope allow'*) boundary_code_json="\"scope_misconfigured\"" ;;
    esac
    fi
    boundary_reject_fields="$(printf \
      ', "boundary": "rejected", "boundary_code": %s, "boundary_reason": %s, "candidate_ref": %s, "possibly_effectful": %s, "mutation_failed": false, "unknown_status": false' \
      "$boundary_code_json" "$boundary_reason_json" "$commit_json" "$possibly_effectful_json")"
  fi
  # ADDITIVE identity_drift — only when the rail detected a mutation (clean runs omit the key).
  local identity_fields=""
  if [ "${IDENTITY_DRIFT:-0}" -eq 1 ]; then
    identity_fields=', "identity_drift": true'
  fi
  if [ -n "${GITCONFIG_DRIFT_KEYS:-}" ]; then
    local gc_json="" gc_line="" gc_first=1
    while IFS= read -r gc_line; do
      [ -n "$gc_line" ] || continue
      if [ "$gc_first" -eq 1 ]; then gc_first=0; else gc_json="$gc_json, "; fi
      gc_json="$gc_json\"$(json_escape "$gc_line")\""
    done <<< "${GITCONFIG_DRIFT_KEYS}"
    identity_fields="${identity_fields}, \"gitconfig_drift\": [${gc_json}]"
  fi
  if [ "${GITCONFIG_RESTORE_FAILED:-0}" -eq 1 ]; then
    identity_fields="${identity_fields}, \"gitconfig_restore_failed\": true"
  fi
  local provider_error_fields=""
  if [ "$1" = "engine_unavailable" ] && [ -n "${PROVIDER_ERROR_RUNNER:-}" ] \
     && [ -n "${PROVIDER_ERROR_FIELD:-}" ] && [[ "${PROVIDER_ERROR_STATUS:-}" =~ ^[0-9]+$ ]]; then
    provider_error_fields="$(printf ', "provider_error": {"source":"harness_structured","runner":"%s","http_status":%s,"field":"%s"}' \
      "$(_flat_json_escape "$PROVIDER_ERROR_RUNNER")" "$PROVIDER_ERROR_STATUS" "$(_flat_json_escape "$PROVIDER_ERROR_FIELD")")"
  fi
  # error_category is classify-error TEXT matching (CLASSIFIED_ERROR). Diagnostic
  # only: it must never decide harness-owned. Harness-owned continues to use only
  # provider_error with source harness_structured. Empty, unset, and the "unknown"
  # sentinel (no text match) stay null. Paths that emit before classification
  # therefore publish null.
  local error_category_json="null"
  if [ -n "${CLASSIFIED_ERROR:-}" ] && [ "$CLASSIFIED_ERROR" != "unknown" ]; then
    error_category_json="\"$(_flat_json_escape "$CLASSIFIED_ERROR")\""
  fi
  local timeout_fields=""
  local emit_timeout_secs=""
  local timed_out_json="false" timeout_enforced_json="false"
  [ "${WORKER_TIMED_OUT:-0}" -eq 1 ] && timed_out_json="true"
  [ -n "${TIMEOUT_SOURCE:-}" ] && timeout_enforced_json="true"
  [ "${WATCHDOG_DISARMED:-0}" -eq 1 ] && timeout_enforced_json="false"
  emit_timeout_secs="$(normalize_timeout_seconds "${TIMEOUT:-}" 2>/dev/null || true)"
  timeout_fields=", \"timed_out\": $timed_out_json, \"timeout_enforced\": $timeout_enforced_json"
  if [ "$timed_out_json" = "true" ]; then
    local _tk="${WORKER_TIMEOUT_KIND:-idle}"
    case "$_tk" in hard|idle) ;; *) _tk="idle" ;; esac
    local _kel="${KILLED_ELAPSED_S:-0}" _kago="${KILLED_LAST_PROGRESS_S:-0}"
    [[ "$_kel" =~ ^[0-9]+$ ]] || _kel=0
    [[ "$_kago" =~ ^[0-9]+$ ]] || _kago=0
    timeout_fields="$timeout_fields, \"timeout_kind\": \"$_tk\", \"candidate_ref\": $commit_json, \"killed_at\": {\"elapsed_s\": $_kel, \"last_progress_s_ago\": $_kago, \"signal\": \"$_tk\"}"
  fi
  [ "${COMMIT_QUIET_ENDED:-0}" -eq 1 ] && timeout_fields="$timeout_fields, \"note\": \"ended_after_commit_quiet\""
  if [ -n "${TIMEOUT_SOURCE:-}" ] && [ -n "$emit_timeout_secs" ]; then
    timeout_fields="$timeout_fields, \"timeout_seconds\": $emit_timeout_secs, \"timeout_source\": \"$(_flat_json_escape "$TIMEOUT_SOURCE")\""
  fi
  local dispatcher_called_json="true" zero_diff_receipt_json="null"
  [ "${OUTCOME_DISPATCHER_CALLED:-1}" -eq 0 ] && dispatcher_called_json="false"
  if [[ "${OUTCOME_ZERO_DIFF_RECEIPT_DIGEST:-}" =~ ^[0-9a-f]{64}$ ]]; then
    zero_diff_receipt_json="\"$OUTCOME_ZERO_DIFF_RECEIPT_DIGEST\""
  fi
  local probe_fields=""
  [ -n "${PROBE_JSON:-}" ] && probe_fields=", \"probe\": $PROBE_JSON"
  local effort_fields=""
  [ -z "${EFFORT_SENT:-}" ] || effort_fields=", \"effort\": \"$(_flat_json_escape "$EFFORT_SENT")\""
  local role_kit_fields=""
  [ "${ROLE_KIT_ACTIVE:-0}" -eq 1 ] && role_kit_fields=", \"role_kit\": $ROLE_KIT_JSON"
  [ -z "${ROLE_KIT_SKIPPED_JSON:-}" ] || role_kit_fields="$role_kit_fields, \"role_kit\": null, \"role_kit_skipped\": $ROLE_KIT_SKIPPED_JSON"
  local sandbox_fields=""
  [ "${SANDBOX:-off}" = "bwrap" ] && sandbox_fields=", \"sandbox\": $(sandbox_json), \"sandbox_blocked_writes\": ${SANDBOX_BLOCKED:-0}, \"sandbox_blocked_samples\": ${SANDBOX_BLOCKED_SAMPLES:-[]}"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && sandbox_fields="$sandbox_fields, \"resolved_runner\": \"cc-shim\", \"endpoint\": \"$(_flat_json_escape "$ENDPOINT")\""
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && [ -n "${GATEWAY_TOKEN_SOURCE:-}" ] && sandbox_fields="$sandbox_fields, \"gateway_token\": \"$(_flat_json_escape "$GATEWAY_TOKEN_SOURCE")\""
  local fell_back_fields=""
  fell_back_fields="$(fell_back_json_suffix)"
  local tip_verify_fields=""
  if [ -n "${TIP_VERIFY_RESULT_JSON:-}" ]; then
    tip_verify_fields=", \"tip_verify\": ${TIP_VERIFY_RESULT_JSON}"
  fi
  local broker_fields=""
  if [ -n "${BROKER_RESULT:-}" ] && [ -f "$BROKER_RESULT" ]; then
    broker_fields="$(node - "$BROKER_RESULT" "$runner" <<'NODE'
const fs = require('fs'), crypto = require('crypto');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const fields = { broker_run_id: r.run_id, broker_diff_sha16: crypto.createHash('sha256').update(r.diff).digest('hex').slice(0, 16) };
const failVerdict = new Set(['rejected', 'stopped_billing', 'timeout', 'agent_failed', 'failed']);
if (failVerdict.has(r.verdict)) fields.reason = r.verdict === 'stopped_billing' ? `${process.argv[3]}_stopped_billing` : r.reason;
if (r.verdict === 'stopped_billing') fields.billing_line = typeof r.billing_line === 'string' ? r.billing_line.slice(0, 160) : '';
process.stdout.write(', ' + JSON.stringify(fields).slice(1, -1));
NODE
    )"
  fi
  if [ "${BROKER_VERDICT_UNKNOWN_SET:-0}" -eq 1 ]; then
    broker_fields="${broker_fields}, \"broker_verdict_unknown\": \"$(_flat_json_escape "${BROKER_VERDICT_UNKNOWN:-}")\""
  fi
  release_local_lease
  local evidence_pack_json="null"
  [ -n "${EVIDENCE_PACK_WRITTEN:-}" ] && evidence_pack_json="\"$(_flat_json_escape "$EVIDENCE_PACK_WRITTEN")\""
  tip_verify_fields="$tip_verify_fields$broker_fields, \"local_fallback\": ${LOCAL_FALLBACK_JSON:-null}, \"local_slots\": ${LOCAL_SLOTS_JSON:-null}, \"local_lease\": $(local_lease_json), \"shed\": ${SHED_ROUTE_JSON:-null}, \"target_precommit\": $(target_precommit_json), \"evidence_pack\": ${evidence_pack_json}"
  if [ "${SCRATCH:-0}" -eq 1 ]; then
    tip_verify_fields="$tip_verify_fields, \"scratch\": {\"dir\": \"$(_flat_json_escape "${SCRATCH_DIR:-}")\", \"files\": ${SCRATCH_FILES:-0}, \"gate_result\": \"allowed\", \"rejected_manifest\": \"$(_flat_json_escape "${SCRATCH_REJECTED_FILE:-}")\"}"
  fi
  hetero_log_fallback "$1"
  local _emit_json
  _emit_json="$(printf '{ "status": "%s", "runner": "%s", "model": "%s", "containment": "%s", "contained": %s, "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s, "dispatcher_called": %s, "model_calls": %s, "mutation_attempts": %s, "gate_attempts": %s, "resources_created": %s, "zero_diff_receipt_digest": %s, "skill_mode_effective": "%s", "skills_injected": %s, "orphan_worktree": %s, "run_id": %s, "usage": %s, "num_turns": %s, "wall_secs": %s, "duplex": %s, "provider_session_id": %s, "provider_session_reused": %s, "worktree_reused": %s, "retention_lease": %s%s%s%s%s%s%s%s%s%s%s%s%s }\n' \
    "$1" "$runner" "$(_flat_json_escape "$MODEL")" "$CONTAINMENT" "$contained_json" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(_flat_json_escape "${LOG:-}")" "$err_json" \
    "$dispatcher_called_json" "${OUTCOME_MODEL_CALLS:-1}" \
    "${OUTCOME_MUTATION_ATTEMPTS:-1}" "${OUTCOME_GATE_ATTEMPTS:-0}" \
    "${OUTCOME_RESOURCES_CREATED:-0}" "$zero_diff_receipt_json" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$orphan_json" \
    "$run_id_json" "$usage_json" "$num_turns_json" "$wall_json" "$duplex_json" \
    "$provider_session_json" "$provider_reused_json" "$worktree_reused_json" "$retention_lease_json" \
    "$strict_fields" "$campaign_fields" "$strict_boundary_fields" "$boundary_reject_fields" "$identity_fields" \
    "$provider_error_fields" "$timeout_fields" ", \"error_category\": $error_category_json" "$effort_fields$role_kit_fields" "$probe_fields" "$sandbox_fields$fell_back_fields" "$tip_verify_fields")"
  printf '%s\n' "$_emit_json"
  # dispatch_usage/1 ledger row (never affects the result or the exit code; see lib/dispatch-usage.js).
  printf '%s' "$_emit_json" | node "$SELF_DIR/lib/dispatch-usage.js" append --from-result - --role "${AUTOPILOT_DISPATCH_ROLE:-implementer}" \
    --run-id "${DISPATCH_RUN_ID:-}" --parent-run-id "${LINEAGE_PARENT:-}" --root-run-id "${LINEAGE_ROOT:-}" \
    --started-at "${DISPATCH_STARTED_EPOCH:-}" --endpoint "${ENDPOINT:-}" \
    --provider-session-id "${PROVIDER_SESSION_ID:-${CHILD_SESSION_ID:-}}" \
    ${ledger_usage_json:+--usage-json "$ledger_usage_json"} || true
  if [ -n "${HETERO_FLEET_TASK_ID:-}" ]; then
    local _ft_sha="${2:-}" _ft_log="${LOG:-}"
    [ -n "$_ft_sha" ] && [ "$_ft_sha" != "null" ] || _ft_sha="-"
    [ -n "$_ft_log" ] && [ "$_ft_log" != "null" ] || _ft_log="-"
    node "$SELF_DIR/lib/fleet-task-ref.js" progress "$HETERO_FLEET_TASK_ID" \
      "[dispatch:${AUTOPILOT_DISPATCH_ROLE:-implementer}] ${DISPATCH_RUN_ID:-unknown} $1 sha=${_ft_sha} log=${_ft_log}" >/dev/null 2>&1 || true
  fi
}

check_session_mode_gate() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker marker_state consumed_repo normalized_repo
  local -a markers
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -n "$consumed_repo" ] || return 0
  [ -r "$marker_dir" ] && [ -x "$marker_dir" ] \
    || die_precondition "authoritative session-mode marker directory is unreadable"
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  markers=()
  for marker in "$marker_dir"/*.json; do
    if [ "$marker" = "$marker_dir/*.json" ] && [ ! -e "$marker" ]; then
      continue
    fi
    markers+=("$marker")
  done
  [ "${#markers[@]}" -gt 0 ] || return 0
  # Classify every marker in ONE node process (was one per marker: expired markers accumulate,
  # and each cost a node start on every dispatch). Output is two NUL-terminated fields per
  # marker, in argv order: "OK" + INACTIVE|ACTIVE:<level>, or "ERR" + message. The loop below
  # still walks the markers in glob order and stops at the first one that is not a regular
  # file, invalid, or active — the same first-offender-wins order as the per-marker loop.
  local -a marker_results=()
  mapfile -d '' -t marker_results < <(
    node - "$normalized_repo" "${markers[@]}" <<'NODE' 2>/dev/null
'use strict';
const fs = require('fs');
const path = require('path');
const [repo, ...files] = process.argv.slice(2);
for (const file of files) {
  let status = 'OK';
  let text;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('marker must be an object');
    }
    if (data.level === null) {
      // A plain-session record (mods P1W MARKER): no orchestrator mode — skipped exactly as if absent.
      // Only an explicit null; a missing or malformed level is still an invalid marker.
      process.stdout.write('OK\0INACTIVE\0');
      continue;
    }
    if (!new Set(['l3', 'l4', 'l5', 'l6']).has(data.level)) {
      throw new TypeError('marker level is invalid');
    }
    if (typeof data.repo_root !== 'string' || !path.isAbsolute(data.repo_root)) {
      throw new TypeError('marker repo_root is invalid');
    }
    const startedAt = Date.parse(data.started_at);
    const expiresAt = Date.parse(data.expires_at);
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
      throw new TypeError('marker timestamps are invalid');
    }
    if (expiresAt <= Date.now()
        || path.resolve(data.repo_root) !== path.resolve(repo)
        || (data.level !== 'l5' && data.level !== 'l6')) {
      text = 'INACTIVE';
    } else {
      text = `ACTIVE:${data.level}`;
    }
  } catch (error) {
    status = 'ERR';
    text = (error && error.message) || String(error);
  }
  process.stdout.write(`${status}\0${String(text).replace(/\0/g, '')}\0`);
}
NODE
  )
  # Validation has finished in input order; clean expired records through the shared locked sweep.
  node "$SELF_DIR/session-mode.js" sweep --max 0 --grace-ms 0 >/dev/null 2>&1 || true
  local idx=0 marker_status
  for marker in "${markers[@]}"; do
    # The sweep above already unlinked expired/dead markers, so an absent path is a swept
    # record whose classification below still stands; only a path that still exists (or is a
    # dangling symlink) and is not a regular file is a non-file offender.
    if [ ! -f "$marker" ] && { [ -e "$marker" ] || [ -L "$marker" ]; }; then
      die_precondition "authoritative session-mode marker is not a regular file: $marker"
    fi
    marker_status="${marker_results[$((idx * 2))]-}"
    marker_state="${marker_results[$((idx * 2 + 1))]-}"
    idx=$((idx + 1))
    if [ "$marker_status" != "OK" ]; then
      # A node that failed outright leaves no record for this marker: still fail closed.
      die_precondition "authoritative session-mode marker is invalid: ${marker_state:-marker could not be classified}"
    fi
    if [[ "$marker_state" == ACTIVE:* ]]; then
      # --no-campaign does not skip this gate: an active l5/l6 marker means a
      # campaign is in scope for this repo, and the flag cannot leave it.
      if [ "${NO_CAMPAIGN:-0}" -eq 1 ]; then
        die_precondition "active session-mode=${marker_state#ACTIVE:} requires a sealed campaign strict projection (repo=$consumed_repo). --no-campaign does not leave an active campaign. To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=\$(mktemp -d)"
      fi
      die_precondition "active session-mode=${marker_state#ACTIVE:} requires a sealed campaign strict projection (repo=$consumed_repo). To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=\$(mktemp -d)"
    fi
  done
}

# A sealed bounded campaign is its own authority under a live session marker.
# This deliberately supersedes the absolute rule asserted by 8d7e61c2 on
# 2026-07-28. Consult the canonical JavaScript predicate instead of growing a
# second shell interpretation of the closed campaign schema.
sealed_bounded_campaign_without_mission_projection() {
  local projection_state="" projection_rc=0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] \
    && [ -n "$CAMPAIGN_CONTRACT_SHA256" ] \
    && [ -n "$CAMPAIGN_SEAL_FILE" ] \
    || return 1
  projection_state="$(
    node - "$SELF_DIR/session-mode.js" "$CAMPAIGN_CONTRACT_FILE" <<'NODE' 2>&1
'use strict';
const [sessionModePath, campaignContract] = process.argv.slice(2);
try {
  const { campaignCarriesMissionProjection } = require(sessionModePath);
  process.stdout.write(
    campaignCarriesMissionProjection(campaignContract) ? 'PROJECTED' : 'BOUNDED',
  );
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
  )" || projection_rc=$?
  [ "$projection_rc" -eq 0 ] \
    || die_precondition "campaign mission projection check failed: $projection_state"
  [ "$projection_state" = "BOUNDED" ]
}

run_strict_contract_preflight() {
  local contract_check_out="" contract_check_json=""
  local verdict strict_model strict_runner contract_base contract_wall_seconds checker_reasons
  local normalized_timeout caller_timeout
  local tmp_json
  local rc
  local -a contract_check_args

  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] || die_precondition "--strict-contract requires --contract-file"
  [ -r "$CONTRACT_FILE" ] || die_precondition "contract file not readable: $CONTRACT_FILE"

  CONSUMING_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$CONSUMING_REPO_ROOT" ] || die_precondition "not inside a git repository"

  contract_check_args=(
    check
    --contract "$CONTRACT_FILE"
    --repo "$CONSUMING_REPO_ROOT"
    --json
  )
  if [ -n "${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" ]; then
    contract_check_args+=(--qualification-override "$AUTOPILOT_QUALIFICATION_OVERRIDE")
  fi
  # A standing operator pin reaches the checker ONLY through a --resolved-live document
  # (dispatch-contract.js never opens the pin store). Until 2026-09-13 nothing on the managed
  # path produced that document, so the pin the operator recorded once was unreachable from
  # the one rail that matters (BACKLOG "operator-pin admission is unreachable"). Resolve the
  # contract's role live here; a resolver failure is reported and the check proceeds without
  # the document — byte-identical to the pre-pin behaviour, never a fabricated doc.
  RESOLVED_LIVE_FILE=""; RESOLVED_LIVE_NOTE=""
  local contract_role live_role
  contract_role="$(extract_file_json_value "$CONTRACT_FILE" role 2>/dev/null || true)"
  case "$contract_role" in
    implementer|reviewer) live_role="$contract_role" ;;
    *) live_role="" ;;
  esac
  if [ -n "$live_role" ] && [ "${AUTOPILOT_RESOLVED_LIVE:-auto}" != "off" ]; then
    RESOLVED_LIVE_FILE="$(mktemp -t 'dispatch-hetero-resolved-live-XX''XX''XX')" || RESOLVED_LIVE_FILE=""
    if [ -n "$RESOLVED_LIVE_FILE" ] \
      && node "$SELF_DIR/resolve-dispatch-topology.js" --resolve-live --role "$live_role" >"$RESOLVED_LIVE_FILE" 2>"$RESOLVED_LIVE_FILE.err"; then
      # The document is handed over ONLY when it carries a standing pin. Without one it adds
      # nothing the checker needs, and on a host whose ladder is empty its preferred_tuple has
      # no engine — the checker would then refuse EVERY seat, qualified ones included.
      if node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.operator_pin&&typeof j.operator_pin==="object"?0:1)' "$RESOLVED_LIVE_FILE" 2>/dev/null; then
        contract_check_args+=(--resolved-live "$RESOLVED_LIVE_FILE")
        RESOLVED_LIVE_NOTE="resolved-live: $live_role via resolve-dispatch-topology.js (standing pin present)"
      else
        RESOLVED_LIVE_NOTE="resolved-live: no standing pin for $live_role; contract checked without the document"
        rm -f "$RESOLVED_LIVE_FILE" "$RESOLVED_LIVE_FILE.err"; RESOLVED_LIVE_FILE=""
      fi
    else
      RESOLVED_LIVE_NOTE="resolved-live unavailable ($(tr '\n' ' ' < "${RESOLVED_LIVE_FILE:-/dev/null}.err" 2>/dev/null | cut -c1-200)); contract checked without it"
      rm -f "$RESOLVED_LIVE_FILE" "$RESOLVED_LIVE_FILE.err"; RESOLVED_LIVE_FILE=""
    fi
  fi
  [ -n "$RESOLVED_LIVE_NOTE" ] && printf 'dispatch-hetero: %s\n' "$RESOLVED_LIVE_NOTE" >&2
  contract_check_out="$(node "$SELF_DIR/dispatch-contract.js" "${contract_check_args[@]}" 2>&1)"
  rc=$?
  rm -f "${RESOLVED_LIVE_FILE:+$RESOLVED_LIVE_FILE}" "${RESOLVED_LIVE_FILE:+$RESOLVED_LIVE_FILE.err}" 2>/dev/null

  contract_check_json="$(printf '%s' "$contract_check_out" | extract_last_json)"
  if [ "$rc" -ne 0 ] || [ -z "$contract_check_json" ]; then
    checker_reasons="$(extract_json_value "$contract_check_json" reasons 2>/dev/null || true)"
    if [ -z "$checker_reasons" ]; then
      checker_reasons="$(printf '%s' "$contract_check_out" | tr '\n' ' ')"
    fi
    [ -n "$checker_reasons" ] || checker_reasons="contract check failed"
    die_precondition "contract checker failed: $checker_reasons"
  fi

  verdict="$(extract_json_value "$contract_check_json" verdict 2>/dev/null || true)"
  [ "$verdict" = "GO" ] || die_precondition "contract checker verdict is $verdict"

  # frozen_four_tuple conformance preflight (autonomous-brain P1, KR1): a frozen
  # contract REQUIRES a declared per-round intent, and the declared intent must
  # conform BEFORE any runner spawns. Contracts without the block are unchanged.
  __fft_probe="$(extract_file_json_value "$CONTRACT_FILE" "frozen_four_tuple.granularity_digest" 2>/dev/null || true)"
  if [ -n "$__fft_probe" ]; then
    [ -n "$CONFORMANCE_INTENT_FILE" ] \
      || die_precondition "contract carries frozen_four_tuple: --conformance-intent <file> is required"
    [ -r "$CONFORMANCE_INTENT_FILE" ] \
      || die_precondition "conformance intent file not readable: $CONFORMANCE_INTENT_FILE"
    if ! node "$SELF_DIR/check-blueprint-conformance.js" preflight \
        --contract "$CONTRACT_FILE" --intent "$CONFORMANCE_INTENT_FILE" \
        --repo "$CONSUMING_REPO_ROOT" >&2; then
      die_precondition "blueprint conformance preflight refused the declared intent"
    fi
  fi
  unset __fft_probe

  STRICT_CONTRACT_RESULT_FIELDS=1
  STRICT_UNIT_ID="$(extract_json_value "$contract_check_json" unit_id 2>/dev/null || true)"
  STRICT_CONTRACT_SHA="$(extract_json_value "$contract_check_json" contract_sha256 2>/dev/null || true)"
  STRICT_SPEC_SHA="$(extract_json_value "$contract_check_json" spec_sha256 2>/dev/null || true)"
  STRICT_ENGINE_ASSURANCE="$(extract_json_value "$contract_check_json" assurance 2>/dev/null || true)"
  strict_model="$(extract_json_value "$contract_check_json" resolved_engine.model 2>/dev/null || true)"
  strict_runner="$(extract_json_value "$contract_check_json" resolved_engine.runner 2>/dev/null || true)"
  STRICT_GO="$verdict"

  [ -n "$STRICT_UNIT_ID" ] || die_precondition "contract checker returned empty unit_id"
  [ -n "$STRICT_CONTRACT_SHA" ] || die_precondition "contract checker returned empty contract_sha256"
  [ -n "$STRICT_SPEC_SHA" ] || die_precondition "contract checker returned empty spec_sha256"
  [ -n "$strict_model" ] || die_precondition "contract checker returned empty resolved_engine.model"
  [ -n "$strict_runner" ] || die_precondition "contract checker returned empty resolved_engine.runner"

  contract_base="$(extract_file_json_value "$CONTRACT_FILE" "base_sha" 2>/dev/null || true)"
  [ -n "$contract_base" ] || die_precondition "contract missing base_sha"
  contract_wall_seconds="$(extract_file_json_value "$CONTRACT_FILE" "budget.wall_seconds" 2>/dev/null || true)"
  [ -n "$contract_wall_seconds" ] || die_precondition "contract missing budget.wall_seconds"
  STRICT_SCOPE_MAX_FILES="$(extract_file_json_value "$CONTRACT_FILE" "scope.max_files" 2>/dev/null || true)"
  [ -n "$STRICT_SCOPE_MAX_FILES" ] || die_precondition "contract missing scope.max_files"
  STRICT_SCOPE_MAX_DIFF_LINES="$(extract_file_json_value "$CONTRACT_FILE" "scope.max_diff_lines" 2>/dev/null || true)"
  [ -n "$STRICT_SCOPE_MAX_DIFF_LINES" ] || die_precondition "contract missing scope.max_diff_lines"

  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_ALLOW_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.allow_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_DENY_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.deny_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.generated_mirrors.allow_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_OUTPUT_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "output.paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_REQUIRED_CHANGE_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "output.required_change_paths")
  unset __strict_path
  [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -gt 0 ] || die_precondition "contract missing scope.allow_paths"

  if [ "$BASE_SUPPLIED" -eq 0 ]; then
    BASE="$contract_base"
  elif [ "$BASE" != "$contract_base" ]; then
    die_precondition "caller --base ($BASE) disagrees with contract base_sha ($contract_base)"
  fi

  if [ "$MODEL_SUPPLIED" -eq 0 ]; then
    MODEL="$strict_model"
    MODEL_IS_DEFAULT=0   # the contract named it; the built-in default is no longer in play
  elif [ "$MODEL" != "$strict_model" ]; then
    die_precondition "caller --model ($MODEL) disagrees with checker resolved_engine.model ($strict_model)"
  fi
  if [ "$RUNNER_SUPPLIED" -eq 0 ]; then
    RUNNER="$strict_runner"
  elif [ "$RUNNER" != "$strict_runner" ]; then
    die_precondition "caller --runner ($RUNNER) disagrees with checker resolved_engine.runner ($strict_runner)"
  fi

  if [ "$TIMEOUT_SUPPLIED" -eq 0 ]; then
    TIMEOUT="${contract_wall_seconds}s"
    TIMEOUT_SOURCE="contract_wall"
  else
    normalized_timeout="$(normalize_timeout_seconds "$TIMEOUT" 2>/dev/null || true)"
    [ -n "$normalized_timeout" ] || die_precondition "invalid --timeout value: $TIMEOUT"
    if [ "$normalized_timeout" -gt "$contract_wall_seconds" ]; then
      die_precondition "caller --timeout ($TIMEOUT) exceeds contract budget.wall_seconds (${contract_wall_seconds}s)"
    fi
    TIMEOUT_SOURCE="caller_within_wall"
  fi
}

run_campaign_contract_preflight() {
  local campaign_check_out="" campaign_check_json="" checker_reasons=""
  local verdict checked_digest rc

  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  CONSUMING_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$CONSUMING_REPO_ROOT" ] || die_precondition "not inside a git repository"

  campaign_check_out="$(
    node - "$SELF_DIR/implementation-campaign-check.js" \
      "$CAMPAIGN_CONTRACT_FILE" "$CAMPAIGN_SEAL_FILE" "$CONSUMING_REPO_ROOT" <<'NODE' 2>&1
'use strict';
const path = require('path');
const [checkerPath, contractPath, sealPath, repoPath] = process.argv.slice(2);
try {
  const { inspectSealedCampaignContract } = require(checkerPath);
  const result = inspectSealedCampaignContract({
    contractPath,
    sealPath,
    repoPath,
  });
  // Durable ICC identity is always campaign-v1 from raw contract bytes.
  // Seal campaign_id under mission-subject-v2 is Mission provenance only.
  let campaignId = null;
  let missionCampaignId = null;
  const strictAuthority = Boolean(
    result.contract
      && typeof result.contract === 'object'
      && result.contract.mission_runtime
      && result.contract.strict_dispatch,
  );
  if (result.ok === true) {
    const { campaignIdFor } = require(path.resolve(
      path.dirname(checkerPath),
      '..',
      'src',
      'engine',
      'implementation-campaign',
    ));
    campaignId = campaignIdFor(
      result.repo_identity,
      result.contract.ticket,
      result.contract_sha256,
    );
    if (result.identity_scheme === 'mission-subject-v2'
        && typeof result.campaign_id === 'string'
        && /^campaign-v2-[0-9a-f]{64}$/.test(result.campaign_id)) {
      missionCampaignId = result.campaign_id;
    }
  }
  process.stdout.write(`${JSON.stringify({
    verdict: result.verdict,
    contract_sha256: result.contract_sha256 || null,
    campaign_id: campaignId,
    mission_campaign_id: missionCampaignId,
    mission_mode: result.mission_mode || null,
    strict_authority: strictAuthority,
    reasons: result.errors || result.drift || [],
  })}\n`);
  process.exit(result.ok === true ? 0 : 3);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    verdict: 'REJECTED',
    contract_sha256: null,
    reasons: [error.message || String(error)],
  })}\n`);
  process.exit(3);
}
NODE
  )"
  rc=$?
  campaign_check_json="$(printf '%s' "$campaign_check_out" | extract_last_json)"
  if [ "$rc" -ne 0 ] || [ -z "$campaign_check_json" ]; then
    checker_reasons="$(extract_json_value "$campaign_check_json" reasons 2>/dev/null || true)"
    if [ -z "$checker_reasons" ]; then
      checker_reasons="$(printf '%s' "$campaign_check_out" | tr '\n' ' ')"
    fi
    [ -n "$checker_reasons" ] || checker_reasons="campaign contract check failed"
    die_precondition "campaign contract checker failed: $checker_reasons"
  fi

  verdict="$(extract_json_value "$campaign_check_json" verdict 2>/dev/null || true)"
  [ "$verdict" = "VALID" ] || die_precondition "campaign contract checker verdict is $verdict"
  checked_digest="$(extract_json_value "$campaign_check_json" contract_sha256 2>/dev/null || true)"
  [ "$checked_digest" = "$CAMPAIGN_CONTRACT_SHA256" ] \
    || die_precondition "campaign contract digest changed after intake"
  CAMPAIGN_ID="$(extract_json_value "$campaign_check_json" campaign_id 2>/dev/null || true)"
  MISSION_CAMPAIGN_ID="$(extract_json_value "$campaign_check_json" mission_campaign_id 2>/dev/null || true)"
  CAMPAIGN_MISSION_MODE="$(extract_json_value "$campaign_check_json" mission_mode 2>/dev/null || true)"
  [ "$(extract_json_value "$campaign_check_json" strict_authority 2>/dev/null || true)" = "true" ] \
    && CAMPAIGN_STRICT_AUTHORITY=1
  case "$CAMPAIGN_MISSION_MODE" in
    off|shadow|enforce) ;;
    *) die_precondition "campaign contract checker returned invalid mission mode" ;;
  esac
  # --run-id and lifecycle roots must match ICC v1 only.
  [[ "$CAMPAIGN_ID" =~ ^campaign-v1-[0-9a-f]{64}$ ]] \
    || die_precondition "campaign contract checker returned invalid ICC campaign identity"
  if [ -n "$MISSION_CAMPAIGN_ID" ] && [ "$MISSION_CAMPAIGN_ID" != "null" ]; then
    [[ "$MISSION_CAMPAIGN_ID" =~ ^campaign-v2-[0-9a-f]{64}$ ]] \
      || die_precondition "campaign contract checker returned invalid Mission campaign identity"
  else
    MISSION_CAMPAIGN_ID=""
  fi
}

run_campaign_projection_preflight() {
  local projection_out="" projection_rc=0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  if [ "$STRICT_CONTRACT" -ne 1 ]; then
    [ "$CAMPAIGN_STRICT_AUTHORITY" -ne 1 ] || \
      die_precondition "sealed strict campaign dispatch requires --strict-contract"
    return 0
  fi
  [ -n "$RUN_ID" ] || die_precondition "sealed campaign strict projection requires --run-id"
  [ -n "$STAGE" ] || die_precondition "sealed campaign strict projection requires --stage"
  [ "$RUN_ID" = "$CAMPAIGN_ID" ] \
    || die_precondition "caller --run-id disagrees with sealed campaign identity"
  projection_out="$(
    node - "$SELF_DIR/../src/engine/campaign-dispatch-projection.js" \
      "$CAMPAIGN_CONTRACT_FILE" "$CONTRACT_FILE" "$CAMPAIGN_CONTRACT_SHA256" \
      "$CAMPAIGN_ID" "$BRANCH" "$BASE" "$RUNNER" "$MODEL" "$STAGE" "$LINEAGE_ROOT" <<'NODE' 2>&1
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const [
  helperPath,
  campaignPath,
  unitPath,
  campaignContractSha256,
  campaignId,
  branch,
  base,
  runner,
  model,
  stage,
  rootRunId,
] = process.argv.slice(2);
try {
  const campaignBytes = fs.readFileSync(campaignPath);
  const actualCampaignDigest = crypto.createHash('sha256').update(campaignBytes).digest('hex');
  if (actualCampaignDigest !== campaignContractSha256) {
    throw new TypeError('campaign contract digest changed before projection');
  }
  const campaignContract = JSON.parse(campaignBytes.toString('utf8'));
  const unitContract = JSON.parse(fs.readFileSync(unitPath, 'utf8'));
  const { verifyCampaignDispatchUnit } = require(helperPath);
  verifyCampaignDispatchUnit({
    campaignContract,
    campaignContractSha256,
    campaignId,
    branch,
    base,
    runner,
    model,
    stage,
    rootRunId,
    unitContract,
    ...(unitContract
      && unitContract.output
      && unitContract.output.zero_diff_receipt
      ? { zeroDiffReceipt: unitContract.output.zero_diff_receipt } : {}),
  });
  process.stdout.write('BOUND\n');
} catch (error) {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(3);
}
NODE
  )" || projection_rc=$?
  if [ "$projection_rc" -ne 0 ] || [ "$projection_out" != "BOUND" ]; then
    projection_out="$(printf '%s' "$projection_out" | tr '\n' ' ')"
    [ -n "$projection_out" ] || projection_out="campaign dispatch projection check failed"
    die_precondition "campaign dispatch projection rejected: $projection_out"
  fi
  CAMPAIGN_PROJECTION_BOUND=1
}

# Marker → sealed campaign admission bridge (zero-runner under enforce mismatch).
# The CALLER'S OWN active L5/L6 marker (and its L3 fallback whose entry_level is L4-L6)
# must carry the same repo/policy/graph digests as the sealed campaign mission_runtime.
# "Own" = the marker whose session_id equals CLAUDE_CODE_SESSION_ID: another session's
# marker (an aborted /l5 run's leftover) is none of this dispatch's business and no longer
# fences it (BL-0009). With CLAUDE_CODE_SESSION_ID unset the bridge cannot tell whose
# marker is whose and keeps scanning the whole directory (never relaxed). Caller flags and
# environment variables are never substitutes for sealed contract bytes or marker admission bytes.
check_marker_campaign_admission_bridge() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker bridge_state bridge_rc consumed_repo normalized_repo
  local markers
  [ "$CAMPAIGN_PROJECTION_BOUND" -eq 1 ] || return 0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] || return 0
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -r "$marker_dir" ] && [ -x "$marker_dir" ] \
    || die_precondition "authoritative session-mode marker directory is unreadable"
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  markers=("$marker_dir"/*.json)
  for marker in "${markers[@]}"; do
    if [ "$marker" = "$marker_dir/*.json" ] && [ ! -e "$marker" ]; then
      continue
    fi
    [ -f "$marker" ] \
      || die_precondition "authoritative session-mode marker is not a regular file: $marker"
    bridge_state="$(
      node - "$marker" "$normalized_repo" "$CAMPAIGN_CONTRACT_FILE" \
        "$CAMPAIGN_MISSION_MODE" "$SELF_DIR/session-mode.js" "${CLAUDE_CODE_SESSION_ID:-}" <<'NODE' 2>&1
'use strict';
const fs = require('fs');
const path = require('path');
const [
  markerPath,
  repo,
  campaignPath,
  missionMode,
  sessionModePath,
  callerSession,
] = process.argv.slice(2);
const managedLevels = new Set(['l5', 'l6']);
const fallbackEntryLevels = new Set(['l4', 'l5', 'l6']);
try {
  const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('marker must be an object');
  }
  if (data.level === null) {
    // Plain-session record (mods P1W MARKER): not an orchestrator marker — skipped as if absent.
    process.stdout.write('INACTIVE');
    process.exit(0);
  }
  if (!new Set(['l3', 'l4', 'l5', 'l6']).has(data.level)) {
    throw new TypeError('marker level is invalid');
  }
  if (typeof data.repo_root !== 'string' || !path.isAbsolute(data.repo_root)) {
    throw new TypeError('marker repo_root is invalid');
  }
  const startedAt = Date.parse(data.started_at);
  const expiresAt = Date.parse(data.expires_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw new TypeError('marker timestamps are invalid');
  }
  if (expiresAt <= Date.now()
      || path.resolve(data.repo_root) !== path.resolve(repo)) {
    process.stdout.write('INACTIVE');
    process.exit(0);
  }
  if (callerSession) {
    // Same normalisation as session-mode.js normalizeSessionId (markers store the normalised id).
    const own = String(callerSession).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    if (data.session_id !== own && path.basename(markerPath) !== `${own}.json`) {
      process.stdout.write('INACTIVE');
      process.exit(0);
    }
  }
  const isManaged = managedLevels.has(data.level)
    || (data.level === 'l3' && fallbackEntryLevels.has(data.entry_level));
  if (!isManaged) {
    process.stdout.write('INACTIVE');
    process.exit(0);
  }
  // off/shadow keep compatibility when authoritative policy permits it.
  if (missionMode === 'off' || missionMode === 'shadow') {
    process.stdout.write(`COMPAT:${missionMode}`);
    process.exit(0);
  }
  if (missionMode !== 'enforce') {
    throw new TypeError(`invalid mission mode for marker bridge: ${missionMode}`);
  }
  const campaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
  if (!campaign || typeof campaign !== 'object' || !campaign.mission_runtime) {
    throw new TypeError('sealed campaign is missing mission_runtime for marker bridge');
  }
  const expected = {
    repo_identity: campaign.repo_identity,
    mission_policy_digest: campaign.mission_runtime.mission_policy_digest,
    mission_graph_digest: campaign.mission_runtime.mission_graph_digest,
  };
  const { verifyMissionRoutingProjection } = require(sessionModePath);
  const verdict = verifyMissionRoutingProjection(data, expected);
  if (!verdict.valid) {
    throw new TypeError(verdict.reason || 'marker Mission admission does not match campaign');
  }
  const nodeId = campaign.mission_runtime.graph_node_id;
  const noOpSet = verdict.mission_noop;
  const adoption = noOpSet && noOpSet.noop_short_circuit === true
    ? noOpSet.noop_adoptions.find((item) => item.graph_node_id === nodeId)
    : null;
  if (adoption) {
    process.stdout.write(`NOOP:${nodeId}:${adoption.noop_receipt_digest}`);
  } else {
    process.stdout.write(`BOUND:${data.level}`);
  }
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}

NODE
    )"
    bridge_rc=$?
    if [ "$bridge_rc" -ne 0 ]; then
      die_precondition "marker-to-campaign admission bridge failed: $bridge_state"
    fi
    case "$bridge_state" in
      NOOP:*)
        _noop_payload="${bridge_state#NOOP:}"
        _noop_node="${_noop_payload%%:*}"
        _noop_digest="${_noop_payload#*:}"
        [[ "$_noop_digest" =~ ^[0-9a-f]{64}$ ]] \
          || die_precondition "marker Mission no-op receipt digest is invalid"
        if [ "$MISSION_NOOP_SHORT_CIRCUIT" -eq 1 ] \
            && { [ "$MISSION_NOOP_GRAPH_NODE" != "$_noop_node" ] \
              || [ "$MISSION_NOOP_RECEIPT_DIGEST" != "$_noop_digest" ]; }; then
          die_precondition "conflicting active Mission no-op marker authorities"
        fi
        MISSION_NOOP_SHORT_CIRCUIT=1
        MISSION_NOOP_GRAPH_NODE="$_noop_node"
        MISSION_NOOP_RECEIPT_DIGEST="$_noop_digest"
        ;;
    esac
  done
}

check_managed_dev_flow_admission() {
  local consumed_repo admission_out admission_rc
  [ "$CAMPAIGN_PROJECTION_BOUND" -eq 1 ] || return 0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] \
    || die_dev_flow_admission "session marker repository mismatch: no Git repository"
  admission_out="$(
    node - "$SELF_DIR/session-mode.js" "$consumed_repo" \
      "${AUTOPILOT_LEVEL:-}" "$CAMPAIGN_CONTRACT_FILE" <<'NODE' 2>&1
'use strict';
const [sessionModePath, repoRoot, effectiveLevel, campaignContract] = process.argv.slice(2);
try {
  const { validateManagedDevFlowAdmission } = require(sessionModePath);
  const result = validateManagedDevFlowAdmission({
    repoRoot,
    effectiveLevel: String(effectiveLevel || '').toLowerCase(),
    campaignContract,
  });
  if (!result.valid) {
    process.stdout.write(result.reason);
    process.exit(3);
  }
  process.stdout.write('READY');
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
  )"
  admission_rc=$?
  [ "$admission_rc" -eq 0 ] && [ "$admission_out" = "READY" ] \
    || die_dev_flow_admission "${admission_out:-session marker admission validation failed}"
}

check_mission_enforcement_gate() {
  local consumed_repo mission_mode mission_rc
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] || return 0
  if [ ! -e "$consumed_repo/.claude/owner-kernel-governance.json" ] \
      && [ ! -L "$consumed_repo/.claude/owner-kernel-governance.json" ]; then
    return 0
  fi
  mission_mode="$(
    node - "$SELF_DIR/implementation-campaign-check.js" "$consumed_repo" <<'NODE' 2>/dev/null
'use strict';
const [checkerPath, repo] = process.argv.slice(2);
try {
  const { projectMissionMode } = require(checkerPath);
  process.stdout.write(projectMissionMode(repo));
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
  )"
  mission_rc=$?
  [ "$mission_rc" -eq 0 ] \
    || die_precondition "authoritative Mission governance is invalid: $mission_mode"
  case "$mission_mode" in
    off|shadow) ;;
    enforce)
      # Sealed campaign flags never reach here with --no-campaign (that pair is
      # a precondition error). An active l5/l6 marker was already refused by
      # check_session_mode_gate; this return does not skip that gate.
      if [ "${NO_CAMPAIGN:-0}" -eq 1 ]; then
        MISSION_ENFORCEMENT_MODE_SEEN="$mission_mode"
        return 0
      fi
      die_precondition "Mission enforce mode requires a sealed campaign strict projection, or pass --no-campaign for ordinary backlog work outside any campaign"
      ;;
    *)
      die_precondition "authoritative Mission governance returned invalid mode: $mission_mode"
      ;;
  esac
}

current_runner_name() {
  # agy is the DEFAULT rail — it has no IS_AGY flag, it is the else-case. So "no IS_*
  # set" is ambiguous between "agy was selected" and "resolution has not happened yet".
  # RUNNER_RESOLVED disambiguates: only trust the else-case "agy" once set_runner_flags
  # has actually completed (FINDING 1). Before that, emit the sentinel "unresolved" —
  # not "agy", not "auto" (the latter is also a valid --runner INPUT value, so a caller
  # who passed --runner grok and failed an early precondition must never see "auto" in
  # the output despite never saying it).
  local runner="unresolved"
  if [ "${RUNNER_RESOLVED:-0}" -eq 1 ]; then
    runner="agy"
    [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
    [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
    [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
    [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
    [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && runner="claude-native"
    [ "${LOCAL_RUNNER:-0}" -eq 1 ] && runner="local"
  fi
  printf '%s' "$runner"
}

# BL-0435 / PM 01M7AHAM: the cloud-seat re-exec carries fell_back + fallback {from,to,reason}.
fell_back_json_suffix() {
  [ -n "${FELL_BACK_JSON:-}" ] || return 0
  local fb_obj=""
  fb_obj="$(node -e '
let j = null; try { j = JSON.parse(process.argv[1]); } catch {}
if (!j || typeof j !== "object") process.exit(0);
if (j.fallback && typeof j.fallback === "object") {
  process.stdout.write(JSON.stringify(j.fallback));
  process.exit(0);
}
const from = [j.from_model || "", j.from_runner || ""].filter(Boolean).join("@")
  + (j.from_endpoint ? `#${j.from_endpoint}` : "");
process.stdout.write(JSON.stringify({
  from: from || j.from_endpoint || j.from_runner || "unknown",
  to: j.to_rung || "",
  reason: j.error_class || "engine_unavailable",
}));
' "$FELL_BACK_JSON" 2>/dev/null)" || fb_obj=""
  if [ -n "$fb_obj" ]; then
    printf ', "fell_back": %s, "fallback": %s' "$FELL_BACK_JSON" "$fb_obj"
  else
    printf ', "fell_back": %s' "$FELL_BACK_JSON"
  fi
}
# One cloud-fallbacks.jsonl row, written when the re-exec ends so the outcome is the result.
hetero_log_fallback() { # $1 outcome
  [ -n "${FELL_BACK_JSON:-}" ] || return 0
  [ "${FELL_BACK_LOGGED:-0}" = "1" ] && return 0
  FELL_BACK_LOGGED=1
  node -e '
let fb;
try { fb = JSON.parse(process.argv[1]); } catch { process.exit(0); }
if (!fb || typeof fb !== "object" || Array.isArray(fb)) process.exit(0);
const from = [fb.from_model || "", fb.from_runner || ""].filter(Boolean).join("@")
  + (fb.from_endpoint ? `#${fb.from_endpoint}` : "");
const fallback = (fb.fallback && typeof fb.fallback === "object")
  ? fb.fallback
  : { from: from || fb.from_endpoint || fb.from_runner || "unknown", to: fb.to_rung || "", reason: fb.error_class || "engine_unavailable" };
process.stdout.write(JSON.stringify({
  ts: new Date().toISOString(),
  run_id: process.argv[3] ? process.argv[3] : null,
  from_runner: fb.from_runner,
  from_endpoint: fb.from_endpoint == null || fb.from_endpoint === "" ? null : String(fb.from_endpoint),
  error_class: fb.error_class,
  to_rung: fb.to_rung,
  fallback,
  outcome: process.argv[2],
  probe: fb.probe && typeof fb.probe === "object" && !Array.isArray(fb.probe) ? fb.probe : null,
  served_by: fb.to_rung,
}));
' "$FELL_BACK_JSON" "$1" "${DISPATCH_RUN_ID:-}" \
    | node "$SELF_DIR/engine-capability-state.js" cloud-fallback-log >/dev/null 2>&1 || true
}

die_precondition() {
  local runner
  runner="$(current_runner_name)"
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  hetero_log_fallback "precondition_failed"
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "duplex": %s, "retention_lease": null, "usage": null, "num_turns": null%s }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$1")" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$run_id_json" "$duplex_json" "$(fell_back_json_suffix)"
  exit 2
}

# --- write sandbox (--sandbox bwrap; cc-shim only) -------------------------------------------
# Why: a local worker wrote outside its worktree three times (into the main checkout) and the
# main-checkout fingerprint only sees that AFTER the write. bwrap makes `/` read-only for the
# worker so the write fails first; the fingerprint stays as the second layer.
# Writable inside, and nothing else (this list is mirrored in references/hetero-dispatch.md):
#   1. the worktree ($WT)
#   2. this dispatch's own scratch dir ($SANDBOX_TMP: TMPDIR, the throwaway CLAUDE_CONFIG_DIR,
#      XDG_CACHE_HOME, the result envelope). Made per run, removed per run. Never the real
#      ~/.claude: that directory (and ~/.claude.json) is masked read-only.
#   3. /dev and /proc, bwrap's minimal device and proc mounts.
# The worktree's git admin dir lives under the main checkout and stays read-only: the worker
# is edit-only and the rail (outside the sandbox) does the commit. Network is untouched.
SANDBOX_PREFLIGHT_ERROR=""
SANDBOX_WT_PATH=""     # the worktree path kept for the result/manifest (WT is cleared when the worktree is reaped)
SANDBOX_TMP_PATH=""    # the scratch dir path kept for the result/manifest after SANDBOX_TMP is removed
sandbox_preflight() {
  SANDBOX_PREFLIGHT_ERROR=""
  if ! command -v bwrap >/dev/null 2>&1; then
    SANDBOX_PREFLIGHT_ERROR="--sandbox bwrap requested but bwrap is not on PATH; refusing to run without the sandbox (no silent downgrade)"
    return 1
  fi
  if ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
    SANDBOX_PREFLIGHT_ERROR="--sandbox bwrap requested but bwrap cannot start here (user namespaces blocked?); refusing to run without the sandbox (no silent downgrade)"
    return 1
  fi
  return 0
}

# local_sandbox_endpoint_listed is scripts/lib/local-sandbox-endpoint.sh (one list).
# This script only implements. A role label in the environment does not make the
# worker read-only, so the gate is every cc-shim dispatch of a listed endpoint,
# not an AUTOPILOT_DISPATCH_ROLE allowlist. Read-only seats use other rails.
die_local_implementer_sandbox() {
  local endpoint="$1"
  local runner
  runner="$(current_runner_name)"
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  local msg="local implementer endpoint ${endpoint} requires --sandbox bwrap (missing flag); refusing before any model call"
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "duplex": %s, "retention_lease": null, "usage": null, "num_turns": null, "boundary_code": "local_implementer_sandbox_required" }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$msg")" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$run_id_json" "$duplex_json"
  exit 2
}

require_local_implementer_sandbox() {
  [ "${IS_CCSHIM:-0}" -eq 1 ] || return 0
  [ -n "${ENDPOINT:-}" ] || return 0
  [ "${SANDBOX:-off}" = "bwrap" ] && return 0
  local listed_rc=0
  local_sandbox_endpoint_listed "$ENDPOINT" || listed_rc=$?
  case "$listed_rc" in
    0) die_local_implementer_sandbox "$ENDPOINT" ;;
    1) return 0 ;;
    *) die_precondition "local implementer sandbox registry unreadable (scripts/lib/local-sandbox-endpoints.json); refusing cc-shim endpoint '${ENDPOINT}' without --sandbox bwrap" ;;
  esac
}

# sandbox_nested_repo <path>: prints the nearest PROPER ancestor directory that holds a .git entry
# (a repo's working tree, main checkout or linked worktree alike) and returns 0; returns 1 when
# no ancestor is inside any repo. Strict on purpose: the independent clone the sandbox wants is
# a worktree that sits OUTSIDE every repo's working tree.
sandbox_nested_repo() {
  local d
  d="$(dirname "$1")"
  while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then printf '%s' "$d"; return 0; fi
    [ "$d" = "/" ] && break
    d="$(dirname "$d")"
  done
  return 1
}
# sandbox_setup: make the per-dispatch scratch dir and the bwrap argv prefix (SANDBOX_ARGV).
sandbox_setup() {
  SANDBOX_TMP="$(mktemp -d -t dispatch-hetero-sandbox-XXXXXX)" || return 1
  SANDBOX_TMP="$(realpath "$SANDBOX_TMP")" || return 1
  SANDBOX_TMP_PATH="$SANDBOX_TMP"
  SANDBOX_WT_PATH="$WT"
  mkdir -p "$SANDBOX_TMP/tmp" "$SANDBOX_TMP/claude-config" "$SANDBOX_TMP/cache" "$SANDBOX_TMP/empty" || return 1
  SANDBOX_ARGV=(bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc
    --bind "$WT" "$WT" --bind "$SANDBOX_TMP" "$SANDBOX_TMP")
  # The gitfile stays read-only inside the sandbox: a writable pointer would let the worker aim the rail's own git at a hostile config.
  [ -f "$WT/.git" ] && SANDBOX_ARGV+=(--ro-bind "$WT/.git" "$WT/.git")
  [ -d "${HOME:-/nonexistent}/.claude" ] && SANDBOX_ARGV+=(--ro-bind "$SANDBOX_TMP/empty" "$HOME/.claude")
  [ -f "${HOME:-/nonexistent}/.claude.json" ] && SANDBOX_ARGV+=(--ro-bind /dev/null "$HOME/.claude.json")
  if [ "$(current_runner_name)" = "agy" ]; then
    # agy writes its own state under $HOME/.gemini (conversation cache, auth refresh).
    # Only bind $HOME/.gemini writable for the agy runner; keep $HOME/.claude masked/read-only.
    [ -n "${HOME:-}" ] || return 1
    local _home_real _gemini_real
    _home_real="$(readlink -m -- "$HOME")" || return 1
    _gemini_real="$(readlink -m -- "$HOME/.gemini")" || return 1
    case "$_gemini_real" in
      "$_home_real/.gemini") ;;
      *) return 1 ;;
    esac
    if [ -e "$_gemini_real" ] && [ ! -d "$_gemini_real" ]; then
      return 1
    fi
    mkdir -p "$_gemini_real" || return 1
    SANDBOX_ARGV+=(--bind "$_gemini_real" "$_gemini_real")
  fi
  if [ "$(current_runner_name)" = "cursor" ]; then
    # cursor writes its refreshed login token under $HOME/.config/cursor.
    # Only bind $HOME/.config/cursor writable for the cursor runner when it exists.
    [ -n "${HOME:-}" ] || return 1
    local _home_real _cursor_cfg_real
    _home_real="$(readlink -m -- "$HOME")" || return 1
    _cursor_cfg_real="$(readlink -m -- "$HOME/.config/cursor")" || return 1
    case "$_cursor_cfg_real" in
      "$_home_real/.config/cursor") ;;
      *) return 1 ;;
    esac
    if [ -e "$_cursor_cfg_real" ] && [ ! -d "$_cursor_cfg_real" ]; then
      return 1
    fi
    if [ -d "$_cursor_cfg_real" ]; then
      SANDBOX_ARGV+=(--bind "$_cursor_cfg_real" "$_cursor_cfg_real")
    fi
  fi
  SANDBOX_ARGV+=(--setenv TMPDIR "$SANDBOX_TMP/tmp" --setenv CLAUDE_CONFIG_DIR "$SANDBOX_TMP/claude-config"
    --setenv XDG_CACHE_HOME "$SANDBOX_TMP/cache" --setenv AUTOPILOT_EVIDENCE_NOTES "$SANDBOX_TMP/evidence-notes.md" --chdir "$WT" --)
  return 0
}
sandbox_teardown() {
  reap_sandbox_config_dir
}
# sandbox_count_denied: EROFS lines the worker's own output shows. A count is only what the output
# reveals (a worker can swallow the error), so no sighting reports "unknown", never 0.
sandbox_count_denied() {
  local n=0
  SANDBOX_DENIED="unknown"
  [ -n "${LOG:-}" ] && [ -f "$LOG" ] && n="$(grep -ciE 'read-only file system|EROFS' "$LOG" 2>/dev/null || true)"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt 0 ] && SANDBOX_DENIED="$n"
  sandbox_count_blocked
  return 0
}
# sandbox_count_blocked: SANDBOX_BLOCKED (integer, 0 = none seen) and SANDBOX_BLOCKED_SAMPLES (JSON array, at most
# 3 absolute paths, never file contents). Two signals, the larger count wins (they can describe the same failures,
# so they are not added): (1) tool_result blocks in the worker's own session transcripts under the throwaway
# CLAUDE_CONFIG_DIR ($SANDBOX_TMP/claude-config/projects), which hold the raw tool error even when the model never
# repeats it; (2) lines of the worker log with `Read-only file system` / EROFS. Blind spots: a count is of failed
# tool results or log lines, not of syscalls; a write the worker never tried through a logged tool, or a runner that
# writes no transcript, shows nothing; a model quoting the phrase in prose is a false positive. Observation only:
# never touches the exit code or the status.
sandbox_count_blocked() {
  SANDBOX_BLOCKED=0
  SANDBOX_BLOCKED_SAMPLES="[]"
  local out
  out="$(node - "${LOG:-}" "${SANDBOX_TMP:-}/claude-config/projects" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const path = require('path');
const RE = /read-only file system|EROFS/i;
function samplePath(text) {
  const m = /:\s*(\/[^\s:'"`]+):\s*Read-only/i.exec(text) || /['"`](\/[^'"`\s]+)['"`]/.exec(text) || /\s(\/[A-Za-z0-9_.\/-]+)/.exec(text);
  return m ? m[1] : null;
}
let logN = 0; const logS = [];
try {
  for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
    if (!RE.test(line)) continue;
    logN += 1; const p = samplePath(line); if (p && !logS.includes(p)) logS.push(p);
  }
} catch {}
let trN = 0; const trS = [];
function texts(c) {
  if (typeof c === 'string') return [c];
  if (Array.isArray(c)) return c.flatMap((x) => (typeof x === 'string' ? [x] : (x && typeof x.text === 'string' ? [x.text] : [])));
  return [];
}
let rootReal = null; try { rootReal = fs.realpathSync(process.argv[3]); } catch {}
function walk(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      // regular files only (a worker-planted symlink must not pull in another run's transcript), and the real path must stay under the projects dir
      let raw; try { const rp = fs.realpathSync(f); if (!rootReal || !rp.startsWith(rootReal + path.sep)) continue; raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of raw.split('\n')) {
        if (!line.includes('tool_result')) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        const blocks = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
        for (const b of blocks) {
          if (!b || b.type !== 'tool_result') continue;
          const t = texts(b.content).join('\n');
          if (!RE.test(t)) continue;
          trN += 1; const p = samplePath(t); if (p && !trS.includes(p)) trS.push(p);
        }
      }
    }
  }
}
walk(process.argv[3]);
const n = Math.max(logN, trN);
const pool = trN >= logN ? trS.concat(logS) : logS.concat(trS);
process.stdout.write(JSON.stringify({ n, samples: [...new Set(pool)].slice(0, 3) }));
NODE
)"
  local n
  n="$(printf '%s' "$out" | node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).n))}catch{}' 2>/dev/null || true)"
  if [[ "$n" =~ ^[0-9]+$ ]]; then
    SANDBOX_BLOCKED="$n"
    SANDBOX_BLOCKED_SAMPLES="$(printf '%s' "$out" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).samples))' 2>/dev/null || echo '[]')"
  fi
  return 0
}
# wt_gitfile_check: 0 when $WT/.git is still the regular file recorded at worktree creation. Anything else
# (symlink, directory, other content) sets WT_GITFILE_ERROR and returns 1; the caller must then run no git
# against $WT. Independent of --sandbox: it is the rail-side half of the gitfile guard.
WT_GITFILE_EXPECTED=""
WT_GITFILE_ERROR=""
wt_gitfile_check() {
  [ -z "${WT_GITFILE_ERROR:-}" ] || return 1
  [ -n "${WT_GITFILE_EXPECTED:-}" ] || return 0
  if [ -L "$WT/.git" ] || [ ! -f "$WT/.git" ]; then
    WT_GITFILE_ERROR="worktree_gitfile_tampered: $WT/.git is no longer a regular file (symlink, directory or removed); no git was run against the worktree, round discarded, worktree retained"
    return 1
  fi
  if [ "$(cat "$WT/.git" 2>/dev/null)" != "$WT_GITFILE_EXPECTED" ]; then
    WT_GITFILE_ERROR="worktree_gitfile_tampered: $WT/.git content changed since the worktree was created (it pointed elsewhere); no git was run against the worktree, round discarded, worktree retained"
    return 1
  fi
  # A nested repo (any `.git` entry below the worktree root) carries its own config, hooks and attributes;
  # `git add -A` would record it as a gitlink and a later status would recurse into it and run them.
  _wt_nested="$(find "$WT" -mindepth 2 -name .git -print -quit 2>/dev/null)"
  if [ -n "$_wt_nested" ]; then
    WT_GITFILE_ERROR="worktree_nested_repo: a nested repository ($_wt_nested) exists inside the worktree; no git was run against the worktree, round discarded, worktree retained"
    return 1
  fi
  return 0
}
# wt_record_gitfile_from_registry <path>: for --reuse-worktree, the expected gitfile is what the main repo's
# own registry says (<common>/worktrees/<name>/gitdir names this worktree's .git), never the file as the
# previous round left it. Sets WT_GITFILE_EXPECTED; 1 when the worktree is not registered that way.
wt_record_gitfile_from_registry() {
  local d
  for d in "$_wt_common_dir"/worktrees/*/; do
    d="${d%/}"
    [ -f "$d/gitdir" ] || continue
    if [ "$(cat "$d/gitdir" 2>/dev/null)" = "$1/.git" ]; then
      WT_GITFILE_EXPECTED="gitdir: $d"
      return 0
    fi
  done
  return 1
}
# _wt_git: git against $WT with the config-driven command hooks off: core.fsmonitor can name any command and a
# relative core.hooksPath resolves inside the writable worktree. The rail's wrapper commit never relied on a
# hook (it already passes --no-verify, and its boundary gates are rail code, not git hooks).
_wt_git() { git -C "$WT" -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"; }

target_precommit_setting() { # key env-name default
  local key="$1" env_name="$2" default="$3" value="${!2-}" config_file="${AUTOPILOT_CONFIG_FILE:-${HOME:-}/.autopilot/config.json}"
  if [ -n "$value" ]; then printf '%s' "$value"; return 0; fi
  node - "$config_file" "$key" "$default" <<'NODE'
const fs = require('fs');
const [file, key, fallback] = process.argv.slice(2);
try {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = config && config[key];
  if (typeof value === 'string' || typeof value === 'number') process.stdout.write(String(value));
  else process.stdout.write(fallback);
} catch { process.stdout.write(fallback); }
NODE
}

target_precommit_json() {
  TARGET_PRECOMMIT_STATUS="${TARGET_PRECOMMIT_STATUS:-skipped}" \
  TARGET_PRECOMMIT_HOOK="${TARGET_PRECOMMIT_HOOK:-}" \
  TARGET_PRECOMMIT_RC="${TARGET_PRECOMMIT_RC:-}" \
  TARGET_PRECOMMIT_TAIL="${TARGET_PRECOMMIT_TAIL:-}" node -e '
    const p = process.env;
    process.stdout.write(JSON.stringify({
      status: p.TARGET_PRECOMMIT_STATUS,
      hook: p.TARGET_PRECOMMIT_HOOK || null,
      rc: /^-?[0-9]+$/.test(p.TARGET_PRECOMMIT_RC || "") ? Number(p.TARGET_PRECOMMIT_RC) : null,
      tail: p.TARGET_PRECOMMIT_TAIL || ""
    }));
  '
}

run_target_precommit() {
  local base="$1" tip="$2" setting timeout_s top hooks_path hook hook_rel tmp out rc=0 git_dir index_path cfg_path
  TARGET_PRECOMMIT_STATUS="skipped"; TARGET_PRECOMMIT_HOOK=""; TARGET_PRECOMMIT_RC=""; TARGET_PRECOMMIT_TAIL="no new commits"
  [ "${AUTOPILOT_TARGET_PRECOMMIT_TEST_SKIP:-0}" = 1 ] && { TARGET_PRECOMMIT_TAIL="disabled by test negative control"; return 0; }
  [ -n "$base" ] && [ -n "$tip" ] && [ "$base" != "$tip" ] || return 0
  setting="$(target_precommit_setting target_precommit AUTOPILOT_TARGET_PRECOMMIT on)"
  if [ "$setting" = off ]; then TARGET_PRECOMMIT_TAIL="disabled by AUTOPILOT_TARGET_PRECOMMIT/config"; return 0; fi
  timeout_s="$(target_precommit_setting target_precommit_timeout_s AUTOPILOT_TARGET_PRECOMMIT_TIMEOUT_S 300)"
  [[ "$timeout_s" =~ ^[1-9][0-9]{0,4}$ ]] || timeout_s=300
  [ "$timeout_s" -le 86400 ] || timeout_s=300
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || { TARGET_PRECOMMIT_TAIL="target repository root unavailable"; return 0; }
  hooks_path="$(git -C "$top" config --local --path core.hooksPath 2>/dev/null || true)"
  if [ -n "$hooks_path" ]; then
    case "$hooks_path" in /*) hooks_path="$hooks_path" ;; *) hooks_path="$top/$hooks_path" ;; esac
    hook="$hooks_path/pre-commit"
  else
    hook="$(git -C "$top" rev-parse --path-format=absolute --git-path hooks/pre-commit 2>/dev/null || true)"
  fi
  [ -n "$hook" ] && [ -f "$hook" ] && [ -x "$hook" ] || { TARGET_PRECOMMIT_STATUS="absent"; TARGET_PRECOMMIT_TAIL="no executable regular pre-commit hook"; return 0; }
  hook_rel="$(realpath --relative-to="$top" "$hook" 2>/dev/null || printf '%s' "$hook")"
  TARGET_PRECOMMIT_HOOK="$hook_rel"
  if [ "$top" = "$(cd "$SELF_DIR/.." && pwd -P)" ] && [ "$hook" = "$top/.githooks/pre-commit" ]; then
    TARGET_PRECOMMIT_STATUS="skipped"; TARGET_PRECOMMIT_TAIL="autopilot .githooks/pre-commit gates run at merge"; return 0
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/autopilot-target-precommit-XXXXXX")" || { TARGET_PRECOMMIT_STATUS="fail"; TARGET_PRECOMMIT_RC=1; TARGET_PRECOMMIT_TAIL="could not create temporary worktree directory"; return 0; }
  rmdir "$tmp" 2>/dev/null || true
  out="${tmp}.hook-output"; cfg_path="${tmp}.git-config"
  if ! git -C "$top" worktree add --detach "$tmp" "$base" >"$out" 2>&1; then
    rc=1
  elif { [ "${SCRATCH:-0}" -eq 1 ] && ! git -C "$tmp" read-tree --reset -u "$tip" >>"$out" 2>&1; } \
    || { [ "${SCRATCH:-0}" -ne 1 ] && ! git -C "$tmp" read-tree -m -u "$tip" >>"$out" 2>&1; }; then
    rc=1
  else
    git_dir="$(git -C "$tmp" rev-parse --absolute-git-dir 2>/dev/null)"
    index_path="$(git -C "$tmp" rev-parse --path-format=absolute --git-path index 2>/dev/null)"
    timeout --signal=TERM --kill-after=2 "${timeout_s}s" env GIT_DIR="$git_dir" GIT_WORK_TREE="$tmp" GIT_INDEX_FILE="$index_path" \
      bash -c 'cd "$1" && exec "$2"' bash "$tmp" "$hook" </dev/null >>"$out" 2>&1 || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then TARGET_PRECOMMIT_STATUS="pass"; else
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then TARGET_PRECOMMIT_STATUS="timeout"; else TARGET_PRECOMMIT_STATUS="fail"; fi
    TARGET_PRECOMMIT_RC="$rc"
  fi
  TARGET_PRECOMMIT_TAIL="$(node - "$SELF_DIR/../hooks/_shared/secret-patterns.js" "$out" <<'NODE'
const fs = require('fs');
const secrets = require(process.argv[2]);
const text = secrets.redactOutput(fs.readFileSync(process.argv[3], 'utf8'));
process.stdout.write(text.split(/\r?\n/).slice(-20).join('\n'));
NODE
  )"
  git -C "$top" worktree remove --force "$tmp" >/dev/null 2>&1 || true
  git -C "$top" worktree prune >/dev/null 2>&1 || true
  rm -f -- "$out" "$cfg_path"
}

# sandbox_json: the `sandbox` object for the result JSON and the manifest.
sandbox_json() {
  local denied="\"unknown\"" tmp="${SANDBOX_TMP_PATH:-<per-dispatch scratch dir>}"
  [[ "${SANDBOX_DENIED:-}" =~ ^[0-9]+$ ]] && denied="$SANDBOX_DENIED"
  printf '{"mode":"bwrap","writable":["%s","%s"],"denied_writes":%s}' \
    "$(_flat_json_escape "${SANDBOX_WT_PATH:-${WT:-}}")" "$(_flat_json_escape "$tmp")" "$denied"
}

# The endpoint pre-probe (scripts/lib/endpoint-probe.sh) found the local endpoint down or busy BEFORE any
# worker or worktree was opened. Same result the post-hoc classifier gives a dead worker
# (status engine_unavailable, "engine unavailable (<class>)"). Exit 1 like every engine_unavailable.
# dispatcher_called stays true (the engine rejects dispatcher_called:false on a non-committed result
# before it reads engine_unavailable); model_calls 0 and resources_created 0 say that no worker ran.
# A configured cloud-fallback already re-exec'd before this runs. This die is the ask path, a missing
# rung, or a retreat that could not start — and a failed retreat still carries fell_back.
die_probe_unavailable() {
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  hetero_log_fallback "engine_unavailable"
  printf '{ "status": "engine_unavailable", "runner": "%s", "model": "%s", "containment": "%s", "contained": %s, "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "engine unavailable (%s): endpoint pre-probe %s: %s; no worker started", "dispatcher_called": true, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "duplex": null, "retention_lease": null, "usage": null, "num_turns": null, "probe": %s%s }\n' \
    "$(current_runner_name)" "$(_flat_json_escape "$MODEL")" "$CONTAINMENT" "$([ "${CONTAINED:-0}" -eq 1 ] && echo true || echo false)" \
    "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$PROBE_CLASS" "$(_flat_json_escape "$ENDPOINT")" "$(_flat_json_escape "$PROBE_REASON")" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$run_id_json" "$PROBE_JSON" "$(fell_back_json_suffix)"
  exit 1
}

# BL-0435 / PM 01M7AHAM: one re-exec onto cloud_fallback_rung (or pace-roles priority.implementer
# when cloud_fallback_rung is unset; never codex) when pre-probe is unreachable or busy.
# Returns 1 when this death stays engine_unavailable (ask, no rung, campaign, already retreated).
# Does not return on a retreat: the child process's stdout is the result. Never invents a seat.
hetero_endpoint_cloud_fallback() {
  [ "${AUTOPILOT_HETERO_FELL_BACK:-}" = "1" ] && return 1
  [ -n "${CAMPAIGN_CONTRACT_FILE:-}" ] && return 1
  local errf pick_errf resolved rc parsed policy engine effort runner target_endpoint to_rung cur_runner
  cur_runner="$(current_runner_name)"
  errf="$(mktemp -t dispatch-hetero-fb-resolve-XXXXXX)" || return 1
  resolved="$("$SELF_DIR/resolve-review-loop.sh" 2>"$errf")"
  rc=$?
  rm -f "$errf"
  [ "$rc" -eq 0 ] && [ -n "$resolved" ] || return 1
  parsed="$(node -e '
let j; try { j = JSON.parse(process.argv[1]); } catch { process.exit(2); }
const s = (v) => (v == null ? "" : String(v));
const policy = s(j.on_engine_unavailable) || "cloud-fallback";
const rung = j.cloud_fallback_rung;
let re = "", rf = "", rr = "", ep = "";
if (rung && typeof rung === "object" && !Array.isArray(rung)) {
  re = s(rung.engine); rf = s(rung.effort); rr = s(rung.runner); ep = s(rung.endpoint);
}
const clean = (v) => String(v).replace(/[|\n\r]/g, " ");
process.stdout.write([policy, re, rf, rr, ep].map(clean).join("|"));
' "$resolved" 2>/dev/null)" || return 1
  IFS='|' read -r policy engine effort runner target_endpoint <<< "$parsed"
  [ "$policy" = "cloud-fallback" ] || return 1
  # Restricted-operator rungs that fail the current brief/sandbox check are dropped before fallback selection.
  if [ -n "$engine" ] && ! node "$SELF_DIR/lib/cn-model-dispatch-gate.js" check --runner "$runner" --model "$engine" ${target_endpoint:+--endpoint "$target_endpoint"} --cwd "$(pwd)" ${SOURCE_REPO:+--source-repo "$SOURCE_REPO"} --prompt-file "${VISION_PROMPT_FILE:-$PROMPT_FILE}" >/dev/null 2>&1; then
    engine=""; effort=""; runner=""; target_endpoint=""
  fi
  case "$(printf '%s' "${runner:-}" | tr '[:upper:]' '[:lower:]')" in
    codex)
      engine=""
      effort=""
      runner=""
      target_endpoint=""
      ;;
  esac
  local fb_demoted_json="[]"
  if [ -z "$engine" ] || [ -z "$effort" ] || [ -z "$runner" ]; then
    local pick_parsed=""
    pick_errf="$(mktemp -t dispatch-hetero-fb-preflight-XXXXXX)" || return 1
    pick_parsed="$(node -e '
const sf = require(process.argv[1]);
const plan = sf.implementerFallbackPlan({
  failedRunner: process.argv[2],
  failedModel: process.argv[3],
  failedEndpoint: process.argv[4],
});
const gate = require(process.argv[6]);
const eligible = plan.chain.filter((r) => gate.check({ runner: r.runner, model: r.model, endpoint: r.endpoint, cwd: process.cwd(), files: [process.argv[5]], sourceRepo: process.env.SOURCE_REPO || undefined }).allowed);
if (!eligible.length) process.exit(1);
const ep = require(process.argv[7]);
const pre = ep.preflight({ candidates: eligible, fallbackOnAllSkipped: true, preferBurnMore: true, localFirst: true });
const rung = eligible.find((r) => r.runner === pre.chosen.runner && r.model === pre.chosen.model);
if (!rung) process.exit(1);
process.stdout.write([rung.model, rung.effort, rung.runner, rung.endpoint || "", JSON.stringify(plan.demoted || []), JSON.stringify(pre)].join("|"));
' "$SELF_DIR/lib/seat-fallback.js" "$cur_runner" "${MODEL:-}" "${ENDPOINT:-}" "${VISION_PROMPT_FILE:-$PROMPT_FILE}" "$SELF_DIR/lib/cn-model-dispatch-gate.js" "$SELF_DIR/lib/engine-preflight.js" 2>"$pick_errf")" || { rm -f "$pick_errf"; return 1; }
    rm -f "$pick_errf"
    IFS='|' read -r engine effort runner target_endpoint fb_demoted_json ENGINE_PREFLIGHT_JSON <<< "$pick_parsed"
    ENGINE_PREFLIGHT_LOG_LINE="$(node -e 'const j=JSON.parse(process.argv[1]);const w=j.warnings.find(x=>x.startsWith("capacity_table_"));if(w)process.stdout.write(`engine-preflight: capacity table ${w==="capacity_table_stale"?"stale":w==="capacity_table_unparseable"?"unparseable":"missing"}, using default order`);else process.stdout.write(`engine-preflight: read ${j.table_path} generated_at=${j.generated_at}; ${j.skipped.map(x=>`skipped ${x.runner}:${x.model} (${x.reason})`).join(", ")}${j.skipped.length?"; ":""}chosen ${j.chosen.runner}:${j.chosen.model}`)' "$ENGINE_PREFLIGHT_JSON" 2>/dev/null || true)"
    [ -z "$ENGINE_PREFLIGHT_LOG_LINE" ] || echo "$ENGINE_PREFLIGHT_LOG_LINE" >&2
  fi
  [ -n "$engine" ] && [ -n "$effort" ] && [ -n "$runner" ] || return 1
  case "$runner" in
    agy|grok|cursor|kimi) ;;
    cc-shim) [ -n "${target_endpoint:-}" ] || return 1 ;;
    *) return 1 ;;
  esac
  to_rung="${engine}/${effort}@${runner}${target_endpoint:+#${target_endpoint}}"
  FELL_BACK_JSON="$(node -e '
const sf = require(process.argv[7]);
let probe = null;
try { probe = JSON.parse(process.argv[1]); } catch { probe = null; }
let demoted = [];
try { demoted = JSON.parse(process.argv[8] || "[]"); } catch { demoted = []; }
const from = [process.argv[6] || "", process.argv[2] || ""].filter(Boolean).join("@")
  + (process.argv[3] ? `#${process.argv[3]}` : "");
process.stdout.write(JSON.stringify({
  from_runner: process.argv[2],
  from_model: process.argv[6] || null,
  from_endpoint: process.argv[3] || null,
  error_class: process.argv[4],
  to_rung: process.argv[5],
  fallback: sf.buildFallbackRecord({
    from: from || process.argv[3] || process.argv[2],
    to: process.argv[5],
    reason: process.argv[4] || "engine_unavailable",
    demoted,
  }),
  probe,
}));
' "$PROBE_JSON" "$cur_runner" "$ENDPOINT" "$PROBE_CLASS" "$to_rung" "${MODEL:-}" "$SELF_DIR/lib/seat-fallback.js" "${fb_demoted_json:-[]}")" || return 1
  [ -n "$FELL_BACK_JSON" ] || return 1
  echo "dispatch-hetero: endpoint pre-probe ${ENDPOINT}: ${PROBE_DECISION}; retreating once to cloud rung ${to_rung} (on_engine_unavailable: cloud-fallback)" >&2
  local -a args=()
  local i=0 a saw_runner=0 saw_model=0 saw_effort=0 saw_ep=0
  while [ "$i" -lt "${#ORIG_ARGS[@]}" ]; do
    a="${ORIG_ARGS[$i]}"
    case "$a" in
      --endpoint)
        if [ -n "${target_endpoint:-}" ]; then
          args+=(--endpoint "$target_endpoint"); saw_ep=1
        fi
        i=$((i + 2)) ;;
      --endpoint=*)
        if [ -n "${target_endpoint:-}" ]; then
          args+=(--endpoint "$target_endpoint"); saw_ep=1
        fi
        i=$((i + 1)) ;;
      --runner) args+=(--runner "$runner"); saw_runner=1; i=$((i + 2)) ;;
      --model) args+=(--model "$engine"); saw_model=1; i=$((i + 2)) ;;
      --effort) args+=(--effort "$effort"); saw_effort=1; i=$((i + 2)) ;;
      --sandbox|--worktree-parent) # BL-0435 keep the caller bwrap on this one re-exec
        args+=("$a" "${ORIG_ARGS[$((i + 1))]}")
        i=$((i + 2)) ;;
      *)
        # Dropped here only when the keep arm above does not match, so a broken keep is visible.
        case "$a" in
          --sandbox|--worktree-parent) i=$((i + 2)) ;;
          *) args+=("$a"); i=$((i + 1)) ;;
        esac ;;
    esac
  done
  [ "$saw_runner" -eq 1 ] || args+=(--runner "$runner")
  [ "$saw_model" -eq 1 ] || args+=(--model "$engine")
  [ "$saw_effort" -eq 1 ] || args+=(--effort "$effort")
  if [ -n "${target_endpoint:-}" ] && [ "$saw_ep" -eq 0 ]; then
    args+=(--endpoint "$target_endpoint")
  fi
  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
  export AUTOPILOT_HETERO_PIN_ORIGIN="$PINNED"
  export AUTOPILOT_HETERO_FELL_BACK=1
  export AUTOPILOT_HETERO_FELL_BACK_JSON="$FELL_BACK_JSON"
  exec "$0" "${args[@]}" < /dev/null
  return 1
}

# Implicit local default only: the slot was taken between the free-slot check and
# the call. One re-exec onto the cloud default (grok-4.7). Explicit --runner local
# never takes this path (IMPLICIT_LOCAL_DEFAULT stays 0).
redispatch_cloud_default_busy() {
  [ "${IMPLICIT_LOCAL_DEFAULT:-0}" = "1" ] || return 1
  [ "${LOCAL_BUSY_REDISPATCH:-}" = "1" ] && return 1
  [ "${RUNNER_SUPPLIED:-0}" = "0" ] || return 1
  local -a args=()
  local i=0 a
  while [ "$i" -lt "${#ORIG_ARGS[@]}" ]; do
    a="${ORIG_ARGS[$i]}"
    case "$a" in
      --runner|--model|--endpoint|--effort) i=$((i + 2)) ;;
      --runner=*|--model=*|--endpoint=*|--effort=*) i=$((i + 1)) ;;
      *) args+=("$a"); i=$((i + 1)) ;;
    esac
  done
  args+=(--runner grok --model grok-4.7)
  # The failed local attempt already owns a worktree. Reuse it after emit has
  # restored identity; do not start a second branch. Pre-probe busy has no worktree.
  if [ -n "${WT:-}" ] && [ -d "${WT:-}" ]; then
    if [ -n "${WT_LOCK_FD:-}" ]; then
      exec {WT_LOCK_FD}>&- || true
      WT_LOCK_FD=""
    fi
    if [ -n "${WT_BUDGET_LOCK_FD:-}" ]; then
      exec {WT_BUDGET_LOCK_FD}>&- || true
      WT_BUDGET_LOCK_FD=""
    fi
    local _inst=""
    _inst="$(node - "$WT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const worktree = path.resolve(process.argv[2]);
const stat = fs.statSync(worktree, { bigint: true });
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({
  birthtime_ns: stat.birthtimeNs.toString(),
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  schema: 1,
  worktree,
})).digest('hex'));
NODE
)" || true
    args+=(--reuse-worktree "$WT")
    [ -n "$_inst" ] && args+=(--expected-worktree-instance "$_inst")
    [ -n "${WORKTREE_ROOT_RUN_ID:-}" ] && export AUTOPILOT_WORKTREE_ROOT_RUN_ID="$WORKTREE_ROOT_RUN_ID"
  fi
  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
  export AUTOPILOT_HETERO_PIN_ORIGIN="$PINNED"
  export LOCAL_BUSY_REDISPATCH=1
  export AUTOPILOT_LOCAL_FALLBACK_PRESET='{"reason":"no_free_slot","detail":"busy_at_run"}'
  release_local_lease || true
  exec "$0" "${args[@]}" < /dev/null
  return 1
}

# Called only after emit returns, so identity restoration and the result row finish first.
maybe_redispatch_cloud_busy() {
  [ "${1:-}" = "engine_unavailable" ] || return 1
  [ "${CLASSIFIED_ERROR:-}" = "endpoint_busy" ] || return 1
  redispatch_cloud_default_busy
}

die_dev_flow_admission() {
  printf '{ "status": "blocked", "phase": "dev_flow_admission", "rejection_code": "DEV_FLOW_ADMISSION_REQUIRED_OR_STALE", "reason": "%s", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "resources_created": 0 }\n' \
    "$(_flat_json_escape "$1")"
  exit 2
}

emit_mission_noop() {
  printf '{ "status": "no_op", "runner": "mission-admission", "model": null, "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "mission_noop": true, "graph_node_id": "%s", "noop_receipt_digest": "%s", "skill_mode_effective": "off", "skills_injected": [], "retention_lease": null }\n' \
    "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$(_flat_json_escape "$MISSION_NOOP_GRAPH_NODE")" "$MISSION_NOOP_RECEIPT_DIGEST"
  exit 0
}

emit_sealed_zero_diff_if_authorized() {
  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ -n "${CONTRACT_FILE:-}" ] && [ -r "$CONTRACT_FILE" ] || return 0
  [ -z "${STRICT_NOOP_RECEIPT_PATH:-}" ] \
    || die_precondition "ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
  local repo base_sha result rc validator
  repo="${CONSUMING_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
  [ -n "$repo" ] || die_precondition "sealed zero-diff admission requires repository root"
  base_sha="$(git -C "$repo" rev-parse "${BASE}^{commit}" 2>/dev/null)" \
    || die_precondition "sealed zero-diff admission cannot resolve immutable base"
  # Single production sealed zero-diff validator (D2 A06) — shared with
  # dispatch-contract.js and campaign-dispatch-projection.js.
  validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
  if result="$(
    node "$validator" validate \
      --contract "$CONTRACT_FILE" \
      --repo "$repo" \
      --base "$base_sha" \
      --verify-bytes \
      ${MISSION_NOOP_RECEIPT_DIGEST:+--mission-noop-digest "$MISSION_NOOP_RECEIPT_DIGEST"} \
      ${MISSION_NOOP_GRAPH_NODE:+--mission-noop-node "$MISSION_NOOP_GRAPH_NODE"}
  )"; then
    printf '{ "status": "no_op", "runner": "sealed-zero-diff-admission", "model": null, "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": "%s", "skill_mode_effective": "off", "skills_injected": [], "retention_lease": null }\n' \
      "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$result"
    exit 0
  else
    rc=$?
  fi
  [ "$rc" -eq 3 ] && return 0
  die_precondition "sealed zero_diff_receipt rejected before effects: ${result:-verification_failed}"
}

die_resource_budget() {
  local count="$1" limit="$2"
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && runner="claude-native"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && runner="local"
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "resource_budget exhausted", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "resource_budget": { "resource": "leaf_worktrees", "root_run_id": "%s", "count": %s, "limit": %s }, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": "%s", "duplex": null, "usage": null, "num_turns": null }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" \
    "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$WORKTREE_ROOT_RUN_ID")" \
    "$count" "$limit" "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" \
    "$(_flat_json_escape "$DISPATCH_RUN_ID")"
  exit 2
}

# seal_runner_prompt_bytes <file> — scan and hash the exact bytes one runner will read.
# The early PROMPT_FILE scan stays. This second scan covers the banner plus the prompt
# (or the raw file, when that runner reads it unchanged). A hit refuses before spawn.
# PROMPT_SHA256_SEALED is what write_manifest records, including the later finalize.
seal_runner_prompt_bytes() {
  local file="$1" cats="" rc=0 _psha=""
  [ -n "$file" ] && [ -f "$file" ] || die_precondition "outbound_secret: unreadable"
  cats="$(node "$SELF_DIR/lib/outbound-secret-scan.js" --categories "$file")"; rc=$?
  if [ "$rc" -ne 0 ]; then
    die_precondition "outbound_secret: ${cats:-unreadable}"
  fi
  _psha="$(sha256sum -- "$file" 2>/dev/null | awk 'NR==1 { print $1 }')"
  [[ "$_psha" =~ ^[0-9a-f]{64}$ ]] || die_precondition "outbound_secret: prompt digest failed"
  PROMPT_SHA256_SEALED="$_psha"
  write_manifest "${MANIFEST_PID_RECORDED:-$$}"
}

# write_manifest [pid] — (re)write the run manifest atomically. Best-effort: ANY failure
# is swallowed (the manifest is a telemetry sidecar, never a dispatch dependency).
# Called at three points: pre-dispatch (parent pid), detached-child start (child pid —
# the parent pid dies with a killed caller while the child lives on), and finalize.
write_manifest() {
  [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" = "0" ] && return 0
  [ -n "${DISPATCH_RUN_ID:-}" ] || return 0
  declare -F runs_dir_ensure >/dev/null 2>&1 || return 0
  runs_dir_ensure || return 0
  MANIFEST_DIR_PATH="$RUNS_DIR_ENSURED"
  [ -n "$MANIFEST_DIR_PATH" ] || return 0 # never build a manifest path from an empty directory (it would land in the cwd or at the root)
  [ -n "${1:-}" ] && MANIFEST_PID_RECORDED="$1"
  local safe_id; safe_id="$(printf '%s' "$DISPATCH_RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
  MANIFEST_FILE="$MANIFEST_DIR_PATH/${safe_id}.manifest.json"
  local tmp="$MANIFEST_FILE.tmp.$$"
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && runner="local"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && runner="claude-native"
  # log_format = dispatcher-DECLARED stream format (see emit(): codex chrome text /
  # grok --output-format json / agy response-only plain log with a separate private
  # native envelope / cc-shim plain).
  # dispatch-status.js trusts this
  # over content sniffing so worker output can never self-report telemetry.
  local log_format="plain"
  [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
  [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
  [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
  [ "${IS_CURSOR:-0}" -eq 1 ] && log_format="jsonl"
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  local scope_json="null"; [ -n "${MANIFEST_SCOPE_UNIT:-}" ] && scope_json="\"$(_flat_json_escape "$MANIFEST_SCOPE_UNIT")\""
  local ledger_json="null"; [ -n "${LEDGER:-}" ] && ledger_json="\"$(_flat_json_escape "$LEDGER")\""
  local stage_json="null"; [ -n "${STAGE:-}" ] && stage_json="\"$(_flat_json_escape "$STAGE")\""
  local pid_json="null"; [ -n "${MANIFEST_PID_RECORDED:-}" ] && pid_json="$MANIFEST_PID_RECORDED"
  local ended_json="null" endep_json="null" final_json="null"
  [ -n "${MANIFEST_ENDED_AT:-}" ] && ended_json="\"$MANIFEST_ENDED_AT\""
  [ -n "${MANIFEST_ENDED_EPOCH:-}" ] && endep_json="$MANIFEST_ENDED_EPOCH"
  [ -n "${MANIFEST_FINAL_STATUS:-}" ] && final_json="\"$(_flat_json_escape "$MANIFEST_FINAL_STATUS")\""
  local parent_json="null"; [ -n "${LINEAGE_PARENT:-}" ] && parent_json="\"$(_flat_json_escape "$LINEAGE_PARENT")\""
  local root_json="null"; [ -n "${LINEAGE_JOB_ROOT:-${LINEAGE_ROOT:-}}" ] && root_json="\"$(_flat_json_escape "${LINEAGE_JOB_ROOT:-$LINEAGE_ROOT}")\""
  local depth_json="${LINEAGE_DEPTH:-0}"; case "$depth_json" in *[!0-9]*|"") depth_json=0 ;; esac; depth_json=$((10#$depth_json))
  # repo_identity (mods P1a R1): this rail has no --repo-root; CONSUMING_REPO_ROOT (set on the
  # strict-contract paths) else the cwd's toplevel. Cached in REPO_IDENTITY_FIELDS, which
  # crosses the detach boundary via declare -p.
  if declare -F repo_identity_resolve_fields >/dev/null 2>&1; then repo_identity_resolve_fields "" "${CONSUMING_REPO_ROOT:-}" || true; fi
  [ -n "${REPO_IDENTITY_FIELDS:-}" ] || REPO_IDENTITY_FIELDS='"repo_identity": null, "repo_identity_source": null'
  local strict_manifest_fields=""
  local scratch_manifest_field=""
  if [ "${SCRATCH:-0}" -eq 1 ]; then
    scratch_manifest_field=", \"scratch\": {\"dir\": \"$(_flat_json_escape "${SCRATCH_DIR:-}")\", \"files\": ${SCRATCH_FILES:-0}, \"gate_result\": \"allowed\", \"base\": \"orphan\", \"rejected_manifest\": \"$(_flat_json_escape "${SCRATCH_REJECTED_FILE:-}")\"}"
  fi
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    strict_manifest_fields=", \"unit_id\": \"$(_flat_json_escape "$STRICT_UNIT_ID")\", \"contract_sha256\": \"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\", \"go\": \"$(_flat_json_escape "$STRICT_GO")\""
  fi
  # FINDING 6 fix: only present when seat_strike_capture actually suppressed a
  # would-have-fired strike under AUTOPILOT_STRIKE_WRITER=off — absent (not just
  # false) in the default-on case, so the field's mere presence is the signal.
  local strike_suppressed_fields=""
  if [ "${STRIKE_WRITER_SUPPRESSED:-}" = "1" ]; then
    strike_suppressed_fields=", \"strike_writer_suppressed\": true, \"strike_writer_suppressed_seat\": \"$(_flat_json_escape "$STRIKE_WRITER_SUPPRESSED_SEAT")\""
  fi
  # Present only when a strike or passive-capture write was skipped because a
  # non-PATH --*-bin override had no isolated store (2026-10-19).
  local capability_suppressed_fields=""
  if [ -n "${CAPABILITY_WRITE_SUPPRESSED:-}" ]; then
    capability_suppressed_fields=", \"capability_write_suppressed\": \"$(_flat_json_escape "$CAPABILITY_WRITE_SUPPRESSED")\""
  fi
  local effort_manifest_fields=""
  [ -z "${EFFORT_SENT:-}" ] || effort_manifest_fields=", \"effort\": \"$(_flat_json_escape "$EFFORT_SENT")\""
  local pin_json=null pinned_json="$PINNED"
  [ "$PINNED" = false ] || [ "$PIN_REASON_SUPPLIED" -eq 0 ] || pin_json="\"$(_flat_json_escape "$PIN_REASON")\""
  local role_kit_manifest_fields=", \"pinned\": $pinned_json, \"pin_reason\": $pin_json"
  [ "${ROLE_KIT_ACTIVE:-0}" -eq 1 ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"role_kit\": $ROLE_KIT_JSON"
  [ -z "${ROLE_KIT_SKIPPED_JSON:-}" ] || role_kit_manifest_fields="$role_kit_manifest_fields, \"role_kit\": null, \"role_kit_skipped\": $ROLE_KIT_SKIPPED_JSON"
  [ "${SANDBOX:-off}" = "bwrap" ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"sandbox\": $(sandbox_json)"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"resolved_runner\": \"cc-shim\", \"endpoint\": \"$(_flat_json_escape "$ENDPOINT")\""
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && [ -n "${GATEWAY_TOKEN_SOURCE:-}" ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"gateway_token\": \"$(_flat_json_escape "$GATEWAY_TOKEN_SOURCE")\""
  [ -n "${FELL_BACK_JSON:-}" ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"fell_back\": $FELL_BACK_JSON"
  [ -n "${ENGINE_CHOICE_JSON:-}" ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"engine_choice\": $ENGINE_CHOICE_JSON"
  [ -n "${PACE_CHOICE_JSON:-}" ] && role_kit_manifest_fields="$role_kit_manifest_fields, \"pace_choice\": $PACE_CHOICE_JSON"
  local mf_timeout_secs="" mf_timeout_source="default" mf_timeout_enforced="false"
  mf_timeout_secs="$(normalize_timeout_seconds "${TIMEOUT:-}" 2>/dev/null || true)"
  [ -n "$mf_timeout_secs" ] || mf_timeout_secs="null"
  if [ -n "${TIMEOUT_SOURCE:-}" ]; then
    mf_timeout_source="$TIMEOUT_SOURCE"
    mf_timeout_enforced="true"
  fi
  [ "${WATCHDOG_DISARMED:-0}" -eq 1 ] && mf_timeout_enforced="false"
  # Present only for an enforce admission via --no-campaign. Absent otherwise,
  # so a sealed campaign or an off/shadow run stays byte-identical.
  local campaign_scope_fields=""
  if [ "${NO_CAMPAIGN:-0}" -eq 1 ] && [ -n "${MISSION_ENFORCEMENT_MODE_SEEN:-}" ]; then
    campaign_scope_fields=", \"campaign_scope\": \"none_declared\", \"enforcement_mode\": \"$(_flat_json_escape "$MISSION_ENFORCEMENT_MODE_SEEN")\""
  fi
  campaign_scope_fields="$campaign_scope_fields, \"mount_containment\": \"${MANIFEST_MOUNT_CONTAINMENT:-refused}\", \"shed\": ${SHED_ROUTE_MANIFEST_JSON:-null}"
  # Compact tip_verify for the manifest. The result JSON keeps the command
  # tails; this write (including the finalize that stamps final_status) keeps
  # only the status scalar and the source. Inline so detach's declare -f of
  # write_manifest carries it. Stdin, not an env copy of the result: a tail
  # can contain $(...) and must not be re-expanded.
  local tip_verify_json="null" tip_verify_source_json="null"
  if [ -n "${TIP_VERIFY_RESULT_JSON:-}" ]; then
    local _tv_pair=""
    _tv_pair="$(printf '%s' "${TIP_VERIFY_RESULT_JSON}" | TIP_SRC="${TIP_VERIFY_SOURCE:-}" node -e '
      const src = process.env.TIP_SRC || "";
      const statuses = new Set(["pass", "fail", "timeout"]);
      const strings = new Set(["no_source", "skipped_by_flag"]);
      const sources = new Set(["flag", "brief", "repo_config"]);
      let raw = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => { raw += d; });
      process.stdin.on("end", () => {
        let tip = null;
        let source = null;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (typeof parsed === "string") {
          if (strings.has(parsed)) tip = parsed;
        } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (statuses.has(parsed.status)) {
            tip = parsed.status;
            if (sources.has(src)) source = src;
          }
        }
        process.stdout.write(JSON.stringify(tip) + "\n" + JSON.stringify(source) + "\n");
      });
    ' 2>/dev/null)" || _tv_pair=""
    if [ -n "$_tv_pair" ]; then
      tip_verify_json="$(printf '%s\n' "$_tv_pair" | sed -n '1p')"
      tip_verify_source_json="$(printf '%s\n' "$_tv_pair" | sed -n '2p')"
    fi
    printf '%s\n' "$tip_verify_json" | grep -Eq '^(null|"pass"|"fail"|"timeout"|"no_source"|"skipped_by_flag")$' || tip_verify_json="null"
    printf '%s\n' "$tip_verify_source_json" | grep -Eq '^(null|"flag"|"brief"|"repo_config")$' || tip_verify_source_json="null"
  fi
  # sha256 of the bytes this runner actually reads (banner + prompt when the runner
  # gets a banner). Sealed just before spawn. Before that, the scanned PROMPT_FILE.
  # Absent file stays JSON null. The digest is hex, so it needs no further escaping.
  local prompt_sha_json="null"
  if [[ "${PROMPT_SHA256_SEALED:-}" =~ ^[0-9a-f]{64}$ ]]; then
    prompt_sha_json="\"$PROMPT_SHA256_SEALED\""
  elif [ -n "${PROMPT_FILE:-}" ] && [ -f "$PROMPT_FILE" ]; then
    local _psha=""
    _psha="$(sha256sum -- "$PROMPT_FILE" 2>/dev/null | awk 'NR==1 { print $1 }')"
    if [[ "$_psha" =~ ^[0-9a-f]{64}$ ]]; then
      prompt_sha_json="\"$_psha\""
    fi
  fi
  {
    printf '{ "schema": 1, "run_id": "%s", "role": "implementer", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "base_sha": "%s", "worktree": "%s", "lock_path": "%s", "log_path": "%s", "log_format": "%s", "duplex": %s, "aux_log": null, "pid": %s, "scope_unit": %s, "containment_planned": "%s", "started_at": "%s", "started_epoch": %s, "prompt_file": "%s", "prompt_sha256": %s, "lane": %s, "scaffold_tier": "%s", "ledger": %s, "stage": %s, "ended_at": %s, "ended_epoch": %s, "final_status": %s, "tip_verify": %s, "tip_verify_source": %s, "parent_run_id": %s, "root_run_id": %s, "depth": %s, "timeout_seconds": %s, "timeout_source": "%s", "timeout_enforced": %s%s%s%s%s%s, %s, "session_id": %s, "child_session_id": %s, "target_precommit": %s%s }\n' \
      "$(_flat_json_escape "$DISPATCH_RUN_ID")" "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
      "${BASE_SHA:-}" "$(_flat_json_escape "${WT:-}")" "$(_flat_json_escape "${WT:-}/.autopilot-worktree.lock")" "$(_flat_json_escape "${LOG:-}")" \
      "$log_format" "$duplex_json" "$pid_json" "$scope_json" "${MANIFEST_CONTAINMENT:-plain}" \
      "$DISPATCH_STARTED_AT" "${DISPATCH_STARTED_EPOCH:-null}" "$(_flat_json_escape "${PROMPT_FILE:-}")" "$prompt_sha_json" "${DISPATCH_LANE_JSON:-null}" "${SCAFFOLD_TIER_EFFECTIVE:-off}" \
      "$ledger_json" "$stage_json" "$ended_json" "$endep_json" "$final_json" "$tip_verify_json" "$tip_verify_source_json" "$parent_json" "$root_json" "$depth_json" \
      "$mf_timeout_secs" "$(_flat_json_escape "$mf_timeout_source")" "$mf_timeout_enforced" "$strict_manifest_fields" "$strike_suppressed_fields" "$capability_suppressed_fields" "$effort_manifest_fields$role_kit_manifest_fields" "$campaign_scope_fields" "$REPO_IDENTITY_FIELDS$(declare -F dispatch_attr_fields >/dev/null 2>&1 && dispatch_attr_fields "${PROMPT_FILE:-}" "$runner" "${ENDPOINT:-}" "${MANIFEST_FINAL_STATUS:+${OUTCOME_COMMIT:-}}")" \
      "$(declare -F manifest_session_id_json >/dev/null 2>&1 && manifest_session_id_json || printf null)" \
      "$(declare -F manifest_child_session_json >/dev/null 2>&1 && manifest_child_session_json || printf null), \"local_fallback\": ${LOCAL_FALLBACK_JSON:-null}, \"local_slots\": ${LOCAL_SLOTS_JSON:-null}, \"local_lease\": $(local_lease_json), \"shed\": ${SHED_ROUTE_MANIFEST_JSON:-null}" \
      "$(target_precommit_json)" "$scratch_manifest_field" > "$tmp"
  } 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  if [ -n "${ENGINE_PREFLIGHT_JSON:-}" ]; then
    node -e 'const fs=require("fs"),f=process.argv[1],v=JSON.parse(process.argv[2]);const j=JSON.parse(fs.readFileSync(f,"utf8"));j.engine_preflight=v;fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$tmp" "$ENGINE_PREFLIGHT_JSON" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  fi
  if [ -n "${MODEL_SUBSTITUTED_JSON:-}" ]; then
    node -e 'const fs=require("fs"),f=process.argv[1],v=JSON.parse(process.argv[2]);const j=JSON.parse(fs.readFileSync(f,"utf8"));j.model_substituted=v;fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$tmp" "$MODEL_SUBSTITUTED_JSON" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  fi
  mv -f "$tmp" "$MANIFEST_FILE" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  return 0
}

# manifest_finalize <final-status> — stamp ended_at/final_status so dispatch-status.js
# reports phase:"exited" even after all processes/locks are gone. Best-effort.
manifest_finalize() {
  [ -n "${MANIFEST_FILE:-}" ] || return 0
  MANIFEST_FINAL_STATUS="${1:-}"
  MANIFEST_ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  MANIFEST_ENDED_EPOCH="$(date +%s)"
  if [ -n "${DISPATCH_STARTED_EPOCH:-}" ] && [ "$MANIFEST_ENDED_EPOCH" -le "$DISPATCH_STARTED_EPOCH" ]; then
    MANIFEST_ENDED_EPOCH="$((DISPATCH_STARTED_EPOCH + 1))"
    MANIFEST_ENDED_AT="$(date -u -d "@$MANIFEST_ENDED_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
  fi
  write_manifest
}

ORIG_ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --source-repo)  SOURCE_REPO="${2:-}"; export SOURCE_REPO; shift 2 ;;
    --scratch) SCRATCH=1; shift ;;
    --scaffold-tier) SCAFFOLD_TIER_ARG="${2:-}"; shift 2 ;;
    --no-campaign) NO_CAMPAIGN=1; shift ;;
    --campaign-contract) CAMPAIGN_CONTRACT_FILE="${2:-}"; shift 2 ;;
    --campaign-contract-sha256) CAMPAIGN_CONTRACT_SHA256="${2:-}"; shift 2 ;;
    --campaign-seal) CAMPAIGN_SEAL_FILE="${2:-}"; shift 2 ;;
    --pin-reason)
      [ $# -ge 2 ] || die_precondition "--pin-reason requires 1..200 characters on one line"
      PIN_REASON="$2"; PIN_REASON_SUPPLIED=1; shift 2 ;;
    --model) MODEL="${2:-}"; MODEL_SUPPLIED=1; MODEL_IS_DEFAULT=0; shift 2 ;;
    --runner) RUNNER="${2:-}"; [ "$RUNNER" = "auto" ] || RUNNER_SUPPLIED=1; shift 2 ;;   # `--runner auto` names no seat: the pool chooses (pace), same as no --runner
    --rc-alarm-label) [ $# -ge 2 ] && [ -n "${2:-}" ] || die_precondition "--rc-alarm-label requires a non-empty label"; RC_ALARM_LABEL="$2"; shift 2 ;;
    --rc-alarm-owner) [ $# -ge 2 ] && [ -n "${2:-}" ] || die_precondition "--rc-alarm-owner requires a non-empty address"; RC_ALARM_OWNER="$2"; shift 2 ;;
    --pace-role)
      [ $# -ge 2 ] && [ -n "${2:-}" ] && [[ "${2:-}" != --* ]] \
        || die_precondition "--pace-role requires a non-empty role"
      PACE_ROLE="$2"; shift 2 ;;
    --pace-role=*)
      PACE_ROLE="${1#--pace-role=}"
      [ -n "$PACE_ROLE" ] || die_precondition "--pace-role requires a non-empty role"
      shift ;;
    --effort) EFFORT="${2:-}"; EFFORT_EXPLICIT=1; shift 2 ;;
    --context-window) CONTEXT_WINDOW_GATE="${2:-}"; shift 2 ;;
    --endpoint) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--endpoint requires a non-empty value"; ENDPOINT="$2"; [ "$ENDPOINT" = "@none" ] && ENDPOINT=""; ENDPOINT_SUPPLIED=1; shift 2 ;;
    --endpoint=*) ENDPOINT="${1#--endpoint=}"; [ -n "$ENDPOINT" ] || die_precondition "--endpoint requires a non-empty value"; [ "$ENDPOINT" = "@none" ] && ENDPOINT=""; ENDPOINT_SUPPLIED=1; shift ;;
    --sandbox) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--sandbox requires off|bwrap"; SANDBOX="$2"; SANDBOX_SUPPLIED=1; shift 2 ;;
    --worktree-parent) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--worktree-parent requires a non-empty directory path"; WORKTREE_PARENT="$2"; shift 2 ;;
    --base) BASE="${2:-}"; BASE_SUPPLIED=1; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; TIMEOUT_SUPPLIED=1; shift 2 ;;
    --idle-timeout) { [ $# -ge 2 ] && [ -n "$2" ]; } || die_precondition "--idle-timeout requires a duration"; IDLE_TIMEOUT="$2"; IDLE_TIMEOUT_SUPPLIED=1; shift 2 ;;
    --hard-timeout) { [ $# -ge 2 ] && [ -n "$2" ]; } || die_precondition "--hard-timeout requires a duration"; HARD_TIMEOUT="$2"; HARD_TIMEOUT_SUPPLIED=1; shift 2 ;;
    --gate-rules) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--gate-rules requires a non-empty file path"; GATE_RULES_FILE="$2"; shift 2 ;;
    --role-kit) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--role-kit requires a non-empty directory path"; ROLE_KIT_DIR="$2"; shift 2 ;;
    --commit-quiet-secs) COMMIT_QUIET_SECS="${2:-}"; shift 2 ;;
    --agy-bin) AGY_BIN="${2:-}"; BIN_FLAG_AGY=1; shift 2 ;;
    --grok-bin) GROK_BIN="${2:-}"; BIN_FLAG_GROK=1; shift 2 ;;
    --pi-bin) PI_BIN="${2:-}"; BIN_FLAG_PI=1; shift 2 ;;
    --codex-bin) CODEX_BIN="${2:-}"; BIN_FLAG_CODEX=1; shift 2 ;;
    --cursor-bin) CURSOR_BIN="${2:-}"; BIN_FLAG_CURSOR=1; shift 2 ;;
    --opencode-bin) OPENCODE_BIN="${2:-}"; BIN_FLAG_OPENCODE=1; shift 2 ;;
    --kimi-bin) KIMI_BIN="${2:-}"; BIN_FLAG_KIMI=1; shift 2 ;;
    --qoder-bin) QODER_BIN="${2:-}"; BIN_FLAG_QODER=1; shift 2 ;;
    --qoder-config-dir) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--qoder-config-dir requires a non-empty directory"; QODER_CONFIG_DIR="$2"; shift 2 ;;
    --cursor-fast) CURSOR_FAST=1; shift ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --verify-cmd)
      [ $# -ge 2 ] && [ -n "${2:-}" ] || die_precondition "--verify-cmd requires a non-empty shell command"
      VERIFY_CMDS+=("$2"); shift 2 ;;
    --verify-timeout)
      [ $# -ge 2 ] && [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die_precondition "--verify-timeout requires a positive integer number of seconds"
      VERIFY_TIMEOUT="$2"; shift 2 ;;
    --no-verify-tip) NO_VERIFY_TIP=1; shift ;;
    --conformance-intent) CONFORMANCE_INTENT_FILE="${2:-}"; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --sibling-ref-prefix)
      case "${2:-}" in
        refs/heads/) die_precondition "--sibling-ref-prefix refs/heads/ would exempt every branch; name the namespace" ;;
        *//*) die_precondition "--sibling-ref-prefix has an empty path segment (got '${2:-}')" ;;
        refs/heads/*/) ;;
        *) die_precondition "--sibling-ref-prefix must look like refs/heads/<namespace>/ (got '${2:-}')" ;;
      esac
      MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES+=("$2"); shift 2 ;;
    --sibling-path-prefix)
      case "${2:-}" in
        ""|/|./|.) die_precondition "--sibling-path-prefix would exempt the whole checkout; name the directory" ;;
        /*) die_precondition "--sibling-path-prefix must be checkout-relative (got '${2:-}')" ;;
        .git|.git/|.git/*) die_precondition "--sibling-path-prefix may not name .git" ;;
        ..|../*|*/..|*/../*) die_precondition "--sibling-path-prefix may not contain .. (got '${2:-}')" ;;
        ./*|*/./*) die_precondition "--sibling-path-prefix may not contain a ./ segment (got '${2:-}')" ;;
        *//*) die_precondition "--sibling-path-prefix has an empty path segment (got '${2:-}')" ;;
        */) ;;
        *) die_precondition "--sibling-path-prefix must look like <dir>/ (got '${2:-}')" ;;
      esac
      MAIN_CHECKOUT_FP_EXCLUDE_PATHS+=("$2"); shift 2 ;;
    --retain-owner) RETENTION_OWNER="${2:-}"; shift 2 ;;
    --retain-reason) RETENTION_REASON="${2:-}"; shift 2 ;;
    --retain-until) RETENTION_EXPIRES_AT="${2:-}"; shift 2 ;;
    --reuse-worktree) REUSE_WORKTREE="${2:-}"; shift 2 ;;
    --expected-worktree-instance) EXPECTED_WORKTREE_INSTANCE="${2:-}"; shift 2 ;;
    --resume-session) RESUME_SESSION_ID="${2:-}"; shift 2 ;;
    --skill-mode) SKILL_MODE="${2:-}"; shift 2 ;;
    --skill) SKILLS+=("${2:-}"); shift 2 ;;
    --store) export ENGINE_CAPABILITY_DIR="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    --continuation-checkpoint) CONTINUATION_CHECKPOINT="${2:-}"; shift 2 ;;
    --continuation-durable) CONTINUATION_DURABLE="${2:-}"; shift 2 ;;
    --gc|--reap-unmarked|--yes) die_precondition "$1 was removed at 3.0.0 (BL-0115): dispatch-hetero.sh no longer has a stale-worktree reaper; use 'node scripts/repo-residue-sweep.js reap --auto --yes' (the SessionStart hook runs it automatically); for unmarked hetero-* worktrees use 'repo-residue-sweep.js scan', then 'preserve' / 'reap --yes'" ;;
    --help|-h) usage; exit 0 ;;
    *) die_precondition "unknown argument: $1" ;;
  esac
done

if [ "$PIN_REASON_SUPPLIED" -eq 1 ]; then
  if [ -z "$PIN_REASON" ] || [ "${#PIN_REASON}" -gt 200 ] || [[ "$PIN_REASON" == *$'\n'* || "$PIN_REASON" == *$'\r'* ]]; then
    die_precondition "--pin-reason requires 1..200 characters on one line"
  fi
fi

PINNED=false
if [ "$RUNNER_SUPPLIED" -eq 1 ] || [ "$MODEL_SUPPLIED" -eq 1 ]; then PINNED=true; fi
PIN_REDISPATCH=0
if { [ "${AUTOPILOT_HETERO_FELL_BACK:-}" = 1 ] || [ "${LOCAL_BUSY_REDISPATCH:-}" = 1 ]; } && [[ "${AUTOPILOT_HETERO_PIN_ORIGIN:-}" =~ ^(true|false)$ ]]; then
  PINNED="$AUTOPILOT_HETERO_PIN_ORIGIN"
  PIN_REDISPATCH=1
fi
unset AUTOPILOT_HETERO_PIN_ORIGIN
if [ "$PINNED" = true ] && [ "$PIN_REASON_SUPPLIED" -eq 0 ] && [ "$PIN_REDISPATCH" -eq 0 ]; then
  echo 'dispatch-hetero: warning: --runner/--model hard pin without --pin-reason (the pool should choose; say why you pinned)' >&2
fi

# Optional shared consecutive-failure alarm. Check before runner selection or any engine work.
if [ -n "$RC_ALARM_LABEL" ]; then
  _rc_alarm_args=(check --label "$RC_ALARM_LABEL")
  [ -z "$RC_ALARM_OWNER" ] || _rc_alarm_args+=(--owner "$RC_ALARM_OWNER")
  if node "$SELF_DIR/rc-alarm.js" "${_rc_alarm_args[@]}"; then
    :
  else
    _rc_alarm_check_rc=$?
    if [ "$_rc_alarm_check_rc" -eq 75 ]; then exit 75; fi
    echo "rc-alarm: check failed rc=$_rc_alarm_check_rc, continuing" >&2
  fi
fi

if [ "$NO_VERIFY_TIP" -eq 1 ] && [ "${#VERIFY_CMDS[@]}" -gt 0 ]; then
  die_precondition "--no-verify-tip cannot be combined with --verify-cmd"
fi

# Test double without an isolated store (2026-10-19). A --*-bin whose realpath is
# not the PATH default, with neither ENGINE_CAPABILITY_DIR nor ENGINE_CAPABILITY_FILE
# set, must not let seat_strike_capture or passive_capture write the real store.
# --store exports ENGINE_CAPABILITY_DIR during the parse above, so flag order does
# not matter. AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE=1 releases the guard.
CAPABILITY_WRITE_GUARD=0
CAPABILITY_WRITE_SUPPRESSED=""
_CAPABILITY_WRITE_NOTE_DONE=0
_bin_override_differs() {
  # $1 supplied path or bare command name, $2 default command name, $3 1 when the flag was supplied.
  [ "${3:-0}" = 1 ] || return 1
  local def a b supplied
  def="$(command -v "$2" 2>/dev/null || true)"
  [ -n "$def" ] || return 0
  supplied="$1"
  # A bare name has no slash. realpath would resolve it against the cwd and
  # miss the PATH binary, so resolve it with command -v first. Unresolvable
  # still counts as differing. Path-form values skip this and keep realpath.
  case "$supplied" in
    */*) ;;
    *)
      supplied="$(command -v "$supplied" 2>/dev/null || true)"
      [ -n "$supplied" ] || return 0
      ;;
  esac
  if command -v realpath >/dev/null 2>&1; then
    a="$(realpath "$supplied" 2>/dev/null || true)"
    b="$(realpath "$def" 2>/dev/null || true)"
  else
    a="$(readlink -f "$supplied" 2>/dev/null || true)"
    b="$(readlink -f "$def" 2>/dev/null || true)"
  fi
  [ -n "$a" ] && [ "$a" = "$b" ] && return 1
  return 0
}
if [ "${AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE:-}" != "1" ] \
    && [ -z "${ENGINE_CAPABILITY_DIR:-}" ] && [ -z "${ENGINE_CAPABILITY_FILE:-}" ]; then
  if _bin_override_differs "$AGY_BIN" agy "$BIN_FLAG_AGY" \
      || _bin_override_differs "$GROK_BIN" grok "$BIN_FLAG_GROK" \
      || _bin_override_differs "$PI_BIN" pi "$BIN_FLAG_PI" \
      || _bin_override_differs "$CODEX_BIN" codex "$BIN_FLAG_CODEX" \
      || _bin_override_differs "$CURSOR_BIN" cursor-agent "$BIN_FLAG_CURSOR" \
      || _bin_override_differs "$OPENCODE_BIN" opencode "$BIN_FLAG_OPENCODE" \
      || _bin_override_differs "$KIMI_BIN" kimi "$BIN_FLAG_KIMI" \
      || _bin_override_differs "$QODER_BIN" qoderclicn "$BIN_FLAG_QODER"; then
    CAPABILITY_WRITE_GUARD=1
    _CAPABILITY_WRITE_NOTE_DONE=1
    echo "dispatch-hetero: not writing the capability store (test double runner binary without an isolated store). Set ENGINE_CAPABILITY_DIR or pass --store to isolate, or set AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE=1 to write the real store." >&2
  fi
fi

# A removed teardown-config key (BL-0115) is a hard precondition failure, not a silent ignore.
if ! _td_err="$(bash "$SELF_DIR/resolve-worktree-teardown.sh" 2>&1 >/dev/null)"; then
  die_precondition "worktree-teardown config: ${_td_err}"
fi

# Run identity for the observability manifest: reuse the ledger --run-id when supplied
# (one id across ledger + manifest + final JSON), else generate a unique one. Set BEFORE
# preconditions so even a precondition_failed JSON carries a correlatable run_id.
_dispatch_start_stamp="$(date -u '+%s %Y-%m-%dT%H:%M:%SZ')"
DISPATCH_STARTED_EPOCH="${_dispatch_start_stamp%% *}"
DISPATCH_STARTED_AT="${_dispatch_start_stamp#* }"
unset _dispatch_start_stamp
if [ -n "$RUN_ID" ]; then
  DISPATCH_RUN_ID="$RUN_ID"
else
  DISPATCH_RUN_ID="hetero-${DISPATCH_STARTED_EPOCH}-$$-$(head -c2 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID:-}"
LINEAGE_ROOT=""
LINEAGE_JOB_ROOT=""
WORKTREE_ROOT_RUN_ID=""
LINEAGE_DEPTH=0
if [ -n "${AUTOPILOT_PARENT_RUN_ID:-}" ]; then
  LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID}"
  LINEAGE_ROOT="${AUTOPILOT_ROOT_RUN_ID:-$LINEAGE_PARENT}"
  LINEAGE_DEPTH="${AUTOPILOT_DISPATCH_DEPTH:-1}"
  case "$LINEAGE_DEPTH" in *[!0-9]*|"") LINEAGE_DEPTH=1 ;; esac
  if [ "${#LINEAGE_DEPTH}" -gt 7 ]; then
    LINEAGE_DEPTH=1
  elif [ "$((10#$LINEAGE_DEPTH))" -eq 0 ] \
      || [ "$((10#$LINEAGE_DEPTH))" -gt 1000000 ]; then
    LINEAGE_DEPTH=1
  fi
else
  # NOTE: AUTOPILOT_ROOT_RUN_ID is deliberately NOT read here. Without a parent
  # there is no lineage to attach to, so this dispatch becomes its own lineage
  # root. That does not discard the variable: the continuation/rehydration
  # resolver below still honours it (see `_cont_root`), which is how a dispatch
  # re-attaches to an existing root after compaction — exercised by
  # hooks/tests/codex-compaction-rehydration.test.sh with ROOT set and no PARENT.
  # ⇒ Do NOT "fail closed" on root-without-parent; that rejects a supported
  # configuration. (Tried 2026-07-31; it broke 8 assertions in that test.)
  # The sealed-campaign rail is the case that needs BOTH — see
  # references/hetero-dispatch.md § Trace lineage contract.
  LINEAGE_ROOT="$DISPATCH_RUN_ID"
  # Job root (mods P1W W1f) — MANIFEST ONLY (LINEAGE_JOB_ROOT feeds the manifest root_run_id, nothing
  # else): LINEAGE_ROOT keeps keying worktree budgets, the campaign projection and the
  # continuation work-order claim, so a shared root cannot make two ad-hoc dispatches see each
  # other's work orders. Adopted only with no parent and no explicit ROOT env.
  if [ -z "${AUTOPILOT_ROOT_RUN_ID:-}" ]; then
    _job_root="$(node "$SELF_DIR/session-mode.js" root 2>/dev/null | head -n1 || true)"
    case "$_job_root" in ""|*[!A-Za-z0-9._-]*) ;; *) LINEAGE_JOB_ROOT="$_job_root" ;; esac
    unset _job_root
  fi
  LINEAGE_DEPTH=0
fi
# Sanitize inherited lineage ids (a hostile/odd env value with control chars would
# corrupt the manifest JSON — readers then skip the whole file: telemetry blackout)
# and force base-10 depth ("08"/"09" pass the digits-only case but are octal-invalid
# in $((...)), freezing the child depth un-incremented).
[ -n "$LINEAGE_PARENT" ] && LINEAGE_PARENT="$(printf '%s' "$LINEAGE_PARENT" | tr -c 'A-Za-z0-9._-' '-')"
[ -n "$LINEAGE_ROOT" ] && LINEAGE_ROOT="$(printf '%s' "$LINEAGE_ROOT" | tr -c 'A-Za-z0-9._-' '-')"
INHERITED_WORKTREE_ROOT_RUN_ID="${AUTOPILOT_WORKTREE_ROOT_RUN_ID:-}"
WORKTREE_MANAGED=0
if [ -n "$INHERITED_WORKTREE_ROOT_RUN_ID" ]; then
  [[ "$INHERITED_WORKTREE_ROOT_RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die_precondition "AUTOPILOT_WORKTREE_ROOT_RUN_ID must match [A-Za-z0-9._-]+"
  WORKTREE_ROOT_RUN_ID="$INHERITED_WORKTREE_ROOT_RUN_ID"
  WORKTREE_MANAGED=1
else
  WORKTREE_ROOT_RUN_ID="$LINEAGE_ROOT"
  [ -n "$WORKTREE_ROOT_RUN_ID" ] \
    && WORKTREE_ROOT_RUN_ID="$(
      printf '%s' "$WORKTREE_ROOT_RUN_ID" | tr -c 'A-Za-z0-9._-' '-'
    )"
fi
LINEAGE_DEPTH=$((10#$LINEAGE_DEPTH))
export AUTOPILOT_PARENT_RUN_ID="$DISPATCH_RUN_ID"
export AUTOPILOT_ROOT_RUN_ID="$LINEAGE_ROOT"
if [ "$WORKTREE_MANAGED" -eq 1 ]; then
  export AUTOPILOT_WORKTREE_ROOT_RUN_ID="$WORKTREE_ROOT_RUN_ID"
else
  export AUTOPILOT_WORKTREE_ROOT_RUN_ID=""
fi
export AUTOPILOT_DISPATCH_DEPTH="$(( LINEAGE_DEPTH + 1 ))"

set_runner_flags() {
  # Runner selection. Explicit --runner wins; `auto` detects codex from the model
  # name. The OLD bug: only `*gpt-5.5*` matched, so other codex models
  # (gpt-5.3-codex-spark, gpt-5.x-codex, …) silently fell through to the agy branch
  # — which on this repo writes its plugin install copy (no_op + false self-report,
  # memory: agy-writes-install-dir). Match the codex FAMILY, not one string.
  IS_CODEX=0
  IS_GROK=0
  IS_CCSHIM=0
  IS_PI=0
  IS_CURSOR=0
  IS_OPENCODE=0
  IS_KIMI=0
  IS_QODER=0
  IS_CNATIVE=0
  # --gate-rules: the session id keys the gate file, so it must be minted fresh for this dispatch (never inherited).
  [ -z "${GATE_RULES_FILE:-}" ] || unset CHILD_SESSION_ID
  case "$RUNNER" in
    codex)   IS_CODEX=1 ;;
    agy)     ;;
    grok)    IS_GROK=1 ;;
    cc-shim) IS_CCSHIM=1; declare -F child_session_mint >/dev/null 2>&1 && child_session_mint hand ;;   # EXPLICIT only (never auto) — it needs ANTHROPIC_BASE_URL set
    pi)      IS_PI=1 ;;        # EXPLICIT only (never auto) — it requires v0.80.6 + models.json
    cursor)  IS_CURSOR=1 ;;    # Shared broker; model-name guard stays below.
    opencode) IS_OPENCODE=1 ;; # OpenCode CLI (`opencode run`). EXPLICIT only, never auto: its
                               # model ids are provider/model (opencode-go/…, opencode/…) with no
                               # vendor family to match on; the provider prefix is the route.
    kimi)    IS_KIMI=1 ;;      # Shared broker, explicitly named or selected by pace.
                               # Provider aliases do not imply model-name auto routing.
    qoderclicn) IS_QODER=1 ;;  # Qoder CLI CN. EXPLICIT only, never auto: *qwen*/*qwq* stay fail-closed.
    claude-native) IS_CNATIVE=1; declare -F child_session_mint >/dev/null 2>&1 && child_session_mint hand ;;   # EXPLICIT only; refused without the one-time owner confirmation (see precondition gate)
    auto)
      # case-insensitive family match: gpt*/...codex* → codex; grok*/composer* → grok
      # (composer-2.5 ships inside the grok CLI on the Grok Build plan); else agy.
      # cc-shim is never auto-selected from the model name: it is a base-url shim that
      # requires env vars, so a bare model name must NOT silently route there. A listed
      # --endpoint re-resolves onto cc-shim after this case (local implementer seat).
      model_lc="$(printf '%s' "$MODEL" | tr '[:upper:]' '[:lower:]')"
      # 🔴 auto MUST NEVER SELECT cursor. This is a REFUSAL, not a route — placed before
      # the *grok*/*gpt* tests below on purpose. Every cursor model id contains grok, gpt,
      # codex, or claude (R-1, docs/plans/2026-08-26-cursor-cli-adaptor.md §6), so
      # auto-selection cannot disambiguate a vendor-hosted (Cursor) id from a vendor-native
      # one. Match semantics defined ONCE here (§3a):
      #   (a) prefix-open: ANY "cursor-" prefixed id fails closed, in or out of the Phase 1
      #       table (cursor-grok-4.5-high must NOT reach the *grok* branch either) — the
      #       prefix is unambiguous, so it can be closed openly. Names --runner cursor only.
      #   (b) table-closed: a NON-prefixed id fails closed IFF cursor_is_enabled_id "$MODEL"
      #       — a bare gpt-5.3-codex-* id is ALSO a real native-codex family and must not be
      #       over-captured, so this arm names BOTH --runner codex and --runner cursor and
      #       lets the caller choose. No id list of its own: it calls cursor_is_enabled_id,
      #       the single source of truth in lib/cursor-model.sh — three hand-maintained
      #       copies would drift while the test stayed green.
      if [[ "$model_lc" == cursor-* ]]; then
        die_precondition "auto-routing refuses Cursor-hosted model id '$MODEL' (cursor- prefix) — pass --runner cursor explicitly"
      elif cursor_is_enabled_id "$MODEL"; then
        die_precondition "auto-routing refuses ambiguous model id '$MODEL' (also a Cursor-hosted id) — pass --runner codex or --runner cursor explicitly"
      elif [[ "$model_lc" == *gpt* || "$model_lc" == *codex* ]]; then
        IS_CODEX=1
      elif [[ "$model_lc" == *grok* || "$model_lc" == *composer* ]]; then
        IS_GROK=1
      elif [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
        # No --runner and no --model: never an expensive seat. Qualified cheap implementer
        # default is grok-4.7 at effort low (set below); agy is not an unpinned default.
        IS_GROK=1
      fi
      ;;
    *) die_precondition "--runner must be one of auto|codex|agy|grok|cc-shim|local|pi|cursor|opencode|kimi|claude-native|qoderclicn (got: $RUNNER)" ;;
  esac
  # --runner auto never selects cc-shim from the model name. A listed local
  # endpoint on this write rail is still that seat: re-resolve before the
  # sandbox preflight and the local-implementer gate, so both see cc-shim.
  # Clear every other IS_* first: current_runner_name checks them after IS_CCSHIM.
  if [ "$RUNNER" = "auto" ] && [ -n "${ENDPOINT:-}" ]; then
    local _auto_listed_rc=0
    local_sandbox_endpoint_listed "$ENDPOINT" || _auto_listed_rc=$?
    case "$_auto_listed_rc" in
      0)
        IS_CODEX=0; IS_GROK=0; IS_PI=0; IS_CURSOR=0
        IS_OPENCODE=0; IS_KIMI=0; IS_QODER=0; IS_CNATIVE=0
        IS_CCSHIM=1
        RUNNER="cc-shim"
        declare -F child_session_mint >/dev/null 2>&1 && child_session_mint hand
        ;;
      1) ;;
      *) die_precondition "local implementer sandbox registry unreadable (scripts/lib/local-sandbox-endpoints.json); refusing auto endpoint '${ENDPOINT}'" ;;
    esac
  fi
  # Fail closed if --runner auto did not re-resolve onto cc-shim and received a Qwen/QwQ model.
  # qoderclicn is explicit-only; auto must not select it.
  if [ "$RUNNER" = "auto" ] && [[ "${model_lc:-}" == *qwen* || "${model_lc:-}" == *qwq* ]]; then
    die_precondition "auto-routing cannot route Qwen model id '$MODEL' (no Qwen cloud runner) — pass --runner cc-shim --endpoint <name> explicitly"
  fi
  if [ -n "${GATE_RULES_FILE:-}" ]; then
    # Silently ignoring the flag on another runner would make the arm marker lie, so refuse it.
    [ "$IS_CCSHIM" -eq 1 ] || [ "$IS_CNATIVE" -eq 1 ] || die_precondition "--gate-rules applies only to --runner claude-native or cc-shim (got runner: $RUNNER)"
    [ -f "$GATE_RULES_FILE" ] && [ -r "$GATE_RULES_FILE" ] || die_precondition "--gate-rules file not readable: $GATE_RULES_FILE"
    GATE_RULES_FILE="$(cd "$(dirname "$GATE_RULES_FILE")" && pwd -P)/$(basename "$GATE_RULES_FILE")"
    [[ "${CHILD_SESSION_ID:-}" =~ ^[A-Za-z0-9-]{1,128}$ ]] || die_precondition "--gate-rules: could not mint a fresh session id; refusing to dispatch"
  fi
  case "$SANDBOX" in
    off) ;;
    bwrap)
      # The one cloud fallback re-exec keeps the caller's bwrap. Any other runner still refuses it.
      if [ "$IS_CCSHIM" -ne 1 ] && [ "${AUTOPILOT_HETERO_FELL_BACK:-}" != "1" ]; then
        die_precondition "--sandbox bwrap applies only to --runner cc-shim (got runner: $RUNNER)"
      fi
      sandbox_preflight || die_precondition "$SANDBOX_PREFLIGHT_ERROR"
      ;;
    *) die_precondition "--sandbox must be off or bwrap (got: $SANDBOX)" ;;
  esac
  if [ -n "$WORKTREE_PARENT" ]; then
    case "$WORKTREE_PARENT" in /*) ;; *) die_precondition "--worktree-parent must be an absolute path (got: $WORKTREE_PARENT)" ;; esac
    [ -d "$WORKTREE_PARENT" ] || die_precondition "--worktree-parent is not an existing directory: $WORKTREE_PARENT"
  fi
  if [ -n "${ROLE_KIT_DIR:-}" ]; then
    # Refused, never ignored: a kit the runner cannot carry would make the manifest claim a role it did not get.
    role_kit_refuse_unless_claude_native "$([ "$IS_CNATIVE" -eq 1 ] && echo claude-native || echo "$RUNNER")"
    if role_kit_role_allowed "${PACE_ROLE:-${AUTOPILOT_DISPATCH_ROLE:-implementer}}"; then role_kit_load "$ROLE_KIT_DIR"; else role_kit_skip "${PACE_ROLE:-${AUTOPILOT_DISPATCH_ROLE:-implementer}}"; fi
  fi
  # Only reached if resolution actually completed (no die_precondition fired above,
  # including the cursor auto-guard refusals inside the `auto` arm). See RUNNER_RESOLVED
  # init comment and die_precondition (FINDING 1).
  RUNNER_RESOLVED=1
  # Every resolution path (explicit runner and the auto re-resolution above) hits
  # this gate before resolve-endpoint, the pre-probe, the worktree, and the worker.
  # A listed local endpoint without --sandbox bwrap dies here; bwrap requested but
  # missing already died in the sandbox preflight (no unsandboxed fallback).
  require_local_implementer_sandbox
}

D2_AGY_RESPONSE_CLAIM="cap-v1-e3b644661b8b04b75ff6402fb8465259b9fd50116f3bf0c65a2c6625aa354b3e"
D2_AGY_USAGE_CLAIM="cap-v1-60b3c8d855d3cfb31c4ebf9cce62c4fc5c564f7b340abf2c75614e4cb269d64d"
# The validator requires and emits the ids sorted ascending; they are content-derived, so their order
# is not a constant. Hold them sorted once and use that for both the --claim-id arguments and the compare.
if [[ "$D2_AGY_RESPONSE_CLAIM" < "$D2_AGY_USAGE_CLAIM" ]]; then
  D2_AGY_CLAIM_LO="$D2_AGY_RESPONSE_CLAIM"; D2_AGY_CLAIM_HI="$D2_AGY_USAGE_CLAIM"
else
  D2_AGY_CLAIM_LO="$D2_AGY_USAGE_CLAIM"; D2_AGY_CLAIM_HI="$D2_AGY_RESPONSE_CLAIM"
fi
D2_AGY_EXPECTED_IDS="[\"$D2_AGY_CLAIM_LO\",\"$D2_AGY_CLAIM_HI\"]"
validate_d2_agy_claims() {
  local receipt validator observed rc=0
  receipt="${AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT:-$SELF_DIR/../docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json}"
  validator="$SELF_DIR/platform-capability-claims.js"
  [ -r "$receipt" ] && [ -r "$validator" ] && command -v node >/dev/null 2>&1 \
    || die_precondition "D2 capability claim validation failed"
  observed="$(node "$validator" validate-consumer --receipt "$receipt" --consumer D2 \
    --claim-id "$D2_AGY_CLAIM_LO" --claim-id "$D2_AGY_CLAIM_HI" \
    --emit-claim-ids --reprobe --reprobe-binary "$AGY_BIN" 2>/dev/null)" || rc=$?
  [ "$rc" -eq 0 ] && [ "$observed" = "$D2_AGY_EXPECTED_IDS" ] \
    || die_precondition "D2 capability claim validation failed"
}

# --runner local is the named shorthand for a listed local seat. Resolve it
# before effort and runner checks so they see cc-shim + that endpoint + bwrap.
# The endpoint is qwen_local by default, or --endpoint when that name is listed
# in scripts/lib/local-sandbox-endpoints.json. The public name stays local
# (LOCAL_RUNNER) for the result and the manifest.
# The implementer default sets RUNNER=local after pace, so both sites call this.
apply_runner_local() {
  if [ "$ENDPOINT_SUPPLIED" -eq 1 ]; then
    _local_listed_rc=0
    local_sandbox_endpoint_listed "$ENDPOINT" || _local_listed_rc=$?
    if [ "$_local_listed_rc" -eq 2 ]; then
      die_precondition "local implementer sandbox registry unreadable (scripts/lib/local-sandbox-endpoints.json); refusing --runner local"
    fi
    if [ "$_local_listed_rc" -ne 0 ]; then
      die_precondition "--runner local refuses unlisted --endpoint ${ENDPOINT} (not in scripts/lib/local-sandbox-endpoints.json; default is qwen_local)"
    fi
  else
    ENDPOINT="qwen_local"
  fi
  if [ "$SANDBOX_SUPPLIED" -eq 1 ] && [ "$SANDBOX" != "bwrap" ]; then
    die_precondition "--runner local conflicts with --sandbox ${SANDBOX} (local sets --sandbox bwrap; omit --sandbox or pass bwrap)"
  fi
  SANDBOX="bwrap"
  LOCAL_RUNNER=1
  RUNNER="cc-shim"
  # One lane check, before the token-file lookup and the x-lane header.
  # Unset stays "autopilot". A set-but-empty value is refused, as are ".",
  # "..", "/", and any character outside [A-Za-z0-9._-] (CR/LF included).
  # The message does not repeat the lane or any file bytes.
  if [ -n "${AUTOPILOT_LANE+x}" ]; then
    LOCAL_LANE="$AUTOPILOT_LANE"
  else
    LOCAL_LANE="autopilot"
  fi
  case "$LOCAL_LANE" in
    *$'\n'*|*$'\r'*) die_precondition "--runner local refuses AUTOPILOT_LANE that contains a newline" ;;
  esac
  if [[ ! "$LOCAL_LANE" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$LOCAL_LANE" == "." ]] || [[ "$LOCAL_LANE" == ".." ]]; then
    die_precondition "--runner local refuses AUTOPILOT_LANE that is empty, '.' or '..', or contains '/' or a character outside [A-Za-z0-9._-]"
  fi
}
if [ "$RUNNER" = "local" ]; then
  apply_runner_local
fi

if [ "$LOCAL_RUNNER" -eq 1 ] && [ "$EFFORT_EXPLICIT" -eq 1 ] && { [ "$EFFORT" = "high" ] || [ "$EFFORT" = "max" ]; }; then
  die_precondition "--runner local supports --effort low|medium|xhigh (got: $EFFORT)"
fi

case "$EFFORT" in
  default|low|medium|high|xhigh|max) ;;
  *) die_precondition "--effort must be one of default|low|medium|high|xhigh|max (got: $EFFORT)" ;;
esac
# `default` = no effort sent, the endpoint default runs. Only a runner whose effort is optional can honour that;
# a runner that consumes --effort would be handed the literal word "default".
if [ "$EFFORT" = "default" ] && { [ -z "$PACE_ROLE" ] || [ "$RUNNER_SUPPLIED" -eq 1 ]; }; then
  case "$RUNNER" in
    anthropic-compatible|cc-shim|claude-native|kimi|opencode) ;;
    *) die_precondition "--effort default (no effort sent) is only for runners whose effort is optional (anthropic-compatible|cc-shim|claude-native|kimi|opencode); runner '$RUNNER' takes an explicit effort" ;;
  esac
fi
# claude CLI (cc-shim / claude-native) takes --effort low|medium|high|xhigh|max (claude 2.1.299 --help); the enum
# check above already rejects anything else, so no value is ever silently remapped. It is forwarded ONLY when the
# caller (or a strict roster) explicitly set EFFORT: the literal EFFORT="xhigh" above is a script default, not a
# seat decision, and silently raising an unspecified call (sonnet medium -> xhigh; xhigh is unprobed on GLM/M3)
# is not this change's job. `default` sends nothing.
CLAUDE_EFFORT_ARG=""
if [ "$EFFORT_EXPLICIT" -eq 1 ] && [ "$EFFORT" != "default" ]; then CLAUDE_EFFORT_ARG="$EFFORT"; fi
if [ "$LOCAL_RUNNER" -eq 1 ] && [ "$EFFORT_EXPLICIT" -eq 0 ]; then CLAUDE_EFFORT_ARG="medium"; fi
# kimi has no effort flag: kimi-code reads KIMI_MODEL_THINKING_EFFORT (low|high|max), and without it runs
# config.toml's default_effort (max) whatever tier the seat declares (peer report 2026-10-24: 21 exam requests
# for a `high` seat all went out as max). Sent only for an EXPLICIT --effort (the xhigh script default is not a
# seat decision); `default` sends nothing; a value kimi does not offer fails closed rather than being remapped.
# The variable is unset first so an ambient value can never stand in for the seat's tier.
if [ "$RUNNER" = "kimi" ]; then
  unset KIMI_MODEL_THINKING_EFFORT
  KIMI_EFFORT_SEND=""
  if [ "$EFFORT_EXPLICIT" -eq 1 ] && [ "$EFFORT" != "default" ]; then
    case "$EFFORT" in
      low|high|max) KIMI_EFFORT_SEND="$EFFORT"; export KIMI_MODEL_THINKING_EFFORT="$EFFORT" ;;
      *) die_precondition "--effort $EFFORT is not offered by kimi (low|high|max only); use one of those or --effort default" ;;
    esac
  fi
fi

case "$SKILL_MODE" in
  off|prompt|native|auto) ;;
  *) die_precondition "--skill-mode must be one of off|prompt|native|auto (got: $SKILL_MODE)" ;;
esac

# --- preconditions (exit 2, nothing created) ---
[ -n "$BRANCH" ] || die_precondition "--branch is required"
[ -n "$PROMPT_FILE" ] || die_precondition "--prompt-file is required"
[ -r "$PROMPT_FILE" ] || die_precondition "prompt file not readable: $PROMPT_FILE"
[ "$SCRATCH" -eq 0 ] || [ -z "$REUSE_WORKTREE" ] || die_precondition "--scratch cannot be combined with --reuse-worktree"
HETERO_FLEET_TASK_ID="$(node "$SELF_DIR/lib/fleet-task-ref.js" resolve-parent --prompt-file "$PROMPT_FILE" 2>/dev/null || true)"
_HETERO_AEE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib/agent-event-emit.sh
[ -r "$_HETERO_AEE_DIR/lib/agent-event-emit.sh" ] && . "$_HETERO_AEE_DIR/lib/agent-event-emit.sh" && {
  agent_event_emit_init "implementer" "${RUNNER:-claude}" "" "$HETERO_FLEET_TASK_ID"
  agent_event_emit_accepted
  agent_event_emit_register_exit_trap
} || true

DISPATCH_LANE_JSON=null # read from the original brief before it is repacked; crosses the detach boundary via declare -p
declare -F dispatch_lane_json >/dev/null 2>&1 && DISPATCH_LANE_JSON="$(dispatch_lane_json "$PROMPT_FILE")"
declare -F dispatch_export_attribution >/dev/null 2>&1 && dispatch_export_attribution "$PROMPT_FILE" # the child (its cost-tracker rows) inherits lane + fleet task
[ -z "${HETERO_FLEET_TASK_ID:-}" ] || export AUTOPILOT_FLEET_TASK="$HETERO_FLEET_TASK_ID"
# Cloud fallback through pace-select (fleet task 01M806DD / 01M7QARG): the local fallback
# reasons (local_ctx_over, no free slot / shed-local, cn_gate_barred) must not hardcode codex
# any more — pace-select picks the cloud seat the pace ranking wants to spend, and only a
# pace failure or empty result falls back to codex. Sets RUNNER/MODEL/ENDPOINT and
# PACE_CHOICE_JSON (manifest pace_choice), keeps the caller's LOCAL_FALLBACK_JSON reason, and
# raises LOCAL_CTX_CODEX_FALLBACK so the default pace block below does not run a second time.
pace_cloud_fallback() {
  _pcf_args=(--dispatch --role "${PACE_ROLE:-implementer}")
  [ -z "${PROMPT_FILE:-}" ] || _pcf_args+=(--prompt-file "$PROMPT_FILE")
  local _pcf _pcf_ep
  if _pcf="$(node "$SELF_DIR/pace-select.js" "${_pcf_args[@]}")" && [ -n "$_pcf" ]; then
    { IFS= read -r RUNNER; IFS= read -r MODEL; IFS= read -r _pcf_ep; IFS= read -r ENGINE_CHOICE_JSON; IFS= read -r PACE_CHOICE_JSON; } <<< "$_pcf"
    ENDPOINT="$_pcf_ep"
    MODEL_IS_DEFAULT=0
    LOCAL_CTX_CODEX_FALLBACK=1
    if [ "$MODEL_SUPPLIED" -eq 0 ] && printf '%s' "$MODEL" | grep -qiE 'carbon|argon|astra|fable|opus'; then
      RUNNER="codex"; MODEL=""; ENDPOINT=""; PACE_CHOICE_JSON=""; ENGINE_CHOICE_JSON=""
      return 1
    fi
    return 0
  fi
  RUNNER="codex"; MODEL=""; ENDPOINT=""; PACE_CHOICE_JSON=""; ENGINE_CHOICE_JSON=""
  LOCAL_CTX_CODEX_FALLBACK=1
  return 1
}
# An unpinned implementer uses an available local qwen or GLM seat when its endpoint
# is ready, a gateway lease is granted, the estimated prompt context fits, and the CN
# gate allows that seat (operator via PM 01M7XHF4). Otherwise the unpinned path
# falls through to pace-select (its ranked seat, not a fixed engine) and records local_fallback. A pin already chose
# a seat when --pace-role or a pace file returned one, a strict contract is on,
# or AUTOPILOT_QUALIFICATION_OVERRIDE is set. Explicit --runner never falls back.
LOCAL_FALLBACK_JSON="${AUTOPILOT_LOCAL_FALLBACK_PRESET:-null}"
LOCAL_SLOTS_JSON=null
SHED_ROUTE_JSON=null
SHED_ROUTE_MANIFEST_JSON=null
SHED_ROUTE_TARGET=""
IMPLICIT_LOCAL_DEFAULT=0
_impl_role="${PACE_ROLE:-${AUTOPILOT_DISPATCH_ROLE:-implementer}}"
if [ "$RUNNER_SUPPLIED" -eq 0 ] && [ "$MODEL_SUPPLIED" -eq 0 ] && [ "$ENDPOINT_SUPPLIED" -eq 0 ] && [ "$RUNNER" = "auto" ] && [ "$STRICT_CONTRACT" -eq 0 ] \
   && [ -z "${ENGINE_CHOICE_JSON:-}" ] && [ -z "${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" ] \
   && [ "$_impl_role" = "implementer" ] && [ -z "${AUTOPILOT_LOCAL_FALLBACK_PRESET:-}" ]; then
  if [ "${AUTOPILOT_SHED_ROUTE:-1}" != "0" ]; then
    _shed_skips=()
    _shed_iterations=0
    _shed_iteration_limit=5
    while :; do
      _shed_iterations=$((_shed_iterations + 1))
      if [ "$_shed_iterations" -gt "$_shed_iteration_limit" ]; then
        printf '%s\n' 'dispatch-hetero: warn: shed route pre-check exceeded target limit; falling back to normal routing' >&2
        SHED_ROUTE_JSON='{"shed":false,"reason":"iteration_limit"}'
        SHED_ROUTE_TARGET=""
        break
      fi
      _shed_args=(--prompt-file "$PROMPT_FILE")
      for _shed_skip in "${_shed_skips[@]}"; do _shed_args+=(--skip-target "$_shed_skip"); done
      SHED_ROUTE_JSON="$(node "$SELF_DIR/lib/shed-route.js" "${_shed_args[@]}" 2>/dev/null || printf '{"shed":false,"reason":"no_file"}')"
      SHED_ROUTE_TARGET="$(node -e 'try { const x=JSON.parse(process.argv[1]); process.stdout.write(x.shed ? String(x.target || "") : ""); } catch (_) {}' "$SHED_ROUTE_JSON")"
      [ -n "$SHED_ROUTE_TARGET" ] || break
      case "$SHED_ROUTE_TARGET" in
        minimax) _shed_runner=cc-shim; _shed_model=MiniMax-M3; _shed_endpoint=minimax ;;
        kimi)
          _shed_runner=kimi
          _shed_model="${MODEL:-$(node -e 'process.stdout.write(require(process.argv[1]).brokerConfig("kimi").defaultModel)' "$SELF_DIR/lib/cursor-broker-client.js")}"; [ "$MODEL_IS_DEFAULT" -eq 1 ] || _shed_model="$MODEL"
          _shed_endpoint="${ENDPOINT:-kimi}" ;;
        codex)
          _shed_runner=codex; _shed_model="${MODEL:-gpt-6.1-terra}"; [ "$MODEL_IS_DEFAULT" -eq 1 ] || _shed_model="$MODEL"
          _shed_endpoint="${ENDPOINT:-codex}" ;;
        local) _shed_runner=cc-shim; _shed_model=qwen; _shed_endpoint=qwen_local ;;
      esac
      _shed_reason=""
      if [ "$SHED_ROUTE_TARGET" = "minimax" ] && ! bash "$SELF_DIR/resolve-endpoint.sh" minimax >/dev/null 2>&1; then
        _shed_reason="resolve_endpoint_failed"
      else
        _shed_gate_msg="$(node "$SELF_DIR/lib/cn-model-dispatch-gate.js" check --runner "$_shed_runner" --model "$_shed_model" --endpoint "$_shed_endpoint" --cwd "$(pwd)" ${SOURCE_REPO:+--source-repo "$SOURCE_REPO"} --prompt-file "$PROMPT_FILE" 2>&1 >/dev/null)" && _shed_gate_rc=0 || _shed_gate_rc=$?
        if [ "$_shed_gate_rc" -ne 0 ]; then _shed_reason="${_shed_gate_msg:-cn_model_dispatch_gate_rc_${_shed_gate_rc}}"; fi
      fi
      if [ -z "$_shed_reason" ]; then
        SHED_ROUTE_MANIFEST_JSON="$SHED_ROUTE_JSON"
        break
      fi
      _shed_skip_target="$SHED_ROUTE_TARGET"
      [ "$SHED_ROUTE_TARGET" != "local" ] || _shed_skip_target=local-27b
      _shed_skips+=("$_shed_skip_target=$_shed_reason")
    done
    if [ -z "$SHED_ROUTE_TARGET" ] && [[ "$SHED_ROUTE_JSON" == *'"reason":"no_eligible_target"'* ]]; then
      printf '%s\n' 'dispatch-hetero: warn: shed route skipped: no_eligible_target' >&2
    fi
    SHED_ROUTE_TARGET="$(node -e 'try { const x=JSON.parse(process.argv[1]); process.stdout.write(x.shed ? String(x.target || "") : ""); } catch (_) {}' "$SHED_ROUTE_JSON")"
    case "$SHED_ROUTE_TARGET" in
      minimax) RUNNER="cc-shim"; ENDPOINT="minimax"; MODEL="MiniMax-M3"; MODEL_IS_DEFAULT=0 ;;
      kimi) RUNNER="kimi" ;;
      codex) RUNNER="codex" ;;
    esac
  fi
  unset _shed_args _shed_skips _shed_skip _shed_skip_target _shed_runner _shed_model _shed_endpoint _shed_reason _shed_gate_msg _shed_gate_rc _shed_iterations _shed_iteration_limit
  if [ "$RUNNER" != "auto" ]; then
    : # shed selected a cloud target; the local slot probe is not applicable
  else
  LOCAL_SLOT_FLEET_TASK_RAW="$(awk '/^[[:space:]]*Fleet-Task:/ { sub(/^[[:space:]]*Fleet-Task:[[:space:]]*/, ""); sub(/[[:space:]]*$/, ""); print; exit }' "$PROMPT_FILE")"
  export LOCAL_SLOT_FLEET_TASK_RAW
  _slot_line="$(node "$SELF_DIR/lib/local-impl-slot.js" --prompt-file "$PROMPT_FILE" --cwd "$(pwd)")"
  _slot_parsed="$(node -e 'let o; try{o=JSON.parse(process.argv[1]);}catch{o={choose:false,reason:"no_free_slot",detail:"lease_query_failed:malformed"};} const fb={reason:o.reason||"no_free_slot"}; if(o.reason==="local_ctx_over") Object.assign(fb,{est_tokens:o.est_tokens,limit:o.limit}); else fb.detail=String(o.detail||""); if(o.family==="glm"||o.local_fallback_from) Object.assign(fb,{family:o.family||"glm",endpoint:o.endpoint||"glm_local",local_fallback_from:o.local_fallback_from||null}); console.log(o.choose?"choose":"fallback"); console.log(JSON.stringify(o.local_lease||null)); console.log(JSON.stringify(o.local_slots||null)); console.log(o.lease_url||""); console.log(o.lease_token_env||""); console.log(JSON.stringify(fb));' "$_slot_line")"
  _slot_kind="$(printf '%s\n' "$_slot_parsed" | sed -n '1p')"
  if [ "$_slot_kind" = "choose" ]; then
    _lease_json="$(printf '%s\n' "$_slot_parsed" | sed -n '2p')"
    LOCAL_LEASE_ID="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.id||"")' "$_lease_json")"
    LOCAL_LEASE_STATUS="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(String(o.status))' "$_lease_json")"
    LOCAL_LEASE_GRANTED=1
    LOCAL_LEASE_URL="$(printf '%s\n' "$_slot_parsed" | sed -n '4p')"
    LOCAL_LEASE_TOKEN_ENV="$(printf '%s\n' "$_slot_parsed" | sed -n '5p')"
    if [ "$EFFORT_EXPLICIT" -eq 1 ] && { [ "$EFFORT" = "high" ] || [ "$EFFORT" = "max" ]; }; then
      release_local_lease || true
      die_precondition "--runner local supports --effort low|medium|xhigh (got: $EFFORT)"
    fi
    _slot_choice="$(printf '%s\n' "$_slot_parsed" | sed -n '6p')"
    _slot_family="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.family||"qwen")' "$_slot_choice")"
    ENDPOINT="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.endpoint||"qwen_local")' "$_slot_choice")"
    LOCAL_SLOTS_JSON="$(printf '%s\n' "$_slot_parsed" | sed -n '3p')"
    LOCAL_LEASE_HEARTBEAT_FILE="${TMPDIR:-/tmp}/autopilot-local-lease-heartbeats-$$"
    : > "$LOCAL_LEASE_HEARTBEAT_FILE"
    _gate_msg="$(node "$SELF_DIR/lib/cn-model-dispatch-gate.js" check --runner cc-shim --model "$_slot_family" --endpoint "$ENDPOINT" --cwd "$(pwd)" ${SOURCE_REPO:+--source-repo "$SOURCE_REPO"} --prompt-file "$PROMPT_FILE" 2>&1 >/dev/null)" && _gate_rc=0 || _gate_rc=$?
    if [ "$_gate_rc" -eq 0 ]; then
      LOCAL_LEASE_HEARTBEAT_SLEEP_FILE="${TMPDIR:-/tmp}/autopilot-local-lease-heartbeat-sleep-$$"
      local_lease_heartbeat_loop >/dev/null 2>&1 & LOCAL_LEASE_HEARTBEAT_PID=$!
      RUNNER="local"
      MODEL="$_slot_family"
      if [ "$EFFORT_EXPLICIT" -eq 0 ]; then CLAUDE_EFFORT_ARG="medium"; fi
      ENDPOINT_SUPPLIED=1
      IMPLICIT_LOCAL_DEFAULT=1
      export IMPLICIT_LOCAL_DEFAULT
      LOCAL_FALLBACK_JSON="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(o.local_fallback_from||null))' "$_slot_choice")"
    else
      # A CN-gate refusal of an implicit local seat releases its lease before cloud fallback.
      release_local_lease || true
      _gate_detail="${_gate_msg%%[[:space:]]*}"
      _gate_detail="${_gate_detail:-cn_model_dispatch_barred}"
      pace_cloud_fallback || true
      LOCAL_CTX_CODEX_FALLBACK=1
      LOCAL_FALLBACK_JSON="$(node -e 'process.stdout.write(JSON.stringify({reason:"cn_gate_barred",detail:process.argv[1],family:process.argv[2]}))' "$_gate_detail" "$_slot_family")"
      printf 'local-slot: cn_gate_barred family=%s -> %s\n' "$_slot_family" "$RUNNER" >&2
      unset _gate_detail
    fi
  else
    _lease_json="$(printf '%s\n' "$_slot_parsed" | sed -n '2p')"
    LOCAL_LEASE_STATUS="$(node -e 'try{const o=JSON.parse(process.argv[1]);process.stdout.write(o&&o.status!==null?String(o.status):"null")}catch{}' "$_lease_json")"
    LOCAL_LEASE_DETAIL="$(node -e 'try{const o=JSON.parse(process.argv[1]);process.stdout.write(o&&o.detail||"")}catch{}' "$_lease_json")"
    LOCAL_FALLBACK_JSON="$(printf '%s\n' "$_slot_parsed" | sed -n '6p')"
    LOCAL_SLOTS_JSON=null
    if [ "$SHED_ROUTE_TARGET" = "local" ]; then pace_cloud_fallback || true; fi
    if [ "$(node -e 'try{process.stdout.write(JSON.parse(process.argv[1]).reason||"")}catch{}' "$LOCAL_FALLBACK_JSON")" = "local_ctx_over" ]; then
      if [ "$RUNNER" = "auto" ]; then pace_cloud_fallback || true; fi
      printf 'local-slot: local_ctx_over est_tokens=%s limit=%s -> %s\n' \
        "$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o.est_tokens))' "$LOCAL_FALLBACK_JSON")" \
        "$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o.limit))' "$LOCAL_FALLBACK_JSON")" \
        "$RUNNER" >&2
      LOCAL_CTX_CODEX_FALLBACK=1
    fi
  fi
  unset LOCAL_SLOT_FLEET_TASK_RAW
  unset _slot_line _slot_parsed _slot_kind _lease_json _gate_msg _gate_rc
  fi
fi
unset _impl_role

if [ "$RUNNER_SUPPLIED" -eq 0 ] && [ "$MODEL_SUPPLIED" -eq 0 ] && [ "$ENDPOINT_SUPPLIED" -eq 0 ] \
   && [ "${IMPLICIT_LOCAL_DEFAULT:-0}" != "1" ] && [ -z "${SHED_ROUTE_TARGET:-}" ] \
   && [ "${LOCAL_CTX_CODEX_FALLBACK:-0}" != "1" ]; then
# Pace is the default only for an unpinned seat. Strict contracts carry their own tuple.
_ps_args=(--dispatch --role "${PACE_ROLE:-implementer}")
[ -z "${PROMPT_FILE:-}" ] || _ps_args+=(--prompt-file "$PROMPT_FILE")
if [ -n "${RUNNER:-}" ] && [ "$RUNNER" != "auto" ] && { [ "$RUNNER_SUPPLIED" -eq 1 ] || [ "$STRICT_CONTRACT" -eq 1 ]; }; then
  _ps_args+=(--named-runner "$RUNNER")
fi
if [ -n "${MODEL:-}" ] && { [ "$MODEL_SUPPLIED" -eq 1 ] || [ "$STRICT_CONTRACT" -eq 1 ]; }; then
  _ps_args+=(--named-model "$MODEL")
fi
[ -z "${ENDPOINT:-}" ] || _ps_args+=(--named-endpoint "$ENDPOINT")
_ps_parsed="$(node "$SELF_DIR/pace-select.js" "${_ps_args[@]}")" || die_precondition "pace selection refused"
if [ -n "$_ps_parsed" ]; then
  _ps_ep=""
  { IFS= read -r RUNNER; IFS= read -r MODEL; IFS= read -r _ps_ep; IFS= read -r ENGINE_CHOICE_JSON; IFS= read -r PACE_CHOICE_JSON; } <<< "$_ps_parsed"
  [ -n "${ENDPOINT:-}" ] || ENDPOINT="$_ps_ep"
  MODEL_IS_DEFAULT=0
  if [ "$MODEL_SUPPLIED" -eq 0 ] && printf '%s' "$MODEL" | grep -qiE 'carbon|argon|astra|fable|opus'; then
    die_precondition "unpinned dispatch never uses an expensive model ($MODEL); pass --model to choose one"
  fi
  if [ "$EFFORT_EXPLICIT" -eq 0 ] && [ -n "${ENGINE_CHOICE_JSON:-}" ]; then
    _ps_effort="$(node -e 'let o; try { o=JSON.parse(process.argv[1]); } catch { process.exit(0); } if (o && typeof o.effort === "string" && o.effort) process.stdout.write(o.effort);' "$ENGINE_CHOICE_JSON" 2>/dev/null || true)"
    [ -n "${_ps_effort:-}" ] && EFFORT="$_ps_effort"
    unset _ps_effort
  fi
fi
# Capacity admission runs only for implicit selections. Keep pace-select's
# chosen seat first, then its already-ranked known candidates as fallbacks.
if [ "$RUNNER_SUPPLIED" -eq 0 ] && [ "$MODEL_SUPPLIED" -eq 0 ] && [ "$ENDPOINT_SUPPLIED" -eq 0 ] \
   && [ "$STRICT_CONTRACT" -eq 0 ] && [ -n "${ENGINE_CHOICE_JSON:-}" ] && [ "$RUNNER" != "local" ]; then
  _ep_candidates="$(node -e 'const c=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(c.ranked_candidates||[{runner:c.runner,model:c.model,endpoint:c.endpoint||"",effort:c.effort||""}]))' "$ENGINE_CHOICE_JSON" 2>/dev/null || printf '[]')"
  _ep_options=(--fallback-on-all-skipped)
  [ "${PACE_ROLE:-implementer}" != "implementer" ] || _ep_options+=(--prefer-burn-more)
  _ep_options+=(--local-first)
  _ep_json="$(node "$SELF_DIR/lib/engine-preflight.js" "${_ep_options[@]}" --candidates-json "$_ep_candidates" 2>/dev/null)" || _ep_json=""
  if [ -n "$_ep_json" ]; then
    ENGINE_PREFLIGHT_JSON="$_ep_json"
    ENGINE_PREFLIGHT_LOG_LINE="$(node -e '
const j=JSON.parse(process.argv[1]);
const warning=j.warnings.find(x=>x.startsWith("capacity_table_"));
if(warning)process.stdout.write(`engine-preflight: capacity table ${warning==="capacity_table_stale"?"stale":warning==="capacity_table_unparseable"?"unparseable":"missing"}, using default order`);
else if(j.warnings.includes("all_candidates_skipped_default_order"))process.stdout.write(`engine-preflight: read ${j.table_path} generated_at=${j.generated_at}; ${j.skipped.map(x=>`skipped ${x.runner}:${x.model} (${x.reason})`).join(", ")}; every candidate skipped, using default choice ${j.chosen.runner}:${j.chosen.model}`);
else process.stdout.write(`engine-preflight: read ${j.table_path} generated_at=${j.generated_at}; ${j.skipped.map(x=>`skipped ${x.runner}:${x.model} (${x.reason})`).join(", ")}${j.skipped.length?"; ":""}chosen ${j.chosen.runner}:${j.chosen.model}`);
' "$ENGINE_PREFLIGHT_JSON" 2>/dev/null || true)"
    [ -z "$ENGINE_PREFLIGHT_LOG_LINE" ] || printf '%s\n' "$ENGINE_PREFLIGHT_LOG_LINE" >&2
    # auth:missing fallback: the record rides in the manifest as engine_preflight.fallback {from,to,reason}; one stderr notice per runner per 15 min (the dedupe is in engine-preflight.js).
    node -e 'const j=JSON.parse(process.argv[1]);const f=j.fallback;if(f&&f.notify)process.stderr.write(`engine-preflight: ${f.from} login missing (${f.reason}); fell back to ${f.to}\n`)' "$ENGINE_PREFLIGHT_JSON" >&2 2>/dev/null || true
    _ep_choice="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.chosen?`${j.chosen.runner}\t${j.chosen.model}`:"")' "$ENGINE_PREFLIGHT_JSON")"
    if [ -n "$_ep_choice" ]; then
      IFS=$'\t' read -r RUNNER MODEL <<< "$_ep_choice"
      _ep_meta="$(node -e 'try{const xs=JSON.parse(process.argv[1]);const x=xs.find(y=>y.runner===process.argv[2]&&y.model===process.argv[3]);process.stdout.write(x?.endpoint||"")}catch{}' "$_ep_candidates" "$RUNNER" "$MODEL")"
      [ -z "$_ep_meta" ] || ENDPOINT="$_ep_meta"
    fi
  fi
  unset _ep_candidates _ep_options _ep_json _ep_choice _ep_meta
fi
fi
# Saved before skill-pack / scaffold prepend text, which would hide image magic bytes.
VISION_PROMPT_FILE="$PROMPT_FILE"
if [ "$RUNNER" = "local" ]; then
  apply_runner_local
fi
# --runner local (explicit or the implementer default) with no --model uses the selected endpoint family. An explicit --model wins.
if [ "$LOCAL_RUNNER" -eq 1 ] && [ "$MODEL_SUPPLIED" -eq 0 ]; then
  MODEL="${_slot_family:-qwen}"
  MODEL_IS_DEFAULT=0
fi
# The reviewed run's actual seat (implicit local or the cloud seat this invocation
# kept). Review entry points read these; a config default is not the run.
if [ "${LOCAL_RUNNER:-0}" -eq 1 ]; then
  export AUTOPILOT_REVIEWED_IMPLEMENTER_RUNNER=local
else
  export AUTOPILOT_REVIEWED_IMPLEMENTER_RUNNER="$RUNNER"
fi
export AUTOPILOT_REVIEWED_IMPLEMENTER_ENDPOINT="${ENDPOINT:-}"
export AUTOPILOT_REVIEWED_IMPLEMENTER_MODEL="${MODEL:-}"
# bwrap refuses a worktree inside a repo. Local fills a 0700 per-user parent outside the checkout.
if [ "$LOCAL_RUNNER" -eq 1 ] && [ -z "$WORKTREE_PARENT" ] && [ -z "$REUSE_WORKTREE" ]; then
  _local_wt_base="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
  WORKTREE_PARENT="$(node "$SELF_DIR/lib/local-sandbox-parent.js" "$_local_wt_base")" \
    || die_precondition "local runner could not create a worktree parent outside the repo"
  unset _local_wt_base
fi
# Restricted cloud operators need a clean brief in a fresh non-repo sandbox; local endpoint names must resolve locally.
if [ "$SCRATCH" -eq 1 ]; then
  case "$RUNNER" in
    cc-shim) ;;
    kimi) [ "${BIN_FLAG_KIMI:-0}" -eq 1 ] || die_precondition "--scratch requires a runner that honors WORKER_CWD; broker kimi is refused" ;;
    *) die_precondition "--scratch is supported only by runners that honor WORKER_CWD (cc-shim, kimi-bin); runner $RUNNER is refused" ;;
  esac
  _scratch_parent="$(node "$SELF_DIR/lib/local-sandbox-parent.js" "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}")" \
    || die_precondition "--scratch could not create a private parent outside git work trees"
  SCRATCH_DIR="$(umask 077; mktemp -d "${_scratch_parent}/dispatch-hetero-scratch-XXXXXX")" \
    || die_precondition "--scratch could not create a fresh directory"
  chmod 700 "$SCRATCH_DIR" || die_precondition "--scratch could not secure its directory"
  SCRATCH_WORK_DIR="$SCRATCH_DIR/work"
  mkdir -m 700 -- "$SCRATCH_WORK_DIR" || die_precondition "--scratch could not create worker directory"
  SCRATCH_HOME="$SCRATCH_DIR/home"
  mkdir -m 700 -- "$SCRATCH_HOME" || die_precondition "--scratch could not create isolated HOME"
  if [ "$RUNNER" = "cc-shim" ]; then
    SCRATCH_CONFIG_DIR="$SCRATCH_DIR/claude-config-empty"
    mkdir -m 700 -- "$SCRATCH_CONFIG_DIR" || die_precondition "--scratch could not create empty Claude config"
  fi
  SCRATCH_REJECTED_FILE="${AUTOPILOT_DISPATCH_RUNS_DIR:-${MANIFEST_DIR_PATH:-${TMPDIR:-/tmp}}}/scratch-${DISPATCH_RUN_ID}.rejected"
  cp -- "$PROMPT_FILE" "$SCRATCH_WORK_DIR/brief.md" || die_precondition "--scratch could not copy the brief"
  chmod 600 "$SCRATCH_WORK_DIR/brief.md" || die_precondition "--scratch could not secure the brief"
  WORKER_CWD="$SCRATCH_WORK_DIR"
fi
_gate_cwd="${SCRATCH_WORK_DIR:-$(pwd)}"
_gate_prompt="${SCRATCH_WORK_DIR:+$SCRATCH_WORK_DIR/brief.md}"
_gate_prompt="${_gate_prompt:-$PROMPT_FILE}"
# Fleet-Task gate (P4): before any worktree or runner launch, require open Fleet-Task unless exempt.
_pm_repo="${REPO_ROOT:-}"
if [ -z "$_pm_repo" ]; then
  _pm_repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P 2>/dev/null || true)"
fi
_pm_out_err="$(mktemp -t dispatch-hetero-pm-XXXXXX)"
# AUTOPILOT_PARENT_RUN_ID was exported for children above; the gate must see the caller's original value or every run looks inherited.
if _pm_resolved="$(AUTOPILOT_PARENT_RUN_ID="${LINEAGE_PARENT:-}" node "$SELF_DIR/lib/fleet-task-ref.js" pm-check \
    --repo-root "${_pm_repo:-$PWD}" \
    ${FLEET_TASK_ARG:+--fleet-task "$FLEET_TASK_ARG"} \
    --prompt-file "$_gate_prompt" \
    --bin-stub "${BIN_SUPPLIED:-0}" 2>"$_pm_out_err")"; then
  if [ -s "$_pm_out_err" ]; then cat "$_pm_out_err" >&2 || true; fi
  [ -n "$_pm_resolved" ] && [ -z "${FLEET_TASK_ARG:-}" ] && FLEET_TASK_ARG="$_pm_resolved"
  rm -f "$_pm_out_err" 2>/dev/null || true
else
  _pm_msg="$(tr '\n' ' ' < "$_pm_out_err" 2>/dev/null | sed 's/[[:space:]]*$//')"
  rm -f "$_pm_out_err" 2>/dev/null || true
  die_precondition "${_pm_msg:-Fleet-Task precondition failed}"
fi
unset _pm_repo _pm_out_err _pm_resolved _pm_msg
_tfg_msg="$(node "$SELF_DIR/lib/cn-model-dispatch-gate.js" check --runner "$RUNNER" --model "$MODEL" --endpoint "${ENDPOINT:-$RUNNER}" --cwd "$_gate_cwd" ${SOURCE_REPO:+--source-repo "$SOURCE_REPO"} --prompt-file "$_gate_prompt" 2>&1 >/dev/null)" \
  || die_precondition "${_tfg_msg:-cn_model_dispatch_barred unknown restricted_operator_unknown_endpoint (01M7E2A1, d-1dfcf757)}"
unset _tfg_msg
# Warn-only: a brief that names a ../ path points outside the worktree. Never blocks, never
# changes the exit code. A ../ counts only at a word start ( ../x, (../x, "../x), not a/../b.
_DOTDOT_RE='(^|[][:space:]("'"'"'=,<])\.\./[^][:space:]()"'"'"'<>,;]+'
_DOTDOT_TOKEN="$({ grep -oE "$_DOTDOT_RE" "$PROMPT_FILE" 2>/dev/null || true; } | head -n 1 | sed -E 's/^[^.]*//')"
if [ -n "$_DOTDOT_TOKEN" ]; then
  echo "dispatch-hetero: warn: brief has a ../ path outside the worktree: $_DOTDOT_TOKEN" >&2
fi
# PADDED_DEADLINE (PM 01M78CC2): a due longer than 2x Effort with no checkable
# dependency is refused on the original brief, before skill-pack or scaffold
# rewrite, and returned to the dispatcher. A fleet reply calls the same
# paddedDeadline export from scripts/lib/backlog-rules.js. Exit 3 from the
# checker is the rule; any other non-zero means the checker did not run.
_pd_rc=0
_pd_msg="$(node -e '
const fs = require("fs");
const rules = require(process.argv[1]);
const v = rules.paddedDeadline(fs.readFileSync(process.argv[2], "utf8"));
if (v) {
  process.stdout.write(String(v.code) + (v.detail ? ": " + v.detail : ""));
  process.exit(3);
}
' "$SELF_DIR/lib/backlog-rules.js" "$PROMPT_FILE" 2>&1)" || _pd_rc=$?
if [ "$_pd_rc" -eq 3 ]; then
  die_precondition "${_pd_msg:-PADDED_DEADLINE}"
elif [ "$_pd_rc" -ne 0 ]; then
  die_precondition "PADDED_DEADLINE check failed to run: ${_pd_msg:-rc ${_pd_rc}}"
fi
if [ "$KEEP" -eq 1 ]; then
  [[ "$RETENTION_OWNER" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die_precondition "--keep-worktree requires --retain-owner matching [A-Za-z0-9._-]+"
  [ -n "$RETENTION_REASON" ] \
    || die_precondition "--keep-worktree requires --retain-reason"
  [[ "$RETENTION_EXPIRES_AT" =~ ^[0-9]+$ ]] \
    || die_precondition "--keep-worktree requires --retain-until epoch seconds"
  [ "$RETENTION_EXPIRES_AT" -gt "$(date +%s)" ] \
    || die_precondition "--retain-until must be in the future"
  RETENTION_REASON_SHA256="$(
    printf '%s' "$RETENTION_REASON" | sha256sum | awk '{print $1}'
  )"
elif [ -n "$RETENTION_OWNER$RETENTION_REASON$RETENTION_EXPIRES_AT" ]; then
  die_precondition "retention metadata requires --keep-worktree"
fi
if [ -n "$REUSE_WORKTREE" ]; then
  # busy_at_run reuses the worktree the failed local attempt already prepared.
  # That path is not an operator --keep-worktree lease.
  if [ "${LOCAL_BUSY_REDISPATCH:-}" != "1" ]; then
    [ "$KEEP" -eq 1 ] || die_precondition "--reuse-worktree requires --keep-worktree"
  fi
  [[ "$REUSE_WORKTREE" = /* ]] || die_precondition "--reuse-worktree must be absolute"
  [[ "$EXPECTED_WORKTREE_INSTANCE" =~ ^[0-9a-f]{64}$ ]] \
    || die_precondition "--reuse-worktree requires --expected-worktree-instance SHA-256"
elif [ -n "$EXPECTED_WORKTREE_INSTANCE" ]; then
  die_precondition "--expected-worktree-instance requires --reuse-worktree"
fi
if [ -n "$RESUME_SESSION_ID" ]; then
  [ "$RUNNER" = "grok" ] \
    || die_precondition "--resume-session is only verified for --runner grok"
  [[ "$RESUME_SESSION_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || die_precondition "--resume-session must be a lowercase UUID"
fi
if [ "$NO_CAMPAIGN" -eq 1 ] && { [ -n "$CAMPAIGN_CONTRACT_FILE" ] \
    || [ -n "$CAMPAIGN_CONTRACT_SHA256" ] || [ -n "$CAMPAIGN_SEAL_FILE" ]; }; then
  die_precondition "--no-campaign cannot be combined with --campaign-contract, --campaign-contract-sha256, or --campaign-seal"
fi
[ -z "$CAMPAIGN_CONTRACT_FILE" ] || [ -r "$CAMPAIGN_CONTRACT_FILE" ] \
  || die_precondition "campaign contract file not readable: $CAMPAIGN_CONTRACT_FILE"
if [ -n "$CAMPAIGN_CONTRACT_FILE" ] || [ -n "$CAMPAIGN_CONTRACT_SHA256" ] \
    || [ -n "$CAMPAIGN_SEAL_FILE" ]; then
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] && [ -n "$CAMPAIGN_CONTRACT_SHA256" ] \
    && [ -n "$CAMPAIGN_SEAL_FILE" ] \
    || die_precondition "--campaign-contract, --campaign-contract-sha256, and --campaign-seal are required together"
  [[ "$CAMPAIGN_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || die_precondition "--campaign-contract-sha256 must be a lowercase SHA-256 digest"
  [ -r "$CAMPAIGN_SEAL_FILE" ] \
    || die_precondition "campaign seal file not readable: $CAMPAIGN_SEAL_FILE"
fi
[ "$STRICT_CONTRACT" -eq 1 ] && [ "$CONTRACT_FILE_SUPPLIED" -eq 0 ] && die_precondition "--contract-file requires --strict-contract"
[ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] && [ "$STRICT_CONTRACT" -eq 0 ] && die_precondition "--strict-contract requires --contract-file"

if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  run_campaign_contract_preflight
fi
if [ "$STRICT_CONTRACT" -eq 1 ]; then
  run_strict_contract_preflight
fi
if [ "$TIMEOUT_SUPPLIED" -eq 1 ] && [ -z "${TIMEOUT_SOURCE:-}" ]; then
  TIMEOUT_SOURCE="caller"
fi
# Idle / hard / sample limits. --timeout stays a soft deadline (WATCHDOG_SOFT_S);
# an unenforced default still parses so a later arm uses the same numbers.
_hetero_resolve_watch_limits() {
  local sample="${AUTOPILOT_HETERO_SAMPLE_S:-15}"
  local hard_spec idle_spec parsed
  if [ "${HARD_TIMEOUT_SUPPLIED:-0}" -eq 1 ]; then
    hard_spec="$HARD_TIMEOUT"
  elif [ -n "${AUTOPILOT_HETERO_HARD_TIMEOUT:-}" ]; then
    hard_spec="$AUTOPILOT_HETERO_HARD_TIMEOUT"
  else
    hard_spec="4h"
  fi
  idle_spec="${IDLE_TIMEOUT:-5m}"
  parsed="$(node "$SELF_DIR/lib/idle-watch.js" parse --idle "$idle_spec" --hard "$hard_spec" --sample "$sample" 2>&1)" || return 1
  read -r WATCHDOG_IDLE_S WATCHDOG_HARD_S WATCHDOG_SAMPLE_S <<<"$parsed"
  [[ "$WATCHDOG_IDLE_S" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$WATCHDOG_HARD_S" =~ ^[1-9][0-9]*$ ]] || return 1
  WATCHDOG_SOFT_S="$(normalize_timeout_seconds "${TIMEOUT:-}" 2>/dev/null || true)"
  [[ "${WATCHDOG_SOFT_S:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  return 0
}
_hetero_resolve_watch_limits || die_precondition "invalid --timeout/--idle-timeout/--hard-timeout (or AUTOPILOT_HETERO_HARD_TIMEOUT / AUTOPILOT_HETERO_SAMPLE_S)"
if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  run_campaign_projection_preflight
fi
if [ "$CAMPAIGN_PROJECTION_BOUND" -ne 1 ]; then
  # The contract checker above has already re-derived the supplied digest and
  # verified its seal. Only that all-three-input boundary may skip this gate.
  if ! sealed_bounded_campaign_without_mission_projection; then
    check_session_mode_gate
  fi
  check_mission_enforcement_gate
else
  # Sealed strict projection is present: still bind active L5/L6 (and L3
  # fallback) markers to the campaign's policy/graph digests before spend.
  check_managed_dev_flow_admission
  check_marker_campaign_admission_bridge
fi
emit_sealed_zero_diff_if_authorized
if [ "$MISSION_NOOP_SHORT_CIRCUIT" -eq 1 ]; then
  die_precondition \
    "Mission no-op marker requires the exact matching sealed zero_diff_receipt"
fi
set_runner_flags
# codex effort: an unpinned codex call sends low (scorecard event 38). The literal EFFORT="xhigh"
# is a script default, not a seat decision. An explicit --effort always wins.
if [ "${IS_CODEX:-0}" -eq 1 ] && [ "$EFFORT_EXPLICIT" -eq 0 ]; then
  EFFORT="low"
fi
# codex implementer default (2026-11-19 implementer exam, scorecard event 38, 24/24 at low on
# impl-live-rail-v1): an unpinned codex call is gpt-6.1-terra at low; explicit --model/--effort win.
if [ "${IS_CODEX:-0}" -eq 1 ] && [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
  MODEL="gpt-6.1-terra"
  MODEL_IS_DEFAULT=0
fi
# opencode implementer default (qualified seat official:implementer:opencode-go/beam-free:opencode:339):
# beam-free has no effort tier, so an unpinned call sends no variant ("default"), never the xhigh script default.
if [ "${IS_OPENCODE:-0}" -eq 1 ]; then
  [ "$EFFORT_EXPLICIT" -eq 1 ] || EFFORT="default"
  if [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
    MODEL="opencode-go/beam-free"
    MODEL_IS_DEFAULT=0
  fi
fi
# agy implementer default (2026-11-19 implementer exam, scorecard event 37, 24/24 at low): a --runner agy call
# without --model is gemini-4-hydrogen-low at low. The old carbon default is gone (expensive seat); agy is never
# the unpinned (no --runner) default, that order is grok-4.7 low first. Explicit --model/--effort win.
if [ "${RUNNER_RESOLVED:-0}" -eq 1 ] \
  && [ "${IS_CODEX:-0}${IS_GROK:-0}${IS_CCSHIM:-0}${IS_PI:-0}${IS_CURSOR:-0}${IS_OPENCODE:-0}${IS_KIMI:-0}${IS_QODER:-0}${IS_CNATIVE:-0}" = "000000000" ]; then
  if [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
    MODEL="gemini-4-hydrogen-low"
    MODEL_IS_DEFAULT=0
    [ "$EFFORT_EXPLICIT" -eq 1 ] || EFFORT="low"
  fi
fi
# grok implementer default effort (qualified seat official:implementer:grok-4.7:grok:194,
# Fleet task 01M7S0RPFQJ217HXV3X11WXDVP): an unpinned grok call sends low; an explicit
# --effort always wins. Other runners are unchanged.
if [ "${IS_GROK:-0}" -eq 1 ] && [ "$EFFORT_EXPLICIT" -eq 0 ]; then
  EFFORT="low"
fi
# The local-implementer gate runs at the end of set_runner_flags, after the runner
# (including auto + a listed endpoint) is resolved, still before resolve-endpoint.
# agy is the else-case rail (no IS_* flag). Refuse an unusable --timeout HERE, in the parent: the agy
# block itself runs in the detached child, where a die would leave no result file behind.
if [ "${RUNNER_RESOLVED:-0}" -eq 1 ] \
  && [ "${IS_CODEX:-0}${IS_GROK:-0}${IS_CCSHIM:-0}${IS_PI:-0}${IS_CURSOR:-0}${IS_OPENCODE:-0}${IS_KIMI:-0}${IS_QODER:-0}${IS_CNATIVE:-0}" = "000000000" ]; then
  _AGY_TIMEOUT_CHECK="$(agy_print_timeout "$TIMEOUT")" || die_precondition "$_AGY_TIMEOUT_CHECK"
fi

# --- --cursor-fast: runner-scoped, never a silent no-op (§3a, Global Constraint 5). ---
if [ "$CURSOR_FAST" -eq 1 ]; then
  [ "$IS_CURSOR" -eq 1 ] || die_precondition "--cursor-fast applies only to --runner cursor (got runner: $RUNNER)"
fi

# Broker implementers accept composer ids only. Legacy CLI options still have
# repository consumers, so retain parsing but refuse them rather than ignoring.
if [ "$IS_CURSOR" -eq 1 ]; then
  [ "$MODEL_IS_DEFAULT" -eq 0 ] || MODEL="$(cursor_broker_default_model)"
  MODEL_IS_DEFAULT=0
  cursor_is_broker_model "$MODEL" || die_precondition "cursor broker requires a composer model (default $(cursor_broker_default_model)); got '$MODEL'"
  [ "$CURSOR_FAST" -eq 0 ] || die_precondition "--cursor-fast is unavailable on the cursor broker"
  [ "$BIN_FLAG_CURSOR" -eq 0 ] || die_precondition "--cursor-bin is unavailable on the cursor broker; use AUTOPILOT_CURSOR_GROUP_WRAPPER for tests"
  BROKER_TIMEOUT_S="$(normalize_timeout_seconds "$TIMEOUT")" || die_precondition "invalid cursor broker timeout"
  [[ "$BROKER_TIMEOUT_S" =~ ^[0-9]+$ ]] && [ "$BROKER_TIMEOUT_S" -ge 60 ] && [ "$BROKER_TIMEOUT_S" -le 3600 ] \
    || die_precondition "cursor broker timeout must be 60-3600 seconds"
fi

# Explicit --kimi-bin remains a hermetic local-CLI seam; the normal seat uses the broker.
if [ "$IS_KIMI" -eq 1 ] && [ "$BIN_FLAG_KIMI" -eq 0 ]; then
  [ "$MODEL_IS_DEFAULT" -eq 0 ] || MODEL="$(node -e 'process.stdout.write(require(process.argv[1]).brokerConfig("kimi").defaultModel)' "$SELF_DIR/lib/cursor-broker-client.js")"
  MODEL_IS_DEFAULT=0
  _kimi_model_check="$(node -e 'require(process.argv[1]).validateModel(process.argv[2], "kimi")' "$SELF_DIR/lib/cursor-broker-client.js" "$MODEL" 2>&1)" \
    || die_precondition "$_kimi_model_check"
  BROKER_TIMEOUT_S="$(normalize_timeout_seconds "$TIMEOUT")" || die_precondition "invalid kimi broker timeout"
  [[ "$BROKER_TIMEOUT_S" =~ ^[0-9]+$ ]] && [ "$BROKER_TIMEOUT_S" -ge 60 ] && [ "$BROKER_TIMEOUT_S" -le 3600 ] \
    || die_precondition "kimi broker timeout must be 60-3600 seconds"
fi

if [ "$IS_CODEX" -eq 0 ] && [ "$IS_GROK" -eq 0 ] && [ "$IS_CCSHIM" -eq 0 ] \
   && [ "$IS_PI" -eq 0 ] && [ "$IS_CURSOR" -eq 0 ] && [ "$IS_OPENCODE" -eq 0 ] && [ "$IS_KIMI" -eq 0 ] && [ "$IS_QODER" -eq 0 ] && [ "$IS_CNATIVE" -eq 0 ]; then
  AGY_BIN="$(runner_bin_fallback "$AGY_BIN")"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  validate_d2_agy_claims
fi


# BL-0364: a claude-native worker passes --model verbatim to the claude CLI, which rejects a bare family
# name (claude-opus -> unrecognized_model). Refuse it before anything is created.
if [ "${IS_CNATIVE:-0}" -eq 1 ] && [ "$MODEL_IS_DEFAULT" -eq 0 ]; then
  _CNATIVE_MODEL_ERR="$(node "$SELF_DIR/lib/seat-model-id.js" check "$MODEL" 2>&1)" \
    || die_precondition "claude-native refused: $_CNATIVE_MODEL_ERR"
fi

# grok implementer default model (qualified seat official:implementer:grok-4.7:grok:194,
# Fleet task 01M7S0RPFQJ217HXV3X11WXDVP): an unpinned grok call defaults to grok-4.7;
# an explicit --model always wins.
if [ "${IS_GROK:-0}" -eq 1 ] && [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
  MODEL="grok-4.7"
  MODEL_IS_DEFAULT=0
fi

if [ "$IS_CODEX" -eq 0 ] && [ "$IS_GROK" -eq 0 ] && [ "$IS_CCSHIM" -eq 0 ] \
   && [ "$IS_PI" -eq 0 ] && [ "$IS_CURSOR" -eq 0 ] && [ "$IS_OPENCODE" -eq 0 ] && [ "$IS_KIMI" -eq 0 ] && [ "$IS_QODER" -eq 0 ] && [ "$IS_CNATIVE" -eq 0 ]; then
  # `|| die` in the PARENT: agy_resolve_model_alias deliberately never dies inside `$( )`,
  # where die_precondition's JSON would be captured into MODEL instead of exiting.
  MODEL="$(agy_resolve_model_alias "$MODEL" "$AGY_BIN" "$EFFORT")" \
    || die_precondition "$MODEL"
elif [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
  # The built-in default is an agy alias and means nothing to any other vendor. Refusing
  # here is the loud half of the fix: silently forwarding it produced a vendor-side error
  # whose text named a model the caller never chose.
  die_precondition "--model is required for runner '$RUNNER'"
fi

if [ "${#SKILLS[@]}" -gt 0 ]; then
  for skill in "${SKILLS[@]}"; do
    skill_no_ns="${skill#autopilot:}"
    # The charset below permits '.' so it must NOT stand alone as '.' or '..': those are
    # path segments that escape the skills/<name>/ boundary (skills/.. resolves to repo root)
    # even though '/' is blocked. Reject them explicitly. (gpt-5.5 P6 F3)
    if [[ ! "$skill_no_ns" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$skill_no_ns" == "." ]] || [[ "$skill_no_ns" == ".." ]]; then
      die_precondition "invalid skill name: $skill"
    fi
  done
fi


# --- optional --endpoint: resolve named-endpoint creds into the cc-shim env (ADDITIVE).
# When absent, every existing caller is byte-identical (raw ANTHROPIC_BASE_URL/
# ANTHROPIC_AUTH_TOKEN env still used). resolve-endpoint.sh emits only the token's env
# NAME; we read the value via ${!name} in-script (set +x so it can't leak) and export it. ---
if [ -n "$ENDPOINT" ]; then
  [ "$IS_CCSHIM" -eq 1 ] || die_precondition "--endpoint applies only to --runner cc-shim (got runner: $RUNNER)"
  # Readiness is the resolver's EXIT CODE (0=ready), NOT a grep of stdout — matching a
  # "ready":true substring could be spoofed by attacker-controlled field content, and the
  # exit code is the resolver's authoritative fail-closed signal (gpt-5.5 R5).
  _ep_json="$("$SELF_DIR/resolve-endpoint.sh" "$ENDPOINT" 2>/dev/null)"; _ep_rc=$?
  [ "$_ep_rc" -eq 0 ] || die_precondition "--endpoint '$ENDPOINT' not ready: $(printf '%s' "$_ep_json" | sed -n 's/.*\("missing":\[[^]]*\]\).*/\1/p')"
  _ep_url="$(printf '%s' "$_ep_json" | sed -n 's/.*"base_url":"\([^"]*\)".*/\1/p')"
  _ep_tokenv="$(printf '%s' "$_ep_json" | sed -n 's/.*"token_env":"\([^"]*\)".*/\1/p')"
  # fail closed if extraction yielded nothing — never silently fall through to ambient env (R6)
  { [ -n "$_ep_url" ] && [ -n "$_ep_tokenv" ]; } || die_precondition "--endpoint '$ENDPOINT' resolved an empty base_url/token_env"
  case "$_ep_url" in
    */v1|*/v1/)
      _ep_error="--endpoint '$ENDPOINT' base_url ends with /v1 ($_ep_url); the claude CLI appends /v1/messages itself, so this would call /v1/v1/messages and fail as unrecognized_model. Set AUTOPILOT_ENDPOINT_${ENDPOINT^^}_URL without the trailing /v1."
      printf '%s\n' "$_ep_error" >&2
      die_precondition "$_ep_error" ;;
  esac
  set +x
  export ANTHROPIC_BASE_URL="$_ep_url"
  export ANTHROPIC_AUTH_TOKEN="${!_ep_tokenv-}"
  # Per-lane gateway token (local seats only). A non-empty file wins over the
  # endpoint key. The bytes stay in ANTHROPIC_AUTH_TOKEN; manifest/result record
  # only which source won. set +x so an ambient trace cannot print the value.
  if [ "${LOCAL_RUNNER:-0}" -eq 1 ]; then
    GATEWAY_TOKEN_SOURCE="endpoint"
    _gw_lane="$LOCAL_LANE"
    _gw_dir="${AUTOPILOT_GATEWAY_TOKEN_DIR:-${HOME}/.config/local-llm-gateway/tokens}"
    _gw_file="${_gw_dir}/${_gw_lane}"
    if [ -f "$_gw_file" ] && [ -s "$_gw_file" ]; then
      set +x
      _gw_raw="$(cat "$_gw_file" 2>/dev/null || true)"
      _gw_raw="${_gw_raw#"${_gw_raw%%[![:space:]]*}"}"
      _gw_raw="${_gw_raw%"${_gw_raw##*[![:space:]]}"}"
      if [ -n "$_gw_raw" ]; then
        export ANTHROPIC_AUTH_TOKEN="$_gw_raw"
        GATEWAY_TOKEN_SOURCE="lane-file"
      fi
      unset _gw_raw
    fi
    unset _gw_lane _gw_dir _gw_file
  fi
  # The resolver's own stderr was discarded above (2>/dev/null keeps stdout the JSON contract);
  # re-surface the one disclosure that must never be silent at dispatch time. NOT gated on
  # DISPATCH_QUIET: that switch silences operational chatter (timeout heads-up), never a
  # security disclosure (review round 1, gpt-5.6-sol).
  case "$_ep_json" in
    *'"transport_security":"plaintext_private"'*)
      echo "dispatch-hetero: --endpoint '$ENDPOINT' is PLAINTEXT to a private-range address ($_ep_url) — bearer and prompts travel unencrypted on this LAN (AUTOPILOT_ENDPOINT_*_TRANSPORT=plaintext-private)" >&2 ;;
  esac
  unset _ep_json _ep_url _ep_tokenv
  # Pre-probe: GET <base>/models (2 s total) before a worker or worktree exists. A down or busy
  # endpoint becomes engine_unavailable at once and the engine's on_engine_unavailable policy decides;
  # nothing is recorded about the endpoint, so the next dispatch probes it afresh.
  # shellcheck source=lib/endpoint-probe.sh
  . "$SELF_DIR/lib/endpoint-probe.sh"
  endpoint_preprobe "$ENDPOINT" "$MODEL"
  case "$PROBE_DECISION" in
    unreachable|busy)
      if [ "$PROBE_DECISION" = "busy" ]; then
        redispatch_cloud_default_busy
      fi
      hetero_endpoint_cloud_fallback
      echo "dispatch-hetero: endpoint pre-probe ${ENDPOINT}: ${PROBE_DECISION} (status ${PROBE_STATUS:-none}, ${PROBE_MS:-0} ms, ${PROBE_REASON}); no worker started" >&2
      die_probe_unavailable ;;
    ok) echo "dispatch-hetero: endpoint pre-probe ${ENDPOINT}: ok (status ${PROBE_STATUS}, ${PROBE_MS} ms); served by local endpoint ${ENDPOINT}" >&2 ;;
    "") ;;
    *) echo "dispatch-hetero: endpoint pre-probe ${ENDPOINT}: ${PROBE_DECISION} (${PROBE_REASON}); dispatching to local endpoint ${ENDPOINT}" >&2 ;;
  esac
fi
# Heads-up on stderr ONLY (stdout carries the JSON contract): the implementer run below can
# take many minutes. Under Claude Code's Bash tool the 120s default timeout will SIGTERM it
# (exit 143). Raise BASH_DEFAULT_TIMEOUT_MS (~/.claude/settings.json env) or pass a high
# per-call timeout. Silence with DISPATCH_QUIET=1.
[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: ${RUNNER}/${MODEL} (effort=${EFFORT}) may run for MANY minutes — ensure a high Bash-tool timeout (BASH_DEFAULT_TIMEOUT_MS); the 120s default SIGTERMs long runs." >&2

if [ "$IS_CODEX" -eq 1 ]; then
  CODEX_BIN="$(runner_bin_fallback "$CODEX_BIN")"
  # A path-form --codex-bin (contains /) is feature-detected here in the CALLER cwd but
  # exec'd by the worker AFTER `cd "$WT"` — a RELATIVE path would resolve to a different
  # binary (or fail) inside the worktree. Absolutize it first (POSIX cd/pwd, not realpath)
  # so both resolve the SAME binary. A bare command name (no /) PATH-resolves consistently
  # since the worker inherits the same PATH (gpt-5.5 review).
  case "$CODEX_BIN" in
    */*)
      # Resolve the dir into a var and validate it — inlining `$(cd .. && pwd)/$(basename)`
      # would let a FAILED cd (empty pwd) silently yield `/<basename>` because the `||` sees
      # basename's (successful) exit, not cd's, and could then exec an unintended /codex (gpt-5.5 R2).
      _cb_dir="$(cd "$(dirname "$CODEX_BIN")" 2>/dev/null && pwd)" || true
      [ -n "$_cb_dir" ] || die_precondition "--codex-bin path not resolvable: $CODEX_BIN"
      CODEX_BIN="$_cb_dir/$(basename "$CODEX_BIN")"
      ;;
  esac
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN (install OpenAI Codex, ensure it is in PATH, or pass --codex-bin)"
  # Feature-detect the flag the worker uses. A STALE codex earlier in PATH (e.g. an old
  # npm-global codex in an nvm node's bin, ahead of ~/.local/bin) lacks
  # --dangerously-bypass-hook-trust; without this check it would exit 2 mid-run with a
  # cryptic "unexpected argument" and get MISCLASSIFIED as question_suspected. Fail loud
  # here instead, naming the resolved path + version so the caller fixes PATH / --codex-bin.
  if ! grep -q -- '--dangerously-bypass-hook-trust' < <("$CODEX_BIN" exec --help 2>&1); then
    _cx_path="$(command -v "$CODEX_BIN")"; _cx_ver="$("$CODEX_BIN" --version 2>&1 | head -1)"
    die_precondition "resolved codex ($_cx_path, $_cx_ver) does not support --dangerously-bypass-hook-trust — it is too old / the wrong binary. Update it, fix PATH so the newer codex wins, or pass --codex-bin <path>."
  fi
elif [ "$IS_CCSHIM" -eq 1 ]; then
  _ts_msg="$(token_seat_guard)" || die_precondition "$_ts_msg"
  command -v "claude" >/dev/null 2>&1 || die_precondition "claude binary not found (cc-shim drives the Claude Code CLI)"
  # cc-shim is a base-url SHIM by design: without ANTHROPIC_BASE_URL it would dispatch to
  # vanilla Claude (homogeneous, and burning the user's own quota). Require it + the token.
  [ -n "${ANTHROPIC_BASE_URL:-}" ] || die_precondition "cc-shim requires ANTHROPIC_BASE_URL in env (point it at an Anthropic-compatible endpoint, e.g. https://api.minimax.io/anthropic)"
  # Require ANTHROPIC_AUTH_TOKEN specifically (the bearer token the shim uses), NOT
  # ANTHROPIC_API_KEY: the dispatch deliberately `env -u ANTHROPIC_API_KEY`s so a user's
  # real-Anthropic key can't take precedence over the shim token — so accepting API_KEY
  # here would pass the precondition then leave the run with no usable auth (gpt-5.5 review).
  [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || die_precondition "cc-shim requires ANTHROPIC_AUTH_TOKEN in env (the shim's bearer token; ANTHROPIC_API_KEY is intentionally NOT used — it is unset before launching claude so it cannot override the shim token)"
  # Endpoint vars are not probed here. sudo env_reset drops them for every runner; only
  # cc-shim needs them, and run_agent writes a 0600 file that the post-drop command reads.
  # The post-condition (AUTOPILOT_ENV_PROBE) refuses if they still do not arrive.
elif [ "$IS_PI" -eq 1 ]; then
  command -v node >/dev/null 2>&1 || die_precondition "node not found (pi runner requires Node for the RPC supervisor)"
  command -v "$PI_BIN" >/dev/null 2>&1 || die_precondition "pi binary not found: $PI_BIN"
  [ -r "$SELF_DIR/lib/pi-rpc-run.js" ] || die_precondition "pi supervisor not found: $SELF_DIR/lib/pi-rpc-run.js"
  _pi_models_json="${PI_MODELS_JSON:-$HOME/.pi/agent/models.json}"
  [ -r "$_pi_models_json" ] || die_precondition "pi models.json not readable: $_pi_models_json"
elif [ "$IS_GROK" -eq 1 ]; then
  GROK_BIN="$(runner_bin_fallback "$GROK_BIN")"
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN (install xAI Grok Build CLI or pass --grok-bin)"
elif [ "$IS_CURSOR" -eq 1 ]; then
  command -v "${AUTOPILOT_CURSOR_GROUP_WRAPPER:-sg}" >/dev/null 2>&1 || die_precondition "cursor broker group wrapper not found"
elif [ "$IS_OPENCODE" -eq 1 ]; then
  command -v "$OPENCODE_BIN" >/dev/null 2>&1 || die_precondition "opencode binary not found: $OPENCODE_BIN (install OpenCode CLI or pass --opencode-bin)"
  # The ONE `--version` run of this call (lib/opencode-containment.js picks the v1 or v2 adaptor from
  # it; an unknown major refuses here, before any spend). Reused by the plan call at spawn time.
  _oc_verr="$(mktemp -t dispatch-hetero-opencode-verr-XXXXXX)"
  OPENCODE_VER="$(node "$SELF_DIR/lib/opencode-containment.js" version --bin "$OPENCODE_BIN" 2>"$_oc_verr")" \
    || { _oc_msg="$(cat "$_oc_verr")"; rm -f "$_oc_verr"; die_precondition "opencode version not usable: ${_oc_msg}"; }
  rm -f "$_oc_verr"
elif [ "$IS_KIMI" -eq 1 ]; then
  if [ "$BIN_FLAG_KIMI" -eq 0 ]; then
    _kimi_avail_err="$(mktemp -t dispatch-hetero-kimi-avail-XXXXXX)"
    _kimi_avail_rc=0
    node "$SELF_DIR/lib/cursor-broker-client.js" available kimi >"$_kimi_avail_err" 2>&1 || _kimi_avail_rc=$?
    _kimi_avail_msg="$(sed -n '1p' "$_kimi_avail_err" 2>/dev/null || true)"
    rm -f "$_kimi_avail_err"
    if [ "$_kimi_avail_rc" -eq 4 ]; then
      [ -n "$_kimi_avail_msg" ] || _kimi_avail_msg="kimi broker socket not accessible: run under the socket's group (e.g. sg lanegit -c ...)"
      die_precondition "$_kimi_avail_msg"
    fi
    if [ "$_kimi_avail_rc" -ne 0 ]; then
      _qwc_json="$(node "$SELF_DIR/quota-wait-check.js" --engine kimi --json 2>/dev/null || true)"
      _qwc_verdict="$(node -e 'try{const d=JSON.parse(process.argv[1]);process.stdout.write(d.verdict||"unknown")}catch{process.stdout.write("unknown")}' "$_qwc_json" 2>/dev/null || echo "unknown")"
      _qwc_reading="$(node -e 'try{const d=JSON.parse(process.argv[1]);process.stdout.write(d.reading_line||"")}catch{}' "$_qwc_json" 2>/dev/null || true)"
      if [ "$_qwc_verdict" = "has_quota" ]; then
        printf '[quota-wait-check] kimi has_quota (%s); proceeding without quota wait\n' "$_qwc_reading" >&2
      elif [ "$_qwc_verdict" = "exhausted" ]; then
        [ -n "$_qwc_reading" ] && printf '%s\n' "$_qwc_reading" >&2
        die_precondition "kimi broker unavailable or quota exhausted${_qwc_reading:+ ($_qwc_reading)}"
      else
        die_precondition "kimi broker unavailable (quota status unknown; not claiming exhausted)"
      fi
    fi
    command -v "${AUTOPILOT_KIMI_GROUP_WRAPPER:-sg}" >/dev/null 2>&1 || die_precondition "kimi broker group wrapper not found"
  else
  _kimi_stop="$(node "$SELF_DIR/lib/kimi-local-stop.js" check 2>&1)" || die_precondition "$_kimi_stop"
  command -v "$KIMI_BIN" >/dev/null 2>&1 || die_precondition "kimi binary not found: $KIMI_BIN (install Kimi Code CLI or pass --kimi-bin)"
  fi
elif [ "$IS_QODER" -eq 1 ]; then
  # command -v only. runner_bin_fallback would resolve the host install; tests pass --qoder-bin.
  command -v "$QODER_BIN" >/dev/null 2>&1 || die_precondition "qoder binary not found: $QODER_BIN (install Qoder CLI CN or pass --qoder-bin)"
elif [ "$IS_CNATIVE" -eq 1 ]; then
  # claude-native implementer: first-party Claude on the owner's native auth. Gated by a ONE-TIME owner
  # confirmation recorded in ~/.autopilot/config.json (implementer_claude_native.confirmed_at). There is
  # deliberately no flag/env on this command line that grants it — depth 0 asks the owner once, then runs
  # `node scripts/run-approval.js confirm-claude-native`. Checked BEFORE the binary so a refusal never spawns.
  node "$SELF_DIR/run-approval.js" claude-native-status >/dev/null 2>&1 \
    || die_precondition "--runner claude-native needs a one-time owner confirmation: depth 0 must ask the owner once (first-party Claude implementer on native auth), and after a yes run 'node scripts/run-approval.js confirm-claude-native'. No flag on this command grants it."
  _ts_msg="$(token_seat_guard)" || die_precondition "$_ts_msg"
  command -v claude >/dev/null 2>&1 || die_precondition "claude binary not found (claude-native drives the Claude Code CLI)"
  case "$(cnative_account_state)" in
    active) : ;;  # G37: the account registry is the only auth; the seeded .credentials.json path is not touched
    legacy)
      # Fail closed pre-spend: the child gets ONLY a seeded copy of .credentials.json, so it must exist.
      node "$SELF_DIR/lib/seed-claude-config.js" --check \
        || die_precondition "claude-native refused: source .credentials.json is missing/unreadable (see seed-claude-config message above); the child is never given the real claude config dir"
      ;;
    *) die_precondition "claude-native refused: the account registry exists but is not usable, or its env-check output is unrecognised (node scripts/claude-account.js env-check --any); nothing was spawned" ;;
  esac
else
  AGY_BIN="$(runner_bin_fallback "$AGY_BIN")"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN (install Antigravity CLI or pass --agy-bin)"
fi

git rev-parse --git-dir >/dev/null 2>&1 || die_precondition "not inside a git repository"
git rev-parse --verify --quiet "$BASE" >/dev/null || die_precondition "base ref not found: $BASE"
BASE_SHA="$(git rev-parse "$BASE")"

# Mandatory whenever an active Mission/root work order exists under git-common-dir,
# or when durable/checkpoint/reconcile inputs are present. Cannot be disabled by
# omitting continuation env when work orders exist — absence/stale/forged reconcile
# receipts fail closed before branch/worktree/runner effects.
if [ -z "$CONTINUATION_CHECKPOINT" ] && [ -n "${AUTOPILOT_CONTINUATION_CHECKPOINT:-}" ]; then
  CONTINUATION_CHECKPOINT="$AUTOPILOT_CONTINUATION_CHECKPOINT"
fi
if [ -z "$CONTINUATION_DURABLE" ] && [ -n "${AUTOPILOT_CONTINUATION_DURABLE:-}" ]; then
  CONTINUATION_DURABLE="$AUTOPILOT_CONTINUATION_DURABLE"
fi
# Prefer mission root over worktree/lineage/root/run (exact Mission identity wins).
_cont_root="${AUTOPILOT_MISSION_ROOT_RUN_ID:-${WORKTREE_ROOT_RUN_ID:-${LINEAGE_ROOT:-${AUTOPILOT_ROOT_RUN_ID:-${RUN_ID:-}}}}}"
_cont_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
_cont_has_wo=0
_cont_wo_claimed=""
# Mission / reconcile paths require root_run_id (never global scan, never silent miss).
if [ -z "$_cont_root" ] && { [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ] \
    || [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ] \
    || [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ]; }; then
  die_precondition "root_run_id mandatory for continuation/mission reconcile enumeration"
fi
if [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
  # Exact-root enumerate under fail-closed semantics — never `|| echo 0` on errors.
  # The managed engine owns a controller Work Order under the campaign root.
  # That record is controller authority, not an implementer continuation claim;
  # counting it here makes the child runner demand a reconcile receipt for the
  # very dispatch that created the controller (and blocks before model spend).
  # Keep this in lockstep with the engine-side continuation admission filter.
  _cont_has_wo="$(node -e '
const wo=require(process.argv[1]);
try {
  const n=wo.listNonterminalWorkOrders(process.argv[2], process.argv[3])
    .filter((entry) => !(entry && entry.work_order && entry.work_order.role === "controller"));
  process.stdout.write(n.length>0?"1":"0");
} catch (e) {
  process.stderr.write(String(e && e.message || e));
  process.exit(2);
}
' "$SELF_DIR/../src/engine/work-order.js" "$_cont_common" "$_cont_root")" || {
    die_precondition "work order root enumeration failed closed for root=$_cont_root"
  }
  case "$_cont_has_wo" in
    0|1) ;;
    *) die_precondition "work order root enumeration returned invalid result" ;;
  esac
fi
if [ -n "$CONTINUATION_CHECKPOINT" ] || [ -n "$CONTINUATION_DURABLE" ] \
    || [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ] \
    || [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ] \
    || [ "$_cont_has_wo" = "1" ] \
    || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
  _cont_args=(admit)
  if [ -n "$CONTINUATION_CHECKPOINT" ]; then
    [ -r "$CONTINUATION_CHECKPOINT" ] \
      || die_precondition "continuation checkpoint not readable: $CONTINUATION_CHECKPOINT"
    _cont_args+=(--checkpoint "$CONTINUATION_CHECKPOINT")
  fi
  if [ -n "$CONTINUATION_DURABLE" ]; then
    [ -r "$CONTINUATION_DURABLE" ] \
      || die_precondition "continuation durable tracker not readable: $CONTINUATION_DURABLE"
    _cont_args+=(--durable "$CONTINUATION_DURABLE")
  fi
  [ -n "$_cont_root" ] && _cont_args+=(--root-run-id "$_cont_root")
  [ -n "$BRANCH" ] && _cont_args+=(--branch "$BRANCH")
  [ -n "${STAGE:-}" ] && _cont_args+=(--stage "$STAGE" --graph-node "${STAGE}")
  [ -n "$BASE_SHA" ] && _cont_args+=(--base-sha "$BASE_SHA")
  [ -n "${MANIFEST_DIR_PATH:-}" ] && _cont_args+=(--manifest-dir "$MANIFEST_DIR_PATH")
  _cont_args+=(--git-cwd "$(pwd)")
  _cont_args+=(--owner-pid "$$")
  if [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ] || [ "$_cont_has_wo" = "1" ]; then
    _cont_args+=(--strict-match)
  fi
  if [ "$_cont_has_wo" = "1" ] || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
    _cont_args+=(--require-reconcile --mission-active)
  fi
  if [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ]; then
    [ -r "${AUTOPILOT_RECONCILE_RECEIPT}" ] \
      || die_precondition "reconcile receipt not readable: ${AUTOPILOT_RECONCILE_RECEIPT}"
    _cont_args+=(--reconcile-receipt "${AUTOPILOT_RECONCILE_RECEIPT}")
  fi
  if [ -n "${AUTOPILOT_TERMINAL_RECEIPT:-}" ]; then
    _cont_args+=(--terminal-receipt "${AUTOPILOT_TERMINAL_RECEIPT}")
  fi
  if [ -n "${AUTOPILOT_CONTINUATION_NARRATIVE:-}" ]; then
    _cont_args+=(--narrative "$AUTOPILOT_CONTINUATION_NARRATIVE")
  fi
  if [ -n "$CONTINUATION_DURABLE" ] || [ "$_cont_has_wo" = "1" ] \
      || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
    _cont_args+=(--create-work-order)
  fi
  _cont_json="$(node "$SELF_DIR/compaction-rehydrate.js" "${_cont_args[@]}" 2>/dev/null || true)"
  _cont_status="$(printf '%s' "$_cont_json" | jq -r '.status // empty' 2>/dev/null || true)"
  _cont_action="$(printf '%s' "$_cont_json" | jq -r '.action // empty' 2>/dev/null || true)"
  if [ -z "$_cont_json" ] || [ -z "$_cont_status" ]; then
    die_precondition "continuation admission failed closed (no admission result)"
  fi
  if [ "$_cont_status" = "reject" ] || [ "$_cont_status" = "not_found" ]; then
    _cont_reason="$(printf '%s' "$_cont_json" | jq -r '.reason // .reason_code // "continuation admission rejected"' 2>/dev/null || true)"
    die_precondition "continuation admission: ${_cont_reason:-rejected}"
  fi
  if [ "$_cont_action" = "attach_active" ] || [ "$_cont_action" = "attach_existing" ] \
      || [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
    if [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
      _cont_term="$(printf '%s' "$_cont_json" | jq -r '.terminal_status // empty' 2>/dev/null || true)"
      _cont_hb_args=(heartbeat --git-cwd "$(pwd)" --root-run-id "$_cont_root"
        --graph-node "${STAGE:-implement}" --attempt 1 --owner-pid "$$")
      if [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
        _cont_hb_args+=(--terminal-status "${_cont_term:-aborted}" --disposition consumed)
      fi
      # Shell lifecycle/heartbeat failures fail closed (except not_found when no WO).
      _cont_hb_json="$(node "$SELF_DIR/compaction-rehydrate.js" "${_cont_hb_args[@]}" 2>/dev/null)" || {
        die_precondition "work order lifecycle heartbeat failed closed"
      }
      _cont_hb_st="$(printf '%s' "$_cont_hb_json" | jq -r '.status // empty' 2>/dev/null || true)"
      _cont_hb_rc="$(printf '%s' "$_cont_hb_json" | jq -r '.reason_code // empty' 2>/dev/null || true)"
      if [ -z "$_cont_hb_st" ] || { [ "$_cont_hb_st" = "reject" ] && [ "$_cont_hb_rc" != "not_found" ]; }; then
        die_precondition "work order lifecycle heartbeat failed: ${_cont_hb_rc:-reject}"
      fi
    fi
    _cont_phase="$(printf '%s' "$_cont_json" | jq -r '.phase_cursor // empty' 2>/dev/null || true)"
    _cont_commit="$(printf '%s' "$_cont_json" | jq -r '.accepted_commit // empty' 2>/dev/null || true)"
    _cont_run="$(printf '%s' "$_cont_json" | jq -r '.attached_run_id // empty' 2>/dev/null || true)"
    _cont_next="$(printf '%s' "$_cont_json" | jq -r '.next_action // empty' 2>/dev/null || true)"
    _cont_auth_root="$(printf '%s' "$_cont_json" | jq -r '.root_run_id // empty' 2>/dev/null || true)"
    [ -z "$_cont_auth_root" ] && _cont_auth_root="$_cont_root"
    if [ "$_cont_commit" = "none" ] || [ -z "$_cont_commit" ]; then
      _cont_commit_json="null"
    else
      _cont_commit_json="\"$(_flat_json_escape "$_cont_commit")\""
    fi
    _cont_out_status="attached"
    if [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
      _cont_out_status="consumed"
    fi
    printf '{ "status": "%s", "runner": "continuation-admission", "model": null, "branch": "%s", "base": "%s", "commit": %s, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "root_run_id": %s, "phase_cursor": %s, "next_action": %s, "duplicate_dispatch": 0, "continuation_admission": %s, "duplex": null }\n' \
      "$_cont_out_status" \
      "$(_flat_json_escape "$BRANCH")" \
      "$(_flat_json_escape "$BASE")" \
      "$_cont_commit_json" \
      "$(_flat_json_escape "${EFFECTIVE_SKILL_MODE:-off}")" \
      "${SKILLS_INJECTED_JSON:-[]}" \
      "$([ -n "$_cont_run" ] && printf '"%s"' "$(_flat_json_escape "$_cont_run")" || echo null)" \
      "$([ -n "$_cont_auth_root" ] && printf '"%s"' "$(_flat_json_escape "$_cont_auth_root")" || echo null)" \
      "$([ -n "$_cont_phase" ] && printf '"%s"' "$(_flat_json_escape "$_cont_phase")" || echo null)" \
      "$([ -n "$_cont_next" ] && printf '"%s"' "$(_flat_json_escape "$_cont_next")" || echo null)" \
      "$_cont_json"
    exit 0
  fi
  if [ "$_cont_action" = "dispatch_new" ] && [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
    _CONT_WO_CLAIMED_ROOT="$_cont_root"
    _CONT_WO_CLAIMED_STAGE="${STAGE:-implement}"
    _cont_hb_json="$(node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$(pwd)" \
      --root-run-id "$_cont_root" --graph-node "${STAGE:-implement}" --attempt 1 \
      --owner-pid "$$" --runner self 2>/dev/null)" || {
      die_precondition "work order lifecycle heartbeat failed closed before dispatch effects"
    }
    _cont_hb_st="$(printf '%s' "$_cont_hb_json" | jq -r '.status // empty' 2>/dev/null || true)"
    _cont_hb_rc="$(printf '%s' "$_cont_hb_json" | jq -r '.reason_code // empty' 2>/dev/null || true)"
    if [ -z "$_cont_hb_st" ] || { [ "$_cont_hb_st" = "reject" ] && [ "$_cont_hb_rc" != "not_found" ]; }; then
      die_precondition "work order lifecycle heartbeat failed: ${_cont_hb_rc:-reject}"
    fi
  fi
  unset _cont_args _cont_json _cont_status _cont_action _cont_reason \
    _cont_phase _cont_commit _cont_run _cont_next _cont_commit_json _cont_auth_root \
    _cont_has_wo _cont_out_status _cont_term _cont_hb_args \
    _cont_hb_json _cont_hb_st _cont_hb_rc _cont_wo_claimed _cont_root _cont_common
fi

# AUTOPILOT_TIP_VERIFY_GRACE_FILE is a test-only knob: path of the grace list.
# Unset, the rail reads scripts/lib/tip-verify-grace.json next to this script.
# Not a user setting. A missing or unreadable file counts as an empty list.
tip_verify_grace_file() {
  if [ -n "${AUTOPILOT_TIP_VERIFY_GRACE_FILE:-}" ]; then
    printf '%s' "${AUTOPILOT_TIP_VERIFY_GRACE_FILE}"
  else
    printf '%s' "$SELF_DIR/lib/tip-verify-grace.json"
  fi
}

tip_verify_grace_len() {
  node -e 'const m=require(process.argv[1]); process.stdout.write(String(m.graceRepoCount(process.argv[2])))' \
    "$SELF_DIR/lib/tip-verify-repo-default.js" "$(tip_verify_grace_file)" 2>/dev/null || printf '0'
}

tip_verify_repo_name() {
  local url="" top=""
  url="$(git remote get-url origin 2>/dev/null || true)"
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  node -e 'const m=require(process.argv[1]); process.stdout.write(m.repoName(process.argv[2] || "", process.argv[3] || ""))' \
    "$SELF_DIR/lib/tip-verify-repo-default.js" "$url" "$top" 2>/dev/null || true
}

tip_verify_no_source() {
  local repo_name=""
  repo_name="$(tip_verify_repo_name)"
  printf '%s\n' "dispatch-hetero: tip verify: ${repo_name} has no default test command; add a fenced bash block under ## Test Command in .claude/quality-gate-config.md (or a fenced block under ## Acceptance in the brief); the tip is not re-verified" >&2
  TIP_VERIFY_SKIP=1
  TIP_VERIFY_RESULT_JSON='"no_source"'
}

tip_verify_refuse() {
  die_precondition "no tip-verify command: pass --verify-cmd, or put acceptance commands in a fenced block under ## Acceptance, or set a fenced or whole-line command under ## Test Command in .claude/quality-gate-config.md, or pass --no-verify-tip"
}

# resolve_tip_verify_commands — pick the command list before the worker starts.
# Strict contract keeps its own acceptance path and emits no tip_verify field.
# Defined above the call: bash runs this file top to bottom.
resolve_tip_verify_commands() {
  if [ "${STRICT_CONTRACT:-0}" -eq 1 ]; then
    return 0
  fi
  if [ "${NO_VERIFY_TIP:-0}" -eq 1 ]; then
    TIP_VERIFY_SKIP=1
    TIP_VERIFY_RESULT_JSON='"skipped_by_flag"'
    return 0
  fi
  if [ "${#VERIFY_CMDS[@]}" -gt 0 ]; then
    TIP_VERIFY_SOURCE="flag"
    TIP_VERIFY_CMDS_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "${VERIFY_CMDS[@]}")" \
      || die_precondition "cannot encode --verify-cmd list"
    return 0
  fi
  local extracted="" extract_rc=0 repo_root="" cfg_line=""
  if [ -n "${PROMPT_FILE:-}" ] && [ -r "$PROMPT_FILE" ]; then
    extracted="$(node - "$PROMPT_FILE" <<'NODE'
const fs = require("fs");
const text = fs.readFileSync(process.argv[2], "utf8");
function executableLooking(cmd) {
  const trimmed = String(cmd).trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const token = trimmed.split(/\s+/)[0];
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("/")) return true;
  return /^[A-Za-z][A-Za-z0-9_+-]*$/.test(token);
}
function hasPlaceholder(s) {
  return /<[A-Za-z_][A-Za-z0-9_-]*>/.test(s);
}
const lines = text.split(/\n/);
let inSection = false;
let fence = null;
const cmds = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inSection) {
    if (/^## Acceptance\s*$/.test(line)) inSection = true;
    continue;
  }
  if (/^## /.test(line)) break;
  const trimmed = line.trim();
  if (trimmed.startsWith("```")) {
    if (fence !== null) fence = null;
    else {
      const lang = trimmed.slice(3).trim().split(/\s+/)[0] || "";
      fence = (lang === "" || lang === "bash" || lang === "sh") ? "cmd" : "other";
    }
    continue;
  }
  if (fence !== "cmd") continue;
  if (hasPlaceholder(line)) {
    process.stdout.write("line " + (i + 1) + ": " + line);
    process.exit(3);
  }
  if (executableLooking(line)) cmds.push(trimmed);
}
if (cmds.length) process.stdout.write(JSON.stringify(cmds));
NODE
)" || extract_rc=$?
    if [ "$extract_rc" -eq 3 ]; then
      die_precondition "acceptance fence has a <word> placeholder (${extracted}). put acceptance commands in a fenced block under ## Acceptance"
    fi
    if [ "$extract_rc" -ne 0 ]; then
      extracted=""
    fi
  fi
  if [ -n "$extracted" ] && [ "$extracted" != "[]" ]; then
    TIP_VERIFY_SOURCE="brief"
    TIP_VERIFY_CMDS_JSON="$extracted"
    return 0
  fi
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$repo_root" ] && [ -r "$repo_root/.claude/quality-gate-config.md" ]; then
    cfg_line="$(node "$SELF_DIR/lib/tip-verify-repo-default.js" "$repo_root/.claude/quality-gate-config.md")" || cfg_line=""
  fi
  if [ -n "$cfg_line" ] && [ "$cfg_line" != "[]" ]; then
    TIP_VERIFY_SOURCE="repo_config"
    TIP_VERIFY_CMDS_JSON="$cfg_line"
    return 0
  fi
  # No source yielded a command. A fenced <word> placeholder already refused above.
  if [ "${AUTOPILOT_TIP_VERIFY_REQUIRE:-}" = "1" ]; then
    tip_verify_refuse
  fi
  if [ "$(tip_verify_grace_len)" -gt 0 ]; then
    tip_verify_no_source
    return 0
  fi
  tip_verify_refuse # empty-grace-refuse
}

# run_tip_verify — re-run the captured commands at the committed tip.
# Returns 0 on pass or an explicit skip. Returns non-zero on fail or timeout.
# The caller maps that to status verify_failed, exit 3. Does not reap.
run_tip_verify() {
  if [ "${STRICT_CONTRACT:-0}" -eq 1 ]; then
    return 0
  fi
  if [ "${TIP_VERIFY_SKIP:-0}" -eq 1 ] || [ "${NO_VERIFY_TIP:-0}" -eq 1 ]; then
    # no_source is recorded before the worker. Do not rewrite it as a flag skip.
    if [ "${TIP_VERIFY_RESULT_JSON:-}" != '"no_source"' ]; then
      TIP_VERIFY_RESULT_JSON='"skipped_by_flag"'
    fi
    return 0
  fi
  local cmdfile="" tip_verify_out="" tip_verify_rc=0
  cmdfile="$(mktemp -t 'dispatch-hetero-tip-verify-XX''XX''XX')" || {
    tip_verify_rc=1
    cmdfile=""
  }
  if [ "$tip_verify_rc" -eq 0 ]; then
    printf '%s' "$TIP_VERIFY_CMDS_JSON" > "$cmdfile" || tip_verify_rc=1
  fi
  if [ "$tip_verify_rc" -eq 0 ]; then
    tip_verify_out="$(node - "$WT" "$HEAD_SHA" "$TIP_VERIFY_SOURCE" "$VERIFY_TIMEOUT" "$cmdfile" "$BRANCH" <<'NODE'
const fs = require("fs");
const cp = require("child_process");
// `node -` puts "-" in argv[1]; the real arguments start at argv[2].
const worktree = process.argv[2];
const commit = process.argv[3];
const source = process.argv[4];
const timeoutSec = Number(process.argv[5]);
const cmdFile = process.argv[6];
const branch = process.argv[7];
function emit(payload, code) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(code);
}
let cmds;
try {
  cmds = JSON.parse(fs.readFileSync(cmdFile, "utf8"));
} catch (e) {
  emit({ status: "fail", commit, source, commands: [{ cmd: "", rc: 1, duration_s: 0, tail: "cannot read verify commands" }] }, 1);
}
if (!Array.isArray(cmds) || cmds.length === 0) {
  emit({ status: "fail", commit, source, commands: [{ cmd: "", rc: 1, duration_s: 0, tail: "no verify commands" }] }, 1);
}
const env = Object.assign({}, process.env);
delete env.AUTOPILOT_SESSION_ID;
let devnull = null;
try { devnull = fs.openSync("/dev/null", "r"); } catch (e) { devnull = "ignore"; }
function tailOf(out, err) {
  const a = out ? out.toString("utf8") : "";
  const b = err ? err.toString("utf8") : "";
  let s = a;
  if (b) s += (s && !s.endsWith("\n") ? "\n" : "") + b;
  const lines = s.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-40).join("\n");
}
function gitSha(args) {
  const r = cp.spawnSync("git", ["-C", worktree].concat(args), {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  if (!r || r.error || r.status !== 0) return "";
  return String(r.stdout || "").replace(/\s+$/, "");
}
const commands = [];
let anyTimeout = false;
let anyFail = false;
for (const cmd of cmds) {
  const started = Date.now();
  let result;
  try {
    result = cp.spawnSync("timeout", [String(timeoutSec), "bash", "-c", String(cmd)], {
      cwd: worktree,
      env,
      stdio: [devnull, "pipe", "pipe"],
      timeout: (timeoutSec + 15) * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    commands.push({ cmd: String(cmd), rc: 1, duration_s: Math.round((Date.now() - started) / 1000), tail: String(e && e.message ? e.message : e) });
    anyFail = true;
    continue;
  }
  const duration_s = Math.round((Date.now() - started) / 1000);
  let tail = tailOf(result.stdout, result.stderr);
  let rc;
  let timedOut = false;
  if (result.error && result.error.code === "ETIMEDOUT") {
    timedOut = true;
    rc = 124;
  } else if (result.error && result.error.code === "ENOENT") {
    rc = 127;
    anyFail = true;
  } else if (result.error) {
    rc = 1;
    anyFail = true;
    const errCode = String(result.error.code || "");
    if (errCode) tail = tail ? tail + "\n" + errCode : errCode;
  } else if (typeof result.status === "number") {
    rc = result.status;
    if (rc === 124) timedOut = true;
    else if (rc !== 0) anyFail = true;
  } else if (result.signal) {
    rc = 128;
    anyFail = true;
  } else {
    rc = 1;
    anyFail = true;
  }
  if (timedOut) anyTimeout = true;
  // TIP_MOVED_GATE: a verify command must not move the committed tip.
  const headNow = gitSha(["rev-parse", "HEAD"]);
  const branchNow = gitSha(["rev-parse", "--verify", "refs/heads/" + branch]);
  if (headNow !== commit || branchNow !== commit) {
    anyFail = true;
    if (rc === 0) rc = 1;
    const note = "tip moved: cmd=" + String(cmd) + " expected=" + commit + " head=" + headNow + " branch=" + branchNow;
    tail = note + (tail ? "\n" + tail : "");
  }
  commands.push({ cmd: String(cmd), rc, duration_s, tail });
}
if (typeof devnull === "number") { try { fs.closeSync(devnull); } catch (e) { /* fd already closed */ } }
const status = anyTimeout ? "timeout" : (anyFail ? "fail" : "pass");
const code = status === "pass" ? 0 : (status === "timeout" ? 2 : 1);
emit({ status, commit, source, commands }, code);
NODE
)" || tip_verify_rc=$?
  fi
  [ -n "$cmdfile" ] && rm -f "$cmdfile"
  TIP_VERIFY_RESULT_JSON="$(printf '%s' "$tip_verify_out" | tr -d '\n')"
  if [ -z "$TIP_VERIFY_RESULT_JSON" ]; then
    TIP_VERIFY_RESULT_JSON="$(node -e 'process.stdout.write(JSON.stringify({status:"fail",commit:process.argv[1],source:process.argv[2],commands:[{cmd:"",rc:1,duration_s:0,tail:"tip verify produced no result"}]}))' -- "${HEAD_SHA:-}" "${TIP_VERIFY_SOURCE:-}")" \
      || TIP_VERIFY_RESULT_JSON='{"status":"fail","commit":"","source":"","commands":[]}'
    tip_verify_rc=1
  fi
  # TIP_VERIFY_RC_GATE
  if [ "$tip_verify_rc" -ne 0 ]; then
    return 1
  fi
  return 0
}

if [ -z "$REUSE_WORKTREE" ] \
  && git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  die_precondition "branch already exists: $BRANCH"
fi
resolve_tip_verify_commands
# Claim the durable implementation tuple before branch/worktree/manifest
# creation. This parent-owned lease is required whenever detach was requested,
# even when this host cannot provide setsid --wait and execution later falls
# back inline. Detachment capability controls process topology, never tuple
# exclusivity. A detached child transfers this preclaim after startup; an
# inline run retains the parent lease for its lifetime.
_detach_preclaim=1
case "${DISPATCH_DETACH:-1}" in
  0|false|FALSE|no|NO|off|OFF|No|Off) _detach_preclaim=0 ;;
esac
if [ "$_detach_preclaim" -eq 1 ] \
    && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ]; then
  _preclaim_err="$(mktemp -t 'dispatch-hetero-preclaim-XX''XX''XX')" \
    || die_precondition "cannot allocate durable dispatch claim diagnostic"
  _preclaim="$(bash "$SELF_DIR/run-ledger.sh" stage-acquire \
    --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
    --pid "$$" --git-ref "refs/heads/$BRANCH" --exclusive-live 2>"$_preclaim_err")" \
    || {
      _preclaim_diag="$(cat "$_preclaim_err" 2>/dev/null || true)"
      rm -f "$_preclaim_err"
      die_precondition "durable dispatch claim rejected: ${_preclaim_diag:-unknown}"
    }
  rm -f "$_preclaim_err"
  DETACH_PRECLAIM_GEN="$(printf '%s' "$_preclaim" | jq -r '.generation // empty')"
  DETACH_PRECLAIM_NONCE="$(printf '%s' "$_preclaim" | jq -r '.nonce // empty')"
  [ -n "$DETACH_PRECLAIM_GEN" ] && [ -n "$DETACH_PRECLAIM_NONCE" ] \
    || die_precondition "durable dispatch claim returned invalid ownership identity"
fi
unset _detach_preclaim _preclaim _preclaim_err _preclaim_diag

# Resolve effective skill mode and build prompt-pack if requested
if [[ "$SKILL_MODE" != "off" ]]; then
  EFFECTIVE_SKILL_MODE="$SKILL_MODE"
  local_runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && local_runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && local_runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && local_runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && local_runner="pi"
  [ "${IS_CURSOR:-0}" -eq 1 ] && local_runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && local_runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && local_runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && local_runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && local_runner="claude-native"

  if [[ "$SKILL_MODE" == "auto" ]]; then
    cap_state="$(node "$SELF_DIR/engine-capability-state.js" current --runner "$local_runner" --model "$MODEL" --role implementer 2>/dev/null)"
    is_native_supported_fresh="$(node -e '
      try {
        const data = JSON.parse(process.argv[1]);
        const st = data.capability.skill_transport;
        // Freshness MUST be judged on the native field OWN observation time, not the
        // aggregate observed_at (which follows the latest event of any field — a fresh
        // quota-only event would otherwise make a stale native signal look fresh). Missing
        // per-field timestamp ⇒ treat as not-fresh (fail-safe). (gpt-5.5 P6 F4)
        if (st.native === "supported" && st.native_observed_at) {
          const observed = Date.parse(st.native_observed_at);
          const now = Date.now();
          if (Number.isFinite(observed) && (now - observed) <= 86400 * 1000) {
            console.log("yes");
            process.exit(0);
          }
        }
      } catch (e) {}
      console.log("no");
    ' "$cap_state")"

    if [[ "$is_native_supported_fresh" == "yes" ]]; then
      EFFECTIVE_SKILL_MODE="native"
    elif [[ ${#SKILLS[@]} -gt 0 ]]; then
      EFFECTIVE_SKILL_MODE="prompt"
    else
      EFFECTIVE_SKILL_MODE="off"
    fi
  elif [[ "$SKILL_MODE" == "native" ]]; then
    cap_state="$(node "$SELF_DIR/engine-capability-state.js" current --runner "$local_runner" --model "$MODEL" --role implementer 2>/dev/null)"
    is_native_supported="$(node -e '
      try {
        const data = JSON.parse(process.argv[1]);
        if (data.capability.skill_transport.native === "supported") {
          console.log("yes");
          process.exit(0);
        }
      } catch (e) {}
      console.log("no");
    ' "$cap_state")"

    if [[ "$is_native_supported" != "yes" ]]; then
      die_precondition "Native skill transport is not supported for runner $local_runner model $MODEL"
    fi
  fi

  if [[ "$EFFECTIVE_SKILL_MODE" == "prompt" ]]; then
    if [[ ${#SKILLS[@]} -gt 0 ]]; then
      PACKED_PROMPT_TEMP="$(mktemp -t dispatch-hetero-packed-prompt-XXXXXX)"
      local_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
      SKILL_PACK_CONTENT_TEMP="$(mktemp -t dispatch-hetero-skill-pack-XXXXXX)"

      for skill in "${SKILLS[@]}"; do
        skill_no_ns="${skill#autopilot:}"
        skill_dir="$local_repo_root/skills/$skill_no_ns"
        if [ ! -d "$skill_dir" ]; then
          rm -f "$SKILL_PACK_CONTENT_TEMP"
          die_precondition "skill directory does not exist: skills/$skill_no_ns for skill: $skill"
        fi
        skill_file="$skill_dir/SKILL.md"
        if [ ! -f "$skill_file" ]; then
          rm -f "$SKILL_PACK_CONTENT_TEMP"
          die_precondition "skill file does not exist: skills/$skill_no_ns/SKILL.md for skill: $skill"
        fi
      done

      for skill in "${SKILLS[@]}"; do
        skill_no_ns="${skill#autopilot:}"
        skill_file="$local_repo_root/skills/$skill_no_ns/SKILL.md"
        printf '=== SKILL: %s ===\n' "$skill" >> "$SKILL_PACK_CONTENT_TEMP"
        cat "$skill_file" >> "$SKILL_PACK_CONTENT_TEMP"
        printf '\n=== END SKILL ===\n\n' >> "$SKILL_PACK_CONTENT_TEMP"
      done

      pack_size=$(wc -c < "$SKILL_PACK_CONTENT_TEMP" | tr -d ' ')
      SKILL_PACK_MAX_BYTES=60000
      if [ "$pack_size" -gt "$SKILL_PACK_MAX_BYTES" ]; then
        rm -f "$SKILL_PACK_CONTENT_TEMP"
        die_precondition "skill pack size ($pack_size bytes) exceeds budget of $SKILL_PACK_MAX_BYTES bytes"
      fi

      cat "$SKILL_PACK_CONTENT_TEMP" > "$PACKED_PROMPT_TEMP"
      cat "$PROMPT_FILE" >> "$PACKED_PROMPT_TEMP"
      rm -f "$SKILL_PACK_CONTENT_TEMP"

      PROMPT_FILE="$PACKED_PROMPT_TEMP"

      SKILLS_INJECTED_JSON="$(node -e '
        const skills = process.argv.slice(1);
        console.log(JSON.stringify(skills));
      ' "${SKILLS[@]}")"
    fi
  fi
else
  EFFECTIVE_SKILL_MODE="off"
fi

# A managed campaign passes the already-sealed contract as an explicit leaf input.
# This layer does not reinterpret scope authority; it makes the frozen paths and
# budgets visible to the implementer while ICC retains admission and enforcement.
if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  CAMPAIGN_CONTRACT_SNAPSHOT="$(mktemp -t 'dispatch-hetero-campaign-contract-XX''XX''XX')"
  cp -- "$CAMPAIGN_CONTRACT_FILE" "$CAMPAIGN_CONTRACT_SNAPSHOT" \
    || die_precondition "campaign contract snapshot failed"
  command -v node >/dev/null 2>&1 \
    || die_precondition "node is required to verify the campaign contract digest"
  _campaign_snapshot_digest="$(node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$CAMPAIGN_CONTRACT_SNAPSHOT")" \
    || die_precondition "campaign contract digest verification failed"
  [ "$_campaign_snapshot_digest" = "$CAMPAIGN_CONTRACT_SHA256" ] \
    || die_precondition "campaign contract digest changed after intake"
  CAMPAIGN_PROMPT_FILE="$(mktemp -t 'dispatch-hetero-campaign-prompt-XX''XX''XX')"
  {
    printf '%s\n' '=== MACHINE-OWNED CAMPAIGN BOUNDARY ==='
    printf '%s\n' 'The JSON contract below is immutable. Stay within its allowed paths and budgets.'
    cat "$CAMPAIGN_CONTRACT_SNAPSHOT"
    printf '%s\n\n' '=== END CAMPAIGN BOUNDARY ==='
    cat "$PROMPT_FILE"
  } > "$CAMPAIGN_PROMPT_FILE"
  rm -f "$CAMPAIGN_CONTRACT_SNAPSHOT"
  CAMPAIGN_CONTRACT_SNAPSHOT=""
  unset _campaign_snapshot_digest
  PROMPT_FILE="$CAMPAIGN_PROMPT_FILE"
fi

# --- scaffold-tier envelope (four-layer P1; references/scaffold-tiers.md is canonical) ---
# Prepended to the SHARED prompt file BEFORE the per-runner branches, so every runner
# (codex/grok/cc-shim/agy/pi) consumes the tier identically. Placed before the
# context-window gate so the gate prices the envelope too. Disable per project with
# `scaffold_tiers: off` in .claude/dispatch-config.md.
if [ "$SCAFFOLD_TIER_ARG" != "off" ] \
  && ! grep -qE '^scaffold_tiers:[[:space:]]*off' .claude/dispatch-config.md 2>/dev/null; then
  # shellcheck source=/dev/null
  . "$SELF_DIR/lib/scaffold-envelope.sh"
  _resolved_tier="$(node "$SELF_DIR/resolve-scaffold-tier.js" \
    --runner "$RUNNER" --model "$MODEL" --role implementer 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tier)}catch{process.stdout.write("T2")}});' \
    2>/dev/null)" || _resolved_tier="T2"
  case "$_resolved_tier" in T0|T1|T2) ;; *) _resolved_tier="T2" ;; esac
  _effective_tier="$_resolved_tier"
  if [ "$SCAFFOLD_TIER_ARG" != "auto" ]; then
    case "$SCAFFOLD_TIER_ARG" in T0|T1|T2) ;; *) die_precondition "--scaffold-tier must be auto|off|T0|T1|T2" ;; esac
    # Explicit override may only ADD scaffolding (fail-closure applies to humans too):
    # a request BELOW the resolved scaffolding amount is rejected.
    if [ "$(scaffold_tier_rank "$SCAFFOLD_TIER_ARG")" -lt "$(scaffold_tier_rank "$_resolved_tier")" ]; then
      die_precondition "explicit --scaffold-tier $SCAFFOLD_TIER_ARG requests LESS scaffolding than resolved $_resolved_tier — overrides may only add scaffolding (references/scaffold-tiers.md)"
    fi
    _effective_tier="$SCAFFOLD_TIER_ARG"
  fi
  SCAFFOLD_PROMPT_FILE="$(mktemp -t 'dispatch-hetero-scaffold-prompt-XX''XX''XX')"
  build_scaffold_envelope "$_effective_tier" "$SELF_DIR/../references/scaffold-tiers.md" \
    "$PROMPT_FILE" "$SCAFFOLD_PROMPT_FILE" \
    || die_precondition "scaffold envelope build failed (tier $_effective_tier)"
  PROMPT_FILE="$SCAFFOLD_PROMPT_FILE"
  SCAFFOLD_TIER_EFFECTIVE="$_effective_tier"
  unset _resolved_tier _effective_tier
fi

# vision-guard (scripts/lib/vision-guard.js): the original prompt and, when the
# rail packed a new file, that file too. Refuse before any runner. current_runner_name
# is the resolved engine (RUNNER may still be the literal auto).
_vg_runner="$(current_runner_name)"
_vg_args=(--runner "$_vg_runner" --model "$MODEL")
[ -n "${VISION_PROMPT_FILE:-}" ] && _vg_args+=(--file "$VISION_PROMPT_FILE")
if [ -n "${PROMPT_FILE:-}" ] && [ "$PROMPT_FILE" != "$VISION_PROMPT_FILE" ]; then
  _vg_args+=(--file "$PROMPT_FILE")
fi
if [ "${SCRATCH:-0}" -eq 1 ]; then
  SCRATCH_FINAL_PROMPT="$SCRATCH_WORK_DIR/final-prompt.md"
  cp -- "$PROMPT_FILE" "$SCRATCH_FINAL_PROMPT" || die_precondition "--scratch could not copy the final assembled prompt"
  chmod 600 "$SCRATCH_FINAL_PROMPT" || die_precondition "--scratch could not secure the final assembled prompt"
  rm -f -- "$SCRATCH_WORK_DIR/brief.md"
  _tfg_msg="$(node "$SELF_DIR/lib/cn-model-dispatch-gate.js" check --runner "$RUNNER" --model "$MODEL" --endpoint "${ENDPOINT:-$RUNNER}" --cwd "$SCRATCH_WORK_DIR" ${SOURCE_REPO:+--source-repo "$SOURCE_REPO"} --prompt-file "$SCRATCH_FINAL_PROMPT" 2>&1 >/dev/null)" \
    || die_precondition "${_tfg_msg:-cn_model_dispatch_barred final_prompt_scan_failed (01M7E2A1, d-1dfcf757)}"
  rm -f -- "$SCRATCH_FINAL_PROMPT"
  SCRATCH_FINAL_PROMPT=""
  cp -- "$VISION_PROMPT_FILE" "$SCRATCH_WORK_DIR/brief.md"
  chmod 600 "$SCRATCH_WORK_DIR/brief.md"
  unset _tfg_msg
fi
_vg_msg="$(node "$SELF_DIR/lib/vision-guard.js" "${_vg_args[@]}" 2>&1 >/dev/null)" \
  || die_precondition "${_vg_msg:-vision-guard refused an image for engine ${_vg_runner}/${MODEL} file ${VISION_PROMPT_FILE}}"

# Outbound scan: the final prompt (hands brief after skill-pack / campaign / scaffold)
# is scanned once, after the vision and cn-model gates and before any runner spawn.
# Categories only — never the matched text. A hit is a no-spawn precondition failure.
_os_cats="$(node "$SELF_DIR/lib/outbound-secret-scan.js" --categories "$PROMPT_FILE")"; _os_rc=$?
if [ "$_os_rc" -ne 0 ]; then
  die_precondition "outbound_secret: ${_os_cats:-unreadable}"
fi
unset _os_cats _os_rc

# --- context-window gate ---
# Placed AFTER skill-pack concatenation (the pack inflates PROMPT_FILE, and the engine
# pays for the packed size, not the original) and BEFORE the worktree exists, so an
# over-budget unit costs neither tokens nor a worktree to reap. This generalizes the
# skill-pack's own SKILL_PACK_MAX_BYTES check above from one input to the whole payload.
if declare -F context_window_gate > /dev/null 2>&1; then
  _CB_MODE="$(context_window_mode "${CONTEXT_WINDOW_GATE:-}")"
  if ! context_window_gate "$_CB_MODE" "$SELF_DIR" "$MODEL" "${PROMPT_FILE:-}"; then
    die_precondition "context budget exceeded: ${CONTEXT_WINDOW_REASON:-over budget}"
  fi
fi

# Reconcile crash-window records and count retained occupancy while the caller
# holds the repository-common budget lock. Unknown/legacy state is preserved and
# consumes capacity; only exact, dead, clean state is reclaimed.
_wt_budget_reconcile_and_count() {
  local repo="$1" common="$2" root_id="$3"
  local pending_dir="$common/autopilot-worktree-creation"
  local record fields=() record_root record_run record_loop record_branch record_base record_path
  local current_tip live_rc probe_fd wt marker line actual_branch actual_head marker_digest
  local registered_rc worktree_list
  local -A pending_paths=()
  WT_BUDGET_COUNT=0

  if [ -e "$pending_dir" ] || [ -L "$pending_dir" ]; then
    [ -d "$pending_dir" ] && [ ! -L "$pending_dir" ] && [ -O "$pending_dir" ] || return 2
  else
    (umask 077; mkdir "$pending_dir") || return 2
  fi

  for record in "$pending_dir"/*.json; do
    [ -e "$record" ] || continue
    [ -f "$record" ] && [ ! -L "$record" ] && [ -O "$record" ] || {
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    }
    mapfile -t fields < <(node -e '
const fs = require("fs");
try {
  const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = ["root_run_id", "run_id", "loop_id", "branch", "base_sha", "planned_path"];
  if (!v || v.schema !== 1 || keys.some(k => typeof v[k] !== "string" || /[\r\n\t]/.test(v[k]))) process.exit(2);
  for (const k of keys) console.log(v[k]);
} catch (_) { process.exit(2); }
' "$record" 2>/dev/null)
    if [ "${#fields[@]}" -ne 6 ]; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    record_root="${fields[0]}"; record_run="${fields[1]}"; record_loop="${fields[2]}"
    record_branch="${fields[3]}"; record_base="${fields[4]}"; record_path="${fields[5]}"
    if ! [[ "$record_root" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_run" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_loop" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_base" =~ ^[0-9a-f]{40,64}$ ]] \
       || [[ "$record_path" != /* ]] \
       || ! git check-ref-format --branch "$record_branch" >/dev/null 2>&1; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi

    _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || return 2
    if [ "$registered_rc" -eq 0 ]; then
      marker="$record_path/.autopilot-worktree"
      if [ -e "$marker" ] || [ -L "$marker" ]; then
        if _wt_read_schema2_marker "$marker" \
           && [ "$_WT_MARKER_ROOT_RUN_ID" = "$record_root" ] \
           && [ "$_WT_MARKER_RUN_ID" = "$record_run" ] \
           && [ "$_WT_MARKER_LOOP_ID" = "$record_loop" ] \
           && [ "$_WT_MARKER_BRANCH" = "$record_branch" ] \
           && [ "$_WT_MARKER_BASE_SHA" = "$record_base" ]; then
          rm -f -- "$record"
        elif [ "$record_root" = "$root_id" ]; then
          WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
          pending_paths["$record_path"]=1
        fi
        # A marker that exists but does not match is positive evidence of an
        # ownership conflict, never the add-before-marker crash window.
        continue
      fi

      _wt_is_live "$record_path"; live_rc=$?
      probe_fd="${_WT_PROBE_FD:-}"
      current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$record_branch" 2>/dev/null || true)"
      actual_branch="$(git -C "$record_path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
      actual_head="$(git -C "$record_path" rev-parse HEAD 2>/dev/null || true)"
      _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
      [ "$registered_rc" -ne 2 ] || {
        [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
        return 2
      }
      if [ "$live_rc" -eq 0 ] && [ "$registered_rc" -eq 0 ] \
         && _wt_is_clean "$record_path" \
         && [ "$actual_branch" = "$record_branch" ] \
         && [ "$actual_head" = "$record_base" ] \
         && [ "$current_tip" = "$record_base" ] \
         && [ ! -e "$marker" ] && [ ! -L "$marker" ] \
         && _wt_is_clean "$record_path"; then
        # No --force: git is the last compare/remove guard if dirt appears
        # after the immediately preceding cleanliness read.
        if _wt_check_live_or_log_skip "dispatch-hetero.sh" "$record_path" "$record_branch" "pending_crash_window" "held_by_us"; then
          if git -C "$repo" worktree remove "$record_path" >/dev/null 2>&1; then
            _wt_log_removal "dispatch-hetero.sh" "$record_path" "$record_branch" "pending_crash_window" "held_by_us" "removed"
          else
            _wt_log_removal "dispatch-hetero.sh" "$record_path" "$record_branch" "pending_crash_window" "held_by_us" "failed"
          fi
        fi
        _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
        [ "$registered_rc" -ne 2 ] || {
          [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
          return 2
        }
        if [ "$registered_rc" -eq 1 ]; then
          # Keep the branch and pending record as exact evidence for the Phase
          # 2/3 lifecycle controller. Deleting a ref here cannot atomically
          # prove that an ordinary concurrent Git operation did not just check
          # it out in another worktree.
          :
        fi
      fi
      [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
      _WT_PROBE_FD=""
      if [ -e "$record" ] && [ "$record_root" = "$root_id" ]; then
        WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
        pending_paths["$record_path"]=1
      fi
    else
      current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$record_branch" 2>/dev/null || true)"
      if [ -z "$current_tip" ]; then
        rm -f -- "$record"
      fi
      if [ -e "$record" ] && [ "$record_root" = "$root_id" ]; then
        WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      fi
    fi
  done

  worktree_list="$(git -C "$repo" worktree list --porcelain 2>/dev/null)" || return 2
  while IFS= read -r line; do
    wt="${line#worktree }"
    [ -d "$wt" ] || continue
    [ -z "${pending_paths[$wt]+present}" ] || continue
    marker="$wt/.autopilot-worktree"
    [ -f "$marker" ] || continue
    if grep -qx 'schema=1' "$marker" 2>/dev/null; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    if ! _wt_read_schema2_marker "$marker"; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    [ "$_WT_MARKER_ROOT_RUN_ID" = "$root_id" ] || continue
    if [ "$_WT_MARKER_RETENTION" = "inspect" ] \
       || { [ "$_WT_MARKER_RETENTION" = "lease" ] \
         && [ "$_WT_MARKER_RETENTION_EXPIRES_AT" -gt "$(date +%s)" ]; }; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    marker_digest="$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')"
    actual_branch="$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    actual_head="$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)"
    current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$_WT_MARKER_BRANCH" 2>/dev/null || true)"
    if [ -z "$marker_digest" ] \
       || [ "$actual_branch" != "$_WT_MARKER_BRANCH" ] \
       || [ "$actual_head" != "$current_tip" ] \
       || ! git -C "$repo" merge-base --is-ancestor "$_WT_MARKER_BASE_SHA" "$actual_head" 2>/dev/null; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi

    _wt_is_live "$wt"; live_rc=$?
    probe_fd="${_WT_PROBE_FD:-}"
    _wt_is_registered_path "$repo" "$wt"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || {
      [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
      return 2
    }
    if [ "$live_rc" -eq 0 ] && [ "$registered_rc" -eq 0 ] \
       && [ "$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')" = "$marker_digest" ] \
       && [ "$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || true)" = "$actual_branch" ] \
       && [ "$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)" = "$actual_head" ] \
       && [ "$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$_WT_MARKER_BRANCH" 2>/dev/null || true)" = "$actual_head" ] \
       && _wt_is_clean "$wt"; then
      if _wt_check_live_or_log_skip "dispatch-hetero.sh" "$wt" "$actual_branch" "dead_clean_budget_reconcile" "held_by_us"; then
        if git -C "$repo" worktree remove "$wt" >/dev/null 2>&1; then
          _wt_log_removal "dispatch-hetero.sh" "$wt" "$actual_branch" "dead_clean_budget_reconcile" "held_by_us" "removed"
        else
          _wt_log_removal "dispatch-hetero.sh" "$wt" "$actual_branch" "dead_clean_budget_reconcile" "held_by_us" "failed"
        fi
      fi
    fi
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    _wt_is_registered_path "$repo" "$wt"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || return 2
    if [ "$registered_rc" -eq 0 ]; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
    fi
  done < <(printf '%s\n' "$worktree_list" | sed -n '/^worktree /p')
  return 0
}

# --- isolated worktree (the non-skippable safety rail) ---
BASE_SHA="$(git rev-parse "$BASE")"

WT_RUN_ID="$(printf '%s' "$DISPATCH_RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
WT_LOOP_ID="${AUTOPILOT_LOOP_ID:-${LINEAGE_PARENT:-$DISPATCH_RUN_ID}}"
WT_LOOP_ID="$(printf '%s' "$WT_LOOP_ID" | tr -c 'A-Za-z0-9._-' '-')"
_wt_repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die_precondition "cannot resolve consuming repository root"
_wt_common_dir="$(_wt_resolve_common_dir "$_wt_repo_root")" \
  || die_precondition "cannot resolve canonical git common directory"
if [ -n "$REUSE_WORKTREE" ]; then
  WT="$(realpath "$REUSE_WORKTREE" 2>/dev/null)" \
    || die_precondition "cannot canonicalize retained worktree path"
  _wt_open_lock_fd "$WT/.autopilot-worktree.lock" \
    || die_precondition "cannot open retained worktree lifetime lock"
  WT_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_LOCK_FD" \
    || die_precondition "cannot acquire retained worktree lifetime lock"
  _actual_worktree_instance="$(
    node - "$WT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const worktree = path.resolve(process.argv[2]);
const stat = fs.statSync(worktree, { bigint: true });
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({
  birthtime_ns: stat.birthtimeNs.toString(),
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  schema: 1,
  worktree,
})).digest('hex'));
NODE
  )" || die_precondition "cannot attest retained worktree filesystem instance"
  [ "$_actual_worktree_instance" = "$EXPECTED_WORKTREE_INSTANCE" ] \
    || die_precondition "retained worktree filesystem instance changed"
  _wt_is_registered_path "$_wt_repo_root" "$WT"
  [ "$?" -eq 0 ] || die_precondition "retained worktree is not registered"
  wt_record_gitfile_from_registry "$WT" \
    || die_precondition "retained worktree is not registered with a gitdir pointing at it"
  wt_gitfile_check || die_precondition "retained worktree refused: $WT_GITFILE_ERROR"
  [ "$(_wt_git symbolic-ref --quiet --short HEAD 2>/dev/null || true)" = "$BRANCH" ] \
    || die_precondition "retained worktree branch does not match --branch"
  [ "$(_wt_git rev-parse HEAD 2>/dev/null || true)" = "$BASE_SHA" ] \
    || die_precondition "retained worktree HEAD does not match --base"
  [ -z "$(_wt_git status --porcelain --ignore-submodules=dirty 2>/dev/null)" ] \
    || die_precondition "retained worktree is dirty"
  _wt_read_schema2_marker "$WT/.autopilot-worktree" \
    || die_precondition "retained worktree marker is invalid"
  [ "$_WT_MARKER_BRANCH" = "$BRANCH" ] \
    || die_precondition "retained worktree marker branch mismatch"
  [ "$_WT_MARKER_ROOT_RUN_ID" = "$WORKTREE_ROOT_RUN_ID" ] \
    || die_precondition "retained worktree root identity mismatch"
  # busy_at_run reuses the worktree this process just prepared. The failure path
  # stamps a residue lease; that stamp is not an operator --keep-worktree lease.
  if [ "${LOCAL_BUSY_REDISPATCH:-}" != "1" ]; then
    [ "$_WT_MARKER_RETENTION_OWNER" = "$RETENTION_OWNER" ] \
      || die_precondition "retained worktree lease owner mismatch"
    [ "$_WT_MARKER_RETENTION_REASON_SHA256" = "$RETENTION_REASON_SHA256" ] \
      || die_precondition "retained worktree lease reason mismatch"
    [ "$_WT_MARKER_RETENTION_EXPIRES_AT" = "$RETENTION_EXPIRES_AT" ] \
      || die_precondition "retained worktree lease expiry mismatch"
  fi
  WORKTREE_REUSED=1
else
  # Under <main checkout>/.claude/worktrees/ (resolve-repo-placement.js; temp dir on its fallback).
  _wt_template="$(node "$SELF_DIR/resolve-repo-placement.js" worktree --prefix hetero --slug "$BRANCH" --from "$_wt_repo_root")" \
    || die_precondition "cannot resolve worktree placement"
  if [ -n "$WORKTREE_PARENT" ]; then
    _wt_template="$(realpath "$WORKTREE_PARENT")/$(basename "$_wt_template")"
  fi
  WT="$(mktemp -u -d "$_wt_template")"
  WT="$(realpath -m "$WT" 2>/dev/null)" \
    || die_precondition "cannot canonicalize planned worktree path"
fi

if [ "$SANDBOX" = "bwrap" ] && _sbx_nested="$(sandbox_nested_repo "$WT")"; then
  die_precondition "--sandbox bwrap refused: the worktree $WT sits inside the working tree of a repo ($_sbx_nested). The sandbox needs the worktree outside every repo (independent clone, not a nested .claude/worktrees); pass --worktree-parent <dir outside any repo> or --reuse-worktree <such a path>"
fi

_wt_prepare_common_excludes() {
  mkdir -p "$_wt_common_dir/info" || return 1
  local exclude="$_wt_common_dir/info/exclude" name names=(.autopilot-worktree .autopilot-worktree.lock)
  # A worktree inside the main checkout must not show there as untracked.
  case "$WT" in */.claude/worktrees/*) names+=(/.claude/worktrees/) ;; esac
  for name in "${names[@]}"; do
    grep -qxF "$name" "$exclude" 2>/dev/null \
      || printf '%s\n' "$name" >> "$exclude" \
      || return 1
  done
}

_wt_creation_test_checkpoint() {
  [ "${AUTOPILOT_TEST_WORKTREE_CRASH_AT:-}" = "$1" ] || return 0
  case "$1" in
    after-pending|after-add|after-marker|after-verification) kill -KILL "$$" ;;
  esac
}

_wt_lock_fail() {
  # This path runs before the worker starts, but external state can still race
  # marker/lock setup. Never force-remove newly dirty data, and delete the ref
  # only if it still has the exact creation tip.
  if [ "${WORKTREE_REUSED:-0}" -eq 1 ]; then
    [ -n "$WT_LOCK_FD" ] && exec {WT_LOCK_FD}>&-
    [ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
    WT_LOCK_FD=""
    WT_BUDGET_LOCK_FD=""
    die_precondition "$1"
  fi
  local _fail_lock_state="free"
  if [ -n "${WT_LOCK_FD:-}" ]; then
    _fail_lock_state="held_by_us"
    exec {WT_LOCK_FD}>&- || true
    WT_LOCK_FD=""
  fi
  if [ -n "${WT:-}" ] && [ -d "$WT" ]; then
    if _wt_check_live_or_log_skip "dispatch-hetero.sh" "$WT" "$BRANCH" "lock_or_marker_setup_failed" "$_fail_lock_state"; then
      if git worktree remove "$WT" >/dev/null 2>&1; then
        _wt_log_removal "dispatch-hetero.sh" "$WT" "$BRANCH" "lock_or_marker_setup_failed" "$_fail_lock_state" "removed"
      else
        _wt_log_removal "dispatch-hetero.sh" "$WT" "$BRANCH" "lock_or_marker_setup_failed" "$_fail_lock_state" "failed"
      fi
    fi
  fi
  if [ -z "$WT_PENDING_RECORD" ] && [ ! -d "${WT:-/nonexistent}" ]; then
    git update-ref -d "refs/heads/$BRANCH" "$BASE_SHA" >/dev/null 2>&1 || true
  fi
  if [ -n "$WT_PENDING_RECORD" ]; then
    _wt_is_registered_path "${_wt_repo_root:-.}" "$WT"
    _wt_cleanup_registered_rc=$?
    _wt_cleanup_branch="$(git rev-parse --verify --quiet "refs/heads/$BRANCH" 2>/dev/null || true)"
    if [ "$_wt_cleanup_registered_rc" -eq 1 ] && [ -z "$_wt_cleanup_branch" ]; then
      rm -f -- "$WT_PENDING_RECORD"
    fi
  fi
  [ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
  WT_PENDING_RECORD=""
  WT_BUDGET_LOCK_FD=""
  die_precondition "$1"
}

# kimi argv-payload ceiling — refuse BEFORE anything is created, so the `precondition_failed`
# contract ("nothing was created") holds. Copied in shape from dispatch-review.sh's kimi gate
# (~line 1136-1146): kimi 0.41.0 takes the prompt ONLY as the -p argv string — no --prompt-file,
# no STDIN (Stage-0 spike 2026-09-11, docs/plans/_archive/2026/09/2026-09-11-kimi-implementer-rail.md §0: `-p ''`
# is rejected, `-p -` is taken literally) — so the EDIT-ONLY directive plus the task prompt
# travel as ONE argv string and execve rejects it over Linux's MAX_ARG_STRLEN (131072 bytes),
# before kimi starts and with no vendor error to report. KIMI_EDIT_ONLY is set here (not inside
# run_agent) so the byte count matches EXACTLY what the run arm below sends — same directive
# text, computed once. Test seam: KIMI_ARGV_LIMIT (default 120000, env-overridable).
if [ "$IS_KIMI" -eq 1 ] && [ "$BIN_FLAG_KIMI" -eq 1 ]; then
  KIMI_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.

Before finishing, write \$AUTOPILOT_EVIDENCE_NOTES with sections \`## Tests\` (lines \`<rc> <command>\`) and \`## Risk\` (first line low|medium|high, then one sentence). Never create notes or evidence files inside the worktree.
===

"
  KIMI_ARGV_LIMIT="${KIMI_ARGV_LIMIT:-120000}"
  KIMI_ARGV_BYTES=$(( $(printf '%s' "$KIMI_EDIT_ONLY" | wc -c) + $(wc -c < "$PROMPT_FILE") ))
  KIMI_INDIRECT=0
  if [ "$KIMI_ARGV_BYTES" -gt "$KIMI_ARGV_LIMIT" ]; then
    KIMI_INDIRECT=1
  fi
fi

# Count the final packed prompt plus the exact directive before creating a worktree.
if [ "$IS_CURSOR" -eq 1 ] || { [ "$IS_KIMI" -eq 1 ] && [ "$BIN_FLAG_KIMI" -eq 0 ]; }; then
  _broker_runner=cursor; [ "$IS_KIMI" -eq 0 ] || _broker_runner=kimi
  _cursor_prompt_check="$(node -e 'require(process.argv[1]).readPrompt(process.argv[2], process.argv[3])' "$SELF_DIR/lib/cursor-broker-client.js" "$PROMPT_FILE" "$_broker_runner" 2>&1)" \
    || die_precondition "$_cursor_prompt_check"
fi

if [ "$WORKTREE_REUSED" -eq 0 ]; then
  # Disk guard (build-artifact-reap): sweeps idle declared build output, then refuses on a nearly full
  # disk, before any record, branch or worktree exists. Only exit 3 refuses; a guard crash degrades.
  _dg_out="$(node "$SELF_DIR/lib/disk-guard.js" check --path "$WT" --repo "$(git rev-parse --show-toplevel 2>/dev/null)" 2>&1 >/dev/null)" && _dg_rc=0 || _dg_rc=$?
  [ "$_dg_rc" -ne 3 ] || die_precondition "$_dg_out"
fi

if [ "$WORKTREE_REUSED" -eq 0 ] && [ "$WORKTREE_MANAGED" -eq 1 ]; then
  # Admission must precede the first pending record, branch, or worktree. Once
  # active, evidence loss cannot be reinterpreted as an empty lifecycle root.
  bash "$SELF_DIR/reap-dispatch-worktrees.sh" scan \
    --repo "$_wt_repo_root" --root-run-id "$WORKTREE_ROOT_RUN_ID" >/dev/null \
    || die_precondition "cannot admit managed worktree lifecycle root"

  _wt_open_lock_fd "$_wt_common_dir/autopilot-worktree-budget.lock" \
    || die_precondition "cannot open worktree resource budget lock"
  WT_BUDGET_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_BUDGET_LOCK_FD" \
    || die_precondition "cannot acquire worktree resource budget lock"

  # Install bookkeeping exclusions before reconciliation probes can create a
  # lifetime lock in an add-before-marker crash artifact.
  _wt_prepare_common_excludes \
    || die_precondition "cannot register worktree bookkeeping exclusion"

  _wt_budget_reconcile_and_count "$_wt_repo_root" "$_wt_common_dir" "$WORKTREE_ROOT_RUN_ID" \
    || die_precondition "cannot reconcile worktree creation state"
  _wt_budget_limit="$(bash "$SELF_DIR/resolve-worktree-teardown.sh" --field max_leaf_worktrees_per_root 2>/dev/null || true)"
  [[ "$_wt_budget_limit" =~ ^[0-9]+$ ]] || _wt_budget_limit=4
  if [ "$WT_BUDGET_COUNT" -ge "$_wt_budget_limit" ]; then
    exec {WT_BUDGET_LOCK_FD}>&-
    WT_BUDGET_LOCK_FD=""
    die_resource_budget "$WT_BUDGET_COUNT" "$_wt_budget_limit"
  fi

  worktree_intent_write "$_wt_common_dir" "$WORKTREE_ROOT_RUN_ID" "$WT_RUN_ID" "$WT_LOOP_ID" "$BRANCH" "$BASE_SHA" "$WT" \
    || {
      exec {WT_BUDGET_LOCK_FD}>&-
      WT_BUDGET_LOCK_FD=""
      die_precondition "cannot publish worktree creation record: $WORKTREE_INTENT_ERROR"
    }
  WT_PENDING_RECORD="$WORKTREE_INTENT_RECORD"
  _wt_creation_test_checkpoint after-pending
elif [ "$WORKTREE_REUSED" -eq 0 ]; then
  _wt_prepare_common_excludes \
    || die_precondition "cannot register worktree bookkeeping exclusion"
fi

# --- main-checkout boundary (item (E), 2026-09-13) ---------------------------------------
# Hands run in $WT, never here. But a worktree shares refs and remotes with the main
# checkout, and git refuses only `checkout` of a branch held elsewhere: `git -C <main>`,
# `update-ref`, and — the irreversible one — `git push` all work from inside $WT. A peer
# measured agy committing straight to the main branch because a brief said "commit".
# Two layers, neither trusting the prompt's "do not push":
#   prevention — the worker's env sets `protocol.allow=never` (GIT_CONFIG_COUNT env config).
#     git then refuses EVERY remote transport — file, ssh, https — at the core, before any
#     hook: `--no-verify` does not bypass it, a tag push does not bypass it, and a
#     repo-configured pushurl does not bypass it. Measured 2026-09-13 against all three
#     transports; commit, worktree add and the repo's own pre-commit hook are unaffected.
#     Two designs were tried and rejected by measurement first: `remote.<r>.pushurl` is
#     multivalued, so an env value is APPENDED and the push lands on the repo's own pushurl;
#     `core.hooksPath` + a refusing pre-push is skipped by `--no-verify` and shadows every
#     other repo hook. Fetch is blocked too, which is correct: the worktree is pinned at
#     BASE_SHA and hands have no business moving it. Inherited GIT_CONFIG_* entries are
#     preserved by continuing the index. This is an accident guard, not a sandbox: a worker
#     that `env -i`s or unsets the variable is evading, and detection is the backstop.
#   detection — the main checkout is fingerprinted before hands and re-read after, on EVERY
#     outcome (MAIN_CHECKOUT_FP_REF_SCOPE=round, fleet 01M788GD): HEAD sha and symbolic
#     target (rev-parse, whose rc separates "detached" from "could not measure"), the branch
#     that checkout is on, this round's --base when it names a ref, this round's own --branch
#     exempt unless it is that branch or the --base ref, every non-branch ref (tags, remotes,
#     replace, notes), and the index + worktree dirty inventory. Creating, moving or deleting
#     any other refs/heads/* is not a mutation, and adding or removing another worktree is
#     not one either. A real main-checkout change (HEAD moved, its branch moved, the working
#     tree dirtied, a tag/remote/replace/config/hook change) still rejects as
#     `main_checkout_mutated`. A measurement that fails yields UNVERIFIABLE-<nonce> and
#     never compares equal. This CANNOT attribute a real change: a concurrent edit of this
#     checkout discards the round with the worktree retained. Re-dispatch once the main
#     checkout is quiescent.
MAIN_CHECKOUT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
# The fingerprint and the env block are ONE implementation shared with dispatch-foreman.sh:
# scripts/lib/main-checkout-boundary.sh (extracted 2026-09-13, behaviour unchanged).
# shellcheck source=lib/main-checkout-boundary.sh
source "$SELF_DIR/lib/main-checkout-boundary.sh"
# 308 BACKLOG #46: a parent rail (dispatch-foreman.sh) can pre-set the sibling namespace this
# hand should ignore via env instead of an argv flag; CLI --sibling-ref-prefix/--sibling-path-
# prefix above still apply and this only ADDS to the same arrays.
main_checkout_seed_sibling_env_defaults
MAIN_CHECKOUT_BEFORE_PARTS="$(MAIN_CHECKOUT_FP_MODE=parts main_checkout_fingerprint)"
MAIN_CHECKOUT_BEFORE="$(main_checkout_parts_digest "$MAIN_CHECKOUT_BEFORE_PARTS")"
build_hands_git_env

if [ "$WORKTREE_REUSED" -eq 0 ] && [ "$SCRATCH" -eq 1 ]; then
  if ! git worktree add --quiet --orphan -b "$BRANCH" "$WT"; then
    _wt_lock_fail "git worktree add failed"
  fi
elif [ "$WORKTREE_REUSED" -eq 0 ] \
  && ! git worktree add --quiet "$WT" -b "$BRANCH" "$BASE_SHA"; then
  # `git worktree add -b` creates the branch ref BEFORE the dir, so the ref leaks
  # even when dir creation fails (verified 2026-06-22). Reap it before bailing.
  _wt_lock_fail "git worktree add failed"
fi
DIFF_BASE_SHA="$BASE_SHA"
if [ "$SCRATCH" -eq 1 ]; then
  DIFF_BASE_SHA="$(git hash-object -t tree -w /dev/null)" \
    || _wt_lock_fail "cannot resolve empty tree for scratch diff"
fi
# Acquire the exclusive lifetime lock IMMEDIATELY after directory creation — BEFORE
# publishing the branch ledger row or .autopilot-worktree marker — so no external
# reaper can ever observe a marked, unlocked worktree. Never close early; preserve
# across setsid detach so detached_main holds it until the round's last write.
if [ "$WORKTREE_REUSED" -eq 0 ]; then
  _wt_open_lock_fd "$WT/.autopilot-worktree.lock" \
    || _wt_lock_fail "cannot open worktree lifetime lock"
  WT_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_LOCK_FD" || _wt_lock_fail "cannot acquire worktree lifetime lock"
fi
# Branch->session ledger row (close-out ownership). Fail-open: never fails the dispatch.
# An enforce --no-campaign admission adds campaign_scope and the mode seen to that
# same appended line. Every other dispatch passes empty args and the row is unchanged.
_LEDGER_CAMPAIGN_SCOPE=""
_LEDGER_ENFORCEMENT_MODE=""
if [ "${NO_CAMPAIGN:-0}" -eq 1 ] && [ -n "${MISSION_ENFORCEMENT_MODE_SEEN:-}" ]; then
  _LEDGER_CAMPAIGN_SCOPE="none_declared"
  _LEDGER_ENFORCEMENT_MODE="$MISSION_ENFORCEMENT_MODE_SEEN"
fi
[ "$WORKTREE_REUSED" -eq 1 ] \
  || dispatch_branch_ledger_append "$_wt_common_dir" "$BRANCH" "$WT_RUN_ID" "$WORKTREE_ROOT_RUN_ID" "$BASE_SHA" \
       "$_LEDGER_CAMPAIGN_SCOPE" "$_LEDGER_ENFORCEMENT_MODE"
[ "$WORKTREE_REUSED" -eq 1 ] || _wt_creation_test_checkpoint after-add
# Marker = --gc eligibility token (name-independent). Lifetime flock = liveness gate
# (kernel-released on process death incl. SIGKILL; no pid checks — plan §2a/§2c).
# Both names are registered in the COMMON git dir's info/exclude below: the wrapper
# commits with `git add -A`, so without the exclude both bookkeeping files would
# land in every dispatched commit, and `git status --porcelain` cleanliness checks
# would see them as untracked.
_wt_marker_tmp="$WT/.autopilot-worktree.tmp.$$"
{
  if [ "$WORKTREE_REUSED" -eq 1 ]; then
    printf 'created_at=%s\n' "$_WT_MARKER_CREATED_AT"
  else
    printf 'created_at=%s\n' "$(date +%s)"
  fi
  printf 'branch=%s\n' "$BRANCH"
  printf 'base_sha=%s\n' "$BASE_SHA"
  printf 'run_id=%s\n' "$WT_RUN_ID"
  printf 'root_run_id=%s\n' "$WORKTREE_ROOT_RUN_ID"
  if [ "$WORKTREE_REUSED" -eq 1 ]; then
    printf 'loop_id=%s\n' "$_WT_MARKER_LOOP_ID"
  else
    printf 'loop_id=%s\n' "$WT_LOOP_ID"
  fi
  if [ "$KEEP" -eq 1 ]; then
    printf 'retention=lease\n'
    printf 'retention_owner=%s\n' "$RETENTION_OWNER"
    printf 'retention_reason_sha256=%s\n' "$RETENTION_REASON_SHA256"
    printf 'retention_expires_at=%s\n' "$RETENTION_EXPIRES_AT"
  fi
  printf 'schema=2\n'
} > "$_wt_marker_tmp"
mv -f -- "$_wt_marker_tmp" "$WT/.autopilot-worktree" \
  || _wt_lock_fail "cannot publish worktree ownership marker"
_wt_creation_test_checkpoint after-marker
if ! _wt_read_schema2_marker "$WT/.autopilot-worktree" \
   || [ "$_WT_MARKER_RUN_ID" != "$WT_RUN_ID" ] \
   || [ "$_WT_MARKER_ROOT_RUN_ID" != "$WORKTREE_ROOT_RUN_ID" ] \
   || { [ "$WORKTREE_REUSED" -eq 0 ] && [ "$_WT_MARKER_LOOP_ID" != "$WT_LOOP_ID" ]; } \
   || [ "$_WT_MARKER_BRANCH" != "$BRANCH" ] \
   || [ "$_WT_MARKER_BASE_SHA" != "$BASE_SHA" ]; then
  _wt_lock_fail "worktree ownership marker verification failed"
fi
_wt_creation_test_checkpoint after-verification
# The gitfile `$WT/.git` is a pointer the rail's own git calls follow. Record it now; wt_gitfile_check
# (below) refuses to run any git against $WT once it differs (a worker that repointed it at a dir with
# a hostile config would otherwise get its core.fsmonitor / hooks run by the rail, outside the sandbox).
[ -n "$WT_GITFILE_EXPECTED" ] || WT_GITFILE_EXPECTED="$(cat "$WT/.git" 2>/dev/null)"
[ -n "$WT_PENDING_RECORD" ] && rm -f -- "$WT_PENDING_RECORD"
WT_PENDING_RECORD=""
[ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
WT_BUDGET_LOCK_FD=""
LOG="$(mktemp -t "hetero-${BRANCH//\//-}-log-XXXXXX")"

# Snapshot consuming-repo git identity BEFORE the runner (worktrees share .git/config;
# a bare `git config user.name` inside the worktree would silently rewrite the host repo).
# Capture host repo root once so emit() restore uses git -C (cwd-independent).
IDENTITY_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$IDENTITY_REPO_ROOT" ]; then
  # --local only: effective-scope reads would materialize a global identity as local on restore.
  IDENTITY_PRE_NAME="$(git -C "$IDENTITY_REPO_ROOT" config --local user.name 2>/dev/null || true)"
  IDENTITY_PRE_EMAIL="$(git -C "$IDENTITY_REPO_ROOT" config --local user.email 2>/dev/null || true)"
  gitconfig_containment_snapshot "$IDENTITY_REPO_ROOT" || true
fi

# --- worker containment (BEST-EFFORT teardown — NOT a malicious-worker boundary) ---
# Purpose: reap escaped descendants so a long/aborted run doesn't leak background
# processes. A plain process-GROUP kill misses a `setsid`-escaped child; a cgroup
# catches it (verified: setsid child stays in cgroup.procs, dies on cgroup.kill).
# Containment tier (provenance only):
#   cgroup  — systemd-run --user --scope; cgroup.kill reaps the subtree incl. setsid
#             escapes; emits CONTAINMENT=cgroup + CONTAINED=1 when the scope verifies
#             empty.
#   setsid  — own session, reaped by session-pgroup kill (catches ordinary children,
#             not a deliberate inner setsid). CONTAINMENT=setsid.
#   plain   — no container available. CONTAINMENT=plain.
# WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 (scripts/lib/worker-containment.sh) forces
# HAVE_CGROUP=0. Hetero honors that switch so the setsid fallback can be tested
# without removing systemd.
# IMPORTANT — NOT malicious-proof: a same-user worker can `systemd-run --user --scope`
# a SIBLING cgroup OUTSIDE this scope (gpt-5.5 review 2026-06-26 verified the sibling
# survives our reap), so `contained:true` is teardown hygiene, NOT a security
# attestation. It does NOT (and must not) unlock the L1 block-mode override — closing
# that needs a real isolation boundary (separate UID / sandbox / no user systemd bus).
# See BACKLOG "dispatch-hetero descendant-containment".
SCOPE_UNIT=""; WORKER_SID=""; WORKER_FALLBACK_PGID=""
# shellcheck source=lib/worker-containment.sh
source "$SELF_DIR/lib/worker-containment.sh"
worker_containment_detect
# Mount isolation (01M7E4JC): detect once here; run_worker puts WORKER_MOUNT_PREFIX in front of the
# worker argv (scope/session outside, unshare inside). A refuse is enforced right after abort_dispatch.
worker_mount_isolation_detect
HAVE_SETSID=0; command -v setsid >/dev/null 2>&1 && grep -q -- --wait < <(setsid --help 2>&1) && HAVE_SETSID=1
# reap_container is defined by worker-containment.sh (name kept for declare -f).

# Defined before abort_dispatch. The refuse path below calls abort_dispatch, which calls
# cleanup_managed_codex_home. A definition later in the file is not visible yet, and the
# early refuse then dies with "command not found" (seen on a real host at this call).
# Sibling on that path: prepare_managed_codex_home is not called from the trap; it is kept
# beside its cleanup. Other EXIT/ERR callees (cleanup, reap_container, reap_cnative_config_dir,
# reap_sandbox_config_dir, _cont_terminal_on_exit, _wt_check_live_or_log_skip) are defined
# or sourced above this point.
prepare_managed_codex_home() {
  local controller_home="${CODEX_HOME:-$HOME/.codex}"
  # bwrap makes / read-only except the worktree and this scratch dir. The managed home has to be created inside it.
  if [ "${SANDBOX:-off}" = "bwrap" ] && [ -z "${SANDBOX_TMP:-}" ]; then
    sandbox_setup || die_precondition "cannot allocate the bwrap scratch dir for the managed Codex home"
  fi
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    MANAGED_CODEX_HOME="$(mktemp -d "${SANDBOX_TMP}/autopilot-managed-codex-home-XXXXXX")" \
      || die_precondition "cannot allocate isolated managed Codex home"
  else
    MANAGED_CODEX_HOME="$(mktemp -d -t autopilot-managed-codex-home-XXXXXX)" \
      || die_precondition "cannot allocate isolated managed Codex home"
  fi
  chmod 700 "$MANAGED_CODEX_HOME" \
    || die_precondition "cannot protect isolated managed Codex home"
  # Codex documents that --ignore-user-config still reads authentication from
  # CODEX_HOME. Copy only that credential file: plugin/config/session state is
  # deliberately excluded so the controller's PreToolUse hook cannot intercept
  # the managed implementer.
  if [ -r "$controller_home/auth.json" ]; then
    cp "$controller_home/auth.json" "$MANAGED_CODEX_HOME/auth.json" \
      || die_precondition "cannot stage managed Codex authentication"
    chmod 600 "$MANAGED_CODEX_HOME/auth.json" \
      || die_precondition "cannot protect managed Codex authentication"
  fi
}

cleanup_managed_codex_home() {
  [ -n "${MANAGED_CODEX_HOME:-}" ] || return 0
  case "$MANAGED_CODEX_HOME" in
    "${TMPDIR:-/tmp}"/autopilot-managed-codex-home-*|"${SANDBOX_TMP:-/nonexistent}"/autopilot-managed-codex-home-*)
      rm -rf -- "$MANAGED_CODEX_HOME"
      ;;
    *)
      echo "WARNING: refusing to remove unexpected managed Codex home: $MANAGED_CODEX_HOME" >&2
      ;;
  esac
  MANAGED_CODEX_HOME=""
}

# Only the mktemp dir this run created. Called from EXIT cleanup and abort_dispatch.
_reap_ccshim_env_dir() {
  [ -n "${CCSHIM_ENV_DIR:-}" ] || return 0
  case "$CCSHIM_ENV_DIR" in
    "${TMPDIR:-/tmp}"/dispatch-hetero-ccshim-env-*|"${SANDBOX_TMP:-/nonexistent}"/dispatch-hetero-ccshim-env-*)
      rm -rf -- "$CCSHIM_ENV_DIR"
      ;;
  esac
  CCSHIM_ENV_DIR=""
}

# Managed aborts must preserve exact branch evidence before any removal. The
# legacy minimal remover + branch deletion remains only for unmanaged one-shots.
abort_dispatch() {
  reap_container
  cleanup_managed_codex_home
  [ -n "$SCAFFOLD_PROMPT_FILE" ] && rm -f "$SCAFFOLD_PROMPT_FILE"
  [ -n "$GROK_PROMPT_FILE" ] && rm -f "$GROK_PROMPT_FILE"
  [ -n "$CCSHIM_PROMPT_FILE" ] && rm -f "$CCSHIM_PROMPT_FILE"
  [ -n "${SCRATCH_DIR:-}" ] && rm -rf -- "$SCRATCH_DIR"
  [ -n "${SCRATCH_HOME:-}" ] && rm -rf -- "$SCRATCH_HOME"
  [ -n "${SCRATCH_CONFIG_DIR:-}" ] && rm -rf -- "$SCRATCH_CONFIG_DIR"
  [ -n "${SCRATCH_FINAL_PROMPT:-}" ] && rm -f -- "$SCRATCH_FINAL_PROMPT"
  _reap_ccshim_env_dir
  [ -n "$OPENCODE_PROMPT_FILE" ] && rm -f "$OPENCODE_PROMPT_FILE"
  [ -n "$KIMI_PROMPT_FILE" ] && rm -f "$KIMI_PROMPT_FILE"
  [ -n "$QODER_PROMPT_FILE" ] && rm -f "$QODER_PROMPT_FILE"
  reap_cnative_config_dir || true
  reap_sandbox_config_dir || true
  [ -n "${GATE_ARMED_SESSION:-}" ] && node "$SELF_DIR/per-turn-gate-arm.js" disarm --session "$GATE_ARMED_SESSION" >/dev/null 2>&1
  [ -n "${GATE_SETTINGS_FILE:-}" ] && rm -f "$GATE_SETTINGS_FILE"
  [ -n "$AGY_ENVELOPE" ] && rm -f "$AGY_ENVELOPE"
  [ -n "$AGY_STDERR" ] && rm -f "$AGY_STDERR"
  [ -n "$AGY_PARSED" ] && rm -f "$AGY_PARSED"
  [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
  if [ -n "${AUTOPILOT_WORKTREE_ROOT_RUN_ID:-}" ]; then
    local abort_tip abort_lock_state="free"
    [ -n "${WT_LOCK_FD:-}" ] && abort_lock_state="held_by_us"
    if _wt_check_live_or_log_skip "dispatch-hetero.sh" "$WT" "$BRANCH" "managed_abort_reap" "$abort_lock_state"; then
      abort_tip=""; wt_gitfile_check && abort_tip="$(_wt_git rev-parse HEAD 2>/dev/null || true)"
      if [ -n "${WT_LOCK_FD:-}" ]; then
        exec {WT_LOCK_FD}>&- || true
        WT_LOCK_FD=""
      fi
      if [[ "$abort_tip" =~ ^[0-9a-f]{40,64}$ ]] \
         && bash "$SELF_DIR/reap-dispatch-worktrees.sh" journal \
        --repo "$_wt_repo_root" \
        --root-run-id "$AUTOPILOT_WORKTREE_ROOT_RUN_ID" \
        --path "$WT" >/dev/null 2>&1; then
        bash "$SELF_DIR/reap-dispatch-worktrees.sh" reap \
          --repo "$_wt_repo_root" \
          --root-run-id "$AUTOPILOT_WORKTREE_ROOT_RUN_ID" \
          --path "$WT" --expected-tip "$abort_tip" --yes >/dev/null 2>&1 || true
      fi
    fi
  else
    reap_worktree_minimal "$WT"
    [ ! -d "$WT" ] && git branch -D "$BRANCH" >/dev/null 2>&1
  fi
  exit 2
}
trap abort_dispatch INT TERM
# Interim brief gate (01M7F2KZ): off under private_ns / sudo_private_ns. A command-shaped
# mount/umount/unshare in the prompt refuses before any worker spawns.
if ! worker_mount_brief_gate "$PROMPT_FILE"; then
  MANIFEST_MOUNT_CONTAINMENT="refused"
  write_manifest "$$" 2>/dev/null || true
  abort_dispatch
fi
# Refuse BEFORE any worker spawns: no private mount namespace and a worker that could mount (01M7E4JC).
# sudo_private_ns is not refuse: run_worker puts its prefix in front of the worker argv.
if [ "$WORKER_MOUNT_MODE" = "refuse" ]; then
  worker_mount_isolation_require || true   # prints the stderr line
  MANIFEST_MOUNT_CONTAINMENT="refused"
  write_manifest "$$" 2>/dev/null || true
  abort_dispatch
fi

# Build the worker command line, then run it inside the strongest available
# container. The command cd's into the worktree itself (we cannot rely on a
# subshell cwd surviving the container boundary).
WATCHDOG_PID=""
WATCHDOG_TOKEN_FILE=""
WATCHDOG_DISARMED=0

# Job control for worker launches. With a controlling tty, `set -m` puts the worker
# in a background process group, so a worker reading /dev/tty takes SIGTTIN and
# stops (state T). Ignoring TTIN across the launch makes the disposition inherit
# through exec, so the read fails with EIO instead of stopping (BL-0099).
_job_control_on() {
  trap '' TTIN 2>/dev/null || true
  set -m 2>/dev/null || true
}
_job_control_off() {
  set +m 2>/dev/null || true
  trap - TTIN 2>/dev/null || true
}

_self_pgid() {
  ps -o pgid= -p $$ 2>/dev/null | tr -d ' '
}

_watchdog_sleeppid_cmdline_has_tag() {
  local sp="$1" tag="$2" cmd=""
  [ -n "$sp" ] && [ -n "$tag" ] || return 1
  [ -r "/proc/${sp}/cmdline" ] || return 1
  cmd="$(tr '\0' ' ' < "/proc/${sp}/cmdline" 2>/dev/null || true)"
  [[ "$cmd" == *"hetero-wall-watchdog-${tag}"* ]]
}

_cancel_worker_watchdog() {
  local tok="${WATCHDOG_TOKEN_FILE:-}"
  local tag="" sp=""
  [ -n "$tok" ] && tag="${tok##*/}"
  if [ -n "$tok" ]; then
    # Marker first: the watchdog must see an explicit cancel before the token
    # disappears. A missing token alone is not a cancel.
    : > "${tok}.cancel" 2>/dev/null || true
    rm -f "$tok" "${tok}.fired" 2>/dev/null || true
    if [ -f "${tok}.sleeppid" ]; then
      sp="$(cat "${tok}.sleeppid" 2>/dev/null || true)"
      if [ -n "$sp" ] && _watchdog_sleeppid_cmdline_has_tag "$sp" "$tag"; then
        kill "$sp" 2>/dev/null || true
        wait "$sp" 2>/dev/null || true
      fi
    fi
  fi
  if [ -n "${WATCHDOG_PID:-}" ]; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
    WATCHDOG_PID=""
  fi
  if [ -n "$tok" ] && [ -f "${tok}.sleeppid" ]; then
    sp="$(cat "${tok}.sleeppid" 2>/dev/null || true)"
    if [ -n "$sp" ] && _watchdog_sleeppid_cmdline_has_tag "$sp" "$tag"; then
      kill "$sp" 2>/dev/null || true
    fi
    rm -f "${tok}.sleeppid" 2>/dev/null || true
  fi
  if [ -n "$tag" ]; then
    pkill -f "hetero-wall-watchdog-${tag}" 2>/dev/null || true
  fi
  if [ -n "$tok" ]; then
    rm -f "$tok" "${tok}.cancel" "${tok}.fired" "${tok}.sleeppid" 2>/dev/null || true
  fi
  WATCHDOG_TOKEN_FILE=""
}

# After backgrounding `setsid --wait`, either:
# - no-fork: `$rp` already is the session/group leader (sid==pid), or
# - fork: a child of `$rp` is itself a session leader.
# Do not treat an arbitrary child/grandchild as the worker.
_setsid_wait_worker_sid() {
  local rp="$1"
  local child="" attempt="" f sid="" c
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    sid="$(ps -o sid= -p "$rp" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$sid" ] && [ "$sid" = "$rp" ]; then
      printf '%s\n' "$rp"
      return 0
    fi
    child=""
    while read -r c; do
      [ -n "$c" ] || continue
      sid="$(ps -o sid= -p "$c" 2>/dev/null | tr -d '[:space:]')"
      if [ -n "$sid" ] && [ "$sid" = "$c" ]; then
        child="$c"
        break
      fi
    done < <(ps -o pid= --ppid "$rp" 2>/dev/null | tr -d ' ')
    if [ -z "$child" ]; then
      for f in /proc/"$rp"/task/*/children; do
        [ -r "$f" ] || continue
        while read -r c; do
          [ -n "$c" ] || continue
          sid="$(ps -o sid= -p "$c" 2>/dev/null | tr -d '[:space:]')"
          if [ -n "$sid" ] && [ "$sid" = "$c" ]; then
            child="$c"
            break
          fi
        done < <(tr -s '[:space:]' '\n' < "$f")
        [ -n "$child" ] && break
      done
    fi
    if [ -n "$child" ]; then
      printf '%s\n' "$child"
      return 0
    fi
    kill -0 "$rp" 2>/dev/null || break
    sleep 0.05
  done
  printf '%s\n' "$rp"
}

# Alive unless the process table positively proves the worker dead.
# kill -0 is insufficient: an unreaped natural exit is still a pid (state Z).
# procps `ps -g N` matches session leaders / group *names*, not PGID.
_watchdog_worker_alive() {
  local pid="" pgid="" st="" out="" ps_rc=0
  local rp="${WORKER_RP:-}"
  local target=""
  local rp_dead=1 group_dead=1
  if [ -n "${SCOPE_UNIT:-}" ]; then
    target="${WORKER_FALLBACK_PGID:-}"
  else
    target="${WORKER_SID:-}"
    [ -n "$target" ] || target="${WORKER_FALLBACK_PGID:-}"
  fi
  # Neither identifier: unknown, hence alive.
  if [ -z "$rp" ] && [ -z "$target" ]; then
    return 0
  fi
  out="$(ps -e -o pid=,pgid=,state= 2>/dev/null)" || ps_rc=$?
  if [ "$ps_rc" -ne 0 ] || [ -z "$out" ]; then
    return 0
  fi
  while read -r pid pgid st || [ -n "${pid:-}" ]; do
    pid="${pid#"${pid%%[![:space:]]*}"}"
    pid="${pid%"${pid##*[![:space:]]}"}"
    pgid="${pgid#"${pgid%%[![:space:]]*}"}"
    pgid="${pgid%"${pgid##*[![:space:]]}"}"
    st="${st#"${st%%[![:space:]]*}"}"
    st="${st%"${st##*[![:space:]]}"}"
    [ -n "$pid" ] || continue
    case "$st" in
      Z*) continue ;;
    esac
    if [ -n "$rp" ] && [ "$pid" = "$rp" ]; then
      rp_dead=0
    fi
    if [ -n "$target" ] && [ "$pgid" = "$target" ]; then
      group_dead=0
    fi
  done <<EOF
$out
EOF
  if [ "$rp_dead" -eq 1 ] && [ "$group_dead" -eq 1 ]; then
    return 1
  fi
  return 0
}

_watchdog_signal_worker() {
  local sig="$1"
  if [ -n "${SCOPE_UNIT:-}" ]; then
    local sc=0
    # test-only: HETERO_TEST_SYSTEMCTL_KILL_FAIL=1 skips systemctl kill and
    # takes the failure / pgid-fallback branch.
    if [ "${HETERO_TEST_SYSTEMCTL_KILL_FAIL:-}" = "1" ]; then
      sc=1
    else
      systemctl --user kill "$SCOPE_UNIT" --signal="$sig" >/dev/null 2>&1 || sc=$?
      if [ "$sc" -ne 0 ]; then
        # One bounded retry: a transient failure must not leave the run unbounded.
        sleep 0.3
        sc=0
        systemctl --user kill "$SCOPE_UNIT" --signal="$sig" >/dev/null 2>&1 || sc=$?
      fi
    fi
    if [ "$sc" -eq 0 ]; then
      return 0
    fi
    local target="${WORKER_FALLBACK_PGID:-}"
    local selfpg=""
    selfpg="$(_self_pgid)" || selfpg=""
    if [ -n "$target" ] && [ "$target" != "$$" ] \
       && [ -n "$selfpg" ] && [ "$target" != "$selfpg" ]; then
      if kill "-$sig" "-$target" 2>/dev/null; then
        return 0
      fi
      return 1
    fi
    return 1
  fi
  local target="${WORKER_SID:-}"
  [ -n "$target" ] || return 1
  local selfpg=""
  selfpg="$(_self_pgid)" || selfpg=""
  if [ "$target" = "$$" ]; then
    return 1
  fi
  if [ -n "$selfpg" ] && [ "$target" = "$selfpg" ]; then
    return 1
  fi
  # Group-kill only. A failed group-kill (kill -SIG -$target) means that
  # process group is already gone. r5 guarantees WORKER_SID is always a
  # session/process-group leader, so a bare-pid fallback here could only ever
  # hit a dead or recycled pid — never the live worker.
  kill "-$sig" "-$target" 2>/dev/null
}

_watchdog_sleep_sample() {
  local tok="$1" tag="$2" secs="$3" sp=""
  if [ "${HETERO_TEST_NO_SETSID:-}" != "1" ] && command -v setsid >/dev/null 2>&1; then
    setsid bash -c 'exec -a "hetero-wall-watchdog-'"$tag"'" sleep "$1"' bash "$secs" &
  else
    bash -c 'exec -a "hetero-wall-watchdog-'"$tag"'" sleep "$1"' bash "$secs" &
  fi
  sp=$!
  echo "$sp" > "${tok}.sleeppid"
  wait "$sp" 2>/dev/null || true
}

# One sample via scripts/lib/idle-watch.js (bytes of the agent log + CPU ticks
# of the worker process tree). Prints "bytes cpu" or nothing when the sampler fails.
_watchdog_progress_sample() {
  local pid="$1" log="$2" line=""
  [ -n "$pid" ] && [ -n "$log" ] || return 1
  line="$(node "$SELF_DIR/lib/idle-watch.js" sample --pid "$pid" --watch "$log" 2>/dev/null)" || return 1
  printf '%s\n' "$line"
}

_watchdog_fire() {
  local tok="$1" kind="$2" elapsed="$3" ago="$4"
  printf '%s %s %s\n' "$kind" "$elapsed" "$ago" > "${tok}.fired"
  if ! _watchdog_signal_worker TERM; then
    rm -f "${tok}.fired"
    return 0
  fi
  local i=0
  while [ "$i" -lt 10 ]; do
    [ -f "${tok}.cancel" ] && return 0
    _watchdog_worker_alive || return 0
    sleep 1
    i=$((i + 1))
  done
  [ -f "${tok}.cancel" ] && return 0
  _watchdog_worker_alive || return 0
  _watchdog_signal_worker KILL || true
}

_arm_worker_watchdog() {
  local soft="$1"
  # Prefix must not match any test-lockgated glob (hetero-*). suite_residue_reap
  # deletes lockless hetero-* names and would remove this token mid-run, so the
  # sleeper exits at "[ -f "$tok" ] || exit 0" and the wall timeout never fires.
  WATCHDOG_TOKEN_FILE="$(mktemp -t dispatch-wdog-tok-XXXXXX)"
  : > "$WATCHDOG_TOKEN_FILE"
  local tok="$WATCHDOG_TOKEN_FILE"
  local tag="${tok##*/}"
  local idle="${WATCHDOG_IDLE_S:-300}"
  local hard="${WATCHDOG_HARD_S:-14400}"
  local sample="${WATCHDOG_SAMPLE_S:-15}"
  local log="${LOG:-}"
  (
    trap 'kill "${sp:-}" 2>/dev/null; exit 0' TERM
    sp=""
    start="$(date +%s)"
    last_progress="$start"
    last_extend=0
    last_sig=""
    prev_b=""
    prev_c=""
    while _watchdog_worker_alive; do
      # Sample interval, but never sleep past the next soft/idle/hard deadline.
      # A 1s wall with the 15s default sample must still fire on that wall.
      now="$(date +%s)"
      nap="$sample"
      until_soft=$((start + soft - now))
      until_idle=$((last_progress + idle - now))
      until_hard=$((start + hard - now))
      until="$until_soft"
      [ "$until_idle" -lt "$until" ] && until="$until_idle"
      [ "$until_hard" -lt "$until" ] && until="$until_hard"
      [ "$until" -lt 1 ] && until=1
      [ "$nap" -gt "$until" ] && nap="$until"
      if [ "${HETERO_TEST_NO_SETSID:-}" != "1" ] && command -v setsid >/dev/null 2>&1; then
        setsid bash -c 'exec -a "hetero-wall-watchdog-'"$tag"'" sleep "$1"' bash "$nap" &
      else
        bash -c 'exec -a "hetero-wall-watchdog-'"$tag"'" sleep "$1"' bash "$nap" &
      fi
      sp=$!
      echo "$sp" > "${tok}.sleeppid"
      wait "$sp" 2>/dev/null || true
      sp=""
      if [ -f "${tok}.cancel" ]; then
        exit 0
      fi
      if [ ! -f "$tok" ]; then
        if _watchdog_worker_alive; then
          echo "watchdog token vanished without cancel; enforcing timeout" >&3 2>/dev/null || true
          now="$(date +%s)"
          _watchdog_fire "$tok" idle "$((now - start))" "$((now - last_progress))"
        fi
        exit 0
      fi
      _watchdog_worker_alive || exit 0
      now="$(date +%s)"
      sample_line="$(_watchdog_progress_sample "${WORKER_RP:-}" "$log" || true)"
      bytes=""; cpu=""
      if [ -n "$sample_line" ]; then
        bytes="${sample_line#*bytes=}"; bytes="${bytes%% *}"
        cpu="${sample_line#*cpu=}"; cpu="${cpu%% *}"
      fi
      sig=""
      if [[ "$bytes" =~ ^[0-9]+$ ]]; then
        if [[ "$prev_b" =~ ^[0-9]+$ ]] && [ "$bytes" -gt "$prev_b" ]; then
          sig="bytes"
        fi
        prev_b="$bytes"
      fi
      if [[ "$cpu" =~ ^[0-9]+$ ]]; then
        if [[ "$prev_c" =~ ^[0-9]+$ ]] && [ "$cpu" -gt "$prev_c" ]; then
          if [ "$sig" = "bytes" ]; then sig="bytes+cpu"; else sig="cpu"; fi
        fi
        prev_c="$cpu"
      fi
      if [ -n "$sig" ]; then
        last_progress="$now"
        last_sig="$sig"
      fi
      elapsed=$((now - start))
      ago=$((now - last_progress))
      if [ "$elapsed" -ge "$hard" ]; then
        _watchdog_fire "$tok" hard "$elapsed" "$ago"
        exit 0
      fi
      if [ "$ago" -ge "$idle" ]; then
        _watchdog_fire "$tok" idle "$elapsed" "$ago"
        exit 0
      fi
      # --timeout is a wall kill. --idle-timeout opts into extending past it
      # while output bytes or process-tree CPU are still moving.
      if [ "$elapsed" -ge "$soft" ]; then
        if [ "${IDLE_TIMEOUT_SUPPLIED:-0}" -eq 1 ] && [ -n "$last_sig" ] && [ "$ago" -lt "$idle" ]; then
          if [ $((now - last_extend)) -ge "$idle" ]; then
            printf 'dispatch-hetero: extend: progress seen (%s), past --timeout\n' "$last_sig" >> "$log" 2>/dev/null || true
            prev_b="$(stat -c %s "$log" 2>/dev/null || echo "$prev_b")"
            last_extend="$now"
          fi
        else
          _watchdog_fire "$tok" wall "$elapsed" "$ago"
          exit 0
        fi
      fi
    done
  # fd 3 is the dispatcher's stderr; the subshell's own stdout/stderr stay discarded.
  ) 3>&2 >/dev/null 2>&1 &
  WATCHDOG_PID=$!
}

# True (rc 0) when the agent CLI process has any live descendant (a running tool or test).
# The agent CLI is rp, or rp's sole child when rp is a forking `setsid --wait` wrapper.
# Unknown (ps failure) counts as busy: the fail-closed side never ends a worker early.
_worker_has_busy_descendant() {
  local rp="$1" out ps_rc=0
  out="$(ps -e -o pid=,ppid=,stat=,comm= 2>/dev/null)" || ps_rc=$?
  { [ "$ps_rc" -eq 0 ] && [ -n "$out" ]; } || return 0
  printf '%s\n' "$out" | awk -v root="$rp" '
    { pid=$1; ppid=$2; st=$3; comm=$4
      if (st ~ /^Z/) next
      kids[ppid]++; kid[ppid]=pid; name[pid]=comm }
    END {
      r=root
      while (name[r]=="setsid" && kids[r]==1) r=kid[r]
      exit (kids[r]>0 ? 0 : 1)
    }'
}

# Commit-quiescence: while the runner lives, poll cheaply; once HEAD is a strict descendant of base AND the
# worktree is clean AND the agent CLI has had no descendant process AND the log has not
# grown, all continuously for COMMIT_QUIET_SECS (clock starts when all hold), TERM the worker group (KILL after a short grace).
# A running tool or test (a descendant) resets the clock: quiet output alone is not done.
# Sleeps in 0.2s steps so a worker that exits (or is timed out) returns at once.
_supervise_commit_quiet() {
  local rp="$1" poll="${HETERO_COMMIT_QUIET_POLL:-10}"
  local quiet="$COMMIT_QUIET_SECS" size last_size=-1 since=-1 head n
  [ "$poll" -gt "$quiet" ] && poll="$quiet"
  [ "$poll" -ge 1 ] || poll=1
  while kill -0 "$rp" 2>/dev/null; do
    n=0
    while [ "$n" -lt $((poll * 5)) ] && kill -0 "$rp" 2>/dev/null; do sleep 0.2; n=$((n + 1)); done
    kill -0 "$rp" 2>/dev/null || return 0
    # Every tick re-checks ALL eligibility conditions; any failure restarts the clock, which
    # only runs from the first tick where everything holds (never from earlier quiet).
    size="$(stat -c %s "$LOG" 2>/dev/null || echo 0)"
    if [ "$size" != "$last_size" ]; then last_size="$size"; since=-1; continue; fi
    if _worker_has_busy_descendant "$rp"; then since=-1; continue; fi
    wt_gitfile_check || { since=-1; continue; }
    head="$(_wt_git rev-parse --verify HEAD 2>/dev/null || true)"
    if [ -z "$head" ] || [ "$head" = "$DIFF_BASE_SHA" ] \
       || { [ "${SCRATCH:-0}" -ne 1 ] && ! _wt_git merge-base --is-ancestor "$BASE_SHA" "$head" 2>/dev/null; } \
       || [ -n "$(_wt_git status --porcelain --ignore-submodules=dirty 2>/dev/null)" ]; then since=-1; continue; fi
    [ "$since" -ge 0 ] || since=$SECONDS
    [ $((SECONDS - since)) -ge "$quiet" ] || continue
    COMMIT_QUIET_ENDED=1
    _watchdog_signal_worker TERM || true
    local i=0
    while [ "$i" -lt 25 ] && kill -0 "$rp" 2>/dev/null; do sleep 0.2; i=$((i + 1)); done
    if kill -0 "$rp" 2>/dev/null; then _watchdog_signal_worker KILL || true; fi
    return 0
  done
}

_hetero_registry_start() {
  local rp="$1"
  local reg_js="${SELF_DIR:-}/lib/hetero-run-registry.js"
  [ -f "$reg_js" ] || return 0
  local run_id="${WT_RUN_ID:-${RUN_ID:-}}"
  [ -n "$run_id" ] || return 0
  local owner="${AUTOPILOT_OWNER_MEMBER:-${FLEET_MEMBER:-${OWNER_MEMBER:-}}}"
  local engine="${RUNNER:-${MODEL:-}}"
  local res_path="${RESULT_PATH:-${LOG:-}}"
  node "$reg_js" write \
    --run-id "$run_id" \
    --owner-member "$owner" \
    --engine "$engine" \
    --pid "$rp" \
    --status "running" \
    --result-path "$res_path" >/dev/null 2>&1 || true
}

_hetero_registry_end() {
  local rc="${1:-1}"
  local reg_js="${SELF_DIR:-}/lib/hetero-run-registry.js"
  [ -f "$reg_js" ] || return 0
  local run_id="${WT_RUN_ID:-${RUN_ID:-}}"
  [ -n "$run_id" ] || return 0
  local st="failed"
  [ "$rc" -eq 0 ] 2>/dev/null && st="done"
  local res_path="${RESULT_PATH:-${LOG:-}}"
  node "$reg_js" update \
    --run-id "$run_id" \
    --status "$st" \
    --result-path "$res_path" >/dev/null 2>&1 || true
}

_wait_worker_with_watchdog() {
  local rp="$1"
  local secs=""
  WORKER_RP="$rp"
  _hetero_registry_start "$rp"
  if [ "${WATCHDOG_DISARMED:-0}" -ne 1 ]; then
    if [ -z "${WATCHDOG_IDLE_S:-}" ]; then
      _hetero_resolve_watch_limits || true
    fi
    secs="${WATCHDOG_SOFT_S:-}"
    if [ -n "$secs" ] && [ -n "${WATCHDOG_IDLE_S:-}" ]; then
      _arm_worker_watchdog "$secs"
    fi
  fi
  COMMIT_QUIET_ENDED=0
  if [[ "${COMMIT_QUIET_SECS:-0}" =~ ^[0-9]+$ ]] && [ "${COMMIT_QUIET_SECS:-0}" -gt 0 ] \
     && [ -n "${WT:-}" ] && [ -n "${BASE_SHA:-}" ] && [ -n "${LOG:-}" ]; then
    _supervise_commit_quiet "$rp"
  fi
  wait "$rp"
  AGENT_EXIT=$?
  [ "$COMMIT_QUIET_ENDED" -eq 1 ] && AGENT_EXIT=0
  if [ -n "${WATCHDOG_TOKEN_FILE:-}" ] && [ -f "${WATCHDOG_TOKEN_FILE}.fired" ]; then
    # Fired means TERM was sent and the watchdog is inside its grace window.
    # Do not cancel it: the grace loop exits on the cancel marker and would
    # skip KILL, leaving a group member that ignores TERM alive until a later reap.
    WORKER_TIMED_OUT=1
    WORKER_TIMEOUT_KIND=""
    KILLED_ELAPSED_S=""
    KILLED_LAST_PROGRESS_S=""
    read -r WORKER_TIMEOUT_KIND KILLED_ELAPSED_S KILLED_LAST_PROGRESS_S < "${WATCHDOG_TOKEN_FILE}.fired" || true
    if [ -n "${WATCHDOG_PID:-}" ]; then
      wait "${WATCHDOG_PID}" 2>/dev/null || true
    fi
    rm -f "${WATCHDOG_TOKEN_FILE}" "${WATCHDOG_TOKEN_FILE}.fired" "${WATCHDOG_TOKEN_FILE}.sleeppid" "${WATCHDOG_TOKEN_FILE}.cancel" 2>/dev/null || true
    WATCHDOG_PID=""
    WATCHDOG_TOKEN_FILE=""
  else
    _cancel_worker_watchdog
  fi
}

# After no-setsid fallback launch: job control must actually isolate the worker
# pgid, else the watchdog cannot signal without hitting the dispatcher group.
_verify_no_setsid_watchdog_or_disarm() {
  local selfpg=""
  local monitor_ok=1
  # test-only: HETERO_TEST_NO_JOBCONTROL=1 forces the job-control check to fail.
  if [ "${HETERO_TEST_NO_JOBCONTROL:-}" = "1" ]; then
    monitor_ok=0
  else
    case "$-" in
      *m*) ;;
      *) monitor_ok=0 ;;
    esac
  fi
  selfpg="$(_self_pgid)" || selfpg=""
  if [ "$monitor_ok" -eq 0 ] || [ -z "${WORKER_SID:-}" ] \
     || [ "$WORKER_SID" = "$selfpg" ] || [ "$WORKER_SID" = "$$" ]; then
    WATCHDOG_DISARMED=1
    echo "dispatch-hetero: wall timeout could not be enforced on this host" >&2 || true
  fi
}

run_worker() { # "$@" = argv of the worker; redirects to LOG; sets AGENT_EXIT + CONTAINMENT
  # Every branch below launches the worker through `env -u AUTOPILOT_SESSION_ID`: the runner is a
  # CHILD session, and session-mode.js getSessionId() prefers that variable, so a leaked parent id
  # would let the child write its marker over the parent's. (This rail itself still reads it for
  # the job-root lookup earlier on; only the spawn is scrubbed.)
  # 3b rule 3: the child env (parent id = this rail's own write target, scrubbed ids) is resolved at spawn time,
  # so the detached child (a re-exec of this function) computes the same thing from its inherited env.
  if declare -F child_session_env_setup >/dev/null 2>&1; then child_session_env_setup "$SELF_DIR"; else CHILD_SESSION_UNSET=(-u AUTOPILOT_SESSION_ID -u AUTOPILOT_CHILD_SESSION_ID); CHILD_SESSION_PARENT=""; fi
  # 3d: only the cc-shim claude child gets the C the rail minted for it (after every -u in the env argv); every other runner has C removed above.
  CHILD_SESSION_CLAUDE_ENV=(); if ( [ "${IS_CCSHIM:-0}" -eq 1 ] || [ "${IS_CNATIVE:-0}" -eq 1 ] ) && [ -n "${CHILD_SESSION_ID:-}" ]; then CHILD_SESSION_CLAUDE_ENV=("AUTOPILOT_CHILD_SESSION_ID=$CHILD_SESSION_ID"); fi
  # --sandbox bwrap: the whole worker argv runs inside the sandbox. The cc-shim arm builds
  # SANDBOX_ARGV itself; a cloud fallback re-exec builds it here, before the worker starts.
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    if [ "${#SANDBOX_ARGV[@]}" -eq 0 ]; then
      sandbox_setup || { echo "sandbox: could not set up the bwrap scratch dir; worker not started" >"$LOG"; AGENT_EXIT=1; return 0; }
    fi
    if [ "${#SANDBOX_ARGV[@]}" -eq 0 ]; then echo "sandbox: no bwrap argv; worker not started" >"$LOG"; AGENT_EXIT=1; return 0; fi
    set -- "${SANDBOX_ARGV[@]}" "$@"
  fi
  # Mount isolation (01M7E4JC): outermost wrapper of the worker argv, so every branch below
  # (scope, setsid, plain) starts the worker inside the private mount namespace.
  if [ "${#WORKER_MOUNT_PREFIX[@]}" -gt 0 ]; then set -- "${WORKER_MOUNT_PREFIX[@]}" "$@"; fi
  WORKER_TIMED_OUT=0
  : >"$LOG"
  if [ -n "${ENGINE_PREFLIGHT_LOG_LINE:-}" ]; then printf '%s\n' "$ENGINE_PREFLIGHT_LOG_LINE" >> "$LOG"; fi
  WATCHDOG_PID=""
  WATCHDOG_TOKEN_FILE=""
  WATCHDOG_DISARMED=0
  WORKER_FALLBACK_PGID=""
  WORKER_RP=""
  # test-only: HETERO_TEST_NO_SETSID=1 pretends setsid is missing for run_worker
  # branch selection and HAVE_SETSID (watchdog sleeper checks the same env).
  if [ "${HETERO_TEST_NO_SETSID:-}" = "1" ]; then
    HAVE_SETSID=0
  fi
  local rp=""
  if [ "${IN_DETACHED_CHILD:-0}" -eq 1 ]; then
    # Detached child is already a setsid session; still put the worker in its own
    # group so the watchdog never signals the dispatcher session.
    CONTAINMENT="setsid"
    if [ "${HETERO_TEST_NO_SETSID:-}" != "1" ] && command -v setsid >/dev/null 2>&1; then
      setsid env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 &
      rp=$!
      WORKER_SID="$rp"
    else
      _job_control_on
      env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 </dev/null &
      rp=$!
      WORKER_SID="$(ps -o pgid= -p "$rp" 2>/dev/null | tr -d ' ' || true)"
      [ -z "$WORKER_SID" ] && WORKER_SID="$rp"
      _verify_no_setsid_watchdog_or_disarm
      _job_control_off
    fi
    _wait_worker_with_watchdog "$rp"
  elif [ "$HAVE_CGROUP" -eq 1 ]; then
    SCOPE_UNIT="hetero-${BRANCH//\//-}-$$.scope"
    CONTAINMENT="cgroup"
    # Isolate the systemd-run job so its pgid can be a safe fallback if
    # systemctl --user kill fails (must not share the dispatcher group).
    _job_control_on
    systemd-run --user --scope --quiet --expand-environment=no --unit="$SCOPE_UNIT" -- env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 </dev/null &
    rp=$!
    local selfpg="" pg=""
    selfpg="$(_self_pgid)" || selfpg=""
    pg="$(ps -o pgid= -p "$rp" 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -n "$pg" ] && [ "$pg" != "$$" ] && [ -n "$selfpg" ] && [ "$pg" != "$selfpg" ]; then
      WORKER_FALLBACK_PGID="$pg"
    fi
    _job_control_off
    _wait_worker_with_watchdog "$rp"
  elif [ "$HAVE_SETSID" -eq 1 ]; then
    CONTAINMENT="setsid"
    setsid --wait env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 &
    rp=$!
    WORKER_SID="$(_setsid_wait_worker_sid "$rp")"
    [ -z "$WORKER_SID" ] && WORKER_SID="$rp"
    _wait_worker_with_watchdog "$rp"
  else
    CONTAINMENT="plain"
    if [ "${HETERO_TEST_NO_SETSID:-}" != "1" ] && command -v setsid >/dev/null 2>&1; then
      setsid env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 &
      rp=$!
      WORKER_SID="$rp"
    else
      _job_control_on
      env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_CLAUDE_ENV[@]+"${CHILD_SESSION_CLAUDE_ENV[@]}"} "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >>"$LOG" 2>&1 </dev/null &
      rp=$!
      WORKER_SID="$(ps -o pgid= -p "$rp" 2>/dev/null | tr -d ' ' || true)"
      [ -z "$WORKER_SID" ] && WORKER_SID="$rp"
      _verify_no_setsid_watchdog_or_disarm
      _job_control_off
    fi
    _wait_worker_with_watchdog "$rp"
  fi
  reap_container   # reap on the NORMAL exit path too (catch escaped survivors), set CONTAINED
  _hetero_registry_end "${AGENT_EXIT:-1}"
}

# --- the agent runner (its stdout/stderr go to LOG, never our stdout) ---
# Extracted verbatim into a function so BOTH the inline path and the detached child dispatch
# the SAME engine invocation with ZERO behavioral difference.
run_agent() {
EVIDENCE_NOTES_PATH=""
if [ "${SANDBOX:-off}" = "bwrap" ] && [ -z "${SANDBOX_TMP:-}" ]; then
  sandbox_setup || { echo "sandbox: could not set up the bwrap scratch dir; worker not started" > "$LOG"; AGENT_EXIT=1; return 0; }
fi
if [ -n "${WT:-}" ] && [ -d "$WT" ]; then
  EVIDENCE_NOTES_PATH="$(_wt_git rev-parse --git-path evidence-notes.md 2>/dev/null || true)"
  if [ -n "$EVIDENCE_NOTES_PATH" ] && [ "${EVIDENCE_NOTES_PATH#/}" = "$EVIDENCE_NOTES_PATH" ]; then
    EVIDENCE_NOTES_PATH="$WT/$EVIDENCE_NOTES_PATH"
  fi
fi
if [ "${SANDBOX:-off}" = "bwrap" ] && [ -n "${SANDBOX_TMP:-}" ]; then
  EVIDENCE_NOTES_PATH="$SANDBOX_TMP/evidence-notes.md"
fi
if [ -n "${EVIDENCE_NOTES_PATH:-}" ] && [ -r "${PROMPT_FILE:-}" ]; then
  _ep_prompt_tmp="$(mktemp -t dispatch-hetero-ep-prompt-XXXXXX)"
  cat "$PROMPT_FILE" > "$_ep_prompt_tmp"
  printf '\nEvidence notes: write %s (not committed) with: Never create notes or evidence files inside the worktree.\n## Tests\n<rc> <command>\n## Risk\nlow|medium|high\n<one-line reason>\n' "$EVIDENCE_NOTES_PATH" >> "$_ep_prompt_tmp"
  PROMPT_FILE="$_ep_prompt_tmp"
fi
if [ "$IS_CODEX" -eq 1 ]; then
  EFFORT_SENT="$EFFORT"
  prepare_managed_codex_home
  # Codex reads PROMPT_FILE on stdin, with no harness banner added here.
  seal_runner_prompt_bytes "$PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec env -u CODEX_THREAD_ID CODEX_HOME="$6" \
      "$5" exec --ignore-user-config --model "$2" \
      --dangerously-bypass-approvals-and-sandbox \
      --dangerously-bypass-hook-trust \
      -c "model_reasoning_effort=\"$3\"" < "$4"' _ "$WT" "$MODEL" "$EFFORT" "$PROMPT_FILE" "$CODEX_BIN" "$MANAGED_CODEX_HOME"
  if [ "${AGENT_EXIT:-0}" -ne 0 ] && [ "${MODEL_SUBSTITUTED_TRIED:-0}" -eq 0 ] && [ -r "${LOG:-}" ]; then
    _codex_err_cls="$(node "$SELF_DIR/engine-capability-state.js" classify-error --file "$LOG" 2>/dev/null || true)"
    if [ "$_codex_err_cls" = "model_unsupported" ]; then
      _codex_sub="$(node "$SELF_DIR/lib/codex-models-cache.js" substitute "$MODEL" "${CODEX_HOME:-${HOME:-}/.codex}/models_cache.json" 2>/dev/null || true)"
      if [ -n "$_codex_sub" ]; then
        MODEL_SUBSTITUTED_TRIED=1
        MODEL_SUBSTITUTED_JSON="$(node -e 'process.stdout.write(JSON.stringify({from:process.argv[1],to:process.argv[2]}))' "$MODEL" "$_codex_sub" 2>/dev/null || true)"
        printf 'dispatch-hetero: codex model %s unsupported; retrying once with same-tier substitute %s\n' "$MODEL" "$_codex_sub" >&2
        MODEL="$_codex_sub"
        run_worker bash -c 'cd "$1" && exec env -u CODEX_THREAD_ID CODEX_HOME="$6" \
            "$5" exec --ignore-user-config --model "$2" \
            --dangerously-bypass-approvals-and-sandbox \
            --dangerously-bypass-hook-trust \
            -c "model_reasoning_effort=\"$3\"" < "$4"' _ "$WT" "$MODEL" "$EFFORT" "$PROMPT_FILE" "$CODEX_BIN" "$MANAGED_CODEX_HOME"
      fi
    fi
  fi
  cleanup_managed_codex_home
elif [ "$IS_CCSHIM" -eq 1 ] || [ "$IS_CNATIVE" -eq 1 ]; then
  EFFORT_SENT="${CLAUDE_EFFORT_ARG:-default}"
  # claude-native shares this arm (same claude -p invocation, edit-only directive, envelope parse); it
  # differs only in auth: a seeded CLAUDE_CONFIG_DIR (ONLY .credentials.json) and no shim endpoint.
  # cc-shim: the Claude Code CLI (`claude -p`) driving an arbitrary Anthropic-compatible
  # endpoint via ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN from the env. The MODEL (e.g.
  # MiniMax-M3, GLM-*) is what writes the code — for an IMPLEMENTER the model matters, not
  # the driver. Spike-verified 2026-06-29: claude -p via MiniMax-M3 edited files in cwd
  # (clean tool_use, no reasoning leak), reading the prompt from STDIN (dodges ARG_MAX).
  # EDIT-ONLY + wrapper-commit (same rail as agy/grok). `cd $WT` so claude works in the
  # worktree; ANTHROPIC_API_KEY is unset so the shim token is the sole auth.
  CCSHIM_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.

Before finishing, write \$AUTOPILOT_EVIDENCE_NOTES with sections \`## Tests\` (lines \`<rc> <command>\`) and \`## Risk\` (first line low|medium|high, then one sentence). Never create notes or evidence files inside the worktree.
===

"
  CCSHIM_PROMPT_FILE="$(mktemp -t dispatch-hetero-ccshim-prompt-XXXXXX)"
  printf '%s' "${CCSHIM_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$CCSHIM_PROMPT_FILE"
  seal_runner_prompt_bytes "$CCSHIM_PROMPT_FILE"
  # Harness-owned envelope: claude's JSON stdout never shares the worker log.
  # The result string (or the raw bytes if it does not parse) is appended to
  # LOG so classify-error and other log consumers still see the old plain text.
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    # The inner shell opens the envelope for writing, so it must live in the one writable scratch dir.
    SANDBOX_FAIL=0
    [ -n "${SANDBOX_TMP:-}" ] || sandbox_setup || { echo "sandbox: could not set up the bwrap scratch dir; worker not started" > "$LOG"; sandbox_teardown; AGENT_EXIT=1; SANDBOX_FAIL=1; }
    CCSHIM_ENVELOPE="$(mktemp "${SANDBOX_TMP:-${TMPDIR:-/tmp}}/dispatch-hetero-ccshim-envelope-XXXXXX")"
  else
    CCSHIM_ENVELOPE="$(mktemp -t dispatch-hetero-ccshim-envelope-XXXXXX)"
  fi
  # --gate-rules (BL-0306 P2): arm the per-turn gate for this one hand, before it starts. The id was minted
  # fresh above; arm runs gate-verify --check first and writes nothing for a bad list, in which case the
  # worker is not started. GATE_ARGV stays empty without the flag, so the claude argv is unchanged.
  GATE_ARGV=()
  GATE_RUN_OK=1
  [ "${SANDBOX_FAIL:-0}" -eq 1 ] && GATE_RUN_OK=0   # fail closed: no sandbox, no worker
  if [ -n "${GATE_RULES_FILE:-}" ]; then
    _gate_ttl="$(normalize_timeout_seconds "${TIMEOUT:-}" 2>/dev/null || true)"
    GATE_SETTINGS_FILE="$(mktemp -t dispatch-hetero-gate-settings-XXXXXX)"
    if [[ "$_gate_ttl" =~ ^[0-9]+$ ]] \
       && node "$SELF_DIR/per-turn-gate-arm.js" arm --session "${CHILD_SESSION_ID:-}" --repo "$WT" --rules "$GATE_RULES_FILE" \
            --ttl-seconds "$((_gate_ttl + 60))" >>"$LOG" 2>&1 \
       && GATE_ARMED_SESSION="$CHILD_SESSION_ID" \
       && node "$SELF_DIR/per-turn-gate-arm.js" settings --out "$GATE_SETTINGS_FILE" >>"$LOG" 2>&1; then
      GATE_ARGV=("$GATE_SETTINGS_FILE")
    else
      echo "gate-rules: could not arm the per-turn gate; worker not started" >>"$LOG"
      AGENT_EXIT=1
      GATE_RUN_OK=0
    fi
  fi
  if [ "$GATE_RUN_OK" -eq 0 ]; then
    :
  elif [ "$IS_CNATIVE" -eq 1 ] && { _CN_STATE="$(cnative_account_state)"; [ "$_CN_STATE" != legacy ]; }; then
    # G37 W3: registry present. claude-account.js reads the token itself and builds the child env; the
    # token never touches this shell, argv or LOG. A registry that went bad since preflight (invalid, or
    # an env-check output nobody recognises) is not spawned. The push/fetch block (HANDS_GIT_ENV) is not on
    # the account allowlist, so it rides in the inner argv through env(1). --settings (gate-rules) is kept.
    if [ "$_CN_STATE" = active ]; then
      _ts_msg="$(token_seat_guard)" || die_precondition "$_ts_msg"
      CNATIVE_ARGV=(env ${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"} claude -p ${CHILD_SESSION_ID:+--session-id "$CHILD_SESSION_ID"} --model "$MODEL"
        --strict-mcp-config --dangerously-skip-permissions ${CLAUDE_EFFORT_ARG:+--effort "$CLAUDE_EFFORT_ARG"}
        ${GATE_ARGV[@]+--settings "${GATE_ARGV[0]}"} --output-format json
        ${ROLE_KIT_ARGV[@]+"${ROLE_KIT_ARGV[@]}"})
      run_worker env HOME="${SCRATCH_HOME:-$HOME}" CLAUDE_CONFIG_DIR="${SCRATCH_CONFIG_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}" node "$SELF_DIR/claude-account.js" run --pin-default --purpose hetero-impl --cwd "${WORKER_CWD:-$WT}" \
        --stdin "$CCSHIM_PROMPT_FILE" --stdout "$CCSHIM_ENVELOPE" -- "${CNATIVE_ARGV[@]}"
    else
      echo "claude-native: account registry not usable; worker not started" > "$LOG"
      AGENT_EXIT=1
    fi
  elif [ "$IS_CNATIVE" -eq 1 ]; then
    # Fresh 0700 dir with only a 0600 .credentials.json; removed right after the worker (success AND
    # failure), and by cleanup/abort_dispatch if the dispatcher dies first. A seeding failure never spawns.
    # With a kit the gate-settings slot ($8) is always passed (empty when there is no gate), then the kit argv ($9...).
    _CN_TAIL=()
    if [ "${ROLE_KIT_ACTIVE:-0}" -eq 1 ]; then _CN_TAIL=("${GATE_ARGV[0]-}" "${ROLE_KIT_ARGV[@]}"); else _CN_TAIL=(${GATE_ARGV[@]+"${GATE_ARGV[0]}"}); fi
    _ts_msg="$(token_seat_guard)" || die_precondition "$_ts_msg"
    if [ -n "${SCRATCH_CONFIG_DIR:-}" ]; then
      CNATIVE_CONFIG_DIR="$SCRATCH_CONFIG_DIR"
    elif CNATIVE_CONFIG_DIR="$(node "$SELF_DIR/lib/seed-claude-config.js" --parent "${TMPDIR:-/tmp}")"; then
      :
    fi
    if [ -n "${CNATIVE_CONFIG_DIR:-}" ]; then
      # Scrub every alternate provider / credential selector so the seeded .credentials.json is the SOLE auth.
      # Names verified by strings(1) on the installed claude 2.1.309 binary (none invented). Cleared: provider
      # switches (BEDROCK/VERTEX/FOUNDRY/MANTLE/ANTHROPIC_AWS/ANTHROPIC_GOOGLE_CLOUD/GATEWAY), alternate keys and
      # tokens (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_FOUNDRY_API_KEY,
      # ANTHROPIC_FOUNDRY_AUTH_TOKEN, AWS_BEARER_TOKEN_BEDROCK), every endpoint override (ANTHROPIC_BASE_URL and the
      # BEDROCK/BEDROCK_MANTLE/VERTEX/FOUNDRY base URLs, ANTHROPIC_FOUNDRY_RESOURCE) and ANTHROPIC_CUSTOM_HEADERS (can
      # inject auth). NOT cleared: CLAUDE_CODE_OAUTH_TOKEN (PM 01M7975S: a seat token must reach the child;
      # the seeded dir is still the only config dir), CLAUDE_CODE_SKIP_*_AUTH (only meaningful once a provider is selected) and
      # region/project tuning vars (inert without a selector).
      # HOME is the env of this bash, not a positional slot. An empty gate tail used to
      # slide "${SCRATCH_HOME:-$HOME}" into $8, so claude was launched with --settings "$HOME".
      run_worker env HOME="${SCRATCH_HOME:-$HOME}" bash -c 'cd "$1" && for v in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY CLAUDE_CODE_USE_MANTLE CLAUDE_CODE_USE_ANTHROPIC_AWS CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD CLAUDE_CODE_USE_GATEWAY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_FOUNDRY_API_KEY ANTHROPIC_FOUNDRY_AUTH_TOKEN AWS_BEARER_TOKEN_BEDROCK ANTHROPIC_BASE_URL ANTHROPIC_BEDROCK_BASE_URL ANTHROPIC_BEDROCK_MANTLE_BASE_URL ANTHROPIC_VERTEX_BASE_URL ANTHROPIC_FOUNDRY_BASE_URL ANTHROPIC_FOUNDRY_RESOURCE ANTHROPIC_CUSTOM_HEADERS; do unset "$v"; done && exec env HOME="$HOME" CLAUDE_CONFIG_DIR="$7" claude -p ${4:+--session-id "$4"} --model "$2" \
          --strict-mcp-config --dangerously-skip-permissions ${5:+--effort "$5"} ${8:+--settings "$8"} --output-format json "${@:9}" < "$3" >"$6"' \
          _ "${WORKER_CWD:-$WT}" "$MODEL" "$CCSHIM_PROMPT_FILE" "${CHILD_SESSION_ID:-}" "$CLAUDE_EFFORT_ARG" "$CCSHIM_ENVELOPE" "$CNATIVE_CONFIG_DIR" ${_CN_TAIL[@]+"${_CN_TAIL[@]}"}
    else
      CNATIVE_CONFIG_DIR=""
      echo "claude-native: could not seed config dir; worker not started" > "$LOG"
      AGENT_EXIT=1
    fi
    reap_cnative_config_dir
  else
    _ts_msg="$(token_seat_guard)" || die_precondition "$_ts_msg"
    # S2 gateway join (2026-11-14): cc-shim carries X-Fleet-Task only when --endpoint is in the
    # fleet-gateway allowlist and AUTOPILOT_UPSTREAM_TASK_ID is a ULID. lib/fleet-task-header.js owns
    # both checks (never inline them: an unvalidated value in ANTHROPIC_CUSTOM_HEADERS could
    # inject headers). A non-local child drops an inherited ANTHROPIC_CUSTOM_HEADERS:
    # env -u clears it and the validated fleet line is the only value set back.
    # A local child keeps the caller's headers and appends x-lane after them.
    # The claude-native branches above keep scrubbing headers and never set them
    # (first-party API, not the gateway).
    FLEET_TASK_HEADER="$(node "$SELF_DIR/lib/fleet-task-header.js" --rail dispatch-hetero ${ENDPOINT:+--endpoint "$ENDPOINT"})"
    # Local seats identify the lane to the fleet gateway. Caller headers stay,
    # then the fleet line, then x-lane on its own line. The lane value is not printed.
    if [ "${LOCAL_RUNNER:-0}" -eq 1 ]; then
      _local_lane="$LOCAL_LANE"
      _local_prior="${ANTHROPIC_CUSTOM_HEADERS-}"
      while [ -n "$_local_prior" ]; do
        case "$_local_prior" in
          *$'\n'|*$'\r') _local_prior="${_local_prior%?}" ;;
          *) break ;;
        esac
      done
      if [ -n "$FLEET_TASK_HEADER" ]; then
        if [ -n "$_local_prior" ]; then
          _local_prior="${_local_prior}"$'\n'"${FLEET_TASK_HEADER}"
        else
          _local_prior="$FLEET_TASK_HEADER"
        fi
      fi
      if [ -n "$_local_prior" ]; then
        FLEET_TASK_HEADER="${_local_prior}"$'\n'"x-lane: ${_local_lane}"
      else
        FLEET_TASK_HEADER="x-lane: ${_local_lane}"
      fi
      unset _local_prior
    fi
    # --disallowedTools TaskCreate,TaskUpdate,TaskGet,TaskList: the CLI intermittently injects a
    # "task tools haven't been used recently" reminder into the conversation; on an Anthropic-compatible
    # endpoint with prefix caching it lands mid-prompt (~11.5K tokens) and breaks the cached prefix.
    # Measured 2026-11-14 on qwen_local: prefix divergences 3 -> 0, cache_read 76.6% -> 95.5% with these
    # four tools disallowed (runs hetero-1794626978 vs hetero-1794630645). A brief-driven hand does not
    # use the Task tools, so the cc-shim hand is never given them. (claude-native branches: unchanged.)
    # "$8" (always passed, possibly empty) is the validated X-Fleet-Task line: with a gate settings
    # file $7 holds it, so the settings slot is pinned with "${GATE_ARGV[0]-}" like the claude-native arm.
    # "$9" is the 0600 endpoint env file (mode set below). The token is not an argument.
    # sudo --preserve-env / -E is not used for these two variables: sudo env_reset drops them,
    # and the command after the privilege drop reads the file, deletes it, then execs claude.
    _ccshim_env_parent="${TMPDIR:-/tmp}"
    if [ "${SANDBOX:-off}" = "bwrap" ] && [ -n "${SANDBOX_TMP:-}" ]; then
      _ccshim_env_parent="$SANDBOX_TMP"
    fi
    CCSHIM_ENV_DIR="$(umask 077; mktemp -d "$_ccshim_env_parent/dispatch-hetero-ccshim-env-XXXXXX")" \
      || die_precondition "cc-shim 拒絕啟動：無法建立端點環境檔目錄"
    CCSHIM_ENV_FILE="$CCSHIM_ENV_DIR/endpoint.env"
    ( umask 077
      printf 'ANTHROPIC_BASE_URL=%q\nANTHROPIC_AUTH_TOKEN=%q\n' \
        "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" > "$CCSHIM_ENV_FILE"
    ) || die_precondition "cc-shim 拒絕啟動：無法寫入端點環境檔"
    chmod 600 "$CCSHIM_ENV_FILE" || die_precondition "cc-shim 拒絕啟動：無法保護端點環境檔"
    run_worker bash -c 'cd "$1" || exit 1
        _ccshim_env_file="$9"
        # ccshim-env-load
        if [ -f "$_ccshim_env_file" ]; then
          _ccshim_mode="$(stat -c %a "$_ccshim_env_file" 2>/dev/null || true)"
          [ "$_ccshim_mode" = "600" ] || { printf "%s\n" "cc-shim 拒絕啟動：端點環境檔權限不是 0600" >&2; rm -f -- "$_ccshim_env_file"; exit 2; }
          set -a
          . "$_ccshim_env_file"
          set +a
          rm -f -- "$_ccshim_env_file"
          rmdir "${_ccshim_env_file%/*}" 2>/dev/null || true
        fi
        _ccshim_env_probe="${ANTHROPIC_BASE_URL:+1}"
        [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] && [ "$_ccshim_env_probe" = "1" ] || { printf "%s\n" "cc-shim 拒絕啟動：mount 隔離前綴不會保留環境變數，端點環境變數（ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN）將被清空" >&2; exit 2; }
        # ccshim-env-load-end
        exec env -u ANTHROPIC_API_KEY -u ANTHROPIC_CUSTOM_HEADERS HOME="${11:-$HOME}" CLAUDE_CONFIG_DIR="${12:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}" ${8:+ANTHROPIC_CUSTOM_HEADERS="$8"} ${10:+ENABLE_TOOL_SEARCH=false} claude -p ${4:+--session-id "$4"} --model "$2" \
        --strict-mcp-config --dangerously-skip-permissions --disallowedTools TaskCreate,TaskUpdate,TaskGet,TaskList \
        ${5:+--effort "$5"} ${7:+--settings "$7"} --output-format json < "$3" >"$6"' \
        _ "${WORKER_CWD:-$WT}" "$MODEL" "$CCSHIM_PROMPT_FILE" "${CHILD_SESSION_ID:-}" "$CLAUDE_EFFORT_ARG" "$CCSHIM_ENVELOPE" "${GATE_ARGV[0]-}" "$FLEET_TASK_HEADER" "$CCSHIM_ENV_FILE" "$([ "${LOCAL_RUNNER:-0}" -eq 1 ] && printf 1)" "${SCRATCH_HOME:-$HOME}" "${SCRATCH_CONFIG_DIR:-${SANDBOX_TMP:+$SANDBOX_TMP/claude-config}}"
  fi
  # The worker is done (success, failure or timeout): the gate file and the settings file go now.
  if [ -n "${GATE_ARMED_SESSION:-}" ]; then
    node "$SELF_DIR/per-turn-gate-arm.js" disarm --session "$GATE_ARMED_SESSION" >/dev/null 2>&1 || true
    GATE_ARMED_SESSION=""
  fi
  [ -n "${GATE_SETTINGS_FILE:-}" ] && rm -f "$GATE_SETTINGS_FILE"
  GATE_SETTINGS_FILE=""
  if [ "${SANDBOX:-off}" = "bwrap" ] && [ -n "${SANDBOX_TMP:-}" ]; then
    # The envelope was written inside the per-dispatch scratch dir; the usage/classify readers want it
    # outside, so move it out before the scratch dir goes.
    if [ -f "$CCSHIM_ENVELOPE" ]; then
      _sbx_env_out="$(mktemp -t dispatch-hetero-ccshim-envelope-XXXXXX)"
      mv -f "$CCSHIM_ENVELOPE" "$_sbx_env_out" && CCSHIM_ENVELOPE="$_sbx_env_out"
    fi
  fi
  if [ -f "$CCSHIM_ENVELOPE" ]; then
    # One JSON object → result text (is_error with an empty result uses the
    # error message). Anything else, including a second JSON document, is the
    # raw stdout. A non-zero exit with no result text also keeps the raw bytes.
    node - "$CCSHIM_ENVELOPE" "$LOG" <<'NODE'
const fs = require('fs');
const envPath = process.argv[2];
const logPath = process.argv[3];
let raw;
try { raw = fs.readFileSync(envPath); } catch { process.exit(0); }
function withNl(s) {
  return Buffer.from(s.endsWith('\n') ? s : s + '\n');
}
function errorText(obj) {
  const cands = [];
  if (typeof obj.error === 'string') cands.push(obj.error);
  if (typeof obj.message === 'string') cands.push(obj.message);
  if (typeof obj.error_message === 'string') cands.push(obj.error_message);
  if (Array.isArray(obj.errors)) {
    for (const e of obj.errors) if (typeof e === 'string') cands.push(e);
  }
  for (const c of cands) if (c.trim() !== '') return c;
  return '';
}
let out = raw;
try {
  const obj = JSON.parse(raw.toString('utf8'));
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const result = typeof obj.result === 'string' ? obj.result : null;
    const resultHasText = result !== null && result.trim() !== '';
    if (resultHasText) {
      out = withNl(result);
    } else if (obj.is_error === true) {
      const msg = errorText(obj);
      if (msg) out = withNl(msg);
      else out = raw;
    } else if (result !== null) {
      out = withNl(result);
    }
  }
} catch { out = raw; }
fs.appendFileSync(logPath, out);
NODE
  fi
  rm -f "$CCSHIM_PROMPT_FILE"
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    sandbox_count_denied   # after the result text is in LOG
    sandbox_teardown
  fi
elif [ "$IS_GROK" -eq 1 ]; then
  # grok (xAI Grok Build CLI; models grok-4.5 (ex-grok-build) / grok-composer-2.5-fast). Unlike agy,
  # grok `-p` HONORS --cwd (verified Spike 2026-06-29: grok-composer-2.5-fast and
  # grok-build both created files inside --cwd, exit 0) — so NO absolute-path anchor
  # is needed. We still run grok EDIT-ONLY + wrapper-commit (same robust rail as agy):
  # the verdict is read from git artifacts, never from grok committing on its own.
  # Flags are all Spike-verified present: --prompt-file, --cwd, --model, --always-approve
  # (headless tool auto-approve), --no-alt-screen (clean capture under a pipe),
  # --output-format json. (Do NOT add unverified flags like --no-auto-update.)
  # --reasoning-effort: probe-verified 2026-07-25 (grok 0.2.111, grok-4.5). grok validates
  # the value against a 3-item enum and HARD-FAILS otherwise, so EFFORT must be clamped —
  # passing autopilot's default xhigh verbatim errors out. See lib/grok-effort.sh.
  GROK_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.

Before finishing, write \$AUTOPILOT_EVIDENCE_NOTES with sections \`## Tests\` (lines \`<rc> <command>\`) and \`## Risk\` (first line low|medium|high, then one sentence). Never create notes or evidence files inside the worktree.
===

"
  # Feed via --prompt-file (NOT -p "$(cat …)"): a large task prompt as a single argv arg
  # can hit ARG_MAX before grok runs. The combined file MUST be an absolute path — grok
  # resolves --prompt-file relative to --cwd (Spike-verified 2026-06-29). mktemp is absolute.
  GROK_PROMPT_FILE="$(mktemp -t dispatch-hetero-grok-prompt-XXXXXX)"
  printf '%s' "${GROK_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$GROK_PROMPT_FILE"
  seal_runner_prompt_bytes "$GROK_PROMPT_FILE"
  # effort enum is per-MODEL (grok-4.5 rejects xhigh; 4.6+ accept) ⇒ clamp against THIS model's live enum.
  GROK_EFFORT="$(grok_effort_clamp "$EFFORT" "$MODEL" "$GROK_BIN")"
  EFFORT_SENT="$GROK_EFFORT"
  grok_effort_note "$EFFORT" "dispatch-hetero" "$MODEL" "$GROK_BIN" "$GROK_EFFORT"
  if [ -n "$RESUME_SESSION_ID" ]; then
    PROVIDER_SESSION_ID="$RESUME_SESSION_ID"
    PROVIDER_SESSION_REUSED=1
    run_worker bash -c 'cd "$1" && exec "$2" --resume "$6" --prompt-file "$3" --cwd "$1" --model "$4" \
        --reasoning-effort "$5" --always-approve --no-alt-screen --output-format json' \
        _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL" "$GROK_EFFORT" "$RESUME_SESSION_ID"
  else
    PROVIDER_SESSION_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
    run_worker bash -c 'cd "$1" && exec "$2" --session-id "$6" --prompt-file "$3" --cwd "$1" --model "$4" \
        --reasoning-effort "$5" --always-approve --no-alt-screen --output-format json' \
        _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL" "$GROK_EFFORT" "$PROVIDER_SESSION_ID"
  fi
  rm -f "$GROK_PROMPT_FILE"
elif [ "$IS_QODER" -eq 1 ]; then
  EFFORT_SENT="$EFFORT"
  # Qoder CLI CN (qoderclicn 1.1.89). EDIT-ONLY + wrapper-commit, same rail as grok.
  # Prompt on stdin. --config-dir only when --qoder-config-dir was given.
  # Do not call runner_bin_fallback: an omitted --qoder-bin stays the bare name qoderclicn.
  QODER_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.

Before finishing, write \$AUTOPILOT_EVIDENCE_NOTES with sections \`## Tests\` (lines \`<rc> <command>\`) and \`## Risk\` (first line low|medium|high, then one sentence). Never create notes or evidence files inside the worktree.
===

"
  QODER_PROMPT_FILE="$(mktemp -t dispatch-hetero-qoder-prompt-XXXXXX)"
  printf '%s' "${QODER_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$QODER_PROMPT_FILE"
  seal_runner_prompt_bytes "$QODER_PROMPT_FILE"
  QODER_CFG_ARGS=()
  [ -n "${QODER_CONFIG_DIR:-}" ] && QODER_CFG_ARGS+=(--config-dir "$QODER_CONFIG_DIR")
  run_worker bash -c 'cd "$1" && exec "$2" -p --model "$4" -w "$1" \
      --reasoning-effort "$5" --dangerously-skip-permissions --no-session-persistence \
      "${@:6}" < "$3"' \
      _ "$WT" "$QODER_BIN" "$QODER_PROMPT_FILE" "$MODEL" "$EFFORT" \
      ${QODER_CFG_ARGS[@]+"${QODER_CFG_ARGS[@]}"}
  rm -f "$QODER_PROMPT_FILE"
elif [ "$IS_OPENCODE" -eq 1 ]; then
  # opencode (OpenCode CLI, `opencode run` headless). Spike-verified 2026-09-03 (opencode
  # 1.18.25, docs/plans/2026-09-03-opencode-implementer-rail.md § Stage-0):
  #   --dir anchors edits at the real worktree (no agy-style absolute-path anchor needed);
  #   the prompt is read from STDIN when no positional message is given (no ARG_MAX wall);
  #   --pure runs without the operator's external plugins (hermetic exam surface; v1 only —
  #   opencode 2.x removed --dir/--pure/--variant, see lib/opencode-containment.js);
  #   --format json streams events (step_finish carries token usage — parsing is a follow-up,
  #   log_format stays plain and usage null); edit-only: it never commits → wrapper-commit
  #   rail, same as grok. --model is a provider/model id verbatim.
  #   EFFORT → `--variant` (v2.35.14). Probe-verified 2026-09-03 on opencode-go/muse-spark-1.3-
  #   contributor (3 samples per tier, same no-tool prompt, reasoning tokens from step_finish):
  #   minimal ≈53 < low ≈103 < medium ≈171 ≈ high ≈174 < xhigh ≈201; the provider default and an
  #   UNKNOWN variant both land ≈150 (≈medium) — opencode does not validate the value, it falls
  #   through silently. So the value we send must be one the provider knows: autopilot's `max`
  #   is clamped to `xhigh` (models.dev reasoning_options for this model: minimal|low|medium|
  #   high|xhigh); `minimal` is not in autopilot's effort vocabulary and cannot be requested.
  OPENCODE_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.

Before finishing, write \$AUTOPILOT_EVIDENCE_NOTES with sections \`## Tests\` (lines \`<rc> <command>\`) and \`## Risk\` (first line low|medium|high, then one sentence). Never create notes or evidence files inside the worktree.
===

"
  OPENCODE_PROMPT_FILE="$(mktemp -t dispatch-hetero-opencode-prompt-XXXXXX)"
  printf '%s' "${OPENCODE_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$OPENCODE_PROMPT_FILE"
  seal_runner_prompt_bytes "$OPENCODE_PROMPT_FILE"
  EFFORT_SENT="$EFFORT"
  # argv/env come from lib/opencode-containment.js (`plan --profile implement`): v1 =
  # `run --dir <wt> --pure -m M --variant V --format json`; v2 (opencode 2.x removed those flags) =
  # `run --standalone -m M#V --format json` with the worktree as cwd. Max→xhigh in both.
  OC_PLAN_DIR="$(mktemp -d -t dispatch-hetero-opencode-plan-XXXXXX)"
  if node "$SELF_DIR/lib/opencode-containment.js" plan --bin "$OPENCODE_BIN" --model "$MODEL" --effort "$EFFORT" \
       --profile implement --cwd "$WT" --version-string "$OPENCODE_VER" --out "$OC_PLAN_DIR" >"$OC_PLAN_DIR/err" 2>&1; then
    mapfile -d '' -t OC_ARGV < "$OC_PLAN_DIR/argv.nul"
    mapfile -d '' -t OC_ENV < "$OC_PLAN_DIR/env.nul"
    run_worker bash -c 'cd "$1" && in="$2" && shift 2 && exec "$@" < "$in"' \
        _ "$WT" "$OPENCODE_PROMPT_FILE" ${OC_ENV[@]+env "${OC_ENV[@]}"} "$OPENCODE_BIN" "${OC_ARGV[@]}"
  else
    run_worker bash -c 'echo "opencode plan failed: $(cat "$1")" >&2; exit 2' _ "$OC_PLAN_DIR/err"
  fi
  rm -rf "$OC_PLAN_DIR"
  rm -f "$OPENCODE_PROMPT_FILE"
elif [ "$IS_KIMI" -eq 1 ] && [ "$BIN_FLAG_KIMI" -eq 1 ]; then
  # Explicit test seam only. Kimi Code CLI (Moonshot). Stage-0 spike 2026-09-11 (kimi 0.41.0), see
  # docs/plans/_archive/2026/09/2026-09-11-kimi-implementer-rail.md §0:
  #   plain `-p` already edits files in the PROCESS CWD, exit 0, NOT committed by kimi itself
  #   → wrapper-commit rail, same as grok/opencode; `-p` CANNOT combine with
  #   --auto/-y ("Cannot combine --prompt with --auto") and neither is needed since -p already
  #   edits; prompt travels ONLY as one -p argv string (no --prompt-file, no STDIN — `-p ''` is
  #   rejected, `-p -` is taken literally) — guarded pre-spend above (KIMI_EDIT_ONLY /
  #   KIMI_ARGV_LIMIT, same shape as dispatch-review.sh's kimi gate); no effort flag exists on
  #   this route — an explicit low|high|max travels as KIMI_MODEL_THINKING_EFFORT (exported at the effort gate; kimi
  #   2.3.0 wire.jsonl probe 2026-10-24: low vs unset), run_worker inherits it; --output-format text
  #   for a clean parseable capture. KIMI_EDIT_ONLY was computed once at the pre-spend gate
  #   (above) so the run here sends the EXACT bytes that were size-checked.
  KIMI_PROMPT_FILE="$(mktemp -t dispatch-hetero-kimi-prompt-XXXXXX)"
  printf '%s' "${KIMI_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$KIMI_PROMPT_FILE"
  KIMI_SENT_FILE="$(mktemp -t dispatch-hetero-kimi-sent-XXXXXX)"
  KIMI_PARTS_DIR=""
  if [ "${KIMI_INDIRECT:-0}" -eq 1 ]; then
    # File indirection (BL-0025): split the combined prompt into ~60 KB line-preserving parts
    # inside a run-scoped scratch dir, and pass a short pointer via -p.
    KIMI_PART_BYTES="${AUTOPILOT_KIMI_PART_BYTES:-60000}"
    KIMI_PARTS_DIR="$(mktemp -d -t dispatch-hetero-kimi-parts-XXXXXX)"
    split -C "$KIMI_PART_BYTES" -d -a 3 "$KIMI_PROMPT_FILE" "$KIMI_PARTS_DIR/autopilot-hetero-prompt.part-" \
      || die_precondition "could not stage the kimi prompt parts"
    KIMI_PARTS=""
    for _kp in "$KIMI_PARTS_DIR"/autopilot-hetero-prompt.part-*; do
      KIMI_PARTS="${KIMI_PARTS:+$KIMI_PARTS, }$_kp"
    done
    printf '%s' "Your complete task is split, in order, across these files: ${KIMI_PARTS}. Each file fits in one Read call: read EVERY file completely, in that order, before starting. Together they form one prompt; then do exactly what it says." > "$KIMI_SENT_FILE"
  else
    # -p "$(cat file)" drops trailing newlines. Hash and send those exact argv bytes.
    printf '%s' "$(cat "$KIMI_PROMPT_FILE")" > "$KIMI_SENT_FILE"
  fi
  seal_runner_prompt_bytes "$KIMI_SENT_FILE"
  EFFORT_SENT="${KIMI_EFFORT_SEND:-default}"
  run_worker bash -c 'cd "$1" && exec "$2" -m "$4" -p "$(cat "$3")" --output-format text' \
      _ "${WORKER_CWD:-$WT}" "$KIMI_BIN" "$KIMI_SENT_FILE" "$MODEL"
  if [ -n "$KIMI_PARTS_DIR" ]; then
    node -e '
      const fs = require("fs"), path = require("path");
      const dir = process.argv[1];
      const prefix = path.join(process.env.TMPDIR || "/tmp", "dispatch-hetero-kimi-parts-");
      if (dir.startsWith(prefix) && path.dirname(dir) === path.dirname(prefix)) {
        for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
        fs.rmdirSync(dir);
      }
    ' "$KIMI_PARTS_DIR"
  fi
  rm -f -- "$KIMI_SENT_FILE" "$KIMI_PROMPT_FILE"
  KIMI_PARTS_DIR=""
  # Part 3: kimi has no usage command; its result is the quota signal (429 -> exhausted + reset, clean -> available).
  node "$SELF_DIR/lib/kimi-quota-observe.js" observe --rc "${AGENT_EXIT:-0}" --log-file "$LOG" >/dev/null 2>&1 || true
elif [ "$IS_CURSOR" -eq 1 ] || [ "$IS_KIMI" -eq 1 ]; then
  if [ "$IS_KIMI" -eq 1 ]; then EFFORT_SENT="${KIMI_EFFORT_SEND:-default}"; else EFFORT_SENT="default"; fi
  # Both seats use the same clone, protocol, diff-import and quota-observer rail.
  BROKER_RUNNER=cursor
  local broker_group_wrapper="${AUTOPILOT_CURSOR_GROUP_WRAPPER:-sg}" broker_group_cmd
  if [ "$IS_KIMI" -eq 1 ]; then
    BROKER_RUNNER=kimi
    broker_group_wrapper="${AUTOPILOT_KIMI_GROUP_WRAPPER:-sg}"
  fi
  BROKER_RESULT="$LOG.$BROKER_RUNNER-broker.json"
  # The broker prepends EDIT_ONLY inside readPrompt. Hash that string, not PROMPT_FILE.
  BROKER_PROMPT_FILE="$(mktemp -t dispatch-hetero-broker-prompt-XXXXXX)"
  node - "$SELF_DIR/lib/cursor-broker-client.js" "$BROKER_PROMPT_FILE" "$PROMPT_FILE" "$BROKER_RUNNER" <<'NODE' \
    || die_precondition "broker prompt materialize failed"
const fs = require('fs');
const { readPrompt } = require(process.argv[2]);
fs.writeFileSync(process.argv[3], readPrompt(process.argv[4], process.argv[5]));
NODE
  seal_runner_prompt_bytes "$BROKER_PROMPT_FILE"
  rm -f "$BROKER_PROMPT_FILE"
  BROKER_PROMPT_FILE=""
  printf -v broker_group_cmd '%q ' "$(command -v node)" "$SELF_DIR/lib/cursor-broker-run.js" \
    "$WT" "$PROMPT_FILE" "$MODEL" "$BROKER_TIMEOUT_S" "$DISPATCH_RUN_ID" "$BROKER_RESULT" "$BROKER_RUNNER"
  run_worker "$broker_group_wrapper" lanegit -c "$broker_group_cmd"
  if [ -f "$BROKER_RESULT" ]; then
    # Missing or non-string verdict must not throw the reader (that used to leave
    # both variables empty, and the receipt then said only "broker failed").
    _broker_meta="$(node - "$BROKER_RESULT" <<'NODE'
const fs = require('fs');
let obj = null;
try { obj = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch { obj = null; }
const has = !!(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, 'verdict'));
const verdict = has ? obj.verdict : undefined;
const known = new Set(['done', 'rejected', 'stopped_billing', 'timeout', 'agent_failed', 'failed']);
let kind = 'missing';
if (typeof verdict === 'string' && known.has(verdict)) kind = 'known';
else if (!(verdict === undefined || verdict === null || verdict === '')) kind = 'unknown';
let raw = '';
if (typeof verdict === 'string') raw = verdict;
else if (verdict === null) raw = 'null';
else if (!(verdict === undefined || verdict === '')) { try { raw = JSON.stringify(verdict); } catch { raw = ''; } }
const reason = obj && typeof obj.reason === 'string' ? obj.reason : '';
const confirmed = obj && obj.billing_confirmed === true ? 'true' : 'false';
const billingLine = obj && typeof obj.billing_line === 'string' ? obj.billing_line.slice(0, 160) : '';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
process.stdout.write(kind + '\n' + b64(raw) + '\n' + b64(reason) + '\n' + confirmed + '\n' + b64(billingLine) + '\n');
NODE
)" || _broker_meta=""
    BROKER_VERDICT_KIND="$(printf '%s\n' "$_broker_meta" | sed -n '1p')"
    BROKER_VERDICT="$(printf '%s\n' "$_broker_meta" | sed -n '2p' | base64 -d 2>/dev/null || true)"
    BROKER_REASON="$(printf '%s\n' "$_broker_meta" | sed -n '3p' | base64 -d 2>/dev/null || true)"
    BROKER_BILLING_CONFIRMED="$(printf '%s\n' "$_broker_meta" | sed -n '4p')"
    BROKER_BILLING_LINE="$(printf '%s\n' "$_broker_meta" | sed -n '5p' | base64 -d 2>/dev/null || true)"
    [ "$BROKER_VERDICT" != timeout ] || WORKER_TIMED_OUT=1
    if [ "$BROKER_VERDICT" != done ] || [ "${AGENT_EXIT:-1}" -eq 0 ]; then
      node "$SELF_DIR/lib/cursor-broker-client.js" observe "$BROKER_RUNNER" "$BROKER_VERDICT" "$BROKER_BILLING_CONFIRMED" "$BROKER_BILLING_LINE" >/dev/null 2>&1 || true
    fi
  fi
elif [ "$IS_PI" -eq 1 ]; then
  EFFORT_SENT="default"
  # Directive channel (Phase 2): forward the R0 ledger coords to the supervisor so a
  # depth-0 `directive-send` actually DELIVERS mid-run on the production pi path (the
  # supervisor polls + steers + acks; it gates cleanly on absence). Gated on ALL three
  # coords — a partial set forwards nothing (supervisor would refuse anyway; keep the
  # no-coords invocation byte-identical to pre-Phase-2).
  # pi-rpc-run prepends HARNESS_EDIT_ONLY before the RPC prompt message. Hash those bytes.
  PI_FINAL_PROMPT="$(mktemp -t dispatch-hetero-pi-prompt-XXXXXX)"
  node - "$SELF_DIR/lib/pi-rpc-run.js" "$PI_FINAL_PROMPT" "$PROMPT_FILE" <<'NODE' \
    || die_precondition "pi prompt materialize failed"
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const m = src.match(/const HARNESS_EDIT_ONLY = `([\s\S]*?)`;\r?\n/);
if (!m) { process.stderr.write('pi harness banner missing\n'); process.exit(2); }
fs.writeFileSync(process.argv[3], Buffer.concat([Buffer.from(m[1], 'utf8'), fs.readFileSync(process.argv[4])]));
NODE
  seal_runner_prompt_bytes "$PI_FINAL_PROMPT"
  rm -f "$PI_FINAL_PROMPT"
  PI_FINAL_PROMPT=""
  if [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ]; then
    run_worker bash -c 'cd "$1" && exec node "$2" --pi-bin "$3" --provider "$4" --model "$5" --cwd "$1" --prompt-file "$6" --ledger "$7" --run-id "$8" --stage "$9"' _ "$WT" "$SELF_DIR/lib/pi-rpc-run.js" "$PI_BIN" "${PI_RPC_PROVIDER:-minimax}" "$MODEL" "$PROMPT_FILE" "$LEDGER" "$RUN_ID" "$STAGE"
  else
    run_worker bash -c 'cd "$1" && exec node "$2" --pi-bin "$3" --provider "$4" --model "$5" --cwd "$1" --prompt-file "$6"' _ "$WT" "$SELF_DIR/lib/pi-rpc-run.js" "$PI_BIN" "${PI_RPC_PROVIDER:-minimax}" "$MODEL" "$PROMPT_FILE"
  fi
else
  printf '%s\n' "dispatch-hetero: NOTE — agy/Gemini directory-targeting is now RELIABLE: the directive below PREPENDS an absolute-worktree anchor (agy -p ignores process cwd, so a relative-path prompt made it invent a scratch project = the old no_op; the anchor points its edits at the real worktree — verified single- and multi-file). agy stays EDIT-ONLY for a DIFFERENT reason: run_command foreground-caps at ~10s then AUTO-BACKGROUNDS longer commands and waits (empirically a 75s command DID complete and return stdout, bounded by --print-timeout — the old 'hard 10s cap / cannot run build/test' framing is REFUTED, agy 1.0.14 2026-07-02); what stays unreliable is chaining run-long-command THEN git-commit in ONE -p turn (the turn can yield after the backgrounded task). So agy edits, the wrapper commits, the reviewer verifies. For tasks where the agent itself must run build/test AND self-commit mid-flight, prefer --model gpt-5.5 (codex). See memory: agy-writes-install-dir (RESOLVED)." >&2
  # agy (Gemini) in -p print mode CANNOT reliably run a long command THEN commit in
  # one turn: run_command foreground-caps at ~10s and AUTO-BACKGROUNDS longer commands
  # (it DOES complete them and return stdout, bounded by --print-timeout — the '10s
  # wall / cannot run build/test' claim is REFUTED, agy 1.0.14 2026-07-02); but the
  # single print turn can yield ("you'll be notified, stop calling tools") after the
  # backgrounded task, before a follow-up commit runs → silent no_op/hallucination.
  # So we run agy EDIT-ONLY and the wrapper commits its edits below; verify by
  # artifact. (gotcha: agy-headless-dispatch-unreliable.)
  # $(...) strips trailing newlines, so the directive's terminating blank line is re-appended
  # here: it is what separates the directive from the task prompt in the bytes agy receives.
  AGY_EDIT_ONLY="$(agy_edit_only_directive "$WT")"$'\n\n'
  AGY_PARSED="$(mktemp -t dispatch-hetero-agy-parsed-XXXXXX)"
  AGY_USAGE_JSON="null"
  # --new-project is the MECHANISM behind the directive above. Measured 2026-09-13 (308-8f's
  # rail probe, reproduced here in a scratch repo): without it, agy -p in a fresh worktree path
  # RESUMES a prior conversation keyed by an ancestor path in ~/.gemini/antigravity-cli/cache/
  # last_conversations.json (`/tmp` → an old conversation) and inherits that conversation's
  # repository memory — relative paths and `git commit` then land in a DIFFERENT checkout
  # (308's main tree; here, autopilot's own main checkout), while the file tool still reports
  # the process cwd. With --new-project the session starts clean and every edit and commit
  # lands in "$1". Evidence: docs/plans/evidence/2026-09-13-agy-worktree-escape/.
  AGY_PRINT_TIMEOUT="$(agy_print_timeout "$TIMEOUT")" || die_precondition "$AGY_PRINT_TIMEOUT"
  _AGY_HOME_CHECK="$(agy_assert_disposable_home)" || die_precondition "$_AGY_HOME_CHECK"
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    # The inner shell opens AGY_ENVELOPE and AGY_STDERR inside bwrap, so they must live in SANDBOX_TMP.
    if [ "${#SANDBOX_ARGV[@]}" -eq 0 ]; then
      sandbox_setup || { echo "sandbox: could not set up the bwrap scratch dir; worker not started" > "$LOG"; sandbox_teardown; AGENT_EXIT=1; return 0; }
    fi
    AGY_ENVELOPE="$(mktemp "${SANDBOX_TMP}/dispatch-hetero-agy-envelope-XXXXXX")"
    AGY_STDERR="$(mktemp "${SANDBOX_TMP}/dispatch-hetero-agy-stderr-XXXXXX")"
  else
    AGY_ENVELOPE="$(mktemp -t dispatch-hetero-agy-envelope-XXXXXX)"
    AGY_STDERR="$(mktemp -t dispatch-hetero-agy-stderr-XXXXXX)"
  fi
  AGY_EFFORT="$(agy_effort_for_model "$MODEL" "$EFFORT")"
  EFFORT_SENT="$AGY_EFFORT"
  AGY_CLAMPED="$(agy_effort_clamp "$EFFORT")"
  if [ "$AGY_EFFORT" != "$AGY_CLAMPED" ]; then
    printf 'agy effort %s (clamped %s) folded to %s: model id encodes the tier\n' \
      "$EFFORT" "$AGY_CLAMPED" "$AGY_EFFORT" >&2
  fi
  # The prompt (directive + task) goes on STDIN as stream-json via lib/agy-stream-json.js, so there
  # is no argv-size ceiling. `--emit envelope` re-emits agy's `result` object, which has exactly the
  # shape of the old `--output-format json` envelope, so dispatch-status.js --agy-envelope below is
  # unchanged. A `result` of status ERROR (or none at all) makes the helper exit 1 → the normal
  # non-zero-agent path (agent_log gets stderr, status from git artifacts).
  # NOTE: systemd-run environment expansion is disabled (--expand-environment=no);
  # the script still `shift`s the worktree off before using positional parameters.
  # agy-stream-json concatenates --prefix and the prompt file. Write that once and
  # pass it with an empty prefix so the sealed file is what agy is given.
  AGY_FINAL_PROMPT="$(mktemp -t dispatch-hetero-agy-prompt-XXXXXX)"
  { printf '%s' "$AGY_EDIT_ONLY"; cat "$PROMPT_FILE"; } > "$AGY_FINAL_PROMPT"
  seal_runner_prompt_bytes "$AGY_FINAL_PROMPT"
  run_worker bash -c 'cd "$1" && shift && exec node "$8" run --prompt-file "$9" --prefix "$2" --emit envelope \
      -- "$1" --new-project --model "$3" --effort "$7" \
      --dangerously-skip-permissions --print-timeout "$4" \
      >"$5" 2>"$6"' \
      _ "$WT" "$AGY_BIN" "" "$MODEL" "$AGY_PRINT_TIMEOUT" \
      "$AGY_ENVELOPE" "$AGY_STDERR" "$AGY_EFFORT" \
      "$SELF_DIR/lib/agy-stream-json.js" "$AGY_FINAL_PROMPT"
  rm -f "$AGY_FINAL_PROMPT"
  AGY_FINAL_PROMPT=""
  local _agy_early_return=0
  if [ "$AGENT_EXIT" -ne 0 ]; then
    cat "$AGY_STDERR" >> "$LOG"
    printf '\n[dispatch-hetero: agy exited non-zero (rc=%s) — native envelope and usage NOT parsed]\n' \
      "$AGENT_EXIT" >> "$LOG"
    _agy_early_return=1
  elif ! node "$SELF_DIR/dispatch-status.js" --log "$AGY_ENVELOPE" --agy-envelope \
      > "$AGY_PARSED" 2>/dev/null; then
    # TELEMETRY LOSS, NOT A VERDICT (2026-09-03, Board). The envelope is the usage channel;
    # when it does not parse, usage stays null and the run is classified from git
    # artifacts exactly like every other rail (commit + clean tree + exit 0 → committed).
    # Until v2.35.12 this set AGENT_EXIT=65 and turned a landed commit into `failure`:
    # the 2026-08-22 gemini implementer seats lost 6/8, 2/8 and 6/8 create-a-new-file
    # cases to a malformed envelope with the edits sitting in the tree (BACKLOG "agy
    # output envelope invalid"). The envelope BODY is now kept in the log (bounded) so
    # the next administration can see what agy actually sent — nothing was retained
    # before, which is why that BACKLOG row still has no reproduction.
    cat "$AGY_STDERR" >> "$LOG"
    printf '\n[dispatch-hetero: agy native JSON envelope invalid — usage NOT parsed (null); status decided from git artifacts. Raw envelope (first 64 KiB) follows]\n' \
      >> "$LOG"
    head -c 65536 "$AGY_ENVELOPE" >> "$LOG" 2>/dev/null || true
    printf '\n[dispatch-hetero: end of raw envelope]\n' >> "$LOG"
    [ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: agy native JSON envelope invalid — usage null; status from git artifacts (see $LOG)" >&2
    AGY_USAGE_JSON="null"
    _agy_early_return=1
  else
    node - "$AGY_PARSED" "$LOG" <<'NODE'
const fs = require('fs');
const parsed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], parsed.response);
NODE
    AGY_USAGE_JSON="$(node -e '
      const fs = require("fs");
      process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).usage));
    ' "$AGY_PARSED")"
  fi
  if [ "${SANDBOX:-off}" = "bwrap" ]; then
    sandbox_count_denied
    sandbox_teardown
  fi
  [ "$_agy_early_return" -eq 0 ] || return 0
fi
capture_structured_provider_error
}

# Structured provider failure, from harness-owned fields only.
# cc-shim: the private envelope file. opencode: complete top-level JSON event
# lines already in LOG. Free text never sets PROVIDER_ERROR_*.
capture_structured_provider_error() {
  PROVIDER_ERROR_RUNNER=""
  PROVIDER_ERROR_STATUS=""
  PROVIDER_ERROR_FIELD=""
  [ "${AGENT_EXIT:-0}" -ne 0 ] || return 0
  [ "${IS_CCSHIM:-0}" -eq 1 ] || [ "${IS_OPENCODE:-0}" -eq 1 ] || return 0
  local _parsed=""
  _parsed="$(node - "${LOG:-}" "${CCSHIM_ENVELOPE:-}" "${IS_CCSHIM:-0}" "${IS_OPENCODE:-0}" <<'NODE'
const fs = require('fs');
const ALLOW = new Set([429, 503, 529, 402]);
const logPath = process.argv[2];
const envelopePath = process.argv[3];
const isCc = process.argv[4] === '1';
const isOc = process.argv[5] === '1';
let runner = '';
let status = '';
let field = '';
function accept(name, code, fieldName) {
  if (!Number.isInteger(code) || !ALLOW.has(code)) return false;
  runner = name;
  status = String(code);
  field = fieldName;
  return true;
}
if (isCc && envelopePath) {
  try {
    const obj = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    if (obj && typeof obj === 'object' && !Array.isArray(obj)
        && obj.type === 'result' && obj.is_error === true) {
      accept('cc-shim', obj.api_error_status, 'api_error_status');
    }
  } catch { /* missing or unparseable envelope: no structured evidence */ }
} else if (isOc && logPath) {
  let text = '';
  try { text = fs.readFileSync(logPath, 'utf8'); } catch { text = ''; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.type !== 'error') continue;
    const err = obj.error;
    if (!err || typeof err !== 'object' || Array.isArray(err) || err.name !== 'APIError') continue;
    const data = err.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    if (accept('opencode', data.statusCode, 'error.data.statusCode')) break;
  }
}
process.stdout.write(runner + '\n' + status + '\n' + field + '\n');
NODE
)" || _parsed=""
  PROVIDER_ERROR_RUNNER="$(printf '%s\n' "$_parsed" | sed -n '1p')"
  PROVIDER_ERROR_STATUS="$(printf '%s\n' "$_parsed" | sed -n '2p')"
  PROVIDER_ERROR_FIELD="$(printf '%s\n' "$_parsed" | sed -n '3p')"
}

# endpoint-backed runs only (--endpoint given): split a local/self-hosted endpoint's death into
# endpoint_busy (HTTP 429 or 503: the throttling proxy in front of the server shedding load) and
# endpoint_unreachable (connection refused/reset, DNS, connect/read timeout, any other 5xx).
# Prints the class, or nothing when this is not an endpoint run or the log names neither.
# auth_failed / quota_exhausted keep their meaning (escalate). model_unsupported is a caller
# model pick (not an auth or quota escalation — it is absent from _is_engine_unavailable) and
# must not be rewritten into an endpoint class. Pure function of THIS run's log and
# structured status: no state is read or written, so one bad dispatch never marks the endpoint down
# for the next one. Cloud runners (no --endpoint) never reach the patterns, so their
# rate_limited/overloaded classification is byte-identical.
_endpoint_error_class() {
  [ -n "${ENDPOINT:-}" ] || return 0
  case "${CLASSIFIED_ERROR:-}" in auth_failed|quota_exhausted|model_unsupported) return 0 ;; esac
  # Structured sources only (never the worker's own output): the cc-shim envelope's result text
  # when it is an api_error result, and lines the claude CLI itself prints starting "API Error".
  local _txt=""
  _txt="$(node - "${LOG:-}" "${CCSHIM_ENVELOPE:-}" <<'NODE' 2>/dev/null | tr '[:upper:]' '[:lower:]'
const fs = require('fs');
const out = [];
try {
  const obj = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  if (obj && typeof obj === 'object' && !Array.isArray(obj)
      && obj.type === 'result' && obj.is_error === true && obj.terminal_reason === 'api_error') {
    for (const k of ['result', 'error', 'message', 'error_message']) {
      if (typeof obj[k] === 'string') out.push(obj[k]);
    }
  }
} catch { /* no envelope */ }
try {
  const log = fs.readFileSync(process.argv[2], 'utf8').slice(-20000);
  for (const line of log.split('\n')) if (/^API Error/.test(line)) out.push(line);
} catch { /* no log */ }
process.stdout.write(out.join('\n'));
NODE
)" || _txt=""
  case "${PROVIDER_ERROR_STATUS:-}" in
    429|503) printf 'endpoint_busy'; return 0 ;;
  esac
  if printf '%s' "$_txt" | grep -Eq '(api error|http|status)[: =(]{0,4}(429|503)([^0-9]|$)|too many requests|service unavailable|retry-after'; then
    printf 'endpoint_busy'; return 0
  fi
  if printf '%s' "$_txt" | grep -Eq 'econnrefused|connection refused|econnreset|connection reset|enotfound|getaddrinfo|name resolution|etimedout|timed out|read timeout|connect timeout|unable to connect|fetch failed|connection error|(api error|http|status)[: =(]{0,4}5[0-9][0-9]([^0-9]|$)'; then
    printf 'endpoint_unreachable'; return 0
  fi
  # The structured source confirmed an API error (`_txt` is only ever filled from one), it names no
  # 4xx status and is not auth/quota (returned above): the request never got a usable answer from
  # the endpoint, so it is unreachable. This catches the CLI's bare "API Error: Connection error."
  # and its other transport wordings. A 4xx (bad request, not found, ...) stays unclassified.
  case "${PROVIDER_ERROR_STATUS:-}" in 4[0-9][0-9]) return 0 ;; esac
  if [ -n "$_txt" ] && ! printf '%s' "$_txt" | grep -Eq '(api error|http|status)[: =(]{0,4}4[0-9][0-9]([^0-9]|$)'; then
    printf 'endpoint_unreachable'; return 0
  fi
  return 0
}

_prefer_structured_classified_error() {
  case "${CLASSIFIED_ERROR:-}" in endpoint_busy|endpoint_unreachable) return 0 ;; esac
  if [ -n "${ENDPOINT:-}" ]; then
    local _epc; _epc="$(_endpoint_error_class)"
    if [ -n "$_epc" ]; then CLASSIFIED_ERROR="$_epc"; return 0; fi
  fi
  case "${PROVIDER_ERROR_STATUS:-}" in
    429) CLASSIFIED_ERROR="rate_limited" ;;
    503|529) CLASSIFIED_ERROR="overloaded" ;;
    402) CLASSIFIED_ERROR="quota_exhausted" ;;
  esac
}

compute_artifacts() {
# agy/grok/codex run edit-only → the wrapper makes the commit (deterministic). It fires
# whenever the worker left edits but did NOT move HEAD (HEAD==BASE && dirty), REGARDLESS of
# runner; if the worker already committed (HEAD moved) or left nothing, this is a no-op.
# Universal fallback (was IS_CODEX-excluded): some codex runs — e.g. gpt-5.3-codex-spark —
# leave edits uncommitted, esp. for net-new files (verified e2e 2026-06-30). Safe because it
# only fires when HEAD hasn't moved, so a self-committing codex run is never double-committed.
#
# --no-verify is MANDATORY: this wrapper commit is a mechanical artifact-CAPTURE of the
# edit-only worker's edits, NOT the quality gate (the contract puts verdict at depth 0 —
# the dispatching session reviews the branch diff before any merge). Running the TARGET
# repo's pre-commit hook here is both redundant and harmful: a hook that builds (e.g.
# codepower's `vue-tsc -b` on staged .ts/.vue) emits untracked artifacts that leave the
# tree dirty AND can `exit 1` to ABORT the commit — silently swallowing legitimately-correct
# edits as a false `dirty`/`no_op`. The edit-only path leaves capture hook-free; captured
# commits are checked afterward in a throwaway worktree by `run_target_precommit()`.
# (Root cause of the 2026-06-30 agy/cc-shim `status:dirty` runs.)
if ! wt_gitfile_check; then
  # Fail closed: the gitfile was repointed, so no git runs against $WT; classify_outcome reports it.
  HEAD_SHA="$DIFF_BASE_SHA"; DIRTY=""; FILES=0; INS=0; DEL=0
  return 0
fi
if { [ "$(_wt_git rev-parse --verify HEAD 2>/dev/null || true)" = "$BASE_SHA" ] || { [ "${SCRATCH:-0}" -eq 1 ] && [ -z "$(_wt_git rev-parse --verify HEAD 2>/dev/null || true)" ]; }; } \
   && [ -n "$(_wt_git status --porcelain --ignore-submodules=dirty)" ]; then
  _runner_label="agy"; [ "$IS_CODEX" -eq 1 ] && _runner_label="codex"; [ "$IS_GROK" -eq 1 ] && _runner_label="grok"; [ "$IS_CCSHIM" -eq 1 ] && _runner_label="cc-shim"; [ "$IS_PI" -eq 1 ] && _runner_label="pi"; [ "$IS_CURSOR" -eq 1 ] && _runner_label="cursor"; [ "$IS_OPENCODE" -eq 1 ] && _runner_label="opencode"; [ "$IS_KIMI" -eq 1 ] && _runner_label="kimi"; [ "$IS_QODER" -eq 1 ] && _runner_label="qoderclicn"; [ "$IS_CNATIVE" -eq 1 ] && _runner_label="claude-native"
  _wt_git add -A
  if ! run_strict_staged_precheck; then
    # Staged manifest violation: leave the worktree staged for in-place repair;
    # classify_outcome surfaces boundary_rejected on the equality branch.
    :
  else
  _identity_args=()
  if ! _wt_git var GIT_AUTHOR_IDENT >/dev/null 2>&1 \
     || ! _wt_git var GIT_COMMITTER_IDENT >/dev/null 2>&1; then
    _identity_args=(-c user.email=autopilot@example.invalid -c user.name=Autopilot)
  fi
  if [ -n "${AUTOPILOT_EVIDENCE_NOTES:-}" ] && [ -s "$AUTOPILOT_EVIDENCE_NOTES" ]; then
    _wt_git -c commit.gpgsign=false "${_identity_args[@]}" commit --no-verify -q -m "dispatch-hetero($_runner_label): edits on $BRANCH" -m "$(cat "$AUTOPILOT_EVIDENCE_NOTES")" >/dev/null 2>&1 \
      && WRAPPER_COMMITTED=1   # capture path taken: the content gate may assert the wrapper subject
  else
    _wt_git -c commit.gpgsign=false "${_identity_args[@]}" commit --no-verify -q -m "dispatch-hetero($_runner_label): edits on $BRANCH" >/dev/null 2>&1 \
      && WRAPPER_COMMITTED=1   # capture path taken: the content gate may assert the wrapper subject
  fi
  fi
fi

# --- verify by artifacts, never by self-report ---
HEAD_SHA="$(_wt_git rev-parse --verify HEAD 2>/dev/null || true)"
if [ -z "$HEAD_SHA" ] && [ "${SCRATCH:-0}" -eq 1 ]; then HEAD_SHA="$DIFF_BASE_SHA"; fi
DIRTY="$(_wt_git status --porcelain --ignore-submodules=dirty)"
  FILES=0; INS=0; DEL=0
  EVIDENCE_PACK_WRITTEN=""
  if [ "$HEAD_SHA" != "$DIFF_BASE_SHA" ]; then
  SHORTSTAT="$(_wt_git diff --ignore-submodules=none --shortstat "$DIFF_BASE_SHA..$HEAD_SHA")"
  FILES="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ file' | grep -o '[0-9]\+' || echo 0)"
  INS="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ insertion' | grep -o '[0-9]\+' || echo 0)"
  DEL="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ deletion' | grep -o '[0-9]\+' || echo 0)"
  if [ -n "${EVIDENCE_PACK_FILE:-}" ] && [ -r "$SELF_DIR/evidence-pack.js" ]; then
    _ep_runner="${RUNNER:-agy}"
    [ "${IS_CODEX:-0}" -eq 1 ] && _ep_runner="codex"
    [ "${IS_GROK:-0}" -eq 1 ] && _ep_runner="grok"
    [ "${IS_CCSHIM:-0}" -eq 1 ] && _ep_runner="cc-shim"
    [ "${IS_PI:-0}" -eq 1 ] && _ep_runner="pi"
    [ "${IS_CURSOR:-0}" -eq 1 ] && _ep_runner="cursor"
    [ "${IS_OPENCODE:-0}" -eq 1 ] && _ep_runner="opencode"
    [ "${IS_KIMI:-0}" -eq 1 ] && _ep_runner="kimi"
    [ "${IS_QODER:-0}" -eq 1 ] && _ep_runner="qoderclicn"
    [ "${IS_CNATIVE:-0}" -eq 1 ] && _ep_runner="claude-native"
    _ep_args=(build --repo "$WT" --base "$DIFF_BASE_SHA" --head "$HEAD_SHA" --run-id "${DISPATCH_RUN_ID:-unknown}" --branch "$BRANCH" --out "$EVIDENCE_PACK_FILE" --runner "$_ep_runner")
    [ -n "${HETERO_FLEET_TASK_ID:-}" ] && _ep_args+=(--fleet-task "$HETERO_FLEET_TASK_ID")
    _ep_notes="${AUTOPILOT_EVIDENCE_NOTES:-}"
    if [ ! -s "$_ep_notes" ] && [ -n "${EVIDENCE_NOTES_PATH:-}" ] && [ -s "$EVIDENCE_NOTES_PATH" ]; then
      _ep_notes="$EVIDENCE_NOTES_PATH"
    fi
    [ -n "$_ep_notes" ] && _ep_args+=(--notes "$_ep_notes")
    if node "$SELF_DIR/evidence-pack.js" "${_ep_args[@]}" >/dev/null 2>&1; then
      EVIDENCE_PACK_WRITTEN="$EVIDENCE_PACK_FILE"
    fi
  fi
fi
}

capture_scratch_files() {
  [ "${SCRATCH:-0}" -eq 1 ] || return 0
  [ -n "${SCRATCH_DIR:-}" ] && [ -d "$SCRATCH_DIR" ] || return 1
  if [ -n "${MANIFEST_DIR_PATH:-}" ]; then mkdir -p -- "$MANIFEST_DIR_PATH" || return 1; fi
  node - "$SCRATCH_WORK_DIR" "$WT" "${SCRATCH_REJECTED_FILE:-$SCRATCH_DIR/scratch.rejected}" <<'NODE' || return 1
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(process.argv[2]);
const dst = path.resolve(process.argv[3]);
const rejected = process.argv[4];
const lines = [];
function walk(dir, rel = '') {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    const childRel = rel ? `${rel}/${name}` : name;
    if (childRel === 'brief.md' || childRel === 'final-prompt.md') continue;
    const from = path.join(dir, name);
    const to = path.join(dst, childRel);
    let st;
    try { st = fs.lstatSync(from); } catch { lines.push(`${childRel}\tstat_failed`); continue; }
    const reason = name === '.git' ? 'git_metadata'
      : name === '.autopilot-worktree.lock' ? 'worktree_lock'
        : childRel.includes('..') ? 'dotdot_path'
          : st.isSymbolicLink() ? 'symlink'
            : st.isFile() && st.nlink > 1 ? 'hardlink'
            : (!st.isDirectory() && !st.isFile()) ? 'unsupported_type' : '';
    if (reason) { lines.push(`${childRel}\t${reason}`); continue; }
    if (st.isDirectory()) {
      try {
        const dstStat = fs.lstatSync(to);
        if (!dstStat.isDirectory() || dstStat.isSymbolicLink()) { lines.push(`${childRel}\tdestination_type`); continue; }
      } catch (e) { if (!e || e.code !== 'ENOENT') { lines.push(`${childRel}\tdestination_stat_failed`); continue; } }
      try { fs.mkdirSync(to, { recursive: true, mode: 0o755 }); } catch { lines.push(`${childRel}\tmkdir_failed`); continue; }
      walk(from, childRel);
    } else {
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 });
        try {
          const dstStat = fs.lstatSync(to);
          if (!dstStat.isFile() || dstStat.isSymbolicLink()) { lines.push(`${childRel}\tdestination_type`); continue; }
        } catch (e) { if (!e || e.code !== 'ENOENT') { lines.push(`${childRel}\tdestination_stat_failed`); continue; } }
        fs.copyFileSync(from, to);
      }
      catch { lines.push(`${childRel}\tcopy_failed`); }
    }
  }
}
walk(src);
fs.writeFileSync(rejected, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
if (lines.length) process.stderr.write(`dispatch-hetero: scratch rejected ${lines.length} path(s); see scratch.rejected\n`);
NODE
  SCRATCH_FILES="$(_wt_git status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
  return 0
}

run_strict_acceptance_checks() {
  STRICT_POSTCHECK_ERROR=""
  STRICT_POSTCHECK_STATUS=""
  local acceptance_out acceptance_status index expected actual command err
  acceptance_out="$(node -e '
const fs = require("fs");
const cp = require("child_process");
const contractPath = process.argv[1];
const worktree = process.argv[2];
const logPath = process.argv[3];

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

let contract;
try {
  contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (e) {
  emit({ status: "acceptance_failed", error: "invalid contract json" });
  process.exit(1);
}

const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
if (!acceptance.length) {
  emit({ status: "acceptance_failed", error: "contract acceptance list is empty" });
  process.exit(1);
}

let logFd = null;
if (logPath) {
  try { logFd = fs.openSync(logPath, "a"); } catch (e) { logFd = null; }
}

const stdio = logFd !== null ? ["ignore", logFd, logFd] : ["ignore", "ignore", "ignore"];

for (let i = 0; i < acceptance.length; i++) {
  const entry = acceptance[i] || {};
  const argv = Array.isArray(entry.argv) ? entry.argv : [];
  const expected = Number(entry.exit);
  if (!Array.isArray(argv) || argv.length === 0) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv || []), expected: expected, actual: 1, error: "acceptance argv must be a non-empty array" });
    process.exit(1);
  }
  if (!Number.isInteger(expected) || expected < 0 || expected > 255) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: 1, error: "acceptance exit must be an integer 0..255" });
    process.exit(1);
  }

  let result;
  try {
    result = cp.spawnSync(argv[0], argv.slice(1), { cwd: worktree, stdio });
  } catch (err) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: 1, error: String(err && err.message ? err.message : err) });
    process.exit(1);
  }

  const actual = (typeof result.status === "number") ? result.status : (result.signal ? 128 : 1);
  if (actual !== expected) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: actual, error: "exit-code mismatch" });
    process.exit(1);
  }
}

if (logFd !== null) {
  fs.closeSync(logFd);
}
emit({ status: "ok" });
process.exit(0);
  ' "$CONTRACT_FILE" "$WT" "$LOG")"
  local acceptance_rc=$?
  acceptance_status="$(printf '%s' "$acceptance_out" | extract_json_value status 2>/dev/null || true)"
  if [ "$acceptance_rc" -ne 0 ] || [ "$acceptance_status" != "ok" ]; then
    index="$(printf '%s' "$acceptance_out" | extract_json_value index 2>/dev/null || true)"
    command="$(printf '%s' "$acceptance_out" | extract_json_value command 2>/dev/null || true)"
    expected="$(printf '%s' "$acceptance_out" | extract_json_value expected 2>/dev/null || true)"
    actual="$(printf '%s' "$acceptance_out" | extract_json_value actual 2>/dev/null || true)"
    err="$(printf '%s' "$acceptance_out" | extract_json_value error 2>/dev/null || true)"
    STRICT_POSTCHECK_STATUS="acceptance_failed"
    STRICT_POSTCHECK_ERROR="acceptance_failed"
    if [ -n "$command" ]; then
      STRICT_POSTCHECK_ERROR="acceptance_failed: command #${index:-?} $command (expected exit ${expected:-?}, got ${actual:-?})"
      [ -n "$err" ] && STRICT_POSTCHECK_ERROR="$STRICT_POSTCHECK_ERROR: $err"
    elif [ -n "$err" ]; then
      STRICT_POSTCHECK_ERROR="acceptance_failed: $err"
    fi
    return 1
  fi

  STRICT_POSTCHECK_STATUS="ok"
  return 0
}

# Pre-commit manifest gate (P6D KR2, plan R2' 2026-08-21; GO checkpoint scoped
# to WRAPPER-OWNED staging). The P6D incident's broad `git add -A` swept two
# dependency symlinks into an otherwise-green candidate; the post-commit
# boundary gate caught it only after the commit existed. This precheck runs the
# SAME comparator (check-disjointness --staged) between the wrapper's `add -A`
# and its capture commit: a violation leaves the worktree staged-but-uncommitted
# (repairable in place) and the run classifies boundary_rejected. Engines that
# self-commit never pass through here — the post-commit gate remains their
# authoritative (and tested) backstop.
# Hands boundary gates — run on EVERY committed round, strict or not (item (E) +
# 308-db's 2026-09-07 symlink incident, both 2026-09-13). Sets HANDS_BOUNDARY_ERROR.
#   1. main checkout untouched (fingerprint above)
#   2. commit content safe: scripts/check-hands-commit.js over BASE_SHA..HEAD_SHA — added
#      symlinks, added gitlinks, force-added ignored paths. The scope gate is blind to all
#      three: every such path can be inside the declared output surface.
# A check that cannot run (rc 3) REJECTS. "Not verified" is not "clean".
HANDS_BOUNDARY_ERROR=""
HANDS_BOUNDARY_CODE=""
# Main-checkout comparison runs on EVERY outcome — including no_op and failure — because
# the case it exists for is hands committing in the MAIN checkout while the hands HEAD
# never moves (review finding, 2026-09-13). Gating it on "a worktree commit exists" would
# skip exactly the incident.
check_main_checkout_boundary() {
  HANDS_BOUNDARY_ERROR=""; HANDS_BOUNDARY_CODE=""
  local after after_parts delta leaks
  after_parts="$(MAIN_CHECKOUT_FP_MODE=parts main_checkout_fingerprint)"
  after="$(main_checkout_parts_digest "$after_parts")"
  case "${MAIN_CHECKOUT_BEFORE}${after}" in *UNVERIFIABLE-*)
    HANDS_BOUNDARY_CODE="main_checkout_unverified"
    HANDS_BOUNDARY_ERROR="boundary_rejected: main checkout could not be measured (before=${MAIN_CHECKOUT_BEFORE:0:40} after=${after:0:40}); an unverified boundary is not a clean one — round discarded, worktree retained"
    return 1 ;;
  esac
  if [ "$after" != "$MAIN_CHECKOUT_BEFORE" ]; then
    HANDS_BOUNDARY_CODE="main_checkout_mutated"
    delta="$(main_checkout_describe_delta "${MAIN_CHECKOUT_BEFORE_PARTS:-}" "$after_parts")"
    leaks="$(main_checkout_wt_symlink_leaks "$WT")"
    HANDS_BOUNDARY_ERROR="boundary_rejected: main checkout mutated during the round under ${MAIN_CHECKOUT:-?} (${delta}; before=${MAIN_CHECKOUT_BEFORE:0:12} after=${after:0:12}); the rail cannot attribute the change, so the round is discarded with the worktree retained — re-dispatch once the main checkout is quiescent"
    [ -z "$leaks" ] || HANDS_BOUNDARY_ERROR="${HANDS_BOUNDARY_ERROR}. Likely cause: the worktree holds symlink(s) into the main checkout (${leaks}); a write through one lands in the main checkout (BL-0416: vite's node_modules/.vite-temp). Remove the symlink and install dependencies inside the worktree"
    return 1
  fi
  return 0
}
# Advisory scan (evidence-discipline §23): fixture literals written into production code.
# Branches on the scanner's exit code and can NEVER fail the hands gate: 0 clean and
# 2/3/anything else (usage, could not run, crash, no node) are silent; only rc 1 with a
# JSON body prints, as a lead for the reviewer.
run_fixture_literal_advisory() {
  local _fl_out="" _fl_rc=0
  _fl_out="$(node "$SELF_DIR/scan-fixture-literals.js" --repo "$WT" --base "$DIFF_BASE_SHA" --head "$HEAD_SHA" 2>/dev/null)" || _fl_rc=$?
  if [ "$_fl_rc" -eq 1 ] && [ -n "$_fl_out" ]; then
    printf '[hands-advisory] fixture literals in production code (scan-fixture-literals.js) — review before integrating:\n%s\n' "$_fl_out" >&2
  fi
  return 0
}
run_hands_content_gate() {
  HANDS_BOUNDARY_ERROR=""; HANDS_BOUNDARY_CODE=""
  local content_out content_rc
  # --expect-wrapper-subject only when THIS rail made the commit (capture path: the worker
  # left the tree dirty at BASE_SHA). A worker that commits itself owns its subject.
  local -a _subject_args=()
  [ "${WRAPPER_COMMITTED:-0}" -eq 1 ] && _subject_args=(--expect-wrapper-subject)
  content_out="$(node "$SELF_DIR/check-hands-commit.js" --repo "$WT" --base "$DIFF_BASE_SHA" --head "$HEAD_SHA" "${_subject_args[@]}" 2>&1)" && content_rc=0 || content_rc=$?
  case "$content_rc" in
    0)
      run_fixture_literal_advisory
      return 0 ;;
    1) HANDS_BOUNDARY_CODE="unsafe_commit_content"; HANDS_BOUNDARY_ERROR="boundary_rejected: unsafe commit content (added symlink / gitlink / ignored path) — ${content_out}" ;;
    *) HANDS_BOUNDARY_CODE="content_check_unverified"; HANDS_BOUNDARY_ERROR="boundary_rejected: hands content check could not run (rc ${content_rc}) — treated as NOT verified: ${content_out}" ;;
  esac
  return 1
}

# Backlog single-writer gate: hand commits use --no-verify and core.hooksPath=/dev/null,
# bypassing .githooks/pre-commit. When base..tip touches BACKLOG.md or .hippo/, run
# scripts/check-backlog-single-writer.js --range <base>..<tip> in the worktree before
# accepting the commits.
run_hands_backlog_gate() {
  local bsw_touched=0 bsw_path="" bsw_out="" bsw_rc=0
  BACKLOG_VIEW_TOUCHED=0
  while IFS= read -r -d '' bsw_path; do
    case "$bsw_path" in
      project/backlog/BACKLOG.md)
        BACKLOG_VIEW_TOUCHED=1
        bsw_touched=1
        ;;
      docs/BACKLOG.md|.hippo/*)
        bsw_touched=1
        ;;
    esac
    [ "$bsw_touched" -eq 1 ] && [ "$BACKLOG_VIEW_TOUCHED" -eq 1 ] && break
  done < <(_wt_git diff --ignore-submodules=none --name-only -z "$DIFF_BASE_SHA..$HEAD_SHA" 2>/dev/null || true)
  if ! run_hands_backlog_reconcile_gate; then
    return 1
  fi
  [ "$bsw_touched" -eq 1 ] || return 0
  bsw_out="$(cd "$WT" && node "$SELF_DIR/check-backlog-single-writer.js" --range "$DIFF_BASE_SHA..$HEAD_SHA" --target "$WT" 2>&1 < /dev/null)" && bsw_rc=0 || bsw_rc=$?
  if [ "$bsw_rc" -ne 0 ]; then
    if [ -n "${LOG:-}" ]; then
      printf '\n[dispatch-hetero: backlog_single_writer]\n%s\n' "$bsw_out" >> "$LOG"
    fi
    HANDS_BOUNDARY_CODE="backlog_single_writer"
    HANDS_BOUNDARY_ERROR="boundary_rejected: backlog_single_writer — ${bsw_out}"
    return 1
  fi
  return 0
}

# Store/view gate, beside the single-writer check. A repo with .hippo/repo.toml must not
# accept a hand commit that changes project/backlog/BACKLOG.md while
# check-backlog-entries.js --hippo --reconcile (working tree, after the commit) is non-zero.
# No store: return 0 and leave today's acceptance path unchanged.
run_hands_backlog_reconcile_gate() {
  local rec_out="" rec_rc=0
  [ -f "$WT/.hippo/repo.toml" ] || return 0
  [ "${BACKLOG_VIEW_TOUCHED:-0}" -eq 1 ] || return 0
  rec_out="$(cd "$WT" && node "$SELF_DIR/check-backlog-entries.js" --hippo --reconcile 2>&1 < /dev/null)" && rec_rc=0 || rec_rc=$?
  if [ "$rec_rc" -ne 0 ]; then
    if [ -n "${LOG:-}" ]; then
      printf '\n[dispatch-hetero: backlog_store_reconcile]\n%s\n' "$rec_out" >> "$LOG"
    fi
    HANDS_BOUNDARY_CODE="backlog_store_reconcile"
    HANDS_BOUNDARY_ERROR="boundary_rejected: project/backlog/BACKLOG.md changed but the hippo store does not match (check-backlog-entries.js --hippo --reconcile exited ${rec_rc}); use node scripts/project-record.js backlog ..."
    return 1
  fi
  return 0
}

STRICT_PRECOMMIT_REJECTED=0
run_strict_staged_precheck() {
  local allow_file deny_file staged_out staged_rc out_dir temp_path
  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  if [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -eq 0 ] && [ "${#STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}" -eq 0 ]; then
    return 0 # no declared manifest → postcheck will fail it authoritatively
  fi
  allow_file="$(mktemp -t "hetero-staged-allow-XXXXXX")" || {
    STRICT_PRECOMMIT_REJECTED=1
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate staged-precheck allow temp file"
    return 1
  }
  for out_dir in "${STRICT_SCOPE_ALLOW_PATHS[@]}" "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
    [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$allow_file"
  done
  deny_file=""
  if [ "${#STRICT_SCOPE_DENY_PATHS[@]}" -gt 0 ]; then
    deny_file="$(mktemp -t "hetero-staged-deny-XXXXXX")" || {
      rm -f "$allow_file"
      STRICT_PRECOMMIT_REJECTED=1
      STRICT_POSTCHECK_STATUS="boundary_rejected"
      STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate staged-precheck deny temp file"
      return 1
    }
    for out_dir in "${STRICT_SCOPE_DENY_PATHS[@]}"; do
      [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$deny_file"
    done
  fi
  if [ -n "$deny_file" ]; then
    staged_out="$( "$SELF_DIR/check-disjointness.sh" validate --staged --repo "$WT" --no-default-deny --allow-file "$allow_file" --deny-file "$deny_file" 2>&1 )" && staged_rc=0 || staged_rc=$?
  else
    staged_out="$( "$SELF_DIR/check-disjointness.sh" validate --staged --repo "$WT" --no-default-deny --allow-file "$allow_file" 2>&1 )" && staged_rc=0 || staged_rc=$?
  fi
  rm -f "$allow_file"; [ -n "$deny_file" ] && rm -f "$deny_file"
  if [ "$staged_rc" -ne 0 ]; then
    local undeclared_touches deny_hits_json
    undeclared_touches="$(printf '%s' "$staged_out" | extract_json_value undeclared_touches 2>/dev/null || true)"
    deny_hits_json="$(printf '%s' "$staged_out" | extract_json_value denylist_hits 2>/dev/null || true)"
    if [ -n "$deny_hits_json" ] && [ "$deny_hits_json" != "null" ]; then
      temp_path="$(printf '%s' "$deny_hits_json" | json_array_first)"
    elif [ -n "$undeclared_touches" ] && [ "$undeclared_touches" != "null" ]; then
      temp_path="$(printf '%s' "$undeclared_touches" | json_array_first)"
    else
      temp_path=""
    fi
    STRICT_PRECOMMIT_REJECTED=1
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    if [ -n "$temp_path" ]; then
      STRICT_POSTCHECK_ERROR="boundary_rejected: staged path violates scope '${temp_path}' (pre-commit manifest gate; commit NOT created; unstage/remove the extra paths and rerun)"
    else
      STRICT_POSTCHECK_ERROR="boundary_rejected: staged paths violate scope (pre-commit manifest gate; commit NOT created); ${staged_out}"
    fi
    return 1
  fi
  return 0
}

run_strict_boundary_postcheck() {
  local allow_file deny_file boundary_out boundary_rc diff_total
  local -a changed_paths=()
  local -A changed_set=()
  local out_dir
  local temp_path
  local undeclared deny_hits

  if [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -eq 0 ] && [ "${#STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}" -eq 0 ]; then
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: missing scope allow paths"
    return 1
  fi

  allow_file="$(mktemp -t "hetero-strict-allow-XXXXXX")" || {
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate allow path temp file"
    return 1
  }
  for out_dir in "${STRICT_SCOPE_ALLOW_PATHS[@]}" "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
    [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$allow_file"
  done

  if [ "${#STRICT_SCOPE_DENY_PATHS[@]}" -gt 0 ]; then
    deny_file="$(mktemp -t "hetero-strict-deny-XXXXXX")" || {
      rm -f "$allow_file"
      STRICT_POSTCHECK_STATUS="boundary_rejected"
      STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate deny path temp file"
      return 1
    }
    for out_dir in "${STRICT_SCOPE_DENY_PATHS[@]}"; do
      [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$deny_file"
    done
  else
    deny_file=""
  fi

  if [ -n "$deny_file" ]; then
    if boundary_out="$( "$SELF_DIR/check-disjointness.sh" validate --range "$DIFF_BASE_SHA..$HEAD_SHA" --repo "$WT" --no-default-deny --allow-file "$allow_file" --deny-file "$deny_file" 2>&1 )"; then
      boundary_rc=0
    else
      boundary_rc=$?
    fi
  else
    if boundary_out="$( "$SELF_DIR/check-disjointness.sh" validate --range "$DIFF_BASE_SHA..$HEAD_SHA" --repo "$WT" --no-default-deny --allow-file "$allow_file" 2>&1 )"; then
      boundary_rc=0
    else
      boundary_rc=$?
    fi
  fi
  rm -f "$allow_file"
  [ -n "$deny_file" ] && rm -f "$deny_file"

  if [ "$boundary_rc" -ne 0 ]; then
    local undeclared_touches deny_hits_json
    undeclared_touches="$(printf '%s' "$boundary_out" | extract_json_value undeclared_touches 2>/dev/null || true)"
    deny_hits_json="$(printf '%s' "$boundary_out" | extract_json_value denylist_hits 2>/dev/null || true)"
    if [ -n "$deny_hits_json" ] && [ "$deny_hits_json" != "null" ]; then
      temp_path="$(printf '%s' "$deny_hits_json" | json_array_first)"
    elif [ -n "$undeclared_touches" ] && [ "$undeclared_touches" != "null" ]; then
      temp_path="$(printf '%s' "$undeclared_touches" | json_array_first)"
    else
      temp_path=""
    fi
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    if [ -n "$temp_path" ]; then
      STRICT_POSTCHECK_ERROR="boundary_rejected: changed path violates scope '${temp_path}'"
    else
      STRICT_POSTCHECK_ERROR="boundary_rejected: changed path violates scope (see diff below); ${boundary_out}"
    fi
    return 1
  fi

  # budget checks from shortstat to avoid re-parsing git output twice
  diff_total=$((INS + DEL))
  if [ "$FILES" -gt "$STRICT_SCOPE_MAX_FILES" ] || [ "$diff_total" -gt "$STRICT_SCOPE_MAX_DIFF_LINES" ]; then
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: budget exceeded (max_files=$STRICT_SCOPE_MAX_FILES, max_diff_lines=$STRICT_SCOPE_MAX_DIFF_LINES; files=$FILES, insertions+deletions=$diff_total)"
    return 1
  fi

  # Collect exact changed paths once for output-path role checks.
  while IFS= read -r temp_path; do
    [ -n "$temp_path" ] && changed_paths+=("$temp_path")
  done < <(_wt_git diff --ignore-submodules=none --name-only "$DIFF_BASE_SHA..$HEAD_SHA")

  for temp_path in "${changed_paths[@]}"; do
    changed_set["$temp_path"]=1
  done

  # Output-path roles:
  # - Unit contracts (legacy): output.paths are required deliverables — every listed
  #   path must appear in the candidate diff.
  # - Mission/campaign sealed authority: output.paths are the authorized create/modify
  #   surface. A narrow repair need not touch every authorized path; changed paths
  #   that are not authorized (and not generated mirrors) fail closed.
  # - required_change_paths: every listed path MUST appear in an effectful candidate
  #   diff. Digest-bound no-op (zero changed paths + sealed no-op proof) is the only
  #   exemption.
  if [ "${#STRICT_OUTPUT_PATHS[@]}" -gt 0 ]; then
    if [ "${CAMPAIGN_STRICT_AUTHORITY:-0}" -eq 1 ]; then
      local -A authorized_set=()
      for out_dir in "${STRICT_OUTPUT_PATHS[@]}"; do
        authorized_set["$out_dir"]=1
      done
      for out_dir in "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
        authorized_set["$out_dir"]=1
      done
      for temp_path in "${changed_paths[@]}"; do
        if [ -z "${authorized_set["$temp_path"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: changed path '$temp_path' is outside sealed output surface"
          return 1
        fi
      done
    else
      for out_dir in "${STRICT_OUTPUT_PATHS[@]}"; do
        if [ -z "${changed_set["$out_dir"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: output path '$out_dir' missing from changed files"
          return 1
        fi
      done
    fi
  fi

  if [ "${#STRICT_REQUIRED_CHANGE_PATHS[@]}" -gt 0 ]; then
    local effectful=1
    if [ "${#changed_paths[@]}" -eq 0 ]; then
      # Zero-change candidates require the sealed zero_diff_receipt embedded in
      # the dispatch-unit contract. Ambient STRICT_NOOP_RECEIPT_PATH is never
      # authority (caller-injectable env is rejected).
      if [ -n "${STRICT_NOOP_RECEIPT_PATH:-}" ]; then
        STRICT_POSTCHECK_STATUS="boundary_rejected"
        STRICT_POSTCHECK_ERROR="boundary_rejected: ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
        return 1
      fi
      local __noop_verify __noop_validator
      __noop_validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
      __noop_verify="$(
        node "$__noop_validator" validate \
          --contract "$CONTRACT_FILE" \
          --base "$DIFF_BASE_SHA" \
          --worktree "$WT" \
          --print-ok 2>/dev/null || true
      )"
      if [ "$__noop_verify" != "ok" ]; then
        STRICT_POSTCHECK_STATUS="boundary_rejected"
        STRICT_POSTCHECK_ERROR="boundary_rejected: no-op receipt failed verification (${__noop_verify:-missing})"
        return 1
      fi
      effectful=0
    fi
    if [ "$effectful" -eq 1 ]; then
      for req_path in "${STRICT_REQUIRED_CHANGE_PATHS[@]}"; do
        if [ -z "${changed_set["$req_path"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: required_change_path '$req_path' missing from candidate diff"
          return 1
        fi
      done
    fi
  fi

  STRICT_POSTCHECK_STATUS="ok"
  return 0
}

run_strict_contract_postchecks() {
  STRICT_POSTCHECK_ERROR=""
  STRICT_POSTCHECK_STATUS=""
  STRICT_POSTCHECK_OK=0

  if ! run_strict_boundary_postcheck; then
    return 1
  fi

  if ! run_strict_acceptance_checks; then
    return 1
  fi

  if ! run_strict_boundary_postcheck; then
    return 1
  fi

  STRICT_POSTCHECK_STATUS="ok"
  STRICT_POSTCHECK_OK=1
  return 0
}

# _hetero_runner_token — the single derivation of "which runner is this dispatch using"
# from the IS_CODEX/IS_GROK/IS_CCSHIM/IS_PI/IS_CURSOR/IS_OPENCODE/IS_KIMI/IS_QODER flags, shared by
# passive_capture and seat_strike_capture (factored out rather than copy-pasted, per repo
# convention).
_hetero_runner_token() {
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${LOCAL_RUNNER:-0}" -eq 1 ] && runner="local"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  [ "${IS_KIMI:-0}" -eq 1 ] && runner="kimi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CNATIVE:-0}" -eq 1 ] && runner="claude-native"
  printf '%s' "$runner"
}

# One stderr line per dispatch. The parent prints it when the guard arms (the
# detached child's stderr is discarded); the write sites call this too so an
# inline run that arms without the early print still speaks once.
_capability_write_note() {
  [ "${_CAPABILITY_WRITE_NOTE_DONE:-0}" = 1 ] && return 0
  _CAPABILITY_WRITE_NOTE_DONE=1
  echo "dispatch-hetero: not writing the capability store (test double runner binary without an isolated store). Set ENGINE_CAPABILITY_DIR or pass --store to isolate, or set AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE=1 to write the real store." >&2
}

# 0 when this call suppressed a real-store write. Sets the manifest field.
_capability_write_suppress_now() {
  [ "${CAPABILITY_WRITE_GUARD:-0}" = 1 ] || return 1
  CAPABILITY_WRITE_SUPPRESSED="test_double_without_isolated_store"
  _capability_write_note
  return 0
}

passive_capture() {
  local status="${1:-}"
  # Rail wall watchdog: not a runner/network failure — skip log classifier and capability writes.
  if [ "${WORKER_TIMED_OUT:-0}" -eq 1 ]; then
    CLASSIFIED_ERROR="timeout"
    return 0
  fi
  # Structured class was derived once before this call. Text classification
  # still runs for the quota side effect, then the structured class is put back
  # so a later branch cannot decide from prose.
  local _structured_class="" _ep_class=""
  case "${PROVIDER_ERROR_STATUS:-}" in
    429|503|529|402) _structured_class="${CLASSIFIED_ERROR:-}" ;;
  esac
  CLASSIFIED_ERROR=""
  if { [ "$status" = "no_op" ] || [ "$status" = "question_suspected" ] || [ "$status" = "failure" ] || [ "$status" = "dirty" ] || [ "$status" = "no_verdict" ]; } && [ -n "${LOG:-}" ] && [ -r "${LOG}" ]; then
    # Classify once, outside the recording subshell, so classify_outcome can reuse the result.
    CLASSIFIED_ERROR="$("$SELF_DIR/engine-capability-state.js" classify-error --file "$LOG" --exit-code "${AGENT_EXIT:-0}" 2>/dev/null)" || CLASSIFIED_ERROR=""
    # Endpoint runs: the endpoint_* class replaces rate_limited/overloaded/network_failed BEFORE the
    # quota-recording branch below, so a throttled or down local endpoint writes no capability row.
    _ep_class="$(_endpoint_error_class)"
    if [ -n "$_ep_class" ]; then CLASSIFIED_ERROR="$_ep_class"; _structured_class=""; fi
    if [ "$CLASSIFIED_ERROR" = "quota_exhausted" ] || [ "$CLASSIFIED_ERROR" = "rate_limited" ]; then
      if declare -F _capability_write_suppress_now >/dev/null 2>&1 && _capability_write_suppress_now; then
        write_manifest 2>/dev/null || true
        if [ -n "$_structured_class" ]; then CLASSIFIED_ERROR="$_structured_class"; else _prefer_structured_classified_error; fi
        return 0
      fi
    fi
    (
      if [ "$CLASSIFIED_ERROR" = "quota_exhausted" ] || [ "$CLASSIFIED_ERROR" = "rate_limited" ]; then
        local quota_status="unknown" confidence="low"
        case "$CLASSIFIED_ERROR" in
          quota_exhausted) quota_status="exhausted"; confidence="high" ;;
          rate_limited)    quota_status="limited"; confidence="medium" ;;
        esac
        local runner; runner="$(_hetero_runner_token)"
        local observed_at; observed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        # Exact effort/endpoint tuple — null endpoint means explicit no-endpoint wallet.
        local _ep_key="${ENDPOINT:-}"
        local payload
        payload="$(OBSERVED_AT="$observed_at" RUNNER="$runner" MODEL="$MODEL" STATUS="$quota_status" CONFIDENCE="$confidence" EFFORT="${EFFORT:-}" ENDPOINT_KEY="$_ep_key" node -e '
          const p = process.env;
          const endpoint = (p.ENDPOINT_KEY && p.ENDPOINT_KEY.length > 0) ? p.ENDPOINT_KEY : null;
          const payload = {
            schema_version: 1,
            observed_at: p.OBSERVED_AT,
            runner: p.RUNNER,
            model: p.MODEL,
            role: "implementer",
            effort: p.EFFORT || null,
            endpoint,
            runner_version: null,
            capability: {
              quota: {
                status: p.STATUS,
                reset_at: null,
                confidence: p.CONFIDENCE,
                evidence: "Passive capture from dispatch failure",
                ttl_seconds: 3600
              }
            }
          };
          console.log(JSON.stringify(payload));
        ')"
        local record_args=()
        if [ -n "${ENGINE_CAPABILITY_DIR:-}" ]; then
          record_args+=(--store "$ENGINE_CAPABILITY_DIR")
        fi
        echo "$payload" | node "$SELF_DIR/engine-capability-state.js" record "${record_args[@]}" >/dev/null 2>&1
      fi
    ) || true
  fi
  if [ -n "$_structured_class" ]; then
    CLASSIFIED_ERROR="$_structured_class"
  fi
}

# True when classify-error named a known engine-unavailability signal (not network/unknown).
# model_unsupported is intentionally absent: the login is fine and the caller picked a model
# this account cannot use. It stays on the ordinary failure/question_suspected status.
_is_engine_unavailable() {
  case "${1:-}" in
    quota_exhausted|rate_limited|auth_failed|overloaded|endpoint_busy|endpoint_unreachable) return 0 ;;
    *) return 1 ;;
  esac
}

# Detector identity for seat_strike_capture's strikes (references/strike-decay.md).
# Bump this literal whenever the classification logic below materially changes.
STRIKE_DETECTOR_VERSION="1"

# seat_strike_capture — the FIRST REAL PRODUCTION WRITER of seat-scoped no-confidence
# strikes (references/strike-decay.md, scripts/engine-capability-state.js `strike-seat`).
# Fires ONLY on a post-dispatcher_called fail-closed OUTCOME_STATUS: the pair was routed
# and did not deliver. Always fail-soft — never changes this script's own exit code,
# stdout bytes, or OUTCOME_* state (wrapped exactly like passive_capture: subshell,
# output to /dev/null, `|| true`).
#
# THE CLOSED EXCLUSION LIST — read this comment, don't trace control flow, to know what
# never strikes:
#   1. AUTOPILOT_STRIKE_WRITER=off          — operator escape hatch so debugging the rail
#                                             can never poison the store. Default is ON.
#   2. OUTCOME_DISPATCHER_CALLED = 0        — pre-dispatch host abort; nothing was routed.
#   3. OUTCOME_STATUS = engine_unavailable  — the closed external-cause enum in practice:
#                                             quota_exhausted | rate_limited | auth_failed |
#                                             overloaded, per _is_engine_unavailable().
#   4. OUTCOME_STATUS in {committed, no_op, question_suspected} — success, or not a
#                                             fail-closed delivery outcome.
# Everything else that reaches here with dispatcher_called=1 is strike-eligible.
#
# FINDING 6 fix (2026-08-22 review repair): exclusion #1 (AUTOPILOT_STRIKE_WRITER=off)
# is now evaluated LAST, after strike-eligibility (exclusions #2-#4) is already
# decided — so we know whether this run WOULD have struck before deciding whether the
# hatch suppresses it. A suppressed strike is never silent: STRIKE_WRITER_SUPPRESSED
# is set and write_manifest is called again so the run's manifest sidecar carries
# `strike_writer_suppressed: true` + the seat. This never touches OUTCOME_*, this
# script's stdout, or its exit code — same fail-soft contract as before.
seat_strike_capture() {
  [ "${OUTCOME_DISPATCHER_CALLED:-1}" -eq 0 ] && return 0

  local status="${OUTCOME_STATUS:-}"
  local cause_class=""
  # cause_class mapping — derived ONLY from the host's own classification of OUTCOME_STATUS,
  # never from anything the runner said about itself (ADR-0001). Diagnostic only; never
  # suppresses accrual (references/strike-decay.md § The seat is the pair).
  case "$status" in
    # strict-contract boundary/acceptance rejections: the host mechanically re-derived a
    # false predicate against what the engine produced — engine-attributable.
    acceptance_failed|boundary_rejected)
      cause_class="engine_output" ;;
    # an envelope/transport-shaped failure the host detected (unparseable result, not a
    # content judgment) — delivery is part of the pair's contract (strike-decay.md), so
    # this STILL ACCRUES; cause_class only steers remedy at threshold.
    no_verdict)
      cause_class="runner_delivery" ;;
    # generic fail-closed outcomes (nonzero exit, dirty tree) where the host cannot
    # mechanically attribute fault to engine vs runner from that signal alone.
    failure|dirty)
      cause_class="ambiguous" ;;
    # BLOCKER 3 fix (2026-08-22 review repair): OUTCOME_STATUS=engine_unavailable is set
    # in classify_outcome from CLASSIFIED_ERROR, which is classify-error's LOG-TEXT match
    # FIRST, exit code only as a fallback when text is unknown — i.e. it can be driven
    # entirely by prose the measured engine itself wrote to its own stdout. "A runner is
    # never trusted to label its own failure 'transport'" (strike-decay.md), so the STRIKE
    # EXCLUSION may not ride on that text-tainted classification. Re-derive independently
    # from the EXIT CODE ALONE (no --string/--file — engine-capability-state.js's
    # classify-error then exercises only its host-observed exit-code map, :2132-2143 as of
    # the review) and only honor the exclusion if THAT reclassification also names a
    # transport signal. A text-only "engine_unavailable" (ordinary host exit code) is not
    # host-corroborated, so it falls through and accrues, diagnostically ambiguous — this
    # changes only what the strike writer treats as excluded, never OUTCOME_STATUS/stdout.
    engine_unavailable)
      local __exit_only_class=""
      __exit_only_class="$("$SELF_DIR/engine-capability-state.js" classify-error --exit-code "${AGENT_EXIT:-0}" 2>/dev/null)" || __exit_only_class=""
      if _is_engine_unavailable "$__exit_only_class"; then
        return 0
      fi
      cause_class="ambiguous" ;;
    # everything else — committed / no_op / question_suspected / any status not in the
    # fail-closed set — is not a strike.
    *)
      return 0 ;;
  esac

  # A strike WOULD be written from this point on — every exclusion has already
  # returned. Only now does the debug hatch get to suppress it, and only LOUDLY:
  # set outside the write subshell (subshell vars don't survive back to this
  # function) so write_manifest can stamp the manifest sidecar before we return.
  local _strike_hatch=0
  if [ "${AUTOPILOT_STRIKE_WRITER:-on}" = "off" ]; then
    STRIKE_WRITER_SUPPRESSED="1"
    STRIKE_WRITER_SUPPRESSED_SEAT="$MODEL/$(_hetero_runner_token)/implementer"
    _strike_hatch=1
  fi
  # Same loud-suppression contract as the hatch: a skipped real-store write is
  # visible on the manifest and does not change OUTCOME_* or the exit code.
  # declare -F: the strike-writer suite extracts this function alone and
  # invokes it without the helper. A missing helper must not look like a suppress.
  if declare -F _capability_write_suppress_now >/dev/null 2>&1 && _capability_write_suppress_now; then
    _strike_hatch=1
  fi
  if [ "$_strike_hatch" = 1 ]; then
    write_manifest 2>/dev/null || true
    return 0
  fi

  (
    local runner; runner="$(_hetero_runner_token)"
    local artifact_sha=""
    if [ -n "${LOG:-}" ] && [ -r "${LOG:-}" ]; then
      artifact_sha="$(sha256sum "$LOG" 2>/dev/null | awk '{print $1}')"
    fi
    if [ -z "$artifact_sha" ]; then
      # $LOG unreadable — fall back to the sha256 of the outcome JSON (a real digest of
      # a real artifact, never a placeholder). Built directly from OUTCOME_* env vars —
      # deliberately NOT calling emit() here, which has real side effects (git-identity
      # restore) this fail-soft path must never trigger twice.
      local outcome_json
      outcome_json="$(OUTCOME_STATUS="${OUTCOME_STATUS:-}" OUTCOME_COMMIT="${OUTCOME_COMMIT:-}" \
        OUTCOME_FILES="${OUTCOME_FILES:-0}" OUTCOME_INS="${OUTCOME_INS:-0}" \
        OUTCOME_DEL="${OUTCOME_DEL:-0}" OUTCOME_WT="${OUTCOME_WT:-}" \
        OUTCOME_ERR="${OUTCOME_ERR:-}" node -e '
          const p = process.env;
          process.stdout.write(JSON.stringify({
            status: p.OUTCOME_STATUS, commit: p.OUTCOME_COMMIT,
            files: Number(p.OUTCOME_FILES), ins: Number(p.OUTCOME_INS), del: Number(p.OUTCOME_DEL),
            worktree: p.OUTCOME_WT, error: p.OUTCOME_ERR
          }));
        ' 2>/dev/null)" || outcome_json=""
      artifact_sha="$(printf '%s' "$outcome_json" | sha256sum 2>/dev/null | awk '{print $1}')"
    fi
    [ -z "$artifact_sha" ] && exit 0

    # dedup_key: frozen contract §2.7.2 — "<non-empty: root-incident id + detector id>".
    # Root-incident id (DISPATCH_RUN_ID is the caller-supplied --run-id when given — a
    # retry that reuses the same run-id collides on purpose — or else a per-process id
    # already unique by construction), bound to base/head sha + the outcome status, PLUS
    # the detector id (same value passed as --detector-id below) so the key composition
    # matches the contract literally, not just in spirit. No timestamp, no bare $$:
    # retrying the SAME root incident dedups; two genuinely different dispatches
    # (different run id and/or different shas) do not.
    local dedup_key="${DISPATCH_RUN_ID:-unknown}:${BASE_SHA:-unknown}:${HEAD_SHA:-unknown}:${status}:dispatch_hetero_classify_outcome"
    local receipt_ref="log=${LOG:-none} commit=${HEAD_SHA:-none}"

    local strike_args=(
      strike-seat
      --engine "$MODEL"
      --runner "$runner"
      --role implementer
      --class ordinary_strike
      --cause-class "$cause_class"
      --writer dispatch_hetero_failclosed
      --dedup-key "$dedup_key"
      --detector-id dispatch_hetero_classify_outcome
      --detector-version "${STRIKE_DETECTOR_VERSION:-1}"
      --artifact-sha256 "$artifact_sha"
      --receipt-ref "$receipt_ref"
    )
    if [ -n "${ENGINE_CAPABILITY_DIR:-}" ]; then
      strike_args+=(--store "$ENGINE_CAPABILITY_DIR")
    fi
    node "$SELF_DIR/engine-capability-state.js" "${strike_args[@]}" >/dev/null 2>&1
  ) || true
}

# classify_outcome — the SINGLE source of truth for status/exit/JSON-fields, shared by the
# inline path (→ emit to stdout + exit) and the detached child (→ write-result + ledger). It
# sets OUTCOME_* and performs the outcome-specific side effects (passive_capture; worktree
# removal on clean success) EXACTLY as the pre-R1 inline tree did — the existing hetero tests
# assert the resulting stdout/exit byte-for-byte, guarding this refactor.
classify_outcome() {
  run_target_precommit "$BASE_SHA" "$HEAD_SHA"
  OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"; OUTCOME_ERR=""; OUTCOME_EXIT=1
  OUTCOME_DISPATCHER_CALLED=1
  OUTCOME_MODEL_CALLS=1
  OUTCOME_MUTATION_ATTEMPTS=1
  OUTCOME_GATE_ATTEMPTS=0
  OUTCOME_RESOURCES_CREATED=1
  [ "${WORKTREE_REUSED:-0}" -eq 1 ] && OUTCOME_RESOURCES_CREATED=0
  OUTCOME_ZERO_DIFF_RECEIPT_DIGEST=""
  # Once, before any branch reads CLASSIFIED_ERROR. Worker exit is already
  # gated inside capture_structured_provider_error (non-zero only, never text).
  _prefer_structured_classified_error
  if ! wt_gitfile_check; then
    OUTCOME_STATUS="boundary_rejected"
    OUTCOME_ERR="boundary_rejected: $WT_GITFILE_ERROR"; OUTCOME_EXIT=1
  elif ! check_main_checkout_boundary; then
    passive_capture "boundary_rejected"
    OUTCOME_STATUS="boundary_rejected"
    OUTCOME_COMMIT=""; [ "$HEAD_SHA" != "$DIFF_BASE_SHA" ] && OUTCOME_COMMIT="$HEAD_SHA"
    OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
    OUTCOME_ERR="$HANDS_BOUNDARY_ERROR"; OUTCOME_EXIT=1
    # The main-checkout code wins, but the content verdict is still taken so a retained
    # candidate is never left unverified (round 6, 2026-09-13).
    if [ "$HEAD_SHA" != "$DIFF_BASE_SHA" ]; then
      _main_code="$HANDS_BOUNDARY_CODE"; _main_err="$OUTCOME_ERR"
      if ! run_hands_content_gate; then
        OUTCOME_ERR="${_main_err}; ALSO ${HANDS_BOUNDARY_ERROR}"
      fi
      HANDS_BOUNDARY_CODE="$_main_code"
    fi
  elif [ "$HEAD_SHA" != "$DIFF_BASE_SHA" ] && ! run_hands_content_gate; then
    # --- a new commit exists and its CONTENT is unsafe or unverifiable: authoritative on
    # every committed round, dirty or not, exit code or not (review, 2026-09-13). Precedence:
    # main-checkout mutation > unsafe content > dirty > non-zero exit > strict postchecks.
    passive_capture "boundary_rejected"
    OUTCOME_STATUS="boundary_rejected"
    OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
    OUTCOME_ERR="$HANDS_BOUNDARY_ERROR"; OUTCOME_EXIT=1
  elif [ "$HEAD_SHA" != "$DIFF_BASE_SHA" ]; then
    # --- a new commit exists ---
    if [ -n "$DIRTY" ]; then
      # committed but left the tree dirty → failure regardless of exit code
      passive_capture "dirty"
      OUTCOME_STATUS="dirty"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent committed but left uncommitted changes (agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
      # Text classification must not upgrade dirty. Only a harness-captured
      # provider status (PROVIDER_ERROR_STATUS) may. The clean-commit and
      # no-commit non-zero branches already upgraded from log text before
      # structured evidence existed; this branch did not.
      if [ "$AGENT_EXIT" -ne 0 ] && [ -n "${PROVIDER_ERROR_STATUS:-}" ] && _is_engine_unavailable "$CLASSIFIED_ERROR"; then
        OUTCOME_STATUS="engine_unavailable"
        OUTCOME_ERR="engine unavailable ($CLASSIFIED_ERROR): worker exited non-zero (agent exit $AGENT_EXIT); worktree kept"
      fi
    elif [ "$AGENT_EXIT" -ne 0 ] || [ "${WORKER_TIMED_OUT:-0}" -eq 1 ]; then
      # clean commit but the worker exited non-zero — NOT scored success (KR1):
      # the abnormal exit means the run can't be trusted as a clean implementation.
      # Prefer engine_unavailable when the log is a known quota/auth/overload signal.
      passive_capture "failure"
      OUTCOME_STATUS="failure"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent left a clean commit but exited non-zero (agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
      _prefer_structured_classified_error
      if _is_engine_unavailable "$CLASSIFIED_ERROR"; then
        OUTCOME_STATUS="engine_unavailable"
        OUTCOME_ERR="engine unavailable ($CLASSIFIED_ERROR): worker exited non-zero (agent exit $AGENT_EXIT); worktree kept"
      fi
    else
      if [ "$TARGET_PRECOMMIT_STATUS" = fail ] || [ "$TARGET_PRECOMMIT_STATUS" = timeout ]; then
        : # authoritative target-hook failure is applied after the remaining outcome overrides below
      elif ! run_hands_backlog_gate; then
        passive_capture "boundary_rejected"
        OUTCOME_STATUS="boundary_rejected"
        OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
        OUTCOME_ERR="$HANDS_BOUNDARY_ERROR"; OUTCOME_EXIT=1
      elif [ "$STRICT_CONTRACT" -eq 1 ] && ! run_strict_contract_postchecks; then
        # strict-mode post-return boundary and acceptance checks are authoritative.
        OUTCOME_STATUS="$STRICT_POSTCHECK_STATUS"
        OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
        OUTCOME_ERR="$STRICT_POSTCHECK_ERROR"
        OUTCOME_EXIT=1
      elif [ "$STRICT_CONTRACT" -ne 1 ] && ! run_tip_verify; then
        # Tip re-run failed or timed out. The commit stays; this is not done.
        OUTCOME_STATUS="verify_failed"
        OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
        OUTCOME_ERR="tip verification failed at $HEAD_SHA; commit kept for inspection; worktree kept"
        OUTCOME_EXIT=3
      else
        # new commit + clean tree + agent exit 0 + tip verify passed → the only success path
        if [ "$KEEP" = "0" ]; then
          # Full reap (project teardown_hook + remove). NEVER branch -D here — the
          # branch survives for review/merge. On remove failure: loud WARN +
          # OUTCOME_ORPHAN set; exit code unchanged (D4).
          OUTCOME_ORPHAN=""
          reap_worktree "$WT"
        fi
        OUTCOME_STATUS="committed"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"; OUTCOME_ERR=""; OUTCOME_EXIT=0
      fi
    fi
  else
    # --- no new commit: equality branch ---
    # Exact sealed zero_diff_receipt must be validated HERE (not only inside the
    # HEAD!=BASE strict postcheck path). Valid receipt → explicit successful
    # no-op with dispatcher_called:false semantics. Missing/forged/stale/foreign
    # receipt remains ordinary no_op/failure.
    if [ "${STRICT_PRECOMMIT_REJECTED:-0}" -eq 1 ]; then
      # Pre-commit manifest gate refusal (KR2): staged extras named, commit never
      # created, worktree kept staged for the cheap in-place repair (KR3 ladder
      # points here). Authoritative boundary_rejected, same family as postcheck.
      passive_capture "failure"
      OUTCOME_STATUS="boundary_rejected"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="$STRICT_POSTCHECK_ERROR"; OUTCOME_EXIT=1
    elif [ -n "$DIRTY" ]; then
      # edits exist but were never committed — e.g. the agy wrapper-commit above failed,
      # or the worker hand-edited without committing. Surface it (don't mis-score no_op).
      passive_capture "dirty"
      OUTCOME_STATUS="dirty"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="edits left uncommitted, no commit made (wrapper commit may have failed; agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
    elif [ "$AGENT_EXIT" -eq 0 ]; then
      local __eq_noop_status=""
      if [ "$STRICT_CONTRACT" -eq 1 ] && [ -n "${STRICT_NOOP_RECEIPT_PATH:-}" ]; then
        passive_capture "failure"
        OUTCOME_STATUS="failure"
        OUTCOME_COMMIT=""
        OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
        OUTCOME_EXIT=1
        __eq_noop_status="rejected"
      elif [ "$STRICT_CONTRACT" -eq 1 ] && [ -n "${CONTRACT_FILE:-}" ] && [ -r "${CONTRACT_FILE:-}" ]; then
        local __eq_noop_verify __eq_noop_validator
        __eq_noop_validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
        __eq_noop_verify="$(
          node "$__eq_noop_validator" validate \
            --contract "$CONTRACT_FILE" \
            --base "$DIFF_BASE_SHA" \
            --worktree "$WT" \
            --print-ok 2>/dev/null || true
        )" || __eq_noop_verify="verify_failed"
        if [ "$__eq_noop_verify" = "ok" ]; then
          __eq_noop_status="sealed_zero_diff"
        elif [ -n "$__eq_noop_verify" ] && [ "$__eq_noop_verify" != "missing_sealed_receipt" ]; then
          # Forged/stale/foreign sealed receipt is fail-closed, not soft no_op.
          passive_capture "failure"
          OUTCOME_STATUS="failure"
          OUTCOME_COMMIT=""
          OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
          OUTCOME_ERR="zero_diff_receipt rejected on equality branch: $__eq_noop_verify"
          OUTCOME_EXIT=1
          __eq_noop_status="rejected"
        fi
      fi
      if [ "$__eq_noop_status" = "sealed_zero_diff" ]; then
        # Explicit successful sealed no-op: zero model/mutation effects; dispatcher_called=false.
        passive_capture "no_op"
        OUTCOME_STATUS="no_op"
        OUTCOME_COMMIT=""
        OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="sealed zero_diff_receipt validated on equality branch (dispatcher_called=false)"
        OUTCOME_EXIT=0
        OUTCOME_DISPATCHER_CALLED=0
        OUTCOME_MODEL_CALLS=0
        OUTCOME_MUTATION_ATTEMPTS=0
        OUTCOME_GATE_ATTEMPTS=0
        OUTCOME_RESOURCES_CREATED=0
        OUTCOME_ZERO_DIFF_RECEIPT_DIGEST="$(
          extract_file_json_value "$CONTRACT_FILE" "output.zero_diff_receipt.digest" \
            2>/dev/null || true
        )"
      elif [ "$__eq_noop_status" != "rejected" ]; then
        # Ordinary no-op (no sealed receipt or not under strict contract)
        passive_capture "no_op"
        OUTCOME_STATUS="no_op"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="agent exited cleanly with no commit — judged nothing was needed (agent exit 0); worktree kept"; OUTCOME_EXIT=1
      fi
    else
      # timeout or non-zero exit, nothing committed → likely paused on a clarifying
      # question (auto-approve does not silence the model's own question) or stalled.
      # Prefer engine_unavailable when the log is a known quota/auth/overload signal
      # (closes the "402 misclassified as question_suspected" gap).
      passive_capture "question_suspected"
      OUTCOME_STATUS="question_suspected"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent produced no commit and ended abnormally (agent exit $AGENT_EXIT) — likely paused on a clarifying question or stalled; worktree kept"; OUTCOME_EXIT=1
      _prefer_structured_classified_error
      if _is_engine_unavailable "$CLASSIFIED_ERROR"; then
        OUTCOME_STATUS="engine_unavailable"
        OUTCOME_ERR="engine unavailable ($CLASSIFIED_ERROR): worker exited non-zero (agent exit $AGENT_EXIT); worktree kept"
      fi
    fi
  fi
  # Caller error, not an auth/quota escalation: name the model and cached alternatives.
  if [ "${CLASSIFIED_ERROR:-}" = "model_unsupported" ]; then
    _codex_cache_models="$(node "$SELF_DIR/lib/codex-models-cache.js" ids "${CODEX_HOME:-${HOME:-}/.codex}/models_cache.json" 2>/dev/null || true)"
    if [ -n "$_codex_cache_models" ]; then
      OUTCOME_ERR="codex model ${MODEL:-unknown} is not available for this account (models_cache: ${_codex_cache_models})"
    else
      OUTCOME_ERR="codex model ${MODEL:-unknown} is not available for this account (models_cache: unavailable)"
    fi
  fi
  if [ "${WORKER_TIMED_OUT:-0}" -eq 1 ]; then
    OUTCOME_STATUS="failure"
    OUTCOME_EXIT=1
    if [ "${WORKER_TIMEOUT_KIND:-}" = "hard" ]; then
      OUTCOME_ERR="hard timeout (${WATCHDOG_HARD_S:-0}s) exceeded — worker terminated"
    elif [ "${WORKER_TIMEOUT_KIND:-}" = "idle" ]; then
      OUTCOME_ERR="idle timeout (${WATCHDOG_IDLE_S:-0}s with no output or CPU) — worker terminated"
    else
      OUTCOME_ERR="wall timeout (${WATCHDOG_SOFT_S:-0}s) exceeded — worker terminated"
    fi
    CLASSIFIED_ERROR="timeout"
  fi
  # Do not default an empty verdict to done: that hid a missing verdict on exit 0.
  if [ -n "${BROKER_RUNNER:-}" ] && { [ "${AGENT_EXIT:-0}" -ne 0 ] || [ "${BROKER_VERDICT:-}" != done ]; }; then
    if [ "${WORKER_TIMED_OUT:-0}" -ne 1 ]; then
      _broker_unknown=0
      case "${BROKER_VERDICT_KIND:-}" in
        missing|unknown) _broker_unknown=1 ;;
      esac
      if [ -z "${BROKER_VERDICT_KIND:-}" ] && [ -z "${BROKER_VERDICT:-}" ]; then
        _broker_unknown=1
      fi
      _broker_keep_commit=0
      case "${OUTCOME_STATUS:-}" in
        committed|failure) _broker_keep_commit=1 ;;
      esac
      if [ "$_broker_unknown" -eq 1 ] && [ -n "${OUTCOME_COMMIT:-}" ] && [ "$_broker_keep_commit" -eq 1 ]; then
        OUTCOME_STATUS="committed"
        OUTCOME_EXIT=0
        OUTCOME_ERR=""
        BROKER_VERDICT_UNKNOWN="${BROKER_VERDICT:-}"
        BROKER_VERDICT_UNKNOWN_SET=1
      else
        OUTCOME_STATUS="failed"; OUTCOME_EXIT=1
        if [ -n "${BROKER_REASON:-}" ]; then
          OUTCOME_ERR="$BROKER_REASON"
        else
          OUTCOME_ERR="broker verdict=${BROKER_VERDICT:-} exit=${AGENT_EXIT:-0}"
        fi
        [ "${BROKER_VERDICT:-}" != stopped_billing ] || OUTCOME_ERR="${BROKER_RUNNER}_stopped_billing"
      fi
    fi
  fi
  if [ "$TARGET_PRECOMMIT_STATUS" = fail ] || [ "$TARGET_PRECOMMIT_STATUS" = timeout ]; then
    OUTCOME_STATUS="target_precommit_failed"
    OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
    OUTCOME_ERR="target pre-commit hook ${TARGET_PRECOMMIT_HOOK:-unknown} ${TARGET_PRECOMMIT_STATUS} (rc=${TARGET_PRECOMMIT_RC:-unknown}); captured commit kept for review"
    OUTCOME_EXIT=1
  fi
  # After engine_unavailable and wall-timeout overrides, so only a run that
  # stays question_suspected emits. Still before any terminal stage-transition.
  _emit_question_waiting_event || true
  # R1 retention record: every path that leaves the worktree on disk stamps its marker with
  # why and until when (residue.lease_hours, default 72 h) — repo-residue-sweep.js reap --auto
  # is the reaper that reads it. Still inside the lifetime flock (the lock fd is held for the
  # whole dispatch). An explicit --keep-worktree lease keeps its own expiry (helper no-ops).
  # Fail-soft: a failed stamp must never change the outcome.
  if [ -n "${WT:-}" ] && [ -d "$WT" ]; then
    local __ret_reason="$OUTCOME_STATUS"
    if [ "$OUTCOME_STATUS" = "boundary_rejected" ] && [ "${HANDS_BOUNDARY_CODE:-}" = "main_checkout_mutated" ]; then
      __ret_reason="main_checkout_mutated"
    elif [ "$OUTCOME_STATUS" = "committed" ]; then
      if [ "${IN_DETACHED_CHILD:-0}" = "1" ]; then __ret_reason="detach_keep"; else __ret_reason="reap_failed"; fi
    fi
    _wt_record_retention "$WT" "$__ret_reason" || true
  fi
  # Observability: stamp the manifest so post-mortem status reads phase:"exited" with the
  # final status even after processes/locks are gone (both inline and detached paths).
  release_local_lease
  manifest_finalize "$OUTCOME_STATUS"
  # Seat strike writer (P4, references/strike-decay.md) — fail-soft, never mutates
  # OUTCOME_* or this function's already-decided status/exit.
  seat_strike_capture
}

# _emit_question_waiting_event — side effect only. When classify_outcome has
# settled on question_suspected, record condition=waiting on the live stage so
# watch-foreman can print it. The stage-transition that closes a committed
# lease happens later; this must run first, while the latest stage row is
# still that lease. A write failure warns and never touches OUTCOME_* or exit.
# No resumed-run hook already knows the worker left the question, so a later
# working event is left to the existing heartbeat path.
_emit_question_waiting_event() {
  [ "${OUTCOME_STATUS:-}" = "question_suspected" ] || return 0
  [ -n "${LEDGER:-}" ] && [ -n "${RUN_ID:-}" ] && [ -n "${STAGE:-}" ] || return 0
  local latest_cond="" reason="" err=""
  latest_cond="$(jq -s -r --arg rid "$RUN_ID" --arg stg "$STAGE" '
    [ .[] | select(.kind=="worker_event" and .run_id==$rid and .stage==$stg) ]
    | if length==0 then "" else (.[-1].condition // "") end
  ' "$LEDGER" 2>/dev/null)" || latest_cond=""
  [ "$latest_cond" = "waiting" ] && return 0
  reason=""
  if [ -n "${LOG:-}" ] && [ -r "${LOG}" ]; then
    # LOG is the worker log. Last non-empty worker line (skip the rail's own
    # [dispatch-hetero: ...] footer), controls stripped, first 200 characters.
    reason="$(awk 'NF && $0 !~ /^\[dispatch-hetero:/ { line=$0 } END { print line }' "$LOG" | tr -d '[:cntrl:]' | jq -Rr '.[:200]')" || reason=""
  fi
  if ! err="$(bash "$SELF_DIR/run-ledger.sh" stage-event \
      --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
      --condition waiting --reason "$reason" 2>&1 >/dev/null)"; then
    printf 'dispatch-hetero: warning: waiting condition event was not recorded (%s)\n' "${err:-stage-event failed}" >&2
  fi
  return 0
}

# ============================ R1 DETACH (setsid kill-survival) ============================
# heartbeat_loop — periodic liveness beat to the ledger, keyed to the detached child's lease
# (generation/nonce/pid). Immediate first beat, then every HEARTBEAT_SECS. Runs backgrounded
# inside the detached child and is killed once the worker completes.
heartbeat_loop() {
  local run_ledger="$SELF_DIR/run-ledger.sh"
  while :; do
    bash "$run_ledger" stage-heartbeat --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
      --generation "$DETACH_GEN" --nonce "$DETACH_NONCE" --pid "$DETACH_SELF_PID" >/dev/null 2>&1 || true
    sleep "${HEARTBEAT_SECS:-20}"
  done
}

# detached_main — runs INSIDE the setsid session (sourced state + functions via declare). It owns
# the full lifecycle so a killed caller loses nothing: acquire lease → heartbeat → run engine →
# wrapper-commit + verify → write outcome JSON atomically to RESULT_FILE → record committed stage.
detached_main() {
  set -uo pipefail
  IN_DETACHED_CHILD=1
  local run_ledger="$SELF_DIR/run-ledger.sh"
  # Keep the worktree in detach mode: it is the git-truth a `resume` uses to adopt the work,
  # and the orchestrator (not this leaf) owns its later cleanup.
  KEEP=1
  local packed_prompt_for_child="${PACKED_PROMPT_TEMP:-}"
  local campaign_prompt_for_child="${CAMPAIGN_PROMPT_FILE:-}"
  # Decouple from the caller's prompt temp lifecycle: copy it into a child-owned file so the
  # parent's EXIT cleanup cannot yank it mid-run.
  local child_prompt="$RESULTS_DIR/${RUN_ID}.${STAGE}.prompt"
  if cp -f "$PROMPT_FILE" "$child_prompt" 2>/dev/null; then PROMPT_FILE="$child_prompt"; fi
  # Acquire the lease AS THIS detached process (records our pid/start_time → the watchdog can
  # tell alive-vs-dead). --allow-reopen so an orchestrator pre-lease is renewed, not rejected.
  DETACH_SELF_PID="$$"
  local acq
  if ! acq="$(bash "$run_ledger" stage-transfer \
    --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
    --generation "$DETACH_PRECLAIM_GEN" --nonce "$DETACH_PRECLAIM_NONCE" \
    --pid "$DETACH_SELF_PID" --git-ref "refs/heads/$BRANCH" \
    --worktree "$WT" 2>/dev/null)"; then
    exit 2
  fi
  DETACH_GEN="$(printf '%s' "$acq" | jq -r '.generation // empty' 2>/dev/null || true)"
  DETACH_NONCE="$(printf '%s' "$acq" | jq -r '.nonce // empty' 2>/dev/null || true)"
  if [ -z "$DETACH_GEN" ] || [ -z "$DETACH_NONCE" ]; then
    exit 2
  fi
  # WO owner/runner/lease → this detached child (parent claim already cleared).
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ]; then
    node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$(pwd)" \
      --root-run-id "$_CONT_WO_CLAIMED_ROOT" --graph-node "${_CONT_WO_CLAIMED_STAGE:-implement}" \
      --attempt 1 --owner-pid "$$" --runner self --transfer-owner >/dev/null 2>&1 || exit 2
  fi
  write_manifest "$DETACH_SELF_PID"
  local hb_pid=""
  heartbeat_loop &
  hb_pid=$!
  # run the engine worker (in-session), then finalize by artifact
  run_agent
  capture_scratch_files || { AGENT_EXIT=1; }
  [ -n "$hb_pid" ] && { kill "$hb_pid" 2>/dev/null || true; wait "$hb_pid" 2>/dev/null || true; }
  compute_artifacts
  classify_outcome
  # Detached child owns continuation WO terminalization; parent must not mark stale failed.
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ]; then
    if ! _cont_finalize_or_die; then
      OUTCOME_STATUS="failure"
      OUTCOME_ERR="work order terminal finalizer failed closed"
      OUTCOME_EXIT=1
    fi
  fi
  # Build the SAME outcome JSON the inline path would print, and land it atomically.
  local json; json="$(emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR")"
  local payload_tmp="$RESULT_FILE.payload.$$"
  printf '%s' "$json" > "$payload_tmp"
  bash "$run_ledger" write-result --path "$RESULT_FILE" --payload-file "$payload_tmp" >/dev/null 2>&1 || true
  rm -f "$payload_tmp"
  # exit-code sidecar (atomic) so the supervising parent relays the SAME exit code
  printf '%s' "$OUTCOME_EXIT" > "$EXIT_FILE.tmp.$$" && mv "$EXIT_FILE.tmp.$$" "$EXIT_FILE"
  # Record the committed stage so the work is recoverable via `run-ledger resume` (git-truth).
  if [ "$OUTCOME_STATUS" = "committed" ] && [ -n "$DETACH_GEN" ] && [ -n "$DETACH_NONCE" ]; then
    bash "$run_ledger" stage-transition --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
      --generation "$DETACH_GEN" --nonce "$DETACH_NONCE" --to-state committed \
      --git-sha "$OUTCOME_COMMIT" --worktree "$WT" >/dev/null 2>&1 || true
  fi
  rm -f "$child_prompt" 2>/dev/null || true
  [ -n "$packed_prompt_for_child" ] && rm -f "$packed_prompt_for_child" 2>/dev/null || true
  [ -n "$campaign_prompt_for_child" ] && rm -f "$campaign_prompt_for_child" 2>/dev/null || true
  [ -n "${AGY_ENVELOPE:-}" ] && rm -f "$AGY_ENVELOPE" 2>/dev/null || true
  [ -n "${AGY_STDERR:-}" ] && rm -f "$AGY_STDERR" 2>/dev/null || true
  [ -n "${AGY_PARSED:-}" ] && rm -f "$AGY_PARSED" 2>/dev/null || true
  [ -n "${CCSHIM_ENVELOPE:-}" ] && rm -f "$CCSHIM_ENVELOPE" 2>/dev/null || true
  [ -n "${SCRATCH_DIR:-}" ] && rm -rf -- "$SCRATCH_DIR"
  SCRATCH_DIR=""
  [ -n "${SCRATCH_CONFIG_DIR:-}" ] && rm -rf -- "$SCRATCH_CONFIG_DIR"
  SCRATCH_CONFIG_DIR=""
  [ -n "${SCRATCH_HOME:-}" ] && rm -rf -- "$SCRATCH_HOME"
  SCRATCH_HOME=""
  exit "$OUTCOME_EXIT"
}

# dispatch_detached_run — the PARENT side. Serializes state+functions, launches detached_main in a
# NEW SESSION (setsid) so a killed caller cannot take the worker down, then blocks-and-relays the
# SAME stdout JSON + exit code as the inline path (transparent normal case). NEVER returns.
dispatch_detached_run() {
  mkdir -p "$RESULTS_DIR"
  rm -f "$RESULT_FILE" "$EXIT_FILE"
  local state_file; state_file="$(mktemp -t hetero-detach-state-XXXXXX)"
  {
  declare -p MODEL BASE TIMEOUT AGY_BIN GROK_BIN CODEX_BIN CURSOR_BIN OPENCODE_BIN OPENCODE_VER KIMI_BIN QODER_BIN QODER_CONFIG_DIR KEEP RETENTION_OWNER RETENTION_REASON RETENTION_REASON_SHA256 RETENTION_EXPIRES_AT REUSE_WORKTREE RESUME_SESSION_ID PROVIDER_SESSION_ID PROVIDER_SESSION_REUSED WORKTREE_REUSED BRANCH PROMPT_FILE RUNNER ENDPOINT PACE_ROLE ENGINE_CHOICE_JSON PACE_CHOICE_JSON ENGINE_PREFLIGHT_JSON SHED_ROUTE_JSON SHED_ROUTE_MANIFEST_JSON SHED_ROUTE_TARGET EFFORT CLAUDE_EFFORT_ARG \
      SELF_DIR IS_CODEX IS_GROK IS_CCSHIM IS_PI IS_CURSOR IS_OPENCODE IS_KIMI IS_QODER IS_CNATIVE CNATIVE_CONFIG_DIR RUNNER_RESOLVED CURSOR_FAST PI_BIN MANAGED_CODEX_HOME CONTAINMENT CONTAINED IDENTITY_DRIFT IDENTITY_PRE_NAME IDENTITY_PRE_EMAIL IDENTITY_REPO_ROOT GITCONFIG_SNAPSHOT_FILE GITCONFIG_DRIFT_KEYS EFFECTIVE_SKILL_MODE SKILLS_INJECTED_JSON \
      BROKER_TIMEOUT_S BROKER_RESULT BROKER_VERDICT BROKER_REASON BROKER_VERDICT_KIND BROKER_VERDICT_UNKNOWN BROKER_VERDICT_UNKNOWN_SET BROKER_RUNNER BIN_FLAG_KIMI \
      WT LOG BASE_SHA DIFF_BASE_SHA HAVE_CGROUP HAVE_SETSID SCOPE_UNIT WORKER_SID WORKER_FALLBACK_PGID GROK_PROMPT_FILE EFFORT_SENT CCSHIM_PROMPT_FILE OPENCODE_PROMPT_FILE KIMI_PROMPT_FILE QODER_PROMPT_FILE KIMI_EDIT_ONLY \
      AGY_ENVELOPE AGY_STDERR AGY_PARSED AGY_USAGE_JSON CCSHIM_ENVELOPE \
      PROVIDER_ERROR_RUNNER PROVIDER_ERROR_STATUS PROVIDER_ERROR_FIELD \
      PACKED_PROMPT_TEMP LEDGER RUN_ID STAGE RESULTS_DIR RESULT_FILE EXIT_FILE HEARTBEAT_SECS \
      STRICT_CONTRACT STRICT_CONTRACT_RESULT_FIELDS STRICT_UNIT_ID STRICT_CONTRACT_SHA STRICT_SPEC_SHA STRICT_GO STRICT_ENGINE_ASSURANCE CONSUMING_REPO_ROOT CONTRACT_FILE_SUPPLIED CONTRACT_FILE \
      CAMPAIGN_CONTRACT_SHA256 CAMPAIGN_ID CAMPAIGN_MISSION_MODE CAMPAIGN_STRICT_AUTHORITY CAMPAIGN_PROJECTION_BOUND NO_CAMPAIGN MISSION_ENFORCEMENT_MODE_SEEN \
      OUTCOME_STATUS OUTCOME_COMMIT OUTCOME_FILES OUTCOME_INS OUTCOME_DEL OUTCOME_WT OUTCOME_ERR OUTCOME_EXIT \
      TARGET_PRECOMMIT_STATUS TARGET_PRECOMMIT_HOOK TARGET_PRECOMMIT_RC TARGET_PRECOMMIT_TAIL \
      OUTCOME_DISPATCHER_CALLED OUTCOME_MODEL_CALLS OUTCOME_MUTATION_ATTEMPTS OUTCOME_GATE_ATTEMPTS OUTCOME_RESOURCES_CREATED OUTCOME_ZERO_DIFF_RECEIPT_DIGEST \
      CLASSIFIED_ERROR \
      ORPHAN_LOG OUTCOME_ORPHAN WT_LOCK_FD LINEAGE_PARENT LINEAGE_ROOT LINEAGE_JOB_ROOT WORKTREE_ROOT_RUN_ID LINEAGE_DEPTH HETERO_FLEET_TASK_ID \
      STRICT_SCOPE_ALLOW_PATHS STRICT_SCOPE_DENY_PATHS STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS STRICT_SCOPE_MAX_FILES STRICT_SCOPE_MAX_DIFF_LINES STRICT_OUTPUT_PATHS STRICT_REQUIRED_CHANGE_PATHS STRICT_POSTCHECK_OK STRICT_POSTCHECK_STATUS STRICT_POSTCHECK_ERROR \
      DISPATCH_RUN_ID DISPATCH_STARTED_EPOCH MANIFEST_DIR_PATH MANIFEST_FILE MANIFEST_CONTAINMENT \
      LOCAL_LEASE_ID LOCAL_LEASE_URL LOCAL_LEASE_TOKEN_ENV LOCAL_LEASE_STATUS LOCAL_LEASE_GRANTED LOCAL_LEASE_RELEASED LOCAL_LEASE_RELEASE_ATTEMPTED LOCAL_LEASE_DETAIL LOCAL_LEASE_HEARTBEATS LOCAL_LEASE_HEARTBEAT_PID LOCAL_LEASE_HEARTBEAT_FILE \
      MANIFEST_SCOPE_UNIT MANIFEST_MOUNT_CONTAINMENT WORKER_MOUNT_MODE WORKER_MOUNT_PREFIX MANIFEST_PID_RECORDED MANIFEST_ENDED_AT MANIFEST_ENDED_EPOCH MANIFEST_FINAL_STATUS \
      TIMEOUT_SOURCE TIMEOUT_SUPPLIED WORKER_TIMED_OUT IDLE_TIMEOUT IDLE_TIMEOUT_SUPPLIED HARD_TIMEOUT HARD_TIMEOUT_SUPPLIED WATCHDOG_IDLE_S WATCHDOG_HARD_S WATCHDOG_SAMPLE_S WATCHDOG_SOFT_S WORKER_TIMEOUT_KIND KILLED_ELAPSED_S KILLED_LAST_PROGRESS_S COMMIT_QUIET_SECS COMMIT_QUIET_ENDED REPO_IDENTITY_FIELDS _REPO_IDENTITY_FIELDS_KEY CHILD_SESSION_ID 2>/dev/null
    declare -p NO_VERIFY_TIP VERIFY_TIMEOUT TIP_VERIFY_SKIP TIP_VERIFY_SOURCE TIP_VERIFY_CMDS_JSON TIP_VERIFY_RESULT_JSON VERIFY_CMDS 2>/dev/null || true
    # Hands boundary gates (item (E)): the pre-hands main-checkout fingerprint MUST cross the
    # detach boundary as the parent measured it, and the push-blocking env with it.
    declare -p MAIN_CHECKOUT MAIN_CHECKOUT_BEFORE MAIN_CHECKOUT_BEFORE_PARTS HANDS_GIT_ENV HANDS_BOUNDARY_ERROR HANDS_BOUNDARY_CODE 2>/dev/null || true
    # The after-fingerprint in the detached child must use the same scope and the same
    # sibling namespaces the parent's before-fingerprint did. Without the scope, the child
    # measures every ref and every detached round rejects (fleet 01M788GD).
    declare -p MAIN_CHECKOUT_FP_REF_SCOPE 2>/dev/null || true
    declare -p MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES 2>/dev/null || true
    declare -p MAIN_CHECKOUT_FP_EXCLUDE_PATHS 2>/dev/null || true
    declare -p WRAPPER_COMMITTED 2>/dev/null || true
    declare -p SCRATCH SCRATCH_DIR SCRATCH_WORK_DIR SCRATCH_REJECTED_FILE SCRATCH_FINAL_PROMPT SCRATCH_HOME SCRATCH_CONFIG_DIR SCRATCH_FILES WORKER_CWD 2>/dev/null || true
    declare -p DETACH_PRECLAIM_GEN DETACH_PRECLAIM_NONCE 2>/dev/null
    declare -p _CONT_WO_CLAIMED_ROOT _CONT_WO_CLAIMED_STAGE _CONT_WO_PARENT_TRANSFERRED 2>/dev/null
    declare -p CAMPAIGN_PROMPT_FILE 2>/dev/null
    declare -p GATE_RULES_FILE 2>/dev/null || true
    declare -p WT_GITFILE_EXPECTED WT_GITFILE_ERROR 2>/dev/null || true
    declare -p SANDBOX SANDBOX_ARGV SANDBOX_TMP SANDBOX_TMP_PATH SANDBOX_WT_PATH SANDBOX_DENIED SANDBOX_BLOCKED SANDBOX_BLOCKED_SAMPLES SANDBOX_FAIL WORKTREE_PARENT FELL_BACK_JSON FELL_BACK_LOGGED LOCAL_RUNNER GATEWAY_TOKEN_SOURCE 2>/dev/null || true
    declare -p ROLE_KIT_DIR ROLE_KIT_ACTIVE ROLE_KIT_TOOLS ROLE_KIT_EXTRA ROLE_KIT_ARGV ROLE_KIT_JSON 2>/dev/null || true
    declare -p ENGINE_CAPABILITY_DIR 2>/dev/null || true
    declare -p CAPABILITY_WRITE_GUARD CAPABILITY_WRITE_SUPPRESSED _CAPABILITY_WRITE_NOTE_DONE 2>/dev/null || true
    # Preserve pi supervisor poll/stall bounds across setsid detach.
    declare -p PI_RPC_DIRECTIVE_POLL_SECS PI_RPC_STALL_PROBE_SECS PI_RPC_MAX_SECS PI_RPC_PROVIDER PI_MODELS_JSON 2>/dev/null || true
    declare -p STRIKE_DETECTOR_VERSION EVIDENCE_PACK_FILE AUTOPILOT_EVIDENCE_NOTES EVIDENCE_PACK_WRITTEN 2>/dev/null || true
    declare -f wt_gitfile_check _wt_git target_precommit_setting target_precommit_json run_target_precommit 2>/dev/null || true
    declare -f current_runner_name sandbox_preflight sandbox_nested_repo sandbox_setup sandbox_teardown sandbox_count_denied sandbox_count_blocked sandbox_json reap_cnative_config_dir reap_sandbox_config_dir codeforge_collect_claude_dir 2>/dev/null || true
    # token_seat_guard (lib/token-seat.sh) is called inside run_agent's claude branches; without it the
    # detached child dies with "command not found" before the claude worker starts.
    declare -f token_seat_guard 2>/dev/null || true
    declare -f agy_print_timeout agy_assert_disposable_home die_precondition fell_back_json_suffix hetero_log_fallback child_session_env_setup repo_identity_of _repo_identity_json_str repo_identity_resolve_fields manifest_session_id_json manifest_child_session_json child_session_mint json_escape _flat_json_escape extract_json_value json_array_first emit grok_effort_live_enum grok_effort_clamp grok_effort_note reap_container prepare_managed_codex_home cleanup_managed_codex_home _self_pgid _watchdog_sleeppid_cmdline_has_tag _cancel_worker_watchdog _setsid_wait_worker_sid _watchdog_worker_alive _watchdog_signal_worker _hetero_resolve_watch_limits _watchdog_sleep_sample _watchdog_progress_sample _watchdog_fire _arm_worker_watchdog _worker_has_busy_descendant _supervise_commit_quiet _hetero_registry_start _hetero_registry_end _wait_worker_with_watchdog _verify_no_setsid_watchdog_or_disarm normalize_timeout_seconds run_worker run_agent compute_artifacts capture_structured_provider_error _prefer_structured_classified_error passive_capture \
      _is_engine_unavailable _hetero_runner_token _capability_write_note _capability_write_suppress_now seat_strike_capture classify_outcome _emit_question_waiting_event heartbeat_loop detached_main seal_runner_prompt_bytes write_manifest manifest_finalize run_strict_contract_postchecks run_strict_boundary_postcheck run_strict_staged_precheck run_strict_acceptance_checks resolve_tip_verify_commands run_tip_verify _fp_unverifiable main_checkout_fingerprint main_checkout_parts_digest main_checkout_describe_delta main_checkout_wt_symlink_leaks check_main_checkout_boundary run_hands_content_gate run_hands_backlog_gate run_hands_backlog_reconcile_gate \
      capture_scratch_files _cont_terminal_on_exit _cont_finalize_or_die \
      reap_worktree reap_worktree_minimal _wt_append_orphan_path _wt_open_lock_fd _wt_ensure_config _wt_validate_path _wt_git_worktree_remove \
      _wt_has_control_chars _wt_resolve_repo_root _wt_read_marker_created_at _wt_json_escape _wt_is_live \
      _wt_read_schema2_marker _wt_record_retention _wt_residue_lease_hours \
      _wt_removal_log_script _wt_check_live_or_log_skip _wt_log_removal 2>/dev/null || true
  } > "$state_file"
  # In detach mode the DETACHED child owns the worktree/branch lifecycle. A caller signal must
  # NOT reap the worktree out from under it — replace the reaping trap with a bare exit.
  trap 'exit 143' INT TERM
  # Prevent the top-level EXIT cleanup from deleting the prompt temp under a detached child.
  # The detached child now owns and removes this prompt copy.
  unset PACKED_PROMPT_TEMP
  unset CAMPAIGN_PROMPT_FILE
  # Transfer continuation WO ownership to detached child: parent must NOT mark WO failed on EXIT
  # with a stale empty OUTCOME (child serializes/updates its own terminal state).
  _CONT_WO_PARENT_TRANSFERRED=1
  # The child removes the state file right after sourcing (before the long run) so a caller-kill
  # of the parent — which skips the parent's own cleanup below — cannot leak it.
  # Preserve WT_LOCK_FD across setsid/execve via POSIX fd 9, then re-dup to a CLOEXEC shell fd
  # inside detached_main's shell so the lifetime flock stays held until detached_main exits
  # without leaking into worker subprocesses.
  if [ -n "${WT_LOCK_FD:-}" ]; then
    setsid bash -c 'IN_DETACHED_CHILD=1; source "$1"; exec {_wt_detached_fd}>&9 && exec 9>&- && WT_LOCK_FD="$_wt_detached_fd"; rm -f "$1"; detached_main' bash "$state_file" 9>&"$WT_LOCK_FD" >/dev/null 2>&1 &
  else
    setsid bash -c 'IN_DETACHED_CHILD=1; source "$1"; rm -f "$1"; detached_main' bash "$state_file" >/dev/null 2>&1 &
  fi
  local child=$!
  # The detached child owns scratch until it has captured and committed the output.
  SCRATCH_DIR=""
  SCRATCH_CONFIG_DIR=""
  SCRATCH_HOME=""
  # Clear parent claim after child is launched so parent EXIT cleanup cannot fail-mark the WO.
  _CONT_WO_CLAIMED_ROOT=""
  wait "$child"; local wait_rc=$?
  # Reaching here means the caller was NOT killed → relay the durable result transparently.
  local out_rc="$wait_rc"
  if [ -f "$EXIT_FILE" ]; then out_rc="$(cat "$EXIT_FILE" 2>/dev/null || echo "$wait_rc")"; fi
  if [ -f "$RESULT_FILE" ]; then
    _lease_released="$(node -e 'try { const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(o.local_lease && o.local_lease.released ? "1" : "0"); } catch {}' "$RESULT_FILE" 2>/dev/null || true)"
    if [ "$_lease_released" = "1" ]; then
      LOCAL_LEASE_RELEASED=1
      LOCAL_LEASE_RELEASE_ATTEMPTED=1
    fi
    unset _lease_released
    if [ "${IMPLICIT_LOCAL_DEFAULT:-0}" = "1" ] && [ "${LOCAL_BUSY_REDISPATCH:-}" != "1" ]; then
      _busy_retry="$(node -e 'let o; try { o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); } catch { o={}; } process.stdout.write(o.status==="engine_unavailable" && o.error_category==="endpoint_busy" ? "1" : "0");' "$RESULT_FILE" 2>/dev/null || true)"
      if [ "$_busy_retry" = "1" ]; then
        CLASSIFIED_ERROR="endpoint_busy"
        maybe_redispatch_cloud_busy engine_unavailable
      fi
    fi
    cat "$RESULT_FILE"; printf '\n'
  else
    emit "failure" "" 0 0 0 "$WT" "detached worker produced no result file (run-id=$RUN_ID stage=$STAGE)"
    out_rc=1
  fi
  rm -f "$state_file"
  exit "$out_rc"
}

# ---- dispatch decision ----
# Detach is ON by default; DISPATCH_DETACH=0 (or false/no/off) forces the legacy inline path.
detach_on() {
  case "${DISPATCH_DETACH:-1}" in
    0|false|FALSE|no|NO|off|OFF|No|Off) return 1 ;;
    *) return 0 ;;
  esac
}
# --- observability manifest (pre-dispatch; predicted containment) ---
# Written BEFORE the worker starts so the run is locatable from second zero. The
# scope-unit prediction matches run_worker's inline naming ("hetero-<branch>-$$.scope");
# in detach mode the child runs in-session (setsid), no scope exists.
if detach_on && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ] && [ "${HAVE_SETSID:-0}" -eq 1 ]; then
  MANIFEST_CONTAINMENT="setsid-detached"
elif [ "$HAVE_CGROUP" -eq 1 ]; then
  MANIFEST_CONTAINMENT="cgroup"
  MANIFEST_SCOPE_UNIT="hetero-${BRANCH//\//-}-$$.scope"
elif [ "$HAVE_SETSID" -eq 1 ]; then
  MANIFEST_CONTAINMENT="setsid"
else
  MANIFEST_CONTAINMENT="plain"
fi
MANIFEST_MOUNT_CONTAINMENT="$(worker_mount_manifest_value)"
write_manifest "$$"
# --- strict pre-flight: every acceptance argv must at least be EXECUTABLE ---
# run_strict_acceptance_checks() spawns these AFTER the runner has been paid for, and
# spawnSync does NOT throw on ENOENT/EACCES (it returns status=null with .error set), so a
# typo'd or missing command surfaces there as a generic "exit-code mismatch" — an expensive
# way to learn about a typo. Executability is decidable at base, for free.
#
# Deliberately NOT gated on exit codes: red-at-base is the expected shape for a TDD unit
# and green-at-base is legitimate for a regression guard, so only "cannot execute at all"
# is fatal here.
if [ "$STRICT_CONTRACT" -eq 1 ]; then
  preflight_err="$(node -e '
const fs = require("fs");
const path = require("path");
let contract;
try {
  contract = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch (err) {
  process.stdout.write("");
  process.exit(0);   // schema problems are the checker s job, not this pre-flight s
}
const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
const cwd = process.argv[2] || process.cwd();
function executableStatus(command) {
  const candidates = command.includes(path.sep)
    ? [path.isAbsolute(command) ? command : path.resolve(cwd, command)]
    : (process.env.PATH || "").split(path.delimiter).filter(Boolean)
      .map((dir) => path.join(dir, command));
  let sawPermissionError = false;
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      if ((stat.mode & 0o111) !== 0) return null;
      sawPermissionError = true;
    } catch (err) {
      if (err && err.code === "EACCES") sawPermissionError = true;
    }
  }
  return sawPermissionError ? "EACCES" : "ENOENT";
}
for (let i = 0; i < acceptance.length; i++) {
  const argv = Array.isArray(acceptance[i] && acceptance[i].argv) ? acceptance[i].argv : [];
  if (!argv.length) continue;
  const errorCode = executableStatus(argv[0]);
  if (errorCode) {
    process.stdout.write("acceptance command #" + (i + 1) + " is not executable (" + errorCode + "): " + argv[0]);
    process.exit(0);
  }
}
process.stdout.write("");
  ' "$CONTRACT_FILE" "$WT" 2>/dev/null || true)"
  if [ -n "$preflight_err" ]; then
    die_precondition "$preflight_err"
  fi
fi

# dispatch_usage/1 start row (status running; the finished row from emit replaces it for the reader; never affects the result).
node "$SELF_DIR/lib/dispatch-usage.js" start --role "${AUTOPILOT_DISPATCH_ROLE:-implementer}" \
  --run-id "${DISPATCH_RUN_ID:-}" --parent-run-id "${LINEAGE_PARENT:-}" --root-run-id "${LINEAGE_ROOT:-}" \
  --started-at "${DISPATCH_STARTED_EPOCH:-}" --runner "$(current_runner_name)" --model "${MODEL:-}" --endpoint "${ENDPOINT:-}" \
  --provider-session-id "${PROVIDER_SESSION_ID:-${CHILD_SESSION_ID:-}}" || true
if [ -n "${HETERO_FLEET_TASK_ID:-}" ]; then
  node "$SELF_DIR/lib/fleet-task-ref.js" progress "$HETERO_FLEET_TASK_ID" \
    "[dispatch:${AUTOPILOT_DISPATCH_ROLE:-implementer}] ${DISPATCH_RUN_ID:-unknown} start" >/dev/null 2>&1 || true
fi
[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: run_id=${DISPATCH_RUN_ID} manifest=${MANIFEST_FILE:-none} log=${LOG} (watch: scripts/dispatch-status.js --run ${DISPATCH_RUN_ID})" >&2
if detach_on && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ] && [ "${HAVE_SETSID:-0}" -eq 1 ]; then
  RESULTS_DIR="${LEDGER}.results"
  RESULT_FILE="$RESULTS_DIR/${RUN_ID}.${STAGE}.result.json"
  EXIT_FILE="$RESULTS_DIR/${RUN_ID}.${STAGE}.exit"
  EVIDENCE_PACK_FILE="$RESULTS_DIR/${RUN_ID}.${STAGE}.evidence-pack.json"
  export AUTOPILOT_EVIDENCE_NOTES="$RESULTS_DIR/${RUN_ID}.${STAGE}.evidence-notes.md"
  dispatch_detached_run   # never returns
fi

# ---- inline path (DISPATCH_DETACH=0 OR no ledger coords): byte-identical to pre-R1 behavior ----
_ep_dir="${AUTOPILOT_DISPATCH_RUNS_DIR:-${MANIFEST_DIR_PATH:-${SCRATCH_DIR:-${WORKTREE_PARENT:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}}}}}"
mkdir -p "$_ep_dir" 2>/dev/null || true
EVIDENCE_PACK_FILE="$_ep_dir/${DISPATCH_RUN_ID:-$$}.evidence-pack.json"
export AUTOPILOT_EVIDENCE_NOTES="$_ep_dir/${DISPATCH_RUN_ID:-$$}.evidence-notes.md"
run_agent
capture_scratch_files || { AGENT_EXIT=1; }
[ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
[ -n "${CAMPAIGN_PROMPT_FILE:-}" ] && rm -f "$CAMPAIGN_PROMPT_FILE"
trap - INT TERM
compute_artifacts
classify_outcome
# Terminal finalizer before success JSON — never emit success with a nonterminal claimed WO.
if ! _cont_finalize_or_die; then
  OUTCOME_STATUS="failure"
  OUTCOME_ERR="work order terminal finalizer failed closed"
  OUTCOME_EXIT=1
  emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR"
  exit 1
fi
emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR"
[ -z "${HETERO_FLEET_TASK_ID:-}" ] || node "$SELF_DIR/lib/dispatch-strike.js" --task "$HETERO_FLEET_TASK_ID" >&2 || true
maybe_redispatch_cloud_busy "$OUTCOME_STATUS"
if [ -n "$RC_ALARM_LABEL" ]; then
  _rc_alarm_rc="$OUTCOME_EXIT"
  case "$OUTCOME_STATUS" in committed|no_op) ;; *) [ "$_rc_alarm_rc" -ne 0 ] || _rc_alarm_rc=1 ;; esac
  _rc_alarm_args=(record --label "$RC_ALARM_LABEL" --rc "$_rc_alarm_rc" --last-line "${OUTCOME_ERR:-}")
  [ -z "$RC_ALARM_OWNER" ] || _rc_alarm_args+=(--owner "$RC_ALARM_OWNER")
  node "$SELF_DIR/rc-alarm.js" "${_rc_alarm_args[@]}" || echo "dispatch-hetero: rc-alarm record failed" >&2
fi
exit "$OUTCOME_EXIT"
