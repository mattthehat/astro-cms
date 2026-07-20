import { defineConfig } from 'vitest/config'

// The engine and adapters import astro-forms' server-only entry
// (@mattthehat/astro-forms/server), so the tests pull in no .astro components
// and need no Astro-specific Vite pipeline.
export default defineConfig({})
