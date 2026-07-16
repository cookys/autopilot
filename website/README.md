# Autopilot product website

Public **VitePress** site for [cookys/autopilot](https://github.com/cookys/autopilot).

## Placement decision

| | |
|--|--|
| **Location** | Same monorepo: `website/` |
| **Plugin payload** | **Not included** — never add this tree to `.claude-plugin`, Codex `sync-codex-plugin-skills.sh` DIRS, or skill packages |
| **Content SSOT** | Root `docs/`, `README*`, `hooks/README.md`, `references/`. Site **curates**; repository wins on conflict |
| **Plan** | [`docs/plans/2026-07-16-product-website.md`](../docs/plans/2026-07-16-product-website.md) |
| **Narrative freeze** | [`NARRATIVE.md`](NARRATIVE.md) · [`TA.md`](TA.md) · [`WEEKLY.md`](WEEKLY.md) |
| **Growth / IA panel** | [`GROWTH-PANEL.md`](GROWTH-PANEL.md) — codex-sol / agy / MiniMax / glm; not auto-shipped |
| **Engineer panel R2** | [`PANEL-ENG.md`](PANEL-ENG.md) — state-machine accuracy vs /l5 SSOT |

## Develop

```bash
cd website
npm install
npm run sync-assets   # copy brand SVGs from docs/assets
npm run dev           # http://localhost:5173/autopilot/
```

`base` is `/autopilot/` (GitHub project Pages). For a root-domain deploy, set `VITEPRESS_BASE=/` when building.

## Build

```bash
cd website
npm ci
npm run build         # output: website/.vitepress/dist
npm run preview
```

Version string in the nav/footer is read at build time from `../.claude-plugin/plugin.json`.

## Deploy

GitHub Actions: [`.github/workflows/website.yml`](../.github/workflows/website.yml)  
Expected URL after Pages is enabled: `https://cookys.github.io/autopilot/`

## Do not put on this site

- Full BACKLOG / plans / project `_archive`
- Secrets or endpoint tokens
- Live dispatch dashboards (use local `autopilot status`)
