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
Deterministic (NO LLM). Recovers the hetero-engine **dispatch / decorrelated-review /
debate** effort that mostly never becomes a commit (reviews, harness runs) or is SQUASHED
into one — invisible to Steps 1a–1e. Reads THIS machine's session transcripts
(`~/.claude/projects/<encoded-cwd>/*.jsonl`) counting **real Bash `tool_use` invocations**
by dispatch/review pattern (so CLAUDE.md / reference-doc content mentioning those script
names never inflates it), plus git commit-message loop markers (review-round / QC-verdict /
converged, counted per-commit). Fail-safe: a missing transcript dir yields zero counts,
never an error. **Honesty**: `review_dispatch` includes ad-hoc harness/debug runs (not only
decorrelated reviews) — the git `review_rounds` / `qc_verdicts` are the cleaner cycle count;
covers only local transcripts (fleet work elsewhere is unseen). If the JSON's
`transcript.sessions` is 0 (no local transcripts / different machine), SKIP the Review-Loop
Lens report section rather than reporting zeros.
