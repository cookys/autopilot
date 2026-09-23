# Foreman exam phase 3 report

Branch continues `hetero/foreman-phase-2` at `eb4d9b7bb99b4104c1928d6c8be95716008d555f`. Nothing was merged or pushed. The spec, the corpus, and the generator's b1 script were not edited to hide `B1_GAP`. The version was not bumped. `CHANGELOG.md` was not edited. Section 11 stays unbuilt.

## What a sitting can do now

- `schemas/capability-evidence.schema.json` has `$defs.foreman_trial` and `$defs.foreman_sitting`. The trial requires `subjects` for the six checks (`evaluated`, `passed`, `failed_noncritical`, `failed_critical`), `clean` (total 3), `planted` (total 7), `twins` (total 4), `solvable` (total 12), `unsolvable` (total 2), `critical_events`, `budget`, and `campaigns`. The sitting requires `clock` (`"logical"`), `disposition` (`passed | failed | aborted_transport`), and `resit_locked`. `compileForemanTrial` / `compileForemanSitting` in `src/engine/capability-evidence.js` compile that shape and reject a trial that omits a required key. `section8FitsCapabilityEvidence()` reads those schema keys and returns true. The trials array accepts a `foreman_trial` item. There is still no `foreman` capability role and no qualified-promotion path for one.
- `evals/foreman-harness-conformance.js` drives non-model puppets through `gradeCampaign`. One golden puppet for each of trial 0's campaign scripts (10 originals and 4 twins) grades `correct`. One bad puppet per critical code (14) and per named non-critical code yields exactly that code. The H dispatch journal is byte-identical across two runs. The record is keyed by `harness_hash` (sha256 over the four asset hashes, the runner source hash, and the sandbox digest).
- Host-path write and kill residue ran under `bwrap` (`--unshare-net`, no bind of the host target). The write to a real host path failed and the file was unchanged. The sandbox sleep was killed with `SIGTERM` and the pid was not alive afterwards. Docker is installed but the daemon socket is permission-denied, so the sandbox is bwrap, not a container image.
- `scripts/engine-qualify.js foreman` with `AUTOPILOT_QUALIFY_SEED` set records a test-mode sitting of the puppet campaigns and does not throw. The record is `test_mode: true`, `inadmissible: true`, `qualified: false`. A transport abort still returns `pass: null`, `fail: null`, and `evidence: null`.

## Prompt scan

The installed `FOREMAN_SYSTEM_PROMPT` is still the §7 text. The scan hits were `clean` (family name), `good` and `changed` (version labels), and `worktree` / `ledger` (fixture-noun over-export). `ledger` is the §7 name of the ledger schema (`ledger_row` in the corpus) and is now on the allowlist. `worktree` and `ledger` are no longer exported as fixture nouns. `good`, `changed`, `clean`, and `worktree` are also on the allowlist so the verbatim prompt is not an oracle-only leak. They are not enum values of the five schemas. A planted family name (`false_report`) and the version label `subtle` still fail the scan. `scripts/foreman-seat-prompt-scan.test.js` exits 0.

## What is still refused

- A foreman qualify invocation without `AUTOPILOT_QUALIFY_SEED` still takes the normal identity flags, then `runForemanQualification()` refuses on the §9 disk pins (empty pin map, no caller-supplied conformance record, transport, sandbox canaries, seat-prompt hash). That refusal writes no evidence record. It is a start refusal, not a graded fail.
- Section 11 (production return-gate, pre-correction snapshot, probationary audit) is not implemented.
- `scripts/foreman-eval-grader-b1-gap.test.js` still exits 1 with `B1_GAP`.

## How to run

- `node scripts/foreman-eval-generator.test.js` — green.
- `node scripts/foreman-eval-grader.test.js` — green.
- `node scripts/foreman-eval-runner.test.js` — green.
- `node scripts/foreman-seat-prompt-scan.test.js` — green.
- `node scripts/foreman-harness-conformance.test.js` — green.
- `node scripts/foreman-eval-grader-b1-gap.test.js` — red on purpose.

## phase 4

A sitting starts with:

`node scripts/engine-qualify.js foreman --plan`

That command checks the four asset pins in `evals/foreman-asset-pins.json` and the conformance record in `evals/foreman-conformance-record.json` against the hash `evals/foreman-harness-conformance.js` computes (four asset hashes, the runner source hash, and the sandbox digest). It does not call a model. A graded sitting, with no network, is `runForemanQualification({ foreman })` in `evals/foreman-eval-runner.js`: `crypto.randomBytes` draws `run_nonce`, `generateForemanExam` builds the campaigns, the §3 stub interpreter answers `dispatch`, and `gradeCampaign` / `compileForemanTrial` write the sitting record. `test_mode` stays false unless `AUTOPILOT_QUALIFY_SEED` is set. Child agents are the in-process stub. The foreman is the only remote party, and only when a caller supplies a transport; the scripted sitting does not.

Preconditions that still refuse, and write no evidence record:

- An asset sha256 that differs from `evals/foreman-asset-pins.json`.
- A missing conformance record, or a `harness_hash` that differs from the runner's recomputation.
- `seat_prompt_sha256` of the installed `FOREMAN_SYSTEM_PROMPT` differing from `vocabulary_scan_sha256` in the pin file.
- A caller-supplied `run_nonce` when `test_mode` is not set (`run_nonce_source: 'caller'`).
- Anti-rerun: a prior `failed` disposition, `resit_locked: true`, or two `aborted_transport` records for the same engine id and seat config hash.
- Section 8 schema keys missing (`section8FitsCapabilityEvidence()` false).
- Sandbox canary manifests that cannot be created.
- `AUTOPILOT_QUALIFY_SEED` still selects the inadmissible puppet sitting instead of this loop.

Section 11 stays unbuilt. `scripts/foreman-eval-grader-b1-gap.test.js` still exits 1 with `B1_GAP`.

## phase 5

`runForemanQualification` builds the foreman from `--remote-provider-cmd` when no scripted `options.foreman` is passed. Each campaign sends the §3 visible bundle (`brief`, `worktree`, `.autopilot/` ledger, and prior turns while the session is still the first one) through `scripts/qualification-review-provider.js` with `QRP_PROMPT_MODE=foreman`. The model answer is applied to the in-process stub as `dispatch`, `request_capability`, or `return_verdict`, then `gradeCampaign` grades it. A model turn that is not a tool call counts as one turn. The campaign budget is 5 dispatches, 40 tool calls, and 200000 tokens. A verdict or a spent budget grades that campaign and the sitting continues. A timeout, a non-zero adapter, or no parseable tool aborts with `pass` and `fail` both null and does not grade that campaign. A restarted session is sent only the brief, the worktree, and `.autopilot/`.

The command that calls a model:

```
QRP_TRANSPORT=http QRP_PROMPT_MODE=foreman \
QRP_BASE_URL=$QRP_BASE_URL QRP_AUTH_TOKEN=$QRP_AUTH_TOKEN \
QRP_MODEL=$QRP_MODEL QRP_PROVIDER=$QRP_PROVIDER \
node scripts/engine-qualify.js foreman \
  --engine <engine> --model "$QRP_MODEL" --model-version <version> \
  --runner qrp --runner-version <version> --family <family> \
  --harness-version <harness> --effort <effort> \
  --prompt-config-hash <sha256> --semantic-fingerprint <sha256> \
  --containment-fingerprint <sha256> \
  --task-class foreman --domain repository --language en --tool dispatch \
  --remote-provider "$QRP_PROVIDER" \
  --remote-provider-cmd "node scripts/qualification-review-provider.js" \
  --provider-env QRP_TRANSPORT --provider-env QRP_PROMPT_MODE \
  --provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER
```

Do not set `AUTOPILOT_QUALIFY_SEED`. That variable still selects the inadmissible puppet sitting. Section 11 stays unbuilt. `scripts/foreman-eval-grader-b1-gap.test.js` still exits 1 with `B1_GAP`.
