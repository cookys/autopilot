<script setup lang="ts">
defineProps<{
  kicker?: string
  title: string
  lead?: string
}>()
</script>

<template>
  <header class="ph">
    <div class="ph__inner">
      <p v-if="kicker" class="ph__kicker">{{ kicker }}</p>
      <h1 class="ph__title">{{ title }}</h1>
      <p v-if="lead" class="ph__lead">{{ lead }}</p>
      <slot />
    </div>
  </header>
</template>
