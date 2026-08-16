---
name: next
description: >
  Recommend what to work on next by scanning all projects, plans, backlog, and proposals. Use when:
  "/next", "what should I work on", "what's the highest priority", "what to pick up now", "I have
  N hours — what fits?", "下一步做什麼", "最高優先是什麼", "現在該做什麼", or right after archiving
  a completed project. Not for: creating plans, starting implementation, or running quality checks.
---

# Next — Work Recommender Engine

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer backlog scanning over strategic prioritization debate).

Scan all work sources, present categorized results, converge to a single recommendation.

## Project Config (auto-injected)
!`cat .claude/next-config.md 2>/dev/null || true`

## Trigger

| Trigger | When | Notes |
|---------|------|-------|
| **Auto** | After `autopilot:project-lifecycle` completes | Replaces old Backlog Pickup |
| **Manual** | User types `/next` | Any time |
| **Deep** | `/next --deep` | Forces C-level scan |

## Scan Depth (Adaptive)

Read `.claude/next-state.json` to determine depth.

| Level | Condition | Scope | Time |
|-------|-----------|-------|------|
| **A** | Default | Structured data (INDEX/BACKLOG/plans/proposals) | Seconds |
| **B** | Last A > 12 hours ago | A + skill sizes, knowledge staleness, MEMORY.md size | 10-30s |
| **C** | `/next --deep` | B + git log cold zones, TODO/FIXME stats, deploy drift | 1-2 min |

Update `.claude/next-state.json` after each scan with ISO timestamps.

## Execution Flow

### Phase 0: Hygiene (Silent)

Process accumulated digests and improvement-queue without user interaction.
Details: [references/phase0-hygiene.md](references/phase0-hygiene.md)

### Phase 1: Scan All Sources

| Category | Source | Method |
|----------|--------|--------|
| **Dev** | `docs/projects/INDEX.md` | Find in-progress projects' next Phase |
| | `docs/plans/INDEX.md` | Find plans in design stage |
| | `docs/BACKLOG.md` | Check if trigger conditions are met |
| | `docs/proposals/` | List pending proposals |
| **Maintenance** | `improvement-queue.json` | Pending items (from Phase 0) |
| | [B] `skills/*/SKILL.md` | Skills > 200 lines |
| | [B] MEMORY.md | > 170 lines |
| | [B] `~/.autopilot/distill/scan-state.json` | mtime > 14 days OR file missing (scan never ran) → list "distill frequency scan overdue" under Maintenance |
| **Knowledge** | `session-digests/` | Phase 0 results |
| | [B] `knowledge/*.md` | `last-verified` > 30 days |
| **Tech Debt** | `docs/BACKLOG.md` tech-debt | List all (even unmet triggers) |
| | [C] `src/` | TODO/FIXME count |
| | [C] `git log --since="30 days ago"` | Untouched src/ subdirectories |

### Phase 2: Rank + Recommend

```
P1: In-progress project's next Phase (interrupted work is highest priority)
P2: Backlog S-size with met trigger conditions (quick wins)
P3: Active plans (designed, awaiting implementation)
P4: Maintenance — improvement-queue + stale knowledge (S-size)
P5: Backlog L-size with met trigger conditions
P6: Proposals (need evaluation first)
P7: Tech debt / unmet-trigger Backlog (list only)
```

### Phase 3: Output

```
-- Global Scan (<A/B/C> level) --

[Dev]
  - <item> — <source>, <size>

[Maintenance]
  - <item> — <type> (S)

[Knowledge]
  - <N> session digests processed (<M> recorded, <K> skipped)

[Tech Debt]
  - <item> — backlog, trigger: <condition>

---
Recommendation: <highest priority item>
  Reason: <why this one>
  Size: <S/L>
  Next: confirm then invoke autopilot:dev-flow
```

If all sources empty: suggest `/next --deep` or propose new features.

### Phase 4: After User Confirms

- User agrees → invoke `autopilot:dev-flow` with selected task
- User picks another → invoke `autopilot:dev-flow` with user's choice
- User skips all → end

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `autopilot:dev-flow` | Execution engine — `/next` selects task, dev-flow takes over |
| `autopilot:project-lifecycle` | Invokes `/next` after archiving |
| `digest-review (absorbed)` | Absorbed into Phase 0 |
| `improvement-queue (absorbed)` | Absorbed into Phase 0 ([references/phase0-hygiene.md](references/phase0-hygiene.md)) |
| `memory-health (absorbed)` | B-level partially calls its checks; see `autopilot:learn` skill, Knowledge Health Audit section |

## Autonomous auto-pick (CEO / l4-l6 idle transitions)

When a depth-0 brain picks the next item WITHOUT the user (CEO mode idle
transition), the pick is a proxy decision and goes through
[`scripts/next-pick.js`](../../scripts/next-pick.js): `parse` extracts
machine-readable candidate rows from `docs/BACKLOG.md`, `pick` ranks them
deterministically from a materialized record (user class-weights outrank every
system signal; L/H-effort, `board`-tagged, and `hard-problem` rows queue
ask-first and are NEVER auto-picked) and appends the pick + record to the
decision ledger for the round-end report. Interactive `/next` keeps this skill's
judgment flow — the script is the autonomous path's deterministic subset.

## See Also

- [Phase 0 Hygiene Details](references/phase0-hygiene.md)
- `autopilot:dev-flow` — task execution after selection
- `autopilot:learn` — called when Phase 0 finds high-value digests
