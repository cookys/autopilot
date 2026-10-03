> Status: investigation; fixed in v2.36.113. Date: 2026-10-03.
> Source: autopilot maintenance session (fable depth-0), run3 closeout; original at session scratchpad research/ctx-signal-dogfood.md.

# ctx-signal dogfood: cost-tracker "heavy context" vs real 33% (read-only, 2026-10-03)

## Findings
1. Emitter: `hooks/cost-tracker.js:134` (stderr) and `:137` (same text queued to
   `<live>/advisory-queue/<sid>.jsonl`, delivered next prompt by `hooks/advisory-relay.js`
   as UserPromptSubmit additionalContext, verbatim). Wording is a single literal; no context % in it.
2. Measures: SUM of `cache_read_tokens` over every costs.jsonl row of this session (`:125-129`).
   Rows come from the transcript: each assistant turn's `message.usage.cache_read_input_tokens`
   (`hooks/cost-tracker-lib.js:61`), appended per Stop (`cost-tracker.js:96-110`).
   So yes: cumulative cache_read over all API calls of the session. Not window size.
3. Threshold: 50,000,000 default (`cost-tracker.js:117`); config `~/.autopilot/config.json`
   `cost_tracker.cache_read_warn_tokens` (`:120`) or env `AUTOPILOT_COST_TRACKER_CACHE_READ_WARN` (`:123`).
   Fires at threshold then each doubling (`:131-133`). The printed "(threshold N)" is the doubled `next`.
4. Default-on: hooks.json:191 comment "v2.35.15 default-on"; hooks/README.md:172; opt-out
   `AUTOPILOT_COST_TRACKER=false` (`cost-tracker.js:41`). Operator's `~/.autopilot/config.json` has no override.
5. The cited doc pointer is wrong: `docs/ironlaw-to-gate-map.md` #6 (line 21) is "Foreman no polling /
   Bash >40", not cache reads. The code comment (`cost-tracker.js:111`) calls it "cuda digest #6"; the message
   borrowed the number. Reader following the pointer finds an unrelated rule.
6. Real context signal exists and was already true at the time:
   `/run/user/1000/autopilot/context/76c98aac-....json` => `used_percentage:33`, `context_window_size:1000000`,
   `total_input_tokens:334902`, current cache_read 332,034 (written by codeforge statusline; README.md:297).
   Consumers: `hooks/context-budget.js` (header lines 33-45; T1/T2 scaled to live window, `context-budget-lib.js:85`),
   `foreman-guard` (subagent rows), `depth0-delegate-gate`. Also `scripts/check-context-window.js` (pre-dispatch
   engine-window fit, unrelated to session fill), `scripts/statusline-live-tee.js` (non-codeforge hosts).
   cost-tracker does NOT require/read `live-state-dir.js` readLive (it only uses resolveLiveDir for the queue path, `:139`),
   so it cannot report or gate on the real %.
7. Model had no true % because: hooks inject text only; nothing in the injected text carried it; the live file
   is not in the model's context; context-budget stays quiet (or says its own thing) independently. The model
   saw one confident sentence ("long-lived context ... re-read on every call") and no counter-number.
8. cost-fuse: `hooks/cost-fuse.js:260-291` sums `cost_usd` of ALL rows today (UTC prefix, `:262`) whose
   `tierOf(model)==brain` (fable/mythos/opus, `scripts/cost-digest.js:27-37`) across EVERY session on this host
   (the text says "on this host", `:341`), not this session. Threshold $150 (`:26`), cfg `cost_fuse.daily_usd_brain`,
   env `AUTOPILOT_COST_FUSE_DAILY_USD`; mode warn default; fires once per session per $150 multiple (`:354`).
   Default-on: hooks.json:77, README.md:168. Advice `:341` "brief and dispatch to hands".

## The math (ledger numbers, ~/.claude/metrics/costs.jsonl, 3550 rows)
- This session 76c98aac: 318 turns, 62,400,747 cache-read tokens (avg 196K per call), 912K cache-write, 216K output.
  Ledger cost $126.94: cache-read $93.60 (74%), cache-write $17.10, output $16.23 (at the hook's opus rate 15/75,
  mult 0.1/1.25, `cost-tracker-lib.js:18-35`). Cache reads ARE most of the bill.
- Quadratic growth: with context C(n) ~ c0 + k*n, cumulative reads = sum C(n) ~ n*c0 + k*n^2/2. Even a flat
  window W gives n*W. 51.3M = e.g. 156 calls at 330K (33% of 1M) or 250 calls at 205K (20%). On a 1M window a
  33% fill is already 332K tokens re-read per call = ~$0.50/call at $1.50/M read (opus rate in this repo).
- So 51M is not evidence of a FULL window; it is evidence of (calls x window). It is a cost signal. It is also
  honest that a 330K window is expensive per call: the advice "split the work" is cost-justified here, "/clear" as a
  fix for "heavy context" is the mislabel. Window health (33%) and spend rate are independent axes; the message
  merges them under "context".
- Ratio: cache read = 10% of input (repo constant; Anthropic pricing page https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  documents 0.1x read / 1.25x 5-min write for earlier models; I did NOT re-fetch it this run => unverified for opus-5.x).
  Also PRICING table is hardcoded opus 15/75 for every "opus*" incl. opus-5/5-5 and has no fable row (fable falls to
  the sonnet rate, `getRate` default) => absolute dollars here are unverified, fable undercounted.
- Biggest sessions: d1423f91 761M reads / $1406; 1b58dad4 529M / $995. 51M is ~7% of the worst; threshold is low for
  1M-window sessions and the doubling sequence 50/100/200M re-fires often in long runs.
- cost-fuse number plausibility: ledger day 2026-10-02 opus-5-5 = $587.45 (so $537.67 at the moment of firing is
  plausible; today 10-03 so far $97.79 brain). Number is cross-session and priced by an unverified table.
  Actionability: at depth-0 it is mostly noise: the session already dispatches to hands; the fuse trips on any
  non-read-only Bash/Edit/Write (including the dispatch command) and at depth-0 brain spend is mostly cache_read of
  the brain's own long context, which dispatching does not reduce. Useful part: a daily spend notice.
  Worse: it sums other parallel sessions, so one session is told to change behaviour for spend it did not cause.

## Is it a bug
- cost-tracker message: YES, 🟠 Major (wording/semantics, advice misleads). Mechanism itself (counting) is correct.
  Sub-defects: 🟡 wrong doc pointer (#6); 🟡 "context" language for a cost sum; 🔵 threshold fixed, not window/rate aware.
- cost-fuse: 🟡 Minor / 🔵 Suggestion. Number real, wording is truthful ("spend today"); but advice not scoped
  to session cause, price table unverified, fires on dispatching itself. Not a mislabel.
- Model behaviour: process fault (see Lesson), 🟠 for the operator-facing repetition twice.

## Proposed fix (prose)
1. Rename message to a cost signal: "cost-tracker: this session has re-read N cache tokens cumulatively
   (~$X at ledger rates, Y% of session spend)". Drop "long-lived context is being re-read on every call" as a claim.
2. Read the live file (`readLive` as context-budget does) and print "context now P% (T of W tokens, statusline)" next
   to it; if no fresh live file print "context % unknown". Recommend /clear + handoff ONLY when P >= configurable
   threshold (e.g. 50%) ; below it say "window is fine; the cost is calls x window; consider splitting or a
   cheaper tier for mechanical work".
3. Replace/augment threshold with a rate metric: per-turn average read (cacheRead/turns over last N rows) or
   dollars per hour; keep cumulative as secondary. Scale cumulative threshold by window size.
4. Fix the pointer: cite `docs/` cost section or drop "#6"; add a hooks-message rule: a model-facing advisory must
   name what it counted and carry the contradicting-axis number when one is cheaply available.
5. cost-fuse: scope to this session or show both ("this session $a / host today $b"); stop firing on the dispatch
   command itself; verify PRICING (opus-5.x, fable) against official pricing before trusting dollar thresholds.
6. Model-facing side: when an advisory carries a % or a claim the model can check, the brain should read the live
   file (`/run/user/<uid>/autopilot/context/<sid>.json`) before relaying "context is heavy".

## Tests that would prove it
- cost-tracker: fixture costs.jsonl >50M cache reads + live file used_percentage=33 => message contains "33%" and
  does NOT contain "/clear"; with used_percentage=70 => contains handoff advice; no live file => "unknown", no /clear.
- Mutation check: revert the readLive wiring and the 33% test must fail (evidence-discipline #2).
- Pointer test: referenced doc anchor text matches the claim (gate-map row says cache read).
- cost-fuse: two sessions' rows in ledger => message reports per-session and host figures; dispatch-to-hands Bash
  command does not re-trigger.
- PRICING: fixture for opus-5-5 and fable asserting rate equals a cited constant.

## Mechanism or guidance?
Per CLAUDE.md literal test (list requirements before/after): the gate currently "asks" the operator/model to act
when cumulative reads >= 50M. Adding the real % and renaming wording changes what is DEMANDED of the model
(/clear is conditional on P) => GUIDANCE change, needs eval ON/OFF evidence (scorecard-first) for the wording
rewrite. Reading live % itself is a mechanism addition (new signal) but it changes the message requirement, so
ship as two commits: (a) mechanism: surface P in the message verbatim, no wording change in the recommendation;
(b) guidance: recommendation conditional on P, with eval. Version: PATCH (hook behaviour change). Fixing the wrong
#6 pointer alone is a doc/code-string touch inside shipped code => PATCH.

## Lesson: where it fits
- `references/evidence-discipline.md` #19 ("A proxy is not the measurement") applies directly: cumulative cache
  reads were adopted as a stand-in for "context heavy" without naming what it counted. #26 (value already published
  via another channel) also applies: the real % was in the statusline live file. Propose NEW entry #29: "A hook's
  claim is a proxy until the actor re-derives it from the harness's own number; the advisory author must ship
  the contradicting-axis figure, and the model must check it before repeating it to the operator". Update
  memory instead of opening a new file (per MEMORY: lessons go to evidence-discipline).
- Hook message wording rules: none exist in hooks/README.md that I found; add one there (name what is counted).
- Model-side: memory note for depth-0: before relaying a hook advisory about context size, `cat` the live file.
