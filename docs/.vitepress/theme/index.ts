import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'

// The layout adds one slot to the default theme: the screenshot that opens the
// home page, right under the hero. Everything else is the stock theme, and
// `vitepress-plugin-mermaid` registers its component on the app itself, so
// extending the layout does not lose the diagrams.
export default { ...DefaultTheme, Layout }
