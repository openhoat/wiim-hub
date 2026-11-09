import DefaultTheme from 'vitepress/theme'
import './custom.css'

// The plugin `vitepress-plugin-mermaid` registers its component on the app
// itself, so extending the default theme does not lose the diagrams.
export default DefaultTheme
