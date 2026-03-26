---
name: retro
description: >
  Engineering retrospective from git history — velocity, test ratio, focus score, commit patterns.
  Use when: "/retro", "retro on last N days", "how productive was this sprint", "analyze my commit
  history", "work patterns", "session analysis", "回顧", "分析工作模式". Not for: viewing specific
  commit diffs, comparison audits, or debugging test coverage drops.
---

# retro — Engineering Retrospective

## Arguments

| Invocation | Window |
|------------|--------|
| `/retro` | Last 7 days (default) |
| `/retro 14d` | Last 14 days |
| `/retro 30d` | Last 30 days |

Parse the argument: extract the number before `d`. Default to 7 if no argument.

## Step 1: Data Collection (run in parallel)

Run all five git commands simultaneously using parallel Bash calls. Set `DAYS` to the parsed window size.

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

## Step 2: Compute Metrics

From the collected data, calculate:

### Core Metrics
- **Total commits** — count of commits in window
- **Insertions / Deletions / Net LOC** — sum from shortstat
- **Commit days** — distinct dates with commits
- **Shipping streak** — longest run of consecutive days with commits

### Test Ratio
- **Test LOC** — insertions in files matching `test/` or `_test` or `Test.cpp`
- **Test ratio** — test LOC / total LOC (target: >15%)

### Commit Type Breakdown
Parse commit message prefixes (case-insensitive):
- `feat` / `add` → Feature
- `fix` → Bugfix
- `refactor` / `clean` → Refactor
- `test` → Test
- `doc` / `docs` → Documentation
- `chore` / `build` / `ci` → Chore
- `refine` / `improve` → Refinement
- Everything else → Other

### Focus Score
- Group commits by top-level directory (`src/games/`, `src/network/`, `doc/`, etc.)
- Focus score = % of commits in the single most-changed directory
- >60% = focused, 40-60% = balanced, <40% = scattered

### Session Detection
- Sort commits by Unix timestamp
- Gap >= 45 minutes = new session boundary
- Calculate: session count, average session length, longest session
- Active coding hours = sum of all session durations

### Hourly Distribution
- Bucket commits by hour-of-day (local time from `%ai`)
- Used for ASCII bar chart

### Projects Completed
- Delta of completed project count between now and N days ago (from Step 1e)

## Step 3: Load Previous Retro (if exists)

```bash
ls -t .context/retros/*.json 2>/dev/null | head -1
```

If a previous retro JSON exists, read it for delta comparison.

## Step 4: Output Report

Format the report as follows (~1500 words). Use the exact section structure:

---

### Tweetable Summary
One punchy line summarizing the window. Example:
> "7 days: 42 commits, +3.2k LOC, 3 projects shipped, 89% focus on auth refactor."

### Metrics Dashboard

```
Period: {start_date} → {end_date} ({DAYS} days)
═══════════════════════════════════════════════
Commits          {n}          {delta vs last}
Insertions       {n}
Deletions        {n}
Net LOC          {+/-n}
Commit Days      {n}/{DAYS}   ({pct}%)
Shipping Streak  {n} days
Test Ratio       {pct}%       (target: >15%)
Focus Score      {pct}%       [{focused/balanced/scattered}]
Sessions         {n}
Avg Session      {duration}
Projects Done    {n}          (total: {cumulative})
```

### Hourly Distribution
ASCII bar chart, 24 rows (0-23h), bars made of `█` blocks scaled to max.
```
00h │
01h │
...
14h │████████████ 12
15h │████████ 8
...
```

### Session Analysis
List each detected session with start time, duration, and commit count.
Highlight the longest and most productive sessions.

### Commit Type Breakdown
ASCII percentage bar:
```
feat     ██████████████░░░░░░  42%  (18)
fix      ████░░░░░░░░░░░░░░░░  12%  (5)
refactor ████████░░░░░░░░░░░░  23%  (10)
...
```

### Hotspot Analysis
Top 10 most-changed files with touch count. Flag files touched >5 times as potential refactor candidates.

### Ship of the Week
The single commit (or day) with the highest net LOC change. Show commit hash, message, and stats.

### Observations (3 items)
Data-driven, specific. Examples:
- "You commit most between 14:00-17:00 — your afternoon sessions average 2.1h vs 0.8h in mornings."
- "Test ratio dropped to 8% this week, down from 22% last retro. The auth refactor work had zero test commits."
- "Focus score 91% — almost all work was in src/core/. Good deep focus."

### Habits for Next Week (3 items)
Practical, each takes <5 min to adopt. Tied to the observations above. Examples:
- "Add one test file per feature commit — even a stub test keeps the ratio healthy."
- "Try a 10-min end-of-session review: does the last commit compile clean?"
- "Your longest gap was 3 days (Mar 12-15). A single 'chore' commit keeps momentum."

---

## Step 5: Persist Snapshot

```bash
mkdir -p .context/retros
```

Write a JSON file to `.context/retros/{YYYY-MM-DD}.json` containing:
```json
{
  "date": "YYYY-MM-DD",
  "window_days": N,
  "commits": N,
  "insertions": N,
  "deletions": N,
  "net_loc": N,
  "test_ratio": 0.xx,
  "focus_score": 0.xx,
  "focus_dir": "src/games/mj/",
  "sessions": N,
  "avg_session_min": N,
  "commit_days": N,
  "shipping_streak": N,
  "projects_completed": N,
  "commit_types": { "feat": N, "fix": N, ... },
  "top_hotspots": ["file1", "file2", ...]
}
```

## Step 6: Delta Report (if previous retro exists)

If a previous retro JSON was found in Step 3, append a delta section:

```
vs Last Retro ({previous_date})
═══════════════════════════════
Commits      {n} → {n}   ({+/-}%)
Net LOC      {n} → {n}
Test Ratio   {n}% → {n}%
Focus Score  {n}% → {n}%
Sessions     {n} → {n}
```

## Tone Guidelines

- Encouraging but candid — anchor every statement in data
- No generic praise ("great job!"). Instead: "42 commits in 7 days is your highest since the Feb retro."
- Flag risks without being preachy: "Test ratio 4% — not sustainable if auth refactor ships to prod."
- Keep total output around 1500 words
