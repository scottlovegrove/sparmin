// @ts-check
import { defineConfig } from 'astro/config'

// The site is served from a GitHub Pages project page, so every path is nested
// under /sparmin. Links are built from import.meta.env.BASE_URL rather than
// hardcoded, so moving to a bare domain means changing `base` to '/' (and
// adding a public/CNAME) and nothing else.
export default defineConfig({
    site: 'https://scottlovegrove.github.io',
    base: '/sparmin',
    trailingSlash: 'ignore',
})
