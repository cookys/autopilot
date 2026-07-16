<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

const c = computed(() =>
  zh.value
    ? {
        pill1: '工程師視角 · 為什麼長這樣',
        pill2: '責任怎麼切，不是雞湯',
        h1a: '問題通常不是寫太慢，',
        h1b: '是每個分岔都踢回你。',
        leadLines: [
          'Autopilot 改的是控制流。',
          '你只在 IDLE 設條件、在 ESCALATE 補一句。',
          '中間狀態由系統推；怎麼跳看 artifact。'
        ],
        causeTitle: '前因：兩種死法（工程講法）',
        traps: [
          {
            t: '決策太窄',
            d: '單一模型在 DECIDE 瞎猜 → IMPLEMENT 蓋在錯假設上 → REVIEW 才爆 → 你從頭來。',
            fix: '動工前先 DIVERGE（survey／think-tank／多引擎）把盲點攤開。'
          },
          {
            t: '執行太吵',
            d: '每次 IMPLEMENT 完都等你肉眼過 → 你變最慢的 API；假 done 靠感覺放行。',
            fix: '寫審分家 + GATE 用腳本；成功＝commit／diff／測試，不是「我覺得好了」。'
          }
        ],
        polesTitle: '想全／收斂＝狀態機上兩段',
        poles: [
          {
            k: 'DIVERGE',
            d: '可略過的狀態：多觀點進決策地圖，不是開會投票表演。',
            states: '→ 餵給 DECIDE'
          },
          {
            k: 'CONVERGE',
            d: 'REVIEW + GATE：模型可以發散，交付一定要過窄門。',
            states: '→ DONE，或退回 IMPLEMENT'
          }
        ],
        contractTitle: '人機怎麼分工（三格）',
        contract: [
          { k: '你', d: '目標、紅線、不能退讓（INTAKE 的 payload）' },
          { k: 'CEO agent', d: 'DECIDE：要擴、要砍、派誰；不是每題都問你' },
          { k: '系統', d: 'IMPLEMENT／REVIEW／GATE；ESCALATE 才敲門' }
        ],
        redTitle: '審 code 三條紅線（給 reviewer）',
        reds: [
          { t: '講完', d: '影響 + 怎麼修，不是只喊嚴重' },
          { t: '有證據', d: 'path:line，或可重跑的 probe' },
          { t: '掃乾淨', d: '乾淨項也要列，別只報壞消息' }
        ],
        trustTitle: '信任邊界',
        trustLines: [
          '信 git 產物跟腳本 exit code。',
          '不信 agent 自己說 done。',
          '空的 capture → no_verdict、fail-closed，不當 SHIP。'
        ],
        next: [
          { t: '完整流程', h: '/demo' },
          { t: '委派層級', h: '/levels' },
          { t: '翻車紀錄', h: '/proof' }
        ]
      }
    : {
        pill1: 'Engineer narrative · why this shape',
        pill2: 'Responsibility structure, not slogans',
        h1a: 'The bug isn’t slow typing.',
        h1b: 'It’s every fork returning to a human.',
        leadLines: [
          'Autopilot changes control flow.',
          'Humans at IDLE (contract) and ESCALATE (amend).',
          'Mid states advance on artifact-based transitions.'
        ],
        causeTitle: 'Cause: two failure modes (engineering)',
        traps: [
          {
            t: 'Narrow decide',
            d: 'One model guesses in DECIDE → IMPLEMENT on bad assumptions → REVIEW explodes → you restart.',
            fix: 'DIVERGE (survey / think-tank / multi-engine) before build.'
          },
          {
            t: 'Noisy execute',
            d: 'Every IMPLEMENT waits on your eye review → you are the slowest API; fake done ships on vibes.',
            fix: 'Split REVIEW + mechanical GATE; success = commit/diff/tests.'
          }
        ],
        polesTitle: 'Diverge / converge on the state machine',
        poles: [
          {
            k: 'DIVERGE',
            d: 'State DIVERGE (skippable): more views into a decision map—not a vote show.',
            states: '→ feeds DECIDE'
          },
          {
            k: 'CONVERGE',
            d: 'States REVIEW + GATE: models may fan out; delivery must pass a narrow door.',
            states: '→ DONE or back to IMPLEMENT'
          }
        ],
        contractTitle: 'Human–system contract',
        contract: [
          { k: 'You', d: 'Goal, red lines, non-negotiables (INTAKE payload)' },
          { k: 'CEO agent', d: 'DECIDE: expand/cut/dispatch; not every Q to you' },
          { k: 'System', d: 'IMPLEMENT / REVIEW / GATE; knock only on ESCALATE' }
        ],
        redTitle: 'Three review red lines (for reviewers)',
        reds: [
          { t: 'Closure', d: 'Impact + fix path, not severity theater' },
          { t: 'Evidence', d: 'path:line or re-runnable probe' },
          { t: 'Exhaustiveness', d: 'List clean items too—no only-bad reporting' }
        ],
        trustTitle: 'Trust boundary',
        trustLines: [
          'Trust git artifacts and script exit codes.',
          'Never agent self-report.',
          'Empty capture → no_verdict fail-closed, not SHIP.'
        ],
        next: [
          { t: 'Full state machine', h: '/demo' },
          { t: '/l3–/l6 who runs what', h: '/levels' },
          { t: 'Proof / scars', h: '/proof' }
        ]
      }
)
</script>

<template>
  <StoryChrome :lang="lang">
    <header class="lp-hero st-hero">
      <img class="lp-hero__bg" :src="a('bg-grid.jpg')" alt="" />
      <div class="lp-hero__shade" />
      <div class="lp-wrap lp-hero__content">
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
        <div class="lp-hero__visual">
          <img class="lp-hero__art" :src="a('diverge-converge.jpg')" alt="" />
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.causeTitle }}</p>
        </div>
        <div class="lp-vs">
          <article v-for="t in c.traps" :key="t.t" class="lp-vs__col lp-vs__col--bad">
            <header><span class="lp-vs__tag">{{ t.t }}</span></header>
            <p class="st-prose">{{ t.d }}</p>
            <p class="st-prose eng-note--esc" style="margin-top: 0.75rem">→ {{ t.fix }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.polesTitle }}</p>
        </div>
        <div class="lp-who">
          <article v-for="p0 in c.poles" :key="p0.k" class="lp-who__card">
            <h3><code>{{ p0.k }}</code></h3>
            <p>{{ p0.d }}</p>
            <p class="lp-who__sub">{{ p0.states }}</p>
          </article>
        </div>
        <div class="eng-flow eng-flow--good" style="margin-top: 1.25rem">
          <div class="eng-node eng-node--human eng-node--sm"><strong>IDLE</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>INTAKE</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>DIVERGE?</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>DECIDE</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>DISPATCH</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>IMPLEMENT</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>REVIEW</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>GATE</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--sys eng-node--sm"><strong>FINALIZE</strong></div>
          <span class="eng-arrow">→</span>
          <div class="eng-node eng-node--done eng-node--sm"><strong>DONE</strong></div>
        </div>
        <p class="eng-note">
          {{
            zh
              ? 'DIVERGE?＝可略過。IMPLEMENT⇄REVIEW 在 VERDICT 仍 blocking 時會來回。任一狀態可 ESCALATE。'
              : 'DIVERGE? = skippable. IMPLEMENT⇄REVIEW loops on blocking VERDICT. Any state may ESCALATE.'
          }}
        </p>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.contractTitle }}</p>
        </div>
        <div class="lp-who">
          <article v-for="r in c.contract" :key="r.k" class="lp-who__card">
            <h3>{{ r.k }}</h3>
            <p>{{ r.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.redTitle }}</p>
        </div>
        <div class="lp-bento">
          <article v-for="r in c.reds" :key="r.t" class="lp-card">
            <h3>{{ r.t }}</h3>
            <p>{{ r.d }}</p>
          </article>
        </div>
        <div class="lp-lead-stack" style="margin-top: 1.25rem">
          <p class="lp-kicker">{{ c.trustTitle }}</p>
          <ul class="lp-bullet-stack">
            <li v-for="(line, i) in c.trustLines" :key="i">{{ line }}</li>
          </ul>
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
