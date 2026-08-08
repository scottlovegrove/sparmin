import { describe, expect, it } from 'vitest'
import { describeBrowser } from './push-label'

// Real strings, because the whole difficulty here is that they lie: every
// Chromium browser also claims Chrome and Safari, and every iOS browser claims
// Safari whatever engine it thinks it is.
const AGENTS = {
    safariIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    safariMac:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    chromeMac:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    chromeAndroid:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    edgeWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    firefoxWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    chromeIos:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
    ipadDesktopMode:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
} as const

describe('describeBrowser', () => {
    it('names the browser and the thing it is running on', () => {
        expect(describeBrowser(AGENTS.safariIphone)).toBe('Safari · iPhone')
        expect(describeBrowser(AGENTS.safariMac)).toBe('Safari · Mac')
        expect(describeBrowser(AGENTS.chromeMac)).toBe('Chrome · Mac')
        expect(describeBrowser(AGENTS.chromeAndroid)).toBe('Chrome · Android')
        expect(describeBrowser(AGENTS.firefoxWindows)).toBe('Firefox · Windows')
    })

    it('does not call every Chromium browser Chrome', () => {
        // Edge's string contains "Chrome/126" and "Safari/537" as well as "Edg/".
        expect(describeBrowser(AGENTS.edgeWindows)).toBe('Edge · Windows')
    })

    it('does not call Chrome on iOS Safari', () => {
        // On iOS every browser is WebKit and says so; CriOS is the giveaway.
        expect(describeBrowser(AGENTS.chromeIos)).toBe('Chrome · iPhone')
    })

    it('spots an iPad claiming to be a Mac', () => {
        // iPadOS sends a Macintosh string in its default desktop mode. Touch
        // support is what separates it from an actual Mac.
        expect(describeBrowser(AGENTS.ipadDesktopMode, { hasTouch: true })).toBe('Safari · iPad')
        expect(describeBrowser(AGENTS.ipadDesktopMode, { hasTouch: false })).toBe('Safari · Mac')
    })

    it('gives up rather than guessing', () => {
        // An unlabelled row is still recognisable by position; "Unknown ·
        // Unknown" is just noise pretending to be information.
        expect(describeBrowser('')).toBeNull()
        expect(describeBrowser('some-crawler/1.0')).toBeNull()
    })

    it('still names what it can when only one half is recognisable', () => {
        expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows')
    })
})
