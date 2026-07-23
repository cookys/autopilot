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
        {
          n: '想全層（diverge skills）',
          d: 'survey、think-tank、research-to-ship、多引擎意見——把選項與盲點攤開，餵給下一層做決定。'
        },
        {
          n: 'CEO agent',
          d: '/l3–/l6 的大腦：拿上一層的材料做取捨、往前推，盡量不回頭問你。'
        },
        {
          n: '派遣層（dispatch）',
          d: '把寫 code、審 code、讀 repo 派給不同廠牌的引擎跑，隔離在 worktree 裡。'
        },
        {
          n: '收斂層（converge）',
          d: 'peer 審查、眾議會、機械 gate——交付前的窄門，一律看 artifact 不聽自報。'
        }
      ]
    : [
        {
          n: 'Widen layer (diverge skills)',
          d: 'survey, think-tank, research-to-ship, multi-engine takes — lay out options and blind spots to feed the next layer.'
        },
        {
          n: 'CEO agent',
          d: 'The brain behind /l3–/l6: takes that material, makes the tradeoffs, advances — asking you as little as possible.'
        },
        {
          n: 'Dispatch layer',
          d: 'Sends writing, reviewing, and repo-reading to engines of different vendors, isolated in worktrees.'
        },
        {
          n: 'Converge layer',
          d: 'Peer review, the QC panel, mechanical gates — the narrow door before delivery, judged on artifacts, never self-report.'
        }
      ]
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '系統架構 · 跟著敘事疊',
        pill2: '四層一條線',
        h1a: '故事怎麼疊，',
        h1b: '架構就怎麼疊。',
        lead: '不是文件裡的模組圖。是多元 → CEO → 收斂 的同一條敘事。',
        agentsTitle: '三個只出意見的 agent',
        agentsLead: '引擎之外還有三個內建方法論 agent。全部唯讀——它們產出判斷，動手與 merge 的權力不在它們身上。',
        agents: [
          { n: 'reviewer', d: 'merge 前把 diff 審一輪，每個 finding 都要指到行號。' },
          { n: 'debugger', d: '出事時蒐證找根因、提修法——只診斷，不動手改。' },
          { n: 'planner', d: '把模糊需求拆成可派工的任務，附驗收條件。' }
        ]
      }
    : {
        pill1: 'Architecture · follows the story',
        pill2: 'Four layers, one line',
        h1a: 'Architecture',
        h1b: 'matches the story.',
        lead: 'Not a module dump. Same spine: diverge → CEO → converge.',
        agentsTitle: 'Three opinion-only agents',
        agentsLead: 'Beyond the engines, three built-in methodology agents. All read-only — they produce judgment; the power to edit and merge stays elsewhere.',
        agents: [
          { n: 'reviewer', d: 'Reviews the diff pre-merge; every finding must cite a line.' },
          { n: 'debugger', d: 'Gathers evidence and root-causes incidents — diagnoses only, never patches.' },
          { n: 'planner', d: 'Breaks fuzzy asks into dispatchable tasks with acceptance criteria.' }
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
        <p class="lp-kicker">{{ zh ? '四層怎麼疊' : 'The four layers' }}</p>
        <p class="lp-lead srail-lead">{{
          zh
            ? '從上往下讀：想全的材料進 CEO agent，決策派給引擎執行，最後全部擠過收斂的窄門。'
            : 'Read top-down: widened material feeds the CEO agent, decisions dispatch to engines, and everything squeezes through the converge door at the end.'
        }}</p>
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
        <p class="lp-lead srail-lead">{{ c.agentsLead }}</p>
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
