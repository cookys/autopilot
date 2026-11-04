# Plan — BL-0372 measurement: are the claude `--output-format json` and `stream-json --verbose` results byte-identical?
> Status: Tasks 0–3 in progress; Tasks 4–5 parked on a registered alias. Backlog row: BL-0372 (`project/backlog/bl-ap-streamjson-result-bytes.md`). Owner: PM program. Size: S (instrument and measurement; no change to dispatch behaviour). Frame: baseline autopilot develop `a44ea9a6a`; this plan was written by reading the repo only, no claude call was made. Upstream: `project/plans/2026-11-03-g40-agent-lane-quota.md` section 5.1 (C1/C2/C3), section 18.6, section 19.4 step E7, and N9 in section 14.

## 0. Context / thesis

1. The measured candidate is C2 (a transparent wrapper conversion, behind a config flag), not C1. The measurement question is therefore exact: **"after the wrapper re-emits the last `type=result` line of the stream, does every existing json consumer see the same thing as it sees in today's json output?"**
2. Non-determinism approach: a variant of option (c). A fixed one-word prompt, J/S pairs interleaved, plus J/J control pairs to measure the noise floor. Reasons in section 3. Option (a) is impossible; option (b) alone only proves the rebuilder is self-consistent, not that it equals json.
3. The verdict has two layers: **field equivalence** (every consumed field) and **byte equivalence** (the whole envelope with declared volatile values masked). Under PM decision D3 both layers must PASS, together with stderr and the exit code, before the config flag is switched to stream-json.
4. The live matrix is **56 calls** (4 argv profiles x (5 J/S pairs + 2 J/J pairs), 2 calls per pair) plus **2 real error-path calls** (PM decision D2), 58 in total. All are haiku with one-word prompts on a default registered subscription alias.
5. The action after a FAIL is fixed: keep json (C3), leave the C2 flag off, record the result in evidence; the G40 probe then becomes the only main source for dispatch.

## PM decisions (2026-11-04)

These decisions are final. The body below has been updated so that every place that was "pending" now states the decision.

- **D1 / D2 (live calls).** No operator card is needed: the operator authorised live tests on all subscription accounts today. Use a default registered Claude alias with haiku, **56 calls**; skip when utilization is >= 0.80. D2 is agreed: add **2 real error-path calls** (58 in total). Exclude codepower. A credential is recorded by path only, never by value.
- **D3 (shipping form of C2).** C2 ships behind a config flag whose default is json. The flag is switched to stream-json only after both measurement layers PASS: layer 1 is the fields; layer 2 is the bytes after masking volatile fields, plus stderr and the exit code. Any FAIL means C3, and the flag stays off.
- **D5 (scope of the json callers).** `frozen_legacy` runners (frozen under G37) are not included. An eval path is included only if it is on the live spawn-site list (`scripts/lib/claude-spawn-sites.json`); every other one is excluded, with a one-line reason (section 1.1).

- **PM round 2 (2026-11-04).**
  1. J8/J9 (eval paths) enter scope once Task 0's field table is complete; if a fifth profile (P4) is needed, the call ceiling may rise to about 70 (haiku, subscription account).
  2. J2/J3 are measured and recorded only, never switched (C2 does not touch that path); the result must state this explicitly.
  3. Error-path calls triggered by a non-existent model name are acceptable.
  4. **D4:** J7 (`--bare`, API-key billing) is out of scope; the operator's authorisation covers subscription accounts only. Switching J7 later needs its own measurement and its own approval. **D6:** register `purpose=streamjson-measure` in the wrapper allow-list; this is the small develop change inside the measurement task (Task 2).
  5. Tasks 4 and 5 (live calls) are parked on an operator card because this host has no account registry; the hands lane for Tasks 0–3 makes zero claude model calls.

## Global Constraints (copied verbatim into every dispatch)
- Node >= 20.10, built-ins only; JSON handling in Node, not shell (CLAUDE.md language rule).
- No credential is read, printed, copied or moved by the measurement script or by the hands lane; only the alias name and the `token_path` path are recorded, never a value. No token, email, organisation id, host name or user name in any record, log, fixture, evidence or doc.
- Never use the codepower account.
- Every new or changed check ships with a negative control shown red before green (CLAUDE.md rule; `references/evidence-discipline.md`).
- The measurement script imports the converter from `scripts/lib/claude-stream-envelope.js`; no test may carry a second, hand-written rebuilder.
- No version bump (the version is held at 3.0.0).

## Change-policy decisions
- Compatibility impact: internal-only until G40 P2. Tasks 1 to 3 add files or add only an export or a fixture field; no dispatch script changes.
- Dependency decision: none (no new package).

## 1. Measured objects: every json caller

### 1.1 The json exits of claude child processes (6 sites, 3 argv shapes plus 2 side branches)

| # | file:line | How it starts | Consumer and fields used | Through the wrapper? |
|---|-----------|---------------|--------------------------|----------------------|
| J1 | `scripts/dispatch-hetero.sh:3949-3953` (`CNATIVE_ARGV`, registry active) | `claude-account.js run --stdout $CCSHIM_ENVELOPE` | See J1-c | Yes (G37 A1) |
| J2 | `scripts/dispatch-hetero.sh:3971` (no registry, seeded config dir) | direct `claude -p ... --output-format json > $CCSHIM_ENVELOPE` | Same as J1-c | No (legacy path) |
| J3 | `scripts/dispatch-hetero.sh:3982` (else branch, `env -u ANTHROPIC_API_KEY`) | direct call, same | Same as J1-c | No (legacy path) |
| J4 | `scripts/qualification-review-provider.js:1550` (`args = ['-p','--model',m,'--output-format','json','--setting-sources','','--strict-mcp-config','--tools','']`; consumer `:1087-1115` `verifyClaudeRuntimeIdentity`) | goes through the wrapper when the account layer is active (`useAccount` after `:1566`, G37 A5) | the whole stdout is strictly `JSON.parse`d; `.result` must be a string; `.is_error`; the key set of `.modelUsage` | Yes (when a registry exists) |
| J5 | `scripts/accounts-onboard.sh:259` (`claude_account run --alias ... -- claude -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config`) | wrapper `--stdout $okf` | only the exit code and `grep -Eq '"is_error": ?false' $okf` (**reads the raw text**, no parse) | Yes |
| J6 | `scripts/benchmark-hook-latency.js:239` (`--allowed-tools Read --output-format json --debug-file --max-budget-usd`; consumer `:258` `JSON.parse(r.stdout).total_cost_usd`) | `accountRail.wrapClaude` | `.total_cost_usd` (a finite non-negative number, otherwise the cap is recorded; used for the stop-loss); `r.stdout` is returned as is | Yes (G37 A8) |
| J7 | `src/engine/profile-runtime.js:565-577` (`claudeArgs` defaults to `'json'` and carries `--bare --verbose`; two json places at `:655/662`, one already stream-json at `:993`) | direct `spawnSync` | `parseRunnerJson` strict JSON.parse, then `assertExactReportedModel` and `usageInputTokens`; the receipt writes `stdout_sha256` (`:1014`) | **No**: `claude-spawn-sites.json` marks it `out_of_scope` (G37 plan 4.1 B2, `--bare` uses API-key billing) |

Notes (scope as decided by D5):
- J7 is unrelated to G40 (no subscription account, so there is no rate_limit_event to collect) and is **excluded from the measurement**; it is listed only so the next reader does not have to look it up again. The one thing it shows: with this CLI version `json + --verbose` is still a single object (`parseRunnerJson` passes). This is side evidence only and does not prove stderr is unchanged.
- J2 and J3 do not go through the wrapper, so G40's passive capture never sees them; C2 helps only J1, J4, J5, J6. Measurement is still per **argv shape**; J1/J2/J3 share profile P1. J2/J3 are not `frozen_legacy` runners (they are the registry-absent branch of a live script), so D5 does not exclude them; capturing observations on them is not part of this plan.
- **D5, frozen_legacy runners: excluded.** They are digest-frozen replay runners under G37 (status `frozen_legacy` in `claude-spawn-sites.json`: `evals/orchestration/run-p2-batch-loop.js`, `evals/orchestration/run-p2-batch.js`, `evals/skill-onoff/run-d0gate-campaign.js`, `evals/skill-onoff/d0gate/cc.js`, and the `evals/skill-onoff/run-skill-onoff-eval*.sh` runners); their bytes are pinned, so they stay outside this measurement and outside C2.
- **D5, eval paths on the live spawn-site list: included.** Two eval sites that use `--output-format json` are `wired` on the live list, so they are in scope: `evals/orchestration/run-orchestration-eval.sh:225/457/475` and `evals/pipeline-bench/run-pipeline-bench.sh:210/322` (through `eval-account`, A12). This plan has **not read their consumed fields line by line**; Task 0 must first add the same field table (new rows J8 and J9) and decide whether their argv shape needs another profile (P4) before Task 4 runs.
- **D5, every eval site not on the live list: excluded**, one line each. Sites with status `out_of_scope` are not live json callers: `evals/skill-onoff/d0gate-v2/cc-v2.js` (cell module whose only caller refuses to start with a registry present), `evals/skill-onoff/d0gate/cc-tasks.js` and `evals/skill-onoff/d0gate/traces.js` (prompt text and fixtures; no process is started), and likewise the other `out_of_scope` rows of `claude-spawn-sites.json`. Task 0 records the final in/out list with the one-line reason per site.
- `scripts/dispatch-review.sh:1965` (claude-native review) and `scripts/dispatch-author.sh:1443` (claude-native author) have **no `--output-format`** in their argv (default text, confirmed with grep). So they are **not json callers**: the C2 rewrite rule must be "convert only when the argv contains the two explicit tokens `--output-format json`", and text calls are never touched (written as one assertion of N9, section 5.4). Their passive observation is outside this plan.
- claude calls that are already streams: `scripts/probe-todo-tools-pin.js:53` and the cc family of the evals (`stream-json --verbose`); they already carry rate_limit_event and need no measurement. `scripts/dispatch-foreman.sh:576-587` is a kimi stream, not claude.

### 1.2 What J1/J2/J3 consume (the "real consumer" used in the measurement)

From `scripts/dispatch-hetero.sh:3992-4032` (the embedded node block, `node - "$CCSHIM_ENVELOPE" "$LOG" <<'NODE'`):
- The whole file is `JSON.parse`d; it must be a non-array object, otherwise `out = raw` (the raw bytes go to LOG).
- If `obj.result` is a string and `trim()` is non-empty, LOG gets `withNl(result)` appended (a newline is added when the text does not end in one).
- Otherwise, if `obj.is_error === true`, take the first non-empty string from `obj.error` / `obj.message` / `obj.error_message` / `obj.errors[]` (`errorText`), or `raw` if there is none.
- Otherwise, if `result` is a string (empty), `withNl(result)`.
- **The LOG content is the only thing downstream sees**; that LOG is later read by the verdict / commit decision. So the text the J1 caller really consumes is the bytes this block writes into LOG.

From `scripts/dispatch-hetero.sh:4283-4320` (`capture_structured_provider_error`, only when `AGENT_EXIT != 0`):
- When `obj.type === 'result' && obj.is_error === true`, take `obj.api_error_status` and accept only 429/503/529/402.
- Note: `.usage` at `:4276` on the envelope path belongs to the **agy** branch, not to cc-shim; on the cc-shim side **nobody reads `.usage` or `.total_cost_usd`** (confirmed with grep in `dispatch-hetero.sh`). Do not list them as required J1 fields.

### 1.3 How the wrapper consumes stdout (where the C2 conversion happens, whoever the caller is)

`scripts/claude-account.js`:
- `execAttempt` (`:433-486`): stdout goes through `createScrubber(token)` (`:158`), which scrubs the token in a stream, is written to `dir/stdout`, and the whole file is read back into `result.stdout` at the end; `emitFinal` (`:488`) writes `stdoutBuf` to the `--stdout` file or to fd 1. **Today the wrapper performs no conversion of the stdout bytes**; C2 is the first.
- `parseEnvelope` (`:379-395`): first a whole-text `JSON.parse`; on failure it looks line by line for the **last** `type==='result'` line. So it **already supports both formats**, and `classifyAttempt` (`:406-431`), which takes `env.is_error`, `env.api_error_status` and `env.result`, **needs no change**.
- `classifyAttempt` failure path: `text = env.result + "\n" + a.stdout + "\n" + a.stderr`, then `slice(0, 8192)` into classify-error; `authStop.scanText(stdout+stderr, {failed:true})` compares the whole stdout line by line against 401-type phrases. With a stream the stdout gets larger (`system init`, assistant lines); `result` comes first so the 8192 cut does not drop it, but extra lines can make scanText misjudge auth_failed **on an already failed call**; this only happens on the failure path and is risk R-E (section 9).
- `scripts/lib/auth-stop.js:130-139`: `claudeJsonFailed` and `claudeStreamFailed` already support the two formats separately.

### 1.4 Existing parsers that can be reused

- `scripts/lib/agy-stream-json.js` **cannot be reused**: it parses the agy format `{"event":"step_update"...}` (`scanStream` `:98`, `parseStream` `:136`), not claude's `{"type":"result"...}`.
- What can be reused or aligned with is `parseEnvelope` of `claude-account.js` (`:379`, last `type=result`) and `lastJsonObjects` of `auth-stop.js`. The new converter must follow the same "take the last result" rule; `parseEnvelope` is already exported (`:1064`), so the tests can use it directly as the oracle.
- `src/engine/profile-runtime.js:853` `summarizeRunnerStream` is a different stream summary (it requires no tool/hook events) with different meaning; not reused.

## 2. Definition of "byte-identical"

### 2.0 The candidate conversion (the thing being measured)

Add `scripts/lib/claude-stream-envelope.js`, exporting `streamToEnvelope(streamText) -> { ok, bytes, reason }`:
- Split stdout on `\n`, find the **last** line that `JSON.parse`s to a non-array object with `type === 'result'`, and return **the raw bytes of that line (not re-serialised after parsing) plus `\n`**.
- With no result line at all: `ok:false`; the caller (the wrapper) must emit the whole stream unchanged (the same as today's "non-JSON stays as is" fallback) and record `stream_envelope=missing` in the audit.
- Why return the raw line instead of re-serialising: as soon as `JSON.stringify` reorders keys or recomputes floats (such as `total_cost_usd`), the bytes can drift. Keeping the raw line leaves one open question only (whether the CLI serialises the same object in both formats).
- The measurement script **imports this function directly**; no test may carry a separate rebuilder (that would be a "shadow derived from the answer", see `references/evidence-discipline.md`).

### 2.1 Zero-cost evidence that exists already (to be redone before measuring, not just cited)

`docs/plans/evidence/2026-09-26-hook-channel-probe/v5/turn1.json` (real json output): one line, compact (no indentation), one `\n` at the end, key order `duration_api_ms, stop_reason, session_id, total_cost_usd, usage, modelUsage, permission_denials, terminal_reason, fast_mode_state, ..., is_error, num_turns, subtype, api_error_status, result, ttft_ms, type, duration_ms, uuid, ...` (**not** alphabetical, `type` is not first). Meaning: if the json result and the stream result line use the same serialiser, key order and compactness will match; if the stream puts `type` first, the bytes differ. That is exactly what Z1 and Z2 check.

### 2.2 Field levels

Comparison is on the recursive key sequence, top level plus nested. Each field falls in one of three levels:

| Level | Fields | Requirement | Reason |
|-------|--------|-------------|--------|
| A: byte-identical (on the serialised string after B is removed) | `type`, `subtype`, `is_error`, `api_error_status`, `result` (including whether a trailing newline exists, leading/trailing whitespace, Unicode escapes), `stop_reason`, `terminal_reason`, `num_turns`, `permission_denials`, the **key set** of `modelUsage`, `fast_mode_state`, `fast_mode_disabled_reason`, and the **name, type and order** of all keys | any J/S difference = FAIL | all are inputs to caller decisions or decide the envelope shape |
| B: may differ (only type and presence compared, value masked) | `duration_ms`, `duration_api_ms`, `ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`, `first_content_frame_ms`, `total_cost_usd`, the numeric values of `usage.*` and `modelUsage.*`, `uuid`, `queued_turn_count`, `result_index` (meaning not verified, treated as volatile), the numeric values of `subagent_stats` | type, presence and order must be the same; the value is not compared | time, cost and token counts vary per call (cache hits, network); not a format difference |
| C: controlled by the harness | `session_id` | profile J1 passes `--session-id <UUID>`: the two arms pass different UUIDs and the harness **verifies the returned value equals the one passed**; for other profiles treat as B | verifies the CLI does not rewrite the id the caller specified |

The B list is **declared in advance**; the J/J control pairs (section 3) provide the empirical check: if an A-level field also differs in a J/J pair, that field is itself volatile, must be reviewed by a person and written into the report (it is not downgraded automatically), so that a green result cannot be bought by loosening the verdict.

### 2.3 The two-layer verdict

- **Layer 1, "field equivalence"**: run the **real consumer code** of each consumer against the J arm and the S arm (the S arm is the output of `streamToEnvelope`) and compare the consumption results:
  - hetero: extract the heredoc content from `dispatch-hetero.sh:3996` up to the end of `NODE` into a temporary js with a script, run it once per arm, and compare **the bytes written into LOG** (including the appended newline); extract the `:4291-4320` block as well and compare the three lines `runner/status/field` (meaningful only on the error arm). Extraction searches for start and end markers; if a marker is not found the measurement script fails (so a change in hetero cannot silently make the test vacuous).
  - wrapper: compare `is_error / api_error_status / result / type` of `parseEnvelope(J.stdout)` and `parseEnvelope(S.stdout)`.
  - qualification: export `verifyClaudeRuntimeIdentity` (it is a module-internal function from `:1087`; **confirm whether it is already exported, and if not, export it as the smallest change of this task**), call it once per arm and compare the return value or the thrown message.
  - onboard: apply the same regex `/"is_error": ?false/` to the bytes of both arms.
  - benchmark: the type of `JSON.parse(stdout).total_cost_usd` is a finite non-negative number (value not compared).
  - Layer 1 PASS: for every consumer the result is **byte-identical** between the two arms (B-level values are output by no consumer, so they do not matter).
- **Layer 2, "byte equivalence"**: compare `J.stdout` with `streamToEnvelope(S.stdout).bytes` as a whole string after masking the B-level values; report one of three results: `identical` (even B is the same, rare), `identical_after_mask`, `differs` (with the first difference position and key path).
- **Decision under D3**: both layers must PASS for the flag to be switched. Layer 2 `differs` is a FAIL even when layer 1 is all PASS (that case means only consumers of the raw text, namely J5's grep and J7's sha256 (J7 is excluded), would have been affected, but the PM ruling is not to ship C2 on field equivalence alone). It is recorded as "fields equivalent, bytes not equivalent, C3 kept".

## 3. Non-determinism: which approach

- **(a) Obtain both formats from one call: not possible.** One process accepts one `--output-format` value; re-running with `--resume` or `--session-id` is just a new conversation turn (new request, new uuid, new cost), not another serialisation of the same response. **Not done.**
- **(b) Run the stream once, rebuild the json shape, compare with "the CLI's json definition in the same session":** there is no real json object to compare against; the "definition" exists only in source code or documentation, neither of which we hold (the documentation gives no guarantee on the field list and order of the json envelope). On its own (b) only proves the rebuilder is self-consistent, **not that it equals json**. The "static check" part is useful, so it becomes the zero-cost prerequisite (Z1/Z2).
- **(c) Fixed short prompt, several runs for a distribution: chosen.** Note: `claude -p` has **no temperature flag** (this plan does not assume one; do not claim "temperature 0" in the measurement). Determinism comes from "one-word prompt, no tools, same model" which makes the output nearly constant, and the residual noise is quantified with control pairs. Design:
  - Each profile runs **5 J/S pairs**: one J and one S per pair, with **interleaved order** (J first in odd pairs, S first in even pairs) to cancel cache warm-up and time drift.
  - Plus **2 J/J control pairs** (the same format twice): measure which fields differ anyway under "same format, same prompt" = the noise floor. The result validates the B list and detects A-level fields that are themselves unstable (the `result` text is the first thing to watch).
  - Comparing the `result` text: the prompt is fixed as `Reply with exactly one word: OK`, and both arms are expected to return `OK`; if the J/J control pair also differs in text, that profile's `result` comparison is recorded as "text drift" and replaced by the **structure** (trailing newline, type) and the stream's internal consistency (the last assistant text equals `result`), and this is marked in the report.
- **Zero-cost prerequisites (before any call; the result decides whether N can shrink):**
  - Z1: redo the static check of section 2.1, collecting every stored json and stream instance in the repo (the files under `docs/plans/evidence/**` that contain `total_cost_usd`), and tabulate "compactness, trailing newline, key order" for the two formats. Existing stream instances can be cut down to the result line and compared with json instances on key sequence (values not compared).
  - Z2: run `strings(1)` on the installed claude binary (the repo has precedent: a comment in `dispatch-hetero.sh` cites a strings check of 2.1.309), looking for whether the serialisation paths of the two formats are a `JSON.stringify` of the same object. If the same object is confirmed, the live arms are only a confirmation and N can drop from 5 to 3; not finding it is not a conclusion, run with N=5.
  - Z3 (optional, a zero-quota arm): a local fake API endpoint (`ANTHROPIC_BASE_URL` pointing to a local server that returns a fixed SSE) so that the model output of the J and S arms is **exactly the same**, removing non-determinism altogether and covering the 401/429/529 error envelopes. Feasibility is **not verified** (whether the auth mode and the CLI start-up checks accept a fake endpoint is unknown); it is a spike. If feasible it supplements the error-path calls of section 4.4. Z3 does not replace the live arm (it does not cover real API fields; for example rate_limit_event depends on real headers).

## 4. Sample and quota

### 4.1 argv profiles (grouped by CLI flags, not by caller)

The envelope shape is a property of the CLI; callers affect it only through flags. J1 to J6 merge into 4 profiles:

| Profile | Representative | Fixed flags (identical on both arms, only `--output-format` differs) | Why separate |
|---------|----------------|----------------------------------------------------------------------|--------------|
| P1a | J1/J2/J3 hetero, turn without tools | `-p --session-id <uuid> --model haiku --strict-mcp-config --dangerously-skip-permissions --effort low` | the real hetero shape; whether `--effort` changes the envelope must be visible |
| P1b | the multi-turn shape of J1 + J6 | same as P1a plus `--allowed-tools Read`, and the prompt becomes "Read the first line of a small file inside the repo, then answer OK" | a chance for `num_turns>1`, several `usage.iterations` entries and non-empty `permission_denials`, to verify the "last result" rule |
| P2 | J4 qualification | `-p --model haiku --setting-sources '' --strict-mcp-config --tools ''` | has the `modelUsage` identity check, and `--tools ''` |
| P3 | J5 onboard | `-p "say OK" --model haiku --tools "" --strict-mcp-config` | reads the raw text with grep, so the bytes must be verified |

The assumption that `--max-budget-usd`, `--debug-file` and `--setting-sources ''` of J6 do not change the envelope field shape is **folded into one extra sample of P1b** (one of the 5 pairs of P1b carries `--max-budget-usd 0.5`) rather than opening a profile; if the result differs, open P4. (If Task 0 finds that the eval sites added by D5 need another argv shape, the same P4 rule applies.)

The S-arm argv equals the J-arm argv **with only** `--output-format json` replaced by `--output-format stream-json --verbose`; before running, the harness asserts by script that, after removing these three tokens, the two argvs are identical (to prevent an accidentally added flag).

### 4.2 Call count

| Profile | J/S pairs | J/J control pairs | Calls |
|---------|-----------|-------------------|-------|
| P1a | 5 | 2 | (5x2) + (2x2) = 14 |
| P1b | 5 | 2 | 14 |
| P2 | 5 | 2 | 14 |
| P3 | 5 | 2 | 14 |
| Subtotal | 20 pairs | 8 pairs | **56** |
| Error path (D2, section 4.4) | 1 J/S pair | 0 | **+2** |
| **Total** | | | **58** |

If Z2 confirms same-object serialisation, the matrix drops to 3 pairs plus 1 control pair per profile = 32 calls, and with the error-path pair 34. Estimated cost: a haiku one-word call without tools costs a few thousandths of a dollar (reference: plan V6, 0.0034 USD per probe); P1b with Read is somewhat higher; **counted in API-equivalent book value the total is within 0.3 USD**, and the subscription quota use is measured as utilization before and after one alias (section 4.3).

### 4.3 Account and quota rules (written into the script, not only the document)

- Always go through `node scripts/claude-account.js run --alias <A> --purpose streamjson-measure --stdin <prompt> --stdout <f> --stderr <f> -- claude ...` (the purpose must first be confirmed to be accepted by `checkPurpose`; if it is not, it must be registered in the wrapper first, a smallest change listed in the Input of Task 2). The wrapper reads the token; the measurement script and this lane **do not read, print or move any credential**; only the alias name and the path `token_path` are recorded, never a value.
- **Alias (D1, decided):** a default registered Claude alias, using haiku. No operator card is needed because the operator authorised live tests on all subscription accounts on 2026-11-04. **The codepower weekly account must not be used**: the script rejects by a name pattern (the pattern comes from a parameter and no account name is hard-coded in the repo; any alias whose name contains `codepower` is rejected by default).
- **Quota floor (D1, decided):** before the run and every 10 calls, read the quota mirror (`readQuota` in `scripts/lib/account-quota.js`); if any window has utilization >= 0.80, or `unknown` for more than 6 hours, pause with the exit code `skipped_near_cap` and leave a resume file (`resume.json`, section 5). **Do not retry 429**; on a 429 stop the whole batch at once.
- Do not run on an alias in use (from section 19.3 of the G40 plan, the first two items: no wrapper audit record in the last 5.5 hours, and the operator confirms nobody is using it).

### 4.4 Error-path arm (D2, decided: two real calls are added)

The success-path measurement cannot cover the `is_error:true` envelope, `api_error_status`, the 8192 truncation of `classifyAttempt`, and the scanText misjudgment (R-E). Three layers, all in:
- Zero calls: the **claude-shim fixture** (`scripts/lib/account-fixtures/claude-shim.js`) extended in N9; its shape comes from our assumption, not from real CLI output.
- Zero quota, optional: if Z3 is feasible, a fake endpoint produces the real CLI's error envelopes (401/429/529).
- **Real calls, +2 (D2, decided):** trigger one `is_error` with a non-existent model name (for example `--model no-such-model`), one J call and one S call. The request is rejected, so it burns no quota. The argv shape is that of P1a with the model replaced.

## 5. Deliverable: the measurement script

### 5.1 `scripts/measure-streamjson-equivalence.js` (Node >= 20.10, built-ins only, per the CLAUDE.md language rule)

Subcommands:
- `plan --profiles P1a,P1b,P2,P3 --pairs 5 --control-pairs 2 [--json]`: print the run matrix and argv only (zero calls), including the argv difference assertion.
- `run --alias <A> --profile <P> --pairs N --control-pairs M --out <dir> [--deny-alias-pattern codepower] [--max-util 0.80] [--resume]`: real calls (may only be run by a session the operator named); the quota is checked before every call and the files are written right after; `--resume` reads `resume.json` and skips the runs already done.
- `analyze --in <dir> --out <report.json> [--md <report.md>]`: reads files only, zero calls, produces the verdict.
- `selftest`: the zero-call negative-control suite (section 6); exit non-zero if any of them did not turn red.
- Exit codes: 0 PASS; 1 FAIL (a field / consumer / stderr / exit-code difference); 2 usage error; 3 a negative control did not turn red (the instrument is broken); 4 `skipped_near_cap`; 5 aborted by 429 or an auth failure.

### 5.2 Output file format

```
<out>/
  meta.json                      claude --version, argv-shape hash, alias name (no token), token_path (path only), start time (Taipei time and epoch), script git sha
  <profile>/<pairId>-<arm>.stdout       arm in J1|J2|S1|S2 (J/S pairs use J,S; control pairs use J1,J2)
  <profile>/<pairId>-<arm>.stderr
  <profile>/<pairId>-<arm>.run.json     { exit, argv_digest, order_index, started_at, duration_ms_wall, util_before:{five_hour,seven_day} }
  resume.json                    list of finished run ids and the next id to run
  report.json                    see below
```

`report.json` (`schema_version: 1`):
```
{ verdict: "PASS"|"FAIL"|"INCONCLUSIVE",
  claude_version, runs_total, runs_failed,
  profiles: { P1a: { pairs, layer1:{ hetero_log_bytes:"equal"|"differs", wrapper_parse:..., qualification:..., onboard_grep:..., benchmark_cost_type:... },
                      layer2:{ result:"identical"|"identical_after_mask"|"differs", first_diff_path, key_order:"same"|"differs" },
                      exit_codes:"equal"|"differs", stderr:"equal"|"differs", stderr_nonempty:bool,
                      noise_floor:{ fields_differing_in_control_pairs:[...] },
                      stream:{ rate_limit_event_runs:int, system_init_present:bool } },
              ... },
  negative_controls: { R1:"red", ... },
  notes:[...] }
```
`rate_limit_event_runs` records only presence or absence and the count of occurrences (this is the signal G40 really wants; the value is not a secret but this report does not store utilization numbers, to avoid confusion with section 19 of the G40 plan). The report and the raw files **must not contain a token, email or organisation id**; `session_id` and `uuid` are replaced by a fixed placeholder before the files leave the scratch directory (in the evidence copy only; the originals are kept for re-analysis), and before check-in run `node scripts/leak-guard.js` and `scripts/redact-personal.js` (the evidence check-in path convention is `docs/plans/evidence/<date>-streamjson-equivalence/`).

### 5.3 Verdict rules

- **PASS** (all hold):
  1. for each profile the layer-1 consumer results are byte-identical between the J and S arms;
  2. for each profile the layer-2 result is `identical` or `identical_after_mask` and `key_order` is `same` (D3: layer 2 is part of the flip condition);
  3. for each profile the exit codes are the same on both arms (the precondition of N9);
  4. stderr is byte-identical on both arms (both are expected to be empty; when non-empty compare byte by byte); if `--verbose` adds any byte to stderr that is a FAIL (the C2 precondition of G40 plan 5.1 says explicitly that stderr must be verified);
  5. the key names, types and order of the A-level fields are the same on both arms;
  6. no A-level field differs in the J/J control pairs (otherwise INCONCLUSIVE, needs a person to review);
  7. `selftest` has every negative control red;
  8. no profile was skipped for quota (otherwise INCONCLUSIVE, resume to complete);
  9. the error-path pair (section 4.4) gives the same layer-1 consumer results and the same exit code on both arms.
- **On PASS (D3):** the config flag of C2 may be switched to stream-json. The flag is shipped with default json; the switch is the PM's act after reading the report, not an automatic effect of this plan.
- **FAIL: fixed action (no further meeting needed; D3):** use C3: keep `--output-format json` and leave the C2 flag off. G40's `quota_stream_transform` (provisional name; the PM fixes it in G40 P2) is not shipped; the first diverging profile, the field path and one de-identified sample of each arm are written into the evidence; BL-0372 is closed as "not equivalent, C3 kept" and the C2 status in plan 5.1 / 18.6 of the G40 plan is updated; G40's agent lane then relies on the probe only (section 18.6 of the G40 plan already prepares this branch). A divergence that appears **only** in the byte layer while layer 1 is all PASS is also a FAIL (section 2.3, D3).
- **INCONCLUSIVE:** quota short, 429, an unstable noise floor, or a version change in the middle of the measurement (`claude --version` differs before and after) means no conclusion is drawn and the run is repeated.

### 5.4 How N9 is adjusted when G40's wrapper changes format

The current N9 (G40 plan section 14, `:247`): "a stream argv records any event; a json argv records nothing; a bad event is discarded; in every case exit code and stdout bytes equal those without capture". After the measurement PASSes and C2 is adopted (flag on) it splits into:

- N9a (flag off, the default): json argv is not rewritten, nothing is recorded, stdout bytes equal today's (the original json branch of N9 is kept as is).
- N9b (flag on): a json argv is rewritten to `stream-json --verbose`; the fixture child answers with a stream (including `rate_limit_event`) and one record is written; **the stdout bytes the caller gets equal the envelope the shim returns in json mode** (the same result fixture generates both formats, see T3); the exit code is the same.
- N9c (flag on): an argv **without** the two explicit tokens `--output-format json` (for example the text calls of review/author, or no output-format) is never rewritten (the rule of section 1.1).
- N9d (flag on): no result line in the stream (fixture) means the whole stdout is output unchanged, the audit has `stream_envelope=missing`, nothing is recorded, the exit code is unchanged.
- N9e (flag on): a failure envelope (`is_error:true`, `api_error_status:429`): the outcome of `classifyAttempt` after conversion is the same as with the flag off (run once with the stream fixture and once with the json fixture and compare the outcomes item by item); and one more: init / assistant lines in the stream that contain 401 text while the result succeeded must not be judged auth_failed.
- N9f: a `rate_limit_event` with bad JSON is discarded and counted, all other behaviour is unchanged (the bad-event branch of the original N9).
- Tests that need no change: `scripts/dispatch-hetero-account.test.js:135` and `:228` assert that "argv contains `--output-format json`"; C2 rewrites inside the wrapper and the caller's argv does not change, so these assertions stay valid (this is one of the benefits of choosing C2 over C1; C1 would require changing the parsers and tests of hetero / qualification / onboard / benchmark one by one).
- Every new assertion must first be shown red and then green (the CLAUDE.md negative-control rule).

## 6. Red cases (negative controls)

All live in `selftest` (and `scripts/lib/claude-stream-envelope.test.js`); each one **feeds a deliberately broken rebuilder (or instrument) into the real consumer code and the comparer**, and it must be caught (turn red) and be listed under `negative_controls` in the report. Red-then-green order proof: first run the broken version to get red, then the correct version to get green, and store both outputs.

| ID | What is broken | Expected to be caught by |
|----|----------------|--------------------------|
| R1 | the rebuilder drops the trailing `\n` | layer 2 `differs`; the layer-1 hetero LOG bytes are the same (`withNl` adds it) so **only layer 2 sees** this kind of defect |
| R2 | the rebuilder takes the **first** `type=result` (the fixture holds two results: first `is_error:false`, then the final line) | layer 1 wrapper parse and hetero LOG both red |
| R3 | the rebuilder takes the text of the last `assistant` event instead of the result line | layer 1 red (`is_error` / `modelUsage` missing; `verifyClaudeRuntimeIdentity` of J4 throws) |
| R4 | the rebuilder `trim()`s the `result` string | layer-1 hetero LOG red (the fixture result has a leading blank line) and layer 2 red |
| R5 | the rebuilder re-serialises after parsing with `JSON.stringify(obj, null, 2)` | layer 2 red (compactness and indentation differ); `JSON.parse`-type consumers in layer 1 green, the grep of J5 and the raw path of hetero may be red, which shows the division of work between the two layers |
| R6 | the rebuilder reorders keys (moves `type` to the front) | layer 2 `key_order` red, layer 1 all green |
| R7 | inject 1 byte into the stderr of the S arm | stderr comparison red |
| R8 | change the exit code to a different one | exit-code comparison red |
| R9 | change the A-level field `num_turns` on the S arm | layer 2 red (shows the A-level fields are not let through by the masking rules by mistake) |
| R10 | change a B-level field (`duration_ms`) | **must not turn red** (positive control: masking lets through only declared fields); also, changing one **undeclared field** must turn red |
| R11 | the alias name of `run` contains `codepower` | `run` exits non-zero with zero calls (claude-shim call count = 0) |
| R12 | the quota mirror shows utilization 0.85 | `run` exits with code 4 and zero calls |
| R13 | the NODE block marker of hetero is renamed (on a fixture copy) | extraction fails, the script exits 3 (the instrument must not silently become empty) |

## 7. Task breakdown (six elements)

### Task 0: zero-cost prerequisites (Z1, Z2, Z3 spike) and the D5 scope table
- **Goal**: obtain, without spending quota, the static evidence on "are the two formats serialised the same", judge whether the fake-API arm is feasible, and close the D5 scope list.
- **Scope**: read-only analysis; the output goes to scratch / an evidence draft; no repo program is changed. Z2 reads the installed claude binary (`strings` only); Z3 uses a local server outside the shim. D5: read the consumed fields of the live-list eval json callers (J8 `evals/orchestration/run-orchestration-eval.sh`, J9 `evals/pipeline-bench/run-pipeline-bench.sh`) and write the same field table; list every other eval site as excluded with a one-line reason; decide whether a profile P4 is needed.
- **Input**: the files under `docs/plans/evidence/**` that contain `total_cost_usd` (`2026-09-26-hook-channel-probe/v5/turn1.json` and others); G40 plan section 19.4 E7; the 2.1.309 strings-check comment in `dispatch-hetero.sh`; `claude --version`; `scripts/lib/claude-spawn-sites.json`.
- **Output**: `z-report.md`: a comparison table of compactness / trailing newline / key order for json and stream; the conclusion on the binary's serialisation path (same object / uncertain); Z3 feasibility (feasible / not feasible + reason); the recommended N (5 or 3); the D5 in/out list with a one-line reason per site.
- **Acceptance**: every conclusion carries a file path or command output; "uncertain" must be written as such, a guess must not stand as a conclusion; there is no claude call (self-check against the shell history; if Z3 starts a claude process against the fake endpoint, mark that it is a local call at zero quota).
- **Boundaries**: do not read or print credentials; do not change the repo; do not touch the codepower account; do not install any package.

### Task 1: `scripts/lib/claude-stream-envelope.js` plus unit tests (before the measurement)
- **Goal**: provide the measured conversion `streamToEnvelope` and make R1 to R6 turn red at the unit level.
- **Scope**: add `scripts/lib/claude-stream-envelope.js` and `scripts/lib/claude-stream-envelope.test.js`; if `verifyClaudeRuntimeIdentity` is not exported, `scripts/qualification-review-provider.js` only gets an export (behaviour unchanged).
- **Input**: the specification of section 2.0; `parseEnvelope` at `claude-account.js:379`; fixtures taken from Task 0 or handwritten (a handwritten one states its source and "not real output").
- **Output**: the function and its tests; add the base name to the group list `Shared JSON & store primitives` in `CLAUDE.md`; one row in `docs/scripts-inventory.md`; a paragraph in the related reference (the four wiring places of CLAUDE.md "When adding a new script").
- **Acceptance**: the tests cover "several results, take the last", "no result gives ok:false", "trailing newline", "contains CRLF", "huge line (>64 KiB, not through a pipe, per the node-exit-truncates-pipe-stdout lesson)"; every broken variant goes red then green and the outputs are stored; `node scripts/check-claude-md-inventory.js` passes.
- **Boundaries**: **do not** change `claude-account.js` (that is G40 P2); do not change any dispatch script; do not bump the version (held at 3.0.0); JS uses built-ins only.

### Task 2: `scripts/measure-streamjson-equivalence.js` (plan / run / analyze / selftest)
- **Goal**: implement the instrument of section 5, so that `selftest` runs R1 to R13 with zero calls.
- **Scope**: `scripts/measure-streamjson-equivalence.js` (new), `scripts/measure-streamjson-equivalence.test.js` (new); in `scripts/claude-account.js`, only if `checkPurpose` does not accept `streamjson-measure`, add that purpose string only (confirm first and say so in the PR description).
- **Input**: the function of Task 1; the field table of section 1; the field levels of section 2.2; the CLI interface and exit codes of `claude-account.js`; `readQuota` in `scripts/lib/account-quota.js`.
- **Output**: the script, its tests, one row in `docs/scripts-inventory.md`, and the base name added to the CLAUDE.md group list (`Verification & review synthesis`).
- **Acceptance**: `selftest` exits 0 with R1 to R13 all red (the positive control of R10 green); the argv difference assertion of `plan` fails on a handmade bad argv; `analyze` gives the expected verdict on fixture directories (two identical arms, and one case for each R series); every `run` path is verified with the claude-shim for call count, alias rejection and the quota gate; no test may use a real claude.
- **Boundaries**: import no network program; `run` does not read the token file; do not write `~/.claude` or credential paths; do not change the hetero / review / author scripts; the hetero NODE block is only **read and extracted**, never modified.

### Task 3: dual-format fixture in `claude-shim.js` (parallel with Tasks 1 and 2)
- **Goal**: make the shim return json or stream depending on `--output-format` in argv, both generated from the same result fixture, for N9b / N9e.
- **Scope**: `scripts/lib/account-fixtures/claude-shim.js`, `scripts/lib/account-fixtures/shim-install.js`, and their test `shim-install.test.js`.
- **Input**: the current state: the response is one static `stdout` string per control (header comment `:1-20`); the N9 list of section 5.4.
- **Output**: controls gain a `result` object field (when present the shim produces both formats itself, including `system init`, assistant, `rate_limit_event` and the final result); the old static `stdout` path stays **unchanged in behaviour**.
- **Acceptance**: the existing `scripts/account-rails*.test.js`, `scripts/dispatch-hetero-account.test.js` and `scripts/eval-account-rails.test.js` all stay green (judged with `scripts/affected-suites.js --run`); new assertion: with the same `result` fixture the last line of the stream equals the json output byte for byte (apart from the `\n` difference); a broken variant (the shim produces different results in the two formats) is caught by the test.
- **Boundaries**: the shim still does not read real credentials and does not print a token (the leak mode is kept); do not change `claude-account.js`.

### Task 4: the live run (operator authorisation already given for subscription live tests; not a hands lane)
- **Goal**: run the matrix of section 4.2 on a default registered Claude alias and obtain the raw files.
- **Scope**: only run `measure-streamjson-equivalence.js run`; the output is in a session scratch directory.
- **Input**: Tasks 0, 1, 2 and 3 are done; the quota rules of section 4.3 (utilization >= 0.80 skips); the idle precondition of G40 plan section 19.3; `claude --version`.
- **Output**: the raw files under `<out>/` and `resume.json`.
- **Acceptance**: the 58 calls (56 matrix + 2 error path; or the number reduced by Task 0 plus 2) all complete, or stop explicitly with `skipped_near_cap` / 429 and can be resumed; `meta.json` contains only the alias name and the token path (no value).
- **Boundaries**: do not use the codepower weekly account; do not use an alias in use; do not retry 429; do not change the repo; do not move, copy or read credential files; stop at once if `claude --version` changes in the middle.

### Task 5: analysis, evidence, closing the decision
- **Goal**: produce `report.json` / `report.md`, give PASS / FAIL / INCONCLUSIVE, and update the C2 status in BL-0372 and the G40 plan.
- **Scope**: `docs/plans/evidence/<date>-streamjson-equivalence/` (the de-identified copy), `project/backlog/bl-ap-streamjson-result-bytes.md` and the matching row of `project/backlog/BACKLOG.md`, the C2 status sentence in sections 5.1 / 18.6 of the G40 plan.
- **Input**: the raw files of Task 4; `node scripts/leak-guard.js`, `scripts/redact-personal.js`.
- **Output**: the report, the evidence, the backlog update (per the "archive the backlog right after merging" convention).
- **Acceptance**: running `analyze` again gives the same report (deterministic); the evidence has no token / email / org id / session_id; on FAIL the record that C3 is kept is complete; on PASS list the functions G40 P2 must wire and N9a to N9f.
- **Boundaries**: do not switch the flag (that is the PM's act after the report; D3); do not change G40 code; do not bump the version.

## 8. Order, rollback, open decisions

- Parallel: Tasks 0, 1 and 3 can start together (no shared files). Task 2 depends on Task 1 (import); Task 2 and Task 3 can run in parallel, but the tests of Task 2 need the shim of Task 3 (or the existing static shim can be used first for the argv / quota part).
- Sequential: Task 4 depends on 0, 1, 2, 3; Task 5 depends on 4.
- Critical path: 1, 2, 4, 5. The real wall-clock bottleneck is the alias idle condition (Task 4); each code task is small.
- Rollback: Tasks 1 to 3 are all new files or purely incremental changes, so rollback = revert that task's commit (one commit per task, record the sha before committing; after a rollback verify with `node scripts/affected-suites.js --run`). Task 3 touches the existing shim and is the only one with behaviour risk; its old path has a regression test; if it fails, revert Task 3 alone and Tasks 1 and 2 still work with static fixtures. Task 4 has no repo state to roll back (scratch files only); quota already spent cannot be recovered, hence `--max-util` and per-call file writes. The Task 5 FAIL branch changes no program, only documents and the backlog.
- Decided (see "PM decisions"): D1, D2, D3, D5.
- Open: **D4 (PM)**: confirm that J7 (`profile-runtime`, `--bare`, API-key billing) is permanently excluded; including it needs a separate plan. Until ruled on, it stays excluded as drafted. **D6 (PM, minor)**: whether `purpose=streamjson-measure` must be registered in the wrapper's purpose allow-list (the smallest change of Task 2), or one of the existing purposes is used instead.

## 9. Risks

| Risk | Likelihood | Impact | Handling |
|------|-----------|--------|----------|
| R-A The json and stream result lines are assumed to be the same object, but a CLI upgrade changes that | M | H | the report is bound to `claude --version`; before C2 ships there must be a design "convert only on a verified version list, keep json on any other version" (G40 P2's business, together with the D3 flag); `selftest` and Task 4 can be re-run, one run is about 58 calls |
| R-B Text drift in `result` even with a one-word prompt | L | M | J/J control pairs measure the noise; on drift judge on structure plus the stream's internal consistency and mark it (section 3) |
| R-C `--verbose` changes stderr (a precondition of C2 in G40 plan 5.1) | M | M | byte-by-byte stderr comparison, any difference is a FAIL; where the stderr of hetero goes and who consumes it was not confirmed in this reading (inside `run_worker`); before Task 4 confirm whether stderr enters LOG |
| R-D The sample is small (5 pairs per profile) and misses an occasional difference (for example one that appears only with several turns, compaction or hook events) | M | M | P1b covers several turns; state plainly "PASS means no difference seen on these profiles and this version", not a universal claim; hook events, `--include-partial-messages` and compaction turns are not in the sample and are accepted, trigger = any consumer starting to use those features |
| R-E The conversion misjudges on the failure path (the 8192 truncation of classifyAttempt for a stream, `scanText` seeing 401 text in init / assistant lines) | M | M | the error-path pair (D2, section 4.4) plus N9e; `env.result` is first in the text so truncation does not eat it |
| R-F Quota: the subscription alias is near its cap, or the operator suddenly uses it | M | L | `--max-util 0.80`, `skipped_near_cap`, the resume file; no retry on 429 |
| R-G A credential leaks into evidence (the `system init` event of the stream contains cwd, mcp, `apiKeySource` and so on) | L | H | the raw S-arm files are not checked in; the check-in copy stores only the report and an extracted field table; `leak-guard.js` plus `redact-personal.js`; the wrapper's scrubber already scrubs the token at the `execAttempt` level |
| R-H The measurement function and the real C2 implementation diverge (a shadow) | M | H | the measurement imports the function of Task 1; G40 P2 also imports the same file (the acceptance condition is written into the Input of G40 P2) |
| R-I J2 and J3 do not go through the wrapper, so C2 has no effect on them, leaving "G40 observation on the legacy path still 0" | H | L | a known scope (with no registry the account layer is not used anyway); section 1.1 |
| R-J The stream output is large (init lists all tools), changing the `--stdout` file, the wrapper's memory and the behaviour of `wait_output_quiescent` | L | L | after conversion the caller gets one line only; the wrapper already reads the whole file (`execAttempt`), tens of KB; T4 records the stdout size of the S arm |

## 10. Out of scope

- J7 (`src/engine/profile-runtime.js`) and every `frozen_legacy` runner (D5).
- Eval sites not on the live spawn-site list (D5).
- Text-mode calls of `scripts/dispatch-review.sh` and `scripts/dispatch-author.sh` (not json callers).
- Hook events, `--include-partial-messages` and compaction turns (accepted under R-D).
- Any change to `claude-account.js`, dispatch scripts or G40 code in this plan's tasks 0 to 5 (that is G40 P2).

## 11. Handoff

Next consumer: PARALLEL_DISPATCH, after G40 P1 (Tasks 0, 1 and 3 together; Task 2 after 1; Task 4 when the alias is idle; Task 5 last).
Routing rationale: the first three tasks share no files and each has its own acceptance; the live run is the only step that needs a credential-using session and is not a hands lane.
Remaining risks: R-A, R-C and R-D are accepted-with-trigger; where stderr goes in hetero and the current behaviour of `claude-shim.js` were read only at the header-comment level, so Tasks 0 and 3 must read them in full before starting; the consumed fields of the live-list eval json callers (J8, J9) are not yet read (Task 0).

## Review log

- R0 (2026-11-04): author draft translated into this plan from the measurement scheme written against develop `a44ea9a6a`; no review generation has run yet. PM decisions D1, D2, D3, D5 recorded above.

## Appendix: evidence read

- `project/backlog/bl-ap-streamjson-result-bytes.md` (whole file, three lines)
- `project/plans/2026-11-03-g40-agent-lane-quota.md` section 5.1, section 14 N9 (`:247`), section 18.6 (`:371-377`), section 19 (`:379-451`)
- `scripts/dispatch-hetero.sh:3949-3953, 3971, 3982, 3992-4032, 4283-4320` (`:4276` is the agy branch)
- `scripts/claude-account.js:158-199, 379-486, 488, 1064`
- `scripts/qualification-review-provider.js:1087-1115, 1547-1552`
- `scripts/accounts-onboard.sh:257-261`, `scripts/benchmark-hook-latency.js:235-262`
- `src/engine/profile-runtime.js:565-577, 623-630, 650-700, 853-883, 985-1015`
- `scripts/lib/auth-stop.js:96-139`, `scripts/lib/agy-stream-json.js` (confirmed not reusable)
- `scripts/lib/claude-spawn-sites.json` (`profile-runtime` out_of_scope; the rest wired or frozen_legacy)
- `scripts/dispatch-review.sh:1965`, `scripts/dispatch-author.sh:1443` (no `--output-format`)
- `docs/plans/evidence/2026-09-26-hook-channel-probe/v5/turn1.json` (json instance: compact, one line, trailing `\n`)
