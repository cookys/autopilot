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
          exit: 'VERDICT 仍有 blocking（含 Major 未解）→ IMPLEMENT；可進 gate → GATE'
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
        { from: 'REVIEW', to: 'GATE', on: 'VERDICT 可進 gate（無 blocking findings）' },
        { from: 'GATE', to: 'FINALIZE', on: '腳本 exit 0 +（可）panel 過' },
        { from: 'GATE', to: 'IMPLEMENT', on: 'gate 失敗可修' },
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

/** One run, told as a story rail — happy path + the escalate side door. */
const rail = computed(() =>
  zh.value
    ? {
        kicker: '一條 run 怎麼走',
        lead: '不用背狀態機。順著走一遍，你會發現自己只出現在頭尾兩站。',
        stops: [
          {
            who: 'human',
            st: 'INTAKE',
            title: '你交代一次',
            body: '一句話講清楚目標跟紅線，系統把它讀成契約：範圍、風險、什麼叫做完。'
          },
          {
            who: 'sys',
            st: 'DIVERGE',
            opt: true,
            title: '有取捨才調查',
            body: '真的有技術取捨才開 survey／think-tank／多引擎意見；沒有就直接跳過這站。'
          },
          {
            who: 'sys',
            st: 'DECIDE',
            title: 'CEO agent 拍板',
            body: '選哪一層委派、誰寫誰審、砍掉什麼。決策會寫下來，不是心證。'
          },
          {
            who: 'sys',
            st: 'DISPATCH',
            title: '開工前把後路修好',
            body: '建隔離 worktree、派工頭，預算跟停損先寫死，才放手讓它跑。'
          },
          {
            who: 'sys',
            st: 'IMPLEMENT ⇄ REVIEW',
            loop: true,
            title: '寫跟審在裡面來回',
            body: '寫的人改檔，審的人只認 git 上的 diff。審不過就回頭改——這個來回不會把你拉進聊天室。'
          },
          {
            who: 'sys',
            st: 'GATE',
            loop: true,
            title: '機械 gate守最後一關',
            body: '腳本掃機密、完整度、測試誠實度，掛了就退回去修。到 /l6 也不會放鬆。'
          },
          {
            who: 'human',
            st: 'FINALIZE → DONE',
            title: '你驗收',
            body: 'merge 權回到你手上：看報告、看 diff、看測試結果，點頭才合進主幹。'
          }
        ],
        escTitle: 'ESCALATE：唯一的插隊通道',
        escBody:
          '任何一站都可能跳出來找你——踩到紅線、授權不夠、真的卡死。你補一句話，流程回到 INTAKE 或 DECIDE 繼續。除此之外系統不會中途敲你。',
        specSummary: '完整狀態表與跳轉條件（對 repo 規格，給想核對的人）'
      }
    : {
        kicker: 'How one run walks',
        lead: 'No need to memorize the machine. Walk it once — you only appear at the two ends.',
        stops: [
          {
            who: 'human',
            st: 'INTAKE',
            title: 'You brief it once',
            body: 'One sentence of goal and red lines; the system reads it into a contract: scope, risk, what “done” means.'
          },
          {
            who: 'sys',
            st: 'DIVERGE',
            opt: true,
            title: 'Research only for real tradeoffs',
            body: 'Survey / think-tank / multi-engine takes open only when there is a genuine tradeoff; otherwise this stop is skipped.'
          },
          {
            who: 'sys',
            st: 'DECIDE',
            title: 'The CEO-agent calls it',
            body: 'Which delegation level, who writes, who reviews, what gets cut. The decision is written down, not vibes.'
          },
          {
            who: 'sys',
            st: 'DISPATCH',
            title: 'Escape routes before work',
            body: 'Isolated worktree, a foreman, budget and stop conditions locked in — then it runs.'
          },
          {
            who: 'sys',
            st: 'IMPLEMENT ⇄ REVIEW',
            loop: true,
            title: 'Write and review loop inside',
            body: 'The writer edits files; the reviewer only trusts the git diff. Blocking verdicts loop back to the writer — without pulling you in.'
          },
          {
            who: 'sys',
            st: 'GATE',
            loop: true,
            title: 'Mechanical gates hold the line',
            body: 'Scripts scan secrets, completeness, test honesty; failures go back for fixes. Not softer at /l6.'
          },
          {
            who: 'human',
            st: 'FINALIZE → DONE',
            title: 'You accept',
            body: 'Merge authority returns to you: report, diff, test results — it merges when you nod.'
          }
        ],
        escTitle: 'ESCALATE: the only interrupt',
        escBody:
          'Any stop can page you — a red line, missing authority, genuinely stuck. You add one line; the run resumes at INTAKE or DECIDE. Nothing else interrupts you mid-run.',
        specSummary: 'Full state & transition tables (repo-spec, for those who want to audit)'
      }
)

/** Three kinds of "review" on one rail + what /l4→/l6 actually delegates. */
const court = computed(() =>
  zh.value
    ? {
        kicker: '同一條軌上，其實有三種「審」',
        lead: '/l6 說「全委派」，第一個問題通常是：那還有誰在把關？答案是把關拆成三層，而且每層刻意用不同廠牌的模型。',
        cards: [
          {
            t: '動工前 · plan 先審',
            st: 'spec review',
            d: '計畫本身先被另一個引擎批一輪，plan ⇄ 審來回到收斂。方向錯就死在紙上，不用等 code 寫完才發現。'
          },
          {
            t: '寫的路上 · loop review',
            st: 'IMPLEMENT ⇄ REVIEW',
            d: '每輪 commit 都有跨廠牌 reviewer 讀 diff 給 VERDICT，有 blocking 就退回去改。抓的是「這一輪寫錯什麼」——快、跟著節奏、陪跑到底。'
          },
          {
            t: '寫完之後 · 眾議會 QC',
            st: 'qc panel · 終裁',
            d: '跨廠牌 panel（例：OpenAI＋Anthropic＋Google）各自獨立審「整包」diff。任何一席驗證過的 Critical 都能擋下 merge——聯集裁決，不是多數決。loop review 過了，不代表這關會過。'
          }
        ],
        familyLine:
          '為什麼堅持不同廠牌？同家族模型共享盲點——寫跟審同廠牌，等於自己改自己的考卷。眾議會跟 loop review 的席位，都刻意跟寫 code 的引擎錯開家族。',
        delegTitle: '/l4 → /l6：委出去的是勞力，留下來的是裁決',
        delegLead:
          '每升一級就多外包一件勞務。但不管到哪一級，「檢查的執行」與「過不過的裁決」都釘在 depth-0——用真 git artifact 判，不聽任何模型自報。',
        delegHead: ['層級', '誰寫 code', '隨寫審查', '驗收題誰出', '終裁與 merge'],
        delegRows: [
          {
            lv: '/l4',
            cells: ['Claude 工頭', 'Claude 自審＋工頭 QC', 'depth-0 自己出', 'depth-0 終裁＋merge']
          },
          {
            lv: '/l5',
            cells: ['外廠牌引擎', '另一廠牌 reviewer', 'depth-0 自己出', '眾議會＋depth-0 merge']
          },
          {
            lv: '/l6',
            cells: ['外廠牌引擎', '另一廠牌 reviewer', '再一個廠牌出題', '眾議會＋depth-0 merge']
          }
        ],
        delegNote:
          '所以 /l6 的「全委派」是：寫 code、審 code、連驗收清單怎麼出，都交給彼此錯開的廠牌——但那份清單由 depth-0 親自執行，過不過由 artifact 說話。委派勞力，不委派信任。'
      }
    : {
        kicker: 'One rail, three different kinds of “review”',
        lead: '“Full delegation” at /l6 raises the obvious question: who still holds the line? The checking splits into three layers — each deliberately on a different model vendor.',
        cards: [
          {
            t: 'Before work · plan review',
            st: 'spec review',
            d: 'The plan itself gets reviewed by another engine, looping until it converges. Wrong directions die on paper, not after the code exists.'
          },
          {
            t: 'While writing · loop review',
            st: 'IMPLEMENT ⇄ REVIEW',
            d: 'Every commit round a cross-vendor reviewer reads the diff and returns a VERDICT; blocking findings loop it back. Catches what this round got wrong — fast, in rhythm, all the way.'
          },
          {
            t: 'After writing · the QC panel',
            st: 'qc panel · final',
            d: 'A cross-vendor panel (e.g. OpenAI + Anthropic + Google) independently reviews the whole diff. Any single verified Critical blocks the merge — union, never majority vote. Passing loop review does not imply passing here.'
          }
        ],
        familyLine:
          'Why insist on different vendors? Same-family models share blind spots — writer and reviewer from one vendor is grading your own exam. Both the panel seats and the loop reviewer are deliberately family-disjoint from the code writer.',
        delegTitle: '/l4 → /l6: the labor is delegated, the verdict is not',
        delegLead:
          'Each level externalizes one more piece of labor. At every level, executing the checks and ruling pass/fail stay pinned at depth-0 — judged on real git artifacts, never a model’s self-report.',
        delegHead: ['Level', 'Writes code', 'In-loop review', 'Authors the checks', 'Final QC & merge'],
        delegRows: [
          {
            lv: '/l4',
            cells: ['Claude foreman', 'Claude self + foreman QC', 'depth-0 itself', 'depth-0 verdict + merge']
          },
          {
            lv: '/l5',
            cells: ['outside-vendor engine', 'different-vendor reviewer', 'depth-0 itself', 'panel + depth-0 merge']
          },
          {
            lv: '/l6',
            cells: ['outside-vendor engine', 'different-vendor reviewer', 'yet another vendor', 'panel + depth-0 merge']
          }
        ],
        delegNote:
          'So /l6 “full delegation” means: writing, reviewing, even authoring the acceptance checks go to mutually disjoint vendors — but depth-0 runs that checklist itself, and artifacts decide pass/fail. Delegate the labor, never the trust.'
      }
)

/** Schematic /l5 replay — topology-true, not a recorded run_id */
const trace = computed(() =>
  zh.value
    ? {
        title: '走一遍：一次 /l5 修 bug 的重播（示意）',
        lead: '把上面那條軌套進一個具體任務長什麼樣。事件順序照 repo 真實規格排；沒有捏造 SHA 或 exit code，真的 run 請看你本機的 manifest 與 git。',
        cmd: '/l5 修 login 的 null deref；紅線：不准動 auth schema、單元測試要綠',
        rows: [
          { st: 'INTAKE', actor: '你', line: '一行指令進場：目標＋兩條紅線。這是你這次唯一的輸入。' },
          { st: 'DECIDE', actor: 'CEO agent', line: '選 /l5 拓撲：寫的跟審的用不同廠牌模型。' },
          { st: 'DISPATCH', actor: 'depth-0', line: '開 worktree、派工頭，前置檢查通過才放行。' },
          { st: 'IMPLEMENT', actor: '異質 implementer', line: '改完檔在 git 上留下 commit 跟 diff——用產物證明做了事，不是嘴巴說。' },
          { st: 'REVIEW', actor: 'engine reviewer', line: '審查者讀 diff 給 VERDICT：這輪有 blocking finding，退回去改。' },
          { st: 'IMPLEMENT', actor: '異質 implementer', line: '照 findings 修完再 commit，回到審查桌。' },
          { st: 'GATE', actor: '機械腳本', line: '審過了，機密／完整度掃描 exit 0，才准往前。' },
          { st: 'QC', actor: 'depth-0', line: '終裁品管：merge 權一直在這層，不在寫 code 的人手上。' },
          { st: 'DONE', actor: 'depth-0', line: '產物就位：run-summary、PR 或 merge、worktree 清乾淨。' }
        ]
      }
    : {
        title: 'Walkthrough: one /l5 bug-fix replay (schematic)',
        lead: 'The rail above, applied to a concrete task. Event order follows the repo spec; no invented SHAs or exit codes — real runs live in your local manifests and git.',
        cmd: '/l5 fix login null deref; red lines: no auth schema change; unit tests green',
        rows: [
          { st: 'INTAKE', actor: 'you', line: 'One command in: goal plus two red lines. Your only input this run.' },
          { st: 'DECIDE', actor: 'CEO agent', line: 'Picks the /l5 topology: writer and reviewer from different model families.' },
          { st: 'DISPATCH', actor: 'depth-0', line: 'Worktree and foreman set up; preconditions checked before anything runs.' },
          { st: 'IMPLEMENT', actor: 'hetero implementer', line: 'Edits land as a git commit and diff — artifacts prove the work, not claims.' },
          { st: 'REVIEW', actor: 'engine reviewer', line: 'Reads the diff, returns a VERDICT: one blocking finding — back it goes.' },
          { st: 'IMPLEMENT', actor: 'hetero implementer', line: 'Fixes against the findings, commits again, returns to the review desk.' },
          { st: 'GATE', actor: 'scripts', line: 'Review clears; secret and completeness scans exit 0 before it may advance.' },
          { st: 'QC', actor: 'depth-0', line: 'Final quality call: merge authority stays here, never with the code writer.' },
          { st: 'DONE', actor: 'depth-0', line: 'Leftovers in place: run summary, PR or merge, worktree cleaned up.' }
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
          },
          {
            depth: 2,
            who: 'human',
            title: '中層 · 發想／spec',
            cycle: '方案 → 你決 → 細節 → 你再決',
          },
          {
            depth: 3,
            who: 'human',
            title: '內層 · 寫完了嗎',
            cycle: '改檔 →「好了」→ 你驗 → 再回嘴',
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
          },
          {
            depth: 2,
            who: 'sys',
            title: '中層 · 發想／spec',
            cycle: '內建 → 否則 survey → CEO 取捨',
          },
          {
            depth: 3,
            who: 'sys',
            title: '內層 · 寫→審→gate',
            cycle: '實作 ⇄ 異質審 ⇄ 機械 gate',
          }
        ],
        goodPayoff:
          'Autopilot 不是少步驟——是內兩層 loop 不再把你拉進去。',
        detailTitle: '系統內部怎麼跑（工程附錄）',
        detailLead: '這一段給想核對 repo 的工程師：系統內部的迴圈長怎樣、驗證在哪裡接手。不用背；人幾乎只出現在進場跟 ESCALATE。',
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
          },
          {
            depth: 2,
            who: 'human',
            title: 'Mid · ideation / spec',
            cycle: 'options → you decide → details → you again',
          },
          {
            depth: 3,
            who: 'human',
            title: 'Inner · is it done?',
            cycle: 'edit → “done” → you verify → re-prompt',
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
          },
          {
            depth: 2,
            who: 'sys',
            title: 'Mid · ideation / spec',
            cycle: 'built-in → else survey → CEO tradeoff',
          },
          {
            depth: 3,
            who: 'sys',
            title: 'Inner · write→review→gate',
            cycle: 'implement ⇄ hetero review ⇄ gates',
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

            <div class="nest2-stack">
              <div class="nest2 nest2--human">
                <div class="nest2__bar">
                  <span class="nest2__depth">L1</span>
                  <span class="nest2__title">{{ c.nestBad[0].title }}</span>
                  <span class="nest2__who nest2__who--human">{{ zh ? '人 ↺' : 'you ↺' }}</span>
                </div>
                <p class="nest2__cycle">{{ c.nestBad[0].cycle }}</p>
                <div class="nest2 nest2--human">
                  <div class="nest2__bar">
                    <span class="nest2__depth">L2</span>
                    <span class="nest2__title">{{ c.nestBad[1].title }}</span>
                    <span class="nest2__who nest2__who--human">{{ zh ? '人 ↺' : 'you ↺' }}</span>
                  </div>
                  <p class="nest2__cycle">{{ c.nestBad[1].cycle }}</p>
                  <div class="nest2 nest2--human">
                    <div class="nest2__bar">
                      <span class="nest2__depth">L3</span>
                      <span class="nest2__title">{{ c.nestBad[2].title }}</span>
                      <span class="nest2__who nest2__who--human">{{ zh ? '人 ↺' : 'you ↺' }}</span>
                    </div>
                    <p class="nest2__cycle">{{ c.nestBad[2].cycle }}</p>
                  </div>
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

            <div class="nest2-stack">
              <div class="nest2 nest2--human">
                <div class="nest2__bar">
                  <span class="nest2__depth">L1</span>
                  <span class="nest2__title">{{ c.nestGood[0].title }}</span>
                  <span class="nest2__who nest2__who--human">{{ zh ? '人 ↺' : 'you ↺' }}</span>
                </div>
                <p class="nest2__cycle">{{ c.nestGood[0].cycle }}</p>
                <div class="nest2 nest2--sys">
                  <div class="nest2__bar">
                    <span class="nest2__depth">L2</span>
                    <span class="nest2__title">{{ c.nestGood[1].title }}</span>
                    <span class="nest2__who nest2__who--sys">{{ zh ? '系統 ↺' : 'sys ↺' }}</span>
                  </div>
                  <p class="nest2__cycle">{{ c.nestGood[1].cycle }}</p>
                  <div class="nest2 nest2--sys">
                    <div class="nest2__bar">
                      <span class="nest2__depth">L3</span>
                      <span class="nest2__title">{{ c.nestGood[2].title }}</span>
                      <span class="nest2__who nest2__who--sys">{{ zh ? '系統 ↺' : 'sys ↺' }}</span>
                    </div>
                    <p class="nest2__cycle">{{ c.nestGood[2].cycle }}</p>
                  </div>
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
        <p class="lp-kicker">{{ rail.kicker }}</p>
        <p class="lp-lead srail-lead">{{ rail.lead }}</p>
        <ol class="srail">
          <li
            v-for="(s, i) in rail.stops"
            :key="i"
            class="srail__stop"
            :class="s.who === 'human' ? 'srail__stop--human' : 'srail__stop--sys'"
          >
            <div class="srail__head">
              <code class="srail__st">{{ s.st }}</code>
              <span class="srail__who" :class="'srail__who--' + s.who">{{
                s.who === 'human' ? (zh ? '你' : 'you') : zh ? '系統' : 'system'
              }}</span>
              <span v-if="s.opt" class="srail__flag">{{ zh ? '可跳過' : 'skippable' }}</span>
              <span v-if="s.loop" class="srail__flag srail__flag--loop">{{
                zh ? '↺ 不過就回頭改' : '↺ fails loop back'
              }}</span>
            </div>
            <strong class="srail__title">{{ s.title }}</strong>
            <p class="srail__body">{{ s.body }}</p>
          </li>
        </ol>
        <aside class="srail-esc">
          <strong>{{ rail.escTitle }}</strong>
          <p>{{ rail.escBody }}</p>
        </aside>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ court.kicker }}</p>
        <p class="lp-lead srail-lead">{{ court.lead }}</p>
        <div class="lp-who court-cards">
          <article v-for="cc in court.cards" :key="cc.t" class="lp-who__card">
            <code class="st-code-label">{{ cc.st }}</code>
            <h3>{{ cc.t }}</h3>
            <p>{{ cc.d }}</p>
          </article>
        </div>
        <p class="court-family">{{ court.familyLine }}</p>

        <p class="lp-kicker" style="margin-top: 2.25rem">{{ court.delegTitle }}</p>
        <p class="lp-lead srail-lead">{{ court.delegLead }}</p>
        <div class="eng-table-wrap" style="margin-top: 1rem">
          <table class="eng-table">
            <thead>
              <tr>
                <th v-for="h in court.delegHead" :key="h">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in court.delegRows" :key="r.lv">
                <td><code>{{ r.lv }}</code></td>
                <td v-for="(cell, ci) in r.cells" :key="ci">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="court-note">{{ court.delegNote }}</p>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ trace.title }}</p>
        <p class="lp-lead srail-lead">{{ trace.lead }}</p>
        <pre class="st-terminal eng-cmd"><code>{{ trace.cmd }}</code></pre>
        <ol class="trail">
          <li
            v-for="(r, i) in trace.rows"
            :key="i"
            class="trail__ev"
            :class="{ 'trail__ev--human': r.actor === '你' || r.actor === 'you' }"
          >
            <code class="trail__st">{{ r.st }}</code>
            <div class="trail__txt">
              <span class="trail__actor">{{ r.actor }}</span>
              <p>{{ r.line }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <details class="spec-details">
          <summary>{{ rail.specSummary }}</summary>
          <p class="lp-kicker" style="margin-top: 1.25rem">{{ c.smTitle }}</p>
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
          <p class="lp-kicker" style="margin-top: 1.5rem">{{ c.trTitle }}</p>
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
        </details>
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
