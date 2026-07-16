import { Resend } from 'resend'

type MagicLink = { email: string; url: string }

// A magic link in a spam folder is an unrecoverable login, so the mail is
// deliberately plain: no images, no tracking, no marketing furniture. Just the
// link and what it does.
function magicLinkText({ url }: MagicLink) {
    return [
        'Sign in to Sparmin by opening this link:',
        '',
        url,
        '',
        'The link expires in 5 minutes and can only be used once.',
        "If you didn't ask to sign in, ignore this — nobody can get in without the link.",
    ].join('\n')
}

function magicLinkHtml({ url }: MagicLink) {
    return `<p>Sign in to Sparmin by opening this link:</p>
<p><a href="${url}">Sign in to Sparmin</a></p>
<p>The link expires in 5 minutes and can only be used once.</p>
<p>If you didn't ask to sign in, ignore this — nobody can get in without the link.</p>`
}

//! Send one magic link. Throws on failure so better-auth surfaces the error
//! rather than telling the user to check an inbox nothing was sent to.
export async function sendMagicLinkEmail(env: Env, link: MagicLink): Promise<void> {
    // Anywhere but production, no key means print the link instead of sending it,
    // so the app runs without an email provider at all. In production a missing key
    // is a fault, not a fallback: silently logging would leave the user waiting for
    // mail that never arrives, and put a live credential in the logs.
    if (!env.RESEND_API_KEY) {
        if (env.ENVIRONMENT === 'production') {
            throw new Error('RESEND_API_KEY is not set — cannot send the magic link')
        }
        console.log(`\n  Magic link for ${link.email}:\n  ${link.url}\n`)
        return
    }

    const { error } = await new Resend(env.RESEND_API_KEY).emails.send({
        from: env.EMAIL_FROM,
        to: link.email,
        subject: 'Sign in to Sparmin',
        text: magicLinkText(link),
        html: magicLinkHtml(link),
    })
    if (error) {
        throw new Error(`Resend rejected the magic link: ${error.message}`)
    }
}
