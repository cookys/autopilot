# Rubric — 2026-11-21-wasted-turns.md

> Source plan: docs/plans/2026-11-21-wasted-turns.md

R1: a measurement script exists at scripts/wasted-turns-report.js, takes a window, an output path and a top-N, and emits JSON with schema autopilot.wasted-turns/1 containing the five classes, whiff_per_100 and whiff_share.
R2: in usage-only mode the output and stderr never contain message content: a sentinel string placed in a fixture's message text does not appear anywhere in the output.
R3: each of the five classes has at least one counted case and one not-counted case in fixtures with hand-written expected counts; the not-counted retry case (error followed by a different command) is shown red before the classifier fix and green after.
R4: each turn is counted in at most one of the first four classes, and the headline white-turn count is their sum with the fifth class reported separately.
R5: every in-repo guard and hook named in plan section 3.1 has exactly one chosen approach (a to f) with a one-line reason; every item outside the repo is marked as owned by an external lane.
R6: the in-repo list in section 3.1 contains every file that `git ls-files hooks scripts | grep -i guard` returns, or states why it is outside the per-turn path.
R7: every changed hook or script ships a negative control, and the correct command quoted in each changed refusal message, run as written, passes the same guard that refused the original.
R8: no guard that blocks a destructive operation has its allow or deny decision loosened; only message text changes, except the one spike named in the plan.
R9: no tool or tool description is added or changed in the middle of a session; each such change states it takes effect at the next session start.
R10: the baseline run (before) and the after run use the same script and window length, each covering at least 300 turns per seat, and the after run is taken only after the changed sessions were restarted.
R11: the after-run white-turn share is below 5 percent against the 19 percent baseline cited from PM task 01M7XSVA, reported per seat per 100 turns.
R12: every phase row has a launch date on or after 2026-11-22 Taipei time, a fleet task id field (待開 until opened), and a dependency.
R13: the Stop-hook false-block work is attached to the existing task 01M7XQVB and no second task is opened for it.
R14: the split with the fleet lane is stated: MCP tools and fleet CLI belong to fleet, the four requester tools stay on task 01M7XSNQ, and the hook-side Stop work belongs to autopilot.
R15: the weekly run is delivered as a script plus one call example, with the schedule itself owned by an external lane.
R16: measurement reads only the seat's own transcripts (d-7436a800) and, for other seats, only usage number fields (d-d031e0de); tests use a sandbox home and never read the real ~/.claude.
R17: no version bump, no hosted CI workflow, no private network address literal in any committed file.
R18: cited numbers from PM task 01M7XSVA are quoted as given (511 calls, about 98 white turns, 19 percent, 15 help, 41 errors, 42 Stop blocks) and are not re-measured by the plan.
