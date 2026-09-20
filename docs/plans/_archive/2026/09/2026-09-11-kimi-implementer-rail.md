# `--runner kimi` implementer rail (dispatch-hetero) — so the operator's named seat runs

**Date**: 2026-09-11 · **Size**: L (new runner across the same 5 modules as opencode) · **Branch**: `feat/kimi-implementer-rail` off `develop` (`e60d6f66`)
**logical_plan_id**: `autopilot-kimi-implementer-rail-2026-09-11`
**Trigger**: the operator named `kimi-code/k3` as the implementer for fleet-comms on 2026-09-08
(`.claude/model-routing-config.md`, "Operator's call"), and today a `/l5` degraded to l3 because
that seat was never wired — `dispatch-hetero.sh` has reviewer and author rails for kimi but no
implementer rail, and `resolve-dispatch.sh` cannot spell a namespaced alias. The operator's
standing rule: qualification is for *recommending* when they have not chosen; when they have,
the job is to make the environment run it. This plan is that job.

## 0. Stage-0 spike (2026-09-11, kimi 0.41.0, this box)

| Gate | Result |
|---|---|
| G0 credential | `kimi -m kimi-code/k3 -p 'reply with exactly: OK'` → `OK` (config.toml aliases: `k3`, `k3-256k`, `kimi-for-coding`, `kimi-for-coding-highspeed`; `k3-256k` headless returns **nothing**, `k3` answers — measured 2026-09-08 and again today) |
| G1 single op | in a scratch git repo, plain `kimi -m kimi-code/k3 -p '<create hello2.txt …>'` → file created with exact content, **not committed**, exit 0 |
| permission modes | `-p` **cannot** be combined with `--auto` or `-y` (`error: Cannot combine --prompt with --auto`); plain `-p` already edits files, so no flag is needed |
| long command | `sleep 25 && echo slow-ok-9931` run by the model completed and was echoed verbatim (wall 50 s) — no agy-style foreground cap |
| prompt transport | argv only (`-p <string>`); no stdin, no `--prompt-file` (`-p ''` rejected, `-p -` literal — same as the review rail found, v2.36.14). **Linux MAX_ARG_STRLEN 131072** is the wall; fail closed pre-spend above `KIMI_ARGV_LIMIT` exactly as `dispatch-review.sh:1138-1146` does |
| cwd | process cwd (`cd "$WT" && kimi …`); `--add-dir` exists but is not needed |
| usage/telemetry | `--output-format stream-json` emits `system.version`, `assistant` content, `session.resume_hint` — **no token usage**; `log_format: plain`, `usage: null` (same as opencode) |
| effort | no effort flag; the seat's effort label is nominal (same as cc-shim/opencode) |

## 1. Problem

A user who has named `kimi-code/k3` as implementer gets `precondition_failed` from `/l5` — not
because kimi cannot do the work (G1 says it can) but because the harness has no rail and the
routing table cannot even spell the alias. The tool built to speed the operator up is refusing
the operator's own choice.

## 2. KRs

- **KR1** `dispatch-hetero.sh --runner kimi --model kimi-code/k3 --base <sha> …` on a scratch repo returns `committed` with the edit in the wrapper commit and `runner: "kimi"`, `model: "kimi-code/k3"` in the envelope. *(new test with a stub `kimi` binary + one real dispatch in evidence)*
- **KR2** `resolve-dispatch.sh` accepts `kimi-code/k3` in a `| tree:<role> | kimi-code/k3 | default |` row (a single `/` between two `[A-Za-z0-9._-]+` tokens) and still rejects everything else it rejects today; the BACKLOG entry "resolve-dispatch.sh cannot express a namespaced model alias" closes. *(test)*
- **KR3** `resolve-review-loop.sh --field implementer_runner` accepts `kimi`; `engine implement-review` reaches `dispatch-hetero.sh --runner kimi` without a `precondition_failed`. *(enum test + the fleet-comms config flip in evidence)*
- **KR4** A prompt above `KIMI_ARGV_LIMIT` fails closed **pre-spend** (no worktree, no runner) with the same shape as the review rail's message. *(test)*
- **KR5** `auto` never selects kimi (a `provider/alias` id has no family match); `--runner kimi` is explicit-only. *(test)*
- **KR6** Full suite: no test that was green on `develop` goes red (the 4 host-environment reds recorded on 2026-09-11 stay as they are; they are not this plan's).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- The rail is grok/qoderclicn/opencode-shaped: EDIT-ONLY directive prepended to the prompt, `cd "$WT" && exec "$KIMI_BIN" -m "$MODEL" -p "<directive+prompt>"`, wrapper commits, verdict from git artifacts. No `--auto`, no `-y` (they cannot combine with `-p`).
- Prompt travels as ONE argv string; bytes are measured before spawn and `die_precondition` fires above `KIMI_ARGV_LIMIT` (default 120000, env-overridable like the review rail's). Never truncate, never split silently.
- `--runner kimi` is EXPLICIT-only; `auto` must not route to it. `--kimi-bin` is the test seam. `log_format: plain`, `usage: null`.
- Every place a runner token lives is updated in the same change: `dispatch-hetero.sh` (flags, `IS_KIMI`, labels, enum, precondition, cleanup, detach `declare -p`), `scripts/lib/runner-binary.js`, `scripts/engine-qualify.js` `implRunnerBinFlag`, `src/engine/implementer-ladder.js`, `scripts/resolve-review-loop.sh` implementer_runner enum. Reviewer/author rails are untouched (they already have kimi).
- `resolve-dispatch.sh`'s token grammar becomes `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$` — one optional slash-separated namespace, nothing more; the value is passed verbatim to `--model`.
- Mirrors under `platforms/codex/plugin/` are re-synced (`scripts/sync-codex-plugin-skills.sh`); the pre-commit ritual enforces it.
- No test touches process-global state; stub binaries live in the test's temp dir and are passed via `--kimi-bin`.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — a new runner token and a widened (superset) alias grammar; no existing invocation changes shape.
- **Dependency decision**: `none` — kimi CLI is already installed and authenticated on this host; the rail spawns it.

## 3. File-structure map

| Path | Responsibility |
|---|---|
| `scripts/dispatch-hetero.sh` | `--kimi-bin` flag (default `kimi`), `IS_KIMI` flag + `kimi)` enum arm (explicit-only, comment states why), binary precondition, the run arm (directive + argv-size gate + `run_worker bash -c 'cd "$1" && exec "$2" -m "$3" -p "$4"'`), runner labels in every `runner=` derivation, `declare -p` export list |
| `scripts/lib/runner-binary.js` | `kimi: 'kimi'` |
| `scripts/engine-qualify.js` | `case 'kimi': return '--kimi-bin'` |
| `src/engine/implementer-ladder.js` | `kimi` accepted as a rung's runner |
| `scripts/resolve-review-loop.sh` | `implementer_runner` enum gains `kimi` (line ~770 already lists it for other roles — confirm and align) |
| `scripts/resolve-dispatch.sh` | `valid_token` accepts one `/` (KR2); comment names the grammar |
| `hooks/tests/dispatch-kimi.test.sh` | new — stub `kimi` binary: records argv, honours `-m`/`-p`, writes a file → `committed`; no-edit → `no_op`; nonzero → `failure`; oversize prompt → `precondition_failed` pre-spend; `auto` does not select kimi; EDIT-ONLY directive present in the recorded `-p` |
| `hooks/tests/resolve-dispatch*.test.sh` | KR2 cases: `kimi-code/k3` accepted, `a/b/c` and `/x` and `x/` rejected |
| `docs/BACKLOG.md` | close "resolve-dispatch.sh cannot express a namespaced model alias" |
| `docs/plans/evidence/2026-09-11-kimi-rail/` | real dispatch transcript (KR1) + the fleet-comms config flip (KR3) |
| `~/projects/fleet-comms/.claude/review-loop-config.md` | separate repo, separate commit: `implementer_engine: kimi-code/k3`, `implementer_runner: kimi`, `implementer_effort: high` (nominal), with the 2026-09-08 operator note |

## 4. Phases

### P1 — the rail *(L)*
Steps in §3, dispatch-hetero first, then the four registration files, then the test. Acceptance: `bash hooks/tests/dispatch-kimi.test.sh` green; the touched existing suites green (`resolve-dispatch*`, `resolve-review-loop*`, `runner-binary`, `implementer-ladder`, `engine-qualify` if it has a runner-flag table test).

### P2 — alias grammar + BACKLOG *(S)*
`resolve-dispatch.sh` grammar + tests; BACKLOG entry closed with a pointer.

### P3 — real dispatch + fleet-comms seat flip *(S)*
`dispatch-hetero.sh --runner kimi --model kimi-code/k3 --base HEAD …` against a scratch repo with a one-file task → `committed`; transcript into evidence. Then fleet-comms `review-loop-config.md` flipped; `resolve-review-loop.sh --field implementer_runner` from that repo prints `kimi`.

## 5. Test / validation
Script-gated: the new test file + the touched suites + `preflight-release.sh` if a version bump is cut. Human-gated: the real dispatch (a model edits a file); recorded as executed commands + git artifacts, never as the model's own report.

## 6. Risks + inversion

| Would guarantee failure | Mitigation |
|---|---|
| The model commits despite the directive | wrapper-commit rail tolerates it the way grok's does (verdict from artifacts, not from who committed) — assert in test with a stub that commits |
| Prompt > 128 KiB reaches `execve` and fails opaquely (rc 126) | pre-spend byte gate, same as the review rail |
| `auto` starts picking kimi for `kimi-*` model names | explicit test that `auto` with `kimi-code/k3` dies with the existing "pass --runner" refusal shape |
| The slash grammar lets `a/b/c` or path-like values through to argv | regex allows exactly one slash; negative tests |

## 7. Out of scope
kimi usage parsing (stream-json has none today); `--add-dir`; kimi as plan-review deep seat (already possible); qualifying kimi on the scorecard (the operator chose it; a later `engine-onboarding` may record an exam, optional).

## 8. Open questions
None.

## Review log
- **R0** — authored 2026-09-11 by depth-0 (this session) after the stage-0 spike.
