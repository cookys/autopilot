# Plan — Codex payload residual install-time spike

> Status: FROZEN FOR EXECUTION
> Owner: depth-0 CEO with the existing worktree-isolated L4 foreman transcript
> Size: L (one report-only, three-probe decision bundle)
> Source: triggered `docs/BACKLOG.md` entry after live Codex login became available

## Context

The 2026-07-17 C-spike proved that Codex can load a payload generated before plugin add and that
`scripts/sync-codex-plugin-skills.sh` does not require Git. It did not prove the three remaining
facts needed to replace the current committed payload mirrors:

1. a real logged-in `codex exec` can discover and consume the installed plugin payload;
2. the supported marketplace upgrade path re-reads regenerated plugin content predictably; and
3. Codex provides a native, fail-loud install/upgrade lifecycle point that can generate the payload
   before the loader needs it.

The user has now confirmed Codex is logged in, so the first trigger is live. This mission closes all
three residual questions in one bounded spike. It does not implement the migration.

## Objective and measurable result

Produce one reproducible evidence record and one binary decision:

- `GO` only when all three prerequisites above are positively demonstrated through the installed
  Codex CLI or an authoritative native contract;
- otherwise `NO-GO`, keep committed mirrors and their drift gates, and replace the stale backlog
  trigger with the exact missing capability that would justify reopening the migration;
- leave no disposable repository, marketplace, test plugin, process, or Codex configuration residue;
- update the portability reference and project/backlog tracking to agree with the evidence.

## Scope completeness audit

| Dimension | Decision |
|-----------|----------|
| Product source and tests | Out of scope: this is a report-only spike and may not change production scripts, generated mirrors, or tests. |
| User-facing docs | In scope: update the Codex portability claim with bounded empirical facts. |
| Public interface/config templates | Out of scope: no new plugin manifest key or wrapper is shipped. |
| CHANGELOG/version/release | Out of scope: no production behavior changes and no release occurs. |
| Migration | Decision only. The L migration is admitted only by a later mission if all three prerequisites pass. |
| External consumers | In scope only as a compatibility conclusion; no consumer repo is modified. |
| Dogfood | In scope: use the installed local Autopilot Codex plugin from a disposable repo without repo-local skills. |
| Secrets/data egress | Evidence must contain no tokens, credentials, home config contents, or model conversation beyond the minimal probe result. |

## User requirements ledger

| Requirement | Mapping |
|-------------|---------|
| “go, ceo mode /l4, 繼續消化 backlog” | Execute the highest triggered backlog item autonomously as one admitted L4 deliverable. |
| “相關的重新打包整理好一次做完再 review” | Bundle the three probes and documentation disposition before one first-pass review and one terminal depth-0 QC. |
| “attach 回那個 implementer agent (transcript) 繼續工作” | Reuse `/root/backlog_convergence_foreman`; do not create a replacement implementer transcript. |
| “implementer 根本不能跑合格測試” | Foreman/implementer evidence is non-authoritative; independent review and depth-0 artifact verification own acceptance. |
| “commit and push?” | Commit and locally merge when green; do not push under the active project red lines. |

## Deliverable contract

### Live installed-payload execution

Create a disposable Git repository outside the Autopilot checkout with two tiny comparison files and
no `.agents/skills` directory. Run the installed `codex` CLI in ephemeral, read-only, JSON mode and
explicitly invoke `$autopilot:audit`. The prompt must require a support reference linked from the
installed skill to be read before returning the comparison. A pass requires all of:

- Codex exits zero;
- the JSON transcript contains tool evidence reading the installed plugin payload/support path, not
  merely a model self-report;
- the final answer correctly compares the planted files; and
- the disposable repository remains unchanged.

Authentication, quota, transport, model failure, missing skill discovery, or self-report-only proof
is an honest failed prerequisite, not a reason to invent a pass.

### Marketplace re-read and upgrade semantics

Use a uniquely named disposable local marketplace and plugin fixture. Add both through the real
Codex CLI, observe version/content at generation A, mutate the fixture to generation B, then record:

- whether `plugin list`/loader state re-reads the local source without an upgrade;
- the exact result of `codex plugin marketplace upgrade <fixture>`; and
- whether the supported Git-marketplace upgrade contract can be proven locally without publishing
  an external repository.

Local live re-read is not evidence for Git snapshot refresh unless the CLI proves that equivalence.
Always remove the temporary plugin and marketplace, even after a failed probe.

### Native install-time generation hook

Inspect the installed Codex plugin command surface and accepted plugin manifest schema, plus the
installed curated manifest corpus. A prerequisite passes only if Codex exposes a native lifecycle
point that automatically runs on plugin install and the applicable upgrade/refetch path, can invoke
the deterministic generator before payload discovery, and fails the install/upgrade when generation
fails. An unknown manifest field, a manual pre-step, a shell wrapper, a symlink, or a marker that
never runs is negative evidence, not a hook design.

### Decision rule and backlog disposition

Set `decision=GO` only if live execution, marketplace upgrade/re-read, and the native lifecycle hook
all pass. On `GO`, describe the separately scoped migration but do not execute it in this mission. On
any failure or unproven row, set `decision=NO-GO`, preserve committed mirrors plus sync/drift gates,
and update the backlog trigger to reopen only on a concrete native Codex lifecycle capability or an
equivalent officially supported mechanism.

### Evidence and hygiene

Write a deterministic JSON evidence artifact containing CLI versions, sanitized commands, exit
codes, observed machine-readable fields, per-prerequisite verdicts, cleanup checks, and the final
decision. Do not persist raw auth/config data or an unrestricted model transcript. The six campaign
outputs are exactly:

1. `docs/BACKLOG.md`
2. `references/multi-agent-portability.md`
3. `docs/projects/2026-08-02-codex-payload-residual-spike/README.md`
4. `docs/projects/2026-08-02-codex-payload-residual-spike/dev-info.md`
5. `docs/projects/2026-08-02-codex-payload-residual-spike/evidence.json`
6. `docs/projects/INDEX.md`

## Verification contract

The candidate must pass:

- JSON parse and required-field checks for the evidence artifact;
- exact six-path candidate diff audit;
- `git diff --check`;
- `bash scripts/validate.sh`;
- `node scripts/sync-version.js --check`;
- `node scripts/check-hook-inventory.js --check`;
- `bash scripts/sync-all.sh --check`;
- one independent first-pass review after the full bundle; and
- the resolver-selected authoritative depth-0 QC panel before local merge.

## Risks and mitigations

- **False installed-plugin proof**: repo-local skill discovery can mask the package. Use a clean
  disposable repo and require transcript-level installed-path evidence.
- **Local/Git marketplace conflation**: a local source can live-reload while Git snapshots require
  explicit refresh. Record each separately and fail closed on unproven equivalence.
- **Imaginary lifecycle hook**: permissive manifest parsing is not execution. Require an observable
  automatic invocation and fail-loud behavior.
- **Residue in user config**: snapshot the relevant plugin/marketplace names, use unique fixture
  names, and remove them in a guaranteed cleanup path.
- **Accidental migration**: exact output paths exclude `platforms/codex/plugin`, sync scripts,
  manifests, tests, and all production code.

## Out of scope

- Retiring or regenerating committed Codex payload mirrors.
- Adding an install wrapper, postinstall script, plugin hook, new manifest key, or marketplace.
- Changing sync/drift gates, tests, version metadata, CHANGELOG, release, PR, push, or publication.
- Using an external Git host merely to complete the marketplace experiment.

## Open questions

None for execution. Unknown native capability is represented as `unproven` and produces `NO-GO`.

## Review log

- R0 2026-08-02: frozen as one report-only residual spike after installed Codex 0.146.0 login and
  plugin-list preflight. The three prerequisite verdicts remain open until the foreman records
  executable evidence.
