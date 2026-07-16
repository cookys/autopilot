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
          'Autopilot 改的是控制流，不是嘴上態度。',
          '你只在進場設條件、在真的卡住時補一句。',
          '中間全由系統推進；每一步過不過，看 artifact 說話。'
        ],
        causeTitle: '為什麼會累：兩種典型死法',
        traps: [
          {
            t: '決策太窄',
            d: '單一模型自己猜一個方向就開寫，寫到審查才發現假設錯了，整段重來——你陪著從頭再走一次。',
            fix: '解法：動工前先發散——survey、think-tank、多引擎意見把盲點攤開，再做決定。'
          },
          {
            t: '執行太吵',
            d: '每寫完一段就停下來等你點頭，你變成整條流程裡最慢的一環；「做完了」靠感覺放行。',
            fix: '解法：寫審分家＋機械 gate。成功的定義是 commit、diff、測試綠——不是「我覺得好了」。'
          }
        ],
        polesTitle: '兩個動作：先想全，再收斂',
        poles: [
          {
            k: '先想全（diverge）',
            d: '有真取捨才開的調查段：把多方觀點攤進決策地圖，不是開會投票表演。',
            states: '→ 餵給 CEO agent 做取捨'
          },
          {
            k: '再收斂（converge）',
            d: '審查＋機械 gate：模型可以發散，交付一定要過窄門。',
            states: '→ 過了才算完；不過就退回去改'
          }
        ],
        contractTitle: '人機怎麼分工（三格）',
        contract: [
          { k: '你', d: '給目標、紅線、不能退讓的條件——進場講一次' },
          { k: 'CEO agent', d: '做取捨：要擴、要砍、派誰；不是每題都回來問你' },
          { k: '系統', d: '寫、審、gate 全在裡面跑；敲你門只有一種情況——真的過不去' }
        ],
        redTitle: '審 code 三條紅線（我們對 reviewer 的要求）',
        reds: [
          { t: '講完整', d: '說清楚影響＋怎麼修，不是只喊嚴重' },
          { t: '有證據', d: '指到 path:line，或給可重跑的驗證' },
          { t: '掃乾淨', d: '沒問題的部分也要列——不能只報壞消息' }
        ],
        trustTitle: '信任邊界',
        trustLines: [
          '信 git artifact 跟腳本 exit code。',
          '不信 agent 自己說 done。',
          '拿不到審查結果就當「沒過」——fail-closed，絕不默認放行。'
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
          'Autopilot changes the control flow, not the vibes.',
          'You set conditions at the start and add one line when it is genuinely stuck.',
          'Everything in between advances on artifacts — every pass is checkable.'
        ],
        causeTitle: 'Why it burns you out: two classic failure modes',
        traps: [
          {
            t: 'Deciding too narrow',
            d: 'One model guesses a direction and starts writing; review finally exposes the bad assumption and the whole stretch restarts — with you along for the ride.',
            fix: 'Fix: diverge before building — survey, think-tank, multi-engine takes lay out the blind spots first.'
          },
          {
            t: 'Executing too loud',
            d: 'Every finished chunk waits for your nod; you become the slowest link, and “done” ships on feel.',
            fix: 'Fix: writer ≠ reviewer, plus mechanical gates. Success means commit, diff, green tests — not “feels done”.'
          }
        ],
        polesTitle: 'Two moves: widen first, then converge',
        poles: [
          {
            k: 'Widen first (diverge)',
            d: 'A research leg that opens only for real tradeoffs: multiple views onto one decision map — not a voting show.',
            states: '→ feeds the CEO-agent tradeoff'
          },
          {
            k: 'Then converge',
            d: 'Review + mechanical gates: models may fan out; delivery must pass a narrow door.',
            states: '→ pass to finish; fail loops back for fixes'
          }
        ],
        contractTitle: 'Human–system contract',
        contract: [
          { k: 'You', d: 'Goal, red lines, non-negotiables — said once at intake' },
          { k: 'CEO agent', d: 'Makes the tradeoffs: expand, cut, dispatch — without asking you every question' },
          { k: 'System', d: 'Writing, review, gates all run inside; it knocks for one reason only — genuinely stuck' }
        ],
        redTitle: 'Three review red lines (what we demand of reviewers)',
        reds: [
          { t: 'Complete', d: 'State the impact and the fix path, not just severity' },
          { t: 'Evidenced', d: 'Point at path:line, or give a re-runnable check' },
          { t: 'Exhaustive', d: 'List what is clean too — never bad news only' }
        ],
        trustTitle: 'Trust boundary',
        trustLines: [
          'Trust git artifacts and script exit codes.',
          'Never an agent’s own “done”.',
          'No review result means “did not pass” — fail-closed, never a silent pass.'
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
        <div class="lp-vs lp-vs--pair">
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
