# Main-checkout boundary: accepted residuals of an accident guard that is not a sandbox

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: fires only if the boundary is ever asked to be a sandbox — i.e. an adversarial worker becomes a threat model this repo adopts. Today it is not (`references/blind-dispatch.md`; v2.36.32's own contract says "accident guard, not a sandbox").
- **Context**: v2.36.32's detection layer fingerprints every ref, HEAD, symbolic-ref target, staged/unstaged diff content, and a size+mtime+type+link-target walk of every entry outside `.git`. Six review rounds (codex gpt-5.6-sol @ max) each found a real gap and each was fixed by measurement; the last round's remaining finding is the one deliberately NOT fixed: **a same-length in-place overwrite of an ignored or untracked file with its mtime restored afterwards** leaves every fingerprinted field equal. Closing it means hashing the content of every ignored file (node_modules, .venv) twice per dispatch, or excluding ignored trees from the guarantee. Neither is worth it for an accident guard — no accident restores an mtime.
- **Also accepted**: `env -i` or an explicit `unset GIT_ALLOW_PROTOCOL` inside the worker removes the prevention layer; detection still sees any local effect but a push that leaves no local trace (a tag already present, pushed elsewhere) is invisible. Same reasoning: that is evasion, not an accident.
- **Effort**: L if ever adopted (content hashing with a cap and a fail-closed UNVERIFIABLE path).
- **Source**: v2.36.32 review round 6, 2026-09-13, adjudicated at depth 0 by re-derivation.

