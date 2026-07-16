<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)

const layers = computed(() =>
  zh.value
    ? [
        { n: '多元 skills', d: 'survey / think-tank / r2s / 多引擎意見' },
        { n: 'CEO agent', d: '/l3–/l6 · 取捨往前 · 少問人' },
        { n: 'Dispatch', d: '跨引擎寫／審／讀 repo' },
        { n: '收斂', d: 'peer · 眾議會 · 閘 · artifact' }
      ]
    : [
        { n: 'Diverge skills', d: 'survey / think-tank / r2s / multi-engine' },
        { n: 'CEO-agent', d: '/l3–/l6 · tradeoffs · fewer pings' },
        { n: 'Dispatch', d: 'cross-engine write / review / read' },
        { n: 'Converge', d: 'peer · panel · gates · artifacts' }
      ]
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '給想當 CEO 的人 · 也給快被雜事跟 AI 產能壓垮的人',
        pill2: '今天，我們發隕石給 CEO。',
        h1a: '故事怎麼疊，',
        h1b: '架構就怎麼疊。',
        lead: '不是文件裡的模組圖。是多元 → CEO → 收斂 的同一條敘事。',
        agentsTitle: '三個只出意見的 agent',
        agents: [
          { n: 'reviewer', d: 'merge 前審查 · 唯讀' },
          { n: 'debugger', d: '找根因 · 唯讀' },
          { n: 'planner', d: '拆規格 · 唯讀' }
        ]
      }
    : {
        pill1: 'For would-be CEOs · and people crushed by chores & AI output',
        pill2: 'Today we hand meteors to CEOs.',
        h1a: 'Architecture',
        h1b: 'matches the story.',
        lead: 'Not a module dump. Same spine: diverge → CEO → converge.',
        agentsTitle: 'Three read-only agents',
        agents: [
          { n: 'reviewer', d: 'Pre-merge · read-only' },
          { n: 'debugger', d: 'Root cause · read-only' },
          { n: 'planner', d: 'Decompose · read-only' }
        ]
      }
)
</script>

<template>
  <StoryChrome :lang="lang">
    <header class="lp-hero st-hero">
      <img class="lp-hero__bg" :src="a('bg-grid.jpg')" alt="" />
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

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="st-stack">
          <article v-for="(l, i) in layers" :key="l.n" class="st-stack__row">
            <span class="st-stack__n">{{ i + 1 }}</span>
            <div>
              <h3>{{ l.n }}</h3>
              <p>{{ l.d }}</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.agentsTitle }}</p>
        <div class="lp-who">
          <article v-for="ag in c.agents" :key="ag.n" class="lp-who__card">
            <h3>{{ ag.n }}</h3>
            <p>{{ ag.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-photo">
      <img :src="a('diverge-converge.jpg')" alt="" />
      <div class="lp-photo__veil">
        <div class="lp-wrap">
          <p>{{ zh ? '多元進，收斂出。CEO 在中間。' : 'Diverge in. Converge out. CEO in the middle.' }}</p>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
