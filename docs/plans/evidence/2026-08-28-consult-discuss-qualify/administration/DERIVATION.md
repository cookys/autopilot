# Administration bundle — derivations, identity, readiness (2026-08-29)

Companion to `../PROPOSAL.md`. That document recommends seats and proves the
`--plan` rail runs end-to-end for free; **this** bundle assembles the actual
`node scripts/engine-qualify.js consult|discuss ... --execute` argv per
Board-authorized seat and proves each one's `--plan` smoke passes. **No
`--execute` has been run by anyone producing this bundle — no money has been
spent.** Every `run.sh` defaults to `plan` and requires the literal argument
`execute` to attempt a paid call; two of the seven (seats 5, 8) additionally
self-refuse `execute` before it could ever reach the network (see § Seat
readiness below).

## Layout

```
administration/
  DERIVATION.md              this file
  derive-hashes.js           reproduces the three identity fingerprints below
  seat<N>-<slug>/run.sh      full argv for that seat (plan default, execute gated)
  seat<N>-<slug>/plan-out.json   captured --plan stdout (real, run 2026-08-29)
  seat<N>-<slug>/raw/        empty — populated only by a real --execute run
```

Seat numbering follows the Board decision list in `../PROPOSAL.md` §"Board
decision — 2026-08-28 (authorization)"; seat 7 (kimi) is deferred (quota) and
has no directory here.

## Identity fingerprint derivations

Recipe (per the cursor bundle's "Frozen corpus identity" convention,
`docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/README.md`
lines 60-66, adapted to consult/discuss's own corpus/generator/transport):

- `prompt_config_hash` = `sha256(corpus JSON bytes ‖ generator source bytes)`
  — `evals/<role>-capability-evidence-corpus.json` concatenated with
  `evals/<role>-eval-generator.js`, for `role` in `{consult, discuss}`.
- `semantic_fingerprint` = `sha256(canonicalJson({corpus_version, families,
  thresholds, canary_closure}))` — `corpus_version`/`families`/`thresholds`
  read directly from the corpus manifest's own fields; `canary_closure` is
  the D3 negative-control admission marker (see below), recorded as the
  literal string `"negative_control_admission_failed:true"` — that boolean
  being `true` in a real `--plan` case-plan output is what proves the
  corpus's built-in negative control was CAUGHT (not overfit).
- `containment_fingerprint` = `sha256` of `scripts/qualification-review-provider.js`'s
  file bytes — the transport blob every `--remote-provider-cmd` seat in this
  bundle runs through. **Not** `git rev-parse :path` — a git blob id is
  SHA-1 (40 hex chars) and does not satisfy engine-qualify.js's
  `--containment-fingerprint` validator (`/^[a-f0-9]{64}$/`, i.e. SHA-256
  only). Plain `sha256sum` of the file is used instead; this is the
  "sha256 of the transport blob" alternative the task explicitly allows.

### Reproduce

```
node docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/derive-hashes.js
```

### Values (re-derived 2026-08-29, after the depth-0 consult/discuss
disclosure fix — see below)

| Role | `prompt_config_hash` | `semantic_fingerprint` |
|---|---|---|
| consult | `2ff3fe6ab3a13154fc1a316c0ba05445e730d068d9f96d0529701ff542a55204` | `da6e86f5aa8d132470badc7e2db0cc91b4429be427492e84ed518b88e85e6161` |
| discuss | `fb843a7adee3dd3d8a937af8117053e2d48d571523216d72ef7ae6da937adb49` | `c934ce0412bd0497951db5981ae00847745160f01fb954f7eebcd71c1d8bb5ba` |

`containment_fingerprint` (shared, both roles — same transport file):
`441227738a06e9214c72bbadbb238aa349b42b964b923da2d7a90904d55d4cf4`

`--harness-version qrp:44122773` used in every run.sh is this same
`containment_fingerprint`'s first 8 hex chars, prefixed `qrp:` (the transport
identifier convention `dispatch-hetero:<short-blob>` uses elsewhere, adapted
for the `qualification-review-provider.js` transport since these seats never
go through `dispatch-hetero.sh`).

**Why these values changed (2026-08-29)**: the first live administration
(the `plan-out.json`/`raw/consult-exchanges.jsonl` files under each seat
directory below) failed 56/56 across every administered seat because of
three exam-design defects, root-caused and fixed the same day: (A) the
consult candidate envelope omitted `closed_label_set` while every oracle
label is a prefixed token the candidate could not otherwise derive
(`scripts/engine-qualify.js` `buildConsultCaseEnvelope`); (B) C2 required
echoing a fabricated `missing_artifact_id` the candidate never saw
(`evals/consult-eval-generator.js` `buildC2`, `evals/consult-eval-grader.js`
`falseConfidence`); (C) the discuss envelope had the same undisclosed-
vocabulary defect for its declared axis/claim-vector set
(`buildDiscussCaseEnvelope`). Both corpus manifests' `corpus_version` moved
to `*-v2` to mark this a fresh evaluation separate from the failed
administration recorded in each seat's `raw/` directory (which is left
intact as historical evidence of the failure, not overwritten).
`qualification-review-provider.js`'s system prompts changed too (reference
the new envelope fields explicitly), which is why `containment_fingerprint`
moved. The failed `raw/consult-exchanges.jsonl` / `discuss-exchanges.jsonl`
files below predate this fix and must not be read as evidence against the
current corpus/generator/grader.

**`containment_fingerprint` changed AGAIN (2026-08-29, same day, transport
fix — not the envelope-disclosure fix above)**: seat 6's live discuss
administration (`seat6-gemini-3.7-flash-high-agy-discuss/raw/discuss-exchanges.jsonl`)
failed 16/16 with `transport_ok:false, "case broker failed:
provider_process_failed"` even after the envelope fix landed. Root-caused
(debugger, reproduced offline against agy 1.1.22): in headless `-p` mode agy
cannot prompt for tool confirmation, so it SOFT-DENIES any tool request and
exits 0 with EMPTY stdout (agy's own log: `tool_confirmation_manager.go
"Print mode: soft-denying tool confirmation"`) — the discuss system prompt
reliably makes the model reach for a tool, so every headless case died this
way. Neither `--sandbox` nor `--mode plan` change this. Fix in
`scripts/qualification-review-provider.js` `callCli()`: the `kind === 'agy'`
branch now passes `--dangerously-skip-permissions` (giving agy a resolvable
decision instead of an unpromptable one), safe ONLY because the per-case
cloned `QRP_CLI_HOME`'s `.gemini/antigravity-cli/settings.json` now gets a
force-merged `permissions.deny` blocklist (`command(*)`, `write_file(*)`,
`edit_file(*)`, `read_file(*)`, `web_search(*)`, `web_fetch(*)`) — verified
offline that deny rules win over the flag (a `command(hostname)` request
under this merged config returns "Permission denied ... Matches
user-configured deny rule", not real output). A third hunk also appends
captured stderr to the empty-stdout error message, so a future transport
failure surfaces its diagnosis instead of the generic message seat 6's
evidence carried. This is a Claude-authored code fix, stub-tested only (see
`scripts/qualification-review-provider.test.js` section 11) — no live/paid
provider call was made to produce this fingerprint; a depth-0 operator runs
the live containment probe (and, if it passes, the actual seat 6 `--execute`
re-administration) after merge. The failed `raw/discuss-exchanges.jsonl`
predates this fix too and must not be read as evidence against the current
transport.

**Important honesty note**: `engine-qualify.js` does **not** cross-check
`--prompt-config-hash`/`--semantic-fingerprint`/`--containment-fingerprint`
against any expected constant for the `consult`/`discuss` roles (confirmed by
reading `scripts/engine-qualify.js`: these three fields are validated only
for SHA-256 *shape*, then recorded verbatim into the receipt — unlike
`reviewer`'s `EXPECTED_GENERATOR_HASH` etc., which the kernel does check).
The derivation above is this bundle's own honest, reproducible convention,
not a value the kernel enforces. Anyone re-deriving from the same recipe
against the same repo state gets the same bytes.

## Runner identity (captured live, 2026-08-29, this machine)

| Runner | `--version` probe (`scripts/lib/runner-binary.js version --runner <r> --json`) | Token used |
|---|---|---|
| codex | `codex-cli 0.150.1`, `ok:true` | `codex-cli-0.150.1` |
| cc-shim (`claude`) | `2.1.250 (Claude Code)`, `ok:true` | `2.1.250-Claude-Code` |
| agy | `1.1.22`, `ok:true` | `1.1.22` (matches the Board-cited version) |
| qoderclicn | `1.1.28`, `ok:true` | `1.1.28` |
| cursor (`cursor-agent`) | `ok:false`, `reason:"missing_binary"` | none — binary absent on this machine right now |

Every `run.sh` re-probes its runner live at invocation time (fail-closed —
never guesses); the table above is what that probe returned on 2026-08-29.

`--version-source operator-asserted` is used for every seat: every transport
here is a CLI harness (codex, claude, agy, qoderclicn, cursor), and per
`engine-qualify.js`'s own header note, CLI transports return no runtime model
id, so `operator-asserted` is the honest value, not `runtime`.

## Endpoint / credential readiness (checked 2026-08-29, this machine)

- `scripts/resolve-endpoint.sh minimax` → `ready:true` (`autopilot-namespace`
  source, `AUTOPILOT_ENDPOINT_MINIMAX_URL`/`_TOKEN` both present).
- `scripts/resolve-endpoint.sh glm` → `ready:true` (same source,
  `AUTOPILOT_ENDPOINT_GLM_URL`/`_TOKEN` both present).
- `$HOME/.claude/.credentials.json` present — seat 3/4 `run.sh` stage a copy
  into a **dedicated** exam `CLAUDE_CONFIG_DIR`
  (`$HOME/.autopilot/qualify-staging/<seat>/claude-config/`, mode 700/600,
  **outside the repo** — never written into git-tracked evidence) rather
  than pointing at the real `~/.claude`, per
  `qualification-review-provider.js`'s own "CLAUDE_CONFIG_DIR TRAP" warning
  (pointing the real dir at a fresh-HOME `claude` child can reset the live
  `.claude.json`).
- `$HOME/.gemini/antigravity-cli/{antigravity-oauth-token,installation_id,settings.json}`
  present (total ≈12 KB) — seat 6 `run.sh` stages a **credential-only** copy
  into `$HOME/.autopilot/qualify-staging/seat6-.../agy-home/`, well under the
  adapter's 8 MB `QRP_CLI_HOME` template cap, again outside the repo.
- `CODEX_HOME` (seat 1/2) is pointed directly at the real `$HOME/.codex` —
  no staging copy — matching the pattern the existing
  `gpt-5.6-sol`/`reviewer` administration used
  (`docs/plans/evidence/2026-08-17-roster-qualification/sol-codex-qualify/README.md`).

None of the staged credential material is written under `docs/` — it lives
under `$HOME/.autopilot/qualify-staging/`, confirmed absent from `git status`
after running every `--plan` smoke below.

## Seat readiness

| Seat | Engine/runner | Role | `--plan` smoke | `--execute` readiness |
|---|---|---|---|---|
| 1 | gpt-5.6-sol / codex | consult | **PASS** (exit 0) | **READY** — codex present, CODEX_HOME creds present, QRP `QRP_CLI_KIND=codex` supported |
| 2 | gpt-5.6-sol / codex | discuss | **PASS** (exit 0) | **READY** — same transport as seat 1 |
| 3 | MiniMax-M3 / cc-shim | consult | **PASS** (exit 0) | **READY** — `minimax` endpoint ready, cc-shim `claude` CLI present, exam config dir staged |
| 4 | GLM-5.3 / cc-shim | consult | **PASS** (exit 0) | **READY** — `glm` endpoint ready, same transport as seat 3 |
| 5 | Qwen3.8-Max / qoderclicn | consult | **PASS** (exit 0) | **NOT-READY** — kernel gap: `qualification-review-provider.js`'s `CLI_KINDS` allowlist is `{codex, claude, agy, kimi}`; `qoderclicn` is wired only into the `dispatch-hetero.sh` live-rail (the `implementer` role), never into the `--remote-provider-cmd` broker transport `consult`/`discuss` require. The `qoderclicn` binary itself IS present and healthy (`1.1.28`) — this is purely an adapter gap, not a credential problem. `run.sh execute` self-refuses with this exact reason before any dispatch. |
| 6 | Gemini 3.7 Flash (High) / agy | discuss | **PASS** (exit 0) | **READY** — agy 1.1.22 present, model id confirmed via `agy models`, credential-only exam home staged |
| 8 | cursor-grok-4.6-high-fast / cursor | consult | **PASS** (exit 0) | **NOT-READY**, two independent reasons: (a) same kernel gap as seat 5 — no `QRP_CLI_KIND=cursor`; (b) the `cursor-agent` binary is **not installed on this machine right now** (`runner-binary.js` probe: `reason:"missing_binary"`) — it was present for the 2026-08-27 `cursor` implementer administration, so this is an environment fact as of this session, not a code claim. `run.sh execute` self-refuses with both reasons before any dispatch. |

(Seat 7, kimi, is Board-deferred for quota and is out of scope for this
bundle.)

## Kernel argv fields this bundle could not honestly populate as "verified"

- **Seats 5 and 8's `--remote-provider-cmd`/`QRP_CLI_KIND`**: the argv is
  assembled to the believed-correct shape (matching the pattern that works
  for codex/claude/agy) but is **untestable against the real transport**
  today — `qualification-review-provider.js` has no `qoderclicn` or `cursor`
  CLI kind. If either adapter is added, re-run that seat's `--plan` (still
  free) before ever attempting `--execute`.
- **Seat 8's `--runner-version`**: since the `cursor-agent` binary is absent
  on this machine, `run.sh` cannot re-probe it live. It falls back to the
  last known-good probed value from the 2026-08-27 implementer bundle
  (`2026.08.25-3e8eec8`), explicitly labelled as **not re-verified today** in
  both the script's stderr and this table. A real `--execute` must re-probe
  first.
- **`--effort` for cc-shim/agy/qoderclicn/cursor seats**: `QRP_CLI_EFFORT` is
  only forwarded to the `codex` CLI kind (per
  `qualification-review-provider.js`'s header note); for every other kind
  here, `--effort` is a receipt-only identity classification, not an
  enforced transport parameter. Seat 6's `EFFORT="baked-in-model-name"` and
  seat 3's `EFFORT="default"` are honest labels for "not enforced, no better
  data" rather than a measured value.
- **A real `--execute` grading outcome for any seat**: by design, nothing in
  this bundle produces one — that is the Board's separate, explicit
  authorization to spend, not something this administration-scripts task is
  scoped to trigger.
