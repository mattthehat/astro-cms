// getViteConfig wires in Astro's Vite plugin so imports that pull in .astro
// components (e.g. the astro-forms index) transform correctly under Vitest
import { getViteConfig } from 'astro/config'

export default getViteConfig({})
