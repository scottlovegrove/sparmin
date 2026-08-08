// The build this bundle came from: a monotonic integer as a string, or 'dev' for
// anything not built by the deploy workflow. The number comes from the
// `companion-v<N>` git tags — see the Versioning section of the README.
//
// Client and Worker are one deploy from one `vite build`, so both carry the same
// value by construction. That is what makes `GET /api/version` worth having: it
// reports what is live without opening the app, and can't drift from the bundle
// serving it.
//
// `typeof` rather than a bare read: the define is a build-time substitution, and
// under vitest nothing substitutes it, so the identifier is genuinely undeclared
// and a bare read throws a ReferenceError. `typeof` on an undeclared name is the
// one safe way to ask. A production build folds this to a literal.
//
// The cost of the fallback is that a broken define would read as 'dev' in
// production rather than failing. The deploy workflow closes that off by curling
// /api/version afterwards and asserting the number it just built.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
