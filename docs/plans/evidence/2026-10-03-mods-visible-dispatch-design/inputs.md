# Inputs for the autopilot mods / work-round review-page plan (collected by depth-0, 2026-10-03)

## Owner decisions so far
- Mods ship INSIDE the autopilot plugin (ease of use). Terminal first; desktop Code tab must degrade gracefully (colleagues use it).
- Wake-self is a toggle, default notify-only, idle-only, LOW priority (not the point of mods).
- Version: first mod = MINOR bump (depth-0 decision; add "new mod surface" to the CLAUDE.md semver table).
- Goal (owner words): integrate Mods; sync each project's in-round project/phase/result/visual-compare into a WEB PAGE the owner reviews; fix "dispatch status is invisible".
- Cross-project cockpit/gantt/scheduling/quota is NOT autopilot: it is a separate read-only fleet member (likely fuchikoma; name TBD, avoid "cockpit"/"fleet board"/"bridge"; hangar suggested "radar"). autopilot publishes a versioned per-project snapshot (`autopilot.progress/1`) — transport v1 = file + collector plugin, no proto change. `State.summary` is NOT visible fleet-wide today → idle/needs-owner states go into progress.json (needs_human + blockers).
- "dom-depth-0" = a portfolio replanner that runs only when a depth-0 declares "nothing left to run" (not when blocked on an owner decision). Later phase.

## Owner questions still open (carry as decisions with a proposed default)
1. Screenshot storage at milestone export: in git (size cap) vs `~/.autopilot/...` with path only.
2. Publish the review page as a claude.ai Artifact by default (shareable) or local-only by default.
3. Round boundary: one campaign = one round (astra leans this, ID-linked) vs each dev-flow phase.

## Research (all read-only)
- docs/plans/research/2026-10-03-claude-code-mods-integration.md — mods surfaces/capabilities (Claude Code 2.1.288, early access; types file, no public doc URL found)
- docs/plans/research/2026-10-03-wake-mechanism-design.md — event core + sinks + policy (wake low priority)
- docs/plans/research/2026-10-03-fleet-cockpit-boundary-study.md — boundary + progress/1 field table
- fable proposal: /tmp/claude-1000/-home-cookys-projects-autopilot/b6a5e0d8-0ed5-452c-851f-829091022bc1/scratchpad/proposal-work-round.md (work-round/1 projection via `autopilot status work-round`; P1 MVP from dispatch-status --list + manifest, §8)
- astra critique (fleet, 2026-10-03): identity only via existing IDs (root_run_id / campaign / run_id), never time/name guessing; execution status ≠ acceptance verdict (rc=0 is not done), unknown=null, every datum carries source + observed_at; live projection in runtime (tmpfs), export snapshot+evidence only at milestones (don't churn git); HTML may be a small bundle; P1 manual refresh, localhost optional; visual compare = comparability first (scene/viewport/browser/fixture/dirty flag), side-by-side/overlay first, pixel diff later; projector composes facts only, never decides transitions/verdicts.
- Owner's real review pages survey: /tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad/research/owner-review-pages.md — single static hand-written HTML served by `python -m http.server` on LAN; skeleton = one-sentence verdict/question on top → cards/tables/side-by-side images → evidence links (raw PNG, manifest, SHA256, commit); PASS/FAIL/PENDING colour chips; decision page pattern (B04: the one question on top, accept/reject/defer, "what this verdict does not do", correction disclosure; no buttons — verdict goes back by voice); per-stage index with status badges (8460); one-line callout + timeline (8790, manually updated — stale vs reality); URL `/<date>/<job>/index.html` per project root; missing: an index with per-status counts + latest link; risks: plain HTTP, no auth, LAN-exposed.
- Fleet survey (8 projects): NOBODY has a gantt (markdown + git log; mple2 prints ETA text from heartbeat JSON); NOBODY has a dispatch dashboard (wait for notifications / Monitor a status file) — fleet-wide pain; visual compare patterns: pinball Playwright fixed-camera screenshots + Python metrics (local contrast, Laplacian variance, over-exposure) + 3-up before/after/off PNG, HUD bbox non-overlap asserts, golden JSON; h3 ffmpeg 12 fps seam strips + agy critique (advisory, never a gate); PEACE golden data diff; review pages = LAN http.server single HTML / review mp4; owner actually uses direct links + HANDOFF.md.
