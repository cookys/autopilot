# Profiling — Project Config
# Place this file at: .claude/profiling-config.md

## Tools Available
# List your project's profiling tools:
# - CPU: gperftools / py-spy / node --prof
# - Memory: gperftools heap / tracemalloc
# - DB: MySQL slow query log / pg_stat_statements
# - System: strace / perf

## Baseline Commands
# How to check current server status before profiling:
# e.g., curl http://localhost:PORT/status

## Profile Commands
# How to run each profiler:
# e.g., CPUPROFILE=/tmp/app.prof ./bin/server
