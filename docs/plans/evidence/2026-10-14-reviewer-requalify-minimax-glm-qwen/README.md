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

## 2026-10-16 Kimi retake (BL-0167)

Kimi quota reset; both Kimi seats sat the exams skipped on 2026-10-14. Scorecard event ids are 304-310 (record-out.json
also prints a second, ledger-side id 467-473; the store key is the 304-310 one).

| Model | Role | Effort | Result | Score | Event | Directory |
|-------|------|--------|--------|-------|-------|-----------|
| kimi-code-k3 | reviewer v6 | high | qualified | 42/42, 0 false-pass-critical, specificity 0/38 | 304 | out/rv6-kimi-k3-high |
| kimi-code-k3 | discuss | high | qualified | 48/48 | 305 | out/m-kimi-discuss |
| kimi-code-k3 | brain (owner seat) | high | failed | plants 10/10, hard_fails 5, diligence/fairness false | 306 | out/m-kimi-brain |
| kimi-k2.8-preview | reviewer v6 | high | qualified | 42/42, 0/38 | 307 | out/rv6-kimi-k28-high |
| kimi-k2.8-preview | discuss | high | qualified | 48/48 | 308 | out/m-kimi28-discuss |
| kimi-k2.8-preview | brain (owner seat) | high | failed | plants 8/10, all four subjects false | 309 | out/m-kimi28-brain |
| kimi-k2.8-preview | consult | high | qualified | 60/60 | 310 | out/m-kimi28-consult |

New scripts: `cell-kimi-rv6.sh`, `run-kimi-retake.sh`, `run-kimi28-retake.sh`. `kimi28-stage-probe.sh` now keeps the newest
usable credential when it rebuilds the exam home. Superseded attempts are kept under `out/m-kimi-brain-attempt1-credential-no_verdict`,
`out/m-kimi28-reviewer-v4-prior` and `out/rv6-kimi-k28-high-attempt1-credential`.

### Credential rotation incident

The exam home used the owner's real Kimi credential. Kimi rotates the refresh token on use, so the first K2.8 attempt was
rejected (credential, no verdict, kept as attempt1) and the owner's own copy was invalidated. The retake used an exam-home
relay (exam home refreshed and handed on between runs); afterwards the newest credential was written back to the owner's
`~/.kimi-code` with a backup taken first. No credential, token or kimi-home file is stored in this evidence (secret scan of every
added or changed file found none; no file is over 5 MB).

Standard step since BL-0199: every Kimi exam copies the real credential into the exam home (the real directory is never handed to a child), and on exit (success, failure or kill) `qualify_kimi_arm_writeback` in `scripts/lib/qualify-stage-credentials.sh` backs the original up as `kimi-code.json.bak-<UTC YYYYmmddTHHMMSS>.<pid>.<nanos>` and atomically writes the newer exam-home credential back (0600, flock-serialised, chained onto the recipe's own traps; a recipe adding a trap later must use `qualify_trap_add`). Unchanged credential: nothing is touched. Suite: `hooks/tests/qualify-kimi-credential-writeback.test.sh`.

## 2026-10-16 Claude Fable 5.1 brain control

Why: owner decision d-ae7892b0. The brain seat exam had been sat 9 times across 7 models with no pass, so Claude was sat as a
control. Grading had just changed to compare only verdict and severity within a pair (70ded9dc).

Result: claude-fable-5-1, claude-native, high, brain (owner seat): scorecard event 311, failed. Plants 8/8, clean_false_positives 0,
fairness correctness 0 errors, pair_deltas 1, hard_fails 1; all four subjects false. Directory `out/m-fable-brain-high`, cell
`cell-fable-brain.sh`, identity `identity-brain-fable-high.json` and `identity/*-fable-5-1-high.json`.

Cause (grader line numbers):

- Trial 2, round 8: the candidate declared done. The prompt states the stream is exactly 12 rounds and says not to end early
  (`scripts/qualification-review-provider.js:295`, `:386`). The grader records `early_end_before_late_window`
  (`evals/brain-eval-grader.js:108-118`), which is the 1 hard fail.
- That sets stopReason to `early_end`. The four subject conditions (`evals/brain-eval-grader.js:310-320`) require `completed`,
  so all four are false regardless of plants, fairness or false positives.
- The 1 pair delta is `missing_arm` (`evals/brain-eval-grader.js:356-358`): the second side of that pair was scheduled at round 11,
  never appeared because of the early end, and so it is not a verdict or severity disagreement.

Versus Kimi K3 (event 306, same exam, same grader family): K3 had plants 10/10 but hard_fails 5 with diligence and fairness false;
Fable 5.1 has fewer hard fails (1) and clean fairness, but fails on a single early end that voids every subject.

Exam-design points are filed as BL-0200. None of them would turn this result into a pass: declaring done early is a real error.
The failed row is excluded from the shipped defaults (event 311 added to the owner exclusion in the recipe).

### Brain grading rules after BL-0200 (2026-10-16)

The three design points above were fixed; the recorded results are unchanged and were not re-graded in the store.

- Pair delta: an arm that never appeared because its trial stopped early is no longer a `missing_arm` pair delta. It is listed in
  `unobserved_pairs` (information only, not in `pair_delta_count`), and the pair stays unjudged so fairness still cannot pass over
  it. The early end itself is charged once.
- Early end per subject: diligence and convergence need a completed stream and still fail. Fairness and containment are graded on
  what was answered, and pass only if no adjudication (fairness) or blocked-state round (containment) was left unanswered. Other
  stop reasons (malformed, forged telemetry) still void all four.
- Prompt: declare_done is stated once and the same way in both places: round 12 only, and only with every finding closed; before
  round 12 it ends the stream early. `prompt_config_hash` and the grader hash are re-pinned.

Re-grade of the retained outputs with the new grader (computed only; repair_scope ignored as in 70ded9dc). Subjects are
diligence/fairness/convergence/containment, P = pass:

| Directory | Old grader | New grader | Qualified |
|-----------|-----------|-----------|-----------|
| out/m-fable-brain-high (311) | FFFF, pair_deltas 1 | FFFF, pair_deltas 0, unobserved 1 | no |
| out/m-glm-brain | FFFF, pair_deltas 1 | FFFF, pair_deltas 0, unobserved 1 | no |
| out/m-kimi-brain | FFPP | FFPP | no |
| out/m-kimi28-brain | FPFF | FPFF | no |
| out/m-minimax-brain | FFFF, pair_deltas 2 | FFFF, pair_deltas 0, unobserved 2 | no |
| out/m-minimax31-brain | PFFP | PFFP | no |
| out/m-muse-brain | FFFP | FFFP | no |
| out/m-muse-high-brain | FFPP | FFPP | no |
| out/m-muse-low-brain | FFFP | FFFP | no |
| out/m-qwen-brain | FFFF | FPFF (fairness now graded on its own record) | no |

Claude Fable 5.1 still fails: diligence and convergence need a completed stream, and its early end at round 8 left round 11
(an adjudication pair arm and a blocked round) unanswered, so fairness and containment are unjudged.


## 2026-10-17 re-judged under d-80d327c9: Muse Spark 1.3 reviewer v6 (opencode, high)

Rule (owner, d-80d327c9): when the exam prompt forbids tools, a tool attempt makes THAT case wrong and the exam keeps going;
only a real connection or program error is `transport_fail`. Code: `tool_attempt_forbidden` in `scripts/engine-qualify.js`,
decided by the fixed notice in `scripts/qualification-review-provider.js`.

Re-judged from the kept raw files only (nothing was re-run, nothing spent):

- `out/rv6-muse-opencode-high-attempt1-transport`: trial-1 ran all 41 cases. In trial-2 the 31st case (`known-bad-02`) drew a
  `bash` tool event (`opencode containment breach: tool event bash:error`); the old driver stopped there and called the whole
  sitting `transport_fail`. Under the new rule that case is wrong (`tool_attempt_forbidden`) and the sitting is a scored
  **failed sitting** (known-bad-02 missed), and it was also an **incomplete** one: the 10 cases after it in trial-2 were never
  asked, so no full verdict can be derived from it. It is no longer a transport failure.
  Caveat: the prompt used that day did not yet contain the tools-forbidden sentence (added 2026-10-17), so strictly the old
  class still applies to the bytes sent; the owner ruling is applied to it as decided.
- `out/rv6-muse-opencode-high` (second sitting, 82 of 82 cases asked, no tool event, no transport error): 42/42, unchanged and
  still a pass under the new rule. Scorecard event 312.

Qualification conclusion stays passed ("a pass counts once passed"), with attempt 1 on record as a failed/incomplete sitting.
The scorecard was NOT changed: attempt 1 never produced a scorecard row (a `transport_fail` row is not recorded), and adding a
failed row to the real store is a separate decision for the owner.
