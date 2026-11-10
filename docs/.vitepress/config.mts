import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repository = 'https://github.com/openhoat/wiim-hub'
const base = '/wiim-hub/'

// The site is a guide, not a mirror of the README: the pages below are written
// for someone who has to install, configure and understand the hub, and they
// never carry an address from a particular network.
export default withMermaid(
  defineConfig({
    title: 'WiiM Hub',
    description: 'Self-hosted hub for WiiM devices and other LinkPlay-based players',
    lang: 'en-US',
    base,
    cleanUrls: true,
    lastUpdated: true,
    // Both are generated: they belong beside the other artefacts, under dist/,
    // so the source tree has one place to clean. See `npm run clean`.
    outDir: '../dist/docs',
    cacheDir: '../dist/docs-cache',
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
      ['meta', { name: 'theme-color', content: '#26894c' }],
    ],
    themeConfig: {
      logo: '/logo.svg',
      nav: [
        { text: 'Features', link: '/features' },
        { text: 'Guide', link: '/guide/quick-start' },
        { text: 'How it works', link: '/how-it-works' },
        { text: 'Reference', link: '/reference/http-api' },
        { text: 'Changelog', link: `${repository}/blob/main/CHANGELOG.md` },
      ],
      sidebar: [
        {
          text: 'Guide',
          items: [
            { text: 'Features', link: '/features' },
            { text: 'Quick start', link: '/guide/quick-start' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Devices', link: '/guide/devices' },
            { text: 'UPnP events', link: '/guide/events' },
            { text: 'Notifications', link: '/guide/notifications' },
            { text: 'MCP', link: '/guide/mcp' },
            { text: 'Demo mode', link: '/guide/demo' },
            { text: 'Development', link: '/guide/development' },
          ],
        },
        {
          text: 'Under the hood',
          items: [{ text: 'How it works', link: '/how-it-works' }],
        },
        {
          text: 'Reference',
          items: [
            { text: 'HTTP API', link: '/reference/http-api' },
            { text: 'Feature research', link: '/feature-research' },
            { text: 'No runtime dependency', link: '/adr/0001-zero-runtime-dependencies' },
            {
              text: 'The demo drives the suite',
              link: '/adr/0002-demo-mode-drives-the-end-to-end-suite',
            },
          ],
        },
      ],
      socialLinks: [{ icon: 'github', link: repository }],
      search: { provider: 'local' },
      editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page' },
      footer: {
        message:
          'Released under the MIT license. An independent project, not affiliated with WiiM or LinkPlay Technology.',
        copyright: 'Copyright © the WiiM Hub contributors',
      },
    },
    mermaid: {
      // The default palette is a light theme; the site carries both, so the
      // diagrams follow the page rather than imposing their own.
      theme: 'neutral',
    },
    sitemap: { hostname: 'https://openhoat.github.io/wiim-hub/' },
  })
)
