# Cross-family QC panel for /l5 (v2.25.9)

> **Status**: design → awaiting approval. Branch `feat/v2.25.9-cross-family-qc-panel`.

## Problem

`/l5`'s authoritative depth-0 qc gate is currently a single configured `reviewer_engine`
(default `gpt-5.5`). That default was calibrated for a **Claude** implementer. The moment
the implementer is `gpt-5.3-codex-spark` (also OpenAI), generator and reviewer become the
**same family** → correlated blind spots (familiarity / low-perplexity preference;
arXiv 2410.21819, MT-Bench 2306.05685). A whole class of bug `spark` makes, an OpenAI
reviewer systematically can't see.

## Insight (empirically grounded this session)

- **Replace ≠ improve.** Swapping out the thorough OpenAI reviewer to chase decorrelation
  loses a strong judge. The fix is a **panel of disjoint families** (PoLL, arXiv 2404.18796):
  keep `gpt-5.5`, ADD a different-family track whose job is to be *differently blind*.
- **agy works read-only.** The agy write bug (cwd-ignore, #231/#133/#253) is an IMPLEMENTER
  problem; a reviewer never writes the worktree. Verified end-to-end: agy Gemini 3.5 Flash
  passed a clean diff (`SHIP-AS-IS`) and caught a planted `[::1]` bug (`FIX-THEN-SHIP`).
  Since gemini-cli is discontinued, agy is the ONLY Gemini access — and read-only review is
  the viable way to put Gemini in the panel.
- **Aggregation must be union, not majority.** A blind-spot catch is by definition seen by
  only ONE track; majority vote would suppress the very finding decorrelation exists to
  surface. → `union-on-verified-critical`.

## Design

Two distinct review stages in `/l5` — only the terminal one becomes a panel:

| Stage | Engine | Change |
|-------|--------|--------|
| Inner reviewer loop (iterate impl to convergence) | `reviewer_engine` = gpt-5.5 | **unchanged** — keep its thoroughness |
| **Depth-0 qc terminal gate** (authoritative `≥3 adversarial reviewers`) | **`qc_panel`** = disjoint families | **NEW: configured panel** |

### Deliverables

1. **`review-loop-config.md` schema** — add:
   - `qc_panel:` comma-list of engines for the terminal gate (default `gpt-5.5, claude-opus, gemini-flash` — spanning OpenAI / Anthropic / Google).
   - `qc_panel_aggregation:` enum, default `union-on-verified-critical`.
   - Doc the decorrelation rule: panel members SHOULD span families ≠ the implementer's family.

2. **`resolve-review-loop.sh`** — parse + emit `qc_panel` (array) and `qc_panel_aggregation`
   in the JSON roster; enum-validate aggregation (garbage → safe default).

3. **NEW `scripts/dispatch-review.sh`** — READ-ONLY review dispatcher (sibling of, NOT a mode
   of, the write-oriented `dispatch-hetero.sh`):
   - `--runner codex|agy --model <m> --diff-file <f>` → JSON `{runner, model, verdict, findings[], raw, status}`.
   - **codex**: `codex exec -m <m> < prompt` (stdout works normally).
   - **agy**: diff-as-text-in-prompt + **`script -qec <runner> <out>` pseudo-TTY** capture +
     strip `\r` + parse `VERDICT:`/`FINDINGS:`. (Plain pipe returns 0 bytes — #76/#408.)
   - **fail-closed**: empty / unparseable capture → `status:no_verdict` (NEVER read empty as
     SHIP-AS-IS — that would silently pass everything).
   - Never touches the repo, no worktree (read-only contract).
   - Claude/Opus panelist needs no script — depth-0 dispatches the native `reviewer` agent.

4. **Reviewer contract** — record `union-on-verified-critical` in
   `skills/quality-pipeline/references/code-review.md` (+ `agents/reviewer.md` pointer):
   any panelist's **verified** Critical blocks; verification = the existing
   `independent_harness` (execution) for executable claims, depth-0 second-look otherwise;
   a panelist's empty/no-verdict is fail-closed, not a pass; **majority vote is forbidden**.

5. **Wiring** — `skills/ceo-agent/references/level-front-door.md` qc@depth-0 prose reads the
   `qc_panel` roster and fans out (same prose-orchestration model as Phase L; the script is
   the deterministic half).

6. **Tests** — `dispatch-review.sh` test (mock runner via `--bin` seam: empty→no_verdict,
   verdict parse, JSON shape, read-only assertion) + `resolve-review-loop.sh` test additions
   (qc_panel parse, aggregation enum default/garbage).

7. **Ride-along (already edited)** — agy BACKLOG entry + review-loop-config gotcha generalization.

8. **Release** — CHANGELOG v2.25.9 + INDEX row + version bump (new script = PATCH).

## Open decisions (confirm before build)

- **D1 — new script vs mode.** Recommend a **separate `dispatch-review.sh`** (read-only ≠
  write; conflating with `dispatch-hetero.sh` risks the worktree rails). *Alt: `dispatch-hetero.sh --review`.*
- **D2 — wire vs rails-only.** Recommend **rails + prose wiring** (script + config + contract +
  level-front-door prose), consistent with how qc@depth-0 already fans out. Not a hard-coded loop.
- **D3 — scope of "verified".** Recommend **reuse `independent_harness` + depth-0 second-look**;
  do NOT build a new verification engine. Keeps the ship tight.

## Out of scope

- Replacing the inner reviewer loop (stays gpt-5.5).
- A generic multi-vendor LLM gateway (agy is Gemini-only here by necessity).
- Auto-tuning panel membership.
