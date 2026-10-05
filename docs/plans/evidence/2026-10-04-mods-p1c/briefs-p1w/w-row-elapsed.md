# P1W row ELAPSED — elapsed start is chosen by campaign-vs-session, not by "has a root"

Read `w-common.md`, `hand-c3-brief.md` (how the mod is tested) and the W3a + PLAINROOT reports. Base: `w/int5` (2fbd2b87). Worktree `$P/wt-elapsed`, branch `w/elapsed`.

Finding (gate kit, depth-0 confirmed): `mods/live/model.ts` `startMsOf` (~L392) returns `receiptMs ?? earliestRun` whenever the marker has a root. Since PLAINROOT every plain session has a root, so a dev-flow/plain or fresh /l3–/l4 session with no dispatch and no receipt shows elapsed `—`.

Fix: start = earliest bound progress receipt (campaign) → tasks `first_created_at` → marker `started_at` → earliest run → null. Update the comment above it and `references/mods.md` if it states the old rule. Tests (RED-first): plain session with root, no runs, tasks present → tasks time; no tasks → marker time; campaign with receipt → receipt time even when the marker is older; nothing at all → `—`. Mutation outputs under `$P/run-w/elapsed/`. Verify: mod wrapper run (`claude plugin test`), tsc, negative grep, codex sync if a mirrored doc changed. Isolation as usual. One commit `fix(mods): elapsed starts at the campaign receipt or the session start, not only for rootless sessions (mods P1W ELAPSED)`. Report `$P/run-w/elapsed/REPORT.md`.
