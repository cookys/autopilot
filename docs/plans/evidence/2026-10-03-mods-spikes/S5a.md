Verdict: partial — terminal verified end to end (hot reload rebuilds clock.every, old timer dies, exactly one timer after each of 2 reloads, session.end cancels, no tick after exit); desktop not reachable on this host, only the engine-level `plugin test` surface=desktop loop ran.

Scope: S5(a) only (mod lifecycle). S5(b) is in S5b.md (Hand A). $WORK = /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b

## Mod (throwaway)
artifacts/S5/{plugin.json, hooks.json, register.ts, lifecycle.test.ts}. On `session.start` it starts `$.clock.every(1000, ...)` appending to a per-generation file `out/ticks/<GEN>.log` via `$.fs.write` (GEN = random id at module load, so each reload is a new file; VERSION constant is what I edit to force a reload). On `session.end` it calls `timer.cancel()` and writes a last line. `claude plugin validate` forbids passing `$` to a helper, so every `$` use is inline. (register.ts in artifacts is the final state, VERSION='v3'.)

## A. `claude plugin test` (surface loop)
Surface selection (types header lines 46-58, quoted): `for (const surface of ['terminal', 'desktop'] as const) { const ui = await $.ui.mount({ plugin: 'notes', surface, ...BAND })`; mount draws "through the plugin on the surface the test names (terminal, desktop, vscode or mobile: never assumed)". `$.session.start`/`$.clock` take no surface parameter; my loop passes `surface` in the session.start input, so both iterations run identical timer logic. The desktop iteration proves nothing desktop-specific.
Test: `mock.clock`; bottom-of-chain `on('fs.write')` (must return `{ value: undefined }`; `{}`, `null`, nothing are rejected); bottom `on('session.start')`/`on('session.end')`; asserts 3 ticks after advance(3000), then no writes after `$.session.end` + advance(5000).
```
cd /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b && ./cc.sh plugin test /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/s5mod
```
`cc.sh` (artifacts/S5/cc.sh): `env -u AUTOPILOT_SESSION_ID CLAUDE_CONFIG_DIR=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/claude-config HOME=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/home TMPDIR=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/tmp claude "$@"`; config dir mode 0700, .credentials.json copied in (0600).
Raw output (artifacts/S5/plugin-test.out, a later re-run; the first run was identical in result):
```

hooks/lifecycle.test.ts:
(pass) clock.every ticks once per period, stops after session.end (surface=terminal) [94.71ms]
(pass) clock.every ticks once per period, stops after session.end (surface=desktop) [36.61ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.34s]
```
Gotcha: with the REAL ~/.claude, `plugin test` printed "hooks modules are turned off in this process: the rollout switch was saved off by an earlier session"; with the isolated dir it ran.

## B. Real interactive reload (tmux)
Launcher artifacts/S5/launch.sh: `claude --plugin-dir s5mod --model claude-haiku-4-5-20251001 --max-budget-usd 0.05` via cc.sh, cwd $WORK/proj, run in tmux session `spikeb` (`--no-session-persistence` is print-only and refused). Child HOME = /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/home. No prompt was sent to the model.
Sequence (epoch ms, artifacts/S5/edit-time.txt):
1. v1 session up, 1 tick/s.
2. `sed -i "s/VERSION = 'v1'/VERSION = 'v2'/" s5mod/hooks/register.ts` at 1791036364473; pane showed `● spike-lifecycle: reloaded (2 hooks: session.start, session.end)`.
3. v2->v3 at 1791036386359.
4. `/exit` via tmux send-keys at 1791036405108.
Analysis (`node analyze.js out/ticks`; artifacts/S5/analysis.out; raw per-generation logs artifacts/S5/ticks-g3bihah.log, ticks-gtiizdr.log, ticks-grsu9zd.log):
```
g3bihah v1 first 1791036337544 session.start surface=terminal | ticks 27 first tick 1791036338561 last 1791036364599 | gap ms min/max/mean 1001 1003 1001 | events: session.start surface=terminal
gtiizdr v2 first 1791036365132 session.start surface=terminal | ticks 21 first tick 1791036366151 last 1791036386193 | gap ms min/max/mean 1001 1010 1002 | events: session.start surface=terminal
grsu9zd v3 first 1791036386911 session.start surface=terminal | ticks 18 first tick 1791036387926 last 1791036404965 | gap ms min/max/mean 1001 1007 1002 | events: session.start surface=terminal;session.end reason=prompt_input_exit cancelled
handover g3bihah -> gtiizdr : last old tick 1791036364599 first new line 1791036365132 delta ms 533 (neg = overlap)
handover gtiizdr -> grsu9zd : last old tick 1791036386193 first new line 1791036386911 delta ms 718 (neg = overlap)
ticks in last 5s across all gens: 0 by gen {}
```
(The "ticks in last 5s" line, if present, was computed after the fact and is meaningless.)
- Old timer stops: g3bihah (v1) last tick 1791036364599, 126 ms after the edit; never again (27 ticks, gaps 1001-1003 ms).
- Exactly one new timer: gtiizdr (v2) has its own `session.start` line (the host RE-FIRES session.start in the fresh environment) 533 ms after the old last tick, no overlap, gaps 1001-1010 ms (~1/s, not 2/s). Second reload: 718 ms handover, gaps 1001-1007 ms. Doubling inside one environment would show as sub-1000 ms gaps; minimum observed 1001 ms.
- `session.end` is NOT fired on reload (old gens have no such line); the host drops the old environment's timers (types clock doc: "a hot reload of the plugin cancels its pending waits with the old environment").
- After /exit: grsu9zd ends `tick 18` then `session.end reason=prompt_input_exit cancelled` at 1791036405264 (156 ms after /exit); file unchanged 6+ s later; pane showed `EXITED rc=0`.

## Isolated-config seeding and the real ~/.claude.json
With only .credentials.json in the isolated dir, interactive claude sat on the login wizard (I did not log in). I therefore ran artifacts/S5/seed.py, which READS the real `/home/cookys/.claude.json` (open(...,'r') + json.load only) and WRITES only `/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/claude-config/.claude.json`. Fields copied from the real file: `oauthAccount` and `lastOnboardingVersion` — nothing else. Fields I set myself (not copied): `hasCompletedOnboarding: true`, `theme: "dark"`, and `projects["/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/proj"] = {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, allowedTools: []}`. (The child itself added its own cache/state keys such as cachedGrowthBookFeatures, machineID, userID to the isolated file.) `.credentials.json` was copied once with `cp` from ~/.claude/.credentials.json (read-only on the source). I never wrote the real ~/.claude.json or anything under ~/.claude/, and no child claude ran with the real config dir. Caveat: the real ~/.claude.json mtime is 23:23, which is the live owner/other sessions rewriting it continuously; I cannot prove from timestamps alone that none of my commands touched it, only from the commands listed here (the only references to it are the read in seed.py). The oauthAccount block holds account identifiers (email etc.), now also present in /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/claude-config/.claude.json (not copied into the evidence dir).

## Does NOT prove
- Desktop host reload (CLAUDE_CODE_PLUGIN_DIR_WATCH=1 for long-lived headless/desktop sessions is documented in reference.md line 69 but untested).
- A timer started somewhere other than session.start would not be rebuilt on reload; ours is rebuilt only because session.start re-fires.
- /clear or resume: by the types, /clear fires session.end reason=clear and no session.start afterwards, so a timer started in session.start would be cancelled and not rebuilt; not run.
- Timer behaviour under heavy turns (host load ~40 during run; gaps stayed <= 1010 ms).
