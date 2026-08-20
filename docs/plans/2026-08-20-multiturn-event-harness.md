# Ceremony-hypothesis, staged: archaeology first — option B, campaign 1 (R2)

Status: R2 (post-G1 restructure). Owner ruling 2026-08-18 (option B). Evidence base:
`docs/plans/evidence/2026-08-20-interactive-cc-drivability-spike/`,
`…/2026-08-18-skill-onoff-instrument-repair/`, `…/2026-08-18-headless-task-tool-probe/`.

## 0. Context / thesis

Single-turn could not distinguish "ceremony skipped by truncation" from "skill does not
drive it". G1 panel (sol STOP / minimax CONDITIONAL / grok STOP) refuted the R1 80-call 2×2:
the multi-turn manipulation cannot operationalize "room" for session-START L-setup, and a
materially cheaper path exists. R2 buys ONLY that path, staged.

## 1. Problem

**Q1 (descriptive existence)**: in real multi-turn dev-flow-engaged sessions, do the
L-setup ceremony artifacts get created at all? (No OFF arm exists this campaign, so no
comparative or session-end-wrap claim is asked or answerable.)

## 2. OKR / KRs

- KR1: Phase A yields a frozen-rule classification of every eligible production session —
  per-marker counts + one of {ceremony-observed / ceremony-absent / corpus-insufficient}.
- KR2: if gated in, Phase B yields per-marker fire counts on n=2 FULL@3 pilot sessions
  (descriptive screen ONLY — n=3-level counts cannot separate 1/3 from 2/3 inferentially;
  a confirmatory design would need n≈23/cell and is NOT bought here).
- KR3: total spend ≤ 6 live calls. Hard cap. No other arms, channels, or blocks.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- REVIEWERS: this packet is self-contained; citations are provenance, not reading assignments.
- Phase A runs ONLY after its corpus query + classification rules are hashed into
  `pre-registration.md` (no peeking before freeze; the query is executed once, verbatim).
- Phase B (if gated in) uses FS/git-residue markers ONLY — no hook channel this campaign.
- Env pin `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` explicit in any Phase B fixture settings.
- Frozen packs under `evals/skill-onoff/packs/` are historical — never re-synced.
- Adjudication rules in §5 freeze at review-freeze; no post-hoc edits. Budget cap: 6 calls.

## 2.6 Change-policy decisions

- **Compatibility impact**: internal-only (evals + evidence docs).
- **Dependency decision**: platform/stdlib.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `docs/plans/evidence/2026-08-20-multiturn-event-harness/pre-registration.md` | Phase A corpus query + rules (hashed before execution); Phase B texts + hashes |
| `evals/skill-onoff/archaeology-scan.js` (new, Phase A) | deterministic corpus scan: eligibility filter + marker predicates → JSONL report |
| `evals/skill-onoff/run-skill-onoff-eval.sh` | Phase B only: + `--turns-file` driver (`--session-id` then `--resume`) |
| `docs/plans/evidence/2026-08-20-multiturn-event-harness/` | phase reports + adjudication |

## 4. Phases

- **Phase A — production-transcript archaeology (0 live calls)**. Corpus: every local
  `~/.claude/projects/*/*.jsonl` assistant record with `version ≤ 2.1.232` AND
  `model = claude-opus-5` (task tools live, multi-turn interactive, dev-flow installed).
  Eligibility per session (frozen): ≥ 3 real user turns AND Skill tool_use
  `autopilot:dev-flow` (the TaskCreate disjunct is REMOVED — outcome-contaminated: it
  admitted sessions by the very marker under measurement). Markers (frozen, tool_use via
  BOTH Write and Bash paths): creation of `.claude/session-start-sha`; creation of a plan
  doc under `docs/plans/`; creation of `docs/projects/*/README.md`; ≥1 forcing-function
  TaskCreate. Per-record timestamps only (evidence-discipline §12). Corpus root pinned
  absolute: `/home/cookys/.claude/projects/`.
- **Scanner validity gate (before Phase A)**: `archaeology-scan.js` must pass planted
  red/green on NON-corpus fixtures (the 2026-08-20 spike transcripts — sonnet/2.1.237,
  outside the corpus by the version+model filter: scanner MUST find their known
  TaskCreate/Skill events and MUST return zero on a known-inert transcript) BEFORE its
  sha256, every predicate, the eligibility filter, AND the Phase B task+turn texts are
  hashed into pre-registration.md in ONE freeze — nothing Phase-B-shaped is chosen after
  any corpus contact.
- **Gate (frozen, total)**: label each marker `observed` (≥2 detected fires) / `absent`
  (0 detected across ≥5 eligible sessions) / `insufficient` (all else, incl. 0 fires with
  <5 sessions). All-observed OR all-absent → campaign CLOSES on Phase A. Any other
  combination → Phase A report to the Board; **Phase B runs only on explicit owner go**
  (never auto-starts). Discarded Phase B re-runs consume the same 6-call cap.
- **Phase B — FS-only FULL@3 pilot (≤ 6 live calls, 2 sessions × 3 turns)**. FULL arm only.
  Task + turn texts frozen verbatim in pre-registration.md before ANY live call, with a
  no-discretion selection rule (first two L-size d2 tasks of the predecessor's frozen pack).
  Turn-3 closer carries NO wrap cue; wrap-cued session-end is NOT licensed this campaign.
  A failed/liveness-broken session is discarded and re-run at most once; discards reported.
- **Phase C — adjudication + evidence doc (no code, no calls)**.

## 5. Frozen verdict rules & licensed sentences

- Phase A, per marker: `ceremony-observed` iff the marker fires in ≥ 2 eligible sessions;
  `ceremony-absent` iff 0 fires across ≥ 5 eligible sessions; else `corpus-insufficient`.
- Phase B is DESCRIPTIVE: report per-marker fire counts verbatim; no thresholds, no verdict
  words beyond the counts.
- **Licensed result sentences (frozen; the ONLY claims this campaign may emit)**:
  (a) "In N eligible opus-5 (≤2.1.232) multi-turn dev-flow-engaged sessions, the frozen
  predicates detected marker M K times."
  (b) "In 2 scripted FULL@3 sonnet sessions at the frozen cues, the frozen predicates
  detected marker M K times." Zero is a claim about DETECTION, not about behaviour.
  No sentence about truncation, about OFF behaviour, about dev-flow as a whole, or about
  any skill edit is licensed. Any next step is a new plan + new review (G1-B11 held).
- The separate single-call `CLAUDE_CODE_ENABLE_TODO_TOOLS` pin probe is a Fix OUTSIDE this
  plan (MH5); nothing here is a production guard.

## 6. Risks + inversion

Guaranteed failure: peeking at the corpus before the query freeze; editing rules after
data; letting Phase B pilot counts masquerade as inference; wrap-cued turns re-entering via
"natural" phrasing; hook-channel scope creep returning without its own review.

## 7. Out of scope

The 2×2 factorial, OFF arms, hook event channel + non-reactivity program, F2 block, CARD
arm, interactive tmux lane, any dev-flow SKILL.md edit, any confirmatory-n design.

## 8. Open questions (Board)

None. (G1's OQ1/OQ2 resolved: sonnet-only; k=3 fixed — now Phase-B-only constants.)

## Review log

- R0 2026-08-20; manifest + frozen rubric in evidence dir; logical_plan_id
  `multiturn-event-harness-2026-08-20`.
- Dispatch 1: POLICY STOP (5m default timeout; depth-0 error). Zero tool semantics;
  minimax verdict recovered out-of-band, folded → R1. State surgery per zero-consumption
  precedent (`g1-transport-incident.md`).
- G1 (retry, 20m): sol STOP / minimax CONDITIONAL / grok STOP; 20 findings. Depth-0
  dispositions: `g1-dispositions.json` (14 accepted_blocker, 6 accepted_nonblocking).
  Convergent ruling adopted: staged archaeology-first design; 80-call 2×2 NOT bought → R2.
  Envelope: `g1-envelope.json`.
- G2 (terminal, cap): sol STOP / minimax CONDITIONAL / grok STOP; 18 findings (13 blocker
  candidates), all depth-0 ACCEPT-AND-FOLD (`g2-adjudication.md`) → this frozen text. Key
  folds: eligibility decontaminated (TaskCreate disjunct removed), scanner planted-red/green
  validity gate + single pre-corpus freeze, total gate function, Phase B Board-gated (never
  auto-starts), zero = detection-claim semantics. FROZEN at R2'.
- Phase A executed (scanner validity 4/4 → single freeze → one verbatim scan): 766 files,
  3 eligible; m2/m3/m4 observed (2/3 each), m1 insufficient (1/3). Gate → Board.
  **Board ruling 2026-08-20: campaign CLOSED on Phase A; Phase B lapsed unexercised.**
  Spend: 0 live calls. `phase-a-adjudication.md` + `phase-a-report.json`.
