# Session Handoff — 2026-06-26 (onboarding-README visuals + domain-telemetry plan)

> Resuming after `/clear`: read this, run the Verification block, then pick a follow-up below.
> Memory to load: [[project_codex-exec-dispatch-gotchas]], [[project_agy-writes-install-dir]], [[project_trust-tiered-review-policy]], [[feedback_measure-representative-population]].

## Repo state (expected)

- Branch `develop`, **clean, synced with origin @ `91a4e41`** (pushed this session).
- Canonical version **2.25.12** (unchanged by this session's two commits — both docs-only, no bump). `node scripts/sync-version.js --check` → green.
- `node scripts/check-readme-parity.js` → green (6 badges + 12 sections). No in-progress projects.

## What shipped this session (continuation of the v2.25.12 onboarding arc)

| Commit | What |
|--------|------|
| `3ca628f` (v2.25.12, earlier) | README 651→135-line onboarding tour + detail relocated to 5 `docs/` files + `check-hook-inventory.js` rewire. |
| `fdaf24a` | **Illustrated README**: `docs/assets/` gains `icon.svg` (retro pixel-art starfighter, borderless/transparent, **from gpt-5.5**), `hero.svg` (animated banner), and `flow{,.light}.svg` + `flow.zh-TW{,.light}.svg` (the before/after "A Day with Autopilot" diagram, EN+zh, **from gemini-3.5-flash**, dark+light). Header = icon + banner side-by-side (`<table>`, 180px); "A Day" ASCII → `<picture>` auto-swapping dark/light via `prefers-color-scheme`. Docs-only. |
| `91a4e41` | **Plan**: [`docs/plans/2026-06-26-domain-aware-roster.md`](plans/2026-06-26-domain-aware-roster.md) — diff-domain **telemetry** for /l5; ALL engine routing deferred to BACKLOG. Converged through a 5-round gpt-5.5 xhigh review loop. Docs-only. |

## The big idea (so you don't re-derive)

**Model performance is DOMAIN-DEPENDENT** — measured on the user's own `llm-playground` canonical-50 SWE exam (per-task de-confounded): `gemini-3.5-flash` leads on **Rust** (78%/27 = 54% of the exam) but on **backend/CLI** (shell/py/go — autopilot's own work shape) **`opus-4.8` matches-or-leads** (80% vs 73%, n=15). The "it's all frontend" worry was **falsified** (8%). So: **don't crown one model; the cross-family qc_panel hedges domain.** Evidence is THIN (one exam, n=15, single-task swings) → the plan ships **telemetry only**, routing deferred until real per-domain data + plumbing exist.

The 5-round gpt-5.5 loop is the story: it stripped an over-built "active domain routing" plan down to "measure now, route later" (`2🔴→1🔴→2🔴→0🔴→0🔴`). Each round caught an architecture error my own green missed. **Keep using the decorrelated gpt-5.5 loop for non-trivial design.**

## Open follow-ups (pick one; none urgent)

1. **Implement the domain-telemetry plan** (`docs/plans/2026-06-26-domain-aware-roster.md`) — it's implementation-ready (R4/R5 spec-pinned: `probe-diff-domain.sh` exact `-z -M -C` parse, 2 appended JSON keys, `/l5` post-impl probe from the dispatch **outcome-JSON `base_sha..commit`** range, level-front-door.md ledger column, BACKLOG'd routing prereqs). Run it via `/l5` when ready. **Awaiting Board go.**
2. **zh hero tagline variant** — the zh-TW README's `hero.svg` banner still shows the **English** tagline. Optional polish: generate a zh-tagline hero (the wordmark is the same; only the tagline line differs).
3. **GitHub social-preview card** (the one genuine PNG/JPG need — `og:image`, ~1280×640, uploaded in repo Settings, not a repo file). Needs a rasterizer FIRST: `pip install cairosvg` (none of rsvg-convert/cairosvg/inkscape/imagemagick are on this box). Then rasterize `hero.svg`/`icon.svg`.
4. Earlier-arc BACKLOG (still open): shadow-calibration to flip qc_panel 3→1-2; L1 block-mode override re-enable behind real isolation; agy read-only sandbox.

## Verification (run on resume)

```bash
cd ~/projects/autopilot
git status -sb | head -1                          # clean, synced @ 91a4e41
node scripts/check-readme-parity.js               # 6 badges + 12 sections
ls docs/assets/                                    # icon hero flow{,.light} flow.zh-TW{,.light} (6 svg)
node scripts/doc-drift-gate.js "$(pwd)" 2>&1 | grep -E 'FAIL|PASS'   # links + fences PASS
```

To re-preview the rendered READMEs (server was killed at session end): a tiny python-markdown renderer that inlines the SVGs lived in the scratchpad — easiest is just open the repo on GitHub after pushing, or re-run a `python3 -m http.server` over a freshly-rendered HTML. SVG animations + `<picture>` dark/light render natively on GitHub.

## Gotchas carried forward (this session's, full detail in [[project_codex-exec-dispatch-gotchas]])

- **codex/agy both generate SVGs fine** — codex needs `--sandbox danger-full-access` (bundled bwrap is broken here) + `< /dev/null` (else hangs on stdin); agy writes in-place with the absolute-path anchor prompt. **codex churns 2-5 min in a post-write self-audit loop** — detect the file write (mtime), don't wait for "done", reap it.
- **No SVG→raster tool on this box** → can't self-verify rendered SVG; the user's browser is the verifier. codex emits SVG (text), never a JPEG/PNG raster.
- **Bake-off briefs: give the MESSAGE, not the layout** — telling both engines to "match the existing design" → near-identical output (the user caught this); content-only briefs produced genuinely divergent designs.
- The data source for the model analysis: dashboard `http://192.168.101.5:5173/#/swe/comp` (Vite SPA; data from `./COMP-INDEX.json`); repo `~/projects/llm-playground` (canonical-50 in `benchmarks/swe-personal/cookys/`, per-task verdicts under `survey-p4c-w1-*/<model>/`).

## Reply preference: 正體中文 (per [[feedback_reply-in-traditional-chinese]]).
