---
name: context-reduce
description: "Analyze and reduce context window token usage — measure budget consumption, identify bloat, and apply compression/splitting strategies. Invoke when context is full, nearing limits, or user says /context-reduce."
---

# Context Reduce — Token Budget Analysis

Measure current context window consumption, detect optimization opportunities, and execute safe reductions.

## Phase 1: MEASURE

Run the measurement script:

```bash
# If your project has a measure script:
node .claude/scripts/measure-context.js
# Otherwise: estimate manually from file sizes in .claude/
```

**Token estimation**: The script measures file sizes in bytes. Approximate conversion: 1 token ~ 4 bytes for English/code, ~2-3 bytes for CJK text. Use 3.5 bytes/token as a blended estimate for this mixed-language codebase.

Budget baseline: 200K tokens = 100%.

Present results as a % bar report with three layers:
- **Fixed** (loaded every session): CLAUDE.md, MEMORY.md, auto-injected context
- **Loaded this session**: skills already invoked in current conversation
- **On-demand** (not yet loaded): remaining skills, knowledge files, doc/architecture

> Full bar format template: [references/context-reduce-detail.md](references/context-reduce-detail.md)

## Phase 2: ANALYZE

Run 4 strategy detectors against the measured data:

### Strategy A: Compress (mostly safe, auto-executable)

Target: CLAUDE.md, MEMORY.md, knowledge/*.md

| Detection | Condition | Example |
|-----------|-----------|---------|
| Consecutive blank lines | 3+ blank lines in a row | CLAUDE.md has 5 blank lines between sections |
| Duplicate skill descriptions | CLAUDE.md table "purpose" column identical to skill's YAML description | "Record knowledge..." appears in both |
| Duplicate last-verified | Same file has 2+ `<!-- last-verified -->` tags | Copy-paste artifact |
| INDEX.md overflow | Recent learning > 10 entries | learn-rotate.js not run |

### Strategy B: Split Large Skills (confirm required)

Target: skills/*/SKILL.md > 8KB (~2K tokens)

Split into core SKILL.md + references/DETAIL.md. Show savings estimate:
```
[CONFIRM] large-skill (22.9KB -> core ~6KB + detail ~17KB)
  Savings: ~4.3K tokens per invoke
  Risk: detail needs explicit Read when needed
```

### Strategy C: Remove Inlined Architecture (confirm required)

Target: skills that inline content already in doc/architecture/

Detect via: skill contains `doc/architecture/` reference AND duplicates that content inline. Replace inline with reference pointer.

### Strategy D: Cross-Layer Dedup (confirm, report only)

Target: knowledge/*.md vs doc/architecture/ vs skills/

Compare section headers across layers. Report overlaps but do not auto-merge.

## Phase 3: EXECUTE

1. **Safe operations**: execute automatically (blank line removal, INDEX rotation, dedup tags)
2. **Confirm operations**: list with numbered choices

User responds: number(s) to approve, `all` to approve all, `skip` to end.

Show before/after comparison:
```
Before:  {N}K  {P}%  {bar}
After:   {N}K  {P}%  {bar}
```

## Boundaries

- Never delete doc/plans/_archive/ (unique design content) or doc/projects/ (history)
- Never modify skill logic/flow — only compress expression
- Never auto-execute confirm operations

> Strategy detection rules, execution details, and output templates: [references/context-reduce-detail.md](references/context-reduce-detail.md)
