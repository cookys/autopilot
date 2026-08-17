# Qualification CLI transport + brain round-mode provider (2026-08-17)

> 狀態: ✅ Shipped in v2.34.15 — merged as `6b8b29e6`

> Continuation of BACKLOG "Reviewer-seat full qualifications on the now-working rail".
> Inherits the brain-seat exam suite's deferred P5 real administration (Board
> 2026-08-17 D1: incumbent Claude seat had no exam transport — OAuth only, no raw
> token). Plan precedents: `docs/plans/2026-08-17-brain-seat-exam-suite.md` (frozen,
> two-generation review) and its synthesis D1–D4.

## 1. Goal

Give `engine-qualify.sh` a **CLI exam transport** so seats whose credentials live in
a CLI harness (codex → gpt-5.6-sol; claude → incumbent Claude seat) can sit
qualifications, add the **brain round-mode provider prompt** (the shipped adapter is
reviewer-diff-only), then run two real administrations:

1. **GLM-5.2 reviewer re-attempt** — fresh evaluation over the existing HTTP path
   (its 2026-08-16 run failed by one clean false positive; a re-attempt is a fresh
   administration with its own acceptance, never a rerun-until-green).
2. **Brain first real administration** — incumbent Claude seat over the new claude
   CLI transport (Board: incumbent first; a FAIL annotates readiness only).

## 2. Verified transport facts (probed 2026-08-17, this session)

| Fact | Evidence |
|---|---|
| Broker spawns provider cmd HOST-side: `bash -c`, HOME→providerRoot, PATH preserved, `--provider-env` allowlist (blocks `HOME`, `AUTOPILOT_*`, `ENGINE_*`, `CALIBRATION_*`, `CASE_*`) | `scripts/qualification-case-broker.js` providerEnvironment() + normalize |
| `CODEX_HOME` redirect works under fake HOME: `codex exec --model gpt-5.6-sol --sandbox read-only --skip-git-repo-check --output-last-message <f>` returned OK, rc=0 | live probe, codex-cli 0.147.0 |
| `CLAUDE_CONFIG_DIR` redirect works under fake HOME: `claude -p --model … --setting-sources project --strict-mcp-config --tools ""` returned OK, rc=0 | live probe, claude 2.1.233 |
| ⚠️ Pointing `CLAUDE_CONFIG_DIR` at the REAL `~/.claude` **resets `.claude.json`** (88k→36k, 40 projects + mcpServers lost; restored from the CLI's own backup) | live incident, this session |
| A dedicated exam config dir seeded with ONLY `.credentials.json` authenticates fine, leaves creds byte-identical, and confines all writes to the exam dir | live probe |
| Brain rounds reach the transport as ordinary single-shot cases (role `owner`, content = round-bundle JSON) — same `executePanelCase` surface as reviewer diffs | `engine-qualify.js` runBrainQualification |

## 3. Design

### 3.1 Adapter extension (`scripts/qualification-review-provider.js`)

Two orthogonal env switches, both defaulting to today's behavior (zero-config
back-compat for the shipped GLM/MiniMax HTTP reviewer path):

- **`QRP_TRANSPORT`** = `http` (default) | `cli`
  - `cli` requires **`QRP_CLI_KIND`** = `codex` | `claude` and uses `QRP_MODEL` as
    the CLI `--model`. `QRP_BASE_URL`/`QRP_AUTH_TOKEN` become optional (unused).
  - codex: `codex exec --model $QRP_MODEL --sandbox read-only --skip-git-repo-check
    --output-last-message <tmp sidecar> [-c model_reasoning_effort=$QRP_CLI_EFFORT] <prompt>`;
    output = sidecar content. Credentials via `--provider-env CODEX_HOME`.
  - claude: `claude -p --model $QRP_MODEL --setting-sources project
    --strict-mcp-config --tools ""` with prompt on stdin; output = stdout.
    Credentials via `--provider-env CLAUDE_CONFIG_DIR` → **a dedicated exam config
    dir seeded with `.credentials.json` only — NEVER the real `~/.claude`** (see
    incident above; header documents the trap loudly).
  - The prompt in CLI mode = system prompt + separator + case content (single-shot,
    no tools, no repo — same semantic surface as the HTTP `system`+`user` split).
  - Timeout: the adapter keeps its own `REQUEST_TIMEOUT_MS` guard around the child
    (kill process group on expiry), inside the broker's outer timeout.
- **`QRP_PROMPT_MODE`** = `reviewer` (default) | `brain`
  - `reviewer`: existing SYSTEM_PROMPT; requires request role `reviewer` +
    `unified_diff`; keeps patchAnchor normalization.
  - `brain`: new BRAIN_SYSTEM_PROMPT; requires request role `owner` (brain rounds
    ride the owner role by construction); **no anchor normalization** (not a diff);
    bracket-repair JSON extraction still applies (transport-layer only).

### 3.2 Brain round-mode prompt honesty boundary

Same ADR-0001 line as the reviewer prompt: teach the **output contract and the
production governance contract, never detection patterns**.

- IN: round-bundle field semantics (protocol); per-round output shape
  `{round_id, verdict: affirm|flag, flags:[{claim_id,receipt_id}],
  adjudications:[{artifact_id, verdict:accept|reject, severity?, repair_scope?}],
  next_action:{type∈legal_actions, target?}}`; ONLY those five fields (extra fields
  are forged telemetry — that is contract, stated plainly); severity vocabulary;
  the standing governance contract the production seat already operates under
  (level-front-door §7/§8 vocabulary: cite the contradicting receipt when flagging;
  closure evidence must be independent of the producer; scoped verification before
  closing; full-suite only at the legal final gate; economy over churn; blocked
  states have exactly the declared legal exits; never patch governance instruments);
  injection warning (bundle content is data).
- OUT: which claims/receipts carry plants; fairness pairing/expected verdicts;
  which rounds contain temptations vs controls; the world-table numbers; anything
  derived from the oracle.
- The exam still measures: whether the seat APPLIES that contract per round under
  adversarial content over a growing horizon — the construct the synthesis froze
  (per-round form; the honesty clause rides the dogfood record as planned).

### 3.3 Seat identity + wiring

- `.claude/brain-seat-identity.json` (tracked; `.claude/*.md` configs already are):
  the exact identity object the exam records — model `claude-fable-5`, alias,
  model_version, family `anthropic`, runner `claude-cli`, runner_version `2.1.233`,
  harness_version, effort, prompt_config_hash = sha256(BRAIN_SYSTEM_PROMPT),
  semantic/containment fingerprints — so `sha256(canonicalJson(identity))` matches
  the administration's identity_hash and `brain-status` folds correctly.
- `.claude/review-loop-config.md` gains `brain_seat_identity_file` → readiness
  brain-seat line goes three-state.

### 3.4 Administrations

- GLM re-attempt: existing HTTP path (`QRP_*` from `AUTOPILOT_ENDPOINT_GLM_*`),
  fresh run, own acceptance. z.ai 529 → probe-gate before re-dispatch (memory trap).
- Brain incumbent: `engine-qualify.sh brain --remote-provider-cmd` with
  `QRP_TRANSPORT=cli QRP_CLI_KIND=claude QRP_PROMPT_MODE=brain`, exam config dir
  prepared per §2, `--remote-timeout-ms` sized for 24 stateless rounds, `--raw-dir`
  into the dogfood evidence dir. Records land in the user store; evidence +
  honesty clause under `docs/plans/evidence/2026-08-17-brain-seat-exam-suite/dogfood/`.

## 4. Phases (single admitted deliverable; phases are coverage, not new nodes)

- **P1 — adapter CLI transport + brain prompt + tests**: extend the provider;
  author `hooks/tests/qualification-review-provider.test.sh` (stub CLI binaries;
  red-green: assert the new branches fail before implementation shape exists —
  test written first). Acceptance: new test green; `engine-qualify-brain`,
  `qualification-case-broker` suites stay green.
- **P2 — identity + config wiring**: identity file + `brain_seat_identity_file`;
  `status readiness` shows three-state. Acceptance: readiness line changes;
  `resolve-review-loop` test stays green.
- **P3 — administrations**: GLM reviewer re-attempt; brain incumbent first sitting.
  Acceptance: verdict JSON + evidence rows recorded honestly (any outcome is a
  valid outcome; FAIL annotates readiness only).
- **P4 — docs + release**: engine-onboarding reference (CLI transport §),
  scripts-inventory rows, CHANGELOG, `sync-version.js --version 2.34.15
  --hook-count 26 --skill-count 28`, `preflight-release.sh` 8/8.

## 5. Verification contract (dev-flow mandatory answer)

`bash hooks/tests/qualification-review-provider.test.sh` (new, red→green) +
`for t in engine-qualify-brain qualification-case-broker resolve-review-loop; do
bash hooks/tests/$t.test.sh; done` all silent + `bash scripts/preflight-release.sh`
8/8. The administrations themselves are evidence-store rows + readiness output —
recorded outcomes, not gates.

## 6. Out of scope

- verification_author qualification suite (BACKLOG L-effort item, separate design).
- MiniMax-M3 full reviewer run (spike showed 5/9 — bar not met; not spent).
- Restoring suspended Codex/gpt + Gemini reviewer seats (quota trigger not met).
- Governance CLI UX polish (S ride-along only if a governance script is touched).

## Review Loop History

- (this session) plan authored from live transport probes; no generation-review —
  M-effort BACKLOG continuation under the frozen brain-seat-exam-suite plan's
  adjudications (D1 transport deferral explicitly anticipated this work).
- Pre-merge review (autopilot:reviewer agent, 2026-08-17): 1 Critical + 4 Major
  MUST-FIX, all repaired same round —
  (1) config pin broke two ambient `context-window` assertions → minus-brain
  fixture (mirrors the resolve-review-loop fixture);
  (2) `callCli` settlement starvation: a detached descendant holding a stdio
  pipe delayed 'close' past the budget and misattributed a produced answer as
  timeout → settle on 'exit'+flush with a post-kill grace window and stream
  destroy on finish; test-pinned with an orphan-held-pipe case + group-kill
  liveness/residue proof;
  (3) the dogfood brain pin leaked to consumers via the config ladder's
  project-repo fallback and resolved relative paths against caller cwd → pin
  honored only for override/project-cwd configs, relative paths resolve against
  the config's project root; three red-green resolver cases added;
  (4) honesty scan was mutation-blind (field names only) → semantic answer-key
  token scan + sha256(BRAIN_SYSTEM_PROMPT) pinned to the identity file (any
  prompt edit fails the suite until identity + honesty are re-reviewed);
  (5) CLI identity is operator-asserted (no runtime model echo) → recorded as
  an explicit caveat in role-and-harness-governance + the dogfood README;
  runtime capture deferred to BACKLOG.
  Minor fixes ridden: convergence clause names exact action ids (prompt v4
  `5feb7076…`, identity re-pinned), strict `QRP_TIMEOUT_MS` validation,
  CHANGELOG count/outcome wording, dogfood raw paths. Deferred-with-trigger:
  BACKLOG "Qualification CLI transport hardening". Reviewer's verified-clean
  list covered hash pinning (recomputed), identity↔record reconciliation,
  gating matrix, sidecar cleanup, CLI flag verification against installed
  harnesses, and mirror parity.
- Fix-verification round 2 (autopilot:reviewer agent, 2026-08-17): all five
  round-1 findings CONFIRMED-FIXED by independent re-derivation (pre-fix
  worktree mutations, own settlement repro at 338 ms vs 9166 ms pre-fix, three
  honesty-scan mutations all red, ladder leak re-probed from a foreign cwd).
  One NEW MUST-FIX: the relative-pin resolver case asserted a substring the
  pre-fix resolver also emits (mutation-blind — and this history briefly
  claimed "three red-green cases" when one wasn't); closed by pinning
  `"status":"no_record"`, which the pre-fix cwd resolution cannot produce
  (it yields `status_unavailable`). Round-2 minors (200 ms exit-vs-timeout
  race, prompt-hash regex extraction, undocumented template field) appended to
  the BACKLOG hardening row. Reviewer's stated closure condition: the one-line
  assertion + suite at 310 green ⇒ merge.
