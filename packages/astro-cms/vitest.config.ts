import { getViteConfig } from 'astro/config'

// The engine and adapter suites need no Astro pipeline, but the component suite
// renders real .astro files through the container API, which does — so the
// Astro Vite config is used for the whole run.
export default getViteConfig({})
