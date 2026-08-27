# Vendor quota shapes — what a subscription actually meters

> A model you already pay for on one rail is not automatically the cheap option on another. This file
> records the *shape* of a vendor's metering, because that shape decides routing economics — not the
> per-token list price alone.

## Cursor (verified 2026-08-27, plan tier Ultra)

**Two pools, not one, and the split is by model provenance — not by how you invoked it.**

| Pool | What lands in it |
|---|---|
| **Cursor Models** | Cursor's own served models — `cursor-grok-4.6-*`, `cursor-grok-4.5-*`, Composer 2.5. Documented as "significantly more included usage". |
| **Other Models** | Third-party models, "charged at the model's API price" — the Claude / GPT / Gemini families. |

Consequence for routing: pointing a heterogeneous seat at `cursor-grok-4.6-*` draws the generous
first-party pool; pointing the *same rail* at `claude-opus-5-*` or `gpt-5.6-*` draws the metered API
pool. Same CLI, same login, same config field — an order-of-magnitude difference in what it costs.

**`auto` has no separate allowance.** The usage view renders `Auto` as its own bar, which reads like a
third quota; it is a child line of the Cursor Models pool. Official wording: "All Auto modes bill at
the list price of the model each request is routed to." Auto *was* unlimited historically and that
changed — "Auto will contribute to your included monthly usage at competitive token rates" — so
"switch to auto to save quota" is stale advice, not a current strategy.

**`-fast` is exactly 2× on both input and output**, listed as its own priced row rather than as a
multiplier (e.g. `$2/$6` → `$4/$12` per million for grok 4.6; other families state it as "2x pricing"
outright). Because billing is per token and the fast lane does not reduce token count, **`-fast` buys
latency, never cost**. Measured on the same prompt: the fast variants ran 3–4× the end-to-end
throughput with markedly less variable time-to-first-flush, while output token counts stayed in the
same band. Default a rail to non-fast and make fast an explicit opt-in; reach for it when wall-clock
matters (a long sequential exam), not when spend does.

**The CLI cannot tell you any of this.** `--version`, `status`, `about` and the `stream-json` `result`
event expose tokens and a subscription tier, and nothing about cost or remaining quota. Usage lives
behind an **interactive-only** `/usage` slash command inside the TUI — it is not a subcommand, and in
`-p` print mode the string is passed to the model as an ordinary prompt. To track spend
programmatically, multiply `result.usage` token counts by the published rate table yourself.

> **Transferable question**, before assuming a subscription makes a model cheap on a new rail: *does
> this vendor meter by model provenance or by invocation path, and which pool does the model I want
> actually land in?* A vendor that resells other vendors' models almost always has at least two pools,
> and the interesting one is rarely the one the marketing page leads with.
