# Autopilot — Installation & Development

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

Install paths beyond the two-command Claude Code default (OpenCode, Codex, Antigravity, Grok Build, Windows), plus the contributor dev-mode workflow.

> **Claude Code users**: the 2-command install is in the [main README](../README.md#install). This page covers everything else.

---

### Unified dev setup entry

`scripts/dev-setup.sh` is the contributor entry point for checking or setting up local harness integration:

```bash
./scripts/dev-setup.sh                              # Claude Code dev mode (backward-compatible default)
./scripts/dev-setup.sh --check                      # read-only dashboard for Claude/Codex/OpenCode/agy/grok
./scripts/dev-setup.sh --check --harness codex      # read-only check for one harness
./scripts/dev-setup.sh --harness codex --install    # explicit mutating install
./scripts/dev-setup.sh --harness grok --install     # install this clone into Grok Build
```

Check mode is read-only for repo and user harness state except temporary diagnostic files. Missing optional CLIs are warnings; repo drift and known hazardous states, such as a symlinked agy plugin destination, fail the check. Non-Claude harness installs require `--install`; `--harness codex`, `--harness opencode`, `--harness agy`, `--harness grok`, and `--all` without `--install` report status only. Strict check mode avoids plugin-list probes that may update harness caches; set `AUTOPILOT_DEV_SETUP_ACTIVE_CLI_CHECKS=1` when you explicitly want those active CLI probes.

---

### OpenCode V2 extension

OpenCode support follows the core + extension layout:

- host-neutral hook logic: `src/hooks/`
- canonical harness package: `platforms/opencode/plugin/`
- generated repo-local consumer: `.opencode/plugin-package/`
- project agents/config: `.opencode/opencode.json`

```bash
git clone https://github.com/cookys/autopilot.git
cd autopilot
./scripts/install-opencode.sh
bash hooks/tests/opencode-v2-plugin.test.sh
opencode2
```

The installer configures shared skills, installs the pinned V2 extension dependency,
and synchronizes the generated consumer payload. OpenCode V2's plugin API is beta;
rerun the smoke test after every upgrade. The exact verified nightly and unsupported
capabilities are recorded in `src/harness/capabilities/opencode.json`. Installed 1.17.15
and an isolated 1.18.11 probe both truncated `debug skill` discovery JSON near 65,536 bytes,
so that completeness check remains unavailable rather than being promoted from version alone.

### Codex (OpenAI)

Two Codex paths are supported:

- **Per-repo skills**: same `.agents/skills/` symlink as OpenCode. Codex's skill scanner walks up from cwd to find `<repo>/.agents/skills/`. No further setup needed when you run Codex inside this repo.
- **Local Codex plugin package**: `platforms/codex/plugin/` exposes the generated skills/support payload plus one production Codex-native `PostCompact` recovery hook, with a repo-local marketplace at `platforms/codex/.agents/plugins/marketplace.json`.

```bash
./scripts/setup-symlinks.sh
./scripts/sync-codex-plugin-skills.sh
codex plugin marketplace add ./platforms/codex
codex plugin list --marketplace autopilot-local --available
codex plugin add autopilot@autopilot-local
```

Contributor shortcut:

```bash
./scripts/dev-setup.sh --check --harness codex
./scripts/dev-setup.sh --harness codex --install
```

The Codex package does **not** load the Claude Code hook bundle, apps, or MCP servers. Its manifest
declares `skills: "./skills/"` and `hooks: "./hooks/hooks.json"`; that hook manifest contains exactly
one `PostCompact` registration with matcher `manual|auto`. The Codex adapter translates the official
payload into Autopilot's existing fail-closed reconciliation authority and blocks continuation when
identity or reconciliation fails. This is an exact Codex-native recovery boundary, not a claim that
Claude hook events or defaults transfer to Codex. The generated payload also includes linked support
files (`bin/`, `src/`, `scripts/`, `references/`, templates, selected docs, and `hooks/_shared`) so
skill links and engine CLI commands resolve after install. Run engine commands from the target
repository, or pass `--cwd /path/to/repo` to `engine implement-review`.

Codex hook maintenance still uses the separate warning-only `platforms/codex/hook-probe` package.
On codex-cli 0.146.0, the probe recorded real `PreCompact`/`PostCompact` pairs for explicit
`/compact` and threshold compaction. The default package's production receipt then proved manual and
threshold-auto reconciliation-before-effect plus the broken-adapter failure boundary. The probe
remains disposable telemetry; it is not the production hook.

For global loose-skill availability across repos without installing the plugin package, see `platforms/codex/config.toml.example`.

### Antigravity (`agy`)

`agy` imports autopilot as a Claude Code-source plugin (verified against agy 1.0.1 — there is no loose skills-dir scan; the older `~/.gemini/antigravity/skills/` approach was superseded).

```bash
./scripts/install-antigravity.sh                     # agy plugin validate → install → list
agy plugin list | grep autopilot                     # verify it's registered
# remove with: agy plugin uninstall autopilot
```

Contributor shortcut:

```bash
./scripts/dev-setup.sh --check --harness agy
./scripts/dev-setup.sh --harness agy --install       # delegates to install-antigravity.sh
```

The D1 capability probe verified agy 1.1.10 native JSON output with separate response and numeric
input/output/thinking/cache/total usage fields. Production transport selects the tiered model slug;
roster effort remains metadata and is validated separately from the agy execution argv.

### Grok Build (host vs runner)

Grok appears in autopilot in **two different roles**. Do not conflate them:

| Role | Meaning | Status |
|------|---------|--------|
| **Host** | You run sessions *in* Grok Build with autopilot skills/agents loaded | Supported via Grok's native plugin install (skills + agents discovery verified; hooks registered but runtime parity with Claude Code not claimed) |
| **Runner** | Claude Code (or another host) shells out to `grok` for hetero review/implement | Already covered under [Heterogeneous engine credentials](#heterogeneous-engine-credentials-optional--unlocks-the-strong-reviewimpl-roster) — OAuth `grok login`, no token file |

#### Install as a Grok host plugin

The **repo root** is a valid Grok plugin payload (`plugin.json` + `skills/` + `agents/` + `hooks/`). There is no separate `platforms/grok/` package.

```bash
# From a local clone (recommended while tracking develop)
grok plugin install /path/to/autopilot --trust

# Or from GitHub (public clone URL)
grok plugin install cookys/autopilot --trust

# Verify
grok plugin list
grok plugin details autopilot
grok inspect          # expect 28 skills under plugin: autopilot + autopilot:* agents + hooks entry
```

Contributor shortcut:

```bash
./scripts/dev-setup.sh --check --harness grok
./scripts/dev-setup.sh --harness grok --install
```

#### Skills-only alternative (no plugin install)

If you only want the SKILL.md packages without registering the plugin (no agents/hooks bundle):

```toml
# ~/.grok/config.toml
[skills]
paths = ["/path/to/autopilot/skills"]
```

Working **inside this clone** also surfaces skills via `.agents/skills` as project skills; that does not install autopilot for other repos.

#### What is verified (2026-08-04, grok 0.2.118)

- **28 skills** discoverable as `plugin: autopilot` (`dev-flow`, `quality-pipeline`, `l3`–`l6`, …)
- **3 methodology agents** as `autopilot:debugger`, `autopilot:planner`, `autopilot:reviewer`
- **Hooks** file registered (`grok inspect` shows `file plugin: autopilot`)
- **Headless JSON usage** for the exact `grok-4.5` / high-effort runner tuple

#### Known limits (honest)

- **Not Claude Code parity.** Slash namespaces, hook event coverage, `${CLAUDE_PLUGIN_ROOT}`-style expansion, and opt-in gates that assume Claude's settings injection may behave differently or not at all.
- **Hooks = discovery partial.** Registration is verified; `SessionEnd` firing with authoritative usage and blocking-gate strength on the Grok host are **not** claimed. See `src/harness/capabilities/grok.json`.
- **Update after `git pull`.** Local installs record `source_path`. Prefer `grok plugin update` and re-check with `grok inspect`; if skills look stale, re-run `grok plugin install <path> --trust`.
- **Uninstall:** `grok plugin uninstall autopilot` (confirm flag if prompted).

Capability matrix: [`src/harness/capabilities/grok.json`](../src/harness/capabilities/grok.json).

### Windows

Repo-tracked symlinks (`.agents/skills/`) require Developer Mode + `core.symlinks=true` **before** cloning:

```powershell
git config --global core.symlinks true               # one-time, system-wide
# Enable Developer Mode: Settings -> Privacy & security -> For developers
git clone https://github.com/cookys/autopilot.git
cd autopilot
.\scripts\setup-symlinks.ps1
```

Without these, symlinks materialise as plain text files containing the target path — `setup-symlinks.ps1` will detect and try to repair, but Developer Mode is still required for the repair.

### Cross-platform pre-commit gate

```bash
./scripts/install-hooks.sh                           # one-time per clone
```

Activates `.githooks/pre-commit` which runs `sync-version.js --check` and `sync-agent-bodies.sh --check` to catch version-manifest drift and agent-body drift before they reach the remote.

---

## Updating

**First pick your path** — the right method depends on whether you keep a local clone:

| You have… | Update with | Notes |
|-----------|-------------|-------|
| **a local clone** (dev mode, [below](#development)) | `git pull --ff-only` (shell), then `/reload-plugins` (Claude Code) | **Recommended for tracking latest** — no reinstall, pulls apply instantly |
| **release / marketplace only** (no clone) | clean reinstall ([below](#release--marketplace-reinstall-no-clone)) | `/plugin update` may not detect new versions |
| **Codex local package** | `git pull --ff-only`, then `./scripts/sync-codex-plugin-skills.sh`, `codex plugin remove autopilot@autopilot-local`, and `codex plugin add autopilot@autopilot-local` | The repo-local marketplace points at your clone; reinstall refreshes Codex's plugin cache |
| **Grok Build host plugin** | `git pull --ff-only` (if local clone), then `grok plugin update` and `grok inspect`; re-run `grok plugin install <path> --trust` if skills look stale | Local installs record `source_path`; do not assume Claude `/reload-plugins` applies |

> **Why not just `/plugin update`?** Claude Code pins a plugin to its install-time commit, and `/plugin update` often does **not** detect new versions ([anthropics/claude-code#31462](https://github.com/anthropics/claude-code/issues/31462)). Dev mode sidesteps this entirely: your clone *is* the plugin, so `git pull --ff-only` (then `/reload-plugins` in Claude Code) is the whole update. If you want to follow autopilot closely, set up [dev mode](#development) once and updating becomes a one-liner.

### Release / marketplace reinstall (no clone)

Until #31462 is fixed, the reliable way to pull a new release without a clone is a clean reinstall:

```bash
/plugin uninstall autopilot@autopilot
/plugin marketplace remove autopilot
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

### Dev-mode update (recommended for latest)

After the one-time [dev-mode setup](#development):

```bash
cd ~/projects/autopilot && git pull --ff-only   # shell; then run /reload-plugins in Claude Code
# or: ./scripts/dev-update.sh                    # pulls + prints the /reload-plugins reminder
```

(`/reload-plugins` is a Claude Code slash command, not a shell command — run it in the Claude session after the pull.)

> ⚠️ **Three layers must stay current, not two.** Dev mode = ① the dev cache symlink + ② the registry `installPath` + ③ **the Claude Code marketplace clone** (`~/.claude/plugins/marketplaces/autopilot`). Session start resolves the plugin *version* from ③'s catalog — a stale marketplace clone silently loads an old skill set even when ① and ② are perfect (observed 2026-07-17: a clone frozen at v2.17.2 fed 5-week-old skills to a session on a v2.32.46 repo, zero errors shown). `scripts/dev-update.sh` now refreshes ③ automatically, and `scripts/dev-setup.sh --check` warns when ③'s version differs from the repo's.

The `version-drift-check` hook gives a one-line nudge at session start when your clone has fallen behind its git upstream. As of v2.26.1 it is wired default-on in the plugin's `hooks.json` (silent for everyone except a dev clone behind upstream), so **dev-mode users get it automatically — no settings change needed**. (It moved out of `settings.example.json` because `${CLAUDE_PLUGIN_ROOT}` does not expand in a user's `settings.json`.)

To enable the **session-handoff** snapshot feature (write a machine handoff on `/clear`/logout and auto-inject it into the next session), set `~/.autopilot/config.json` to `{"handoff_inject": true}` (or `export AUTOPILOT_HANDOFF_INJECT=1`). Both the writer and reader are wired default-on in `hooks.json` but stay inert until this single switch is set.

### Enabling opt-in hooks

The 15 **opt-in** hooks (Tier B — branch-protection, commit-secret-scan, large-file-warner, config-protection, mcp-health, accumulator, test-runner, design-quality, cost-tracker, session-summary, check-console, batch-format, dispatch-model-guard, context-budget, orchestrator-edit-gate) are wired in the plugin's `hooks.json` but **default-OFF**. As of v2.26.2 you enable them via `~/.autopilot/config.json` — **not** by copying anything into your `settings.json` (where `${CLAUDE_PLUGIN_ROOT}` would not expand):

```json
{ "hooks": { "branch-protection": true, "commit-secret-scan": true, "test-runner": true } }
```

A per-hook env override also works: `AUTOPILOT_HOOK_<STEM>=1` (stem upper-cased, `-`→`_`, e.g. `AUTOPILOT_HOOK_BRANCH_PROTECTION=1`). The authoritative list is [`hooks/opt-in-manifest.json`](../hooks/opt-in-manifest.json); per-hook behaviour is documented in [`hooks/README.md`](../hooks/README.md) (Tier B).

**Enable vs. configure — two separate mechanisms:**

| Concern | Where | Example |
|---------|-------|---------|
| **Enable** a hook (does it run at all) | `~/.autopilot/config.json` `hooks.<stem>` (this is the v2.26.2 gate) | `{"hooks":{"branch-protection":true}}` |
| **Configure** an enabled hook's behaviour | Claude `settings.json` `autopilot.*` (Claude Code injects these as `AUTOPILOT_*` env vars into the hook) — or set the env var directly | `autopilot.protectedBranches`, `autopilot.costTracker` |

So a hook like `branch-protection` is **enabled** in `~/.autopilot/config.json` and its protected-branch regex is **configured** via `autopilot.protectedBranches` in `settings.json` (the `autopilot.*` block is still shown in `settings.example.json`). Enabling without configuring is fine — each configurable hook has a safe default (e.g. `^(main|master)$`).

---

## Capability profiles and optional local endpoints

Capability-adaptive guidance is one project setting with a task-scoped override. Set
`governance.guidance_profile` to `guided`, `adaptive`, or `autonomous` in
`.claude/owner-kernel-governance.json`; omitting it resolves to `guided`. A task intake can request
a different profile without editing the project file. Admission still happens by exact role,
scope, model/runner configuration, and deployment identity before any profile is selected.

The supporting operator surfaces are:

```bash
# Fresh, role-specific qualification. Telemetry alone does not admit a session.
scripts/engine-qualify.sh reviewer <identity-and-scope-options> --panel-cmd '<trusted command>'
scripts/engine-qualify.sh owner <identity-and-scope-options> --panel-cmd '<trusted command>'

# Optional user-local Artificial Analysis prior for implementer/explorer discovery.
ARTIFICIAL_ANALYSIS_API_KEY=... node scripts/import-aa-capabilities.js refresh

# Optional local OpenAI-compatible endpoint inventory and exact-identity probe.
node scripts/probe-local-engine.js list
node scripts/probe-local-engine.js probe --endpoint <id>

# Raw author/reviewer transport; this is not an agentic repository runner.
node scripts/dispatch-local-openai.js run --endpoint <id> --role author \
  --prompt-file <path> --envelope <task-authority-envelope.json> --risk low

# Advisory only: the file CLI cannot recreate live verifier capabilities.
node scripts/evaluate-profile-cutover.js evaluate --input <snapshot.json>
```

The local roster defaults to `~/.autopilot/local-engines.json`. It is a non-secret, regular
mode-600 JSON file; credentials remain in the protected endpoint environment described below.
Non-loopback endpoints require an authenticated HTTPS `credential_endpoint`. Supported adapter
labels are `autopilot-contract`, `generic-openai`, and `ollama`, but a label is not qualification:
the current release passed the fake `autopilot-contract` suite and observed no configured live
runtime, so it publishes neither a live local role row nor an agentic local runner.

## Heterogeneous engine credentials (optional — unlocks the strong review/impl roster)

Autopilot works fully standalone on Claude alone. But its **decorrelated** review-and-implement
pipeline (`/l5` / `/l6`, `dispatch-review.sh`, the depth-0 qc panel) gets materially stronger when
it can reach a **second engine family** — a bug your generator and its same-family reviewer jointly
miss is caught by a different vendor ([PoLL](https://arxiv.org/abs/2404.18796)). Filling in the
credentials below is what turns on:

- a **cross-family qc panel** (an OpenAI/Google/xAI/MiniMax reviewer voting alongside Claude), and
- a **heterogeneous implementer** for cost-arbitrage or a decorrelated second opinion.

### Recommended: subscription plan ≻ API key

Reach for these **in order** — a flat-rate subscription you already pay for beats a metered API key
whose cost is unbounded per run:

1. **OAuth-login CLI runners — `codex` / `agy` / `grok` / `qoderclicn`.** These sign in with your own
   ChatGPT / Gemini / Grok / QoderCN **subscription** and need **no env token** at all — autopilot just shells
   out to the CLI. If you have one of these subscriptions, this is the cheapest and simplest path;
   set `implementer_runner` / `reviewer_runner` in `.claude/review-loop-config.md` and you're done.
   `qoderclicn` is explicit-only until its implementer/reviewer scorecard qualification promotes it.
2. **A coding-plan subscription token — GLM / MiniMax (via `cc-shim` / `anthropic-compatible`).**
   For providers reached over an Anthropic-compatible endpoint, prefer their **flat-rate coding-plan
   subscription** token (e.g. the GLM Coding Plan) over a metered key. Put it in the credential file
   below.
3. **A metered API key — last resort.** Same file, same slot; just be aware the cost scales with
   usage (an adversarial loop can run many rounds).

### The one canonical credential home: `~/.autopilot/endpoints.env`

There is a **single** place for endpoint-token credentials — a machine-local, mode-**600** file
(never inside any repo, so it can't leak through git). It is loaded automatically by
`dispatch-hetero.sh` / `dispatch-review.sh` / `dispatch-anthropic-review.js` at startup.

```bash
# scaffold a mode-600 commented stub from the tracked template (idempotent — never clobbers):
scripts/load-endpoints-env.sh --init
# …or copy the template by hand:
mkdir -p ~/.autopilot && cp scripts/endpoints.env.example ~/.autopilot/endpoints.env && chmod 600 ~/.autopilot/endpoints.env
```

The canonical template is tracked at [`scripts/endpoints.env.example`](../scripts/endpoints.env.example)
(what `--init` copies). Fill it with `AUTOPILOT_ENDPOINT_<NAME>_URL` + `_TOKEN` pairs (`<NAME>` is
`[A-Za-z0-9_]`, your own logical label — `glm`, `minimax`, `local_llama`, …):

```sh
# ~/.autopilot/endpoints.env   (mode 600 — never commit; values are examples)
# --- GLM (Zhipu) coding plan, Anthropic-compatible ---
AUTOPILOT_ENDPOINT_GLM_URL=https://api.z.ai/api/anthropic
AUTOPILOT_ENDPOINT_GLM_TOKEN=<your GLM coding-plan token>
# --- MiniMax intl, Anthropic-compatible ---
AUTOPILOT_ENDPOINT_MINIMAX_URL=https://api.minimax.io/anthropic
AUTOPILOT_ENDPOINT_MINIMAX_TOKEN=<your MiniMax token>
```

The file is parsed safely — **not** sourced/executed: only lines of the exact form
`[export ]NAME=VALUE` with an allowlisted `NAME` are honored, symlinks and group/other-writable
files are refused, an already-set env var always wins, and a token value is **never** printed. A
one-off `AUTOPILOT_ENDPOINT_GLM_TOKEN=… <cmd>` still overrides the file for that run.
(`${AUTOPILOT_ENDPOINTS_ENV}` overrides the path if you keep it elsewhere.)

> **OAuth runners need nothing here.** `codex` / `agy` / `grok` / `qoderclicn` authenticate through their own CLI
> login — leave them out of this file entirely. `qoderclicn` still has to be selected explicitly until calibrated.

### Wire it declaratively (no hand-typed flags)

Name the endpoint once in `.claude/review-loop-config.md` and `/l5` / `/l6` pass it through
automatically (no `--endpoint` on the command line):

```
- reviewer_runner: cc-shim
- reviewer_endpoint: glm            # → dispatch-review.sh --endpoint glm
- implementer_runner: cc-shim
- implementer_endpoint: minimax     # → dispatch-hetero.sh --endpoint minimax
```

Leave a `*_endpoint` empty to use the raw `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` env instead
(byte-identical to the pre-endpoint behaviour). See
[`project-config-template/review-loop-config.md`](../project-config-template/review-loop-config.md)
for the full roster and the per-provider endpoint/model table.

### by-repo vs by-user — a deliberate split

Credentials are layered **on purpose**, and the split is not the same as autopilot's other
`.claude/*-config.md` resolvers:

| Layer | Holds | Scope | Where | Committable? |
|-------|-------|-------|-------|--------------|
| **Selection** (by-repo) | *which* endpoint — just the **name** (`glm`), non-secret | per-project | `.claude/review-loop-config.md` `reviewer_endpoint`/`implementer_endpoint` | ✅ yes — share it |
| **Secret** (by-user) | the name → real `URL` + `TOKEN` | per-machine/user | `~/.autopilot/endpoints.env` | ❌ never in a repo |

So a repo commits *"use `glm`"* and each developer's machine maps `glm` to their own token — the
config is shareable, the secret stays private. **The secret layer is by-user ONLY, never by-repo**:
autopilot does **not** auto-discover a `$PWD/.claude/endpoints.env` (unlike the non-secret config
resolvers' `cwd → repo → template` cascade), because a repo-local secret file is a commit-a-token
footgun. Within loading, an **already-set env var wins** over the file (so a one-off
`AUTOPILOT_ENDPOINT_X_TOKEN=… <cmd>` overrides it).

**Per-repo tokens — the opt-in overlay.** If you want the *same* committed name (`glm`) to resolve
to a *different* token per repo (a work key here, a personal key there), opt into the overlay:
credentials in `~/.autopilot/endpoints.d/<repo-key>.env` are layered **over** the base for that repo
only. Precedence is **process env > overlay > base**. The overlay files **still live under
`~/.autopilot/`** (never in the repo — no commit-a-token footgun), and the layer is a pure no-op
until you create the `endpoints.d/` directory. `<repo-key>` is your normalized git remote (so it's
stable across clones); the CLI writes it for you (`endpoints set … --repo`).

### The `endpoints` CLI

`autopilot endpoints` is the setup + inspection surface — friendlier than hand-editing the dotfile,
and **agent-legible** (an agent can read the non-secret state to help you set up or answer "why
isn't `glm` resolving here?"). Tokens are **never printed** and **never read from argv** (only STDIN):

```bash
autopilot endpoints init                                   # scaffold the base file from the template
printf '%s' "$TOKEN" | autopilot endpoints set glm \
    --url https://api.z.ai/api/anthropic --token-stdin      # write to the by-user base
printf '%s' "$WORK_TOKEN" | autopilot endpoints set glm \
    --url https://api.z.ai/api/anthropic --token-stdin --repo   # …or this repo's overlay
autopilot endpoints list --json                            # all defined endpoints (url/token present, layer)
autopilot endpoints which --json                           # for THIS repo: what reviewer/implementer select + resolve
autopilot endpoints test glm                               # sends one tiny live request to verify auth + latency (exit 0/1/1/2)
autopilot endpoints doctor                                 # perms + unresolved-endpoint diagnosis (exit 1 if unhealthy)
```

(Run via `node bin/autopilot.js endpoints …` from a dev clone.) `which`/`list`/`doctor`/`test` `--json`
give an agent a token-redacted window into the resolved state.

The `test` subcommand sends a single, minimal request with `max_tokens: 1` to verify endpoint authentication and logs the latency, without printing the token or response details.

> [!NOTE]
> If a repository has no git remote configured, the per-repo overlay fallback keys to the checkout path's checksum (reported as `repo_key_source: "path-fallback"`). Moving or renaming the checkout directory will change this key, causing the overlay settings to stop applying. For remote-tracked checkouts, the key is derived from the remote origin url and is stable across renames or new clones (`repo_key_source: "remote"`). Warning notices will be printed if you configure or query overlays in a remote-less checkout.

---

## Development

To contribute or customize skills locally:

```bash
# 1. Install once via the normal flow (required)
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot

# 2. Clone and switch to dev mode
git clone git@github.com:cookys/autopilot.git ~/projects/autopilot
cd ~/projects/autopilot
./scripts/dev-setup.sh
```

Dev mode symlinks the plugin cache to your local clone. Edits to `skills/` take effect immediately after `/reload-plugins` — no reinstall needed.

Push/pull works normally across machines. Each machine runs step 1 once, then `dev-setup.sh` once. To update later: `git pull --ff-only` then `/reload-plugins` (or `./scripts/dev-update.sh`) — see [Updating](#updating).

> **Note:** Dev mode sets `version: "dev"` in the plugin registry. To revert to the release version, run `/plugin update autopilot@autopilot`.

### Cache directory layout

The plugin cache lives at `~/.claude/plugins/cache/autopilot/autopilot/`. Each entry is either a versioned directory (snapshot from install/update) or a symlink to a local clone:

```
~/.claude/plugins/cache/autopilot/autopilot/
├── develop -> ~/projects/autopilot   # symlink — live edits, /reload-plugins to sync
└── 2.0.0                             # snapshot — created by install or reload
```

**Symlink naming**: The cache directory name does not need to be a semver string. You can use semantic names like `develop`, `nightly`, or `local` to distinguish dev symlinks from release snapshots. Claude Code resolves the symlink and reads `plugin.json` inside for the actual version.

**Stale cache cleanup**: After upgrading, old version directories may linger. Remove them manually:

```bash
rm -rf ~/.claude/plugins/cache/autopilot/autopilot/<old-version>
```

### Branch workflow

| Branch | Purpose | `plugin.json` version |
|--------|---------|----------------------|
| `main` | Stable releases, tagged (e.g. `v2.7.1`) | Matches latest tag |
| `develop` | Next version development | Next major/minor (e.g. `2.26.0`) |

When developing: checkout `develop`, symlink points to it, `/reload-plugins` picks up changes. Remember to bump `plugin.json` version before tagging a release.
