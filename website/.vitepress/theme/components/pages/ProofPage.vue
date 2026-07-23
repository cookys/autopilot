<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)
const p = (path: string) => withBase(zh.value ? `/zh-TW${path}` : path)

/** Scars as stories: hypothesis → experiment → result → what changed. */
const scars = computed(() =>
  zh.value
    ? [
        {
          t: '「reviewer 塞 skill 會更銳」——被推翻',
          hypo: '把方法論 skill 灌給 reviewer 席，審查應該會更準。',
          test: '預先鎖定指標的 A/B：同一批 diff，有灌／沒灌各跑一輪。',
          result: '沒有差。假設被自己的實驗打掉。',
          change: '不再憑「感覺應該有用」加料；要上 roster 的調整都得先過 A/B。',
          receipt: {
            label: 'A/B 實驗資料',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/skill-transport'
          }
        },
        {
          t: '弱寫手＋弱審查＝假 done 必逃',
          hypo: '就算寫的模型弱，只要有審查，總能擋住吧？',
          test: '把弱 implementer 配弱 reviewer 跑 pipeline bench。',
          result: '「說做完了但其實沒做」幾乎每次都溜過去。',
          change: '審查席必須是考過資格的真 reviewer，弱審查不如沒有——它給你假安全感。',
          receipt: {
            label: 'pipeline bench',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/pipeline-bench'
          }
        },
        {
          t: '流程不是越厚越好——有稅',
          hypo: '多幾道審查與 gate，品質只會更好。',
          test: '同一批任務，量測不同 gate 密度下的成本與品質交換率。',
          result: '能救弱寫手的流程，會拖慢本來就強的寫手。',
          change: 'gate 密度變成 tradeoff 參數（風險分級），不是一律最厚。',
          receipt: {
            label: '交換率量測',
            href: 'https://github.com/cookys/autopilot/blob/develop/evals/pipeline-bench/README.md'
          }
        },
        {
          t: '空白的審查結果曾被當成「過」',
          hypo: '（不是假設，是真實翻車）審查引擎輸出被 shell 管線吃掉，捕捉到空字串。',
          test: '事故重放：空 capture 走到判定層，被解讀成「沒問題」。',
          result: '一次假放行。原因是機制漏洞，不是模型錯。',
          change: '改成 fail-closed：拿不到 VERDICT 一律當「沒過」，並加回歸測試釘死。',
          receipt: {
            label: 'fail-closed 回歸測試',
            href: 'https://github.com/cookys/autopilot/blob/develop/hooks/tests/dispatch-output-quiescence.test.sh'
          }
        }
      ]
    : [
        {
          t: '“Skills sharpen the reviewer” — refuted',
          hypo: 'Feeding methodology skills to the reviewer seat should make reviews sharper.',
          test: 'Pre-registered A/B: same diffs, one arm with the skill pack, one without.',
          result: 'No difference. Our own experiment killed the hypothesis.',
          change: 'No more “feels useful” additions — roster changes must pass an A/B first.',
          receipt: {
            label: 'A/B experiment data',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/skill-transport'
          }
        },
        {
          t: 'Weak writer + weak reviewer = fake done escapes',
          hypo: 'Even with a weak writer, surely any review catches the misses?',
          test: 'Pipeline bench pairing a weak implementer with a weak reviewer.',
          result: '“Claimed done but didn’t do it” slipped through almost every time.',
          change: 'The review seat must be a qualification-tested reviewer; a weak one is worse than none — it sells false safety.',
          receipt: {
            label: 'pipeline bench',
            href: 'https://github.com/cookys/autopilot/tree/develop/evals/pipeline-bench'
          }
        },
        {
          t: 'Process isn’t free — there is a tax',
          hypo: 'More review rounds and gates can only improve quality.',
          test: 'Same task set, measured cost/quality tradeoff across gate densities.',
          result: 'Flows that rescue weak writers slow down writers that were already strong.',
          change: 'Gate density became a risk-tiered tradeoff parameter — never “max everything”.',
          receipt: {
            label: 'tradeoff measurements',
            href: 'https://github.com/cookys/autopilot/blob/develop/evals/pipeline-bench/README.md'
          }
        },
        {
          t: 'An empty review result once counted as a pass',
          hypo: '(Not a hypothesis — a real crash.) A shell pipeline swallowed the reviewer output; we captured an empty string.',
          test: 'Incident replay: the empty capture reached the verdict layer and read as “no findings”.',
          result: 'One false pass. A mechanism hole, not a model error.',
          change: 'Fail-closed everywhere: no VERDICT means “did not pass”, pinned by a regression test.',
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
        pill1: '翻車紀錄 · 證據文化',
        pill2: '為什麼敢少盯',
        h1a: '憑什麼敢讓你少盯？',
        h1b: '因為過不過，不是模型說了算。',
        leadLines: [
          '這頁回答一個問題：Autopilot 憑什麼值得「你只出現在頭尾」？',
          '兩個理由：每一關的「過」都有查得到的證據；上桌的審查引擎都考過資格考。',
          '考砸的實驗跟真實翻車，也一併公開在這裡。'
        ],
        evTitle: '第一層底氣：每一關都留證據',
        evLead: '流程裡沒有任何一步靠模型自己說「我做完了」。每種「過」，各有一種你查得到的東西：',
        evidence: [
          { n: '實作算完成？', d: '看 git 上有沒有真的 commit 跟 diff。沒有 artifact 就是沒做。' },
          { n: '審查算通過？', d: '看審查引擎留下的 VERDICT 檔案與 findings，審的人跟寫的人不同廠牌。' },
          { n: 'gate 算通過？', d: '看腳本的 exit code——機密掃描、完整度、測試誠實度，全是機械判定。' }
        ],
        evNote: '底線規則 fail-closed：任何一關拿不到結果（輸出是空的、逾時、格式壞掉），一律當「沒過」處理，絕不默認放行。',
        examTitle: '第二層底氣：審查引擎要先考試',
        examLead: '哪個模型有資格坐審查席，不是看名氣，是看考試成績：',
        exams: [
          {
            n: '埋雷考卷（known-bad）',
            d: '一批故意埋了 bug 的 diff。想上桌的 reviewer 必須把 critical 全抓出來——漏一個就沒資格。'
          },
          {
            n: '乾淨考卷（clean set）',
            d: '一批沒問題的 diff。不能亂喊有 bug——會狼來了的 reviewer 也不合格。'
          },
          {
            n: '流程假設上 A/B',
            d: '連「這樣做流程會更好」的直覺，都先預鎖指標做實驗；沒用就公開承認。'
          }
        ],
        scarTitle: '第三層底氣：翻車也寫出來',
        scarLead: '下面每張卡是一次真實的假設或事故：我們怎麼測、結果多難看、之後改了什麼。每張都附原始資料連結。',
        labels: { hypo: '假設', test: '怎麼驗', result: '結果', change: '改了什麼' },
        next: [
          { t: '完整流程', h: '/demo' },
          { t: '設計理念', h: '/philosophy' }
        ]
      }
    : {
        pill1: 'Crash log · proof culture',
        pill2: 'Why less watching is safe',
        h1a: 'Why is watching less safe here?',
        h1b: 'Because “passed” is never the model’s word.',
        leadLines: [
          'This page answers one question: what earns the “you only appear at both ends” claim?',
          'Two reasons: every pass leaves evidence you can check, and every review engine passed a qualification exam first.',
          'Failed experiments and real crashes are published here too.'
        ],
        evTitle: 'First leg: every step leaves evidence',
        evLead: 'No step in the flow rests on a model saying “done”. Each kind of pass has its own checkable artifact:',
        evidence: [
          { n: 'Implementation done?', d: 'A real commit and diff on git. No artifact, no work.' },
          { n: 'Review passed?', d: 'A VERDICT file with findings, from a reviewer of a different vendor than the writer.' },
          { n: 'Gate passed?', d: 'Script exit codes — secret scan, completeness, test honesty. All mechanical.' }
        ],
        evNote: 'Bottom rule, fail-closed: any step that returns nothing (empty output, timeout, broken format) counts as “did not pass”. Never a silent pass.',
        examTitle: 'Second leg: reviewers sit an exam first',
        examLead: 'A model earns the review seat by test scores, not reputation:',
        exams: [
          {
            n: 'Planted-bug exam (known-bad)',
            d: 'Diffs with deliberately planted bugs. A would-be reviewer must catch every critical — miss one, no seat.'
          },
          {
            n: 'Clean exam (clean set)',
            d: 'Genuinely clean diffs. Crying wolf disqualifies too.'
          },
          {
            n: 'Process hunches get A/Bs',
            d: 'Even “this flow tweak should help” intuitions get pre-registered experiments; misses are published.'
          }
        ],
        scarTitle: 'Third leg: crashes are published',
        scarLead: 'Each card below is a real hypothesis or incident: how we tested it, how badly it went, what changed after. Raw data linked on every card.',
        labels: { hypo: 'Hypothesis', test: 'Test', result: 'Result', change: 'What changed' },
        next: [
          { t: 'Full flow', h: '/demo' },
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
        <p class="lp-kicker">{{ c.evTitle }}</p>
        <p class="lp-lead srail-lead">{{ c.evLead }}</p>
        <div class="lp-who court-cards">
          <article v-for="ev in c.evidence" :key="ev.n" class="lp-who__card">
            <h3>{{ ev.n }}</h3>
            <p>{{ ev.d }}</p>
          </article>
        </div>
        <p class="court-note">{{ c.evNote }}</p>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.examTitle }}</p>
        <p class="lp-lead srail-lead">{{ c.examLead }}</p>
        <div class="lp-who court-cards">
          <article v-for="ex in c.exams" :key="ex.n" class="lp-who__card">
            <h3>{{ ex.n }}</h3>
            <p>{{ ex.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.scarTitle }}</p>
        <p class="lp-lead srail-lead">{{ c.scarLead }}</p>
        <div class="scar-grid">
          <article v-for="s in scars" :key="s.t" class="scar-card">
            <h3>{{ s.t }}</h3>
            <dl class="scar-story">
              <div><dt>{{ c.labels.hypo }}</dt><dd>{{ s.hypo }}</dd></div>
              <div><dt>{{ c.labels.test }}</dt><dd>{{ s.test }}</dd></div>
              <div><dt>{{ c.labels.result }}</dt><dd>{{ s.result }}</dd></div>
              <div class="scar-story__change"><dt>{{ c.labels.change }}</dt><dd>{{ s.change }}</dd></div>
            </dl>
            <a
              class="scar-receipt"
              :href="s.receipt.href"
              target="_blank"
              rel="noreferrer"
            >{{ s.receipt.label }}</a>
          </article>
        </div>
        <div class="lp-cta-row" style="margin-top: 1.75rem">
          <a v-for="n in c.next" :key="n.h" class="lp-btn lp-btn--ghost" :href="p(n.h)">{{ n.t }}</a>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
