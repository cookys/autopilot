---
name: retro
description: >
  Engineering retrospective from git history — velocity, test ratio, focus score, commit patterns.
  Use when: "/retro", "retro on last N days", "how productive was this sprint", "analyze my commit
  history", "work patterns", "session analysis", "回顧", "分析工作模式", "這週做了什麼". Note:
  "session analysis" here means commit-window productivity (git history), not conversation-session
  distillation (→ distill). Not for: viewing specific commit diffs, comparison audits, debugging
  test coverage drops, or turning conversation history into skills (→ distill).
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

Run all six collection commands simultaneously using parallel Bash calls. Set `DAYS` to the parsed window size.

Run the six collection commands — **1a** commits+stats, **1b** per-commit file breakdown, **1c** timestamps for session detection, **1d** file hotspots, **1e** project-completion delta, **1f** review-loop lens (`scripts/retro-review-loop.js --days DAYS --json` — the hetero-dispatch/review/debate effort git history can't see) — from [references/data-collection.md](references/data-collection.md), substituting `DAYS`.

**1g** Escalation-ledger scan (quality-floor L4): for each project dir in `docs/projects/` and `docs/projects/_archive/` with a `tree/events.jsonl` touched in the retro window, run `node scripts/tree.js escalations <proj>` and aggregate `escalation_opened` events by `stage`/`why_not_mechanical`; report counts + recurring themes. Recurring (≥2 similar) entries are DEMOTION CANDIDATES — hand them to `skills/distill`'s demotion-drafting step.

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
- Group commits by top-level directory (`src/games/`, `src/network/`, `docs/`, etc.)
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

Format the report (~1500 words) using the exact section structure in [references/report-templates.md](references/report-templates.md): Tweetable Summary, Metrics Dashboard, Hourly Distribution, Session Analysis, Commit Type Breakdown, Hotspot Analysis, **Transcript Coverage** (from 1f — always render), **Review-Loop Lens** (from 1f; preserve known/unknown and deterministic/heuristic labels), **Escalations** (counts + recurring themes from 1g), Ship of the Week, Observations (3), Habits for Next Week (3).

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
  "top_hotspots": ["file1", "file2", ...],
  "review_loop_lens": {
    "sessions": N,
    "hetero_dispatch_total": N,
    "impl_dispatch": N,
    "review_dispatch": N,
    "codex_exec": N,
    "review_driven_commits": N,
    "qc_verdict_commits": N,
    "versions": N,
    "provenance": [],
    "warnings": [],
    "loop_metrics": {
      "deterministic": {},
      "heuristic": {}
    }
  }
}
```

Populate `review_loop_lens` from the additive 1f JSON (`transcript.*`, `git_signals.*`,
`provenance`, `warnings`, and `loop_metrics`). If `transcript.sessions == 0`, still persist the
coverage/provenance and git-signal fields so a future retro can distinguish missing evidence,
attribution gaps, and true observed zero.

## Step 6: Delta Report (if previous retro exists)

If a previous retro JSON was found in Step 3, append a delta section:

```
vs Last Retro ({previous_date})
═══════════════════════════════
Commits          {n} → {n}   ({+/-}%)
Net LOC          {n} → {n}
Test Ratio       {n}% → {n}%
Focus Score      {n}% → {n}%
Sessions         {n} → {n}
Hetero dispatch  {n} → {n}    (review_loop_lens.hetero_dispatch_total; omit if either retro lacks the block)
Review-driven    {n} → {n}    (review_loop_lens.review_driven_commits)
```

## Tone Guidelines

- Encouraging but candid — anchor every statement in data
- No generic praise ("great job!"). Instead: "42 commits in 7 days is your highest since the Feb retro."
- Flag risks without being preachy: "Test ratio 4% — not sustainable if auth refactor ships to prod."
- Keep total output around 1500 words
