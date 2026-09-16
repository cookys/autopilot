**Recommend one outcome-isolated panel per candidate, with two eligible profiles: `packet` and `workspace`.** Keep independent review and depth-0 verification; remove the equation “blind = prompt-only,” duplicate verification, and duplicate review.

A clean checkout is necessary input hygiene, but **it cannot by itself enforce isolation**. The smallest honest redesign retains a bounded containment task for tool-capable reviewers.

**The isolation contract**

Define the guarantee precisely: seats cannot access dispatcher-owned prior verdicts, implementer reports, campaign evidence, or sibling outputs. Each seat starts a fresh session against the same immutable candidate and original requirements.

A detached Git worktree is insufficient: it shares repository administration data, and same-user `0700` directories do not prevent another process under that user from reading them. Git documents that shared metadata explicitly. [Git worktree documentation](https://git-scm.com/docs/git-worktree)

Build one review bundle containing:

- Original acceptance requirements, extracted separately from plan review notes and implementation reports.
- Base-to-candidate diff and source snapshots, without original Git history, remotes, worktree pointers, or object alternates.
- An explicit file manifest excluding registered campaign artifacts, receipts, transcripts, and evidence directories. Report omissions; never silently omit changed product files.
- Controller-computed candidate, input, and policy identities for binding results.

Construct this bundle from allowed inputs rather than regex-cleaning a mixed narrative. The current default diff provider already uses `git diff`, which excludes commit-message envelopes.

Preserve source comments, identifiers, and test names: rewriting them changes the artifact being reviewed. Treat assertions inside source as untrusted claims. **No design can promise zero semantic influence from arbitrary text while reviewing that text.** The enforceable promise concerns access to outcome channels.

| Profile | Execution | Counts toward panel? |
|---|---|---|
| `packet` | Fresh prompt-only request with curated artifacts | Yes |
| `workspace` | Tools inside an isolated source workspace | Yes |

For `workspace`, use one reusable Linux isolation launcher, initially qualified with Codex: approved runtime/dependencies, immutable source plus a private writable test copy, fresh home/temp/session, isolated process view, no host repository or shared sockets, and controller-side output capture. Restrict network access to the required inference transport; disable inherited MCP/connectors and remote repository access.

Allow shell and local Git operations **inside** that boundary. Test denied access to outcome sources, rather than banning executable names. Bubblewrap can implement such a boundary, but its protection depends on the complete launch policy; invoking it alone proves nothing. [Bubblewrap documentation](https://github.com/containers/bubblewrap#sandbox-security)

This is a narrower, reusable version of A2. An ordinary unrestricted clean checkout remains advisory; ADR-0001 re-derivation cannot restore independence after reviewers have copied one another.

**Admission and operator controls**

Put the gate in **both resolver and intake**, backed by one shared implementation:

- Resolver: immediate configuration diagnostics, including exact runner/model/profile compatibility and family diversity.
- Intake: authoritative validation before claims, worktrees, implementation, or model spend. Check every scheduled review seat, executor availability, qualification, minimum count, families, and resource capacity.
- Dispatch: cheap recheck of the sealed tuple and actual isolation setup. Refuse drift without silently substituting a seat.

Use cached qualification tied to runner version and isolation policy, plus a fast local access probe—not a model call on every intake. This catches configuration failures in seconds; it cannot guarantee a provider will remain available an hour later.

Mixing tiers should satisfy `min_panel_size` and family rules. Preserve three seats and at least two model families, plus existing implementer-family constraints. Count distinct successful seats, never retries or profile labels. Every required pinned seat must complete; a timeout is not an empty finding set.

Proposed controls:

```yaml
review_policy: outcome-isolated-v1
review_schedule: panel-per-candidate
panel_concurrency: 3
verification_execution: once-per-candidate
# Existing qc_panel seat tuples gain:
profile: packet | workspace
```

The standing pin becomes Sol/Codex=`workspace`, GLM/cc-shim=`packet`, MiniMax/cc-shim=`packet`. Pins establish seat selection/qualification; they cannot override failed isolation.

**Remove repeated work**

1. **Execute the sealed suite once under depth-0 control.** Today `verify` and `fullSuite` run the same command on separate detached checkouts. Make one complete execution satisfy both obligations. Bind reuse to candidate commit/tree, exact command, environment, runtime/dependencies, closed writer fence, checkout, and captured execution result. A focused test run or implementer receipt cannot substitute. Invalidate on any relevant change.

2. **Run all three seats concurrently.** Current `seats.map → performReview → spawnSync` is serial; adding `Promise.all` around it would remain serial. Use one panel supervisor that launches separate seat processes concurrently. Keep journaling, budgets, normalization, and aggregation in the parent; workers must not share mutable review state or output paths.

3. **Let the panel satisfy the full-diff review barrier and terminal review for the same candidate.** Remove the extra single-seat pass. Feed verified findings into the existing repair loop; a changed candidate requires fresh review. Keep earlier review optional for situations where its defect discovery demonstrably saves implementation time.

4. **Overlap verification and panel execution when resources permit.** Give them separate workspaces and keep verification output outside reviewer inputs. Reserve capacity first so three reviewers do not starve the authoritative suite.

On the supplied timings, removing the duplicate suite could save roughly 20 minutes. Concurrent review changes panel latency from the sum of seat durations toward the slowest seat’s duration.

Depth-0 still executes verification and substantiates findings before applying union-on-verified-critical. Passing tests alone does not establish that every reviewer conclusion is correct.

**Concrete code changes**

| Module | Change |
|---|---|
| [src/runners/review.js](/home/cookys/projects/autopilot/src/runners/review.js) | Replace scratch-cwd blinding with bundle/profile launch; fresh sessions, private outputs, timeout and cleanup parity. |
| [scripts/dispatch-review.sh](/home/cookys/projects/autopilot/scripts/dispatch-review.sh) | Replace the runner-name blind gate with shared profile validation and enforced launch; preserve raw transport output. |
| [src/engine/final-panel-qualification.js](/home/cookys/projects/autopilot/src/engine/final-panel-qualification.js) | Separate model qualification from runner/profile isolation capability. |
| [src/engine/campaign-intake.js](/home/cookys/projects/autopilot/src/engine/campaign-intake.js) | Validate and seal the complete executable roster before spending. |
| `scripts/resolve-review-loop.sh`, `src/engine/resolve-review-loop.js` | Resolve profile defaults, validate configuration, and expose actionable diagnostics using the shared policy. |
| [src/engine/autopilot-engine.js](/home/cookys/projects/autopilot/src/engine/autopilot-engine.js) | Prepare one bundle; make `performFinalPanel` invoke the concurrent supervisor; aggregate in stable seat order. Namespace finding IDs by seat to prevent unrelated duplicate IDs from conflicting. |
| `src/engine/campaign-composition.js`, `src/engine/campaign-verification.js` | Make one panel satisfy both review obligations and one controller execution satisfy both verification obligations; preserve repair, resume, invalidation, and budget semantics. |

Add small bundle and isolation-launcher modules. Update closed schemas, configuration templates, blind-dispatch documentation, and generated Codex mirrors through the existing generator. Record profile and input identity in existing receipts; introduce no separate attestation infrastructure.

**Red-first acceptance tests**

Use a deterministic hostile executable through the **actual launcher**. “The model did not mention the canary” is only a smoke test.

- Plant unpredictable prior-verdict markers in tracked/untracked campaign evidence, Git metadata, home/session history, shared temp, and sibling output. Assert denied access while ordinary source reads and targeted tests succeed.
- Attempt absolute paths, traversal, escaping symlinks, Git back-pointers, inherited descriptors, host `/proc` access, sockets, HTTP/Git retrieval, MCP, and session resume.
- Finish one seat while another remains active; the latter must still be unable to read its result.
- Assert packet construction excludes reports and prior-round text while preserving included source bytes and requirements.
- Prove invalid mixed rosters fail before implementation; valid mixed tiers satisfy quorum; retries and duplicate local finding IDs cannot inflate counts or erase findings.
- Plant false “tests passed” attestations: depth-0 must still execute. Assert exactly one authoritative suite execution, with candidate/command/environment changes invalidating reuse.
- Exercise timeout, cancellation, resume, cleanup, and raw-log preservation without rerunning successful unchanged seats.

Migrate additively: introduce profiles with existing prompt-only behavior preserved; qualify one Codex workspace adapter; enable the mixed pin; then consolidate execution and review gates. Version the changed scheduling/receipt contracts and document rollback. The unavoidable cost is one real isolation integration; the payoff is broader reviewer capability and substantially less repeated work.
