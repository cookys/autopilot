# DOA Config — Delegated Operations Authority Presets

> Override autopilot's default DOA (Delegated Operations Authority) tier → action policy
> mapping for subagent dispatch.
> Consumed by `scripts/resolve-doa.sh`; mirrors the pattern of `model-routing-config.md`.

## What is DOA?

DOA assigns an _action policy_ (autonomous / logged / escalate) to each action class
based on how reversible the action is and which model-tier is driving it.
The four action classes map to increasing risk:

| Tier | Action class | Example actions |
|------|-------------|-----------------|
| 1 | `read_only` | read files, list directory, grep, cat, index read |
| 2 | `reversible` | edit file, commit on feature branch, create branch, run tests |
| 3 | `external` | push to remote, comment on PR, open issue, send notification |
| 4 | `irreversible` | merge to main, delete branch, publish package, spend money |

<!-- calibrate-me: tier boundary definitions above are factory defaults; adjust
     if your workflow treats push (tier 3) as routine or if "comment on PR"
     warrants escalation in your context. -->

## Action Policies

| Policy | Meaning |
|--------|---------|
| `autonomous` | Proceed without confirmation |
| `logged` | Proceed AND emit a `doa_decision` event (auditable; no human gate) |
| `escalate` | Pause and request explicit human authorisation before proceeding |

## Presets

### `cloud-high-trust`

Intended for cloud-tier models (Fable-class / Opus / Sonnet-class) with verified
identity and full reasoning capability. Factory default for these model tiers.

<!-- calibrate-me: every policy assignment below is a factory default pending
     local calibration against your project's risk tolerance. -->

| Action class | Policy |
|-------------|--------|
| read_only (tier 1) | autonomous |
| reversible (tier 2) | autonomous |
| external (tier 3) | logged |
| irreversible (tier 4) | escalate |

### `local-low-trust`

Intended for local/flash-class models (flash-tier, haiku-tier, local LLMs) where
the model may have limited context, weaker judgment, or lower alignment certainty.
Factory default for these model tiers.

<!-- calibrate-me: every policy assignment below is a factory default pending
     local calibration. -->

| Action class | Policy |
|-------------|--------|
| read_only (tier 1) | autonomous |
| reversible (tier 2) | escalate |
| external (tier 3) | escalate |
| irreversible (tier 4) | escalate |

## Model-Tier → Preset Mapping

The default mapping (used by `resolve-doa.sh` when no role override exists):

| Model tier keywords | Default preset |
|--------------------|----------------|
| `fable`, `opus`, `sonnet` | `cloud-high-trust` |
| `flash`, `haiku`, `local` | `local-low-trust` |

<!-- calibrate-me: the tier→preset mapping is a factory default. You can promote
     a specific role to cloud-high-trust even on a flash-class model if local
     calibration data supports it. -->

## Project Override

To override the preset for a specific (role, model-tier) combination, add rows to
this file in your project's `.claude/doa-config.md`:

```markdown
| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | cloud-high-trust |
| synthesizer | haiku | local-low-trust |
```

The `--role` + `--tier` pair is matched against override rows first; if no row matches,
the model-tier → preset default mapping applies.

## Fail-Closed Guarantee

Unknown role **or** unknown model tier → all four action classes resolve to `escalate`
with `source: "fail-closed-default"`. This is intentional: unrecognised inputs are
treated as maximum-risk until a human explicitly assigns a policy.

## Calibration Note

The task-tree engine (P5) will emit per-tier token spend into the calibration report.
Once ≥50 shadow-mode samples exist, revisit these factory defaults with local data.
See `scripts/calibration.sh report` for current sample count.
