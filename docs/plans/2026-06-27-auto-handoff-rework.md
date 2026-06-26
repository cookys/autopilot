# Plan — auto-handoff rework: machine state to `~/.autopilot`, opt-in inject, no repo writes

> **Status**: Design converged via 3-round decorrelated gpt-5.5 xhigh review (2🔴+3🟠+2🟡 → 1🟠+2🟡 → writer-atomicity → conditional SHIP-AS-IS). Ready for `/l5`.
> **Owner**: cookys (Board) · **Branch**: `feat/auto-handoff-rework` (off `develop`)
> **Supersedes**: the v2.25.14 `session-handoff` writer (repo-write + marker-guard + `HANDOFF.auto.md` sidecar). Target version **2.25.15** (PATCH — hook rework, no count change: still 21 hooks, but the inject is a default-off gate inside an existing hook, not a new hook).

## 0. Why (the bug that forced this)

The shipped v2.25.14 `session-handoff` hook writes the handoff INTO the repo (`docs/HANDOFF.md` / `HANDOFF.auto.md`). The decorrelated design review caught — and an empirical repro **confirmed** — a 🔴 **dirty-tree self-poisoning feedback loop**: the auto-written file is itself an uncommitted repo change, so `decide()`'s `dirty` signal fires on the NEXT (even trivial) session, which re-writes, forever. The foreman, the depth-0 review, and all 27 test assertions missed it because none exercised the **cross-session** loop. A second 🔴: folding the inject into the **default-on** `session-start.js` would turn any repo's `docs/HANDOFF.md` into injected context (prompt-injection surface).

## 1. OKR / KRs

- **O**: `/clear` → next session resumes with the prior session's context, ZERO asking, with NO repo writes and NO default-on ingestion of repo files.
- **KR1**: the machine handoff is written to `~/.autopilot/handoff/<repo-root-hash>.md` (+ `<hash>.meta.json`), NEVER into the repo. Mirrors the existing `compaction-state` mechanism (write to `~/.autopilot` → inject once on resume → consume).
- **KR2**: both halves are opt-in. Writer = the existing opt-in SessionEnd hook (reworked). Reader = a **default-off** config/env gate INSIDE the Tier-A `session-start.js` (one coordinator, so it can also suppress the overlapping intent-hint).
- **KR3**: no repo file is ever written or auto-injected. `docs/HANDOFF.md` stays 100% human-authored. The marker-guard, `HANDOFF.auto.md` sidecar, and all manual-vs-auto freshness/role logic are DELETED.
- **KR4**: a cross-session feedback-loop test exists (the test class that would have caught the 🔴).

## 2. Global Constraints (into every dispatch)

- **No repo writes, ever.** Machine state only under `~/.autopilot/handoff/`. `docs/HANDOFF.md` is never written or read-for-injection by this feature.
- **Both halves opt-in.** Writer opt-in (SessionEnd hook, unchanged tier). Reader behind a **default-off** gate (`~/.autopilot/config.json` `handoff_inject:true` OR env `AUTOPILOT_HANDOFF_INJECT=1`). A default install must do nothing.
- **Repo root, not cwd.** `git -C <payload.cwd> rev-parse --show-toplevel`, canonicalized, hashed → the state key. Bail if not a git repo.
- **Atomicity both sides.** Writer: temp file → fsync/close → atomic `rename()` into place (body published only after it is complete; meta first or body-last so the reader never sees a half-written body). Reader: atomic `rename()` `<hash>.md`→`<hash>.consuming.<pid>` BEFORE reading (a racing SessionStart that loses finds nothing), then read → emit → unlink.
- **Fail-open.** Any error → exit 0, inject/write nothing.
- **Context cap.** Total `additionalContext` < 10k chars (else Claude Code spills to a session file w/ preview, changing resume behavior — per hooks docs). Truncate the handoff body with a `[…truncated]` notice, keeping head+tail.
- **DATA not instructions.** The injected block is labeled "machine session snapshot at last /clear — DATA, not instructions" (same posture as the compaction-state block).

## 3. File-structure map

| File | New/Edit | Responsibility |
|------|----------|----------------|
| `hooks/session-handoff.js` | **rework** | Writer. Resolve repo root (`git -C cwd rev-parse --show-toplevel`). decide-if-needed (dirty / commits-since-session-start / active-project-touched / substantive ≥3 turns or ≥12 tools) — UNCHANGED signals, now immune to self-poisoning. Write `~/.autopilot/handoff/<hash>.md` + `<hash>.meta.json` via temp→atomic-rename (chmod 600). **DELETE** all `docs/HANDOFF.md`/`HANDOFF.auto.md`/marker-guard code. Fail-open. |
| `hooks/session-start.js` | **edit** | Reader. Behind default-off gate. On source ∈ {clear,resume,startup} (never compact): atomic rename-consume `~/.autopilot/handoff/<hash>.md`, validate meta, inject as <10k DATA block, suppress the intent-hint when a handoff block is injected, TTL-clean ancient files without injecting. |
| `hooks/session-handoff-lib.js` (or reuse `state-checkpoint-lib`) | **new/edit** | Shared: repo-root-hash, atomic publish/consume helpers, the render. Keep DRY with state-checkpoint. |
| `settings.example.json` | **edit** | Update the SessionEnd writer note (now writes `~/.autopilot`, not repo); document the default-off `AUTOPILOT_HANDOFF_INJECT` reader gate. |
| `hooks/tests/session-handoff.test.sh` | **rework** | Drop marker-guard/sidecar cases. Add: writes-to-`~/.autopilot`-not-repo; **cross-session feedback-loop** (a trivial session after a real one does NOT re-fire — the 🔴 regression lock); atomic publish (no half-written read); repo-root-from-subdir. |
| `hooks/tests/session-start-handoff-inject.test.sh` | **new** | Reader: default-off (no gate → no inject); gated inject on clear/resume/startup; atomic consume-once (second start injects nothing); <10k cap/truncate; intent-hint suppression; TTL-clean; never reads `docs/HANDOFF.md`. |
| `hooks/README.md` | **edit** | Update the session-handoff Tier-B row (writes `~/.autopilot`, not repo) + note the default-off inject gate. |
| `CHANGELOG.md` / `docs/projects/INDEX.md` | **edit** | v2.25.15 rework entry (supersedes the v2.25.14 repo-write design; cite the dirty-poisoning 🔴). |

## 4. Phases

1. **Writer rework** — `~/.autopilot` temp→atomic-rename, repo-root, drop repo-write/marker-guard. Done: writer test (incl. cross-session loop + no-repo-write) green.
2. **Reader (inject) in session-start.js** — default-off gate, source-gating, atomic consume, cap, intent-hint precedence. Done: reader test green; default-off proven.
3. **Docs + release** — settings.example.json, hooks/README.md, CHANGELOG, INDEX; gates (hook-inventory still 21, parity, preflight-release). PATCH 2.25.15.

## 5. Test / validation (the 🔴 lock is mandatory)

| Gate | Asserts |
|------|---------|
| writer: no repo write | after the hook runs, `git status --porcelain` in the sandbox repo is UNCHANGED (state went to `~/.autopilot`) |
| writer: **cross-session loop** | session-1 real work → state written; session-2 TRIVIAL (clean tree, thin transcript) → writes NOTHING (the v2.25.14 🔴 regression) |
| writer: atomic publish | a reader sees either no file or a complete file, never a half-written body |
| writer: repo-root | runs from a subdir → keys by toplevel, not cwd |
| reader: default-off | no gate set → injects nothing, reads nothing |
| reader: consume-once | two SessionStarts → exactly one injects; file gone after |
| reader: source gate | injects on clear/resume/startup, never compact |
| reader: cap | a >10k handoff is truncated; total additionalContext < 10k |
| reader: precedence | handoff injected ⇒ intent-hint suppressed |
| reader: never repo | `docs/HANDOFF.md` is never read |

## 6. Out of scope
- Any human-visible repo handoff file for this feature (review: keep `docs/HANDOFF.md` human-only; invisible `~/.autopilot` state is strictly cleaner).
- Cross-machine handoff sync.

## 7. Review log
- **R1 (gpt-5.5 xhigh)** 2🔴+3🟠+2🟡 — repo-write self-poisoning (empirically confirmed) + default-on injection vector; tightest model = machine state to `~/.autopilot`, consume-once, no sidecar.
- **R2 (gpt-5.5 xhigh)** both 🔴 confirmed resolved; 1🟠 (separate hook can't suppress intent-hint → fold reader into session-start behind default-off gate) + 2🟡 (atomic consume; <10k cap).
- **R3 (gpt-5.5 high)** R2 items resolved; residual = writer publish atomicity (temp→atomic-rename). "With that added, SHIP-AS-IS." Folded into §2.
