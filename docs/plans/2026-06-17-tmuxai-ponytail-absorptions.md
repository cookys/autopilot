# Plan — Absorb tmuxai + ponytail learnings into autopilot

> Status: ✅ Shipped in v2.18.0 — merged as 5ae34d5 · Owner: cookys · Branch: feat/dispatch-signal-and-sync · Frame: survey-driven
> Source: `/survey` 2026-06-17 comparing TUI-scrape (OEN-Tech/tmuxai, Rust) vs headless-artifact (autopilot), plus a read of DietrichGebert/ponytail's cross-platform sync mechanics.

## 0. Context / thesis

Two repos were reviewed for borrowable ideas.

- **tmuxai** drives interactive AI CLIs in tmux and screen-scrapes their TUI into state. The survey concluded: **do not adopt the screen-scrape mechanism** — it couples to the most volatile thing a vendor owns (cosmetic TUI) and hides its own drift (invalid regex silently disabled at `profile.rs:198-200`; `classifier.rs:194` turns drift into "chatty agent" not "failure"). tmuxai *also* ships an optional `[exec]` one-shot headless path (`profile.rs` exec handling) — evidence that even a TUI-driver reaches for headless when it can; we keep our headless-artifact route and borrow *framings* it gets right, not its mechanism.
- **ponytail** ships one behavior across 13 agent platforms. Its *content* is irrelevant to us, but its **copy-sync rigor** beats ours: a normalized-string-equality compare for exact mirrors plus an invariant-substring canary for files that can't be compared (`scripts/check-rule-copies.js:30` strict equality after normalize; `:42-66` substring invariants asserted in *both* SKILL.md and AGENTS.md), and a per-adapter test that asserts the pointed-at file actually *carries* the rules, not just exists (`tests/gemini-extension.test.js`).

Thesis: our headless dispatch is correct but **blind mid-run** (a worker that pauses on a clarifying question hangs to timeout with no caller signal), and our cross-platform sync is **enforced by discipline where ponytail enforces by test**. Close both gaps with the *cheapest mechanism that works* — explicitly avoiding the over-engineering that ponytail's own ladder warns against.

### R1 review correction (what changed from R0)

A 4-lens dialectic review (Architect / QA Devil / Falsifier / Inverter) converged on a RESCOPE. The key falsifications, folded in below:

- **No machine-distinguishable "question" event is known to exist in `claude -p --output-format stream-json`** (it emits `assistant`/`tool_use`/`tool_result`/`result`). tmuxai only gets a `question` state by *scraping the rendered TUI prompt*. So a stream-json "question rail" may be undeliverable, and a question-mark heuristic on the assistant stream would be scrape-equivalent — contradicting our own out-of-scope. **→ P4 replaced with a cheap, CLI-agnostic timeout signal; the stream-json rail demoted to a spike-gated *maybe*, not a committed deliverable.**
- **The canary is self-defeating** for a drift that has never fired and is already caught at write-time by spike-before-assert. **→ P5 deleted; reopen only on a documented incident.**
- **The reviewer.md ↔ code-review.md relationship is reference-not-repeat**; a substring-presence check on the referencing file passes even when the canonical text drifts. **→ P2 split into two mechanisms (repeat vs reference), seed phrases pinned as a committed data file.**

## 1. Problem

1. `dispatch-hetero.sh` is a black box between launch and exit. Its success test is purely `HEAD_SHA != BASE_SHA && -z DIRTY` (`dispatch-hetero.sh:118-129`); `AGENT_EXIT` is captured but used only in log strings (lines 125/128), never in the pass/fail branch — so an agent that exits non-zero yet left a clean commit is scored success. And a worker that pauses on a clarifying question hangs until `--print-timeout` with no caller-visible signal. (Auto-approve / YOLO suppresses *tool-authorization* prompts only, not the model's own clarifying question.)
2. Our sync gates (`sync-agent-bodies.sh --check`, `sync-version.js --check`) catch byte-drift between *exact mirrors*, but cannot guard the two relationships CLAUDE.md "Don't" calls out — because those files are *intentionally not* byte-equal.
3. `preflight-portability.sh` checks that adapter targets *resolve/exist*, not that they *carry the load-bearing content*.

## 2. OKR / KRs

- **O**: dispatch stops being blind on a hung worker, the non-zero-exit blind spot is closed, and two cross-file invariants become test-enforced not discipline-enforced.
- **KR1**: a hetero worker that stops with no commit yields a distinct, caller-readable outcome — `no_op` (exit 0, nothing-needed) vs `QUESTION_SUSPECTED` (timeout/non-zero, likely paused) — and a non-zero exit is never scored `success`. No more silent success or undifferentiated timeout.
- **KR2**: deleting a pinned `repeat` phrase, **renaming/deleting a referenced anchor**, or pointing an adapter at a stubbed file produces a loud pre-commit / preflight failure naming the miss. *Scope note: the reference mode catches structural drift (anchor rename/deletion), not body-rewording of the canonical section — that residual stays a human-review concern, not a false KR2 claim.*
- **KR3**: zero new screen-scraping; zero new always-on LLM in the dispatch path; no new per-session token cost on a normal dispatch.

## 3. File-structure map

| File | Change | Phase |
|------|--------|-------|
| `references/blind-dispatch.md` | Add the "clarifying questions survive auto-approve" gotcha + how the caller reads the new signal. | P1 |
| `scripts/check-canonical-invariants.sh` (NEW) | Two modes with an **inline seed table** (ponytail's own pattern — `check-rule-copies.js` inlines its table; with 2-3 seeds a separate data file would be an orphan, R2-Inverter): (a) **repeat** — pinned phrase must co-exist verbatim in all listed files; (b) **reference** — referencing file must contain the exact cross-ref anchor AND that anchor/heading must still exist in the canonical file (catches rename/deletion, NOT body rewording — see KR2 scope note). | P2 |
| `.githooks/pre-commit` | Wire P2 script in (matching `sync-version.js --check` blocking posture). Add a 5-line grep that P1's doc cites the two issue refs (closes P1's falsifiability gap). | P1, P2 |
| `scripts/preflight-portability.sh` | For each adapter that points at a shared file, assert the *resolved* file contains a named invariant phrase (seeded from `canonical-invariants.tsv`), not merely that it resolves. | P3 |
| `references/multi-agent-portability.md` | Add a capability-`Tier` column (full-plugin vs instruction-tier); record the survey's verified flag corrections. | P3 |
| `scripts/dispatch-hetero.sh` | (a) include `AGENT_EXIT == 0` in the success condition; (b) split the no-commit case by exit status into `no_op` (exit 0 — agent legitimately decided nothing was needed) vs `QUESTION_SUSPECTED` (timeout or non-zero exit — likely paused/stalled). CLI-agnostic; no stream parsing. | P4 |
| `references/hetero-dispatch.md` | Document the four outcome states + the deferred stream-json spike. | P4 |
| `CLAUDE.md` | Add one inventory row for `check-canonical-invariants.sh` (wire-it-in rule). | P2 |

## 4. Phases

### Phase 1 — question-under-YOLO gotcha → `blind-dispatch.md`  · size: Fix
- **Step**: In `references/blind-dispatch.md`, add subsection "Clarifying questions survive auto-approve": YOLO / `--dangerously-skip-permissions` / `--approval-mode yolo` suppress *tool-authorization* prompts only; the model's own clarifying question still appears and (in a non-interactive `-p` worker) blocks until `--print-timeout`. Evidence: **established for codex** (#10187, #2138 — auto-approve ignored, 20-25 prompts). **For Claude Code under `-p --dangerously-skip-permissions` (autopilot's primary dispatch target) this is asserted-not-yet-observed** — state it as "expected, confirm with a real run" rather than claiming autopilot has hung on it. Cross-link `hetero-dispatch.md` and P4's `QUESTION_SUSPECTED` signal.
- **Acceptance**: section exists, distinguishes confirmed (codex) from expected (Claude), cites the two issues, cross-links. A pre-commit grep asserts the issue refs are present (no silent doc-rot).

### Phase 2 — canonical-invariant gate (repeat + reference modes)  · size: S
- **Step**: Write `scripts/check-canonical-invariants.sh` with an **inline seed table** (no separate data file — ponytail inlines its table; a 2-3 row TSV would be an orphan with no CLAUDE.md home, R2-Inverter). Every seed is a verbatim literal in-script so the negative test can delete a known string. Two row modes:
  - **`repeat`** — a pinned verbatim phrase must appear in *every* listed file. Seed: the unified severity vocabulary line (`🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`) across the skills/agents that restate it. Genuine ponytail-style fit (both files independently *state* the rule).
  - **`reference`** — for `agents/reviewer.md` → `skills/quality-pipeline/references/code-review.md` (a *reference*, not a repeat): assert reviewer.md contains the exact cross-ref anchor string (`code-review.md` … `Invocation §`) AND the `## Invocation` heading still exists in code-review.md. This catches the **structural** break (anchor renamed/deleted) in the correct direction — which a substring-presence check on the referencing file would not (Falsifier-confirmed). **Known limit (R2-Falsifier): it does NOT catch a body-reword of the `## Invocation` section while the heading stays** — that residual is a human-review concern, reflected in KR2's scope note, not a silent over-claim.
- **Step**: Document the **update ritual** in the script header: any rule-text edit updates the inline seed in the *same commit*, or the gate is noise and gets bypassed.
- **Step**: Wire into `.githooks/pre-commit` (blocking). Wire-it-in 3 touchpoints: pre-commit (#1), script-header doc (#2), CLAUDE.md inventory row (#3).
- **Acceptance**: deleting a `repeat` phrase from one listed file → exit 1 naming file+phrase; renaming `## Invocation` in code-review.md without touching reviewer.md → exit 1; aligned tree → exit 0; a legitimate severity reword that updates the inline seed in the same commit → exit 0 (false-positive ritual works).

### Phase 3 — portability hardening (wiring assertion)  · size: S
- **Step (the real value)**: In `scripts/preflight-portability.sh`, for each adapter pointing at a shared file, assert the *resolved* target contains a named invariant phrase (not merely that it resolves/exists). Seed **≥2** concrete `(adapter-target, phrase)` pairs so a single stubbed assertion can't be the whole check (R2-Inverter — one seed is too weak for a "hardening" phase) — e.g. each `.agents/skills/<skill>` symlink target's `SKILL.md` must contain that skill's `name:` frontmatter value. Model after ponytail `tests/gemini-extension.test.js` ("contextFileName resolves to a file carrying the rules").
- **Step (small doc edit, folded in — not phase weight)**: In `references/multi-agent-portability.md` add a `Tier` column (`full-plugin` vs `instruction-tier`) and log the survey's verified flag corrections: Gemini `--yolo`/`--approval-mode=yolo` **REAL** (in source `config.ts`, omitted from headless docs); `kiro-cli chat --classic` subcommand form **UNVERIFIED** — both under `[[feedback_spike-before-assert]]`.
- **Acceptance**: preflight fails if any of the ≥2 seeded adapter targets resolves to a stub/empty/wrong-content file; the matrix shows a `Tier` per row; the flag corrections are logged with provenance.

### Phase 4 — caller-readable signal on a stopped worker  · size: Fix (was L)
- **Step**: In `dispatch-hetero.sh`, add `AGENT_EXIT == 0` to the success condition (today success ignores exit code — `:118-129`). A non-zero exit with a clean commit is no longer scored success.
- **Step**: When the worker ends with **no new commit**, split the outcome by *how* it ended (R2-Falsifier — a legit no-op task hits the same "no commit" condition as a stall, so they must not collapse):
  - exit 0, no commit → **`no_op`** (agent legitimately judged nothing was needed; not a failure).
  - timeout, or non-zero exit, no commit → **`QUESTION_SUSPECTED`** (worker likely paused on a clarifying question or stalled).
  This is CLI-agnostic, agy-compatible, adds **zero** stream parsing — it reuses the git read + the already-captured `AGENT_EXIT`. The caller gets the *real pain's* signal (blind hang surfaced) at ~20 lines of shell.
- **Step**: Document the four outcomes (`success` / `failure` / `no_op` / `QUESTION_SUSPECTED`) in `references/hetero-dispatch.md`.
- **Deferred sub-item (spike-gated, NOT in this phase's scope)**: a stream-json "live question" rail. **Before any code**, a spike must capture real `claude -p`/`codex exec`/`gemini -p` `--output-format stream-json` runs and determine whether a *machine-distinguishable* "asking a question" event even exists. If it does not, the rail is invalid and stays unbuilt (a question-mark heuristic would be scrape-equivalent → violates §7). Recorded sample files are the spike deliverable; any future parser is tested against the recording, never a live CLI. Tracked in §8, not committed here.
- **Acceptance**: a worker that exits non-zero with a clean commit is no longer `success`; `{exit 0, no commit}` → `no_op` and `{timeout|non-zero, no commit}` → `QUESTION_SUSPECTED` (the two are distinct, tested by the synthetic stub's cases a/b/c/d); the agy path is byte-for-byte unchanged (no new flag passed to agy).

## 5. Test / validation

- P1: doc + a pre-commit grep for the issue refs (the only scriptable part of a doc change).
- P2/P3: each ships a **negative test** (delete a `repeat` phrase / rename a `reference` anchor / stub an adapter target → expect exit 1) and a **positive test** (aligned tree, and a ritual-following reword → exit 0). Wire into pre-commit / preflight.
- P4: tested with a synthetic worker stub — a fake CLI script with four cases: (a) exit 0 + commit → `success`; (b) non-zero exit + commit → `failure`; (c) exit 0 + no commit → `no_op`; (d) timeout/non-zero + no commit → `QUESTION_SUSPECTED`. No live LLM needed; no stream fixture needed (the deferred rail is the only thing that would, and it's out of this phase).

## 6. Risks + inversion

- **What guarantees failure**: writing a stream-json parser from memory of an event shape that may not exist → ships a fabricated shape (the exact past incident). *Mitigation*: the stream-json rail is **removed from committed scope** and hard-gated behind a capture spike whose *first* question is "does the event even exist."
- **Over-engineering (ponytail's own lesson, turned on us)**: the R1 Inverter's charge. *Mitigation accepted*: P5 deleted, P4 cut from L to Fix, stream rail deferred. Shipped scope is P1-P4 cheap-and-certain.
- **Substring canary false-positive blocks a legit reword**: *Mitigation*: the same-commit TSV-update ritual (P2), documented in the file header, with a positive test proving it.
- **New scripts becoming dead code**: *Mitigation*: each new script lands its three CLAUDE.md wire-it-in touchpoints (pre-commit/preflight + file-header doc + inventory row) in the same PR; acceptance won't pass otherwise.

## 7. Out of scope

- Any screen-scraping / TUI parsing / per-CLI glyph profiles (survey conclusion).
- A self-updating / LLM-learning parser (tmuxai `learner.rs` — non-deterministic, prompt-injectable; rejected).
- A stream-json live-question rail **as a committed deliverable** (demoted to a spike in §8 — build only if the spike confirms a real event exists).
- A per-session version canary (former P5 — deleted; reopen on a documented CLI-drift incident).
- Adopting ponytail's behavior content (the over-engineering ladder).
- A semantic-correctness judge inside dispatch (existing `qc-panel.sh`/`calibration.sh` already cover this lane; not reopened here).

## 8. Open questions / deferred (Board only)

- Q1 (spike): does `--output-format stream-json` emit a machine-distinguishable "model is asking a question" event for any of claude/codex/gemini? If yes, the P4 deferred rail becomes a real follow-up project; if no, it stays unbuilt. Capture real runs before deciding.
- Q2: ship P1-P4 as one small branch (recommended), or split P1-P2 (sync) from P3-P4 (dispatch)?

## Review log

- **R0** (author, 2026-06-17): initial 5-phase draft from `/survey`.
- **R1** (dialectic, 2026-06-17): Architect / QA Devil / Falsifier / Inverter, 4-way convergence on RESCOPE. Folded in: P5 deleted; P4 cut L→Fix + stream rail deferred behind an existence-spike; P2 split repeat/reference (Falsifier-falsified the reference case); wire-it-in touchpoints added; mis-absorptions corrected ("[exec] preferred road" softened, "byte-compare"→normalized string equality, P1 codex-vs-Claude evidence distinguished).
- **R2** (Falsifier + Inverter re-check, 2026-06-17): R1 fixes verified — 3/4 + 2/3 CLOSED, 2 PARTIAL resolved here. Final fixes: (1) `QUESTION_SUSPECTED` split from legit `no_op` by exit status (was a new false-positive); (2) script+TSV collapsed to one inline-table script (killed the orphan-data-file gap + over-engineering); (3) KR2 scope-limited to structural anchor drift, body-reword acknowledged as human-review residual; (4) P3 doc-edit demoted to a step, preflight seeds raised to ≥2. **Converged — no open critical/important findings. Ready to implement (P1-P4 one branch).**
