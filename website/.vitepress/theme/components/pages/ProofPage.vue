<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

const scars = computed(() =>
  zh.value
    ? [
        {
          t: 'H2 被推翻',
          d: '假設：reviewer 席塞 skill 會更銳。預鎖 A/B：沒有。',
          state: '打臉在 DECIDE 前的「經驗法則」',
          receipt: {
            label: 'A/B 實驗資料',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/skill-transport'
          }
        },
        {
          t: '弱×弱必逃',
          d: 'IMPLEMENT 弱 + REVIEW 弱 → 假 done 幾乎必過 GATE 前的人審。',
          state: 'REVIEW 必須是真 reviewer',
          receipt: {
            label: 'pipeline bench',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/pipeline-bench'
          }
        },
        {
          t: 'Pipeline 有稅',
          d: '能救弱 implementer 的流程，也可能拖慢本來就強的。',
          state: 'GATE 密度是 tradeoff，不是越多越好',
          receipt: {
            label: '交換率量測',
            href: 'https://github.com/cookys/autopilot/blob/develop/evals/pipeline-bench/README.md'
          }
        },
        {
          t: '空 review 誤判',
          d: 'flush／pipefail 曾把空 capture 當過。改機制，不靠感覺。',
          state: 'GATE fail-closed：no_verdict ≠ SHIP',
          receipt: {
            label: 'fail-closed 回歸測試',
            href: 'https://github.com/cookys/autopilot/blob/develop/hooks/tests/dispatch-output-quiescence.test.sh'
          }
        }
      ]
    : [
        {
          t: 'H2 refuted',
          d: 'Hypothesis: skill on reviewer seat sharpens. Locked A/B: no.',
          state: 'Challenged a DECIDE-time rule of thumb',
          receipt: {
            label: 'A/B experiment data',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/skill-transport'
          }
        },
        {
          t: 'Weak × weak',
          d: 'Weak IMPLEMENT + weak REVIEW → fake done almost always escapes.',
          state: 'REVIEW needs a real reviewer',
          receipt: {
            label: 'pipeline bench',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/pipeline-bench'
          }
        },
        {
          t: 'Pipeline tax',
          d: 'Flows that save weak writers can slow strong ones.',
          state: 'GATE density is a tradeoff',
          receipt: {
            label: 'exchange-rate bench',
            href: 'https://github.com/cookys/autopilot/blob/develop/evals/pipeline-bench/README.md'
          }
        },
        {
          t: 'Empty-review bugs',
          d: 'Flush/pipefail once treated empty capture as pass. Fixed mechanically.',
          state: 'GATE fail-closed: no_verdict ≠ SHIP',
          receipt: {
            label: 'fail-closed regression test',
            href: 'https://github.com/cookys/autopilot/blob/develop/hooks/tests/dispatch-output-quiescence.test.sh'
          }
        }
      ]
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '證據文化 · 對上狀態機',
        pill2: '為什麼敢少盯',
        h1a: '我們公開認栽過，',
        h1b: '自己打自己臉。',
        leadLines: [
          '信任怎麼切，分狀態看：',
          'DISPATCH 成不成功 → 看 git。',
          'REVIEW → 看 VERDICT／artifact。',
          'GATE → 看腳本 exit。',
          '空結果一律 fail-closed。沒有灌水 stars。'
        ],
        how: '怎麼驗（對到狀態）',
        checks: [
          { n: 'known-bad → REVIEW', d: 'critical 假放行必須是 0' },
          { n: 'clean set → REVIEW', d: '不能亂槍打鳥（specificity）' },
          { n: '真 A/B → DECIDE 假設', d: '沒用就公開講' },
          { n: 'git 產物 → IMPLEMENT', d: 'dispatch 不看模型自報' }
        ],
        scarTitle: '公開疤（changelog 有寫）',
        next: [
          { t: '完整流程', h: '/demo' },
          { t: '設計理念', h: '/philosophy' }
        ]
      }
    : {
        pill1: 'Proof culture · mapped to states',
        pill2: 'Why less watching is safe',
        h1a: 'We publish',
        h1b: 'when wrong.',
        leadLines: [
          'Trust splits by state:',
          'DISPATCH success → git.',
          'REVIEW → VERDICT / artifacts.',
          'GATE → script exits.',
          'Empty = fail-closed. No fake stars.'
        ],
        how: 'How we check (by state)',
        checks: [
          { n: 'known-bad → REVIEW', d: 'false-pass-on-critical = 0' },
          { n: 'clean set → REVIEW', d: 'specificity, not flag-happy' },
          { n: 'real A/B → DECIDE myths', d: 'publish misses' },
          { n: 'git artifacts → IMPLEMENT', d: 'never self-report' }
        ],
        scarTitle: 'Public scars (in changelog)',
        next: [
          { t: 'State machine', h: '/demo' },
          { t: 'Why', h: '/philosophy' }
        ]
      }
)
</script>

<template>
  <StoryChrome :lang="lang">
    <header class="lp-hero st-hero">
      <img class="lp-hero__bg" :src="a('hero-desk.jpg')" alt="" />
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
          <div class="lp-lead-stack">
            <p v-for="(line, i) in c.leadLines" :key="i" class="lp-lead">{{ line }}</p>
          </div>
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.how }}</p>
        <div class="lp-bento">
          <article v-for="ch in c.checks" :key="ch.n" class="lp-card">
            <code class="st-code-label">{{ ch.n }}</code>
            <p>{{ ch.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.scarTitle }}</p>
        <div class="lp-bento">
          <article v-for="s in scars" :key="s.t" class="lp-card lp-card--diverge">
            <h3>{{ s.t }}</h3>
            <p>{{ s.d }}</p>
            <p class="lp-who__sub">{{ s.state }}</p>
            <a
              class="proof-receipt"
              :href="s.receipt.href"
              target="_blank"
              rel="noreferrer"
            >{{ s.receipt.label }} ↗</a>
          </article>
        </div>
        <div class="lp-cta-row" style="margin-top: 1.5rem">
          <a v-for="n in c.next" :key="n.h" class="lp-btn lp-btn--ghost" :href="p(n.h)">{{ n.t }}</a>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
