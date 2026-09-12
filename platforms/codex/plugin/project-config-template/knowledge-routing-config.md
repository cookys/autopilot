# knowledge-routing-config

Where durable content lands in **this** project. Read by `scripts/resolve-knowledge-routing.sh`,
which the `handoff` (step 2.5 / 3.5), `learn` and `distill` skills call instead of naming paths.

The policy — *what* counts as durable and *which* class goes to which role — is
[`references/knowledge-routing.md`](../references/knowledge-routing.md). This file answers only
**where each role lives here**. Unset keys fall back to the defaults below; a project that is happy
with the defaults needs no copy of this file at all.

## Roles

- memory_dir: ~/.claude/projects/<slug>/memory/
- knowledge_dir: .claude/knowledge/
- discipline_target: CLAUDE.md
- backlog_path: auto
- plans_dir: auto

## What each role holds

| Key | Holds | Notes |
|---|---|---|
| `memory_dir` | Anything carrying a host/fleet/client identifier — machine-local by design | Harness-owned, not repo-owned. `<slug>` is derived from the repo path; leave the literal `<slug>` in place. |
| `knowledge_dir` | A publishable, generalizable fact or gotcha | The resolver reports `knowledge_gitignored`. When true, a write is not saved until `git add -f` + commit — see the routing doc §4. When false, the ordinary commit path applies and `-f` is wrong. |
| `discipline_target` | A rule future sessions must **follow**, not a fact they look up | Defaults to `CLAUDE.md`, which is what that file is for. A repo that ships its own skills may point this at a reference directory instead (autopilot itself uses `references/`). |
| `backlog_path` | A real problem you are deliberately not fixing now | `auto` asks `scripts/project-detect.js` (`project_paths.backlog`). Set a literal path to override; set `none` if this project tracks deferred work outside the repo, and the resolver will say so rather than inventing a file. |
| `plans_dir` | A bounded piece of work with a shape, not yet done | `auto` asks `project-detect.js` (`project_paths.plans_dir`). Same `none` semantics. |

`none` is a real answer. A role that does not exist here should say so, because the failure mode
this config exists to prevent is an agent inventing a path when the documented one is absent.
