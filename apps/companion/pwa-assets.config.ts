// Config for `npm run pwa-assets`, which regenerates the five PWA icons in public/
// from public/favicon.svg. Run by hand; the PNGs are committed.
//
// The generator is NOT a dependency of this workspace — the script fetches it with
// npx. It brings its own copy of sharp and libvips, a stack of platform binaries
// that every `npm ci` in the monorepo would otherwise download and install to
// regenerate five files from art that changes approximately never. (Sharp is
// already here via Astro and miniflare; this avoids a second, nested copy.)
//
// That is also why nothing is imported below. Under npx the generator lives in a
// cache directory that is not on this file's resolution path, so an
// `import ... from '@vite-pwa/assets-generator/config'` fails outright — as the
// plain shape does not. The values are the `minimal-2023` preset's own, inlined,
// with the two overrides that matter.

// The mark is a blue and orange ring around a WHITE droplet on a transparent
// background, so the preset's default white plate for the maskable and apple icons
// would erase the middle of it. This is the same near-black the dark theme uses; the
// blue, the orange and the droplet all read cleanly against it, where #37A6E0 on the
// #0b6b6b theme colour does not.
const PLATE = '#101418'

export default {
    headLinkOptions: { preset: '2023' },
    preset: {
        transparent: {
            sizes: [64, 192, 512],
            // No favicon.ico: index.html already links the SVG favicon, and every
            // browser that matters reads it.
            favicons: [],
            padding: 0.05,
            resizeOptions: { fit: 'contain', background: 'transparent' },
        },
        maskable: {
            sizes: [512],
            // Android's safe zone is a circle 80% of the canvas; the preset's own
            // 0.3 is right for it.
            padding: 0.3,
            resizeOptions: { background: PLATE, fit: 'contain' },
        },
        apple: {
            sizes: [180],
            // Less than the preset's 0.3: iOS applies its own rounded-rect mask with
            // no safe-zone shrink, so a 30%-padded mark just looks small.
            padding: 0.1,
            resizeOptions: { background: PLATE, fit: 'contain' },
        },
    },
    images: ['public/favicon.svg'],
}
