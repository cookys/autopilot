# live mod AbovePrompt band does not yield to lower mods (BL-0352)

Reported by the codeforge session over fleet, 2026-10-31.

## Problem
- mods/live/register.ts line 862 onward: the AbovePrompt hook returns `Band(...)` directly (around line 909) and never calls `next(e)`.
- Mods below it in the ui.render chain are therefore never called.
- codeforge forge-stats wants a three-column band of about 12 rows under the autopilot band; measured AbovePrompt calls: 0.

## Fix direction
- `const below = await next(e)` first; the hasSurvey branch stays as is.
- below empty: output identical to today.
- below has content: `<Box flexDirection="column">{Band}{below}</Box>`, autopilot on top.
- autopilot has no data: return below unchanged.

## Tests (mods/live live.test.ts)
1. Lower mod draws nothing: output equals today's.
2. Lower mod draws a Box: autopilot on top, lower mod below.
3. hasSurvey: yields as before.
4. Negative control: remove the next call; test 2 must go red.

## UI rule
Before merge attach before and after colour screenshots for owner confirmation (docs/plans/2026-10-13-live-pane-design-system.md section 12).

## After merge
Reply to codeforge with the commit. Version stays 3.0.0.
