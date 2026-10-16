# Owner (foreman intent/control) qualification, first sittings (2026-10-17)

Status: all 13 sittings done and recorded (2026-10-17). Scorecard events 313-325; all qualified.

## Scope finding

No model has a foreman-kind owner row. The 10 owner rows in the scorecard (events 261-311) are all `methodology_kind: owner_brain_seat`
(brain sittings, all failed), and the shipped defaults carry no `owner` role. The owner exam provider (`QRP_PROMPT_MODE=owner`) only
merged on 2026-10-17 (6ba10c012, BL-0158). So this is a first sitting for every shipped-default seat, not a gap fill.

## Seats (one cell per seat at its shipped effort)

claude-opus-5-5 / claude-sonnet-5-5 / claude-haiku-5-5 @high (claude-native), gpt-6.1-sol @low (codex), gemini-4-argon-high and -low (agy),
grok-4.7 @low (grok), GLM-5.3 and MiniMax-M3 @high (anthropic-compatible http; effort is a label), Qwen3.8-Max @high (qoderclicn),
kimi-code-k3 and kimi-k2.8-preview @high (kimi), opencode-go/muse-spark-1.3-contributor @high (opencode).
Not taken: claude-fable-5-1 (qc seat, not a shipped default), MiniMax-M3.1-Flash-Preview, opus/sonnet low, muse http variants.

Exam: corpus `owner-intent-control-v1`, 2 trials x (6 known-bad + 6 clean) = 24 single-shot JSON judgments plus a host mutation control per seat;
thresholds 0 clean false positives, 0 false-pass-critical. Estimate 5-15 min and a few cents per seat; ~1 h wall in parallel.

## Recipe

- `derive-owner.js <lane>`: identity. prompt_config_hash = sha256 of the `OWNER_SYSTEM_PROMPT` body; semantic/containment kinds `owner-*-surface-v1`;
  transport/posture/credential strings copied per runner from the 2026-10-14 reviewer cells; all flagged `_invented` (no owner precedent).
  harness_version `engine-qualify-<sha8 of engine-qualify.js>`.
- `cell-owner.sh <lane>`: one sitting (`engine-qualify.sh owner ... --task-class owner_intent_control`). Credentials staged per lane, never the real `~/.claude`.
- `run-chain.sh <lane>...`: serial sittings; a transport failure renames the directory `-attemptN-transport` and re-sits (max 3).
- `record.sh <dir>`: append `out/<dir>/emit-row.json` to the scorecard.
- Grok exam-home credential was older than `~/.grok/auth.json` (10/15 vs 10/16); refreshed before the run (backup `auth.json.bak-20261017`).
- Kimi: the 10/16 17:37 weekly reset has passed; Kimi lanes run k3 then k2.8 serially (one OAuth), probe + exit write-back as in BL-0199.

## Results (all 12/12 corpus pass, 0 false-pass-critical, specificity 0/12, 2 trials, zero transport failures, zero parse errors; no re-sittings)

| lane | engine | effort | scorecard event | out dir |
|---|---|---|---|---|
| opus-high | claude-opus-5-5 | high | 313 | out/opus-high |
| sonnet-high | claude-sonnet-5-5 | high | 314 | out/sonnet-high |
| haiku-high | claude-haiku-5-5 | high | 315 | out/haiku-high |
| gpt61-low | gpt-6.1-sol | low | 316 | out/gpt61-low |
| grok47-low | grok-4.7 | low | 317 | out/grok47-low |
| glm-high | GLM-5.3 | high | 318 | out/glm-high |
| minimax-high | MiniMax-M3 | high | 319 | out/minimax-high |
| qwen-high | Qwen3.8-Max | high | 320 | out/qwen-high |
| kimi-k3-high | kimi-code-k3 | high | 321 | out/kimi-k3-high |
| muse-oc-high | opencode-go/muse-spark-1.3-contributor | high | 322 | out/muse-oc-high |
| argon-high | gemini-4-argon-high | high | 323 | out/argon-high |
| kimi-k28-high | kimi-k2.8-preview | high | 324 | out/kimi-k28-high |
| argon-low | gemini-4-argon-low | low | 325 | out/argon-low |

Tool-use violations: none (every one of the 26 exchanges per seat answered with a bare JSON object; no transport_error, no parse_error). `summarize.js` prints the table from the out dirs.
All 13 seats scoring identically on a 24-case exam means it does not rank seats; it only gates them.
