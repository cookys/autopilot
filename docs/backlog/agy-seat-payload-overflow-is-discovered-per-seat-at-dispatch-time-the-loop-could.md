# agy seat payload overflow is discovered per seat at dispatch time — the loop could pre-compute it and fail before spending the other seats

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next generation where an agy seat returns no_verdict with `agy_argv_ceiling` in raw_log while the other seats completed.
- **Context**: `dispatch-review.sh` refuses an agy payload above `MAX_ARG_STRLEN` by design (named reason, no execve failure). The loop only learns this after dispatching every seat, so the whole generation's other seats are spent for nothing when the floor then aborts the generation (v2.36.5). Fix shape: in collect, after the prompt is assembled, compare its byte size against `lib/agy-argv-ceiling.sh` for every agy seat and exit before dispatch with the same named reason and the `--exclude` / prompt-file-runner remedies. Option c from the report (auto-reroute to a prompt-file runner) changes seat identity and is NOT the fix — a seat is a frozen (engine, effort, runner) triple.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06

