---
name: debug
description: Evidence-first debugging for correctness issues. Invoke when diagnosing bugs, crashes, logic errors, data corruption, connectivity problems, intermittent failures (incl. flaky tests with environment divergence), or 'works on my machine' issues. For performance issues (slow / high latency / CPU / memory), use the profiling skill instead. For perf regressions with known change attribution, profiling is still primary — measure first, don't guess from the deploy diff.
---

# Evidence-First Debugging

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer single-bug diagnosis over baseline test design).

## Coexistence with Superpowers

This skill is autopilot's standalone fallback for debugging methodology. If the `superpowers` plugin is installed, you may prefer `superpowers:systematic-debugging` — both work; `.claude/dispatch-config.md`'s `## Debugging` chain controls which one orchestrator skills (ceo-agent / finish-flow / quality-pipeline) dispatch.

Differences worth knowing:

- **autopilot:debug** is evidence-first (tool → log → code) with explicit Three Red Lines integration and `debug-config.md` project context injection. Stricter discipline; prescriptive ordering.
- **superpowers:systematic-debugging** is more general-purpose with broader hypothesis-driven framing. Less prescriptive, broader applicability.

<!-- Project-specific config (tool tables, log locations, common commands) -->
!`cat .claude/debug-config.md 2>/dev/null || echo "No project-specific debug config found. Use generic evidence collection below."`

## Core Principle

```
1. Tool-collected evidence  -> profiler, logs, EXPLAIN, debugger, DevTools
2. Log analysis             -> correlate with tool findings
3. Source code analysis     -> informed by evidence from 1 + 2
```

**Never guess from code alone.** Always collect evidence first.

## Available Scripts

| Script | Replaces LLM-judgment for | When invoked |
|--------|---------------------------|--------------|
| [`scripts/probe-unknown.js`](../../scripts/probe-unknown.js) | Count refuted hypotheses and the other ladder signals; recommend one rung (U0–U4) | Step 4, after every refuted hypothesis |
| [`scripts/dispatch-consult.sh`](../../scripts/dispatch-consult.sh) | Ask the consult seat one bounded question, advice only; `--ladder-receipt` stamps the U1 row | Step 4, only on `recommend: U1` |
| [`scripts/decision-ledger.js`](../../scripts/decision-ledger.js) | `append --kind hypothesis` — every hypothesis and its refutation as a ledger row (the S1 counter) | Steps 3–4 |

## Relationship with Profiling

| Skill | When to Use |
|-------|-------------|
| **debug** | Correctness: crashes, bugs, logic errors, data corruption, connectivity |
| **profiling** | Performance: slow queries, high memory, CPU spikes, latency |

If unsure, start with `debug`. If evidence points to a performance root cause, switch to `profiling`.

## Debug Cycle

1. Reproduce the issue reliably
2. Collect evidence with appropriate tools
3. Form hypothesis based on evidence; write it down: `node scripts/decision-ledger.js append --ledger <ledger> --kind hypothesis --json '{"hypothesis_id":"h1","text":"…","status":"open","work_unit":"<task>"}'`
4. Verify hypothesis (don't assume). When it fails, append the same id with `"status":"refuted"` and an `evidence_refs` entry, then run `node scripts/probe-unknown.js classify --ledger <ledger> --work-unit <task> --terms <error nouns>` and act **only on `recommend`** (the probe counts the refutations — the "after two failed hypotheses" rule is its S1 threshold, not a rule you police by memory):
   - `U1` → `bash scripts/dispatch-consult.sh --question-file <q> --artifact <a> --ladder-receipt <ledger> --ladder-terms <terms> --ladder-unknown-type why --ladder-signals S1 --ladder-work-unit <task>` (advice only, never a verified fix)
   - `U2` → survey `issue-search` with the exact error string, then `node scripts/probe-unknown.js receipt --ledger <ledger> --rung U2 --unknown-type why --terms <terms> --signals S1 --work-unit <task>`
   - `U3` → dispatch `autopilot:debugger` (PUA mode), then `node scripts/probe-unknown.js receipt --ledger <ledger> --rung U3 --unknown-type why --terms <terms> --signals S1 --work-unit <task>`
   - `none` → keep verifying (the probe never recommends U4; when you stop for the owner, show the ledger) (a `reason` of `budget-exhausted` / `not-heterogeneous` / `knob-off` names why nothing is recommended)
   Ledger: `<project>/ledger/decisions.jsonl`, or the probe's default `~/.autopilot/ladder/<repo-hash>.jsonl` when no project exists.
5. Fix root cause (not symptoms)
6. Verify fix with same tool + same test
7. Record in knowledge base if non-trivial (invoke learn skill)

> **3-fix architecture gate.** If **3 fix attempts have failed**, STOP attempting fix #4 — the repeated failure is itself evidence that the **mental model of the architecture is wrong**, not that the next tweak is the right one. Step back and question the structure: is the bug where you think it is? Is a component boundary / assumption (data shape, ordering, ownership, environment) violated upstream of where you're patching? Re-collect evidence at the boundary above the suspected site before any further fix. (Changing a flag/parameter is not a new attempt; changing the diagnostic *angle* is.)

## Evidence Collection Guide

Identify the right tools for your problem category. If your project has a `debug-config.md`, it will list specific commands. Otherwise, use this generic guide:

| Problem Category | What to Look For | Generic Tool Examples |
|-----------------|-------------------|----------------------|
| **Crash / panic** | Stack trace, exit code, core dump | Debugger (gdb/lldb), backtrace env vars, crash logs |
| **Logic error** | Wrong output, unexpected state | Breakpoints, print/log statements, unit test isolation |
| **Data corruption** | Bad values in storage, schema mismatch | DB query tools, EXPLAIN plans, data validation scripts |
| **Connectivity** | Timeout, refused, DNS failure | curl, netcat, ping, tcpdump, browser Network tab |
| **Auth / permissions** | 401/403, token expiry, role mismatch | Token decode tools, request headers, auth middleware logs |
| **Build / compile** | Error messages, missing deps | Build tool verbose mode, dependency tree, clean rebuild |
| **State / concurrency** | Race condition, deadlock, stale cache | Thread dumps, lock analysis, cache inspection |

## Log Query Funnel

1. Filter by time range -- narrow to incident window
2. Filter by severity -- errors, warnings, panics, exceptions
3. Correlate by request -- trace ID, request ID, session context
4. Expand context -- surrounding log lines for the correlated events

## Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| Guessing from code without evidence | Collect tool evidence first |
| Changing code to "see what happens" | Form hypothesis, then verify |
| Fixing symptoms instead of root cause | Trace the full causal chain |
| Ignoring intermittent failures | Reproduce under controlled conditions |
| Assuming "works on my machine" | Check environment differences |

## See Also

- `learn` -- record debugging discoveries
- `audit` -- systematic comparison for parity issues
- `profiling` -- performance-specific investigation
- [`references/probe-playbook.md`](../../references/probe-playbook.md) -- match symptom against playbook entries (discriminating checks); no match ⇒ escalate per ledger convention
