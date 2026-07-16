<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

const states = computed(() =>
  zh.value
    ? [
        {
          id: 'S0',
          name: 'IDLE',
          who: '人（depth-0 外）',
          entry: '尚未下 /l*',
          exit: '你下 /l3–/l6 + 目標／紅線 → INTAKE'
        },
        {
          id: 'S1',
          name: 'INTAKE',
          who: 'CEO thread（depth-0）',
          entry: '解析目標、紅線、scope、風險',
          exit: '契約夠 →（可）DIVERGE 或 DECIDE；不夠且高風險 → 問你一次'
        },
        {
          id: 'S2',
          name: 'DIVERGE',
          who: 'survey / think-tank / multi-engine',
          entry: '有真實 tradeoff 才進（可 skip）',
          exit: '觀點夠用 → DECIDE'
        },
        {
          id: 'S3',
          name: 'DECIDE',
          who: 'CEO agent（depth-0）',
          entry: '取捨：拓撲（/l?）、誰寫、砍什麼',
          exit: '決策寫下 → DISPATCH；碰紅線 → ESCALATE'
        },
        {
          id: 'S4',
          name: 'DISPATCH',
          who: 'depth-0 控制面',
          entry: '/l4+：建 worktree、foreman、預算／停止／回收座標',
          exit: 'leaf 就緒 → IMPLEMENT 迴圈；precondition 失敗 → ESCALATE'
        },
        {
          id: 'S5',
          name: 'IMPLEMENT',
          who: '/l3 同 thread；/l4 foreman；/l5+ 異質 implementer',
          entry: '在授權範圍改檔／測',
          exit: 'git committed+diff → REVIEW；dirty/no_op/failure → 重試或 ESCALATE'
        },
        {
          id: 'S6',
          name: 'REVIEW',
          who: 'issuer 必須標明：engine review / foreman QC / depth-0 QC',
          entry: 'diff 文本或 artifact；唯讀意圖',
          exit: 'VERDICT 仍有 blocking（含 Major 未解）→ IMPLEMENT；可進閘 → GATE'
        },
        {
          id: 'S7',
          name: 'GATE',
          who: '機械腳本 +（可）QC panel',
          entry: 'secret／completeness／test-integrity…；強度不因 /l6 變鬆',
          exit: 'pass → FINALIZE；fail 可修 → IMPLEMENT；fail-closed 不可修 → ESCALATE'
        },
        {
          id: 'S8',
          name: 'FINALIZE',
          who: 'depth-0 / finish 節奏',
          entry: 'merge-back 或 PR、run-summary、worktree 清理節奏',
          exit: '報告與產物就位 → DONE'
        },
        {
          id: 'S9',
          name: 'DONE',
          who: '產物',
          entry: '可驗證 git leftovers + 報告',
          exit: '（終態）'
        },
        {
          id: 'SX',
          name: 'ESCALATE',
          who: '人',
          entry: '紅線／授權邊界／真卡死／契約不足（不含 CC 權限彈窗保證）',
          exit: '你補契約或決策 → 回 INTAKE 或 DECIDE'
        }
      ]
    : [
        {
          id: 'S0',
          name: 'IDLE',
          who: 'human (outside depth-0)',
          entry: 'No /l* yet',
          exit: 'You type /l3–/l6 + goal/red lines → INTAKE'
        },
        {
          id: 'S1',
          name: 'INTAKE',
          who: 'CEO thread (depth-0)',
          entry: 'Parse goal, red lines, scope, risk',
          exit: 'Contract OK → DIVERGE or DECIDE; thin+high-risk → ask once'
        },
        {
          id: 'S2',
          name: 'DIVERGE',
          who: 'survey / think-tank / multi-engine',
          entry: 'Only for real tradeoffs (skippable)',
          exit: 'Views enough → DECIDE'
        },
        {
          id: 'S3',
          name: 'DECIDE',
          who: 'CEO agent (depth-0)',
          entry: 'Topology (/l?), who writes, what to cut',
          exit: 'Decision recorded → DISPATCH; red line → ESCALATE'
        },
        {
          id: 'S4',
          name: 'DISPATCH',
          who: 'depth-0 control plane',
          entry: '/l4+: worktree, foreman, budget/stop/reap coords',
          exit: 'Leaf ready → IMPLEMENT loop; precondition fail → ESCALATE'
        },
        {
          id: 'S5',
          name: 'IMPLEMENT',
          who: '/l3 same thread; /l4 foreman; /l5+ hetero implementer',
          entry: 'Edit/test in authorized scope',
          exit: 'git committed+diff → REVIEW; dirty/no_op/fail → retry or ESCALATE'
        },
        {
          id: 'S6',
          name: 'REVIEW',
          who: 'issuer must be labeled: engine review / foreman QC / depth-0 QC',
          entry: 'Diff text or artifacts; read intent',
          exit: 'VERDICT still blocking (incl. open Major) → IMPLEMENT; gate-ready → GATE'
        },
        {
          id: 'S7',
          name: 'GATE',
          who: 'scripts + optional QC panel',
          entry: 'secret/completeness/test-integrity…; not softer at /l6',
          exit: 'pass → FINALIZE; fixable fail → IMPLEMENT; hard fail → ESCALATE'
        },
        {
          id: 'S8',
          name: 'FINALIZE',
          who: 'depth-0 / finish cadence',
          entry: 'merge-back or PR, run-summary, worktree cleanup',
          exit: 'report + leftovers ready → DONE'
        },
        {
          id: 'S9',
          name: 'DONE',
          who: 'artifacts',
          entry: 'Verifiable git leftovers + report',
          exit: '(terminal)'
        },
        {
          id: 'SX',
          name: 'ESCALATE',
          who: 'human',
          entry: 'Red line / authority / hard stuck / thin contract (not a CC permission-prompt guarantee)',
          exit: 'You amend → INTAKE or DECIDE'
        }
      ]
)

const transitions = computed(() =>
  zh.value
    ? [
        { from: 'IDLE', to: 'INTAKE', on: '你：/l5 <目標> + 紅線' },
        { from: 'INTAKE', to: 'DIVERGE', on: '需要技術調查／研究' },
        { from: 'INTAKE', to: 'DECIDE', on: '不需再查' },
        { from: 'DIVERGE', to: 'DECIDE', on: '觀點夠' },
        { from: 'DECIDE', to: 'DISPATCH', on: '拓撲與 roster 選定' },
        { from: 'DISPATCH', to: 'IMPLEMENT', on: 'worktree/leaf 就緒（/l3 可縮成同 thread）' },
        { from: 'IMPLEMENT', to: 'REVIEW', on: 'dispatch 回 committed + diff（artifact）' },
        { from: 'REVIEW', to: 'IMPLEMENT', on: 'VERDICT 仍 blocking（issuer 標明）' },
        { from: 'REVIEW', to: 'GATE', on: 'VERDICT 可進閘（無 blocking findings）' },
        { from: 'GATE', to: 'FINALIZE', on: '腳本 exit 0 +（可）panel 過' },
        { from: 'GATE', to: 'IMPLEMENT', on: '閘失敗可修' },
        { from: 'FINALIZE', to: 'DONE', on: 'merge/PR + summary 就位' },
        { from: '*', to: 'ESCALATE', on: '紅線／授權／真卡死' },
        { from: 'ESCALATE', to: 'INTAKE|DECIDE', on: '你補契約或決策' }
      ]
    : [
        { from: 'IDLE', to: 'INTAKE', on: 'you: /l5 <goal> + red lines' },
        { from: 'INTAKE', to: 'DIVERGE', on: 'needs research' },
        { from: 'INTAKE', to: 'DECIDE', on: 'no research' },
        { from: 'DIVERGE', to: 'DECIDE', on: 'views enough' },
        { from: 'DECIDE', to: 'DISPATCH', on: 'topology + roster chosen' },
        { from: 'DISPATCH', to: 'IMPLEMENT', on: 'worktree/leaf ready (/l3 may collapse to thread)' },
        { from: 'IMPLEMENT', to: 'REVIEW', on: 'dispatch → committed + diff' },
        { from: 'REVIEW', to: 'IMPLEMENT', on: 'VERDICT still blocking (issuer labeled)' },
        { from: 'REVIEW', to: 'GATE', on: 'VERDICT gate-ready (no blocking findings)' },
        { from: 'GATE', to: 'FINALIZE', on: 'scripts exit 0 + optional panel' },
        { from: 'GATE', to: 'IMPLEMENT', on: 'fixable gate fail' },
        { from: 'FINALIZE', to: 'DONE', on: 'merge/PR + summary ready' },
        { from: '*', to: 'ESCALATE', on: 'red line / authority / hard stuck' },
        { from: 'ESCALATE', to: 'INTAKE|DECIDE', on: 'you amend contract or decision' }
      ]
)

/** Schematic /l5 event trace — topology-true, not a recorded run_id */
const trace = computed(() =>
  zh.value
    ? {
        title: '/l5 事件 trace（拓撲示意，不是某次 run_id 錄影）',
        honestyLines: [
          '講清楚：下面是依 repo 真實規格（/l5、dispatch-hetero、dispatch-review、depth-0 QC）排的事件順序。',
          '沒有捏造 commit SHA 或 exit code。',
          '真的 run 請看你本機的 manifest／git。'
        ],
        cmd: '/l5 修 login 的 null deref；紅線：不准動 auth schema、單元測試要綠',
        rows: [
          {
            st: 'IDLE→INTAKE',
            actor: '你 / depth-0',
            evidence: 'slash 指令 + 紅線文字',
            next: 'DECIDE（這例略過長 DIVERGE）'
          },
          {
            st: 'DECIDE',
            actor: 'CEO agent',
            evidence: '拓撲=/l5；寫的跟審的不同廠牌',
            next: 'DISPATCH'
          },
          {
            st: 'DISPATCH',
            actor: 'depth-0',
            evidence: 'worktree + 工頭座標；precondition 過',
            next: 'IMPLEMENT'
          },
          {
            st: 'IMPLEMENT',
            actor: '異質 implementer',
            evidence: 'dispatch-hetero → committed + diff（git）',
            next: 'REVIEW（engine）'
          },
          {
            st: 'REVIEW',
            actor: 'engine reviewer',
            evidence: 'diff 塞進 prompt；VERDICT + findings；issuer=engine',
            next: 'VERDICT 仍 blocking → 回 IMPLEMENT'
          },
          {
            st: 'IMPLEMENT',
            actor: '異質 implementer',
            evidence: '照 findings 再 committed',
            next: 'REVIEW 再跑一輪'
          },
          {
            st: 'REVIEW→GATE',
            actor: 'engine → scripts',
            evidence: 'VERDICT 可進閘；secret／completeness exit 0',
            next: 'depth-0 QC（終裁）'
          },
          {
            st: 'GATE/QC',
            actor: 'depth-0（panel 有開就一起）',
            evidence: '終裁 QC；merge 權還在 depth-0',
            next: 'FINALIZE'
          },
          {
            st: 'FINALIZE→DONE',
            actor: 'depth-0',
            evidence: 'run-summary／PR 或 merge；清 worktree',
            next: 'DONE'
          }
        ]
      }
    : {
        title: '/l5 event trace (topology-true schematic — not a recorded run_id)',
        honestyLines: [
          'Honest: ordered from repo SSOT (/l5, dispatch-hetero, dispatch-review, depth-0 QC).',
          'No invented SHAs or exit codes.',
          'Real runs: local manifests / git.'
        ],
        cmd: '/l5 fix login null deref; red lines: no auth schema change; unit tests green',
        rows: [
          {
            st: 'IDLE→INTAKE',
            actor: 'you / depth-0',
            evidence: 'slash cmd + red-line text',
            next: 'DECIDE (skip long DIVERGE here)'
          },
          {
            st: 'DECIDE',
            actor: 'CEO agent',
            evidence: 'topology=/l5; writer≠reviewer family',
            next: 'DISPATCH'
          },
          {
            st: 'DISPATCH',
            actor: 'depth-0',
            evidence: 'worktree + foreman coords; precondition OK',
            next: 'IMPLEMENT'
          },
          {
            st: 'IMPLEMENT',
            actor: 'hetero implementer',
            evidence: 'dispatch-hetero → committed + diff (git)',
            next: 'REVIEW (engine)'
          },
          {
            st: 'REVIEW',
            actor: 'engine reviewer',
            evidence: 'diff-in-prompt; VERDICT+findings; issuer=engine',
            next: 'if VERDICT still blocking → IMPLEMENT (loop)'
          },
          {
            st: 'IMPLEMENT',
            actor: 'hetero implementer',
            evidence: 're-committed against findings',
            next: 'REVIEW again'
          },
          {
            st: 'REVIEW→GATE',
            actor: 'engine → scripts',
            evidence: 'VERDICT gate-ready; secret/completeness exit 0',
            next: 'depth-0 QC (authoritative)'
          },
          {
            st: 'GATE/QC',
            actor: 'depth-0 (+ panel if on)',
            evidence: 'authoritative QC; merge authority stays depth-0',
            next: 'FINALIZE'
          },
          {
            st: 'FINALIZE→DONE',
            actor: 'depth-0',
            evidence: 'run-summary / PR or merge cadence; worktree cleanup',
            next: 'DONE'
          }
        ]
      }
)

const c = computed(() =>
  zh.value
    ? {
        pill1: '工程師視角 · 控制流要對得上 repo',
        pill2: '對齊 /l5 真實行為',
        h1a: '光畫狀態圖不夠。',
        h1b: '得對上 depth-0 跟 artifact。',
        leadLines: [
          '你下目標跟紅線。',
          '系統靠「查得到的證據」往下推。',
          '碰到授權邊界或真的走不下去才叫你。',
          'Claude Code 的權限／登入彈窗不在這份保證裡。'
        ],
        compareKicker: '人花時間的地方，差在哪',
        compareLeadLines: [
          '不是「多一堆步驟比較強」。',
          '一般 AI coding 是三層 loop 套在一起，人卡在每一層。',
          'Autopilot 把內兩層吃掉，人只留最外圍。'
        ],
        loopLegendHuman: '人在 loop 裡',
        loopLegendSys: '系統在 loop 裡',
        whyTitle: '人一直在場',
        whySub: '三層 loop 都卡你',
        whyLeadLines: [
          '多發想解法是真的。',
          '代價：中層 spec、內層驗證也一直叫你回來。'
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
        badNote: '三層都 ↺ 你 → 你是最慢的那一環',
        goodTitle: '人大幅退場',
        goodSub: '只剩最外圍 loop',
        goodLeadLines: [
          '內兩層交給系統。',
          '有內建用內建，沒有就找業界 best practice。',
          '你講死 no-go，不是每一行。'
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
        goodPayoff:
          'Autopilot 不是少步驟——是內兩層 loop 不再把你拉進去。',
        detailTitle: '工程師補刀：系統內部狀態機（可對 repo）',
        detailLead: '下面是系統怎麼跑（含 review／GATE 怎麼接手驗證）。不是要你背流程；人幾乎只在進場與 ESCALATE。',
        loopNotes: [
          'IMPLEMENT⇄REVIEW 是系統內部 loop，不是把你拉回聊天室。',
          'VERDICT 仍 blocking 就回去改（不限 Critical）。',
          'GATE 掛了也可回 IMPLEMENT。'
        ],
        escNotes: [
          'ESCALATE ≠ Claude Code 權限提示。',
          '只有踩紅線、授權不夠、真卡死才算叫你。'
        ],
        smTitle: '狀態表',
        trTitle: '什麼條件才跳狀態（on）',
        invTitle: '不能破的規則',
        inv: [
          '狀態怎麼跳：看 git／VERDICT／exit code，不看模型嘴砲',
          'REVIEW 一定要標 issuer（engine / foreman / depth-0）',
          '最終 gate 跟 merge 權限在 depth-0',
          '/l6 不會把 GATE 放鬆'
        ],
        nextTitle: '接下來',
        next: [
          { t: '委派層級', h: '/levels', d: 'caller／工頭／誰寫…' },
          { t: '起手任務', h: '/recipes', d: '三種常見委派情境' },
          { t: '快速安裝', h: '/install', d: '兩行＋第一槍' }
        ]
      }
    : {
        pill1: 'Engineer narrative · auditable control flow',
        pill2: 'Aligned to /l5 SSOT',
        h1a: 'A concept diagram isn’t enough.',
        h1b: 'It must match depth-0 and artifacts.',
        leadLines: [
          'Give Autopilot a goal and hard limits.',
          'It advances on inspectable evidence.',
          'It stops at an authority boundary or when it cannot safely continue.',
          'Claude Code permission/auth prompts are outside this guarantee.'
        ],
        compareKicker: 'Where human time goes',
        compareLeadLines: [
          'Not “more steps = smarter.”',
          'Default AI coding is three nested loops—with you inside every layer.',
          'Autopilot eats the inner two; you only keep the outer ring.'
        ],
        loopLegendHuman: 'Human in the loop',
        loopLegendSys: 'System in the loop',
        whyTitle: 'Human always on',
        whySub: 'Stuck in all three loops',
        whyLeadLines: [
          'More solution ideation is real.',
          'Cost: mid-layer specs and inner verify still page you every turn.'
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
        badNote: 'All three ↺ you → you are the slowest link',
        goodTitle: 'Human mostly off',
        goodSub: 'Only the outer loop is yours',
        goodLeadLines: [
          'Inner two layers are the system’s.',
          'Built-ins first; else industry best practice.',
          'You lock no-gos, not every line.'
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
        goodPayoff:
          'Autopilot isn’t fewer steps—it’s the inner two loops no longer pulling you in.',
        detailTitle: 'Engineer appendix: internal state machine (maps to repo)',
        detailLead: 'How the system runs (including how review/GATE take verification). Not a human checklist—humans are mostly intake + ESCALATE.',
        loopNotes: [
          'IMPLEMENT⇄REVIEW is an internal system loop, not a chat pull-in.',
          'Any blocking VERDICT loops write (not Critical-only).',
          'Gate fails may return to IMPLEMENT.'
        ],
        escNotes: [
          'ESCALATE ≠ CC permission prompts.',
          'You’re paged for red lines, authority gaps, or hard stuck only.'
        ],
        smTitle: 'State table',
        trTitle: 'Transitions (on)',
        invTitle: 'Invariants',
        inv: [
          'Transitions: git / VERDICT / exit — never self-report',
          'REVIEW must label issuer (engine / foreman / depth-0)',
          'Final gate + merge authority stay at depth-0',
          '/l6 does not soften GATE'
        ],
        nextTitle: 'Next',
        next: [
          { t: 'Level topology', h: '/levels', d: 'caller / foreman / writer…' },
          { t: 'Recipes', h: '/recipes', d: 'Three runbooks' },
          { t: 'Install', h: '/install', d: 'Two lines + first shot' }
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
          <div class="lp-lead-stack">
            <p v-for="(line, i) in c.leadLines" :key="i" class="lp-lead">{{ line }}</p>
          </div>
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-section-head">
          <p class="lp-kicker">{{ c.compareKicker }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight demo-compare-leads">
            <p
              v-for="(line, i) in c.compareLeadLines"
              :key="'cl' + i"
              :class="i === 0 ? 'eng-h2 demo-compare-lead' : 'lp-lead'"
            >
              {{ line }}
            </p>
          </div>
          <div class="nest-legend" aria-hidden="true">
            <span class="nest-legend__item nest-legend__item--human">
              <i />{{ c.loopLegendHuman }}
            </span>
            <span class="nest-legend__item nest-legend__item--sys">
              <i />{{ c.loopLegendSys }}
            </span>
          </div>
        </div>

        <div class="demo-compare demo-compare--nest" role="group" :aria-label="c.compareKicker">
          <!-- 三層都卡人 -->
          <article class="demo-compare__col demo-compare__col--bad">
            <header class="demo-compare__head">
              <span class="demo-compare__tag demo-compare__tag--bad">{{ c.whyTitle }}</span>
              <h2>{{ c.whySub }}</h2>
              <p v-for="(line, i) in c.whyLeadLines" :key="'wl' + i">{{ line }}</p>
            </header>

            <div class="nest-stack nest-stack--bad" role="list">
              <div
                v-for="ring in c.nestBad"
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
              {{ c.badNote }}
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

          <!-- 只剩最外圍 -->
          <article class="demo-compare__col demo-compare__col--good">
            <header class="demo-compare__head">
              <span class="demo-compare__tag demo-compare__tag--good">{{ c.goodTitle }}</span>
              <h2>{{ c.goodSub }}</h2>
              <p v-for="(line, i) in c.goodLeadLines" :key="'gl' + i">{{ line }}</p>
            </header>

            <div class="nest-stack nest-stack--good" role="list">
              <div
                v-for="ring in c.nestGood"
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

            <p class="rail-tl__payoff" role="note">{{ c.goodPayoff }}</p>
          </article>
        </div>

        <div class="demo-compare-detail">
          <p class="lp-kicker">{{ c.detailTitle }}</p>
          <p class="eng-note demo-detail-lead">{{ c.detailLead }}</p>
          <div class="lp-lead-stack lp-lead-stack--tight">
            <p v-for="(line, i) in c.loopNotes" :key="'ln' + i" class="eng-note">{{ line }}</p>
            <p v-for="(line, i) in c.escNotes" :key="'en' + i" class="eng-note eng-note--esc">{{ line }}</p>
          </div>
          <pre class="eng-sm-diagram" aria-hidden="true">
IDLE ──/l*──► INTAKE ──► DECIDE ──► DISPATCH ──► IMPLEMENT ◄──────┐
                  │         ▲                      │              │
                  │    DIVERGE?                    ▼              │ blocking
                  │  (skippable;              REVIEW ─────────────┘ VERDICT
                  │   only if real
                  │   tradeoff)                    │ gate-ready
                  │                                ▼
                  │                              GATE ──fixable fail──► IMPLEMENT
                  │                                │ pass
                  │                                ▼
                  │                           FINALIZE ──► DONE
                  │
                  └── red-line / authority / hard stuck ──► ESCALATE ──amend──► INTAKE or DECIDE
</pre>
        </div>
      </div>
    </section>

    <section class="lp-section" id="invariants">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.invTitle }}</p>
        <ul class="eng-bullets">
          <li v-for="(x, i) in c.inv" :key="i">{{ x }}</li>
        </ul>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.smTitle }}</p>
        <div class="eng-table-wrap">
          <table class="eng-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>State</th>
                <th>{{ zh ? '誰動' : 'Who' }}</th>
                <th>{{ zh ? '進入條件' : 'Entry' }}</th>
                <th>{{ zh ? '離開條件' : 'Exit' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in states" :key="s.id">
                <td><code>{{ s.id }}</code></td>
                <td><code>{{ s.name }}</code></td>
                <td>{{ s.who }}</td>
                <td>{{ s.entry }}</td>
                <td>{{ s.exit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.trTitle }}</p>
        <div class="eng-table-wrap">
          <table class="eng-table">
            <thead>
              <tr>
                <th>from</th>
                <th>to</th>
                <th>on</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in transitions" :key="i">
                <td><code>{{ t.from }}</code></td>
                <td><code>{{ t.to }}</code></td>
                <td>{{ t.on }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ trace.title }}</p>
        <pre class="st-terminal eng-cmd"><code>{{ trace.cmd }}</code></pre>
        <div class="lp-lead-stack lp-lead-stack--tight demo-honest">
          <p v-for="(line, i) in trace.honestyLines" :key="i">{{ line }}</p>
        </div>
        <div class="eng-table-wrap" style="margin-top: 1rem">
          <table class="eng-table">
            <thead>
              <tr>
                <th>state</th>
                <th>actor</th>
                <th>{{ zh ? '證據' : 'evidence' }}</th>
                <th>next</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in trace.rows" :key="i">
                <td><code>{{ r.st }}</code></td>
                <td>{{ r.actor }}</td>
                <td>{{ r.evidence }}</td>
                <td>{{ r.next }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.nextTitle }}</p>
        <div class="lp-who">
          <a v-for="n in c.next" :key="n.h" class="lp-who__card demo-card-link" :href="p(n.h)">
            <h3>{{ n.t }}</h3>
            <p>{{ n.d }}</p>
          </a>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
