import { readFileSync } from 'node:fs'
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
