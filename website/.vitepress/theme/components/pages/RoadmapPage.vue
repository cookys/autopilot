<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)

const c = computed(() =>
  zh.value
    ? {
        pill1: '給想當 CEO 的人 · 也給快被雜事跟 AI 產能壓垮的人',
        pill2: '今天，我們發隕石給 CEO。',
        h1a: '接下來，',
        h1b: '大概往哪。',
        lead: '手寫精選。不是 BACKLOG 倒出來。',
        now: '現在',
        later: '之後',
        no: '不裝傻',
        nowItems: [
          { n: 'Unit 契約', d: 'v2.32.36 · GO／NO-GO 過了才能開 runner' },
          { n: 'Author roster', d: '已出 · 活躍 /l6 亂指定就擋' }
        ],
        laterItems: [
          { n: 'Dispatch 第三階段', d: '卡關先 nudge，真沒反應再處理' },
          { n: '經濟學硬擋', d: '校準夠了再硬' },
          { n: '審查別整庫爬', d: 'diff-only、delta re-review' }
        ],
        nos: ['Domain 自動換引擎（樣本還薄）', 'skill pack 一定讓 reviewer 變銳', 'cgroup = 安全保證']
      }
    : {
        pill1: 'For would-be CEOs · and people crushed by chores & AI output',
        pill2: 'Today we hand meteors to CEOs.',
        h1a: 'What’s next.',
        h1b: 'Curated.',
        lead: 'Not a BACKLOG dump.',
        now: 'Now',
        later: 'Later',
        no: 'Won’t pretend',
        nowItems: [
          { n: 'Unit contract', d: 'v2.32.36 · GO/NO-GO before spend' },
          { n: 'Author roster', d: 'Shipped · active /l6 fail-closed' }
        ],
        laterItems: [
          { n: 'Dispatch Stage 3', d: 'Nudge before kill' },
          { n: 'Harder economics', d: 'After calibration' },
          { n: 'Cheaper review', d: 'Diff-only + delta' }
        ],
        nos: ['Domain auto-routing (thin evidence)', 'Packs always sharpen reviewers', 'Cgroup as security proof']
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
        <p class="lp-kicker">{{ c.now }}</p>
        <div class="lp-bento">
          <article v-for="i in c.nowItems" :key="i.n" class="lp-card lp-card--ceo">
            <h3>{{ i.n }}</h3>
            <p>{{ i.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.later }}</p>
        <div class="st-levels">
          <article v-for="(i, idx) in c.laterItems" :key="i.n" class="st-level">
            <span class="st-level__i">0{{ idx + 1 }}</span>
            <h3>{{ i.n }}</h3>
            <p>{{ i.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.no }}</p>
        <div class="lp-who">
          <article v-for="n in c.nos" :key="n" class="lp-who__card lp-vs__col--bad">
            <p>{{ n }}</p>
          </article>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
