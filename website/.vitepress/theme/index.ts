import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Landing from './components/Landing.vue'
import PageHero from './components/PageHero.vue'
import PhilosophyPage from './components/pages/PhilosophyPage.vue'
import LevelsPage from './components/pages/LevelsPage.vue'
import InstallPage from './components/pages/InstallPage.vue'
import SkillsPage from './components/pages/SkillsPage.vue'
import ArchitecturePage from './components/pages/ArchitecturePage.vue'
import MultiHarnessPage from './components/pages/MultiHarnessPage.vue'
import ProofPage from './components/pages/ProofPage.vue'
import RoadmapPage from './components/pages/RoadmapPage.vue'
import DemoPage from './components/pages/DemoPage.vue'
import RecipesPage from './components/pages/RecipesPage.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Landing', Landing)
    app.component('PageHero', PageHero)
    app.component('PhilosophyPage', PhilosophyPage)
    app.component('LevelsPage', LevelsPage)
    app.component('InstallPage', InstallPage)
    app.component('SkillsPage', SkillsPage)
    app.component('ArchitecturePage', ArchitecturePage)
    app.component('MultiHarnessPage', MultiHarnessPage)
    app.component('ProofPage', ProofPage)
    app.component('RoadmapPage', RoadmapPage)
    app.component('DemoPage', DemoPage)
    app.component('RecipesPage', RecipesPage)
  }
} satisfies Theme
