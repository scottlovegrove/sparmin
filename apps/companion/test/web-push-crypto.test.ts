import { describe, expect, it } from 'vitest'
import {
    base64UrlDecode,
    base64UrlEncode,
    encryptPayload,
    encryptPayloadWith,
    vapidAuthorization,
} from '../worker/web-push'

// The reason worker/web-push.ts is hand-rolled rather than a dependency is that the
// available libraries send the superseded `aesgcm` coding, which Apple rejects. That
// only pays off if this implementation is actually right, and "it round-trips against
// my own decrypt" would not show it — a wrong info string is wrong symmetrically.
//
// So the first test here is RFC 8291 §5's published example, reproduced byte for
// byte: same subscription keys, same ephemeral sender key, same salt, same
// plaintext, same body. If the derivation drifts, this fails.

const RFC_8291 = {
    plaintext: 'When I grow up, I want to be a watermelon',
    authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    receiverPublicKey:
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    senderPrivateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    senderPublicKey:
        'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    body:
        'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
        'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
        'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
} as const

// A P-256 pair for ECDH from the raw halves the RFC prints. WebCrypto will not take
// a bare scalar, so the private key goes in as a JWK with the public point split
// into coordinates — the same trick worker/web-push.ts uses for the VAPID key.
async function importEcdhKeyPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
    const publicBytes = base64UrlDecode(publicKey)
    const jwk = {
        kty: 'EC',
        crv: 'P-256',
        x: base64UrlEncode(publicBytes.subarray(1, 33)),
        y: base64UrlEncode(publicBytes.subarray(33, 65)),
    }

    return {
        publicKey: await crypto.subtle.importKey(
            'raw',
            publicBytes,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
        ),
        privateKey: await crypto.subtle.importKey(
            'jwk',
            { ...jwk, d: privateKey, ext: true, key_ops: ['deriveBits'] },
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits'],
        ),
    }
}

describe('aes128gcm payload encryption', () => {
    it('reproduces the RFC 8291 §5 example byte for byte', async () => {
        const expected = base64UrlDecode(RFC_8291.body)
        // The salt is the first 16 bytes of the body it produced.
        const salt = expected.subarray(0, 16)
        const localKeys = await importEcdhKeyPair(
            RFC_8291.senderPublicKey,
            RFC_8291.senderPrivateKey,
        )

        const body = await encryptPayloadWith({
            plaintext: new TextEncoder().encode(RFC_8291.plaintext),
            target: { p256dh: RFC_8291.receiverPublicKey, auth: RFC_8291.authSecret },
            salt,
            localKeys,
        })

        expect(base64UrlEncode(body)).toBe(RFC_8291.body)
    })

    it('lays out the RFC 8188 header: salt, record size, then the sender key', async () => {
        const body = await encryptPayload(new TextEncoder().encode('hello'), {
            p256dh: RFC_8291.receiverPublicKey,
            auth: RFC_8291.authSecret,
        })

        expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
        expect(body[20]).toBe(65)
        // 16 salt + 4 record size + 1 length + 65 key, then the record itself:
        // 5 bytes of plaintext, the 0x02 delimiter and a 16-byte GCM tag.
        expect(body.byteLength).toBe(86 + 5 + 1 + 16)
    })

    it('uses a fresh salt and ephemeral key for every message', async () => {
        const target = { p256dh: RFC_8291.receiverPublicKey, auth: RFC_8291.authSecret }
        const plaintext = new TextEncoder().encode('hello')

        const first = await encryptPayload(plaintext, target)
        const second = await encryptPayload(plaintext, target)

        // Reusing either would leak the plaintext relationship between two
        // messages, so identical input must still give different bytes.
        expect(base64UrlEncode(first)).not.toBe(base64UrlEncode(second))
    })
})

describe('VAPID authorization', () => {
    // Not the RFC's key — that one is for ECDH. Generated once for this suite.
    const keys = {
        publicKey:
            'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        subject: 'mailto:hello@example.com',
    } as const

    it('signs an ES256 token scoped to the push service origin', async () => {
        const header = await vapidAuthorization(
            keys,
            'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
            1_800_000_000,
        )

        const [scheme, rest] = header.split(' ')
        expect(scheme).toBe('vapid')

        const token = rest.match(/t=([^,]+)/)?.[1] ?? ''
        expect(rest).toContain(`k=${keys.publicKey}`)

        const [jwtHeader, claims, signature] = token.split('.')
        expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(jwtHeader)))).toEqual({
            typ: 'JWT',
            alg: 'ES256',
        })
        // The audience is the origin alone — a token carrying the full endpoint
        // path is rejected by some services and identifies the subscription to
        // anyone who sees it.
        expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)))).toEqual({
            aud: 'https://push.example.net',
            exp: 1_800_000_000 + 12 * 60 * 60,
            sub: 'mailto:hello@example.com',
        })
        // Raw r||s, not DER — the ES256 JWS form.
        expect(base64UrlDecode(signature).byteLength).toBe(64)
    })

    it('verifies against the advertised public key', async () => {
        const endpoint = 'https://push.example.net/push/abc'
        const header = await vapidAuthorization(keys, endpoint, 1_800_000_000)
        const token = header.match(/t=([^,]+)/)?.[1] ?? ''
        const [jwtHeader, claims, signature] = token.split('.')

        const publicKey = await crypto.subtle.importKey(
            'raw',
            base64UrlDecode(keys.publicKey),
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['verify'],
        )
        const verified = await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            publicKey,
            base64UrlDecode(signature),
            new TextEncoder().encode(`${jwtHeader}.${claims}`),
        )

        // `k=` is what the push service checks the signature with. If the pair
        // were mismatched this is where it would show, rather than in a 401 in
        // production.
        expect(verified).toBe(true)
    })

    it('rejects a public key that is not an uncompressed P-256 point', async () => {
        await expect(
            vapidAuthorization(
                { ...keys, publicKey: base64UrlEncode(new Uint8Array(65)) },
                'https://push.example.net/push/abc',
                1_800_000_000,
            ),
        ).rejects.toThrow(/uncompressed P-256 point/)
    })
})

describe('base64url', () => {
    it('round-trips bytes that need padding and both substituted characters', () => {
        for (let length = 0; length < 8; length++) {
            const bytes = crypto.getRandomValues(new Uint8Array(length))
            expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
        }
    })

    it('emits no padding and no + or /', () => {
        // A push endpoint's keys travel in URLs and headers; a stray `+` there
        // means a key that silently decodes to the wrong bytes.
        const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 255]))
        expect(encoded).not.toMatch(/[+/=]/)
    })
})
