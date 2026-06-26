# Heterogeneous decorrelation: agy-implementer fix + cross-family QC panel (v2.25.9)

> Branch `feat/v2.25.9-cross-family-qc-panel` · Plan: [`../../plans/2026-06-26-cross-family-qc-panel.md`](../../plans/2026-06-26-cross-family-qc-panel.md)
>
> **Scope expanded 2026-06-26 (Board-approved)**: originally a read-only qc panel built on
> the premise "agy can't write". That premise was overturned mid-session — agy implements
> in-place reliably once the prompt leads with the absolute worktree path. Project now covers
> BOTH the implementer fix and the review panel (the two are complementary: implementer-side
> decorrelation + review-side decorrelation).

## Project Goal

> **Final goal**: heterogeneous decorrelation across the `/l5` pipeline — (A) `agy`/Gemini
> usable as a real heterogeneous **implementer** again (`dispatch-hetero.sh` absolute-anchor
> fix), and (B) the authoritative depth-0 qc gate becomes a configured **disjoint-family
> panel** aggregated `union-on-verified-critical`, with the panel always spanning ≥1 family
> **different from the implementer's** (reviewer family ≠ generator family).
>
> **Success criteria**:
> 1. `dispatch-hetero.sh --runner agy` returns `committed` (not `no_op`) from a relative-path
>    prompt — the script injects the absolute worktree anchor. (Verified: 3/3 bare + real-script
>    `committed`. Test asserts the agy directive contains the worktree path.)
> 2. `resolve-review-loop.sh` emits `qc_panel` (array) + `qc_panel_aggregation`; garbage → safe
>    default; warns if the panel shares the implementer's family.
> 3. `dispatch-review.sh` exists, read-only (no repo write / no worktree), `--runner codex|agy`;
>    agy path captures via `script -qec`, parses `VERDICT:`; **empty → `no_verdict` fail-closed**
>    (never SHIP-AS-IS). (Asserted by test.)
> 4. `code-review.md` records `union-on-verified-critical` (majority forbidden; panelist
>    no-verdict = fail-closed); `level-front-door.md` qc@depth-0 reads the panel.
> 5. All new tests green; `bash scripts/validate.sh` clean; version 2.25.9; CHANGELOG + INDEX +
>    memory/doc corrections in place; preflight-release green.
>
> **Scope boundary**:
> - IN: dispatch-hetero agy anchor fix + validation + test; qc_panel config schema + resolver;
>   read-only `dispatch-review.sh`; union-on-verified-critical contract; level-front-door wiring;
>   tests; doc/memory correction (the now-false "agy can't write" narrative); release.
> - OUT: replacing the inner reviewer loop (stays gpt-5.5); generic multi-vendor LLM gateway;
>   auto-tuning panel membership; multi-file agy validation beyond a single confirming spike
>   (single-file is the certified case; multi-file noted as likely-fine-unverified).

## Phases

| Phase | Scope |
|-------|-------|
| P0 | **agy implementer fix**: `dispatch-hetero.sh` absolute-worktree anchor in the agy directive (done) + a multi-file confirming spike + test asserting the directive carries `$WT` + correct `references/hetero-dispatch.md` (the `no_op`/"unreliable" narrative) |
| P1 | **Config schema**: `review-loop-config.md` `qc_panel` + `qc_panel_aggregation` + implementer-family-aware note; `resolve-review-loop.sh` parse/emit + family-overlap warn; resolver test |
| P2 | **Read-only reviewer**: `scripts/dispatch-review.sh` (codex+agy, `script -qec`, fail-closed `no_verdict`) + test (`--bin` seam) |
| P3 | **Contract + wiring**: `code-review.md` union-on-verified-critical; `level-front-door.md` qc@depth-0 panel fan-out; `agents/reviewer.md` pointer |
| P4 | **Correct + release**: rewrite agy BACKLOG entry + review-loop-config gotcha (agy CAN implement now); CLAUDE.md inventory (new `dispatch-review.sh` row + `dispatch-hetero.sh` row update); CHANGELOG v2.25.9 + INDEX + version sync — folds into finish-flow |

## Progress

| Phase | Status | Commit |
|-------|--------|--------|
| P0 | in_progress (anchor edited; validation+test pending) | |
| P1 | pending | |
| P2 | pending | |
| P3 | pending | |
| P4 | pending | |

## Decisions

- D1 = separate `dispatch-review.sh` (read-only ≠ write; don't pollute worktree rails). [approved]
- D2 = rails + prose wiring (same model as Phase L qc fan-out). [approved]
- D3 = reuse `independent_harness` + depth-0 second-look for "verified"; no new verification engine. [approved]
- D4 = scope expanded to include the agy-implementer fix (Board-approved 2026-06-26). [approved]
- D5 = panel must be implementer-family-aware: reviewer family ≠ generator family (resolver warns on overlap). [new, from the two findings interacting]

## Background / evidence

- agy write bug was a relative-path-in-prompt issue, NOT "agy can't write": agy ignores process
  cwd, so a relative path → it invents a scratch project (Antigravity-CLI #231/#133/#253). Fix =
  lead the agy directive with the absolute worktree path. Verified 3/3 bare + real-script `committed`.
- agy read-only review verified (caught a planted `[::1]` bug) via `script -qec` capture (plain
  pipe = 0 bytes, #76/#408).
- Decorrelation grounding: PoLL (arXiv 2404.18796) disjoint-family panel; self-preference/
  familiarity bias (2306.05685, 2410.21819); execution oracle as ceiling (SWE-bench).
- gemini-cli discontinued → agy is the only Gemini access. Memory: `project_agy-writes-install-dir`.
