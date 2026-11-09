/// <reference types="vite/client" />

// Vite resolves the stylesheet and the asset imports at build time; this
// reference gives the type checker the same declarations, so a side-effect
// import such as `import '@/index.css'` typechecks like the bundler sees it.
