# foreman-guard needs a cost-shaped gate (cache-read tokens or lifetime); covers clone foremen w/ INACTIVE marker

Plan `docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md` §7 (Out of scope) named this explicitly as
"becomes a new BACKLOG row at landing." The v2.36.97 release shipped role-aware Bash call caps
(`Role: worker|reviewer` → 120 calls; foreman/undeclared → 40), an 8-call close-out reserve with a safe
allowlist, and a no-marker advisory every 40 calls for autopilot-dispatched subagents with no `Role:` line.
All three are **call-count** gates. None of them says anything about **cost**.

## The gap

- A call-count cap treats a cheap `git status` and an expensive multi-hundred-KB tool response identically.
  A subagent could stay well under 120 calls while burning far more in cache-read tokens than a capped
  peer that hit 120 trivial calls.
- **Clone-based foremen** (a foreman that operates from its own git clone rather than a worktree under the
  main checkout) are a known blind spot for the existing l4–l6 marker mechanism: when that foreman's marker
  is INACTIVE, none of the role-cap/reserve/advisory machinery in this release currently has visibility into
  it at all. A clone-based foreman running away has nothing watching it.

## What plan §7 also named as out of scope for this release (peer follow-ups)

- A foreman lifetime cap (bounding a foreman's total spend across its whole run, not per-call).
- A per-subtree budget (bounding spend for one branch of a dispatch tree independent of the rest).
- A signed role header (making the `Role:` line on line 2 of a dispatched prompt tamper-evident, rather than
  a plain-text convention a child could in principle rewrite in its own later output — note the existing
  design already never trusts a child's own later output for its role, only the first user message; a signed
  header would extend that guarantee to the marker itself).
- Any hard cap on the no-marker path was an explicit operator decision (2026-09-25) to leave alone for this
  release — the no-marker path is advisory-only, never denied, by design.

## Trigger

Pick this up when either becomes true:
- A hook-readable cumulative per-agent token feed exists (something foreman-guard, a synchronous PreToolUse
  hook, can read cheaply without an out-of-process round trip) — cache-read tokens are the natural unit,
  since they dominate dispatch cost per `references/hetero-dispatch.md`'s context-window-gate telemetry.
- A clone-based foreman is measured running away in practice (i.e. this stops being a theoretical gap and
  becomes an observed incident).

## Effort

M — this needs a new cost-feed integration point (not just a counter), a decision on what "cumulative" means
across a dispatch tree vs. a single agent, and coverage for the clone-based-foreman blind spot specifically,
which the existing marker-detection code was not written to see.
