---
name: next
description: Global work recommender (/next) — scan all work sources (projects/plans/backlog/proposals/maintenance), converge to a single recommendation. Auto-triggered after archive or manually via /next.
---

# Next — Work Recommender Engine

Scan all work sources, present categorized results, converge to a single recommendation.

## Project Config (auto-injected)
!`cat .claude/next-config.md 2>/dev/null || echo "_No config — using defaults: doc/projects/INDEX.md, doc/plans/INDEX.md, doc/BACKLOG.md, doc/proposals/_"`

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
| **Dev** | `doc/projects/INDEX.md` | Find in-progress projects' next Phase |
| | `doc/plans/INDEX.md` | Find plans in design stage |
| | `doc/BACKLOG.md` | Check if trigger conditions are met |
| | `doc/proposals/` | List pending proposals |
| **Maintenance** | `improvement-queue.json` | Pending items (from Phase 0) |
| | [B] `skills/*/SKILL.md` | Skills > 200 lines |
| | [B] MEMORY.md | > 170 lines |
| **Knowledge** | `session-digests/` | Phase 0 results |
| | [B] `knowledge/*.md` | `last-verified` > 30 days |
| **Tech Debt** | `doc/BACKLOG.md` tech-debt | List all (even unmet triggers) |
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

## See Also

- [Phase 0 Hygiene Details](references/phase0-hygiene.md)
- `autopilot:dev-flow` — task execution after selection
- `autopilot:learn` — called when Phase 0 finds high-value digests
