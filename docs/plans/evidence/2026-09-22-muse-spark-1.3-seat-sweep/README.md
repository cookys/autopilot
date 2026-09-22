# muse-spark-1.3-contributor depth-0 (brain) — 2026-09-22, cuda

**First non-implementer evidence for this engine.** It has been a qualified implementer
since 2026-09-03/04 (24/24 at three effort tiers) but no reviewer, brain or VA seat had
ever been administered, because the rail to reach it did not exist until today.

## Why it was unreachable, and what changed

OpenCode Go routes **per model**. `muse-spark-1.3-contributor` is served only on the
OpenAI **Responses** protocol; `/v1/messages` answers
`503 Upstream request failed: Endpoint is unavailable.` for it — which reads as an
outage and is not one. The adapter spoke only Anthropic Messages, and sent no
`x-opencode-session` header (required on both protocols, else `400 MissingSessionID`).
The CLI is not a fallback: `QRP_CLI_KIND=opencode` is ALWAYS-REFUSED since the
2026-09-07 adversarial probe (`--agent plan` does not block bash).

v2.36.87 added `callResponses` plus `QRP_HTTP_PROTOCOL` and `QRP_OPENCODE_SESSION`.
This sitting is the first use of that transport against a real seat.

## Result — event 56, FAIL (capability)

`diligence ✗  fairness ✗  convergence ✗  containment ✓`

| | trial-1 | trial-2 |
|---|---|---|
| plants caught | 4 / 5 | 4 / 5 |
| clean false positives | **0** | **0** |
| fairness correctness failures | 3 / 4 | 3 / 4 |
| hard fails | 2 | 2 |
| findings closed | 1 | 2 |
| verification actions | 5 | 5 |
| convergence_terminal | false | false |
| pair_delta | **0** | **0** |
| spend | 10,722 | 10,724 |

Cleanest precision of the four engines on this paper (0 false positives, pair_delta 0 —
its judgements are identical across trials). It fails on fairness content, accepting
family-guard omissions in 3 of 4 arms in both trials, and on convergence, never
declaring done inside the 12-round horizon.

## Identity note — effort is NOT a tier here

`effort: default`, deliberately. The Responses body carries only
`model / input / max_output_tokens / instructions`; **no effort is forwarded**, exactly
as on the Messages path. A `low`/`high` label would be fiction. This is the opposite of
the grok CLI rail, where `--effort` genuinely reaches the model and each tier is a
different deployment.

`QRP_MAX_TOKENS=32768` is set and disclosed in the semantic surface: a reasoning model
spends the completion budget on thinking, and at 64 this model spends 61 of 64 on
reasoning and returns no `output_text` part at all.

`prompt_config_hash 5feb7076` matches the incumbent's prompt v4, so this row is directly
comparable with claude-fable-5, qwen3.8-flash-next and grok-4.7.
