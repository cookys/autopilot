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

const links = computed(() =>
  zh.value
    ? [
        // ~4 chars each — matches top nav rhythm
        { t: '回到首頁', h: '/' },
        { t: '完整流程', h: '/demo' },
        { t: '委派層級', h: '/levels' },
        { t: '起手任務', h: '/recipes' },
        { t: '快速安裝', h: '/install' },
        { t: '翻車紀錄', h: '/proof' },
        { t: '設計理念', h: '/philosophy' }
      ]
    : [
        { t: 'Home', h: '/' },
        { t: 'Demo', h: '/demo' },
        { t: 'Levels', h: '/levels' },
        { t: 'Recipes', h: '/recipes' },
        { t: 'Install', h: '/install' },
        { t: 'Proof', h: '/proof' },
        { t: 'Why', h: '/philosophy' }
      ]
)

function href(h: string) {
  return p(h)
}
</script>

<template>
  <div class="lp st" :class="{ 'lp--zh': zh }">
    <slot :p="p" :a="a" :zh="zh" />

    <section class="lp-section st-cta">
      <div class="lp-wrap st-cta-card">
        <div class="st-cta-card__main">
          <p class="lp-kicker">{{ zh ? '接下來' : 'Ready?' }}</p>
          <div class="st-cta-card__title">
            <template v-if="zh">
              <p>Claude Code 讓你寫得快。</p>
              <p>Autopilot 讓你不用一直坐在位子上。</p>
            </template>
            <template v-else>
              <p>Claude Code makes you faster.</p>
              <p>Autopilot lets you leave the chair.</p>
            </template>
          </div>
          <div class="st-cta-card__cmd">
            <span class="st-cta-card__cmd-label">{{ zh ? '安裝指令' : 'Install' }}</span>
            <code class="lp-code">/plugin marketplace add cookys/autopilot</code>
          </div>
        </div>
        <div class="st-cta-card__actions">
          <a class="lp-btn lp-btn--primary lp-btn--lg" :href="p('/install')">
            {{ zh ? '快速安裝' : 'Install in 5 min' }}
          </a>
          <a class="lp-btn lp-btn--ghost lp-btn--lg" :href="p('/demo')">
            {{ zh ? '完整流程' : 'See one full run' }}
          </a>
        </div>
      </div>
    </section>

    <footer class="lp-footer">
      <div class="lp-wrap">
        <nav>
          <a v-for="l in links" :key="l.h" :href="href(l.h)">{{ l.t }}</a>
        </nav>
        <p>
          {{
            zh
              ? '想用 CEO 視角帶專案的人 · 也被雜事跟 AI 產出搞到爆的人'
              : 'For would-be CEOs · and people crushed by chores & AI output'
          }}
        </p>
      </div>
    </footer>
  </div>
</template>
