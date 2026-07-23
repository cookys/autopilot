<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

/** Compact level cards — topology detail lives in the matrix, not a text wall */
const levels = computed(() =>
  zh.value
    ? [
        {
          id: '/l3',
          tone: 'near',
          n: '同一個 thread 跑完',
          when: '想看過程 · 範圍小 · 還沒異質',
          why: ['depth-0 ctx 會塞滿過程', '適合你要盯著看'],
          chips: [
            { k: '寫', v: '同 thread' },
            { k: '工頭', v: '無' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: '通常不用' }
          ],
          cmd: '/l3 那個 flaky reconnect 測資你全權搞定'
        },
        {
          id: '/l4',
          tone: 'mid',
          n: '背景工頭 + worktree',
          when: '長任務 · 主對話要乾淨',
          why: ['執行卸給工頭', 'depth-0 留座標'],
          chips: [
            { k: '寫', v: '工頭 leaf' },
            { k: '工頭', v: '背景' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: '隔離' }
          ],
          cmd: '/l4 把 WebSocket 重連做完。紅線：不准動 public API'
        },
        {
          id: '/l5',
          tone: 'far',
          n: '異質「寫→審」',
          when: 'depth-0 別塞爆 · 寫審分家',
          why: [
            '主因：實作卸出 ctx，depth-0 長活',
            '附加：Fable 規劃協調，寫走較省引擎'
          ],
          chips: [
            { k: '寫', v: '異質' },
            { k: '審', v: '另一家' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: '隔離' }
          ],
          cmd: '/l5 修 login null deref。紅線：不准動 auth schema、測試要綠'
        },
        {
          id: '/l6',
          tone: 'max',
          n: '驗證寫法也派',
          when: '範圍大 · roster 可信 · 只收終局',
          why: [
            '主因：depth-0 只協調與終裁',
            '附加：Fable 專心協調，驗證 authoring 也可卸'
          ],
          chips: [
            { k: '寫', v: '異質' },
            { k: '驗證寫', v: '異質 leaf' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: '隔離' }
          ],
          cmd: '/l6 整個 parser 重寫，連測試怎麼寫也派出去'
        }
      ]
    : [
        {
          id: '/l3',
          tone: 'near',
          n: 'Same thread, inline',
          when: 'Watch the run · small scope · no hetero yet',
          why: ['Brain ctx fills with the whole run', 'Use when you want to watch'],
          chips: [
            { k: 'write', v: 'same thread' },
            { k: 'foreman', v: '—' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: 'usually no' }
          ],
          cmd: '/l3 own that flaky reconnect fixture end-to-end'
        },
        {
          id: '/l4',
          tone: 'mid',
          n: 'Background foreman + worktree',
          when: 'Long job · keep main chat clean',
          why: ['Exec off to foreman', 'Brain keeps coords only'],
          chips: [
            { k: 'write', v: 'foreman leaf' },
            { k: 'foreman', v: 'background' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: 'isolated' }
          ],
          cmd: '/l4 finish WS reconnect. Red line: no public API break'
        },
        {
          id: '/l5',
          tone: 'far',
          n: 'Hetero write→review',
          when: 'Lean brain ctx · write ≠ review family',
          why: [
            'Primary: offload impl noise; brain stays long-lived',
            'Bonus: Fable plans/coords; cheaper engines write'
          ],
          chips: [
            { k: 'write', v: 'hetero' },
            { k: 'review', v: 'other family' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: 'isolated' }
          ],
          cmd: '/l5 login null deref. Red lines: no auth schema; tests green'
        },
        {
          id: '/l6',
          tone: 'max',
          n: 'Verify-author offloaded too',
          when: 'Large scope · trust roster · end report OK',
          why: [
            'Primary: brain = coord + final QC only',
            'Bonus: Fable on coord; verify-author can go hetero too'
          ],
          chips: [
            { k: 'write', v: 'hetero' },
            { k: 'verify-auth', v: 'hetero leaf' },
            { k: 'gate', v: 'depth-0' },
            { k: 'wt', v: 'isolated' }
          ],
          cmd: '/l6 rewrite parser; dispatch how tests are written too'
        }
      ]
)

const matrix = computed(() =>
  zh.value
    ? {
        title: '拓撲對照表（不是「只差誰寫 code」）',
        cols: ['角色', '/l3', '/l4', '/l5', '/l6'],
        rows: [
          {
            k: 'depth-0 ctx',
            v: ['整段過程都在', '執行卸給工頭', '實作再卸異質', '驗證寫法也卸']
          },
          { k: 'caller', v: ['你 + depth-0', '你 + depth-0', '你 + depth-0', '你 + depth-0'] },
          { k: 'foreman', v: ['無', '背景工頭', '背景工頭', '背景工頭'] },
          { k: 'implementer', v: ['同一個 thread', '工頭下面的 leaf', '異質引擎', '異質引擎'] },
          { k: 'review（engine）', v: ['可選／同生態', '工頭排程', '另一家', '另一家'] },
          { k: 'verification author', v: ['本地', '工頭節奏內', '多半 depth-0', '異質 leaf'] },
          { k: 'gate owner', v: ['depth-0', 'depth-0', 'depth-0', 'depth-0'] },
          { k: 'worktree', v: ['通常不用', '有', '有', '有'] }
        ]
      }
    : {
        title: 'Topology matrix (not “only who writes”)',
        cols: ['role', '/l3', '/l4', '/l5', '/l6'],
        rows: [
          {
            k: 'brain ctx',
            v: ['full run in-thread', 'exec off to foreman', 'impl off to hetero', 'verify-author off too']
          },
          { k: 'caller', v: ['you+depth-0', 'you+depth-0', 'you+depth-0', 'you+depth-0'] },
          { k: 'foreman', v: ['—', 'bg foreman', 'bg foreman', 'bg foreman'] },
          { k: 'implementer', v: ['same thread', 'foreman leaf', 'hetero engine', 'hetero engine'] },
          { k: 'review (engine)', v: ['optional/same', 'foreman-orch', 'other family', 'other family'] },
          { k: 'verification author', v: ['local', 'in foreman', 'mostly depth-0', 'hetero leaf'] },
          { k: 'gate owner', v: ['depth-0', 'depth-0', 'depth-0', 'depth-0'] },
          { k: 'worktree', v: ['usually no', 'yes', 'yes', 'yes'] }
        ]
      }
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '工程師視角 · 委派拓撲',
        pill2: 'GATE 不會因為層級變鬆',
        h1a: '四層差在拓撲，',
        h1b: '不是 gate 變鬆。',
        leadIntro: '先看一句話對照，細節在下面卡片與矩陣。depth-0 ＝ 你正在對話的這條主 thread。',
        leadRows: [
          { code: '/l3', text: '同一個 thread 跑完——過程全在 depth-0 ctx' },
          { code: '/l4', text: '背景工頭 + worktree——depth-0 留乾淨，執行卸出去' },
          { code: '/l5', text: '寫→審再卸異質——主因省 ctx，depth-0 長活做規劃協調' },
          { code: '/l6', text: '連驗證怎麼寫也卸——depth-0 幾乎只協調與終裁' }
        ],
        leadFoot: '不變：最終 gate 與 merge 權一直在 depth-0。',
        causeTitle: '為什麼要分層',
        causeLines: [
          '四層不是「誰比較會寫 code」的排行榜',
          '主因：把雜訊卸出 depth-0 的 context，讓 depth-0 長時間活著做規劃協調',
          '/l4 起用工頭；/l5 再卸實作；/l6 連 verification authoring 也卸'
        ],
        effectTitle: '分層之後你得到什麼',
        effectLines: [
          '選層級＝選「多少工作離開 depth-0 ctx」。',
          '附加紅利：Fable 這類高智慧模型只坐 depth-0 做規劃協調，機械實作卸給較省的異質引擎——省 token 也省 fee。',
          '你平常只在進場設紅線，真卡死才補一句。',
          'GATE 不因層級變鬆。'
        ],
        stackTitle: '四層細節',
        stackHint: '拓撲全表在上面。這裡只看：何時、為什麼、一句指令。',
        labels: {
          when: '何時',
          why: '為什麼',
          cmd: '指令'
        },
        linkDemo: '完整流程',
        linkRecipes: '起手任務'
      }
    : {
        pill1: 'Engineer narrative · delegation topology',
        pill2: 'GATE does not soften by level',
        h1a: 'Four levels change topology,',
        h1b: 'not gate softness.',
        leadIntro: 'One-line map first; cards and matrix below.',
        leadRows: [
          { code: '/l3', text: 'Inline same thread—full run lives in brain ctx' },
          { code: '/l4', text: 'Background foreman + worktree—keep the brain clean' },
          { code: '/l5', text: 'Hetero write→review—primary: save ctx so the brain stays long-lived' },
          { code: '/l6', text: 'Also offload verification authoring—brain mostly coords + final QC' }
        ],
        leadFoot: 'Unchanged: final gate and merge authority stay at depth-0.',
        causeTitle: 'Why levels exist',
        causeLines: [
          'The four levels are not a “who writes better” ladder',
          'Primary: offload noise from depth-0 ctx so the orchestrator stays long-lived for plan/coord',
          '/l4 adds a foreman; /l5 offloads implement; /l6 also offloads verification authoring'
        ],
        effectTitle: 'What you get',
        effectLines: [
          'The level you pick decides how much work leaves brain ctx.',
          'Bonus: once Fable-class models are available, the smartest brain plans and coordinates while the mechanical writing rides cheaper hetero engines — token and fee can drop too.',
          'You mostly set red lines at intake, and amend only when it is hard-stuck.',
          'GATE does not soften by level.'
        ],
        stackTitle: 'Four levels in detail',
        stackHint: 'Full topology is in the matrix above. Here: when, why, one command.',
        labels: {
          when: 'When',
          why: 'Why',
          cmd: 'Command'
        },
        linkDemo: 'State machine + /l5 trace',
        linkRecipes: 'Recipes'
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
          <div class="lp-lead-stack">
            <p class="lp-lead">{{ c.leadIntro }}</p>
            <ul class="lp-lead-list" aria-label="levels">
              <li v-for="row in c.leadRows" :key="row.code">
                <code>{{ row.code }}</code>
                <span>{{ row.text }}</span>
              </li>
            </ul>
            <p class="lp-lead-foot">{{ c.leadFoot }}</p>
          </div>
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="recipe-ce">
          <div class="recipe-ce__col recipe-ce__col--cause">
            <h3>{{ c.causeTitle }}</h3>
            <ul class="lp-bullet-stack">
              <li v-for="(line, i) in c.causeLines" :key="i">{{ line }}</li>
            </ul>
          </div>
          <div class="recipe-ce__col recipe-ce__col--effect" style="grid-column: span 2">
            <h3>{{ c.effectTitle }}</h3>
            <ul class="lp-bullet-stack">
              <li v-for="(line, i) in c.effectLines" :key="i">{{ line }}</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ matrix.title }}</p>
        <div class="eng-table-wrap">
          <table class="eng-table">
            <thead>
              <tr>
                <th v-for="col in matrix.cols" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in matrix.rows" :key="row.k">
                <td><code>{{ row.k }}</code></td>
                <td v-for="(cell, i) in row.v" :key="i">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.stackTitle }}</p>
          <p class="lv-stack-hint">{{ c.stackHint }}</p>
        </div>
        <div class="lv-grid">
          <article
            v-for="(lv, i) in levels"
            :key="lv.id"
            class="lv-card"
            :class="`lv-card--${lv.tone}`"
          >
            <header class="lv-card__head">
              <span class="lv-card__n" aria-hidden="true">0{{ i + 1 }}</span>
              <div class="lv-card__titles">
                <code class="lv-card__id">{{ lv.id }}</code>
                <h3 class="lv-card__name">{{ lv.n }}</h3>
              </div>
            </header>

            <p class="lv-card__when">
              <span class="lv-card__lab">{{ c.labels.when }}</span>
              {{ lv.when }}
            </p>

            <div class="lv-card__why">
              <span class="lv-card__lab">{{ c.labels.why }}</span>
              <p v-for="(line, wi) in lv.why" :key="wi" class="lv-card__why-line">{{ line }}</p>
            </div>

            <div class="lv-card__chips" role="list" aria-label="topology chips">
              <span v-for="(ch, ci) in lv.chips" :key="ci" class="lv-card__chip" role="listitem">
                <span class="lv-card__chip-k">{{ ch.k }}</span>
                <span class="lv-card__chip-v">{{ ch.v }}</span>
              </span>
            </div>

            <div class="lv-card__cmd">
              <span class="lv-card__lab">{{ c.labels.cmd }}</span>
              <code>{{ lv.cmd }}</code>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap lp-cta-row">
        <a class="lp-btn lp-btn--primary" :href="p('/demo')">{{ c.linkDemo }}</a>
        <a class="lp-btn lp-btn--ghost" :href="p('/recipes')">{{ c.linkRecipes }}</a>
        <a class="lp-btn lp-btn--ghost" :href="p('/install')">{{ zh ? '安裝' : 'Install' }}</a>
      </div>
    </section>
  </StoryChrome>
</template>
