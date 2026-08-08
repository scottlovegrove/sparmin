//! A name for the browser a push subscription belongs to, so the settings list
//! reads as "Safari · iPhone" rather than a row of identical entries.
//!
//! Derived on the client and sent with the subscription, because the client is the
//! only thing that knows what it is. The Worker sees a user-agent string, and on
//! Chrome that string says "Safari" and "Chrome" and "Chromium" all at once.
//!
//! Display only, and best-effort by nature: user-agent strings are a museum of
//! compatibility lies and every branch here is a heuristic. Nothing depends on it
//! being right — a wrong label is a slightly confusing row, not a wrong device.

const BROWSERS = [
    // Order matters throughout: every Chromium browser also claims Chrome and
    // Safari, and Chrome on iOS claims to be Safari too. Most specific first.
    { name: 'Edge', pattern: /\bEdgA?\/|\bEdg\// },
    { name: 'Opera', pattern: /\bOPR\/|\bOpera\// },
    { name: 'Samsung Internet', pattern: /\bSamsungBrowser\// },
    { name: 'Firefox', pattern: /\bFirefox\/|\bFxiOS\// },
    { name: 'Chrome', pattern: /\bChrome\/|\bCriOS\// },
    { name: 'Safari', pattern: /\bSafari\// },
] as const

const PLATFORMS = [
    // iPadOS reports itself as a Macintosh in desktop mode, so a Mac claiming
    // touch support is an iPad. Checked before Mac for that reason.
    { name: 'iPhone', pattern: /\biPhone\b/ },
    { name: 'iPad', pattern: /\biPad\b/ },
    { name: 'Android', pattern: /\bAndroid\b/ },
    { name: 'Windows', pattern: /\bWindows\b/ },
    { name: 'Mac', pattern: /\bMacintosh\b|\bMac OS X\b/ },
    { name: 'Linux', pattern: /\bLinux\b|\bCrOS\b/ },
] as const

export function describeBrowser(
    userAgent: string,
    options: { readonly hasTouch?: boolean } = {},
): string | null {
    const browser = BROWSERS.find((entry) => entry.pattern.test(userAgent))?.name
    let platform = PLATFORMS.find((entry) => entry.pattern.test(userAgent))?.name

    if (platform === 'Mac' && options.hasTouch) {
        platform = 'iPad'
    }

    if (browser == null && platform == null) {
        // Better an unlabelled row the user can still recognise by its position
        // than a confident "Unknown · Unknown".
        return null
    }
    return [browser, platform].filter(Boolean).join(' · ')
}
