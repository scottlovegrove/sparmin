// @ts-check
import { defineConfig } from 'astro/config'

// Served from its own domain, so the site sits at the root. Internal links are
// built from import.meta.env.BASE_URL rather than hardcoded, so they follow
// `base` wherever it points.
//
// GitHub Pages learns the domain from public/CNAME, which ships in the built
// output — Pages deploys here come from an Actions artefact, not a branch, so
// there is nowhere else for that file to live.
export default defineConfig({
    site: 'https://sparmin.scottlovegrove.co.uk',
    base: '/',
    trailingSlash: 'ignore',
})
