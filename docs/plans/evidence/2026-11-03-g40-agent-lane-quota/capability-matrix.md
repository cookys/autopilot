# G40 capability matrix: quota visibility of 10 providers

- Date: 2026-11-04 (survey run 2026-11-03 UTC; Taipei time ~ 00:00-00:15 on 11-04)
- Raw evidence: `survey-raw/<provider>.txt` (help text, live outputs; identifiers redacted). Provider -> file: agy, grok, codex, claude (claude code), qoder (qodercli and qoderclicn), opencode, kimi, glm, minimax.
- Matrix drafted by codex (`dispatch-author --runner codex --model gpt-6-astra --effort low`, 321 s, status authored); every cell then verified by hand (see 核對).
- Live probing authorised by the operator ("all our harnesses are subscriptions"); one-word prompt, cheapest model, accounts at/near limit skipped (kimi weekly 429, opencode-go limit exceeded). No credential value was read or printed; only paths / variable names recorded.
- Summary of levels: codex L3 (weekly only observed), claude L3, minimax L3, glm L2 (undocumented endpoint, window kinds inferred), qoder L2 (vendor SDK only, not live-verified; headless L0), qoder-cli-cn L0 (observed), kimi L1, opencode L1 (opencode-go), agy L0, grok L0.

## 核對 (hand verification of the codex draft)

- Mechanical: all 68 `file.txt, ### header` citations resolve to a real header line in survey-raw (0 missing); all 6 URLs cited appear verbatim in the evidence. The two vendor URLs minimax FAQ and qoder cost-usage were opened with WebFetch and quoted correctly (minimax doc endpoint is `/v1/token_plan/remains`, which a search snippet had wrongly shown as `coding_plan/remains`; the live GET on the documented one returned 200). kimi membership page seen via WebSearch result only (not opened): treated as search-snippet-level, marked below.
- Semantic spot checks passed: codex `payload.type=token_count` + `rate_limits.primary.{used_percent,window_minutes=10080,resets_at}`; minimax utilization 1-0.88=0.12; qoder `modelUsage.qfmodel.credits` exists; grok `--max-turns` exists in help; claude `rate_limit_event` weekly only in the live event.
- Corrections applied (3): (1) qoder-cli-cn version now has a first-hand source; (2) glm monitor GET auth scheme changed from UNKNOWN to "bare token, no Bearer" (observed); (3) opencode "source 429" annotated, the log text is not an HTTP 429.
- Downgrade note: kimi window kinds (weekly / rolling 5h / monthly) rest on a search-result summary of https://www.kimi.com/code/docs/en/kimi-code/membership that I did not open; treat as vendor-documented-unverified.
- glm window kinds stay UNKNOWN (unit/number mapping inferred only; third-party sources say a 5 hour token limit and a weekly token limit).
- Calls spent per provider (est. cost): claude 1 (USD 0.0034); codex 1 (20k input tokens, subscription); grok 1 (USD 0.0986, agent wandered 5 turns, run from a non-empty dir; plus 1 rejected flag call); agy 1; qodercli 1 + 1 failed /usage (0 credits); qoderclicn 1 + 1 failed /usage (0 credits); opencode 2 (rejected, limit exceeded); kimi 2 (429); glm 1 messages + 1 quota GET (21 tokens); minimax 1 messages + 1 quota GET (57 tokens).
- starts_window: no experiment run on any provider (no account confirmed idle). Claude: account in active use, needs an idle alias.

## Matrix (codex draft with corrections)

Levels describe quota visibility supported by the supplied evidence, not session token accounting. Passive extraction from an existing record requires no additional model call but may be stale. Percentage values must be normalized to utilization `0–1`; missing windows must not be interpreted as unused quota.

## agy

- 1. CLI: `agy`; `agy --version` → `1.4.12`. -- SRC: agy.txt, ### agy agy --version
- 2. passive: No quota information observed in the live stream. `result.usage` contains call token counts only; the full-stream search found no quota, limit, remaining, or reset fields. -- SRC: agy.txt, ### LIVE: grep of whole stream for quota|limit|remaining|reset: none. Events seen: init, step_update, result.
- 3. zero-token endpoint/subcommand/header for usage: UNKNOWN — no quota interface established; `agy usage --help` and `agy status --help` returned general help. -- SRC: agy.txt, ### agy agy usage --help; agy.txt, ### agy agy status --help
- 4. tinyprobe: Observed candidate: `agy -p ok --model gemini-3.8-flash-low --output-format stream-json`, from an empty directory; 6,887 input and 9 output tokens. Monetary cost and cheapest-model ranking: UNKNOWN — no pricing comparison supplied. -- SRC: agy.txt, ### LIVE call 1 (agy -p ok --model gemini-3.8-flash-low --output-format stream-json, cwd empty dir): result event
- 5. window kinds and resets_at: UNKNOWN — no window or reset information observed. -- SRC: agy.txt, ### LIVE: grep of whole stream for quota|limit|remaining|reset: none. Events seen: init, step_update, result.
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: UNKNOWN — agy credential storage was not verified; an existing `~/.gemini` directory does not establish it. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — no expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L0 within the observed evidence: token accounting only. Cheapest quota extraction: UNKNOWN — no working quota source established. -- SRC: agy.txt, ### LIVE: grep of whole stream for quota|limit|remaining|reset: none. Events seen: init, step_update, result.

## grok

- 1. CLI: `grok`; `grok --version` → `grok 1.0.70 (f50904eaee6c) [stable]`. -- SRC: grok.txt, ### grok grok --version
- 2. passive: No quota fields observed in the full live stream. Final-event `usage`, `total_cost_usd`, and `modelUsage` describe consumption, not account quota. -- SRC: grok.txt, ### LIVE call 1 (grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search): final event keys
- 3. zero-token endpoint/subcommand/header for usage: `grok usage <SESSION_ID> [TURN]` reads persisted token/cost accounting without a model prompt. Account-quota interface: UNKNOWN — this command is session accounting only; remote authentication is not specified for this local read. -- SRC: grok.txt, ### grok grok usage --help
- 4. tinyprobe: Observed candidate: `grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search`; USD `0.09860136` across 5 turns. The evidence recommends an empty directory; help also exposes `--max-turns <N>`, but a bounded probe’s cost and cheapest ranking are UNKNOWN. -- SRC: grok.txt, ### LIVE call 1 (grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search): final event keys; grok.txt, ### grok grok --help
- 5. window kinds and resets_at: UNKNOWN — no quota windows or reset fields observed. -- SRC: grok.txt, ### LIVE call 1 (grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search): final event keys
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: `~/.grok/auth.json`, observed mode `600`. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — login state establishes no expiry period. -- SRC: operator-brief
- 9. visibility level: L0 within the observed evidence: session usage and cost only. Cheapest quota extraction: UNKNOWN — `grok usage` does not establish remaining quota. -- SRC: grok.txt, ### grok grok usage --help; grok.txt, ### LIVE call 1 (grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search): final event keys

## codex

- 1. CLI: `codex`; `codex --version` → `codex-cli 0.166.0`. -- SRC: codex.txt, ### codex codex --version
- 2. passive: Yes, observed in `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`, on `payload.type=token_count`: `payload.rate_limits.primary.{used_percent,window_minutes,resets_at}`; also `payload.rate_limits.secondary` and `payload.rate_limits.credits.{has_credits,unlimited,balance}`. The live primary utilization is `17.0 / 100 = 0.17`; stdout `turn.completed.usage` contains token accounting only. -- SRC: codex.txt, ### LIVE rollout file (newest ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl), line containing rate_limits; payload.rate_limits =; codex.txt, ### LIVE call 1 (codex exec --json -s read-only -m gpt-6-astra -c model_reasoning_effort=low ok): stdout turn.completed
- 3. zero-token endpoint/subcommand/header for usage: UNKNOWN — no quota endpoint or usage subcommand supplied. `codex login status` verifies ChatGPT login only. Reading the existing rollout is a zero-additional-token passive alternative. -- SRC: codex.txt, ### LIVE(zero-token) codex login status; codex.txt, ### LIVE rollout file (newest ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl), line containing rate_limits; payload.rate_limits =
- 4. tinyprobe: Observed candidate: `codex exec --json -s read-only -m gpt-6-astra -c model_reasoning_effort=low ok`; 20,212 input tokens, including 12,160 cached, and 16 output tokens. Monetary cost and cheapest ranking: UNKNOWN — not supplied. -- SRC: codex.txt, ### LIVE call 1 (codex exec --json -s read-only -m gpt-6-astra -c model_reasoning_effort=low ok): stdout turn.completed
- 5. window kinds and resets_at: `weekly`, derived from observed `window_minutes=10080`, with `primary.resets_at=1794189894`. `secondary=null` supplies no second window. Credits balance is visible, but credits utilization is UNKNOWN — no allowance denominator supplied. -- SRC: codex.txt, ### LIVE rollout file (newest ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl), line containing rate_limits; payload.rate_limits =
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: `~/.codex/auth.json`, observed mode `600`. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — ChatGPT login status provides no expiry period. -- SRC: codex.txt, ### LIVE(zero-token) codex login status
- 9. visibility level: L3 for the observed weekly window: utilization, duration, and reset timestamp are present. Cheapest extraction: read the latest existing rollout `payload.rate_limits`; manifest source `passive`. This does not establish visibility of absent windows or normalized credits utilization. -- SRC: codex.txt, ### LIVE rollout file (newest ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl), line containing rate_limits; payload.rate_limits =

## claude code

- 1. CLI: `claude`; `claude --version` → `2.1.317 (Claude Code)`. -- SRC: claude.txt, ### claude claude --version
- 2. passive: Yes. With `stream-json` and `--verbose`, `rate_limit_event` exposes `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`. Live evidence shows `seven_day.utilization=0.67` and `seven_day.resetsAt=1793833200`; `five_hour` support is operator-supplied, not demonstrated in this live event. -- SRC: operator-brief; claude.txt, ### LIVE call 1 (claude -p ok --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence): rate_limit_event line
- 3. zero-token endpoint/subcommand/header for usage: UNKNOWN — no standalone quota interface supplied. `claude auth status` reports authentication and subscription metadata, not quota. -- SRC: claude.txt, ### LIVE(zero-token) claude auth status
- 4. tinyprobe: `claude -p ok --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence`. Operator reference: approximately USD `0.0016` for an 8-output-token Haiku probe. This survey’s live command cost USD `0.0033936`, with 16,412 cache-creation tokens and 222 output tokens; it did not reproduce that smaller cost. -- SRC: operator-brief; claude.txt, ### LIVE result line (cost/usage subset); claude.txt, ### LIVE call 1 (claude -p ok --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence): rate_limit_event line
- 5. window kinds and resets_at: `rolling_5h` and `weekly`, mapped from `five_hour` and `seven_day`; `resetsAt` is supported for both per operator evidence. Only the weekly window was present in the supplied live event. -- SRC: operator-brief; claude.txt, ### LIVE call 1 (claude -p ok --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence): rate_limit_event line
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: `~/.claude/.credentials.json`, observed mode `600`. -- SRC: operator-brief
- 8. token validity period: `setup-token` validity is 1 year per operator evidence from codeforge `98c7a8b`; the current browser-login credential’s validity is UNKNOWN — no expiry evidence supplied for that credential. -- SRC: operator-brief; claude.txt, ### LIVE(zero-token) claude auth status
- 9. visibility level: L3: window utilization and reset timestamps are available. Cheapest extraction: consume an existing normal `rate_limit_event`, manifest source `passive`; use the Haiku command only when a fresh probe is needed, with source `probe`. -- SRC: operator-brief; claude.txt, ### LIVE call 1 (claude -p ok --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence): rate_limit_event line

## minimax

- 1. CLI: None in this integration; `--version` is not applicable. Vendor documentation mentions `mmx quota`, but no installed `mmx` binary or version was established. -- SRC: operator-brief; https://platform.minimax.io/docs/coding-plan/faq
- 2. passive: No quota headers observed in the messages response. Body `usage` is call accounting; `base_resp.{status_code,status_msg}` is status information. -- SRC: minimax.txt, ### LIVE call 1 (POST <endpoint minimax>/v1/messages, model MiniMax-M3, max_tokens 8): response headers: content-type, content-length, trace-id, x-session-id, x-mm-request-id, minimax-request-id, alb_*, expires, cache-control, pragma, access-control-allow-origin, x-from. NO ratelimit/quota headers. Body usage: {"input_tokens":49,"output_tokens":8,"cache_creation_input_tokens":0,"cache_read_input_tokens":128,"service_tier":"standard"}, base_resp{status_code,status_msg}
- 3. zero-token endpoint/subcommand/header for usage: Vendor-documented `GET https://www.minimax.io/v1/token_plan/remains`; authentication: Bearer. Observed HTTP 200 quota response; no inference request required. `mmx quota` is also vendor-mentioned, but was not live-tested here. -- SRC: https://platform.minimax.io/docs/coding-plan/faq; minimax.txt, ### LIVE (GET https://www.minimax.io/v1/token_plan/remains, Authorization: Bearer <redacted>) -- URL from official doc https://platform.minimax.io/docs/coding-plan/faq ; HTTP 200:
- 4. tinyprobe: Cheapest quota check is the GET above, with no inference tokens. Observed inference probe: `POST <endpoint minimax>/v1/messages`, model `MiniMax-M3`, `max_tokens=8`; 49 input, 8 output, and 128 cache-read tokens. Monetary cost: UNKNOWN — not supplied. -- SRC: operator-brief; minimax.txt, ### LIVE call 1 (POST <endpoint minimax>/v1/messages, model MiniMax-M3, max_tokens 8): response headers: content-type, content-length, trace-id, x-session-id, x-mm-request-id, minimax-request-id, alb_*, expires, cache-control, pragma, access-control-allow-origin, x-from. NO ratelimit/quota headers. Body usage: {"input_tokens":49,"output_tokens":8,"cache_creation_input_tokens":0,"cache_read_input_tokens":128,"service_tier":"standard"}, base_resp{status_code,status_msg}; https://www.minimax.io/v1/token_plan/remains
- 5. window kinds and resets_at: `rolling_5h` and `weekly`; vendor describes first-use-anchored windows. `model_remains[].end_time` and `weekly_end_time` supply reset times. Utilization is `1 - current_interval_remaining_percent/100` or `1 - current_weekly_remaining_percent/100`; observed general interval utilization is `0.12`. Preserve model identity and status fields; zero count fields must not replace the provided percentages. -- SRC: https://platform.minimax.io/docs/coding-plan/faq; minimax.txt, ### LIVE (GET https://www.minimax.io/v1/token_plan/remains, Authorization: Bearer <redacted>) -- URL from official doc https://platform.minimax.io/docs/coding-plan/faq ; HTTP 200:
- 6. starts_window: Vendor-documented: first use starts both windows; after expiry, the next use starts a new window. An inference probe therefore counts as first use under that rule; whether a quota GET starts a window is UNKNOWN — neither documented nor experimentally established here. -- SRC: https://platform.minimax.io/docs/coding-plan/faq; operator-brief
- 7. credential location: `~/.autopilot/endpoints.env`; `AUTOPILOT_ENDPOINT_MINIMAX_TOKEN`; file observed mode `600`. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — no credential expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L3: interval and weekly remaining percentages plus reset timestamps. Cheapest extraction: vendor-documented quota GET, manifest source `endpoint`; normalize percentages and timestamps into the contract. -- SRC: https://platform.minimax.io/docs/coding-plan/faq; minimax.txt, ### LIVE (GET https://www.minimax.io/v1/token_plan/remains, Authorization: Bearer <redacted>) -- URL from official doc https://platform.minimax.io/docs/coding-plan/faq ; HTTP 200:

## qoder

- 1. CLI: `qodercli`; `qodercli --version` → `1.1.82`. -- SRC: qoder.txt, ### qodercli qodercli --version
- 2. passive: Live stream provides session expenditure at `total_credits` and `modelUsage.qfmodel.credits`, both `0`; it does not provide account quota utilization or reset times. `usage.context_usage_ratio` is context usage, not account quota. -- SRC: qoder.txt, ### LIVE call (qodercli -p ok -m Qwen3.8-Flash -o stream-json): result event
- 3. zero-token endpoint/subcommand/header for usage: Vendor-documented SDK methods `getUsageInfo()` / `get_usage_info()` return quota percentages; interactive `/usage` shows plan and Credits usage. Headless `qodercli -p "/usage" -o json` failed. SDK authentication style and verified zero-token execution: UNKNOWN — no SDK invocation or billing observation supplied. `qodercli status -o json` is authentication metadata only. -- SRC: https://docs.qoder.com/cli/sdk/cost-usage; https://docs.qoder.com/cli/usage; qoder.txt, ### LIVE (qodercli|qoderclicn) -p "/usage" -o json: result subtype=error_during_execution, is_error=true, errors=["Sorry, something went wrong..."] -> /usage is NOT usable headless. total_credits=0.; qoder.txt, ### LIVE(zero-token) qodercli status -o json
- 4. tinyprobe: `qodercli -p ok -m Qwen3.8-Flash -o stream-json`; observed `total_cost_usd=0`, `total_credits=0`, on the stated free tier. It yields no remaining account quota. -- SRC: qoder.txt, ### LIVE call (qodercli -p ok -m Qwen3.8-Flash -o stream-json): result event; operator-brief
- 5. window kinds and resets_at: `credits`, vendor-documented. SDK paths include `userQuota.{total,used,remaining,percentage,unit}`, `addOnQuota`, `orgResourcePackage`, and `totalUsagePercentage`. Reset time: UNKNOWN — the supplied documentation does not mention it. -- SRC: https://docs.qoder.com/cli/sdk/cost-usage; https://docs.qoder.com/cli/usage
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: UNKNOWN — `auth_source=local` and browser login are observed, but existing `~/.qoder` and `~/.qoder-cli` directories do not identify a credential file. -- SRC: operator-brief; qoder.txt, ### LIVE(zero-token) qodercli status -o json
- 8. token validity period: UNKNOWN — no expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L2, vendor-documented rather than live-verified: SDK quota percentages exist, with no supplied reset times. Cheapest supported candidate: SDK `getUsageInfo()` / `get_usage_info()` without a generation prompt; actual zero-token behavior remains unverified. Live headless stream alone is L0 for account quota. -- SRC: https://docs.qoder.com/cli/sdk/cost-usage; qoder.txt, ### LIVE call (qodercli -p ok -m Qwen3.8-Flash -o stream-json): result event

## qoder-cli-cn

- 1. CLI: `qoderclicn`; `qoderclicn --version` → `1.1.82`; same flags as `qodercli`, different account/region (`user_type` professional_plus vs standard). -- SRC: qoder.txt, ### LIVE(zero-token) qoderclicn --version; qoder.txt, ### LIVE(zero-token) qoderclicn status -o json (sanitized)
- 2. passive: Live stream supplies only session expenditure at `total_credits` and `modelUsage.qfmodel.credits`, both `0`; no remaining quota or reset time. `usage.context_usage_ratio` is not quota utilization. -- SRC: qoder.txt, ### LIVE call (qoderclicn -p ok -m Qwen3.8-Flash -o stream-json): result event
- 3. zero-token endpoint/subcommand/header for usage: UNKNOWN — headless `/usage` failed; applicability and authentication of Qoder’s documented SDK quota method to the CN account were not established. Shared CLI flags alone do not prove SDK account compatibility. -- SRC: operator-brief; https://docs.qoder.com/cli/sdk/cost-usage; qoder.txt, ### LIVE (qodercli|qoderclicn) -p "/usage" -o json: result subtype=error_during_execution, is_error=true, errors=["Sorry, something went wrong..."] -> /usage is NOT usable headless. total_credits=0.
- 4. tinyprobe: `qoderclicn -p ok -m Qwen3.8-Flash -o stream-json`; observed `total_cost_usd=0`, `total_credits=0`, on the stated free tier. It yields no remaining quota. -- SRC: qoder.txt, ### LIVE call (qoderclicn -p ok -m Qwen3.8-Flash -o stream-json): result event; operator-brief
- 5. window kinds and resets_at: UNKNOWN — session credits are observed, but a CN account credits allowance/window and its reset time are not established. -- SRC: qoder.txt, ### LIVE call (qoderclicn -p ok -m Qwen3.8-Flash -o stream-json): result event
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: UNKNOWN — `~/.qoder-cn` exists, but no credential file was verified. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — no expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L0 in CN-specific live evidence: session credits only. Cheapest quota extraction: UNKNOWN — Qoder’s L2 SDK documentation is a candidate requiring CN validation. -- SRC: qoder.txt, ### LIVE call (qoderclicn -p ok -m Qwen3.8-Flash -o stream-json): result event; https://docs.qoder.com/cli/sdk/cost-usage

## opencode

- 1. CLI: `opencode`; `opencode --version` → `1.19.5`. This is a harness; the observed quota belongs to `opencode-go`, not directly to GLM. -- SRC: opencode.txt, ### opencode opencode --version; operator-brief
- 2. passive: Error-only visibility in the observed run: stderr reports `Go usage limit exceeded`, with `providerID=opencode-go`, `modelID=glm-5.3-flash`, and `error.error`. Stdout was empty; no percentage or reset timestamp was observed. -- SRC: opencode.txt, ### LIVE call 1+2 (opencode run ok -m opencode-go/glm-5.3-flash --format json [--print-logs --log-level INFO]): stdout empty, hung until timeout; stderr log line:
- 3. zero-token endpoint/subcommand/header for usage: `opencode stats` exposes token/cost statistics; `opencode providers list` exposes credentials. Account-quota endpoint/subcommand: UNKNOWN — neither establishes remaining OpenCode Go allowance. Credential type is listed as `api`. -- SRC: opencode.txt, ### opencode opencode stats --help; opencode.txt, ### LIVE(zero-token) opencode providers list
- 4. tinyprobe: Observed logged attempt: `opencode run ok -m opencode-go/glm-5.3-flash --format json --print-logs --log-level INFO`. Both attempts were rejected and hung until timeout; further probing stopped. Cost and successful cheapest probe: UNKNOWN — no billing or successful response supplied. -- SRC: opencode.txt, ### LIVE call 1+2 (opencode run ok -m opencode-go/glm-5.3-flash --format json [--print-logs --log-level INFO]): stdout empty, hung until timeout; stderr log line:; operator-brief
- 5. window kinds and resets_at: UNKNOWN — the OpenCode Go limit error identifies neither window duration nor reset timestamp. -- SRC: opencode.txt, ### LIVE call 1+2 (opencode run ok -m opencode-go/glm-5.3-flash --format json [--print-logs --log-level INFO]): stdout empty, hung until timeout; stderr log line:
- 6. starts_window: UNKNOWN — account was at limit; no idle-account experiment. -- SRC: operator-brief
- 7. credential location: `~/.local/share/opencode/auth.json`, observed mode `600`; live provider listing identifies OpenCode Go API credentials. -- SRC: operator-brief; opencode.txt, ### LIVE(zero-token) opencode providers list
- 8. token validity period: UNKNOWN — no credential expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L1 for `opencode-go`: limit error text only. Cheapest extraction: reuse the existing stderr error. The log text is `Go usage limit exceeded` (AI_APICallError) and does not establish an HTTP 429; map to source `429` only as an error-bucket convention. [核對註記] -- SRC: opencode.txt, ### LIVE call 1+2 (opencode run ok -m opencode-go/glm-5.3-flash --format json [--print-logs --log-level INFO]): stdout empty, hung until timeout; stderr log line:

## glm

- 1. CLI: None; `--version` is not applicable. This integration uses an Anthropic-compatible HTTP endpoint. -- SRC: operator-brief
- 2. passive: No quota headers observed. Body `usage.{input_tokens,output_tokens,cache_read_input_tokens}` contains call accounting only. -- SRC: glm.txt, ### LIVE call 1 (POST <endpoint glm>/v1/messages, Authorization: Bearer <redacted>, model glm-5.2, max_tokens 8, prompt "ok"): response headers present (sanitized): content-type, content-length, alt-svc, vary, x-log-id, x-process-time, strict-transport-security, ga-traceid. NO ratelimit/quota headers. Body usage: {"input_tokens":13,"output_tokens":8,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0},"service_tier":"standard"}
- 3. zero-token endpoint/subcommand/header for usage: `GET https://api.z.ai/api/monitor/usage/quota/limit`, observed HTTP 200. This endpoint is third-party-discovered and undocumented by Z.ai in the supplied evidence. Authentication: `Authorization: <bare token>` with NO `Bearer` prefix (observed working; the messages endpoint uses Bearer). [核對更正: codex marked the scheme UNKNOWN; raw note added at glm.txt `### LIVE auth-scheme note`] -- SRC: glm.txt, ### LIVE (GET https://api.z.ai/api/monitor/usage/quota/limit, Authorization: <redacted>) -- endpoint is UNDOCUMENTED by Z.ai (third-party sources: pypi zai-limits, docs.rs zai-rs); live result HTTP 200:
- 4. tinyprobe: Cheapest quota check is the monitor GET, with no inference tokens. Observed inference probe: `POST <endpoint glm>/v1/messages`, Bearer authentication, model `glm-5.2`, `max_tokens=8`, prompt `ok`; 13 input and 8 output tokens. Monetary cost: UNKNOWN — not supplied. -- SRC: glm.txt, ### LIVE call 1 (POST <endpoint glm>/v1/messages, Authorization: Bearer <redacted>, model glm-5.2, max_tokens 8, prompt "ok"): response headers present (sanitized): content-type, content-length, alt-svc, vary, x-log-id, x-process-time, strict-transport-security, ga-traceid. NO ratelimit/quota headers. Body usage: {"input_tokens":13,"output_tokens":8,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0},"service_tier":"standard"}; https://api.z.ai/api/monitor/usage/quota/limit
- 5. window kinds and resets_at: Exact contract kinds: UNKNOWN — `type`, `unit`, and `number` lack a documented mapping. Raw `data.limits[].percentage` and `nextResetTime` are visible; observed `TOKENS_LIMIT` percentages normalize to `0.02` and `0.12`. Mapping numeric units to durations is explicitly inferred, so do not assert `rolling_5h` or `weekly` as verified kinds. -- SRC: glm.txt, ### LIVE (GET https://api.z.ai/api/monitor/usage/quota/limit, Authorization: <redacted>) -- endpoint is UNDOCUMENTED by Z.ai (third-party sources: pypi zai-limits, docs.rs zai-rs); live result HTTP 200:
- 6. starts_window: UNKNOWN — no idle-account experiment; accounts were active or at limit. -- SRC: operator-brief
- 7. credential location: `~/.autopilot/endpoints.env`; `AUTOPILOT_ENDPOINT_GLM_TOKEN`; file observed mode `600`. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — no credential expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L2 for this contract, with raw reset timestamps additionally visible. Full L3 mapping is blocked by unverified window kinds. Cheapest extraction: undocumented monitor GET, manifest source `endpoint`; any duration mapping must be explicitly marked inferred/estimated. -- SRC: glm.txt, ### LIVE (GET https://api.z.ai/api/monitor/usage/quota/limit, Authorization: <redacted>) -- endpoint is UNDOCUMENTED by Z.ai (third-party sources: pypi zai-limits, docs.rs zai-rs); live result HTTP 200:

## kimi

- 1. CLI: `kimi`; `kimi --version` → `2.3.0`. -- SRC: kimi.txt, ### kimi kimi --version
- 2. passive: Observed error-only quota visibility: `provider.api_error: 429` with weekly-limit text. No structured utilization or reset timestamp; successful normal-output quota fields are UNKNOWN because both attempts failed. -- SRC: kimi.txt, ### LIVE call 1+2 (kimi -p ok --output-format stream-json ; kimi -p "/usage"): both
- 3. zero-token endpoint/subcommand/header for usage: Vendor documents interactive `/usage`; no working headless equivalent or exact HTTP quota endpoint is supplied. `kimi -p "/usage"` made a prompt attempt and returned 429. Zero-token behavior and authentication requirements for interactive quota retrieval: UNKNOWN — not observed; configured provider authentication is OAuth. -- SRC: https://www.kimi.com/code/docs/en/kimi-code/membership; kimi.txt, ### LIVE call 1+2 (kimi -p ok --output-format stream-json ; kimi -p "/usage"): both; operator-brief
- 4. tinyprobe: `kimi -p ok --output-format stream-json` was attempted; both survey attempts returned weekly-limit 429, and further probing stopped. Cost and successful cheapest probe: UNKNOWN — no successful response or billing evidence. -- SRC: kimi.txt, ### LIVE call 1+2 (kimi -p ok --output-format stream-json ; kimi -p "/usage"): both; operator-brief
- 5. window kinds and resets_at: Vendor documents `weekly` renewal every 7 days from subscription date, a `rolling_5h` frequency window, and a `monthly` membership total that can freeze Kimi Code. Concrete `resets_at`: UNKNOWN — the observed weekly error only says the current window will end. -- SRC: https://www.kimi.com/code/docs/en/kimi-code/membership; kimi.txt, ### LIVE call 1+2 (kimi -p ok --output-format stream-json ; kimi -p "/usage"): both
- 6. starts_window: Weekly timing is vendor-described as subscription-date anchored, rather than established by this probe. Whether a probe initiates another timing window: UNKNOWN — no idle-account experiment or first-use rule supplied for the rolling 5-hour window. -- SRC: https://www.kimi.com/code/docs/en/kimi-code/membership; operator-brief
- 7. credential location: UNKNOWN — `~/.kimi-code` exists and the provider is OAuth-managed, but an exact credential file or environment variable was not verified. -- SRC: operator-brief
- 8. token validity period: UNKNOWN — no OAuth expiry evidence supplied. -- SRC: operator-brief
- 9. visibility level: L1 live-verified: weekly-limit 429 text only. Cheapest extraction: reuse the existing error, manifest source `429`. Interactive `/usage` is vendor-documented, but its output is not supplied and therefore does not establish L2 or L3. -- SRC: kimi.txt, ### LIVE call 1+2 (kimi -p ok --output-format stream-json ; kimi -p "/usage"): both; https://www.kimi.com/code/docs/en/kimi-code/membership

## Summary

| Provider | Level | Cheapest extraction | Window kinds |
|---|---|---|---|
| agy | L0 observed | UNKNOWN — no quota source established | UNKNOWN |
| grok | L0 observed | UNKNOWN — persisted usage is accounting only | UNKNOWN |
| codex | L3 for observed weekly window | Existing rollout `payload.rate_limits` | weekly; separate credits balance |
| claude code | L3 | Existing `rate_limit_event` | rolling_5h, weekly; weekly live-observed |
| minimax | L3 | Official quota GET | rolling_5h, weekly |
| qoder | L2 vendor-documented; headless live L0 | SDK usage method; zero-token execution unverified | credits; reset UNKNOWN |
| qoder-cli-cn | L0 CN-specific observed | UNKNOWN — validate SDK regional applicability | UNKNOWN |
| opencode | L1 for opencode-go | Existing stderr limit error | UNKNOWN |
| glm | L2 contract-ready; raw resets visible | Undocumented monitor GET | UNKNOWN — numeric unit mapping unverified |
| kimi | L1 live-verified | Existing 429; interactive `/usage` documented | weekly, rolling_5h, monthly; reset UNKNOWN |

## UNKNOWN cells

Actions below are proposed evidence collection, not commands executed in this response. Where the evidence supplies no exact command or authentication scheme, obtain a vendor-supported procedure before running a request.

- **agy — fields 3, 9:** Obtain a supported quota interface from the vendor, then run it and retain sanitized output. The supplied `usage --help` and `status --help` do not establish such an interface.
- **agy — field 4:** Run the evidenced probe in an empty directory and capture billing; establishing the cheapest model also requires supported-model pricing or controlled comparisons.
- **agy — field 5:** Capture a vendor quota view or documented response showing window duration and reset time.
- **agy — field 7:** Perform a metadata-only credential-location inspection using vendor-supported configuration information; do not infer storage from `~/.gemini`.
- **agy — field 8:** Obtain vendor token-lifetime documentation or inspect only redacted expiry metadata.

- **grok — field 3:** Run `grok usage <SESSION_ID>` to confirm its accounting output, then obtain and test a separate vendor-supported account-quota interface.
- **grok — field 4:** Run `grok -p ok --output-format streaming-json -m grok-4.7-build-fast --disable-web-search --max-turns 1` from an empty directory and capture cost. Cheapest-model status additionally requires pricing comparison.
- **grok — fields 5, 9:** Obtain and run a supported quota query that returns window and reset information.
- **grok — field 8:** Obtain token-lifetime documentation or inspect redacted expiry metadata.

- **codex — field 3:** Obtain a documented standalone quota-query procedure and run it; `codex login status` is insufficient.
- **codex — field 4:** Capture billing for the evidenced exec command; compare supported alternatives before declaring it cheapest.
- **codex — field 5:** Obtain the credits allowance denominator and semantics before calculating credits utilization.
- **codex — field 8:** Inspect redacted authentication expiry metadata or obtain vendor lifetime documentation.

- **claude code — field 3:** Obtain and run a documented zero-token quota query; `claude auth status` does not fill this cell.
- **claude code — field 8:** Inspect the current browser credential’s redacted expiry metadata. The supplied one-year fact applies specifically to `setup-token`.

- **minimax — field 4:** Capture billing for the evidenced 8-output-token messages request.
- **minimax — field 6:** On a confirmed idle account, record window state, issue only the documented quota GET, and compare state without an intervening inference call; alternatively obtain an explicit vendor statement about query side effects.
- **minimax — field 8:** Obtain token-lifetime documentation or inspect redacted expiry metadata.

- **qoder — field 3:** Execute vendor-documented `getUsageInfo()` / `get_usage_info()` using its documented authentication setup; capture sanitized output and verify that no inference tokens are consumed.
- **qoder — field 5:** Run interactive `/usage` and the SDK usage method to check for reset information; obtain vendor clarification if neither exposes it.
- **qoder — field 7:** Inspect credential storage metadata under the verified configuration root; `qodercli status -o json` confirms local authentication but does not identify the file.
- **qoder — field 8:** Obtain credential-lifetime documentation or redacted expiry metadata.

- **qoder-cli-cn — fields 3, 9:** Validate Qoder SDK quota-method support and authentication against the CN account, then capture its result; do not retry headless `/usage` as an established quota command.
- **qoder-cli-cn — field 5:** Capture CN account allowance units, quota percentages, and any reset fields through a validated interface.
- **qoder-cli-cn — field 7:** Inspect credential-location metadata; directory existence alone is insufficient.
- **qoder-cli-cn — field 8:** Obtain CN credential-lifetime documentation or redacted expiry metadata.

- **opencode — field 3:** Obtain and run an OpenCode Go quota-query procedure; `opencode stats` and `opencode providers list` do not establish remaining allowance.
- **opencode — field 4:** After access is restored, run the evidenced logged command once and capture billing and completion behavior; do not keep probing the currently exhausted account.
- **opencode — field 5:** Capture OpenCode Go window/reset data from a supported quota interface.
- **opencode — field 8:** Obtain the OpenCode Go API credential lifetime or redacted expiry metadata.

- **glm — field 3:** Recover only the authentication scheme name from the existing successful monitor-request configuration; do not expose the credential or assume Bearer from the separate messages request.
- **glm — field 4:** Capture billing for the evidenced messages probe.
- **glm — field 5:** Obtain an authoritative mapping for `type`, `unit`, and `number`, or run controlled observations that establish and explicitly label an empirical mapping.
- **glm — field 8:** Obtain credential-lifetime documentation or redacted expiry metadata.

- **kimi — field 2:** After quota recovery, run `kimi -p ok --output-format stream-json` once and inspect successful output for quota fields.
- **kimi — field 3:** Run vendor-documented `/usage` interactively and capture sanitized output, authentication requirements, and whether it consumes inference tokens.
- **kimi — field 4:** After quota recovery, capture cost for the evidenced prompt command; cheapest status requires additional pricing evidence.
- **kimi — field 5:** Capture a concrete reset timestamp from interactive `/usage` or another vendor-supported quota view.
- **kimi — field 7:** Inspect metadata for the OAuth credential location; `~/.kimi-code` alone is insufficient.
- **kimi — field 8:** Obtain OAuth token-lifetime documentation or redacted expiry metadata.

- **starts_window — field 6 for agy, grok, codex, claude code, qoder, qoder-cli-cn, opencode, glm, and kimi:** On a confirmed idle account, record quota state using a validated non-mutating source, run one evidenced inference probe, and compare the window start/reset state. For kimi, resolve the rolling 5-hour behavior specifically; weekly subscription anchoring is already documented. Where no quota-state source exists, establish that source first. No such experiment was performed in the supplied evidence.
