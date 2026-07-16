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
        h1a: 'Claude 是主場。',
        h1b: '別的量力而為。',
        lead: '只保證各平台實際支援什麼。不硬吹對等。可攜要真的跑過工具。',
        honest: '我們踩過的',
        scars: ['亂掰 env 變數', '把真 CLI 標成假的', '以為有 hook 其實沒有'],
        hosts: [
          { n: 'Claude Code', d: 'Marketplace 兩行 · 完整' },
          { n: 'Codex', d: '.agents/skills 或 platforms/codex' },
          { n: 'OpenCode', d: 'skills + plugin' },
          { n: 'agy', d: 'install-antigravity.sh' }
        ]
      }
    : {
        pill1: 'For would-be CEOs · and people crushed by chores & AI output',
        pill2: 'Today we hand meteors to CEOs.',
        h1a: 'Claude is home.',
        h1b: 'Others are honest.',
        lead: 'Only claim what each host actually supports. Spike-verify portability.',
        honest: 'Lessons we paid for',
        scars: ['Fabricated env vars', 'Real CLIs labelled fake', 'Assumed hooks that never fire'],
        hosts: [
          { n: 'Claude Code', d: 'Marketplace · full path' },
          { n: 'Codex', d: '.agents/skills or platforms/codex' },
          { n: 'OpenCode', d: 'skills + plugin' },
          { n: 'agy', d: 'install-antigravity.sh' }
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
        <div class="lp-bento">
          <article v-for="h in c.hosts" :key="h.n" class="lp-card">
            <h3>{{ h.n }}</h3>
            <p>{{ h.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.honest }}</p>
        <div class="lp-who">
          <article v-for="s in c.scars" :key="s" class="lp-who__card lp-vs__col--bad">
            <p>{{ s }}</p>
          </article>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
