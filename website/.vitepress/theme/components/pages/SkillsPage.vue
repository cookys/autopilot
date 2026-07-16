<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

/** Skills as state-machine coverage — not a 28-icon wall */
const bands = computed(() =>
  zh.value
    ? [
        {
          state: 'IDLE / INTAKE',
          title: '你進場與契約',
          items: [
            { n: 'ceo-agent · l3–l6', d: '進狀態機的入口；差在誰跑 IMPLEMENT' },
            { n: 'onboard', d: '把 repo 接上 .claude config（接手前）' }
          ]
        },
        {
          state: 'DIVERGE',
          title: '動工前把假設壓實',
          items: [
            { n: 'survey', d: '業界怎麼做' },
            { n: 'think-tank · think-tank-dialectic', d: '多角色／辯證壓力' },
            { n: 'research-to-ship', d: '研究釘到可開工的 plan' },
            { n: 'brainstorm · engine-onboarding', d: '選項；新引擎能不能坐席' }
          ]
        },
        {
          state: 'DECIDE → IMPLEMENT',
          title: '取捨後動手',
          items: [
            { n: 'dev-flow', d: '大小、分支、計畫、關卡節奏' },
            { n: 'team · debug · profiling', d: '並行、除錯、量測' },
            { n: 'test-strategy', d: '測金字塔與 baseline' }
          ]
        },
        {
          state: 'REVIEW → GATE',
          title: '收斂與機械閘',
          items: [
            { n: 'quality-pipeline', d: '測 → 掃 → 完整 → 審' },
            { n: 'scripts · 機械閘', d: 'completeness / secret / test-integrity… 對應 GATE' }
          ]
        },
        {
          state: 'DONE 前後',
          title: '收尾與長期',
          items: [
            { n: 'finish-flow', d: '收尾拆步，不默默跳過' },
            { n: 'handoff · learn · next · retro · distill', d: '交接、教訓、下一步、回顧、蒸餾' },
            { n: 'doc-sync · project-lifecycle · audit · harness-maintenance', d: '文件／專案／審計／平台保鮮' }
          ]
        }
      ]
    : [
        {
          state: 'IDLE / INTAKE',
          title: 'Entry & contract',
          items: [
            { n: 'ceo-agent · l3–l6', d: 'State-machine front door; who runs IMPLEMENT' },
            { n: 'onboard', d: 'Wire .claude config before takeover' }
          ]
        },
        {
          state: 'DIVERGE',
          title: 'Harden assumptions before build',
          items: [
            { n: 'survey', d: 'Industry paths' },
            { n: 'think-tank · dialectic', d: 'Multi-role / dialectic pressure' },
            { n: 'research-to-ship', d: 'Research locked to a buildable plan' },
            { n: 'brainstorm · engine-onboarding', d: 'Options; seat a new engine' }
          ]
        },
        {
          state: 'DECIDE → IMPLEMENT',
          title: 'Tradeoff then write',
          items: [
            { n: 'dev-flow', d: 'Size, branch, plan, gate cadence' },
            { n: 'team · debug · profiling', d: 'Parallelism, RCA, perf' },
            { n: 'test-strategy', d: 'Pyramid & baselines' }
          ]
        },
        {
          state: 'REVIEW → GATE',
          title: 'Converge & mechanical gates',
          items: [
            { n: 'quality-pipeline', d: 'Test → scan → completeness → review' },
            { n: 'scripts · mechanical gates', d: 'completeness / secret / test-integrity… = GATE' }
          ]
        },
        {
          state: 'Around DONE',
          title: 'Close & long horizon',
          items: [
            { n: 'finish-flow', d: 'Closing steps without silent skips' },
            { n: 'handoff · learn · next · retro · distill', d: 'Resume, lessons, priorities, retro, distill' },
            { n: 'doc-sync · project-lifecycle · audit · harness-maintenance', d: 'Docs, projects, audit, platform freshness' }
          ]
        }
      ]
)

const c = computed(() =>
  zh.value
    ? {
        pill1: 'Skills × 狀態機',
        pill2: '不是 28 格 icon 牆',
        h1a: '技能在哪一段狀態出現，',
        h1b: '比清單重要。',
        lead: '你不必背 skill 名。系統在對應狀態會叫到它們。完整目錄在 repo；這頁只回答「run 走到哪會碰到什麼」。',
        next: [
          { t: '完整流程', h: '/demo' },
          { t: '起手任務', h: '/recipes' },
          { t: '委派層級', h: '/levels' }
        ]
      }
    : {
        pill1: 'Skills × state machine',
        pill2: 'Not a 28-icon wall',
        h1a: 'When a skill fires',
        h1b: 'beats a catalog.',
        lead: 'You don’t memorize names. The run hits them by state. Full list lives in the repo; this page answers “what shows up where”.',
        next: [
          { t: 'State machine', h: '/demo' },
          { t: 'Recipes', h: '/recipes' },
          { t: 'Levels', h: '/levels' }
        ]
      }
)
</script>

<template>
  <StoryChrome :lang="lang">
    <header class="lp-hero st-hero">
      <img class="lp-hero__bg" :src="a('texture-path.jpg')" alt="" />
      <div class="lp-hero__shade" />
      <div class="lp-wrap lp-hero__content st-hero--single">
        <div class="lp-hero__text">
          <div class="lp-pills">
            <span class="lp-pill">{{ c.pill1 }}</span>
            <span class="lp-pill lp-pill--amber">{{ c.pill2 }}</span>
          </div>
          <h1>
            <span>{{ c.h1a }}</span>
            <span class="lp-h1-accent">{{ c.h1b }}</span>
          </h1>
          <p class="lp-lead">{{ c.lead }}</p>
        </div>
      </div>
    </header>

    <section
      v-for="(b, idx) in bands"
      :key="b.state"
      class="lp-section"
      :class="{ 'lp-section--alt': idx % 2 === 1 }"
    >
      <div class="lp-wrap">
        <p class="lp-kicker"><code>{{ b.state }}</code> · {{ b.title }}</p>
        <div class="lp-bento">
          <article v-for="i in b.items" :key="i.n" class="lp-card">
            <h3>{{ i.n }}</h3>
            <p>{{ i.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap lp-cta-row">
        <a v-for="n in c.next" :key="n.h" class="lp-btn lp-btn--ghost" :href="p(n.h)">{{ n.t }}</a>
      </div>
    </section>
  </StoryChrome>
</template>
