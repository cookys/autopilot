# retro — Step 4 Output Report templates

> On-demand reference for the `retro` skill, Step 4. Format the report (~1500 words)
> using the exact section structure below. Origin: `retro/SKILL.md`.

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

### Review-Loop Lens (from 1f — omit entirely if `transcript.sessions == 0`)
The hetero-engine dispatch / decorrelated-review / debate effort that git history can't see
(reviews and harness runs aren't commits; multi-round `/l5` work is squashed into one). Show
the transcript invocation counts (`impl_dispatch`, `review_dispatch`, `codex_exec`, agy/grok/
explore, `hetero_dispatch_total`) and the git loop markers (`review_driven_commits`,
`qc_verdict_commits`, `converged`, `versions`). Frame it as "commits are the iceberg tip":
contrast the committed count (Metrics Dashboard) with the ~N hetero dispatch/review/debate
invocations behind them. **Carry the 1f honesty caveat**: `review_dispatch` includes ad-hoc
harness/debug runs (the git review-round / QC markers are the cleaner cycle count), and only
local-machine transcripts are counted. Do NOT invent a "review-per-impl ratio" as if precise —
the harness/debug noise makes it approximate; characterize, don't over-quantify.

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
