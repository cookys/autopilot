# Plan — Cross-Harness Transcript Retro
> Status: Heterogeneous review READY (generation 1) / Owner: CEO / Branch: to be created at execution / Frame: independent L-size follow-up

## 0. Context / thesis

Running `node scripts/retro-review-loop.js --days 7 --json` after the 2026-07-26 Codex session
reported zero transcript sessions because the script only searched the Claude project transcript
directory. The actual evidence existed under `~/.codex/sessions/...jsonl`.

Autopilot cannot improve loops it cannot observe. The retro pipeline needs harness-specific
discovery/parsing adapters feeding one normalized, privacy-bounded event stream.

## 1. Problem

Transcript paths and JSONL shapes differ across Claude Code and Codex. Existing hook normalizers know
some Codex event fields, but retro-review-loop independently discovers Claude transcripts and
therefore silently omits Codex sessions. There is no provenance report explaining which roots were
scanned, which adapters were used, or why a session was excluded.

The current metrics also cannot directly expose the process failures seen in the transcript:
user corrections, provider reroutes, transport failures, ticket resets, review generations,
worktree high-water mark, status reversals, and code-ready-to-merge-ready delay.

## 2. OKR / KRs

**Objective:** Make local retros accurately and safely cover supported harness transcripts.

- **R1 / KR1 — adapter contract:** Claude Code and Codex adapters discover candidate sessions and
  normalize timestamps, actor, text category, tool call/result, usage, cwd/repo, session ID, and
  harness without flattening raw formats into one parser.
- **R2 / KR2 — explicit provenance:** Retro output lists every scanned root, adapter, candidate count,
  included count, excluded count, parse-error count, and exclusion reasons.
- **R3 / KR3 — no silent zero:** If a supported harness root exists and contains recent candidates but
  none are included, human output warns and JSON reports the reason.
- **R4 / KR4 — repo attribution:** Sessions are included by canonical repo/worktree identity and time
  window, not by encoded Claude directory name alone.
- **R5 / KR5 — normalized loop metrics:** Report provider dispatch/reroute, transport failure,
  controller ticket/generation, worktree create/remove/high-water, merge-ready state transition, and
  explicit user correction signals when evidence exists.
- **R6 / KR6 — evidence honesty:** Heuristic metrics are labeled heuristic with event references;
  deterministic tool/controller events are labeled deterministic. Absence means unknown, not zero.
- **R7 / KR7 — privacy and bounds:** Reads remain local, default output contains aggregate/redacted
  evidence, file reads are size/time bounded, and no prompt/reasoning body is persisted in snapshots.
- **R8 / KR8 — compatibility:** Existing Claude metrics and human/JSON fields remain available; new
  provenance/metrics are additive.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Harness formats are parsed by separate adapters feeding one normalized event contract; no cross-harness shape guessing.
- A supported transcript root with recent candidates but zero included sessions must produce an explicit warning and exclusion reasons.
- Repo attribution uses canonical repository/worktree identity plus time bounds, not encoded directory names alone.
- Deterministic and heuristic metrics are labeled separately; absent evidence is unknown, never silently zero.
- Transcript processing is local-only, read-only, size/time bounded, and never persists prompt or hidden-reasoning bodies.
- Default reports redact raw user/assistant text; evidence references use session ID, timestamp, and event class only.
- Existing Claude retro output fields remain backward compatible; additions are additive.
- This plan does not change hook enforcement or live orchestration behavior.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `scripts/lib/transcript-adapters/index.js` (new) | Adapter registry, normalized event schema validation, and discovery orchestration. |
| `schemas/normalized-transcript-event.schema.json` (new) | Additive normalized event contract shared by all transcript adapters. |
| `scripts/lib/transcript-adapters/claude.js` (new) | Claude project/session discovery and JSONL normalization, extracted from current retro assumptions. |
| `scripts/lib/transcript-adapters/codex.js` (new) | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` discovery and Codex rollout/event normalization. |
| `scripts/lib/transcript-attribution.js` (new) | Canonical repo/worktree and time-window attribution with explicit exclusion reasons. |
| `scripts/lib/retro-loop-metrics.js` (new) | Deterministic event metrics and separately labeled heuristic correction/status metrics. |
| `scripts/retro-review-loop.js` | Consume adapters, emit provenance, compatibility fields, warnings, and normalized metrics. |
| `skills/retro/references/data-collection.md` | Document supported harness roots, evidence classes, and privacy limits. |
| `skills/retro/references/report-templates.md` | Add cross-harness provenance and unknown-vs-zero rendering. |
| `hooks/tests/retro-review-loop.test.sh` | Compatibility, Codex date-tree/window pruning, multi-harness discovery, attribution, warnings, bounded reads, and redaction. |
| `hooks/tests/fixtures/transcripts/claude/**` (new) | Minimal/malformed/out-of-repo/time-bound Claude fixtures. |
| `hooks/tests/fixtures/transcripts/codex/**` (new) | Minimal/malformed/tool/result/usage/worktree/controller Codex fixtures. |
| `platforms/codex/plugin/**` | Generated mirror only. |

## 4. Phases

### Phase 1 — Normalized event and adapter contracts (L)

**Depends on:** none.

1. Define `schemas/normalized-transcript-event.schema.json` with harness, session ID, timestamp,
   event class, tool name/status, cwd/repo hint, usage summary, and redacted evidence reference.
2. Extract Claude discovery/parsing from `retro-review-loop.js` without changing fixture-pinned output.
3. Implement Codex date-tree discovery with injected home/root/clock for tests.
4. Parse malformed lines independently, increment errors, and continue within fixed line/byte limits.
5. Never include raw reasoning or full message text in normalized output.

**Acceptance:** the same synthetic edit/review session in Claude and Codex shapes normalizes to the
same event classes while retaining different `harness` provenance.

### Phase 2 — Canonical attribution and provenance (L)

**Depends on:** Phase 1.

1. Canonicalize requested repo root and known worktree git-common-dir identity.
2. Attribute sessions using explicit cwd/repo events; fall back only to documented path evidence and
   label the confidence.
3. Emit scanned roots, adapter, candidate/included/excluded/error counts, and reason tallies.
4. Warn when recent candidates exist but inclusion is zero for a supported adapter.
5. Render missing roots as `not_present`, not an error.

**Acceptance:** a fixture containing one Claude session, one Codex worktree session, one unrelated
repo, and one malformed session includes exactly two and explains both exclusions/errors.

### Phase 3 — Loop/control metrics (L)

**Depends on:** Phase 2.

1. Deterministically count provider dispatch results, transport failures, controller ticket IDs and
   generations, worktree create/remove events, and merge/status commands where structured evidence
   exists.
2. Compute worktree high-water mark only from paired owned lifecycle events; otherwise return
   `unknown` with missing-evidence reason.
3. Compute code-ready-to-merge-ready duration only when both state transitions are evidenced.
4. Add heuristic user-correction and status-reversal signals using a small, documented pattern set;
   label counts heuristic and retain only redacted event references.
5. Preserve current review-round/QC metrics for Claude input.

**Acceptance:** the TWGame-shaped fixture reports one provider reroute, one transport failure, one
ticket continuation, two generations, a worktree high-water mark, and labeled heuristic corrections
without storing message bodies.

### Phase 4 — Reports, compatibility, and package sync (L)

**Depends on:** Phase 3.

1. Add provenance and metrics to JSON output additively.
2. Human output leads with coverage: harnesses scanned, included sessions, gaps/warnings.
3. Use `unknown` rather than numeric zero when evidence is insufficient.
4. Update retro references and add ship-time CHANGELOG.
5. Sync and check the Codex plugin mirror.

**Acceptance:** existing Claude-only fixtures remain compatible, the real local Codex session is
counted for the Autopilot repo/worktree when inside the requested time window, and mirror check
passes.

## 5. Test / validation

```bash
bash hooks/tests/retro-review-loop.test.sh
node scripts/retro-review-loop.js --days 7 --json
bash scripts/sync-codex-plugin-skills.sh --check
```

Required red cases: supported root with candidates but zero inclusion emits warning; malformed lines
do not discard a session; unrelated repo is excluded with reason; raw prompt sentinel is absent from
JSON/human output; Codex date-tree discovery excludes sessions outside the injected window; missing
deterministic evidence renders `unknown`, not `0`.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Build one parser that guesses both transcript shapes | Separate adapters and normalized contract tests. |
| Scan all local history without bounds | Date-root pruning, injected window, per-file byte/line caps. |
| Leak conversation content into reports | Aggregate-only output, redacted evidence references, sentinel tests. |
| Misattribute a worktree session | Canonical git-common identity and explicit confidence/reason. |
| Present heuristic blame as fact | Separate deterministic/heuristic sections and labels. |
| Break existing retro consumers | Additive fields and Claude compatibility fixtures. |

## 7. Out of scope

- Uploading transcripts or analytics to a remote service.
- Persisting raw prompts, assistant reasoning, or tool payloads in retro snapshots.
- Supporting every third-party harness in the first slice; adapters beyond Claude/Codex are future.
- Changing live hooks, context-budget gates, or orchestration behavior.
- Automatically editing plans/backlog based on metrics.

## 8. Open questions

None. The first supported set is Claude Code plus Codex; future harnesses use the same adapter seam.

## Review log

- R0 (2026-07-26): Authored from direct evidence that `retro-review-loop.js` reported zero sessions
  while a current Codex JSONL existed. Rubric frozen in
  `2026-07-26-cross-harness-transcript-retro.rubric.md`.
- R0.5 Kimi K3: READY with two nonblocking traceability findings; both repaired by naming the
  normalized-event schema file and the Codex date-tree/window test.
- R1 MiniMax-M3 + GLM-5.2: both READY, zero findings. Durable ticket
  `transcript-followup-cross-harness-transcript-retro`, terminal generation 1.
