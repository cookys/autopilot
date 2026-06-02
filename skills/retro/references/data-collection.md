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
git show "HEAD@{${DAYS} days ago}:doc/projects/INDEX.md" 2>/dev/null | grep -c '✅\|completed\|Completed' || echo 0  # adjust path
```
