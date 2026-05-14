---
name: profiling
description: "Evidence-first performance profiling — tool selection, methodology, interpretation. Use BEFORE guessing at performance issues. Tools first, logs second, code last."
---

# Evidence-First Profiling

## Project Config (auto-injected)
!`cat .claude/profiling-config.md 2>/dev/null || echo "_No config — using generic tool selection below._"`

## The Rule

**Mandatory order — do not skip steps:**

```
1. Collect evidence with tools (profiler, tracer, slow query log)
2. Analyze logs — correlate with tool results to locate the problem
3. Read source code — only after 1+2 provide evidence pointing to specific code
```

**Prohibited**: reading code to guess causes, modifying code based on "intuition", concluding without data.

## Tool Selection Guide

Pick the right tool for the symptom:

| Symptom | First Tool | Why |
|---------|------------|-----|
| CPU 100% or high load | **CPU profiler** (gperftools, py-spy, node --prof) | Shows which functions consume CPU time |
| Memory growing over time | **Heap profiler** (gperftools, tracemalloc, heapdump) | Tracks allocation sites and sizes |
| Slow requests / high latency | **Slow query log** or **APM** | Most latency comes from DB or external I/O |
| Crash (SIGSEGV, SIGABRT) | **Debugger** (GDB, lldb) | Get backtrace immediately |
| Unknown I/O bottleneck | **strace / dtrace** | Shows system call timing and blocking points |
| Need flame graph | **perf / async-profiler** | Hardware counters + call stacks |

### Decision Tree

```
performance problem?
├── Crash or hang → debugger backtrace
├── High CPU → CPU profiler
│   └── CPU mostly in DB calls → slow query log
├── High memory → heap profiler
├── Slow response time
│   ├── Suspect DB → slow query log + EXPLAIN
│   ├── Suspect I/O → strace -c (syscall statistics)
│   └── Suspect application logic → CPU profiler
└── Connection failures → ss -s + strace on accept/connect
```

## Methodology

### 1. Establish Baseline

Before changing anything, measure current state. Use project-specific commands from config, or:
```bash
# Generic: check process CPU/memory
top -b -n1 -p $(pgrep -f your-server)
# Connection count
ss -s
```

### 2. Collect Profile Data

Run the appropriate tool from the selection guide above. See project config for specific commands.

### 3. Interpret Results

**CPU profiler output:**
- Functions with > 10% CPU that are not I/O wait deserve investigation
- Main event loop at ~20% is normal (idle I/O wait)
- DB client functions dominating = DB is the bottleneck

**strace -c interpretation:**
- High `usecs/call` on `futex` = mutex/lock contention
- High `calls` on `recvfrom`/`sendto` = normal for network servers
- `write` to disk with high latency = I/O bottleneck

**Slow query interpretation:**
- `type=ALL` in EXPLAIN = full table scan → add index
- High QPS + moderate latency = consider caching or query rewrite
- Lock waits = transaction contention

### 4. Fix and Verify

After fixing, **re-profile with the same tool and workload** to confirm improvement. Show before/after comparison.

## See Also

- Project-specific profiling tools and commands: `.claude/profiling-config.md`
