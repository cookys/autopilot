# OpenCode Go: Responses-protocol transport + the missing session header

Verified 2026-09-21 on cuda. Full routing table and probe method:
`references/multi-agent-portability.md` → "OpenCode Go (`opencode-go`) — endpoint
routing is PER MODEL".

## What is broken

`scripts/qualification-review-provider.js` `callModel` speaks only the Anthropic
Messages protocol and sends only `content-type`, `x-api-key`, `authorization` and
`anthropic-version`. Against OpenCode Go that is wrong in two ways:

1. **No `x-opencode-session` header.** Both protocols reject the request with
   `400 MissingSessionID` before the model is consulted. Any `ses_`-prefixed string is
   accepted; it need not be a session the CLI created.
2. **No Responses transport.** 5 of the 31 live ids are served ONLY on
   `POST /zen/go/v1/responses` (`Authorization: Bearer`, body
   `{model, input, max_output_tokens}`): `muse-spark-1.2-contributor`,
   `muse-spark-1.3-contributor`, `grok-4.6`, `grok-4.7`, `gpt-5.6-luna`.

Hitting the wrong protocol returns `503 Upstream request failed: Endpoint is
unavailable.` — indistinguishable from an outage by reading alone. That message
produced one wrong conclusion already this session ("the provider is down") before the
per-model probe settled it.

## Why it matters

`muse-spark-1.3-contributor` is a qualified implementer (24/24, three effort tiers,
2026-09-03/04) whose reviewer / brain / verification_author seats have never been
examined. The broker + adapter path is the only rail those seats have, and
`QRP_CLI_KIND=opencode` is ALWAYS-REFUSED for an unrelated reason (2026-09-07
adversarial probe: `--agent plan` does not block bash), so the CLI is not a fallback.
Without this transport those seats cannot be administered at all.

## Scope

- Add the session header on the existing Messages path (unblocks 9 ids immediately:
  `kimi-k3`, `minimax-m2.5/m2.7/m3`, `qwen3.6-plus`, `qwen3.7-plus`, `qwen3.7-max`,
  `qwen3.8-max`, `qwen3.8-flash`).
- Add a Responses transport selected per endpoint, not per provider name.
- **Its truncation signal is `status:"incomplete"`**, not the `stop_reason:"max_tokens"`
  the v2.36.83 budget diagnosis keys on — measured: `muse-spark-1.3-contributor` at
  `max_output_tokens:64` spends 61 of 64 on reasoning and returns no `output_text`
  part. A Responses transport that reuses the Messages diagnosis will report the
  generic "no text content" error this exact fix exists to prevent.
- 12 of 31 ids 503 on BOTH protocols (`glm-5.x`, `kimi-k2.6`, `kimi-k2.7-code`,
  `mimo-v2.5`, `mimo-v2.5-pro`, `hy3`, `hy4-preview`, `omen-alpha`, `longcat-2.0`).
  Being listed by `/v1/models` is not evidence of reachability; re-probe before
  planning an administration.
