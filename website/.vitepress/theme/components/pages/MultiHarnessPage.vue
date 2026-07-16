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
        pill1: '工具邊界 · 只講驗證過的',
        pill2: '主場是 Claude Code',
        h1a: 'Claude 是主場。',
        h1b: '別的量力而為。',
        lead: '這頁只做一件事：老實列出同一套 plugin 在每個工具上實際能跑多少。不硬吹對等；每一條聲明都真的跑過工具驗證。',
        hostsTitle: '四個平台，四種支援度',
        hostsLead: '主戰場是 Claude Code；其他平台能吃多少寫多少：',
        hosts: [
          { n: 'Claude Code', d: 'Marketplace 兩行裝完。skills、hooks、/l3–/l6 委派全數可用——完整體驗在這裡。' },
          { n: 'Codex', d: '經 .agents/skills 轉接層或 platforms/codex payload。skills 能跑；hook 生態不對等，別期待一樣。' },
          { n: 'OpenCode', d: 'skills＋plugin 形式接入，共用同一套 skills；hook 支援度看平台版本。' },
          { n: 'agy', d: '用 install-antigravity.sh 註冊——守衛式安裝（先擋已知的資料毀損路徑）；runtime hook 未完全驗證。' }
        ],
        honest: '這頁自己也翻過車',
        honestLead: '可攜性聲明特別容易寫成願望。這三次是我們真的付過學費的：',
        scars: [
          '曾把不存在的環境變數寫進文件當事實——現在的規矩：沒跑過工具、沒有官方文件網址，就不准寫。',
          '矯枉過正的那次：把真實存在的 CLI 指令標成「捏造」——修正過頭同樣是錯，也記下來。',
          '以為某平台會觸發 hook，實際上根本不會——現在每個平台能力聲明都要實測（Spike）過才算數。'
        ]
      }
    : {
        pill1: 'Host boundaries · verified claims only',
        pill2: 'Claude Code is home turf',
        h1a: 'Claude is home.',
        h1b: 'Others are honest.',
        lead: 'This page does one thing: honestly list how much of the plugin actually runs on each tool. No parity theater; every claim was verified by running the real tool.',
        hostsTitle: 'Four hosts, four levels of support',
        hostsLead: 'Claude Code is the home turf; everything else gets exactly what it earned:',
        hosts: [
          { n: 'Claude Code', d: 'Two marketplace lines. Skills, hooks, /l3–/l6 delegation — the full experience lives here.' },
          { n: 'Codex', d: 'Via the .agents/skills adapter or the platforms/codex payload. Skills run; the hook ecosystem is not equivalent.' },
          { n: 'OpenCode', d: 'Plugs in as skills + plugin, sharing the same skill set; hook support depends on the platform version.' },
          { n: 'agy', d: 'Registered via install-antigravity.sh — a guarded install (blocks a known data-loss path first); runtime hooks not fully verified.' }
        ],
        honest: 'This page has its own crash log',
        honestLead: 'Portability claims degrade into wishes easily. Three lessons we paid for:',
        scars: [
          'We once wrote nonexistent env vars into the docs as fact — the rule now: no tool run or official doc URL, no claim.',
          'The overcorrection: real CLI commands got labelled “fabricated” — overshooting the fix is also an error, recorded too.',
          'We assumed a platform fired hooks it never fires — every capability claim now requires a real spike run.'
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
        <p class="lp-kicker">{{ c.hostsTitle }}</p>
        <p class="lp-lead srail-lead">{{ c.hostsLead }}</p>
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
        <p class="lp-lead srail-lead">{{ c.honestLead }}</p>
        <div class="lp-who">
          <article v-for="s in c.scars" :key="s" class="lp-who__card lp-vs__col--bad">
            <p>{{ s }}</p>
          </article>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
