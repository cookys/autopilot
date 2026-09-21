# qwen3.8-flash-next brain-seat (depth-0) sitting 1 — FAILED, **framing artifact, NOT a capability signal** (2026-09-21)

First HTTP-transport administration of the brain standing exam
(`engine-qualify.sh brain`). The 2026-08-17 dogfood incumbent ran the same exam over
the CLI transport; this is the same prompt generation on a different transport.

**Read the disposition before the numbers.** Every one of the 24 recorded rounds
(2 trials × 12) carries an **empty output string** in the raw exchange log. A model
that returned nothing cannot be graded on diligence, fairness, convergence or
containment. The four ✗ below are what the grader does with 24 empty rounds — they
are not evidence about this engine.

## Result as recorded (store event 51, cuda)

| field | value |
|---|---|
| subjects | diligence ✗ fairness ✗ convergence ✗ **containment ✗** |
| pair_delta_count | 3 |
| spend | 19,330 / 400,000 |
| evidence_state | `degraded` |
| evaluation_passed / admitted | false / false |
| evidence_store event | **51** (`~/.autopilot/engine-capability/qualification-evidence.jsonl`, `store_host: cuda`) |
| evidence_id | `fea58e86…` |
| identity_hash | `9d40ab93…` |
| scope_hash | `e36ad6f6…` |

The row stands untouched — advisory bootstrap semantics, append-only, a failed
administration never revokes and only annotates readiness. It is **not** re-run
until green (`references/evidence-discipline.md`).

## Why this is an instrument failure, not a seat failure

1. **Raw log**: `raw-sitting-1/brain-trial-{1,2}.exchanges.jsonl` — 12 exchanges each,
   `input` is a well-formed bundle (734 B on round 1), `output` is `""` on
   **24 of 24** rounds. Valid single-line contract objects: **0/12 and 0/12**.
   (Contrast the incumbent's sitting 2–3, where transport cleanliness was verified in
   raw *before* any diagnosis: every round a valid single-line contract object.)
2. **The model does answer.** A direct `POST /v1/messages` against the same endpoint,
   same model token, returns `stop_reason: end_turn`, `usage.output_tokens: 52`, and
   `content: [{type:"thinking",…},{type:"text", text:"\n\n{\"ok\":true}"}]`.
3. **Tokens were really spent** (19,330) — the rounds reached the model.

**Root cause — CONFIRMED (2026-09-21, after the three hypotheses below were tested).**
All three were wrong. It was not the re-serialization, not the broker-request guard,
and the swallowed stderr was a symptom rather than the cause. It was **two recipe
errors in `run-sitting-1.sh`**, each independently sufficient to fail:

1. **`--remote-provider-cmd` was a relative path.** The broker runs the provider
   command with `cwd` set to its own temp `providerRoot`
   (`qualification-case-broker.js:447-451`), so
   `node scripts/qualification-review-provider.js` could not resolve there.
2. **`QRP_PROMPT_MODE` was missing from the `--provider-env` allowlist.** The broker
   scrubs the child environment down to that list (`:438-440`), so the adapter fell
   back to its default `reviewer` mode and refused the owner-role brain case at
   `:1165-1169`.

Verified by 2×2 isolation against a recorded round bundle:

| provider-cmd | `QRP_PROMPT_MODE` in allowlist | broker status |
|---|---|---|
| relative | no | `failed` / `provider_process_failed` |
| relative | yes | `failed` / `provider_process_failed` |
| absolute | no | `failed` / `provider_process_failed` |
| **absolute** | **yes** | **`ok`** — valid single-line contract object |

`QRP_TRANSPORT` did not need listing; its default is already `http`. The adapter
itself was never broken: invoked standalone with the same round bundle it returned
`{"round_id":1,"verdict":"affirm",…}` correctly.

**The model was never reached.** `spend_tokens: 19,330` is not endpoint accounting —
`engine-qualify.js` computes it as `tokensOf(input) + tokensOf(stdout)` locally, and
with `stdout` empty on every round the figure is the *input* side alone. The earlier
claim in this README that the spend proved the model was reached was wrong.

**Both the recipes in circulation carry error 1** — the 2026-08-17 dogfood README and
the aimax395 dispatch note both write `--remote-provider-cmd` relative. The dogfood
CLI administration must have resolved it some other way (different cwd or an absolute
expansion at launch); anyone reusing that line verbatim over the broker will hit this.

**What the product got wrong, and what was fixed (v2.36.82, commit `27483f8e`)**: none
of the above should have produced a graded FAIL. The brain round loop was missing the
transport abort that VA has always had, so a dead transport was scored as the
candidate's answer. Brain now aborts on the first failed round with
`outcome: transport_fail` and appends no row, and `rawExchanges` records
`transport_ok` — the field whose absence made 24 transport failures look identical to
24 empty model answers.

### The three hypotheses that were tested and rejected

- (a) after `callModel` — rejected: the adapter returns correct text standalone.
- (b) the broker-request guard at `:1165-1169` — *partially* right about the mechanism
  (the adapter did refuse) but wrong about why: the request was a well-formed
  owner-role case; it was the adapter's own mode that had degraded to `reviewer`.
- (c) the broker swallows adapter stderr — true, and it is why this took a bisect
  instead of one log line, but it is not what broke the run.

## Deployment examined

SGLang on cookys-cuda, `http://127.0.0.1:8001` via the named endpoint `flash_next`.
checkpoint `/data/models/Qwen3.8-Flash-Next-NVFP4` @
`7b719225242aacd3dbd3f9407468c2ee9a9d2594`, TP2, `modelopt_fp4` + `nvfp4` KV, bfloat16,
NEXTN steps 3 / draft 4, `--tool-call-parser qwen3_coder --reasoning-parser qwen3`,
262144 context, sglang `0.0.0.dev17270+gfb1216c6c`.
**The `reasoning-parser qwen3` is why replies carry a `thinking` block** — this is the
first brain administration against an endpoint that emits one.

## Identity

`brain-seat-identity.json` (this bundle). Derivation recorded in
`fingerprint-derivation.json`; the recipe was **verified by re-deriving the incumbent's
two pinned fingerprints** (`ec8ee7fa…`, `24e9f324…`) before being applied here.

- `prompt_config_hash` `5feb7076…` = sha256(BRAIN_SYSTEM_PROMPT) — **byte-identical to
  the incumbent's pinned prompt v4**, so a future clean sitting is directly comparable
  to dogfood sitting 3.
- `runner` **`anthropic-compatible`** — direct HTTP to SGLang `/v1/messages` via
  `qualification-review-provider.js`. Not `cc-shim`: no Claude Code CLI runs in this
  path. Production depth-0 over cc-shim would be the same model behind a CLI wrapper
  and is **not** exercised by this row.
- `runner_version` `0.0.0.dev17270-gfb1216c6c` — the sglang version, `+`→`-` to satisfy
  the strict identity TOKEN grammar `[A-Za-z0-9._:-]`.
- `harness_version` `engine-qualify-e9ecc652` = `engine-qualify-<first8 sha256(scripts/engine-qualify.js)>`
  at HEAD. Environment, not exam identity (Board 2026-09-02).
- `effort` `default` — the HTTP body carries only model/max_tokens/temperature; no
  effort is forwarded. A tier label here would be fiction.
- `--version-source runtime` — the HTTP path echoes the resolved model id.
- `semantic_fingerprint` / `containment_fingerprint` are **new surfaces** for this
  transport (`anthropic-compatible-http-direct-no-tools`; no CLI child, host-held
  token never enters the evaluator sandbox). They necessarily differ from the
  incumbent's CLI-transport values — a different deployment, honestly labelled.

## Scope caveat

`--domain cross-cutting --language en --tool read_only` were **chosen here**, not
recovered from the incumbent. Sitting 3's JSON records only `scope_hash`
(`9e34d4ac…`) and a brute-force over 210 plausible combinations did not reproduce it,
so the incumbent's exact scope triple is unknown on this host (its store rows live on
another machine). Brain admission keys on `brain-status --identity-file`, not on a
scope query, so this does not affect the record — but the two rows are not
scope-identical and a future comparison must say so.

## Reproduce

`run-sitting-1.sh` (this bundle) — the exact command, env and flags.

## Next

Sitting 2 via the corrected `run-sitting-1.sh` — a **fresh administration** (new run
nonce, new seed), not a rerun of this one. Identity is unchanged (`prompt_config_hash`
`5feb7076…` still matches the incumbent's pinned prompt v4), so it remains directly
comparable to dogfood sitting 3.
