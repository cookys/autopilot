# Reviewer qualification at effort=high: MiniMax-M3 re-sit, Qwen3.8-Max first sitting, GLM-5.3 re-sit (2026-10-14)

Owner-approved 2026-10-14. Status: launched, results not yet read; nothing recorded to the scorecard.
Each lane is one `engine-qualify.sh reviewer` administration (corpus `reviewer-known-bad-clean-v2.reviewer-metamorphic-v4`,
2 trials) run by `cell.sh <lane>`; the operator records `out/<lane>/emit-row.json` by hand with `record.sh <lane>`
(`record.sh <lane>`, adapted from the argon bundle).

## Seat identity and where each field came from

| field | minimax | glm | qwen | source |
|---|---|---|---|---|
| engine / --model | MiniMax-M3 | GLM-5.3 / glm-5.3 | Qwen3.8-Max | GLM: scorecard event 140 (`engine` GLM-5.3, `model` glm-5.3). MiniMax: event 9 + event 10 (`MiniMax-M3`). Qwen: events 161/183 (consult, `Qwen3.8-Max`). |
| family | minimax | zhipu | alibaba | events 9 / 140 / 161 |
| runner | anthropic-compatible | anthropic-compatible | qoderclicn | GLM: event 140. Qwen: events 161/183. MiniMax: see deviation below. |
| runner_version | node-direct-http-fetch | node-direct-http-fetch | 1.1.70 (live `runner-binary.js version`) | GLM: event 140 / MiniMax VA event 10. Qwen: the consult run.sh probe recipe (token form). |
| harness_version | engine-qualify-3a7d468d | same | same | event 140 recipe: `engine-qualify-<sha8 of scripts/engine-qualify.js>` (hyphen form; value moves with the file) |
| effort | high | high | high | task order; events 140 / 161 / 183 all high |
| prompt_config_hash | 3cbe203c... | same | same | reviewer `SYSTEM_PROMPT` hash, byte-identical to event 140 (verified: derive script reproduces it) |
| semantic_fingerprint | a69cbd85... | b4d2079f... | d2a61a75... | GLM reproduces event 140's value byte-for-byte; MiniMax swaps model+endpoint in the same recipe; Qwen has no reviewer precedent (`_invented` in `identity/reviewer-qwen.json`) |
| containment_fingerprint | 8b46dca1... | 8b46dca1... | ceb2ae0a... | http lanes reproduce event 140's recipe; Qwen invented (`--tools ""` posture from provider `callCli()`) |
| model_version / version_source | runtime probe if the endpoint echoes a model id, else `MiniMax-M3` operator-asserted | same (event 140 was `glm-5.3-20260817`, runtime) | `Qwen3.8-Max`, operator-asserted | `cell.sh` sends ONE 16-token "ping" (not an exam case) and logs the resolved id in `run.log` |

Deviation to note: scorecard event 9 (MiniMax-M3 reviewer, 2026-07-16) was runner `cc-shim`, model_version `unknown`,
harness `engine-qualify@1.0.0`, corpus `known-bad@v1` (13 cases) — a pre-evidence-store row whose identity cannot be
reproduced. This sitting uses the HTTP anthropic-compatible transport per the provider header and MiniMax's VA event 10,
so it will NOT share an identity with event 9; it is a new identity on the current corpus, as the old row's corpus is retired.

## Parameters and provider env

- Common: `--task-class code_review --domain cross-cutting --language en --tool read_only --remote-timeout-ms 600000`,
  `QRP_TIMEOUT_MS=570000` (adapter default 180 s is too short at high; recipe from the 2026-10-12 claude lanes),
  `QRP_PROMPT_MODE=reviewer`, wall cap `timeout 18000` (argon reviewer recipe).
- http lanes: `QRP_BASE_URL`/`QRP_AUTH_TOKEN` from `AUTOPILOT_ENDPOINT_{MINIMAX,GLM}_{URL,TOKEN}` via
  `scripts/load-endpoints-env.sh` (never written to a file or log); `QRP_PROVIDER=<lane>-anthropic`. The http transport
  has no effort parameter, so `effort` is a label.
- qwen: `QRP_TRANSPORT=cli QRP_CLI_KIND=qoderclicn QRP_CLI_EFFORT=high`, `QRP_CLI_HOME` = its own staged dir
  `~/.autopilot/qualify-staging/reviewer-qwen3.8-max-qoderclicn/qoder-config-dir` (credential files only, layout as in
  the 2026-08-28 seat5 run.sh). The real `~/.claude` is never passed to any child.
- Each lane has its own `out/<lane>/` (run.log, stdout.json, stderr.log, raw/, rc, emit-row.json).

## Dry run (parameter layer, no spend)

`DRY_RUN=1 bash cell.sh <lane>` swaps in a nonexistent provider command and a scratch `--store`. All three lanes passed
argument/identity validation and reached the broker (`outcome: transport_fail` on case 1, as designed); an earlier http
attempt without dummy env failed `QRP_BASE_URL is not set`, which was the dry-run harness, not the identity fields.

## Recording

`bash record.sh <lane>` appends `out/<lane>/emit-row.json` to the scorecard. Read `emit-row.json` and `stderr.log`
first; failed rows are append-only.

## minimax31 lane: MiniMax-M3.1-Flash-Preview (owner-added)

- Files: `cell-m31.sh minimax31`, `derive-fingerprints-m31.js`, `identity/reviewer-minimax31.json`, output `out/minimax31/`
  (separate files so the running `cell.sh` / `cell-v2.sh` were never touched).
- Identity: engine = model = `MiniMax-M3.1-Flash-Preview`, runner `anthropic-compatible`, runner_version `node-direct-http-fetch`,
  family `minimax`, endpoint/token = the `minimax` lane's (`AUTOPILOT_ENDPOINT_MINIMAX_*`). The model is absent from /v1/models but
  the owner's probe showed 200 with `model` echoed unchanged. `cell-m31.sh` repeats a 16-token probe and logs the resolved id;
  model_version is that id when it matches the TOKEN shape. Fingerprint recipes are the minimax lane's with the model swapped.
- effort = `max` (label). Provider read (`callModel`, qualification-review-provider.js ~:694-745): the HTTP messages path
  sends only model/max_tokens/temperature/system/messages, with NO effort or thinking field, so effort cannot be sent. The label
  records the endpoint's documented default for this model (thinking forced on, default effort max). The M3 / GLM rows labelled
  high are labels too, not endpoint settings, so `max` here is NOT comparable as the same effort to them.
- max_tokens: the default 8192 is shared with thinking, and a lone thinking block fails the case (provider header ~:109-117).
  Because this model thinks at max by default, `QRP_MAX_TOKENS=32768` is set and listed in `--provider-env`.
