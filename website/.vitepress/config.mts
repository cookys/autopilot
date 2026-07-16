import { defineConfig } from 'vitepress'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../.claude-plugin/plugin.json'), 'utf8')
)
const VERSION = pluginJson.version as string

const repo = 'https://github.com/cookys/autopilot'

export default defineConfig({
  title: 'Autopilot',
  description:
    'CEO altitude for everyday engineers: diverge for fuller decisions, converge when a run drifts, and keep humans out of the loop. Claude Code is home; portable paths for Codex, OpenCode, and agy.',
  // GitHub project Pages: https://cookys.github.io/autopilot/
  base: process.env.VITEPRESS_BASE || '/autopilot/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  sitemap: { hostname: 'https://cookys.github.io/autopilot' },
  // Mission-control surface: dark is designed primary; light is a cold slate twin.
  // appearance: 'dark' = default dark (does NOT follow system preference; use true for that).
  appearance: 'dark',

  // Working notes / panel dumps live under website/ for authors — never ship as public pages.
  // Product copy lives in Vue components; md shells are thin. Local search would only index
  // these notes if enabled — so search stays off this pass.
  srcExclude: [
    'NARRATIVE.md',
    'WEEKLY.md',
    'TA.md',
    'README.md',
    'LOOP-REVIEW.md',
    'SITE-LOOP-REVIEW.md',
    '**/DAY1-UX-PANEL.md',
    '**/LANDING-UX-PANEL.md',
    '**/GROWTH-PANEL.md',
    '**/LOGO-PANEL.md',
    '**/PANEL-ENG.md',
    '**/*-PANEL.md',
    '**/_dev/**'
  ],

  head: [
    ['meta', { name: 'theme-color', content: '#07090f' }],
    ['meta', { name: 'color-scheme', content: 'dark light' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Autopilot' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Get the decision right. Let the system finish. For would-be CEOs, founders, and people burned out by AI output.'
      }
    ],
    ['meta', { property: 'og:image', content: 'https://cookys.github.io/autopilot/assets/og.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],

  transformHead({ siteConfig }) {
    const base = siteConfig.site.base || '/'
    // Solid-plate app icon (not the detailed mascot) for tab favicon
    const icon = `${base}assets/logo-app-icon.svg`.replace(/\/{2,}/g, '/')
    return [['link', { rel: 'icon', href: icon, type: 'image/svg+xml' }]]
  },

  themeConfig: {
    // Geometric mark: dual light/dark for 16–32px nav (pixel mascot → logo-mascot.svg)
    logo: {
      light: '/assets/logo-light.svg',
      dark: '/assets/logo-dark.svg',
      alt: 'Autopilot'
    },
    siteTitle: 'Autopilot',
    externalLinkIcon: true,

    socialLinks: [{ icon: 'github', link: repo }],

    // Search off: Vue-resident product copy is not in the MiniSearch index; leaving local
    // search on only surfaces internal notes (and after srcExclude, near-empty results).

    footer: {
      message: `Plugin v${VERSION} · MIT · Site is not part of the installable plugin payload`,
      // v-html: link only the brand (not the whole line). External org → new tab.
      copyright:
        'Copyright © 2026 Cookys / <a href="https://www.stranity.com.tw/" target="_blank" rel="noopener noreferrer">Stranity</a>'
    }
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Demo', link: '/demo' },
          { text: 'Levels', link: '/levels' },
          { text: 'Recipes', link: '/recipes' },
          { text: 'Install', link: '/install' },
          { text: 'Proof', link: '/proof' },
          {
            text: `v${VERSION}`,
            items: [
              { text: 'Philosophy', link: '/philosophy' },
              { text: 'Skills (reference)', link: '/skills' },
              { text: 'Architecture', link: '/architecture' },
              { text: 'Multi-harness', link: '/multi-harness' },
              { text: 'Roadmap', link: '/roadmap' },
              { text: 'Changelog on GitHub', link: `${repo}/blob/develop/CHANGELOG.md` }
            ]
          }
        ],
        sidebar: [
          {
            text: 'Story (engineer)',
            items: [
              { text: 'Home', link: '/' },
              { text: 'State machine / demo', link: '/demo' },
              { text: 'Levels topology', link: '/levels' },
              { text: 'Recipes', link: '/recipes' },
              { text: 'Proof', link: '/proof' }
            ]
          },
          {
            text: 'Start & reference',
            items: [
              { text: 'Install', link: '/install' },
              { text: 'Philosophy', link: '/philosophy' },
              { text: 'Skills', link: '/skills' },
              { text: 'Architecture', link: '/architecture' },
              { text: 'Multi-harness', link: '/multi-harness' },
              { text: 'Roadmap', link: '/roadmap' }
            ]
          },
          {
            text: 'Source of truth',
            items: [
              { text: 'GitHub repository', link: repo },
              { text: 'docs/ on GitHub', link: `${repo}/tree/develop/docs` }
            ]
          }
        ],
        outline: { level: [2, 3] },
        editLink: {
          pattern: `${repo}/edit/develop/website/:path`,
          text: 'Edit this page'
        }
      }
    },
    'zh-TW': {
      label: '正體中文',
      lang: 'zh-TW',
      link: '/zh-TW/',
      title: 'Autopilot',
      description:
        '想用 CEO 視角帶專案的人，也被雜事跟 AI 一堆 diff 收尾搞到很煩的人。選項想全、跑歪拉回、少卡在中間。Claude Code 主場。',
      themeConfig: {
        // Top nav: keep ~4 CJK chars each (parity with EN single-word items)
        nav: [
          { text: '完整流程', link: '/zh-TW/demo' },
          { text: '委派層級', link: '/zh-TW/levels' },
          { text: '起手任務', link: '/zh-TW/recipes' },
          { text: '快速安裝', link: '/zh-TW/install' },
          { text: '翻車紀錄', link: '/zh-TW/proof' },
          {
            text: `v${VERSION}`,
            items: [
              { text: '設計理念', link: '/zh-TW/philosophy' },
              { text: '技能索引', link: '/zh-TW/skills' },
              { text: '系統架構', link: '/zh-TW/architecture' },
              { text: '工具邊界', link: '/zh-TW/multi-harness' },
              { text: '發展路線', link: '/zh-TW/roadmap' },
              { text: '更新紀錄', link: `${repo}/blob/develop/CHANGELOG.md` }
            ]
          }
        ],
        sidebar: [
          {
            text: '工程師怎麼讀',
            items: [
              { text: '首頁', link: '/zh-TW/' },
              { text: '完整流程', link: '/zh-TW/demo' },
              { text: '委派層級', link: '/zh-TW/levels' },
              { text: '起手任務', link: '/zh-TW/recipes' },
              { text: '翻車紀錄', link: '/zh-TW/proof' }
            ]
          },
          {
            text: '動手與參考',
            items: [
              { text: '快速安裝', link: '/zh-TW/install' },
              { text: '設計理念', link: '/zh-TW/philosophy' },
              { text: '技能索引', link: '/zh-TW/skills' },
              { text: '系統架構', link: '/zh-TW/architecture' },
              { text: '工具邊界', link: '/zh-TW/multi-harness' },
              { text: '發展路線', link: '/zh-TW/roadmap' }
            ]
          },
          {
            text: '原文在 repo',
            items: [
              { text: 'GitHub', link: repo },
              { text: 'docs/', link: `${repo}/tree/develop/docs` }
            ]
          }
        ],
        outline: { label: '這一頁', level: [2, 3] },
        editLink: {
          pattern: `${repo}/edit/develop/website/:path`,
          text: '改這一頁'
        },
        lastUpdatedText: '上次更新',
        docFooter: { prev: '上一頁', next: '下一頁' },
        returnToTopLabel: '回到上面',
        sidebarMenuLabel: '目錄',
        darkModeSwitchLabel: '外觀',
        lightModeSwitchTitle: '切換成亮色',
        darkModeSwitchTitle: '切換成暗色'
      }
    }
  }
})
