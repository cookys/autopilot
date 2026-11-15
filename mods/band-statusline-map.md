# Band and statusline field map

Single map for the autopilot collapsed band and the codeforge statusline (PM 2026-11-16, fleet task 01M7G7KY). Codeforge renders its own rows from the published file. This repo publishes the file and draws the band.

## Collapsed band row

One line. Speed (tok/s) and trend stay in the same segment as the pet. They drop with the existing narrow steps (pet, fleet wait, fleet run and word, trend, speed). `fleetStuck` is never a drop step.

| Field | Where |
|---|---|
| Verdict | Band |
| 待決 tab | Band tab strip |
| QC | Band |
| Hygiene (source chip and ⚑N) | Band. The chip is not dropped below 160. The reason still drops below 160. |
| Fleet | Band |
| Dispatch stalled ⊘ | Band. Not dropped by the narrow fallbacks. |
| Speed, trend, pet | Band, forge segment |
| Dispatch ●live, position, unit, review round, decisions | Statusline, via `band-facts/<sid>.json` |
| Spend | Statusline, via `band-facts/<sid>.json` |
| 5h / 7d quota | Statusline only. The expanded usage tab still draws the windows. |

`bandSlots` returns verdict, fleet, stalled dispatch, QC, hygiene. Slot functions used by the expanded tabs stay.

## Shared resolutions

1. Quota colour: warn at 80% of the raw ratio, error at 100%. Below the warn percent the band leaves the text uncoloured. Both sides read the percents from the contract file.
2. Percent rounding: floor. 79.9 shows 79.
3. Bar glyphs: ▰ and ▱.
4. Band labels (QC, dev / cache / src, quota short labels) come from the locale tables, including zh-TW. Statusline bars stay short `5h` / `7d`. Another account's `週` becomes `7d` on the statusline side.
5. The band colours through `PALETTE` theme keys. The statusline applies its own RGB to the same thresholds.
6. Warning glyph is ▲. ⚠ is not used on the band.
7. ◷ means elapsed only, never time remaining.
8. Three arrows stay distinct: band hygiene `↓` is commits behind upstream, statusline `⇣` is git behind, statusline `⬆` is a new Claude Code version.
9. Each surface keeps one yellow. The pair is two surfaces.

## Contract file

`mods/live/band-statusline-contract.json` is the only editable copy of the thresholds, the floor rule, and the glyphs. A hooks module imports only code files and cannot import node builtins, so `node mods/live/gen-band-contract.js` compiles that JSON into `mods/live/band-contract-data.ts`. Glyphs in the compiled file are `\u` escapes; the values equal the JSON. `band-contract.ts` imports the compiled file and checks the shape. `run-tests.sh` runs `gen-band-contract.js --check` and fails when the compiled file drifts. The published file copies the same object so codeforge reads it from there.

The published `contract` object has exactly these keys, in this order: `quota_warn_pct`, `quota_error_pct`, `round`, `bar_on`, `bar_off`, `alert`, `age`. `round` is `"floor"`. `alert` is the warning glyph ▲. `age` is ◷. ◷ means elapsed, never time remaining; that sentence is not a key in the published object.

## Published file

`<live_base>/autopilot/band-facts/<sanitised sid>.json`, one file per session. The directory is created by the plugin fs write. The filename is `sanitizeSid(session_id)` (empty becomes `unknown`; every scalar outside `[A-Za-z0-9_-]` becomes `_`; first 64 scalars). The JSON `session_id` field stays the raw session id. Written from the refresh loop once the snapshot state is `ok`, the pointer's `live_base` is known, and the session id is set (including console mode).

The refresh tick is `TICK_MS` 5000. There is no separate throttle on this write, so a steady run of ok ticks rewrites `written_at_ms` every 5 s, which is inside the 10 s bound. A failed or non-ok tick does not publish, so the previous file stays and `written_at_ms` is not refreshed. The statusline treats a file whose age is outside `0..30000` ms as absent (30 s and a future timestamp both count). That stale reading after a non-ok stretch is intended.

```json
{"v":1,"written_at_ms":0,"session_id":"","contract":{"quota_warn_pct":80,"quota_error_pct":100,"round":"floor","bar_on":"▰","bar_off":"▱","alert":"▲","age":"◷"},"progress":{"live_dispatches":0,"position":null,"unit":null,"review_round":null,"decisions_open":0},"spend":{"usd":null,"cap_usd":null}}
```

`progress` keys are exactly `live_dispatches`, `position`, `unit`, `review_round`, `decisions_open`. `live_dispatches` and `decisions_open` are numbers (0 when none). `position`, `unit` and `review_round` are null when there is no value. `position` is `size[!]·level·stage` (no unit label, no age). `unit` is `index/total`. `review_round` is the code-review generation, else the plan generation. `spend` keys are exactly `usd` and `cap_usd` (brain dollars and the cap, null when absent). Numbers and those tokens only. No prompt or transcript text. Quota windows are not in this file.

The plugin fs API has no rename, and a hooks module cannot reach `rename` through a dynamic import. The publisher writes `<sid>.json.tmp` in the same directory, then writes `<sid>.json`. Each write is the whole document. A tick that fails before the destination write leaves the previous file.

## Cleanup

At most once a minute, on a tick that read a valid live pointer (a non-ok snapshot still counts; a failed pointer read does not), the publisher lists `band-facts/`. It never rewrites this session's `<sanitised sid>.json`. Another `*.json` is retired when its session is not alive by `markerAlive` (the same rule as `resolveScope`: marker at `<autopilot_home>/session-mode/<sid>.json`, raw session id). The session id is the file's `session_id` when `sanitizeSid` of that value is the filename stem, otherwise the stem. A `*.json.tmp` whose `stat` mtime is older than 5 minutes is retired, including this session's temp. A name that contains a slash or `..` is left alone.

Claude Code 2.1.322's plugin fs has `read`, `write`, `list`, `exists`, `stat` and `ancestors`. `$.fs.delete`, `$.fs.unlink` and `$.fs.remove` are not functions, and a hooks module cannot import `node:fs` or spawn a removal. Retire means `$.fs.write(path, '')` on that literal path. An empty file fails the reader's JSON parse and `v == 1` check, so the statusline treats it as absent. The directory entry remains.
