# qwen3.8-flash-next (local, cc-shim) implementer qualification — QUALIFIED 24/24 (2026-09-03)

Formal implementer administration over the live rail (`engine-qualify.sh implementer`
via `scripts/qualification-sweep.sh --roster roster.json --execute`), same generator /
corpus / grader pins as the 2026-08-22 sweep. Result: **qualified**, `corpus_pass: 24/24`,
capability_score 1.0, administration_outcome `completed`, every family 4/4
(greenfield_spec, red_to_green, test_integrity_trap, scope_trap, security_canary,
no_op_honesty).

- **Scorecard event 186** (`~/.autopilot/engine-scorecard/scorecard.jsonl`);
  qualification-evidence store event 333. Expires 2026-12-02 (advisory).
  `seat-status` → `admission_status: qualified`, seat_hash `55e9a346…`.
- **Identity**: engine/model `qwen3.8-flash-next`, runner `cc-shim` (Claude Code
  2.1.259 → runner_version `2.1.259-Claude-Code`), family `alibaba`, effort `high`
  (label only — see caveat), harness `dispatch-hetero:fa9b4a64`, `--version-source
  operator-asserted`.
- **Deployment actually examined** (not in the row — sweep pins model_version to the
  model token): SGLang service on cookys-cuda `192.168.101.7:8001`, checkpoint
  `RadixArk/Qwen3.8-Flash-Next-NVFP4` @ `7b719225…`, TP2, NVFP4, BF16 KV, NEXTN MTP
  3/4, `--tool-call-parser qwen3_coder --reasoning-parser qwen3`, 262K context.
  Recipe: `llm-playground/scripts/qwen38-flash-next-serve.sh`. A different checkpoint,
  engine build, or parser pair is a different deployment; re-administer.
- **Fingerprints**: prompt_config_hash = sha256(evals/impl-eval-generator.js) `16b45e1a…`;
  semantic_fingerprint = sha256(evals/impl-capability-evidence-corpus.json) `d8af5290…`;
  containment_fingerprint = sha256("cgroup-live-rail-v1") `2c1042fc…` (`contained: true`
  observed on the Stage-0 probe). All three byte-identical to the 2026-08-22 sweep, so
  the row is directly comparable with the nine qualified pairs there.
- **Efficiency**: 24 cases in 371 s dispatch wall (min/median/max 11/14/25 s); seat wall
  395 s. Median is faster than every cloud seat in the 2026-08-22 sweep (claude-sonnet-5
  was the fastest there at median 16 s). Local GPU time only; no provider charge.
- **Caveat — effort label**: cc-shim forwards no reasoning effort to the endpoint
  (dispatch-hetero passes `--effort` for codex/grok only). What the model ran at is the
  Claude Code default thinking request as mapped by SGLang's qwen3 reasoning parser, NOT
  the `reasoning_effort=low` cell that scored 30/34 in llm-playground. `high` is the
  label the other cc-shim seats (GLM-5.3, MiniMax-M3, sonnet/opus-5) carry for the same
  reason; a `default` label was tried first and rejected at argv by dispatch-hetero
  (enum low|medium|high|xhigh|max — zero dispatches, receipt 1 in
  `flash-next-qualify/probe-receipts.jsonl`).
- **Caveat — endpoint transport**: the exam reached the endpoint through the raw
  `ANTHROPIC_BASE_URL` env passthrough (`engine-qualify.js` allowlists it). Daily routing
  via `implementer_endpoint:` + `resolve-endpoint.sh` accepts `http://` ONLY for loopback,
  so a LAN URL needs an ssh/socat forward to `127.0.0.1:8001`, or the loop must run on
  cookys-cuda itself.
- **Construct scope**: same honesty clause as the 2026-08-22 bundles — contract-obedient
  commit production over the dispatch-hetero rail. Not claimed: multi-round review-loop
  convergence, L-size planning, long-context behaviour beyond the corpus, cross-runner
  transfer.
- **Files**: `roster.json` (sweep input), `sweep-stdout.log` (attempt 1, argv bounce),
  `sweep-stdout-2.log` + `qualification-sweep-progress.txt` (attempt 2, the
  administration), `flash-next-qualify/{probe-receipts.jsonl,qualify-out.json,
  qualify-err.log,record-out.json,record-err.log,raw/}`.
