# Speed measurement handover from forge-stats to the live mod (BL-0359)

Owner chose option A on codeforge card d-7b0f7a4a: autopilot measures and draws speed end to end.

## Handover scope

- The tab-bar speed label (the lightning glyph label).
- The speed column: average, best, latest, time to first token, trend.
- The recent-requests table.

After the handover forge-stats only draws Ferris, the pet, memory and the brain. It no longer returns the `maxRows=1` label, and the keyed Box label contract retires with it.

## Current forge-stats algorithm (to reproduce)

Source: codeforge `.claude/skills/forge-stats/hooks/register.tsx:395-425` and `model.ts:65`.

- Wrap the `turn.step` async generator: record `sent = performance.now()`, then call `stream = next(e)`.
- Time every chunk whose `chunk.kind !== 'engine'`; the first is `first`, the last is `last`. Chunks are yielded unchanged.
- Finally `result = await stream.result`. Record one sample only when `result.usage` exists: `outTokens = usage.output_tokens`, `decodeMs = last - first`, `ttftMs = first - sent`, `model = usage.model ?? e.model`, `isSubagent = e.agentId !== undefined`.
- `tps = outTokens / (decodeMs / 1000)`. It is null when `decodeMs < 150 ms` or `outTokens = 0`; short tool calls mostly land here, which is why the label often shows a dash.
- Keep only the most recent 200 samples.
- Average is token-weighted over samples with non-null tps; best is the maximum; time to first token is the median over all samples.
- Subagents are excluded from the main-conversation statistics and flagged separately in the table.
- State lives in `$.state`, kept for the session and surviving a reload.

## Handover order

We go live and give codeforge the sha; only then do they remove their speed code and label. Before going live, confirm the two sides never show speed on the band at the same time.

## Open question

Whether the pet (Ferris Lv.1) goes into the tab label. Build previews for the owner to choose first. If yes, read `$XDG_RUNTIME_DIR/autopilot/codeforge/pet.json` (format `codeforge.pet-view/1`; spec in codeforge `src/pet/view.rs` and `doc/specs/codeforge-mod-ui.md`; fields `pet.name`, `pet.level`, `village.rgb`).

## Expanded area

The expanded area keeps asking downward with `lower(rows - 2, columns)`. This becomes the only band interface in the alpha.8 extension contract (BL-0356).

## Colors

Follow `docs/plans/2026-10-13-live-pane-design-system.md` section 12.
