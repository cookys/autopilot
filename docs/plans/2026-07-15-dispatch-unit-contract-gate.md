# Dispatch unit contract gate — spec / boundary / GO / NO-GO

Status: ✅ SHIPPED v2.32.42 — C1–C7 completed and merged as `76daeb8a`
Spec owner: depth-0 CEO
Target: v2.32.42
Project: [`../projects/_archive/2026-07-15-dispatch-unit-contract-gate/README.md`](../projects/_archive/2026-07-15-dispatch-unit-contract-gate/README.md)
Origin: 2026-07-15 verification-author incident and repeated oversized author dispatches
Depends on: verification-author roster gate; existing rubric-freeze, disjointness, session-mode, and dispatch-manifest machinery

## Problem

Autopilot already documents a six-element task contract and a seven-element prompt, but the
write rails still accept a free-form prompt as sufficient authorization. `dispatch-hetero.sh`
can start a model without a machine-readable spec, file boundary, GO preconditions, NO-GO
conditions, or unit budget. The post-commit rail can prove that a commit exists; it cannot prove
the dispatch should have started or that the unit was bounded correctly.

This caused two distinct failures:

1. An orchestrator selected an unauthorized verification model because model authorization was
   prose-only.
2. Test-author tasks carried the whole project instead of a small unit, so multiple engines spent
   their wall-time reading/replanning and produced no artifact.
3. Release preflight started a quota-spending Sonnet probe before depth-0 had checked the live model
   roster. It was killed and rerun with the explicit skip flag, but the launcher had no common
   machine-readable authorization boundary.

## Decision

Add an immutable, machine-validated **dispatch unit contract**. Under strict L5/L6 paths, a prompt
is task detail, not authorization. No valid contract and no mechanical GO verdict means no runner.

This plan does not replace the existing six/seven-element methodology. It makes its load-bearing
parts executable at the dispatch boundary.

## Authority and lifecycle

The dispatch contract separates four responsibilities that prose currently blurs:

| Responsibility | Authority | May not do |
|---|---|---|
| Author and freeze the spec, unit boundary, dependencies, acceptance, and budget | depth-0 CEO | Delegate authorization policy to the worker |
| Compute `GO` or `NO-GO` from repo, contract, roster, quota/readiness, and base facts | deterministic contract checker | Accept a prose override or infer missing fields |
| Execute the declared unit | selected worker/runner | Widen paths, budget, attempts, dependencies, or model tuple |
| Validate the returned git/artifact truth and run acceptance | depth-0 QC host | Trust worker self-report as proof |

Lifecycle states are explicit and monotonic for one contract hash:

```text
draft -> GO-checked -> running -> returned -> accepted
             |           |          `------> rejected
             |           `-----------------> stopped
             `-----------------------------> NO-GO
```

- **NO-GO** is pre-dispatch: no runner, temp worktree, endpoint call, or quota spend may start.
- **STOP** is runtime: timeout, clarification, quota/engine loss, or observed boundary breach ends the
  attempt. It does not authorize a retry or wider scope.
- **REJECT** is post-return: the process ran, but git truth, output shape, or acceptance does not match
  the contract. The artifact stays forensic input, not an accepted implementation.
- Only depth-0 may issue a new contract. Nobody, including depth-0, may override a NO-GO on the same
  hash; changing any field creates a new hash and requires a fresh check.

## OKR and global constraints

**Objective:** make every strict L5/L6 model-spending unit bounded and mechanically authorized before
execution, then mechanically contained and attributable after execution.

Key results:

1. Every strict write/author dispatch records one immutable contract hash, one spec hash, and one GO
   verdict before runner start.
2. All negative preconditions prove zero runner/endpoint invocation.
3. All returned artifacts are checked against exact path, file-count, diff-line, output, and
   acceptance boundaries using repository truth.
4. Active L5/L6 prompt-only write/author dispatch is impossible; legacy inactive calls remain
   compatible during migration.
5. Status output exposes the authorized unit and actual usage without secrets.

Global constraints copied verbatim into every implementation, verification, and review dispatch:

- `A prompt is task detail, never dispatch authorization.`
- `NO valid contract plus deterministic GO verdict means zero runner, endpoint, worktree, or quota spend.`
- `No prose override, silent fallback, automatic scope widening, or worker-authored authorization.`
- `Canonical sources and every mandatory generated mirror are one declared atomic path boundary.`
- `Depth-0 owns spec and acceptance; workers implement or verify only the frozen unit.`
- `A changed contract, base, dependency, roster tuple, or required readiness fact requires a fresh GO check.`

## Frozen v1 contract

Canonical file: JSON validated by `schemas/dispatch-unit-contract.schema.json`.

```json
{
  "schema": 1,
  "unit_id": "author-roster-resolver-tests",
  "role": "implementer|verification-author|reviewer|explorer",
  "goal": "one observable outcome",
  "spec": {
    "path": "docs/plans/2026-07-15-example.md",
    "section": "Frozen v1 contract"
  },
  "base_sha": "40-hex immutable commit",
  "depends_on": ["40-hex commit"],
  "scope": {
    "allow_paths": ["hooks/tests/example.test.sh"],
    "deny_paths": ["scripts/**", "schemas/**"],
    "generated_mirrors": {
      "command": ["scripts/sync-codex-plugin-skills.sh"],
      "allow_paths": ["platforms/codex/plugin/hooks/tests/example.test.sh"]
    },
    "max_files": 1,
    "max_diff_lines": 180
  },
  "go": {
    "required_paths": ["hooks/tests/lib.sh"],
    "required_engine_role": "verifier",
    "required_red_command": ["bash", "hooks/tests/example.test.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {
    "kind": "commit|raw-artifact|verdict",
    "paths": ["hooks/tests/example.test.sh"]
  },
  "acceptance": [
    {"argv": ["bash", "-n", "hooks/tests/example.test.sh"], "exit": 0}
  ],
  "budget": {
    "wall_seconds": 105,
    "max_attempts": 1,
    "max_context_files": 4
  }
}
```

### Schema rules

- `unit_id`, `role`, `goal`, `base_sha`, `scope`, `go`, `no_go`, `output`, `acceptance`, and
  `budget` are required. Unknown top-level keys fail validation.
- `base_sha` and every dependency are full 40-hex SHAs; branches/tags are not accepted as the
  immutable contract value.
- `allow_paths` is non-empty for write roles. `deny_paths` must not overlap an allowed exact path.
- `generated_mirrors` is optional, but when present both its argv-only repo-declared sync command
  and non-empty mirror `allow_paths` are required. Mirror paths count toward file/diff budgets and
  may not overlap `deny_paths`.
- A generated mirror is authorized only when both its canonical source and exact generated path are
  declared in the same unit. Discovering a pre-commit mirror requirement after dispatch is NO-GO;
  depth-0 must issue a corrected contract rather than bypass the hook or widen scope in prose.
- `max_files >= 1`, `max_diff_lines >= 1`, `wall_seconds` is 10..3600, `max_attempts` is 1..3,
  and `max_context_files` is 1..20.
- Acceptance commands are argv arrays, never shell strings. No `sh -c`, command substitution,
  environment assignment, redirection, or pipe syntax in v1.
- `spec.path` must exist under the consuming repo and the named section must be present.
- `forbidden_actions` is an enum. Absence never means permission; shipped defaults include
  `push`, `merge`, `network`, and `dependency-change`.

## Mechanical GO gate

New command:

```sh
node scripts/dispatch-contract.js check --contract <file> --repo <repo> --json
```

Exit contract: `0=GO`, `2=usage/schema error`, `3=NO-GO`.

GO requires all of the following before a runner process or temp worktree is created:

1. Schema valid and spec section present.
2. Current repository clean; `base_sha` resolves exactly; every dependency is an ancestor of base.
3. Required paths exist.
4. The role's engine tuple comes from the canonical resolver/roster and is known, qualified where
   that role has qualification, and quota/readiness is not `unavailable`.
5. Scope lists and budgets are internally consistent.
6. When `required_red_command` is present, the dispatcher records the command as the required
   base+oracle proof; the normal red/green verifier remains authoritative for execution semantics.
7. Every repo-declared generated mirror required by the allowed canonical paths is represented by
   `scope.generated_mirrors`; omitted mandatory mirrors are a pre-dispatch NO-GO.

The checker emits `{verdict, unit_id, contract_sha256, spec_sha256, reasons, resolved_engine}`.
There is no LLM override and no silent fallback. A changed contract is a new hash and a new GO check.

### Project-start GO / NO-GO

This project itself may enter implementation only after all of these are true:

- v2.32.35 is pushed, installed, reloaded, and its l6 session marker is cleared;
- the feature branch is based on that pushed `origin/develop` SHA and starts clean;
- the roster names an available implementer, a heterogeneous verification author, and both QC
  reviewer families; no model is substituted from memory;
- C1's exact file boundary, mandatory mirrors, RED command, acceptance commands, and budgets are
  frozen in the first contract;
- the base checkout proves all proposed canonical and mirror paths before dispatch.

Any false item is NO-GO. Quota reset, model rename, missing mirror, dirty base, ambiguous spec section,
or a unit that exceeds one semantic decision must be resolved by a new/smaller contract, not by a
larger prompt.

### C1 bootstrap exception (single use)

C1 creates the checker, so it cannot honestly claim that the not-yet-existing checker authorized
its own dispatch. C1 is the only bootstrap exception:

- depth-0 writes a frozen C1 JSON contract conforming to this plan's v1 shape and records its SHA-256;
- depth-0 mechanically checks exact base/dependency SHAs, clean tree, existing required paths,
  live roster/readiness, exact canonical+mirror allowlist, budgets, and RED/acceptance argv before
  runner start;
- existing v2.32.35 strict roster/session gates remain active and no manual model substitution is
  permitted;
- the dispatch result records the bootstrap checklist and contract hash even though the new checker
  did not execute it;
- C1 acceptance must include running the new checker against its own valid/invalid fixtures.

This exception expires when C1 is accepted. C2-C7 require the shipped checker and may not copy,
extend, or reinterpret the bootstrap path. If C1 stops/rejects, a corrected C1 contract repeats the
same depth-0 checklist; it does not authorize any later unit.

## Mechanical NO-GO and runtime stop

Pre-dispatch NO-GO is any failed GO condition. Runtime stop is triggered by wall budget, explicit
clarification/question outcome, engine/quota failure, or scope/budget breach. A stopped unit may not
be automatically widened; depth-0 writes a new smaller contract or records a different engine tuple.

After a write rail returns, actual git artifacts are checked:

- changed paths subset `allow_paths` and disjoint from `deny_paths`;
- generated paths subset `generated_mirrors.allow_paths`, produced only by the declared sync argv,
  and byte/parity checks pass after generation;
- actual file count and diff lines within budget;
- output kind/path matches the contract;
- non-empty runner output is not artifact proof: tool-call requests, prose, Markdown fences without
  the declared payload, malformed patches, and missing declared output paths are rejected even when
  a legacy rail reports `status=authored`;
- acceptance argv commands are executed by depth-0, never trusted from worker prose.

Read-only author/review rails also snapshot the consuming checkout before runner start and compare
git status plus tree identity after runner exit. Any mutation is `containment_breach` and NO-GO,
even when the changed paths happen to match the requested artifact. The output artifact may be
quarantined for forensic/recovery input, but it is never silently promoted to an authorized edit.

Reuse `check-disjointness.sh` path semantics where possible. Its green result certifies paths only;
semantic correctness remains review/QC work.

## Dispatch integration

Strict canonical invocation:

```sh
scripts/dispatch-hetero.sh --strict-contract --contract-file <json> --prompt-file <task.md> ...
```

- Active L5/L6 sessions require `--strict-contract`; prompt-only write dispatch fails before runner.
- The dispatcher validates the contract, derives timeout from `budget.wall_seconds`, pins base to
  `base_sha`, then prepends a normalized read-only rendering of the contract to the worker prompt.
- Caller `--base`/timeout/model values that disagree with resolved contract/roster are rejected.
- Manifest/result add `unit_id`, `contract_sha256`, `spec_sha256`, GO verdict, budgets, and actuals.
- `dispatch-status.js` surfaces those fields so depth-0 can see what a live worker is authorized to do.
- `dispatch-author.sh` uses the same contract checker for verification-author role.
- `dispatch-review.sh` support is additive in v1; strict review-contract enforcement follows after
  write/author rails prove stable.
- Native harness Agent calls are out of scope for v1 because their tool schema has no contract-file
  field. A later hook/adapter may gate them; do not scrape free-form prompts in a security boundary.
- Direct quota-spending launchers outside the two write rails must either compose the checker or be
  explicitly inventoried as migration debt. `scripts/preflight-release.sh` must preflight/skip an
  unavailable configured slash-probe model before it spawns a CLI; it may not silently select or
  start a hard-coded fallback during active L5/L6.

## File-structure map

| Path | Responsibility |
|---|---|
| `schemas/dispatch-unit-contract.schema.json` | Closed v1 contract shape and enums |
| `scripts/dispatch-contract.js` | Schema/spec/base/roster/readiness GO checker and stable JSON/exit contract |
| `scripts/dispatch-hetero.sh` | Strict write-rail preflight, derived base/timeout, post-return artifact enforcement |
| `scripts/dispatch-author.sh` | Strict verification-author composition and read-only containment proof |
| `scripts/dispatch-status.js` | Contract hash, unit, GO, budget, and actual observability |
| `scripts/preflight-release.sh` | Explicit no-spend behavior when its configured probe engine is unavailable |
| `hooks/tests/dispatch-contract.test.sh` | Schema, spec, base, dependency, readiness, and zero-runner GO/NO-GO oracle |
| `hooks/tests/dispatch-contract-artifact.test.sh` | Path/budget/output/acceptance post-return oracle |
| `hooks/tests/dispatch-author-contract.test.sh` | Author-rail composition and consuming-checkout containment oracle |
| `hooks/tests/preflight-release-routing.test.sh` | Unavailable probe proves zero CLI spawn; explicit skip remains observable |
| `skills/l5/SKILL.md`, `skills/l6/SKILL.md` | Canonical operator commands and no-override rules |
| `skills/ceo-agent/references/level-front-door.md` | Shared lifecycle and responsibility boundary |
| `platforms/codex/plugin/**` mirrors | Deterministic payload parity generated only by the declared sync command |

## Units

| Unit | Size | Depends on | Scope | Acceptance |
|---|---|---|---|---|
| C1 schema/checker | S | v2.32.35 bootstrap checklist | schema, checker, one focused oracle | Frozen C1 contract/checklist/hash recorded; invalid/spec/base/roster/readiness fixtures are NO-GO with zero fake-runner calls; valid fixture emits stable hashes and GO |
| C2 write-rail preflight | S | C1 | hetero rail plus focused oracle | Strict active L5/L6 derives base/timeout/tuple from contract and blocks all caller disagreements before worktree/runner |
| C3 artifact boundary | S | C2 | post-return validator plus focused oracle | Out-of-path/deny/budget/output violations reject; acceptance argv runs on QC host using git truth |
| C4 author rail | S | C1, C3 | author rail plus containment oracle | Roster gate composes with contract; consuming checkout mutation is containment breach and cannot be promoted |
| C5 observability/docs | S | C2-C4 | status/manifests, L5/L6/front-door, generated mirrors | Live/final status exposes contract and actuals; canonical/mirror parity and skill validation pass |
| C6 release-probe routing | S | C1 | release preflight plus zero-spawn oracle | Unavailable/unapproved probe returns explicit skip or NO-GO before CLI spawn; no hard-coded fallback |
| C7 aggregate QC/release | L close | C1-C6 | no new product surface | Full suite, contract parity, payload sync, secret/completeness scans, dual-family review, finish-flow |

Each unit has one immutable base, its own allowed paths, RED proof, commit, and review. Never dispatch
this whole plan as one implementation task.

Empirical boundary evidence from the roster-gate dogfood (2026-07-15): a four-file Spark repair with
the full acceptance surface spent 115 seconds scanning and timed out before editing. Splitting the
same repair into schema+mirror, JS+mirror, and guard-order+mirror units completed in 25, 46, and 33
seconds. Contract generation should therefore prefer one semantic decision plus mandatory mirrors,
with later aggregate QC, rather than counting four related files as automatically small.

## Required tests

- Missing/malformed contract blocks before fake runner.
- Missing spec section or changed spec hash blocks.
- Branch name in `base_sha`, dirty repo, missing dependency, or missing required path blocks.
- Prompt/manual base/timeout/model mismatch blocks.
- GO fixture reaches fake runner with derived base/timeout and records hashes.
- Out-of-scope path, denied path, excess files, or excess diff lines rejects the artifact.
- A required-but-undeclared mirror blocks before runner start; a declared mirror outside its exact
  mirror allowlist or generated by an undeclared command rejects the artifact.
- Quota unavailable/unknown engine blocks without fallback.
- Worker question/timeout returns stopped and cannot widen/retry past `max_attempts`.
- Tool-call-only or prose-only author output is rejected as `artifact_invalid`, never promoted to
  authored/complete merely because the raw log is non-empty.
- A fake or real author runner that mutates the consuming checkout is reported as
  `containment_breach`; the pre-run tree is restored only in an isolated fixture, never by silently
  resetting a user's working tree.
- Legacy non-L5/L6 calls remain compatible during migration; strict L5/L6 prompt-only calls block.

## Migration and non-goals

- Phase 1 is opt-in `--strict-contract`; L5/L6 docs switch only after full tests and payload sync.
- Phase 2 makes active L5/L6 strict mechanically mandatory.
- Existing batch unit files remain supported; a converter can generate contracts, but there is one
  canonical schema after migration.
- No natural-language parser, model-authored GO verdict, automatic scope widening, auto-fallback,
  or secret-bearing contract fields.

## Risks and inversion

- **Guaranteed failure: contract becomes a second prose prompt.** Mitigation: closed schema, hashes,
  argv commands, exact paths, stable exit codes, and zero LLM authority in the checker.
- **Guaranteed failure: one contract covers the whole project.** Mitigation: C1-C6 are separate
  contracts; `max_files`, `max_diff_lines`, `wall_seconds`, and one-semantic-decision review are
  pre-dispatch gates.
- **Guaranteed failure: mirror discovery happens after authoring.** Mitigation: checker validates
  canonical+mirror declarations before runner and rejects retroactive allowlist widening.
- **Guaranteed failure: worker output is treated as proof.** Mitigation: QC host reads git/artifact
  truth and executes acceptance; prose/tool-call-only/empty output never qualifies.
- **Guaranteed failure: quota/model facts are recalled from conversation.** Mitigation: the roster
  and live readiness result are contract inputs; changed facts invalidate GO.
- **Guaranteed failure: compatibility mode becomes a permanent bypass.** Mitigation: migration is
  time-boxed to inactive non-L5/L6 calls; active L5/L6 prompt-only writes are a tested hard block.

## Review log

- R0 (2026-07-15, depth-0 CEO): extracted from the verification-author incident; froze v1 schema,
  mechanical GO/NO-GO, runtime STOP, artifact REJECT, and the initial bounded unit split.
- R0 amendment (2026-07-15, Board): formally opened the project; made spec ownership, boundary,
  GO/NO-GO authority, post-return QC, and direct quota-spending launcher debt explicit. Split release
  probe routing into C6 instead of silently folding it into dispatcher work.
- R1 plan review (2026-07-15): AGY Gemini 3.5 Flash High returned `SHIP-AS-IS` with no findings
  (`dispatch-review-log-UmzXhb`). MiniMax-M3 twice returned a semantic `SHIP-AS-IS` inside legacy
  `<<<` delimiters instead of the required nonce wrapper (`dispatch-review-log-ax3JQq`,
  `dispatch-review-log-UM0v2c`); both are recorded as fail-closed `no_verdict`, not panel passes.
