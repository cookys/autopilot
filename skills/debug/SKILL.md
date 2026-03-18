---
name: debug
description: Evidence-first debugging for correctness issues. Invoke when diagnosing bugs, crashes, logic errors, data corruption, or connectivity problems. For performance issues, use the profiling skill instead.
---

# Evidence-First Debugging

<!-- Project-specific config (tool tables, log locations, common commands) -->
!`cat .claude/debug-config.md 2>/dev/null || echo "No project-specific debug config found. Use generic evidence collection below."`

## Core Principle

```
1. Tool-collected evidence  -> profiler, logs, EXPLAIN, debugger, DevTools
2. Log analysis             -> correlate with tool findings
3. Source code analysis     -> informed by evidence from 1 + 2
```

**Never guess from code alone.** Always collect evidence first.

## Relationship with Profiling

| Skill | When to Use |
|-------|-------------|
| **debug** | Correctness: crashes, bugs, logic errors, data corruption, connectivity |
| **profiling** | Performance: slow queries, high memory, CPU spikes, latency |

If unsure, start with `debug`. If evidence points to a performance root cause, switch to `profiling`.

## Debug Cycle

1. Reproduce the issue reliably
2. Collect evidence with appropriate tools
3. Form hypothesis based on evidence
4. Verify hypothesis (don't assume)
5. Fix root cause (not symptoms)
6. Verify fix with same tool + same test
7. Record in knowledge base if non-trivial (invoke learn skill)

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
