# context-budget reads a different live dir than the statusline writes (hook env lacks `XDG_RUNTIME_DIR`) → false T2 at ~150k in 1M sessions

## Symptom

In a 1M-context-window session, the context-budget hook (`scripts/check-context-window.js` /
`scripts/lib/context-window.sh`) fires T2 at ~150k, ~164k, ~174k, ~195k tokens instead of near the
real ~1,000,000-token ceiling, and the v2.36.22 "window memory" behavior (which is supposed to widen
its threshold once it has observed a large `context_window_size`) never engages.

## Root cause

The statusline process and the hook process resolve the "live state dir" differently:

- The **statusline** writes fresh session state to `/run/user/<uid>/autopilot/context/<sid>.json`,
  with `context_window_size=1000000` recorded correctly (per `references/live-state-goes-tmpfs.md` —
  the convention is `$XDG_RUNTIME_DIR` or `/dev/shm`).
- The **hook**'s `resolveLiveDir()` (`scripts/lib/live-state-dir.js`) is invoked in a process whose
  environment lacks `XDG_RUNTIME_DIR` (hook subprocess env is a stripped-down copy), so it falls
  through to `/dev/shm/autopilot-<uid>/`, where `context/` is empty — the statusline never wrote there.
- With `context/<sid>.json` unreadable at the dir the hook actually checked, the hook falls back to a
  hard-coded 200K-token inference for the window size, so its T2/T3 percentage thresholds compute
  against 200K instead of 1M, firing far too early and permanently — the "window memory" upgrade path
  that's supposed to widen the effective ceiling once a real `context_window_size` is observed never
  gets a chance to read one.

## Evidence

- Reported by local peer session `308-d1` (session `67899ee7`), 2026-09-28, fleet-relayed: false T2 at
  150k/164k/174k/195k tokens in 1M-window sessions.
- The controlling depth-0 session (`ee9eb17b`) also received false T2 at 152k/164k/186k tokens on
  2026-09-24/25 in a 1M session — same symptom shape (T2 firing at a small fraction of the declared
  1M window).

## Candidate fixes

1. **Reader scans all candidates.** Have the hook-side reader for `context/<sid>.json` try every
   known live-dir candidate in order (override → `$XDG_RUNTIME_DIR` → `/dev/shm` → `/tmp`) rather than
   trusting a single `resolveLiveDir()` pick, so a mismatch between writer and reader environments
   degrades to "found the file at whichever candidate matches" instead of "found nothing."
2. **Infer XDG from `/run/user/<uid>` when unset.** `resolveLiveDir()` could check whether
   `/run/user/<uid>` exists and is writable even when `XDG_RUNTIME_DIR` itself is not exported to the
   hook's environment, since the directory convention (not the env var) is what's actually load-bearing
   here.
3. **Add a regression test for the split-env case**: statusline process has `XDG_RUNTIME_DIR` set,
   hook process does not (simulating the real hook subprocess environment) — assert the hook still
   finds the statusline's `context/<sid>.json` and does not fall back to the 200K inference.

## Fix shape

This is a hermeticity/environment-propagation bug, not a logic bug in the T2/T3 threshold math itself
— the thresholds are computed correctly against whatever `context_window_size` the hook manages to
read; it just usually can't read the real one. Fix (1) or (2) above (or both) closes the immediate gap;
(3) prevents recurrence if a future refactor reintroduces an env-dependent resolution path.
