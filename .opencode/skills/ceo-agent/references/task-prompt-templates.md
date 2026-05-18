# Task Prompt Templates

> Inspired by [tanweai/pua](https://github.com/tanweai/pua) P9 Task Prompt system (MIT License)

When dispatching subagents for L-size work, use structured templates instead of
ad-hoc prompts. Structured prompts eliminate ambiguity, reduce subagent rework,
and enable verifiable completion.

> **Disambiguation — two different "X-element" contracts**: This template is the
> **dispatch** template (Seven-Element: WHY / WHAT / WHERE / SKILLS / HOW MUCH /
> DONE / DON'T) used when CEO / team / dev-flow spawn subagents to execute work.
> The `autopilot:planner` agent has a SEPARATE six-element **decomposition**
> contract (Goal / Scope / Input / Output / Acceptance / Boundaries) used to
> break L-size work into subtasks. Both derive from PUA P9 with different roles
> — planner produces the breakdown; the dispatch template structures each unit
> of work going out to a subagent (if a planner ran, each decomposed subtask is
> wrapped using this template; if not, each ad-hoc dispatch unit uses it
> directly). Do not conflate them.

## Seven-Element Task Prompt

Use this template for every Agent tool dispatch in L-size parallel execution.

```markdown
## [Task Title]

### WHY — Why this task exists
[Business/technical context. What breaks or is blocked if this isn't done.]

### WHAT — Deliverables
[Precise list. Each item has a verification criterion — not "implement X" but
"implement X, verified by running Y and seeing Z".]
- [ ] Deliverable A → verify: `[specific command]` returns `[expected output]`
- [ ] Deliverable B → verify: `[specific command]` passes

### WHERE — File domain
[Explicit paths. This prevents subagents from stepping on each other's work.]
- Only modify: `[directory or file list]`
- Do NOT modify: `[paths reserved for other agents or out of scope]`

### SKILLS — Required skill invocations (BEFORE starting work)
[Skills the subagent MUST invoke via the Skill tool before touching code.
Naming a skill in WHY/WHAT/HOW MUCH is NOT enough. The subagent must
**call the Skill tool** to load each skill's full methodology into its session
context — paraphrasing the skill into bullets loses fidelity and depends on
the dispatcher having read the skill itself. This is the same discipline
dev-flow L-1.6 enforces on the main session, applied to subagent dispatch.]
- Invoke `/<plugin>:<skill>` via the Skill tool — example: `/autopilot:debug`
- Invoke `/<project>:<skill>` if project skills cover the affected code area
- If no skill applies, write `none — explain why` (forces explicit decision)

### HOW MUCH — Resource boundary
[Scope guard. Prevents over-engineering.]
- Estimated effort: [N conversation turns / small / medium]
- Model: [inherit / sonnet / opus]
- Complexity ceiling: [what NOT to architect]

### DONE — Definition of done
[Not "I think it's good" but "these commands all pass".]
- `[verification command 1]` exits 0
- `[verification command 2]` output contains `[expected string]`
- No compile/type/lint errors

### DON'T — Off-limits
[Explicit prohibitions. Prevents scope creep inside the subagent.]
- Do not [feature beyond current sprint]
- Do not introduce new dependencies unless strictly necessary
- Do not modify [files owned by other agents]
```

### Why SKILLS is a separate element (not just a WHY/WHAT line)

The template's WHY paraphrases context, WHAT paraphrases deliverables — those
paraphrases work because the dispatcher has already done the analysis. Skills
are different: they are **stable methodology bodies** the project has invested
in. Paraphrasing a skill into bullets loses (a) the full checklist, (b) the
red-line rules, (c) the rationalization table that keeps the subagent honest.
Skills are not contaminating context — they describe *how to approach the work*,
not *prior verdicts on this work* — so loading them inside the subagent is safe
and preserves fidelity. Concretely: a subagent told "follow autopilot:debug
methodology" in plain prose may approximate; a subagent told "invoke
`/autopilot:debug` via the Skill tool before touching code" loads the actual
methodology surface. This element exists to make the second mode the default.

## Concrete Example

```markdown
## Implement WebSocket Compression (zstd)

### WHY
Transfer bandwidth is 3x higher than necessary for H5 clients. Compression
reduces server egress cost and improves client load time on mobile networks.

### WHAT
- [ ] zstd compression on WS send path → verify: `tcpdump` shows compressed frames
- [ ] Decompression on WS receive path → verify: existing E2E test suite passes
- [ ] Compression ratio metric exposed → verify: `/metrics` endpoint shows `ws_compression_ratio`

### WHERE
- Only modify: `src/network/ws_handler.cpp`, `src/network/ws_handler.h`
- Do NOT modify: `src/network/tcp_handler.cpp` (legacy path, separate task)

### SKILLS
Invoke each of these via the Skill tool before touching code.
(Parentheticals below explain **why each skill is on the list**, NOT what it
contains — paraphrasing the skill's methodology defeats the SKILLS discipline.)
- `/twgs:network` (this teammate is touching `ws_handler.cpp` — the skill
  governs that module)
- `/autopilot:debug` (in case the implementation reveals a latent bug while
  swapping the send path — load methodology now so investigation is fast)

### HOW MUCH
- Estimated: 2-3 conversation turns
- Model: inherit
- Do not build a configurable compression framework — just zstd, hardcoded level 3

### DONE
- `../deploy/scripts/dev.sh build` exits 0
- `../deploy/scripts/dev.sh test` exits 0
- E2E: `npx tsx tools/demo-bot.ts -g all --games 1` completes without error

### DON'T
- Do not add compression to TCP path (legacy clients don't support it)
- Do not make compression level configurable (premature — hardcode zstd-3)
- Do not modify protobuf message definitions
```

## Subagent Reporting Formats

### Completion Report

When a subagent finishes its task, it should include this structured summary:

```
[COMPLETION]
from: <agent name or identifier>
task: <task title from the prompt>
modified_files:
  - path/to/file1.cpp
  - path/to/file2.h
verification:
  command: ../deploy/scripts/dev.sh build && ../deploy/scripts/dev.sh test
  result: PASS (exit 0, 47 tests passed)
issues_found:
  - [out of scope] tcp_handler.cpp has a similar uncompressed path
  - [none]
```

### Failure Escalation Report

When a subagent is stuck after multiple attempts:

```
[ESCALATION]
from: <agent name or identifier>
task: <task title>
failure_count: <number of consecutive failures>
attempts:
  1. [approach description] → [result/error]
  2. [approach description] → [result/error]
  3. [approach description] → [result/error]
excluded:
  - [possibility ruled out, with evidence]
request:
  - [specific information or decision needed from CEO]
```

CEO receives this and decides: retry with more context, reassign to different
agent type, change approach, or escalate to Board.

## When to Use Seven-Element vs. Lightweight

| Situation | Template |
|-----------|----------|
| Parallel subagent dispatch (2+ agents) | Seven-Element (full) — file domain isolation + skill-load fidelity are both critical |
| Single subagent, clear task | Lightweight (WHAT/WHERE/SKILLS/DONE/DON'T — skip WHY and HOW MUCH) |
| Research / exploration task | Free-form prompt — templates add overhead to open-ended investigation |
| Background haiku agent | Free-form prompt — haiku tasks are disposable and cheap to retry |
