import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The shell is a hand-written static document — nothing type-checks it and no
// component renders it, so its link-preview tags are pinned here.
const html = readFileSync('index.html', 'utf8')

const ORIGIN = 'https://sparmin-app.scottlovegrove.co.uk'

function metaContent(attribute: 'property' | 'name', key: string) {
    const tag = new RegExp(`<meta[^>]*\\s${attribute}="${key}"[^>]*>`, 's').exec(html)?.[0]
    return tag ? /content="([^"]*)"/s.exec(tag)?.[1] : undefined
}

describe('index.html link previews', () => {
    it('declares the Open Graph tags a crawler needs to unfurl the link', () => {
        expect(metaContent('property', 'og:type')).toBe('website')
        expect(metaContent('property', 'og:site_name')).toBe('Sparmin')
        expect(metaContent('property', 'og:url')).toBe(`${ORIGIN}/`)
        expect(metaContent('property', 'og:title')).toContain('Sparmin')
        expect(metaContent('property', 'og:description')).toBeTruthy()
    })

    it('declares the Twitter card tags', () => {
        expect(metaContent('name', 'twitter:card')).toBe('summary_large_image')
        expect(metaContent('name', 'twitter:title')).toContain('Sparmin')
        expect(metaContent('name', 'twitter:description')).toBeTruthy()
    })

    it('points at the card by absolute URL, at the size crawlers are told to expect', () => {
        const image = `${ORIGIN}/images/og-default.png`
        expect(metaContent('property', 'og:image')).toBe(image)
        expect(metaContent('name', 'twitter:image')).toBe(image)
        expect(metaContent('property', 'og:image:width')).toBe('1200')
        expect(metaContent('property', 'og:image:height')).toBe('630')
    })

    it('puts the tags before the module script, within the first chunk a crawler reads', () => {
        const lastTag = html.lastIndexOf('twitter:image')
        expect(lastTag).toBeLessThan(html.indexOf('<script'))
        expect(html.indexOf('og:image')).toBeLessThan(2048)
    })
})

describe('index.html installed-app tags', () => {
    // The manifest link and the service worker registration are absent on purpose —
    // vite-plugin-pwa injects both into the built document, so pinning them here
    // would be pinning something this file doesn't own.

    it('names the icon iOS uses for the home screen, and it exists', () => {
        const href = /<link[^>]*rel="apple-touch-icon"[^>]*>/s
            .exec(html)?.[0]
            ?.match(/href="([^"]*)"/)?.[1]

        expect(href).toBe('/apple-touch-icon-180x180.png')
        expect(existsSync(`public${href}`)).toBe(true)
    })

    it('declares itself installable under the home-screen name', () => {
        expect(metaContent('name', 'apple-mobile-web-app-title')).toBe('Sparmin')
        // The standard one and the prefixed one iOS still reads.
        expect(metaContent('name', 'mobile-web-app-capable')).toBe('yes')
        expect(metaContent('name', 'apple-mobile-web-app-capable')).toBe('yes')
    })

    it('sits after the link previews, so it cannot push og:image out of reach', () => {
        // WhatsApp's crawler reads only the first few kilobytes, and og:image has to
        // land inside them. Anything added to the head goes below this line.
        expect(html.lastIndexOf('twitter:image')).toBeLessThan(html.indexOf('apple-touch-icon'))
        expect(html.indexOf('apple-touch-icon')).toBeLessThan(html.indexOf('<script'))
    })
})
