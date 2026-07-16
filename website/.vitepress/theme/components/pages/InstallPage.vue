<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

const DECK_DAY =
  'https://cookys.github.io/ai-coding-slides/deck3-fable5.zh-TW.html#9'
const DECK_DAY2 =
  'https://cookys.github.io/ai-coding-slides/deck3-fable5.zh-TW.html#18'

const hosts = computed(() =>
  zh.value
    ? [
        { n: 'Claude Code', d: '主戰場。skills、hooks、/l3–/l6 全有。', ok: true },
        { n: 'Codex', d: 'skills + 配套。不宣稱 hook 對等。', ok: false },
        { n: 'OpenCode', d: '共用 skills。hook 看平台。', ok: false },
        { n: 'agy', d: '守衛式安裝。runtime hook 未完整驗。', ok: false }
      ]
    : [
        { n: 'Claude Code', d: 'Full path: skills, hooks, /l3–/l6.', ok: true },
        { n: 'Codex', d: 'Skills + payload. No hook parity claim.', ok: false },
        { n: 'OpenCode', d: 'Shared skills. Hook parity varies.', ok: false },
        { n: 'agy', d: 'Guarded install. Runtime hooks unverified.', ok: false }
      ]
)

/** Day-one case: deck3 hands-on #9–#17 (onboard → scan → /next → quality-pipeline) */
const dayCase = computed(() =>
  zh.value
    ? {
        kicker: '實際案例 · 一天入手',
        title: '帶自己的 repo 來，走冷啟動',
        thesisLines: [
          '不是 demo 劇本。',
          '練習素材是 AI 掃你自己的 repo 掃出來的。',
          '你只在裁決點出現；中間系統 ↺。'
        ],
        sourceLabel: '作法來源',
        sourceText: '課程 hands-on（deck #9–#17）',
        sourceHref: DECK_DAY,
        phases: [
          {
            id: 'A',
            title: '上午 · 接管你家',
            who: 'human-outer',
            steps: [
              { n: '01', t: '裝起來', d: '兩行 plugin。斜線能看到 autopilot 指令。' },
              { n: '02', t: '/onboard 體檢', d: '它讀 repo：套件、測試、門檻、慣例、該保護的路徑。給建議＋理由。' },
              { n: '03', t: '蓋基礎設施', d: '設定檔＋常駐 context（專案摘要／架構／慣例）。機密排除先做。' },
              { n: '04', t: '答它的反問', d: '2–3 題。答案寫進常駐檔，以後不用再講。' },
              { n: '05', t: '裁決設定', d: '接受一條、改嚴一條、關掉一條。你在練裁決權，不是學語法。' }
            ]
          },
          {
            id: 'B',
            title: '下午 · 第一條真任務',
            who: 'sys-inner',
            steps: [
              { n: '06', t: '開掃改進機會', d: '安全／效率／UX／可化簡 flow。每項要有檔案或流程出處。' },
              { n: '07', t: 'plan／backlog 分流', d: '現在做 → plan。不是現在 → backlog＋觸發條件。沒觸發條件的不收。' },
              { n: '08', t: '/next', d: '系統推薦下一步＋理由。你只說：好／換一個／跳過。' },
              { n: '09', t: '開工你只裁決', d: '它反問、分級、開分支、展開工作單。你監看與拍板，不是打字。' },
              { n: '10', t: '驗收一條龍', d: '測試 → 完整性掃描 → 獨立 review。看 evidence，不看「做完了」。' }
            ]
          }
        ],
        takeTitle: '帶走卡 · 三行就夠',
        take: [
          { k: '冷啟動', v: 'onboard → 基礎設施＋機密 → 答反問 → 掃描 → plan/backlog → /next' },
          { k: '日常', v: '/next → 開工（答反問、裁決）→ 驗收一條龍 → 收尾交接' },
          { k: '隔天', v: '第一次委派從 /l3 開始——紅線先寫好' }
        ],
        youOnly: '你這一天在練的事：對預設行使裁決、對證據驗收。不是當 AI 的中繼站。'
      }
    : {
        kicker: 'Case · day one',
        title: 'Bring your own repo—cold-start SOP',
        thesisLines: [
          'Not a scripted demo.',
          'Tasks come from AI scanning your real repo.',
          'You only show up at adjudication; the system ↺ the middle.'
        ],
        sourceLabel: 'Source',
        sourceText: 'Workshop hands-on (zh-TW deck #9–#17)',
        sourceHref: DECK_DAY,
        phases: [
          {
            id: 'A',
            title: 'Morning · take over the house',
            who: 'human-outer',
            steps: [
              { n: '01', t: 'Install', d: 'Two plugin lines. Slash commands list autopilot.' },
              { n: '02', t: '/onboard checkup', d: 'It reads package manager, tests, thresholds, docs, protected paths—plus rationale.' },
              { n: '03', t: 'Scaffold infra', d: 'Config + standing context (summary / architecture / norms). Secrets excluded first.' },
              { n: '04', t: 'Answer its questions', d: '2–3 clarifying Qs. Answers land in standing files—never re-teach.' },
              { n: '05', t: 'Adjudicate settings', d: 'Accept one, tighten one, turn one off. Practice judgment, not config syntax.' }
            ]
          },
          {
            id: 'B',
            title: 'Afternoon · first real task',
            who: 'sys-inner',
            steps: [
              { n: '06', t: 'Scan opportunities', d: 'Security / speed / UX / simplifiable flows. Every item needs a file or process source.' },
              { n: '07', t: 'Plan vs backlog', d: 'Now → plan. Later → backlog with a trigger. No trigger → don’t accept.' },
              { n: '08', t: '/next', d: 'System recommends next + why. You say: yes / swap / skip.' },
              { n: '09', t: 'Start—you only adjudicate', d: 'It asks, sizes, branches, opens a work order. You watch and decide—not type.' },
              { n: '10', t: 'Acceptance pipeline', d: 'Tests → completeness scan → independent review. Evidence, not “done.”' }
            ]
          }
        ],
        takeTitle: 'Takeaway · three lines',
        take: [
          { k: 'Cold start', v: 'onboard → infra+secrets → Q&A → scan → plan/backlog → /next' },
          { k: 'Daily', v: '/next → work (answer, adjudicate) → acceptance → finish handoff' },
          { k: 'Next day', v: 'First delegation starts at /l3—red lines first' }
        ],
        youOnly: 'What you practice that day: adjudicate defaults and verify evidence—not babysit the model mid-loop.'
      }
)

/** Day-two: first delegation — hetero DAY-2-SPLIT (deck #18–#20, site is short) */
const day2Case = computed(() =>
  zh.value
    ? {
        kicker: '第二天 · 第一次委派',
        title: '冷啟動穩了，再開第一槍',
        thesisLines: [
          '第一天是校準，不是假裝已經全自動。你確認工作單與驗收標準。',
          '完整委派從第二天 /l3 開始——你不接手 mid-loop 膠水。'
        ],
        sourceLabel: '細節與計時',
        sourceText: '課程 hands-on（deck #18–#20）',
        sourceHref: DECK_DAY2,
        steps: [
          {
            n: '01',
            t: '/l3 · 交出目標',
            d: '目標＋紅線。它全權跑到邊界才問你。問的應是真問題，不是變數命名。'
          },
          {
            n: '02',
            t: '你只看三件事',
            d: '有沒有踩 no-go？裁決點清不清楚？證據能不能重跑？'
          },
          {
            n: '03',
            t: '/l4 · 更長的丟背景',
            d: '隔離 worktree 整段跑完，帶 diff／測試回來。主線故意做別的事。'
          }
        ],
        take: 'Write ≠ review。Artifact ≠ self-report。人只守外圈。',
        ctaDeck: '打開委派 hands-on',
        ctaLevels: '看委派層級'
      }
    : {
        kicker: 'Day two · first delegation',
        title: 'After cold start, hand off the first shot',
        thesisLines: [
          'Day one: system knows the repo; you practiced adjudicate + evidence.',
          'Day two: hand over a goal—don’t become mid-loop glue.'
        ],
        sourceLabel: 'Timed detail',
        sourceText: 'Workshop hands-on (zh-TW deck #18–#20)',
        sourceHref: DECK_DAY2,
        steps: [
          {
            n: '01',
            t: '/l3 · hand over the goal',
            d: 'Goal + red lines. It runs until a real boundary—not “name this variable.”'
          },
          {
            n: '02',
            t: 'You check three things only',
            d: 'No-go hit? Adjudication clear? Evidence re-runnable?'
          },
          {
            n: '03',
            t: '/l4 · longer work in background',
            d: 'Isolated worktree finishes with diff/tests. You do something else on the main thread.'
          }
        ],
        take: 'Write ≠ review. Artifact ≠ self-report. Human stays on the outer ring.',
        ctaDeck: 'Open delegation hands-on (zh-TW)',
        ctaLevels: 'See levels'
      }
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '只講 happy path',
        pill2: '裝好＝能下指令，再走一天冷啟動',
        h1a: '兩行裝好。',
        h1b: '同一天接手自家 repo。',
        leadLines: [
          '什麼叫裝成功：斜線能看到 autopilot。',
          '什麼叫一天入手：常駐 context 就位、有 backlog、跑過一輪 /next→驗收。',
          '細節與計時見課程投影片（可重跑任意 repo）。'
        ],
        stepTitle: '安裝（Claude Code）',
        steps: [
          '/plugin marketplace add cookys/autopilot',
          '/plugin install autopilot@autopilot'
        ],
        hostTitle: '平台支援度（老實講）',
        hostLead: '同一套 plugin 在不同工具上能跑多少，先說清楚，免得裝完才發現缺一半。',
        engTitle: '第二家引擎（可以晚點再接）',
        engLines: [
          '光 Claude 就能跑 /l3 與冷啟動。',
          '若要 /l5 異質寫審，或 QC panel 多家，再裝 codex／agy／grok。',
          '並設好 review-loop／endpoints（細節在 repo docs）。'
        ],
        wrongTitle: '第一天常見誤區',
        wrongLead: '這四件事最常把第一天搞砸——先繞開。',
        wrong: [
          '別去找 npx install autopilot 這種假路徑',
          '別跳過 onboard 直接 /l6 整包重寫',
          '別把「模型說做完了」當成 DONE',
          '別把沒觸發條件的願望塞進 backlog'
        ],
        next: [
          { t: '完整流程', h: '/demo' },
          { t: '起手任務', h: '/recipes' },
          { t: '委派層級', h: '/levels' }
        ]
      }
    : {
        pill1: 'Happy path only',
        pill2: 'Installed = commands work; then day-one cold start',
        h1a: 'Two commands.',
        h1b: 'Same day: take over your repo.',
        leadLines: [
          'Installed means slash lists autopilot.',
          'Day one means standing context, a backlog, and one /next→accept loop.',
          'Timed detail lives in the workshop deck (rerun on any repo).'
        ],
        stepTitle: 'Install (Claude Code)',
        steps: [
          '/plugin marketplace add cookys/autopilot',
          '/plugin install autopilot@autopilot'
        ],
        hostTitle: 'Platform support (honestly)',
        hostLead: 'How much of the plugin runs on each tool — said upfront, so nothing surprises you after install.',
        engTitle: 'Second engine (later OK)',
        engLines: [
          'Claude alone covers /l3 and cold start.',
          'For /l5 hetero write/review or multi-family QC, add subscription CLIs (codex/agy/grok).',
          'Wire review-loop/endpoints (repo docs).'
        ],
        wrongTitle: 'Day-one pitfalls',
        wrongLead: 'Four habits that most often ruin day one — route around them.',
        wrong: [
          'No invented npx install paths',
          'No skip-onboard /l6 whole-repo rewrite',
          'No “model said done” as DONE',
          'No wish-list backlog without triggers'
        ],
        next: [
          { t: 'Demo', h: '/demo' },
          { t: 'Recipes', h: '/recipes' },
          { t: 'Levels', h: '/levels' }
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
          <pre class="st-terminal st-terminal--hero"><code>{{ c.steps.join('\n') }}</code></pre>
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.stepTitle }}</p>
        </div>
        <ol class="st-big-steps">
          <li v-for="(s, i) in c.steps" :key="s">
            <span>{{ i + 1 }}</span>
            <code>{{ s }}</code>
          </li>
        </ol>
      </div>
    </section>

    <!-- Day-one practical case (deck #9–#17) -->
    <section id="day-one" class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ dayCase.kicker }}</p>
          <p class="eng-h2">{{ dayCase.title }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight">
            <p v-for="(line, i) in dayCase.thesisLines" :key="i" class="lp-lead">{{ line }}</p>
          </div>
          <p class="day-source">
            <span class="day-source__lab">{{ dayCase.sourceLabel }}</span>
            <a
              class="day-source__link"
              :href="dayCase.sourceHref"
              target="_blank"
              rel="noreferrer"
            >{{ dayCase.sourceText }}</a>
          </p>
        </div>

        <div class="day-phases">
          <article
            v-for="ph in dayCase.phases"
            :key="ph.id"
            class="day-phase"
            :class="ph.who === 'human-outer' ? 'day-phase--human' : 'day-phase--sys'"
          >
            <header class="day-phase__head">
              <span class="day-phase__id">{{ ph.id }}</span>
              <h3>{{ ph.title }}</h3>
            </header>
            <ol class="day-steps">
              <li v-for="s in ph.steps" :key="s.n" class="day-step">
                <span class="day-step__n">{{ s.n }}</span>
                <div class="day-step__body">
                  <strong>{{ s.t }}</strong>
                  <p>{{ s.d }}</p>
                </div>
              </li>
            </ol>
          </article>
        </div>

        <p class="day-you-only">{{ dayCase.youOnly }}</p>

        <div class="day-take">
          <p class="lp-kicker">{{ dayCase.takeTitle }}</p>
          <div class="day-take__rows">
            <div v-for="row in dayCase.take" :key="row.k" class="day-take__row">
              <span class="day-take__k">{{ row.k }}</span>
              <span class="day-take__v">{{ row.v }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Day-two first delegation (hetero: DAY-2-SPLIT) -->
    <section id="day-two" class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ day2Case.kicker }}</p>
          <p class="eng-h2">{{ day2Case.title }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight">
            <p v-for="(line, i) in day2Case.thesisLines" :key="i" class="lp-lead">{{ line }}</p>
          </div>
          <p class="day-source">
            <span class="day-source__lab">{{ day2Case.sourceLabel }}</span>
            <a
              class="day-source__link"
              :href="day2Case.sourceHref"
              target="_blank"
              rel="noreferrer"
            >{{ day2Case.sourceText }}</a>
          </p>
        </div>

        <ol class="day-steps day-steps--solo">
          <li v-for="s in day2Case.steps" :key="s.n" class="day-step">
            <span class="day-step__n">{{ s.n }}</span>
            <div class="day-step__body">
              <strong>{{ s.t }}</strong>
              <p>{{ s.d }}</p>
            </div>
          </li>
        </ol>

        <p class="day-you-only">{{ day2Case.take }}</p>

        <div class="lp-cta-row" style="margin-top: 1.1rem">
          <a
            class="lp-btn lp-btn--primary"
            :href="day2Case.sourceHref"
            target="_blank"
            rel="noreferrer"
          >{{ day2Case.ctaDeck }}</a>
          <a class="lp-btn lp-btn--ghost" :href="p('/levels')">{{ day2Case.ctaLevels }}</a>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.hostTitle }}</p>
          <p class="lp-lead srail-lead">{{ c.hostLead }}</p>
        </div>
        <div class="lp-bento">
          <article
            v-for="h in hosts"
            :key="h.n"
            class="lp-card"
            :class="h.ok ? 'lp-card--ceo' : ''"
          >
            <h3>{{ h.n }}</h3>
            <p>{{ h.d }}</p>
          </article>
        </div>
        <div class="lp-lead-stack" style="margin-top: 1.25rem">
          <p class="lp-kicker">{{ c.engTitle }}</p>
          <div class="recipe-notes">
            <p v-for="(line, i) in c.engLines" :key="i" class="recipe-notes__line">{{ line }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.wrongTitle }}</p>
          <p class="lp-lead srail-lead">{{ c.wrongLead }}</p>
        </div>
        <div class="recipe-notes">
          <p v-for="w in c.wrong" :key="w" class="recipe-notes__line">{{ w }}</p>
        </div>
        <div class="lp-cta-row" style="margin-top: 1.5rem">
          <a v-for="n in c.next" :key="n.h" class="lp-btn lp-btn--ghost" :href="p(n.h)">{{ n.t }}</a>
          <a
            class="lp-btn lp-btn--primary"
            :href="DECK_DAY"
            target="_blank"
            rel="noreferrer"
          >{{ zh ? '打開課程 hands-on' : 'Open workshop deck (zh-TW)' }}</a>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
