<script setup lang="ts">
import StoryChrome from '../StoryChrome.vue'
import { withBase } from 'vitepress'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'zh-TW' }>(), { lang: 'en' })
const zh = computed(() => props.lang === 'zh-TW')
const a = (n: string) => withBase(`/assets/${n}`)

const c = computed(() =>
  zh.value
    ? {
        pill1: '發展路線 · 手寫精選',
        pill2: '含明確不做清單',
        h1a: '接下來，',
        h1b: '大概往哪。',
        lead: '手寫精選，不是 backlog 倒出來。只列真的在做、真的想做、跟明確不做的。',
        now: '剛上線',
        later: '下一步',
        no: '明確不做（或還不敢說做得到）',
        noLead: '路線圖最廉價的就是願望。這三件我們反著寫——已經知道不成立或證據還不夠的：',
        nowItems: [
          {
            n: '開跑前的合約檢查',
            d: '每個委派單元要先過 GO／NO-GO 檢查——目標、範圍、驗收條件齊了才准花引擎的錢。'
          },
          {
            n: '驗收出題也有座位表',
            d: '/l6 的驗證作者引擎改由設定檔指定；沒資格或亂指定，直接擋下不開跑。'
          }
        ],
        laterItems: [
          {
            n: '對跑偏的委派先勸再收',
            d: '現在只觀測與提醒；之後讓 depth-0 能對卡住的執行單元送出指示，真的沒反應才回收。'
          },
          {
            n: 'token 預算從警告變硬上限',
            d: '現在超支只會警告；等校準數據夠厚，改成真的擋下來。'
          },
          {
            n: '審查吃 diff，不吃整個 repo',
            d: '長迴圈的審查改成增量閱讀＋定期全量重讀，省掉每輪重爬整庫的成本。'
          }
        ],
        nos: [
          '「依領域自動選引擎」——樣本還太薄，現在只量測、不路由，不假裝可行。',
          '「塞方法論包一定讓 reviewer 變準」——A/B 實驗已經打臉過一次，不再這樣宣稱。',
          '「行程隔離（cgroup）＝安全保證」——它只是收工衛生，擋不了惡意，不當賣點。'
        ]
      }
    : {
        pill1: 'Roadmap · hand-curated',
        pill2: 'Includes a won’t-do list',
        h1a: 'What’s next.',
        h1b: 'Curated.',
        lead: 'Hand-curated, not a backlog dump. Only what shipped, what’s next, and what we explicitly won’t claim.',
        now: 'Just shipped',
        later: 'Up next',
        no: 'Won’t do (or won’t pretend yet)',
        noLead: 'The cheapest thing on a roadmap is a wish. These three are written in reverse — known-false or under-evidenced:',
        nowItems: [
          {
            n: 'Contract check before spend',
            d: 'Every delegated unit clears a GO/NO-GO readiness check — goal, scope, acceptance all present — before any engine money burns.'
          },
          {
            n: 'A roster for check-authoring too',
            d: 'The /l6 verification-author engine comes from config; unqualified or ad-hoc picks are blocked before start.'
          }
        ],
        laterItems: [
          {
            n: 'Nudge drifting runs before reaping',
            d: 'Today we observe and warn; next, depth-0 can send guidance to a stuck unit and only reap if it stays silent.'
          },
          {
            n: 'Token budgets: warning → hard cap',
            d: 'Overruns only warn today; once calibration data is thick enough, they block.'
          },
          {
            n: 'Reviews read diffs, not whole repos',
            d: 'Long loops move to incremental reads plus periodic full re-reads, cutting the re-crawl cost per round.'
          }
        ],
        nos: [
          '“Auto-route engines by domain” — evidence still thin; we measure, we don’t route, we don’t pretend.',
          '“Methodology packs always sharpen reviewers” — our own A/B refuted this once already.',
          '“Process isolation (cgroup) = security” — it is teardown hygiene, not a defense against malice; not a selling point.'
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
          <p class="lp-lead">{{ c.lead }}</p>
        </div>
      </div>
    </header>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.now }}</p>
        <div class="lp-bento">
          <article v-for="i in c.nowItems" :key="i.n" class="lp-card lp-card--ceo">
            <h3>{{ i.n }}</h3>
            <p>{{ i.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--alt">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.later }}</p>
        <div class="st-levels">
          <article v-for="(i, idx) in c.laterItems" :key="i.n" class="st-level">
            <span class="st-level__i">0{{ idx + 1 }}</span>
            <h3>{{ i.n }}</h3>
            <p>{{ i.d }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <p class="lp-kicker">{{ c.no }}</p>
        <p class="lp-lead srail-lead">{{ c.noLead }}</p>
        <div class="lp-who">
          <article v-for="n in c.nos" :key="n" class="lp-who__card lp-vs__col--bad">
            <p>{{ n }}</p>
          </article>
        </div>
      </div>
    </section>
  </StoryChrome>
</template>
