<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ lang?: 'en' | 'zh-TW' }>(),
  { lang: 'en' }
)

const zh = computed(() => props.lang === 'zh-TW')
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)
const a = (name: string) => withBase(`/assets/${name}`)

/** hetero author panel 2026-07-16: dual-day timeline, not state-lookup tabs */
const t = computed(() =>
  zh.value
    ? {
        badge: '給想當 CEO 的人 · 也給快被雜事跟 AI 產能壓垮的人',
        badge2: '今天，我們發隕石給 CEO。',
        h1a: 'Claude Code 讓你寫得快。',
        h1b: 'Autopilot 讓你不用一直坐在位子上。',
        defLines: [
          'Autopilot 是開發流程的 CEO agent。',
          '選項先想清楚、取捨做完，code 寫完也審完。',
          '只有真的卡關或踩紅線才叫你。'
        ],
        leadLines: [
          '不是又一套 prompt 模板，也不是要你當 full-time reviewer。',
          '模型會 tool use、改檔、說改好了——真正耗你的是後面那整段驗證。'
        ],
        cta: '完整流程',
        cta2: '快速安裝',
        cta3: 'GitHub',
        cta4: '起手任務',
        installLine: '/plugin marketplace add cookys/autopilot',
        rolesTitle: '三個角色，別混在一起',
        roles: [
          {
            k: '你',
            d: '只定目標、紅線、不能退讓的條件',
            sub: '不是每二十分鐘回一句「好，繼續」'
          },
          {
            k: 'CEO agent',
            d: '資訊夠了就做取捨，自己往下推',
            sub: 'survey、辯論、多引擎意見都餵給它'
          },
          {
            k: '審查系統',
            d: '強模型當 peer、panel 挑問題、腳本當閘',
            sub: '信 diff 跟測試，不信「我覺得過了」'
          }
        ],
        // Nested loops (aligned with /demo): human in every ring vs outer-only
        loopTitle: '你的時間，差在哪',
        loopThesis: '人卡在幾層 loop 裡',
        loopLeads: [
          '一般 AI coding 是三層 loop 套在一起，人卡在每一層。',
          'Autopilot 把內兩層吃掉，人只留最外圍。'
        ],
        loopLegendHuman: '人在 loop 裡',
        loopLegendSys: '系統在 loop 裡',
        alwaysTag: '一直在場',
        alwaysSub: '三層 loop 都卡你',
        alwaysNotes: [
          '多發想解法是真的。',
          '代價：中層 spec、內層驗證也一直叫你回來。'
        ],
        autoTag: '可以離席',
        autoSub: '只剩最外圍 loop',
        autoNotes: [
          '內兩層交給系統。',
          '有內建用內建，沒有就找業界 best practice。',
          '你講死 no-go，不是每一行。'
        ],
        nestBad: [
          {
            depth: 1,
            who: 'human',
            title: '外層 · 任務',
            cycle: '目標 → 做完？→ 再補一句',
            beats: ['你定方向', '你收尾']
          },
          {
            depth: 2,
            who: 'human',
            title: '中層 · 發想／spec',
            cycle: '方案 → 你決 → 細節 → 你再決',
            beats: ['取捨 A/B', '每個細節 spec 拍板']
          },
          {
            depth: 3,
            who: 'human',
            title: '內層 · 寫完了嗎',
            cycle: '改檔 →「好了」→ 你驗 → 再回嘴',
            beats: ['模型 tool use', '你當驗證中繼']
          }
        ],
        nestGood: [
          {
            depth: 1,
            who: 'human',
            title: '外層 · 任務（只這層是你）',
            cycle: '目標＋no-go → 產物／越線才叫你',
            beats: ['進場講死紅線', '看 artifact', '真卡死才補一句']
          },
          {
            depth: 2,
            who: 'sys',
            title: '中層 · 發想／spec（系統 ↺）',
            cycle: '內建 → 否則 survey → CEO 取捨',
            beats: ['有內建先走', '沒有找 best practice', 'no-go 內擴砍選路']
          },
          {
            depth: 3,
            who: 'sys',
            title: '內層 · 寫→審→閘（系統 ↺）',
            cycle: '實作 ⇄ 異質審 ⇄ 機械閘',
            beats: ['tool use 改檔', '寫審分家', '不靠自報 done']
          }
        ],
        badNote: '三層都 ↺ 你 → 你是最慢的那一環',
        loopClose: 'Autopilot 不是少步驟——是內兩層 loop 不再把你拉進去。',
        loopFoot: '巢狀 loop 與工程狀態總表收在「完整流程」，當工程附錄看。',
        loopDemo: '看完整控制流',
        meteorTitle: '「隕石」一句話',
        meteorLines: [
          '你丟進去的硬條件：目標、紅線、不能退讓。',
          '系統要接住、往前推、擋歪——不是罵人黑話。'
        ],
        whoTitle: '誰會對味',
        who: [
          { t: '想用 CEO 視角帶專案', d: '平常只出現在進場與真的越線時' },
          { t: '不想被雜事釘在聊天室', d: '中間別再等人按繼續' },
          { t: 'AI 越幫越累', d: '驗證從你日常拆出去' }
        ],
        proofTitle: '為什麼敢少盯',
        proofSub: '不是嘴砲保證——要留得下可追的東西',
        proof: [
          { k: 'artifact', d: 'commit、diff、測試結果' },
          { k: '寫審分家', d: '寫的人跟審的人不是同一張嘴' },
          { k: '翻車也公開', d: '實驗失敗寫進 changelog' }
        ],
        proofCta: '翻車紀錄',
        day1Title: '實際案例 · 一天入手',
        day1Thesis: '帶自己的 repo，不是 demo 劇本',
        day1Leads: [
          '上午：/onboard 體檢 → 基礎設施＋常駐 context → 答反問 → 裁決設定。',
          '下午：掃描改進 → plan/backlog → /next → 開工你只裁決 → 驗收一條龍。',
          '你只在裁決點；中間系統 ↺。'
        ],
        day1Steps: [
          { n: '1', t: '裝 plugin' },
          { n: '2', t: 'onboard 接管' },
          { n: '3', t: '掃出真任務' },
          { n: '4', t: '/next 開跑' },
          { n: '5', t: '驗收看 evidence' }
        ],
        day1CardTitle: '帶走三行',
        day1Card: [
          '冷啟動：onboard → 基礎設施 → 答反問 → 掃描 → /next',
          '日常：/next → 裁決 → 驗收 → 收尾',
          '隔天：第一次委派從 /l3 開始'
        ],
        day1Cta: '去快速安裝（含一天步驟）',
        day1Deck: '課程 hands-on',
        day2Title: '第二天 · 第一次委派',
        day2Lines: [
          '/l3：你給目標＋紅線，系統跑內圈。',
          '/l4：更長任務丟背景，主線做別的。',
          '你回來只看 no-go、裁決、證據。'
        ],
        day2Cta: '看第一次委派',
        installTitle: '兩行裝起來',
        installBody: 'Claude Code 最完整。裝完同一天就能冷啟動自家 repo。',
        code1: '/plugin marketplace add cookys/autopilot',
        code2: '/plugin install autopilot@autopilot',
        installCta: '快速安裝',
        links: [
          { l: '完整流程', h: '/demo' },
          { l: '起手任務', h: '/recipes' },
          { l: '設計理念', h: '/philosophy' },
          { l: '翻車紀錄', h: '/proof' },
          { l: '委派層級', h: '/levels' },
          { l: '敘事定稿', h: 'https://github.com/cookys/autopilot/blob/develop/website/NARRATIVE.md' }
        ],
        foot: '人盡量別卡在 loop 裡 · 多元想全 · 收斂防歪 · 隕石丟給 CEO'
      }
    : {
        badge: 'For would-be CEOs · and people crushed by chores & AI output',
        badge2: 'Today we hand meteors to CEOs.',
        h1a: 'Claude Code makes you faster.',
        h1b: 'Autopilot lets you step away.',
        defLines: [
          'Autopilot is a CEO-agent for development work.',
          'Gather viewpoints, make tradeoffs, write and review end-to-end.',
          'Only page you when stuck or out of bounds.'
        ],
        leadLines: [
          'Not another prompt pack. Not you as full-time babysitter.',
          'Models tool-use, edit files, say “done”—the cost is the verification you still own.'
        ],
        cta: 'See one full run',
        cta2: 'Open install guide',
        cta3: 'GitHub',
        cta4: 'First jobs',
        installLine: '/plugin marketplace add cookys/autopilot',
        rolesTitle: 'Three roles—don’t mix them up',
        roles: [
          {
            k: 'You',
            d: 'Goals, red lines, non-negotiables',
            sub: 'Not “ok, continue” every twenty minutes'
          },
          {
            k: 'CEO-agent',
            d: 'Tradeoffs with fuller context, then advance',
            sub: 'Fed by survey / debate / multi-engine takes'
          },
          {
            k: 'Review system',
            d: 'Hard peers, panel nags, mechanical gates',
            sub: 'Diffs and tests—not “I feel done”'
          }
        ],
        loopTitle: 'Where your time goes',
        loopThesis: 'How many loops are you stuck inside?',
        loopLeads: [
          'Default AI coding is three nested loops—with you in every layer.',
          'Autopilot eats the inner two; you only keep the outer ring.'
        ],
        loopLegendHuman: 'Human in the loop',
        loopLegendSys: 'System in the loop',
        alwaysTag: 'Always on',
        alwaysSub: 'Stuck in all three loops',
        alwaysNotes: [
          'More solution ideation is real.',
          'Cost: mid-layer specs and inner verify still page you every turn.'
        ],
        autoTag: 'Step away',
        autoSub: 'Only the outer loop is yours',
        autoNotes: [
          'Inner two layers are the system’s.',
          'Built-ins first; else industry best practice.',
          'You lock no-gos, not every line.'
        ],
        nestBad: [
          {
            depth: 1,
            who: 'human',
            title: 'Outer · mission',
            cycle: 'goal → done? → re-prompt',
            beats: ['you set direction', 'you close out']
          },
          {
            depth: 2,
            who: 'human',
            title: 'Mid · ideation / spec',
            cycle: 'options → you decide → details → you again',
            beats: ['tradeoff A/B', 'every micro-spec stamp']
          },
          {
            depth: 3,
            who: 'human',
            title: 'Inner · is it done?',
            cycle: 'edit → “done” → you verify → re-prompt',
            beats: ['model tool use', 'you as verification glue']
          }
        ],
        nestGood: [
          {
            depth: 1,
            who: 'human',
            title: 'Outer · mission (your only ring)',
            cycle: 'goal + no-go → artifacts / page on breach',
            beats: ['lock red lines up front', 'inspect artifacts', 'amend only if hard stuck']
          },
          {
            depth: 2,
            who: 'sys',
            title: 'Mid · ideation / spec (system ↺)',
            cycle: 'built-in → else survey → CEO tradeoff',
            beats: ['built-ins first', 'survey best practice', 'cut/expand inside no-gos']
          },
          {
            depth: 3,
            who: 'sys',
            title: 'Inner · write→review→gate (system ↺)',
            cycle: 'implement ⇄ hetero review ⇄ gates',
            beats: ['tool-use edits', 'write ≠ review', 'no self-report done']
          }
        ],
        badNote: 'All three ↺ you → you are the slowest link',
        loopClose: 'Autopilot isn’t fewer steps—it’s the inner two loops no longer pulling you in.',
        loopFoot: 'Nested loops + the full state table live on Demo, as the engineering appendix.',
        loopDemo: 'See full control flow',
        meteorTitle: '“Meteor” in one line',
        meteorLines: [
          'Hard constraints you throw in: goals, red lines, non-negotiables.',
          'The system must catch, advance, and block drift.'
        ],
        whoTitle: 'Who this is for',
        who: [
          { t: 'CEO-altitude work', d: 'Show up at intake and real red lines' },
          { t: 'Out of the small stuff', d: 'Mid-path stops waiting on “continue”' },
          { t: 'AI-output burnout', d: 'Verification leaves your day job' }
        ],
        proofTitle: 'Why you can watch less',
        proofSub: 'Not verbal guarantees—traceable leftovers',
        proof: [
          { k: 'artifacts', d: 'commits, diffs, test results' },
          { k: 'split roles', d: 'writer ≠ rubber-stamp reviewer' },
          { k: 'public scars', d: 'failed experiments in the changelog' }
        ],
        proofCta: 'See proof',
        day1Title: 'Case · day one',
        day1Thesis: 'Your repo—not a scripted demo',
        day1Leads: [
          'Morning: /onboard → standing context → answer Qs → adjudicate settings.',
          'Afternoon: scan → plan/backlog → /next → you only adjudicate → acceptance pipeline.',
          'You at decision points only; system ↺ the middle.'
        ],
        day1Steps: [
          { n: '1', t: 'Install plugin' },
          { n: '2', t: 'Onboard takeover' },
          { n: '3', t: 'Scan real tasks' },
          { n: '4', t: '/next run' },
          { n: '5', t: 'Accept on evidence' }
        ],
        day1CardTitle: 'Three lines to keep',
        day1Card: [
          'Cold start: onboard → infra → Q&A → scan → /next',
          'Daily: /next → adjudicate → accept → finish',
          'Next day: first delegation starts at /l3'
        ],
        day1Cta: 'Open install guide (incl. day one)',
        day1Deck: 'Workshop hands-on (zh-TW)',
        day2Title: 'Day two · first delegation',
        day2Lines: [
          '/l3: goal + red lines; system runs the inner loop.',
          '/l4: longer work in background; you do something else.',
          'You return for no-go, adjudication, evidence only.'
        ],
        day2Cta: 'See first delegation',
        installTitle: 'Two commands in',
        installBody: 'Claude Code is the full path. Same day you can cold-start your own repo.',
        code1: '/plugin marketplace add cookys/autopilot',
        code2: '/plugin install autopilot@autopilot',
        installCta: 'Install guide',
        links: [
          { l: 'Demo', h: '/demo' },
          { l: 'Recipes', h: '/recipes' },
          { l: 'Why', h: '/philosophy' },
          { l: 'Proof', h: '/proof' },
          { l: 'Levels', h: '/levels' },
          { l: 'Narrative freeze', h: 'https://github.com/cookys/autopilot/blob/develop/website/NARRATIVE.md' }
        ],
        foot: 'Humans mostly out · diverge · converge · meteors for CEOs'
      }
)

function href(h: string) {
  return h.startsWith('http') ? h : p(h)
}
</script>

<template>
  <div class="lp" :class="{ 'lp--zh': zh }">
    <!-- HERO -->
    <header class="lp-hero">
      <img class="lp-hero__bg" :src="a('bg-grid.jpg')" alt="" />
      <div class="lp-hero__shade" />
      <div class="lp-wrap lp-hero__content">
        <div class="lp-hero__text">
          <div class="lp-pills">
            <span class="lp-pill">{{ t.badge }}</span>
            <span class="lp-pill lp-pill--amber">{{ t.badge2 }}</span>
          </div>
          <h1>
            <span>{{ t.h1a }}</span>
            <span class="lp-h1-accent">{{ t.h1b }}</span>
          </h1>
          <div class="lp-lead-stack lp-lead-stack--hero">
            <p v-for="(line, i) in t.defLines" :key="'d' + i" class="lp-def">{{ line }}</p>
            <p v-for="(line, i) in t.leadLines" :key="'l' + i" class="lp-lead">{{ line }}</p>
          </div>
          <div class="lp-cta-row">
            <a class="lp-btn lp-btn--primary" :href="p('/demo')">{{ t.cta }}</a>
            <a class="lp-btn lp-btn--ghost" :href="p('/install')">{{ t.cta2 }}</a>
            <a class="lp-btn lp-btn--ghost" :href="p('/recipes')">{{ t.cta4 }}</a>
            <a
              class="lp-btn lp-btn--link"
              href="https://github.com/cookys/autopilot"
              target="_blank"
              rel="noreferrer"
            >{{ t.cta3 }}</a>
          </div>
          <div class="lp-hero__install">
            <code class="lp-code lp-code--hero">{{ t.code1 }}</code>
            <code class="lp-code lp-code--hero">{{ t.code2 }}</code>
          </div>
        </div>
        <div class="lp-hero__visual">
          <div class="lp-console" aria-hidden="true">
            <div class="lp-console__bar">
              <span /><span /><span />
              <em>ceo-agent · run</em>
            </div>
            <div class="lp-console__body">
              <p class="dim">❯ goal + red lines</p>
              <p class="vio">· survey / think-tank / multi-engine</p>
              <p class="amb">· CEO tradeoff → advance</p>
              <p class="cya">· write ≠ review · gates</p>
              <p class="ok">✓ artifact · escalate only if stuck</p>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- THREE ROLES -->
    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ t.rolesTitle }}</p>
        </div>
        <div class="lp-who">
          <article v-for="r in t.roles" :key="r.k" class="lp-who__card">
            <h3>{{ r.k }}</h3>
            <p>{{ r.d }}</p>
            <p class="lp-who__sub">{{ r.sub }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Nested loops: human in every ring vs outer-only (same spine as /demo) -->
    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ t.loopTitle }}</p>
          <p class="eng-h2 lp-loop-thesis">{{ t.loopThesis }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight lp-day-leads">
            <p v-for="(line, i) in t.loopLeads" :key="'ld' + i" class="lp-lead">{{ line }}</p>
          </div>
          <div class="nest-legend" aria-hidden="true">
            <span class="nest-legend__item nest-legend__item--human">
              <i />{{ t.loopLegendHuman }}
            </span>
            <span class="nest-legend__item nest-legend__item--sys">
              <i />{{ t.loopLegendSys }}
            </span>
          </div>
        </div>

        <div class="demo-compare demo-compare--nest" role="group" :aria-label="t.loopThesis">
          <article class="demo-compare__col demo-compare__col--bad">
            <header class="demo-compare__head">
              <span class="demo-compare__tag demo-compare__tag--bad">{{ t.alwaysTag }}</span>
              <h2>{{ t.alwaysSub }}</h2>
              <p v-for="(line, i) in t.alwaysNotes" :key="'an' + i">{{ line }}</p>
            </header>

            <div class="nest-stack nest-stack--bad" role="list">
              <div
                v-for="ring in t.nestBad"
                :key="'nb' + ring.depth"
                class="nest-ring nest-ring--human"
                role="listitem"
                :style="{ '--nest-d': ring.depth }"
              >
                <div class="nest-ring__bar">
                  <span class="nest-ring__depth">L{{ ring.depth }}</span>
                  <span class="nest-ring__title">{{ ring.title }}</span>
                  <span class="nest-ring__who">{{ zh ? '人' : 'you' }}</span>
                  <span class="nest-ring__spin" aria-hidden="true">↺</span>
                </div>
                <p class="nest-ring__cycle">{{ ring.cycle }}</p>
                <div class="nest-ring__beats">
                  <span v-for="(b, bi) in ring.beats" :key="bi" class="nest-ring__beat">{{ b }}</span>
                </div>
              </div>
            </div>

            <p class="rail-tl__cycle" role="note">
              <span class="rail-tl__cycle-icon" aria-hidden="true">↺</span>
              {{ t.badNote }}
            </p>
          </article>

          <div class="demo-compare__mid">
            <span class="demo-compare__mid-label" aria-hidden="true">
              <span class="demo-compare__mid-text">{{ zh ? '改成' : 'becomes' }}</span>
              <span class="demo-compare__mid-arrow">↓</span>
            </span>
            <span class="sr-only">{{
              zh
                ? '左邊：三層 loop 都卡人。右邊：內兩層系統跑，人只留最外圍。'
                : 'Left: human inside all three loops. Right: system owns the inner two; human only the outer ring.'
            }}</span>
          </div>

          <article class="demo-compare__col demo-compare__col--good">
            <header class="demo-compare__head">
              <span class="demo-compare__tag demo-compare__tag--good">{{ t.autoTag }}</span>
              <h2>{{ t.autoSub }}</h2>
              <p v-for="(line, i) in t.autoNotes" :key="'on' + i">{{ line }}</p>
            </header>

            <div class="nest-stack nest-stack--good" role="list">
              <div
                v-for="ring in t.nestGood"
                :key="'ng' + ring.depth"
                class="nest-ring"
                :class="ring.who === 'human' ? 'nest-ring--human nest-ring--outer' : 'nest-ring--sys'"
                role="listitem"
                :style="{ '--nest-d': ring.depth }"
              >
                <div class="nest-ring__bar">
                  <span class="nest-ring__depth">L{{ ring.depth }}</span>
                  <span class="nest-ring__title">{{ ring.title }}</span>
                  <span class="nest-ring__who">{{
                    ring.who === 'human' ? (zh ? '人' : 'you') : zh ? '系統' : 'sys'
                  }}</span>
                  <span class="nest-ring__spin" aria-hidden="true">↺</span>
                </div>
                <p class="nest-ring__cycle">{{ ring.cycle }}</p>
                <div class="nest-ring__beats">
                  <span v-for="(b, bi) in ring.beats" :key="bi" class="nest-ring__beat">{{ b }}</span>
                </div>
              </div>
            </div>

            <p class="rail-tl__payoff">{{ t.loopClose }}</p>
          </article>
        </div>

        <div class="lp-beats__foot lp-day-foot">
          <p>{{ t.loopFoot }}</p>
          <a class="lp-btn lp-btn--ghost" :href="p('/demo')">{{ t.loopDemo }}</a>
        </div>
      </div>
    </section>

    <!-- METEOR once -->
    <section class="lp-section">
      <div class="lp-wrap lp-meteor">
        <div>
          <p class="lp-kicker">{{ t.meteorTitle }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight">
            <p v-for="(line, i) in t.meteorLines" :key="i" class="lp-meteor__body">{{ line }}</p>
          </div>
        </div>
        <img :src="a('diverge-converge.jpg')" alt="" width="280" height="280" />
      </div>
    </section>

    <!-- WHO -->
    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ t.whoTitle }}</p>
        </div>
        <div class="lp-who">
          <article v-for="w in t.who" :key="w.t" class="lp-who__card">
            <h3>{{ w.t }}</h3>
            <p>{{ w.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- PROOF STRIP -->
    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <div class="lp-section-head lp-section-head--row">
          <div>
            <p class="lp-kicker">{{ t.proofTitle }}</p>
            <h2>{{ t.proofSub }}</h2>
          </div>
          <a class="lp-btn lp-btn--ghost" :href="p('/proof')">{{ t.proofCta }}</a>
        </div>
        <div class="lp-who">
          <article v-for="pr in t.proof" :key="pr.k" class="lp-who__card">
            <h3>{{ pr.k }}</h3>
            <p>{{ pr.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-photo">
      <img :src="a('hero-desk.jpg')" alt="" />
      <div class="lp-photo__veil">
        <div class="lp-wrap">
          <p>
            {{
              zh
                ? '你不用半夜回第 17 個小問題。'
                : 'You don’t answer the 17th micro-question at 2am.'
            }}
          </p>
        </div>
      </div>
    </section>

    <!-- DAY-ONE CASE (deck #9–#17) -->
    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ t.day1Title }}</p>
          <p class="eng-h2">{{ t.day1Thesis }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight">
            <p v-for="(line, i) in t.day1Leads" :key="'d1' + i" class="lp-lead">{{ line }}</p>
          </div>
        </div>
        <div class="lp-day1">
          <ol class="lp-day1__steps">
            <li v-for="s in t.day1Steps" :key="s.n">
              <span>{{ s.n }}</span>
              {{ s.t }}
            </li>
          </ol>
          <div class="lp-day1__card">
            <h3>{{ t.day1CardTitle }}</h3>
            <p v-for="(line, i) in t.day1Card" :key="'c' + i">{{ line }}</p>
          </div>
        </div>
        <div class="lp-day1__actions">
          <a class="lp-btn lp-btn--primary" :href="p('/install')">{{ t.day1Cta }}</a>
          <a
            class="lp-btn lp-btn--ghost"
            href="https://cookys.github.io/ai-coding-slides/deck3-fable5.zh-TW.html#9"
            target="_blank"
            rel="noreferrer"
          >{{ t.day1Deck }}</a>
        </div>

        <article class="lp-day2-card">
          <h3>{{ t.day2Title }}</h3>
          <p v-for="(line, i) in t.day2Lines" :key="'d2' + i">{{ line }}</p>
          <a class="lp-btn lp-btn--ghost" :href="p('/install') + '#day-two'">{{ t.day2Cta }}</a>
        </article>
      </div>
    </section>

    <!-- INSTALL -->
    <section class="lp-section lp-section--alt">
      <div class="lp-wrap lp-install">
        <div>
          <p class="lp-kicker">{{ t.installTitle }}</p>
          <h2>{{ t.installBody }}</h2>
          <code class="lp-code">{{ t.code1 }}</code>
          <code class="lp-code" style="display: block; margin-top: 0.5rem">{{ t.code2 }}</code>
        </div>
        <a class="lp-btn lp-btn--primary lp-btn--lg" :href="p('/install')">{{ t.installCta }}</a>
      </div>
    </section>

    <footer class="lp-footer">
      <div class="lp-wrap">
        <nav>
          <a
            v-for="l in t.links"
            :key="l.l"
            :href="href(l.h)"
            :target="l.h.startsWith('http') ? '_blank' : undefined"
            :rel="l.h.startsWith('http') ? 'noreferrer' : undefined"
          >{{ l.l }}</a>
        </nav>
        <p>{{ t.foot }}</p>
      </div>
    </footer>
  </div>
</template>
