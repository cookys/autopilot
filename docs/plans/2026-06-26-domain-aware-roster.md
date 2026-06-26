# Plan — Diff-domain **telemetry** for /l5 (all routing deferred)

> **Status**: Draft (R4 — converged after gpt-5.5 xhigh rounds 1→4; R4 raised 0🔴, spec-precision only) · for review before code
> **Owner**: cookys (Board) · **Branch**: `feat/domain-aware-telemetry` (off `develop`)
> **Frame**: additive, zero-risk, PATCH-sized. **Ships ONLY the measurement layer: a deterministic post-impl diff-domain probe + a `work_domain` field recorded in the /l5 ledger. It routes NO engine.** All domain routing (reviewer + implementer) is deferred to a follow-up behind explicit prerequisites — the evidence is thin and routing to the motivating engine isn't plumbed.

---

## 0. Context / thesis

Dogfood (2026-06-26, `llm-playground` canonical-50, per-task de-confounded): best model is **domain-dependent** — `gemini-3.5-flash` leads on Rust (78%/27 = 54% of the exam) but on **backend/CLI** (autopilot's shape) **`opus-4.8` matches-or-leads** (80% vs 73%, n=15). Frontend confound falsified (8%).

The review loop converged all findings on one conclusion — **measure now, route later**: thin evidence (R1); a diff-probe can't choose the *implementer* pre-impl (R2); routing to the motivating engine (`gemini` reviewer) isn't plumbed — `/l5` hardcodes `codex exec`, `reviewer_runner` unwired — and `cross_family_*`/`--enforce` are panel-vs-implementer, not inner-reviewer, semantics (R3). So the buildable, defensible core is the **measurement substrate**. Routing follows once there's real per-domain data AND the plumbing. `qc_panel` (terminal backstop) untouched. Standard shadow→calibrate→gate.

## 1. Problem

`/l5` has no record of what *kind* of work a run did, so per-project per-domain model performance can't be measured — the prerequisite for any future routing. We want a deterministic record of each impl's dominant domain, **zero** change to any pre-existing field or engine choice.

## 2. OKR / KRs

- **O**: every `/l5` run records a deterministic `work_domain` for its implementation diff; no engine choice or pre-existing field changes.
- **KR1**: `scripts/probe-diff-domain.sh` emits a robust dominant `work_domain` (numstat-weighted; explicit inline exclude list; rename/binary/deletion/degenerate cases pinned; deterministic; LLM-free).
- **KR2**: `resolve-review-loop.sh` inserts exactly **two** keys immediately before the closing `}` of the existing JSON: `work_domain` and `domain_source`. **`domain_source` enum (pinned — R5-🟡):** `explicit` (a valid `--domain` was given), `auto` (a successful `--auto-domain` probe), `none` (no domain flag / non-git / empty diff / probe failure). Test = **(a)** the pre-existing output string is an exact prefix with only `, "work_domain": "…", "domain_source": "…"` inserted before `}` (order/spacing preserved), and **(b)** semantic JSON equality of all old keys (R4-🟡: not "byte-identical via parse-delete").
- **KR3**: `/l5` runs the probe **post-impl** over `<base_sha>..<commit>` where **`base_sha` is an immutable SHA** — `/l5` dispatches with `--base "$(git rev-parse <chosen-base>)"` (NOT a ref like `develop`, which can advance after dispatch — R5-🟠) and `dispatch-hetero.sh` records `base_sha` + `commit` in its outcome JSON; the probe uses those. NOT ambient `HEAD` (the hetero worktree is removed on success — R4-🟠). Records `work_domain` in the run-summary ledger (canonical: `skills/ceo-agent/references/level-front-door.md` + `skills/l5/SKILL.md`). No routing.
- **KR4 (deferred)**: domain routing (reviewer + implementer) is OUT, prerequisites in `docs/BACKLOG.md`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- **No routing.** No engine selected/overridden by domain. `work_domain` is recorded, never acted on.
- **Pre-existing output frozen.** Only the two keys inserted before `}`; existing prefix string unchanged (KR2 test).
- **Probe deterministic + LLM-free.** Same `work_domain` for the same diff on any machine; explicit semantics in §3.
- **Probe owns its exclude list.** An explicit inline list (inspired by — NOT a runtime union of — `completeness-scan.sh`/`measure-task-width.sh`; and it does NOT exclude `CHANGELOG*`, which is a `docs` signal here — R4-🟠).
- **Panel untouched.** No domain conditioning near `qc_panel`/`cross_family_*`/`--enforce`.
- **Probe never breaks the resolver.** Non-git / empty / probe-failure ⇒ `work_domain=mixed`, `domain_source=none`, resolver exit code unchanged.

## 3. File-structure map

| File | New/Edit | Responsibility |
|------|----------|----------------|
| `scripts/probe-diff-domain.sh` | **new** | **Exact spec.** Range: `changed` (default; same base logic as `diff-file-list.sh`: `develop`\|`main`\|`HEAD~1` → `BASE...HEAD` **three-dot**, matching that script — R4-🟠) / `staged` / `range A..B`. Command: `git diff --numstat -z -M -C <range>`. **`-z` NUL parse (R4-🟠):** each record is `added\tdeleted\t<NUL>` then for renames/copies `old<NUL>new<NUL>`, else `path<NUL>`; split on the **first two TABs** for the counts, read paths as NUL fields; classify renames/copies by the **new** path. Binary rows = `-\t-` → file counted, weight 0. Deletions **included** (real signal; no `--diff-filter`). **No mode-based symlink/submodule special-casing** (numstat can't see modes — R4-🟠); such rows classify by path-extension like any other (no extension ⇒ `unclassified`). **Exclude list** (EXACT inline globs, root+nested forms — R5-🟠): `*.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `*.min.js`, `*.min.css`, `dist/*`, `*/dist/*`, `build/*`, `*/build/*`, `vendor/*`, `*/vendor/*`, `node_modules/*`, `*/node_modules/*`, `*.generated.*`, `*.pb.go`, `*_pb2.py`. **`CHANGELOG*` is explicitly NOT excluded** (it is a `docs` signal here). **Classifier (enumerated, deterministic):** `.rs`→rust; `.sh/.bash/.py/.go/.c/.h/.cpp`→backend-cli; `.js/.ts/.jsx/.tsx/.vue/.css/.scss/.html`→frontend; `.md/.mdx/.txt/.rst`→docs; else→`unclassified`. Weight = (added+deleted) of classified-product files; `work_domain` = the bucket with `share > 0.5` of classified-product weight; **exact 0.5 / any tie ⇒ `mixed`** (R4-🟠); `weight_classified==0 ⇒ mixed, dominant_share=0`; `confidence=low` when `weight_excluded+weight_unclassified > weight_classified`. `--domain <d>` (explicit) is **enum-validated** against `{rust,backend-cli,frontend,docs,mixed}`; invalid ⇒ usage error. Combined/merge diffs out of scope (documented). JSON `{work_domain, language_mix, dominant_share, weight_classified, weight_excluded, weight_unclassified, confidence}`; exit 0; `--help`. |
| `scripts/resolve-review-loop.sh` | **edit** | `--domain <d>` (enum-validated) / `--auto-domain [range]` (calls probe). Insert `work_domain`+`domain_source` before the printf's closing `}` (no other field touched). `--field work_domain`/`domain_source`. Non-git/empty/probe-fail ⇒ `mixed`/`none`, exit unchanged. |
| `project-config-template/review-loop-config.md` | **edit** | **(R4-🟡)** Field-reference rows for `work_domain`/`domain_source` documented as **emitted telemetry** (not config routing knobs). |
| `skills/ceo-agent/references/level-front-door.md` | **edit** | `work_domain` column in the canonical run-summary ledger contract. |
| `skills/l5/SKILL.md` | **edit** | Post-impl: `resolve-review-loop.sh --auto-domain <base..commit-from-outcome-JSON>`; record `work_domain` in the ledger (telemetry only). |
| `CLAUDE.md` | **edit** | Inventory row for `probe-diff-domain.sh`; note the resolver's two telemetry keys. |
| `docs/BACKLOG.md` | **edit** | Deferred **domain routing** + prerequisites: (1) `/l5` honors `reviewer_runner` via `dispatch-review.sh`; (2) two-pass resolve; (3) pre-impl planned-scope signal for implementer routing; (4) per-project per-domain n≥30 calibration; (5) inner-reviewer-family field vs panel-only `cross_family_*`. |
| `hooks/tests/resolve-review-loop.test.sh` + probe `*.test.sh` | **edit/new** | §5. |

## 4. Phases

### Phase 1 — `probe-diff-domain.sh` (Fix)
Implement §3 exactly: `-z -M -C` NUL parse, enumerated classifier, inline excludes, tie/degenerate/binary/deletion cases.
- **Done when**: §5 probe cases pass.

### Phase 2 — resolver telemetry keys + config field-ref (Fix)
Insert the two keys before `}`; document them in the config field-reference.
- **Done when**: KR2 prefix+semantic test passes; `--field` works.

### Phase 3 — /l5 + ledger wiring (Fix)
Post-impl probe over the outcome-JSON range; `work_domain` column in both ledger docs.
- **Done when**: ledger shows the column; `/l5` records it from the outcome range (test with caller `HEAD` unchanged).

### Phase 4 — BACKLOG + inventory + tests + release (Fix)
Deferred-routing BACKLOG (5 prereqs); CLAUDE.md inventory; §5 tests. PATCH bump: `node scripts/sync-version.js --version <next> --hook-count 20 --skill-count 23 --opt-in-count 12 --disabled-count 0`; CHANGELOG; `docs/projects/INDEX.md` row; `bash scripts/preflight-release.sh`.
- **Done when**: §5 green; release-hygiene 5/5.

## 5. Test / validation

| Gate | Asserts |
|------|---------|
| probe: numstat parse | `-z` NUL records; rename `a→b` classified by new path; tab-in-path + newline-in-path handled |
| probe: binary/deletion | `-\t-`→0 weight; deletion-heavy diff classified (not hidden) |
| probe: classifier | enumerated extension map; `unclassified` for no-extension (Makefile/Dockerfile) |
| probe: tie/degenerate | exact 50/50 → `mixed`; `weight_classified==0` → `mixed,0`; empty → `mixed` |
| probe: excludes | lockfile/vendor/min/dist excluded; `CHANGELOG*` NOT excluded (counts as docs); vendored-bundle-dominated → `mixed`/low-confidence |
| probe: `--domain` enum | invalid value → usage error |
| resolver: prefix identity | pre-existing output is an exact prefix; only the 2 keys inserted before `}` |
| resolver: non-git/empty | `mixed`/`none`, exit code unchanged |
| no-routing invariant | engines + `review_risk` + `cross_family_*` + `--enforce` identical with vs without `--auto-domain` |
| /l5 range | probe uses outcome-JSON range, not caller `HEAD` |

## 6. Risks + inversion

- **R1 — shrinks to nothing?** No: telemetry is the prerequisite for ALL future routing, buildable, honest, zero-risk. Converged to the defensible core.
- **R2 — probe nondeterminism** (rename config, binary, locale, NUL parse). *Mitigation:* `-z -M -C` + first-two-TAB/NUL parse + enumerated classifier + LC-independent arithmetic + tests.
- **R3 — a new key breaks a JSON consumer.** *Mitigation:* keys inserted before `}`; prefix-exact test; grep consumers (`/l5`, ledger, `dispatch-review`, tests) for positional/whole-string parsing.
- **R4 — telemetry tempts premature routing.** *Mitigation:* BACKLOG records 5 prereqs; constraint forbids acting on `work_domain`.
- **R5 — `/l5` probes the wrong diff** (worktree removed, ambient HEAD wrong). *Mitigation:* range from dispatch outcome JSON; explicit test.
- **Inversion:** any engine choice or pre-existing-field change with `--auto-domain` on vs off = failure.

## 7. Out of scope (deferred → BACKLOG)

- **All domain routing** (reviewer + implementer) — needs `reviewer_runner` honored, two-pass resolve, a pre-impl scope signal, real calibration, the inner-reviewer-family decision.
- **`qc_panel`/`cross_family_*`/`--enforce`** — untouched.
- **Per-domain calibration automation** — future; consumes this telemetry.
- **Combined/merge-diff probing**; **mode-based symlink/submodule detection** — out (documented).
- **SVG/README/icon thread** — separate.

## 8. Open questions (Board)

1. `/l5` always runs the post-impl probe (pure telemetry) — OK? *Default: yes; zero-risk.*
2. Probe threshold `> 0.5` of classified-product weight, ties → `mixed` — accept, or sensitivity-check on real PRs first?
3. Bucket granularity `{rust, backend-cli, frontend, docs, mixed, unclassified}` — or split `backend-cli` into python/go/shell now so telemetry is finer from day one? *(Cheap to widen now, expensive to backfill.)*

## Review log

- **R5 (gpt-5.5 xhigh, 2026-06-26) — loop cap (round 5)** — blind final pass. **0🔴**, 2🟠 + 1🟡, all micro-spec, all folded: 🟠 outcome base must be an immutable SHA (`develop` ref can advance post-dispatch) → `/l5` dispatches with `--base $(git rev-parse …)`, probe `base_sha..commit`; 🟠 exclude list still had `e.g.` → exact glob list (root+nested), `CHANGELOG*` kept out; 🟡 `domain_source` enum pinned (`explicit|auto|none`). Reviewer explicitly confirmed "no remaining routing creep" + hook/skill counts in sync. **Loop outcome: hit the 5-round cap WITHOUT a literal SHIP-AS-IS, but the verdict trajectory (2🔴→1🔴→2🔴→0🔴→0🔴) shows clean convergence — the design stabilized at R4; R5's residue is implementation-spec a competent implementer + tests resolve. Escalated to Board (cap policy): the plan is implementation-ready.**
- **R4 (gpt-5.5 xhigh, 2026-06-26)** — blind re-review. **0🔴** (design converged) — 6🟠 + 2🟡, all spec-precision, all folded: 🟠 `/l5` must probe the dispatch-outcome range not ambient `HEAD`; 🟠 `-z -M -C` NUL/rename parse pinned (first-two-TAB + NUL paths, classify by new path); 🟠 drop mode-based symlink/submodule special-casing (numstat can't see modes); 🟠 enumerate the extension→domain map + `--domain` enum + ties→`mixed`; 🟠 "exclude union of completeness+measure" over-claimed → probe owns an explicit inline list, NOT excluding `CHANGELOG*`; 🟠 `--auto-domain` ranges pinned (three-dot `BASE...HEAD` to match `diff-file-list.sh`; non-git→`mixed`/`none`/exit-unchanged); 🟡 KR2 "byte-identical via parse-delete" → prefix-exact + semantic test; 🟡 add the config-template field-reference. **Convergence signal: no architectural findings remain; residual items are implementation-spec, now pinned.** Awaiting R5 (cap).
- **R3 (gpt-5.5 xhigh)** — 2🔴+3🟠+1🟡; descoped to telemetry-only (routing to the motivating engine unplumbed; cross_family is panel-not-reviewer semantics). Superseded above.
- **R2 (gpt-5.5 xhigh)** — 1🔴+4🟠+1🟡; deferred implementer routing (diff-probe post-hoc). Superseded.
- **R1 (gpt-5.5 xhigh)** — 2🔴+5🟠+1🟡; active routing → telemetry-first. Superseded.
- **R0 (author)** — original; superseded.
