# Task Prompt Templates

> Inspired by [tanweai/pua](https://github.com/tanweai/pua) P9 Task Prompt system (MIT License)

When dispatching subagents for L-size work, use structured templates instead of
ad-hoc prompts. Structured prompts eliminate ambiguity, reduce subagent rework,
and enable verifiable completion.

## Six-Element Task Prompt

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

## When to Use Six-Element vs. Lightweight

| Situation | Template |
|-----------|----------|
| Parallel subagent dispatch (2+ agents) | Six-Element (full) — file domain isolation is critical |
| Single subagent, clear task | Lightweight (WHAT/WHERE/DONE/DON'T — skip WHY and HOW MUCH) |
| Research / exploration task | Free-form prompt — templates add overhead to open-ended investigation |
| Background haiku agent | Free-form prompt — haiku tasks are disposable and cheap to retry |
