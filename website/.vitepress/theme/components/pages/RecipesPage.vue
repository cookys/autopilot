<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

/**
 * Each recipe = engineer runbook:
 * trigger → cause/effect → what you type → human-time journey (not state dump) → done / escalate
 */
const recipes = computed(() =>
  zh.value
    ? [
        {
          id: 'research-to-ship',
          title: '情境 A：先查再寫（research → ship）',
          trigger: '你不知道業界怎麼做，但最後要可 merge 的變更，不是聊天結論。',
          cause: '直接 /l5 寫會用錯誤假設噴 code，review 連環打回，你還是得補技術調查。',
          effect: '先把假設壓實再動手，少在假方向上燒實作。',
          youType:
            '/research-to-ship 或口語：研究 <主題> best practice，寫 plan，收斂後再實作。紅線：不擴 scope、測試必須綠',
          journeyThesis: '人只在兩端；中間兩格是系統 ↺。',
          humanSummary: '進場定題＋出場收產物',
          sysSummary: '調查／plan 與寫審 gate',
          stages: [
            { who: 'human', layer: '外', title: '你進場', body: '主題、紅線、什麼叫完' },
            { who: 'sys', layer: '中', title: '先查再決', body: 'survey → plan，不急改 production' },
            { who: 'sys', layer: '內', title: '寫→審→gate', body: '夠緊才寫；證據當 done' },
            { who: 'human', layer: '外', title: '你出場', body: '看 commit／測／scope' }
          ],
          stateTrail: 'IDLE → INTAKE → DIVERGE → DECIDE → … → DONE',
          notes: [
            '中層產出是 plan／決策，不是大改 production。',
            'DONE 是 HEAD 有變更且測過，不是研究報告貼在聊天室。'
          ],
          doneWhen: 'HEAD 有對應變更，gate／測試綠，scope 沒飄出紅線。',
          escalate: '主題過大、紅線互相衝突，或 plan 需要產品取捨你沒給。'
        },
        {
          id: 'multi-engine',
          title: '情境 B：寫審分家（/l5 異質）',
          trigger: '你要功能落地，且不相信「同一個模型寫完又自己說過了」。',
          cause: '同模型 self-review 假 done 逃出，人被迫當第二審。',
          effect: '寫跟審不同 runner／家族。轉移看 git artifact + VERDICT，人不用當中繼。',
          youType:
            '/l5 <功能目標>。紅線例：不碰 billing、不降覆蓋率。\n（roster 決定誰寫誰審，見 review-loop-config）',
          journeyThesis: '人在兩端；中間寫⇄審 ↺ 不把你當中繼。',
          humanSummary: '進場給目標＋出場看 PR',
          sysSummary: '輕決策＋異質寫審 loop',
          stages: [
            { who: 'human', layer: '外', title: '你進場', body: '功能目標＋no-go' },
            { who: 'sys', layer: '中', title: '輕決策', body: '清楚就略長調查，選座位' },
            { who: 'sys', layer: '內', title: '寫⇄審 ↺', body: 'blocking 回改，不算叫你' },
            { who: 'human', layer: '外', title: '你出場', body: 'gate 過＋可讀 PR／commit' }
          ],
          stateTrail: 'IDLE → INTAKE → DECIDE → DISPATCH → IMPLEMENT ⇄ REVIEW → GATE → DONE',
          notes: [
            'IMPLEMENT 成功 = dispatch-hetero 回 committed，不是 stream 裡「完成了」。',
            'GATE：secret-scan、completeness、（專案開）test-integrity…'
          ],
          doneWhen: '異質 review 可進 gate，機械 gate過，你有可讀 PR／commit。',
          escalate: '連續多輪 VERDICT 仍卡住、越紅線，或 implementer 一直 dirty／no_op。'
        },
        {
          id: 'repo-takeover',
          title: '情境 C：先讀再改（接手 repo）',
          trigger: '陌生 codebase，怕 AI 一進來就亂改 protected path。',
          cause: '一開始就動手，在錯誤邊界上改檔，回滾成本高。',
          effect: '先弄懂邊界再動手。/onboard 會寫設定，真只讀請用 explore。',
          youType:
            '1) 只讀地圖：「只讀，畫架構地圖，未授權不改檔」（explore）\n   若要接 autopilot config：/onboard（會改檔）\n2) 你確認後再：/l3 或 /l4 做「第一刀」小變更',
          journeyThesis: '人出場兩次（讀授權／放行）；讀與小刀是系統。',
          humanSummary: '授權只讀＋放行第一刀',
          sysSummary: '畫地圖＋小變更過 gate',
          stages: [
            { who: 'human', layer: '外', title: '你進場', body: '只讀授權＋protected paths' },
            { who: 'sys', layer: '中', title: '讀邊界', body: 'explore 出地圖，repo 應乾淨' },
            { who: 'human', layer: '外', title: '你放行', body: '看完地圖才開第一刀 scope' },
            { who: 'sys', layer: '內', title: '小刀實作', body: '小變更＋審＋gate' }
          ],
          stateTrail: 'IDLE → INTAKE → DIVERGE*（讀）→ DECIDE → IMPLEMENT → … → DONE',
          notes: [
            'DIVERGE* 這裡是讀 repo，不是產業 survey。',
            'explore 不該改追蹤檔；/onboard 本來就會寫 .claude config。'
          ],
          doneWhen: '有地圖 artifact（文件或報告），可選第一刀小 PR 過 gate。',
          escalate: '宣稱只讀卻改到追蹤檔、需要 secret，或第一刀 scope 不清。'
        }
      ]
    : [
        {
          id: 'research-to-ship',
          title: 'Recipe A: research → ship',
          trigger: 'You don’t know industry practice, but need a mergeable change—not a chat essay.',
          cause: 'Jumping to /l5 freezes bad assumptions into code; review thrash; you research by hand anyway.',
          effect: 'Harden assumptions before coding; less burn on a false path.',
          youType:
            '/research-to-ship or: research best practice for <topic>, write a plan, implement after it tightens. Red lines: no scope creep, tests green',
          journeyThesis: 'You only at both ends; middle two tiles are system ↺.',
          humanSummary: 'Enter with topic; exit with leftovers',
          sysSummary: 'Research/plan + write→review→gate',
          stages: [
            { who: 'human', layer: 'out', title: 'You enter', body: 'Topic, red lines, done-when' },
            { who: 'sys', layer: 'mid', title: 'Research → decide', body: 'Survey → plan, not prod rewrite' },
            { who: 'sys', layer: 'in', title: 'Write→review→gate', body: 'Tight plan first; evidence = done' },
            { who: 'human', layer: 'out', title: 'You exit', body: 'Commits / tests / scope' }
          ],
          stateTrail: 'IDLE → INTAKE → DIVERGE → DECIDE → … → DONE',
          notes: [
            'Mid-layer output is plan/decision, not a production rewrite.',
            'DONE means HEAD change + tests—not a research paste in chat.'
          ],
          doneWhen: 'HEAD has the change; gates/tests green; scope inside red lines.',
          escalate: 'Topic too big, red lines conflict, or plan needs a product call you didn’t give.'
        },
        {
          id: 'multi-engine',
          title: 'Recipe B: write ≠ review (/l5 hetero)',
          trigger: 'You want a feature and refuse same-model self-pass.',
          cause: 'Same-model self-review lets fake done escape; you become second reviewer.',
          effect: 'Writer and reviewer are different runners/families. Transitions need git + VERDICT—not you as glue.',
          youType:
            '/l5 <feature goal>. e.g. red lines: no billing, no coverage drop.\n(roster via review-loop-config)',
          journeyThesis: 'You at both ends; middle write⇄review ↺ is not your glue job.',
          humanSummary: 'Enter with goal; exit with PR',
          sysSummary: 'Light decide + hetero write/review loop',
          stages: [
            { who: 'human', layer: 'out', title: 'You enter', body: 'Feature goal + no-gos' },
            { who: 'sys', layer: 'mid', title: 'Light decide', body: 'Skip long survey; pick seats' },
            { who: 'sys', layer: 'in', title: 'Write⇄review ↺', body: 'Blocking → rewrite, not page you' },
            { who: 'human', layer: 'out', title: 'You exit', body: 'Gates pass + readable PR' }
          ],
          stateTrail: 'IDLE → INTAKE → DECIDE → DISPATCH → IMPLEMENT ⇄ REVIEW → GATE → DONE',
          notes: [
            'IMPLEMENT success = dispatch-hetero committed—not “done” in a stream.',
            'GATE: secret-scan, completeness, optional test-integrity…'
          ],
          doneWhen: 'Cross-family review gate-ready + mechanical gates pass + readable PR/commit.',
          escalate: 'Same blocking VERDICT many rounds, red-line hit, or dirty/no_op implementer loop.'
        },
        {
          id: 'repo-takeover',
          title: 'Recipe C: map before edit',
          trigger: 'Strange codebase; fear of random protected-path edits.',
          cause: 'Implement first → wrong-boundary edits → expensive rollback.',
          effect: 'Map boundaries before edits. /onboard writes config; true read-only is explore.',
          youType:
            '1) Read-only map: “read-only architecture map; no edits without authority” (explore)\n   To wire autopilot config: /onboard (writes files)\n2) After you accept: /l3 or /l4 for a small first cut',
          journeyThesis: 'You appear twice (read auth / first-cut gate); map + cut are system.',
          humanSummary: 'Authorize read + unlock first cut',
          sysSummary: 'Map boundaries + small change through gates',
          stages: [
            { who: 'human', layer: 'out', title: 'You enter', body: 'Read-only auth + protected paths' },
            { who: 'sys', layer: 'mid', title: 'Map', body: 'Explore map; repo should stay clean' },
            { who: 'human', layer: 'out', title: 'You unlock', body: 'Accept map, then first-cut scope' },
            { who: 'sys', layer: 'in', title: 'Small cut', body: 'Small change + review + gates' }
          ],
          stateTrail: 'IDLE → INTAKE → DIVERGE* (read) → DECIDE → IMPLEMENT → … → DONE',
          notes: [
            'DIVERGE* here means map the repo, not industry survey.',
            'explore should not touch tracked files; /onboard intentionally writes .claude config.'
          ],
          doneWhen: 'Map artifact (doc/report) + optional small first-cut PR past gates.',
          escalate: 'Claimed read-only but tracked files changed, secrets needed, or first-cut scope fuzzy.'
        }
      ]
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '工程師 runbook',
        pill2: '起手任務 · 常見委派情境',
        h1a: '不是功能清單。',
        h1b: '是「這類工作，人卡在哪一層 loop」。',
        leadLines: [
          '每個情境寫清楚：',
          '什麼時候用。',
          '你下什麼指令。',
          '人在哪一層、系統 ↺ 哪一層。',
          '怎樣算 DONE、什麼情況才叫你。'
        ],
        labels: {
          trigger: '什麼時候用',
          cause: '不這樣做會怎樣',
          effect: '用這條的差別',
          youType: '你下的指令',
          journey: '這條 flow 人在哪',
          trail: '工程對照（可略）',
          notes: '工程備註（對到實作）',
          done: '怎樣算 DONE',
          esc: '怎樣才 ESCALATE'
        },
        whoHuman: '人在這',
        whoSys: '系統 ↺',
        humanBar: '人',
        sysBar: '系統',
        after: '巢狀 loop 與狀態總表在',
        afterDemo: '完整流程',
        afterInstall: '快速安裝'
      }
    : {
        pill1: 'Engineer runbook',
        pill2: 'Trigger → human-time journey → done',
        h1a: 'Not a feature list.',
        h1b: 'Which loop layer you’re stuck in.',
        leadLines: [
          'Each recipe answers:',
          'When to use it.',
          'What you type.',
          'Which loop layer is human vs system ↺.',
          'DONE vs ESCALATE.'
        ],
        labels: {
          trigger: 'Trigger',
          cause: 'If you skip this',
          effect: 'What changes with it',
          youType: 'What you type',
          journey: 'Where you sit in this flow',
          trail: 'Engineer map (optional)',
          notes: 'Maps to implementation',
          done: 'DONE when',
          esc: 'ESCALATE when'
        },
        whoHuman: 'you here',
        whoSys: 'sys ↺',
        humanBar: 'you',
        sysBar: 'sys',
        after: 'Nested loops + full state table on',
        afterDemo: 'Demo',
        afterInstall: 'Install'
      }
)
</script>

<template>
  <StoryChrome :lang="lang">
    <header class="lp-hero st-hero">
      <img class="lp-hero__bg" :src="a('texture-path.jpg')" alt="" />
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

    <section
      v-for="(r, idx) in recipes"
      :key="r.id"
      class="lp-section"
      :class="{ 'lp-section--alt': idx % 2 === 1 }"
      :id="r.id"
    >
      <div class="lp-wrap">
        <p class="lp-kicker">{{ zh ? '起手情境' : 'starter scenario' }} 0{{ idx + 1 }} · <code>{{ r.id }}</code></p>
        <h2 class="eng-h2">{{ r.title }}</h2>

        <div class="recipe-ce">
          <div class="recipe-ce__col">
            <h3>{{ c.labels.trigger }}</h3>
            <p>{{ r.trigger }}</p>
          </div>
          <div class="recipe-ce__col recipe-ce__col--cause">
            <h3>{{ c.labels.cause }}</h3>
            <p>{{ r.cause }}</p>
          </div>
          <div class="recipe-ce__col recipe-ce__col--effect">
            <h3>{{ c.labels.effect }}</h3>
            <p>{{ r.effect }}</p>
          </div>
        </div>

        <h3 class="eng-sub">{{ c.labels.youType }}</h3>
        <pre class="st-terminal eng-cmd"><code>{{ r.youType }}</code></pre>

        <h3 class="eng-sub">{{ c.labels.journey }}</h3>
        <div class="fj" role="group" :aria-label="c.labels.journey">
          <p class="fj-thesis">{{ r.journeyThesis }}</p>
          <div class="fj-sum" aria-hidden="true">
            <span class="fj-sum__pill fj-sum__pill--human">
              <em>{{ c.humanBar }}</em>{{ r.humanSummary }}
            </span>
            <span class="fj-sum__pill fj-sum__pill--sys">
              <em>{{ c.sysBar }}</em>{{ r.sysSummary }}
            </span>
          </div>
          <div class="fj-rail" role="list">
            <div
              v-for="(s, si) in r.stages"
              :key="si"
              class="fj-tile"
              :class="s.who === 'human' ? 'fj-tile--human' : 'fj-tile--sys'"
              role="listitem"
            >
              <div class="fj-tile__top">
                <span class="fj-tile__who">{{
                  s.who === 'human' ? c.whoHuman : c.whoSys
                }}</span>
                <span class="fj-tile__layer">{{ s.layer }}</span>
              </div>
              <strong class="fj-tile__title">{{ s.title }}</strong>
              <p class="fj-tile__body">{{ s.body }}</p>
            </div>
          </div>
          <p class="recipe-state-trail">
            <span class="recipe-state-trail__lab">{{ c.labels.trail }}</span>
            <code>{{ r.stateTrail }}</code>
          </p>
        </div>

        <h3 class="eng-sub">{{ c.labels.notes }}</h3>
        <div class="recipe-notes">
          <p v-for="(n, i) in r.notes" :key="i" class="recipe-notes__line">{{ n }}</p>
        </div>

        <div class="recipe-exit">
          <div>
            <h3>{{ c.labels.done }}</h3>
            <p>{{ r.doneWhen }}</p>
          </div>
          <div>
            <h3>{{ c.labels.esc }}</h3>
            <p>{{ r.escalate }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap lp-cta-row">
        <a class="lp-btn lp-btn--primary" :href="p('/demo')">{{ c.afterDemo }}</a>
        <a class="lp-btn lp-btn--ghost" :href="p('/install')">{{ c.afterInstall }}</a>
        <span class="eng-note">{{ c.after }} /demo</span>
      </div>
    </section>
  </StoryChrome>
</template>
