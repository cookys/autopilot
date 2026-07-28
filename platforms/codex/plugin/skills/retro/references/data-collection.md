# retro — Step 1 Data Collection commands

> On-demand reference for the `retro` skill, Step 1. Run all five commands in
> parallel, substituting `DAYS` with the parsed window size. Origin: `retro/SKILL.md`.

### 1a. Commits with stats
```bash
git log origin/develop --since="${DAYS} days ago" --format="COMMIT|%H|%ai|%s" --shortstat
```

### 1b. Per-commit file breakdown
```bash
git log origin/develop --since="${DAYS} days ago" --format="COMMIT:%H" --numstat
```

### 1c. Timestamps for session detection
```bash
git log origin/develop --since="${DAYS} days ago" --format="%at|%ai|%s" | sort -n
```

### 1d. File hotspots
```bash
git log origin/develop --since="${DAYS} days ago" --format="" --name-only | sort | uniq -c | sort -rn | head -30
```

### 1e. Project completion delta
```bash
# Current count
# Current count — adapt path to your project's index file
grep -c '✅\|completed\|Completed' **/INDEX.md 2>/dev/null || echo 0
# Count N days ago
git show "HEAD@{${DAYS} days ago}:docs/projects/INDEX.md" 2>/dev/null | grep -c '✅\|completed\|Completed' || echo 0  # adjust path
```

### 1f. Review-loop lens (the effort git history can't see)
```bash
node scripts/retro-review-loop.js --days "${DAYS}" --json
```
Deterministic (NO LLM), local-only, and read-only. Separate Claude Code and Codex adapters scan
`~/.claude/projects/<encoded-worktree>/*.jsonl` and
`~/.codex/sessions/YYYY/MM/DD/*.jsonl`, then feed the normalized event contract at
`schemas/normalized-transcript-event.schema.json`. The default Claude scan covers the canonical
repo and its currently registered worktrees. Codex discovery prunes date directories before
opening files.

Inclusion requires canonical repo/worktree attribution and the requested time window. The additive
`provenance` block reports each root, adapter, candidate/included/excluded/error counts, bounds, and
exclusion reasons. A present supported root with recent candidates but zero included sessions emits
`coverage.warnings`; never turn that state into a silent zero. A missing root is `not_present`.

`loop_metrics.deterministic` reports only structured tool/controller evidence. Heuristic user
correction and status-reversal patterns are isolated under `loop_metrics.heuristic`. Each metric is
`known` or `unknown`; absence of evidence is never rendered as numeric zero. Evidence references
contain only session ID, timestamp, event class, and line number.

Reads are bounded by candidate, per-file byte/line, aggregate-byte, and wall-clock limits. Default
output never contains message, prompt, reasoning, command, or tool-output bodies. For deterministic
synthetic tests, inject `--claude-root`, `--codex-root`, `--repo`, and `--now`; do not point tests at
real user transcripts. `--transcript-dir` remains the backward-compatible, explicitly trusted
Claude-only fixture override.

The compatibility `transcript.*`, `hetero_dispatch_total`, and `git_signals.*` fields remain
available. **Honesty**: `review_dispatch` includes ad-hoc harness/debug runs; git review/QC markers
are the cleaner cycle proxy, and fleet work on other machines remains unseen.
