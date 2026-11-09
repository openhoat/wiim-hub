<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
// biome-ignore lint/correctness/noUnusedImports: read from the template, which the linter does not resolve.
import shot from '../../img/now-playing.jpeg'

// The home page opens on the interface itself: a visitor decides in one glance,
// and a paragraph of prose is not what they came to read. The image is imported
// rather than referenced by path, so the build hashes it and prepends the site
// base for us.
// biome-ignore lint/correctness/noUnusedVariables: used as the root tag of the template.
const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #home-hero-after>
      <figure class="home-shot">
        <img :src="shot" alt="The hub, now playing: one speaker online and one offline" />
        <figcaption>
          Two speakers on a demo instance: one playing, one offline. The captures come from
          <a href="./guide/demo">the demo</a>, so they carry no real device data.
        </figcaption>
      </figure>
    </template>
  </Layout>
</template>
