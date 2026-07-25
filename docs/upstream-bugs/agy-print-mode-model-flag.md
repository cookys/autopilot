# agy print-mode `--model` — findings (2026-07-23)

**Status: NOT a confirmed upstream bug on the currently installed binary.**
This doc records a controlled investigation that *contradicts* an earlier internal
spike. Do not file upstream without re-reproducing on the exact target build.

- Binary: `agy` (Antigravity CLI) `--version` → **1.1.5**, `~/.local/bin/agy`
- Host: this machine, 2026-07-23
- Persisted config: `~/.gemini/antigravity-cli/settings.json` `"model": "Gemini 3.5 Flash (High)"`

## The claim under test (from an earlier internal spike)

> agy 1.1.5's `-p --model <X>` flag is *silently ignored*; the only switch that
> takes effect is the persisted `settings.json` `"model"` field. A bogus `--model`
> exits 0 without error. (Attributed to a 1.1.5 change that "let `-p` honor
> persisted settings.json", shadowing the flag.)

## What actually reproduces (controlled matrix)

Persisted `settings.json` `"model"` held **constant** at `Gemini 3.5 Flash (High)`
for every row; the ONLY variable is the `--model` argument. Each call is
`agy -p "Output ONLY your exact model name and vendor." [--model <arg>]
--dangerously-skip-permissions --print-timeout 2m`, captured through a
`script -qec` pseudo-TTY (agy drops stdout under a plain pipe; #76/#408).

| `--model` argument | exit | agy self-reports |
|---|---|---|
| *(omitted)* | 0 | Google (Gemini 3.5 — the persisted model) |
| `Gemini 3.6 Flash (High)` (display-name) | 0 | **Gemini 3.6 Flash (Google DeepMind)** |
| `Claude Opus 4.6 (Thinking)` (display-name) | 0 | **Anthropic (Claude Opus 4.6)** |
| `claude-opus-4-6-thinking` (slug) | 0 | **Anthropic (Claude Opus 4.6)** |
| `gpt-oss-120b` (slug) | 0 | **GPT-OSS 120B — OpenAI** |

`settings.json` `"model"` was **unchanged** before/after every call.

**Conclusion:** on this 1.1.5 build, `-p --model` **is honored** and overrides the
persisted model, for both display-names and slugs. The spike's central premise
does not hold here. The most likely explanation is that the spike ran a different,
since-superseded agy build (Antigravity CLI auto-updates; the `--version` string
did not necessarily bump). agy is also *known* to have regressed `-p` toward
persisted settings before — i.e. this failure mode is real historically but is not
currently active.

### Corroborating evidence beyond self-report

Model **self-identification is not authoritative** (a model can misreport its own
name/version). Two non-self-report signals back the conclusion:

1. **Cross-vendor self-ID (suggestive, NOT authoritative).** `--model
   gpt-oss-120b` → the reply identifies as *OpenAI GPT-OSS*; `--model
   claude-opus-4-6-thinking` → *Anthropic Claude*. A model can in principle claim
   another vendor coherently, so this alone does not *prove* routing — treat it as
   a supporting hint only, not evidence the flag is honored.
2. **Behavioral capability delta (the authoritative basis for pinning 3.6).** On the
   `evals/known-bad` corpus via the qualification harness, `--model "Gemini 3.6
   Flash (High)"` scored **12/13 (2-pass stable)** and `--model "Gemini 3.5 Flash
   (High)"` scored **11/13** on the *same* diffs — a reproducible difference that
   only exists if the two `--model` strings route to *different* models. This
   behavioral delta, not the self-report, is what justifies the QC-slot pin.

**Known limitation:** agy print mode does not expose an authoritative resolved
model-version string (`--log-file` produced no usable metadata here). Exact
version attribution ("3.6" vs some other Gemini) therefore rests on the
capability delta + self-ID, not an API/telemetry field. If agy later surfaces a
resolved-model field, re-verify the pin against it.

## Secondary observation — bogus model in print mode (worth an upstream issue)

`--model totally-bogus-model-xyz-000` (persisted 3.5, print mode `-p`):
- exit code **1**
- stdout is an **interactive-style model picker list** (`Claude Sonnet 4.6
  (Thinking)`, `Claude Opus 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`, …), not a
  clean error message.

The 1.1.2 changelog claims print mode should **hard-fail** on an unknown model.
Instead of a single-line error + non-zero exit, print mode degrades to what looks
like an interactive picker rendered to stdout. In a non-interactive `-p` context
(the whole point of print mode) this is a UX/contract bug: print mode should never
emit an interactive selector. This *is* a defensible upstream report — minimal
repro:

```bash
cd "$(mktemp -d)"
agy -p "hi" --model "totally-bogus-model-xyz-000" --dangerously-skip-permissions --print-timeout 1m
# observed: exit 1, prints a model list to stdout (picker), not a clean hard-fail error
```

Expected (per 1.1.2 changelog): print mode exits non-zero with a concise
"unknown model: …" diagnostic and no interactive UI.

## Impact on autopilot

- The reviewer gemini slot upgrade to 3.6 is achieved by the **working `--model`
  flag** alone (`dispatch-review.sh --runner agy --model "Gemini 3.6 Flash (High)"`).
  No wrapper is required on this build.
- No persisted-model swap wrapper ships. A wrapper was considered as an opt-in
  guard against recurrence of the historical `-p`-ignores-`--model` regression,
  but mutating shared `~/.gemini` settings adds a
  SIGKILL-leaves-wrong-model failure mode that the working flag does not have.
  Reproduce the regression first; do not assume a fallback wrapper exists.
