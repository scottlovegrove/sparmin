import { env } from 'cloudflare:test'
import app from '../worker'
import { createAuth } from '../worker/auth'

export const TEST_EMAIL = 'test@example.com'

export type SignedIn = { headers: Record<string, string>; userId: string }

//! Sign in the way the app really does: ask for a magic link, follow it, keep the
//! cookie. Tests send that cookie, so they go through the actual guard rather than
//! around it.
export async function signIn(email = TEST_EMAIL): Promise<SignedIn> {
    let magicUrl = ''
    // Capture the link instead of sending it. Everything else is the real flow —
    // same tables, same tokens, same verification endpoint.
    const auth = createAuth(env, async (_env, link) => {
        magicUrl = link.url
    })
    await auth.api.signInMagicLink({ body: { email, callbackURL: '/' }, headers: new Headers() })
    if (magicUrl === '') {
        throw new Error(`no magic link was issued for ${email}`)
    }

    const token = new URL(magicUrl).searchParams.get('token')
    const verified = await app.request(`/api/auth/magic-link/verify?token=${token}`, {}, env)
    const setCookie = verified.headers.get('set-cookie')
    if (setCookie == null) {
        throw new Error(`magic link verification set no cookie (${verified.status})`)
    }
    const headers = { cookie: setCookie.split(';')[0] }

    const row = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
        .bind(email)
        .first<{ id: string }>()
    if (row == null) {
        throw new Error(`signed in as ${email} but no user row exists`)
    }
    return { headers, userId: row.id }
}
