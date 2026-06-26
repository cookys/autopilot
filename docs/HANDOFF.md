# Session Handoff — 2026-06-26 (review-decorrelation arc)

> Resuming after `/clear`: read this, run the Verification block, then `/next` (or pick a follow-up below).
> Memory to load: [[project_trust-tiered-review-policy]], [[project_agy-writes-install-dir]].

## Repo state (expected)

- Branch `develop`, **clean, synced with origin @ `d412564`** (pushed this session).
- Canonical version **2.25.11** (`.claude-plugin/plugin.json`); `node scripts/sync-version.js --check` → green.
- No in-progress projects (all archived). `bash hooks/tests/run.sh` → 61 test files pass (suite is slow, ~2-3 min).

## What shipped this session (one long /next → … run)

| Version | What | Merge |
|---------|------|-------|
| **v2.25.9** | agy restored as hetero **implementer** (`dispatch-hetero.sh` absolute-worktree anchor) + cross-family **`qc_panel`** terminal gate + `union-on-verified-critical` + read-only **`scripts/dispatch-review.sh`** | `3b97bd0` |
| **v2.25.10** | `quality-pipeline` test-fail → routes to `test-strategy` (methodology-inventory edge) | direct |
| **v2.25.11** | **trust-tiered review policy**: `resolve-review-loop.sh` deterministic `review_risk` + `--enforce` hard gate + `family_id` fail-closed + risk contracts | `6a51f2e` |
| (merge) | integrated another machine's `review_diff_scope` policy (hand-resolved conflict; both kept) | `d412564` |

Design doc (gpt-5.5-converged, the *why*): [`docs/plans/2026-06-26-trust-tiered-review-policy.md`](plans/2026-06-26-trust-tiered-review-policy.md).

## The big idea (so you don't re-derive)

**Execution-grounded verification is the PRIMARY lever; the cross-family LLM panel is SECONDARY.** Cross-family 1→2 families is the win, >2 is waste. Review *depth* keys on **measured risk**, NOT source-trust (keying off `resolve-doa` was a category error caught by gpt-5.5). Honest-but-weak scope only — NOT malicious-proof. The decorrelated gpt-5.5 review loop caught real holes my own green missed at BOTH design and impl stages — keep using it for non-trivial work.

## Open follow-ups (none urgent; pick via `/next` or BACKLOG)

- **Future-gated (designed, deliberately unbuilt)**: shadow-calibration to flip the `qc_panel` default 3→1-2 (needs telemetry + promotion metrics); local-runner enforcement (no local runner exists); real mutation/differential oracle machinery (contract only). All in the design doc §3.3/§4/§6 + BACKLOG.
- **L1 test-integrity block-mode override re-enable** — still BACKLOG'd behind a real isolation boundary (no local-only mechanism is malicious-proof; same lesson as cgroup containment).
- **agy read-only sandbox** — BACKLOG: when Antigravity ships a read-only `-p` mode, tighten `dispatch-review.sh`'s agy path.
- `dispatch-review.sh` agy path isolation rests on scratch-cwd + agy-ignores-cwd, not a hard sandbox (residual, documented).

## Verification (run on resume)

```bash
cd ~/projects/autopilot
git status -sb | head -1                          # clean, synced @ d412564
node scripts/sync-version.js --check              # mirrors green, 2.25.11
bash scripts/resolve-review-loop.sh | python3 -c 'import sys,json;d=json.load(sys.stdin);print("risk",d["review_risk"],"xfam_req",d["cross_family_required"],"diff_scope",d["review_diff_scope"])'
bash scripts/resolve-review-loop.sh --enforce --security-surface 1 >/dev/null 2>&1; echo "enforce high-risk default-panel exit=$? (0=satisfied)"
bash hooks/tests/resolve-review-loop.test.sh 2>/dev/null | tail -1   # 53 assertions
```

## Gotchas carried forward

- **agy as implementer works** via the absolute-worktree anchor (relative-path prompt was the old bug). agy as read-only reviewer needs `script -qec` capture (plain pipe = 0 bytes). gemini-cli is dead → agy is the only Gemini access. ([[project_agy-writes-install-dir]])
- **Don't trust an implementer's own green** — depth-0 builds an INDEPENDENT acceptance harness; the decorrelated gpt-5.5 review is the qc of record.
- **`resolve-review-loop.sh` is a DATA emitter (exit-0)**; enforcement lives in the caller (`--enforce` opt-in gate or the depth-0 loop). Don't make resolvers exit non-zero by default.
- Push may need `git fetch` first — a second machine pushes to `develop` (it added `review_diff_scope`). Merge, hand-resolve the review-loop files (keep both sides), re-verify.

## Reply preference: 正體中文 (per [[feedback_reply-in-traditional-chinese]]).
