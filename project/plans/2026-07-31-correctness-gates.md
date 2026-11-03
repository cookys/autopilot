---
status: approved
date: 2026-07-31
size: L
entry_level: l6
project: correctness-gates
---

# Correctness Gates Sweep

## Background

Four triggered correctness tickets are small individually but share one release-safety theme and
do not overlap the Controller/Fable P0 or evidence workstream:

1. north-star prose justification scans all of CHANGELOG and is permanently false-green;
2. `verify-red-green.sh` runs repo-owned absolute test scripts from the caller checkout;
3. binary diffs can omit the path evidence used by risk classification;
4. commit-secret-scan scans deleted lines and can block removal of an existing secret.

They are bundled into one project so one foreman can produce four independent commits while the
project-level quality gate verifies their combined behavior.

## Project Goal

> **Final goal**: restore four deterministic gates so they reject the intended defect and accept
> the corresponding safe operation without changing unrelated semantics.
>
> **Success criteria**:
> - north-star justification is accepted only from the current canonical version section;
> - repo-owned verify commands execute the matching script inside each detached worktree while
>   genuinely external absolute commands retain their existing meaning;
> - binary diff paths, including quoted/space-containing names, reach protected-path risk rules;
> - commit-secret-scan blocks newly added secrets but permits deletion-only removal;
> - all named C-line regression tests exit 0.
>
> **Scope boundary**: only the four named gate defects and their existing tests. No release,
> version bump, generalized diff parser rewrite, `.gitleaks.toml` policy engine, or shared
> `hooks/tests/lib.sh` change.

## User requirements ledger

| Requirement | Mapping |
|---|---|
| Approved C line of small deterministic fixes | This project is the C workstream. |
| “backlog 撿一撿變完整 project phase” | P1–P4 below plus the project tracker. |
| “讓 ceo 用 /l6 分別派出 sub orchestor 後照 dev-flow 推進” | One admitted Mission node, one isolated L6 foreman, four phase commits, finish-flow before integration. |

## Scope completeness audit

| Dimension | Decision |
|---|---|
| Source + tests | In scope for each named script/hook and existing regression test. |
| User-facing docs | Project/plan ledger only; scripts' own usage comments update when semantics change. |
| Public interface | Preserve CLI flags, JSON fields, and exit codes. |
| Config/examples | `.gitleaks.toml` consumption is explicitly out of scope. |
| CHANGELOG/version | Integration-owner closeout only; foreman must not edit either. |
| Migration | None; behavior is corrected in place. |
| External consumers | Preserve external absolute verify-command behavior. |
| Credit | No third-party design absorbed. |
| Dogfood | Each fix includes a planted-defect negative control over the real gate. |

## Deliverable C contract

The executable Mission node is `correctness-gates`. P1–P4 are source-coverage phases and gates
inside that node; they are not separate campaigns.

- **Immutable base**: the project bootstrap commit.
- **Owned files**: the four named scripts/hooks and their named existing tests.
- **Forbidden files**: `docs/BACKLOG.md`, `docs/projects/INDEX.md`, `CHANGELOG.md`, `CLAUDE.md`,
  version manifests, `hooks/tests/lib.sh`, `src/engine/*`, and all B-line files.
- **Objective verification**:
  `bash hooks/tests/preflight-release-routing.test.sh &&
   bash hooks/tests/verify-red-green.test.sh &&
   bash hooks/tests/classify-diff-risk.test.sh &&
   bash hooks/tests/classify-diff-risk-filename-space.test.sh &&
   bash hooks/tests/secret-scan-diff.test.sh &&
   bash hooks/tests/reenabled-blockers.test.sh`.
- **Acceptance patterns**: A2 + A5 for every gate; A1 for current-version extraction and
  repo-local/external command parity.
- **Negative controls**: historical-only justification must fail; head-only repo script reuse must
  fail RED; a protected binary path must classify high risk; deletion-only secret removal must pass
  while an added secret still blocks.
- **Resource ceiling**: at most 9 changed files, 2 repair generations, 3 gate attempts,
  60 minutes, and no more than 1,800 lines of total churn.

## P1 — Current-version prose justification

1. Reuse or extract the canonical version-section parsing rule.
2. Search from `## v<current>` up to the next `## v` only.
3. Prove a historical justification no longer clears the current release.
4. Preserve a valid current-section justification and the under-threshold path.

## P2 — Worktree-correct red-green verification

1. Choose the tool-side repair: a repo-owned verify script resolves to the same relative path under
   each detached worktree.
2. Preserve caller-relative validation before worktree creation.
3. Preserve truly external absolute executable semantics.
4. Do not change `hooks/tests/lib.sh`; that shared 158-test substrate is outside this lane.
5. Prove base+new-tests is RED and head is GREEN using a repo-owned test script.

## P3 — Binary diff path risk classification

1. Parse `diff --git` path headers when `---/+++` paths are absent.
2. Preserve rename and normal text-diff behavior.
3. Handle Git quoting and space-containing paths without truncation.
4. Prove a protected binary path triggers the expected domain/checklist.

## P4 — Added-lines-only commit secret scan

1. Scan only added diff content (`+`, excluding `+++`) for commit blocking.
2. Permit deletion-only removal of an existing matching secret.
3. Continue blocking a newly added matching secret with redacted output.
4. Keep unexpected hook infrastructure errors fail-open as the current hook contract specifies.
5. Reuse `secret-scan-diff.js` parsing where practical; do not build a second policy engine.

## Dependencies and execution order

```text
P1 → P2 → P3 → P4 → combined regression gate
```

The order is for reviewable commits, not a technical dependency. One foreman owns the sequence;
the complete C node runs in parallel with B.

## Risks

| Risk | Control |
|---|---|
| Current-version parser drifts from other release checks | Parity test against canonical version extraction. |
| Verify command compatibility breaks external consumers | Explicit external-absolute regression. |
| Quoted binary paths are misparsed | Space/quoted fixtures plus existing filename-space suite. |
| Secret scanner becomes fail-open for additions | Added-secret negative control remains blocking. |
| Bundle grows into shared infrastructure rewrite | Exact file allowlist and 9-file ceiling. |

## Out of scope

- `hooks/tests/lib.sh` changes;
- new config/allowlist semantics for `.gitleaks.toml`;
- generalized binary patch content inspection;
- release/version/CHANGELOG work;
- backlog/index edits by the foreman;
- Controller/Fable engine files or B-line evidence files.

## CEO decisions

| Decision | Rationale | Reversibility | Scope effect | Acting owner |
|---|---|---|---|---|
| Bundle four fixes under one node | They are file-disjoint from B but too small to justify four foremen. | High | Reduces coordination | depth-0 CEO |
| Tool-side verify-red-green repair | Avoids changing the shared 158-test `lib.sh` substrate and preserves merge isolation. | High | No expansion | depth-0 CEO |
| Added-lines-only secret scope | It directly fixes the deadlock while preserving the existing hook threat model. | High | Smaller than allowlist engine | depth-0 CEO |
