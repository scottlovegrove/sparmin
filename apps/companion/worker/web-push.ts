// Web Push, hand-rolled: RFC 8291 "aes128gcm" payload encryption and RFC 8292
// VAPID authorization, on nothing but crypto.subtle.
//
// This is deliberately not a library. Both maintained WebCrypto packages
// (`webpush-webcrypto`, `@block65/webcrypto-web-push`) still send the draft-04
// scheme — `Content-Encoding: aesgcm` with an `Authorization: WebPush …` header —
// which Apple's push service rejects outright. That would break notifications on
// exactly the platform this feature exists for: an iOS PWA on a home screen. The
// node-only `web-push` is not an option in workerd.
//
// What is left is about a hundred lines of well-specified key derivation, and
// RFC 8291 §5 publishes a complete test vector for it — so this can be pinned to
// the specification's own bytes rather than only round-tripped against itself.
// See test/web-push-crypto.test.ts.

/** RFC 8188 record size. One record, and every push is far below it. */
const RECORD_SIZE = 4096

/** A push service must reject anything larger; 4096 minus this coding's overhead. */
export const MAX_PAYLOAD_BYTES = 3993

/** RFC 8292 caps this at 24 hours. Half a day leaves room for clock skew. */
const VAPID_TOKEN_TTL_S = 12 * 60 * 60

/** How long a push service should hold the message for a device that is offline. */
const DEFAULT_TTL_S = 12 * 60 * 60

/**
 * How long to wait on a push service before giving up on one message.
 *
 * Sends happen inside `waitUntil`, so a stalled connection holds a Worker
 * invocation open with nobody watching. There is deliberately no retry to go with
 * this: `TTL` already asks the push service to hold the message and keep trying
 * the device, so retrying the *service* would duplicate work it is already doing
 * — and a missed "session saved" is not worth a backoff loop behind a response
 * that has already been sent.
 */
const REQUEST_TIMEOUT_MS = 10_000

const KEY_INFO_PREFIX = new TextEncoder().encode('WebPush: info\0')
const CEK_INFO = new TextEncoder().encode('Content-Encoding: aes128gcm\0')
const NONCE_INFO = new TextEncoder().encode('Content-Encoding: nonce\0')

/** The two halves of a browser's PushSubscription, as it serialises them. */
export type PushTarget = {
    readonly endpoint: string
    /** The UA's public key: uncompressed P-256 point, 65 bytes, base64url. */
    readonly p256dh: string
    /** The UA's auth secret: 16 bytes, base64url. */
    readonly auth: string
}

/**
 * A VAPID key pair in the encoding every tool in this space uses — raw
 * uncompressed public point and raw private scalar, both base64url — so a pair
 * from `web-push generate-vapid-keys` can be pasted straight in.
 */
export type VapidKeys = {
    readonly publicKey: string
    readonly privateKey: string
    /** `mailto:` or `https:` identifying whoever operates this server. */
    readonly subject: string
}

export function base64UrlEncode(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.byteLength
    }
    return out
}

/**
 * `exportKey('raw', …)` only ever yields an ArrayBuffer; the binding types say it
 * may also yield a JWK because one declaration covers every format.
 */
async function exportRaw(key: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array((await crypto.subtle.exportKey('raw', key)) as ArrayBuffer)
}

/**
 * ECDH against the subscription's public key.
 *
 * The property is `public`, per the WebCrypto specification and per what workerd
 * actually reads — @cloudflare/workers-types calls it `$public`, which is its
 * generator escaping a TypeScript modifier keyword rather than a real difference.
 * Writing `$public` would type-check and derive the wrong secret, so the value is
 * correct here and the type is corrected instead. The RFC 8291 vector in
 * test/web-push-crypto.test.ts is what proves which of the two runs.
 */
function ecdhWith(publicKey: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
    return { name: 'ECDH', public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
}

/**
 * One HKDF operation — extract then expand — which is what WebCrypto's HKDF does
 * and what each of RFC 8291 §3.4's two derivation steps is.
 */
async function hkdf(
    salt: Uint8Array,
    inputKeyMaterial: Uint8Array,
    info: Uint8Array,
    byteLength: number,
): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', inputKeyMaterial, 'HKDF', false, [
        'deriveBits',
    ])
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        key,
        byteLength * 8,
    )
    return new Uint8Array(bits)
}

/**
 * The body of an aes128gcm push: RFC 8188's header (salt, record size, the
 * sender's public key) followed by one AES-GCM record.
 *
 * `salt` and `localKeys` are arguments rather than generated here so the RFC's
 * test vector can be reproduced exactly; `encryptPayload` supplies fresh random
 * ones for real sends.
 */
export async function encryptPayloadWith(options: {
    readonly plaintext: Uint8Array
    readonly target: Pick<PushTarget, 'p256dh' | 'auth'>
    readonly salt: Uint8Array
    readonly localKeys: CryptoKeyPair
}): Promise<Uint8Array> {
    const { plaintext, target, salt, localKeys } = options

    const uaPublicBytes = base64UrlDecode(target.p256dh)
    const authSecret = base64UrlDecode(target.auth)
    const uaPublicKey = await crypto.subtle.importKey(
        'raw',
        uaPublicBytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
    )
    const localPublicBytes = await exportRaw(localKeys.publicKey)

    const ecdhSecret = new Uint8Array(
        await crypto.subtle.deriveBits(ecdhWith(uaPublicKey), localKeys.privateKey, 256),
    )

    // Combine the ECDH output with the subscription's auth secret. The key info
    // binds the derivation to both public keys, which is what stops a shared
    // secret being replayed against a different subscription.
    const ikm = await hkdf(
        authSecret,
        ecdhSecret,
        concat([KEY_INFO_PREFIX, uaPublicBytes, localPublicBytes]),
        32,
    )

    const contentEncryptionKey = await hkdf(salt, ikm, CEK_INFO, 16)
    const nonce = await hkdf(salt, ikm, NONCE_INFO, 12)

    const key = await crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, [
        'encrypt',
    ])
    // 0x02 is RFC 8188's delimiter for the last record. There is only ever one
    // record here, so it is always the last one.
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce },
            key,
            concat([plaintext, new Uint8Array([2])]),
        ),
    )

    const header = new Uint8Array(5)
    new DataView(header.buffer).setUint32(0, RECORD_SIZE)
    header[4] = localPublicBytes.byteLength

    return concat([salt, header, localPublicBytes, ciphertext])
}

/** As above, with a fresh salt and ephemeral key pair — the real send path. */
export async function encryptPayload(
    plaintext: Uint8Array,
    target: Pick<PushTarget, 'p256dh' | 'auth'>,
): Promise<Uint8Array> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    // One declaration covers symmetric keys and pairs alike, so the union has to
    // be narrowed; ECDH always generates a pair.
    const localKeys = (await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
    )) as CryptoKeyPair
    return encryptPayloadWith({ plaintext, target, salt, localKeys })
}

/**
 * Import a VAPID private key for signing. WebCrypto will not take a bare P-256
 * scalar, so it goes in as a JWK with the public point split into its
 * coordinates — which is also the check that the two halves of the pair actually
 * belong together, since an import with mismatched `d` and `x`/`y` fails here
 * rather than at the push service.
 */
async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
    const publicBytes = base64UrlDecode(keys.publicKey)
    if (publicBytes.byteLength !== 65 || publicBytes[0] !== 4) {
        throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point')
    }
    return crypto.subtle.importKey(
        'jwk',
        {
            kty: 'EC',
            crv: 'P-256',
            x: base64UrlEncode(publicBytes.subarray(1, 33)),
            y: base64UrlEncode(publicBytes.subarray(33, 65)),
            d: keys.privateKey,
            ext: false,
            key_ops: ['sign'],
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
    )
}

/**
 * The `Authorization` header for one push service origin. ES256 over a JWT whose
 * audience is that origin, which is what stops a token captured by one push
 * service being replayed against another.
 */
export async function vapidAuthorization(
    keys: VapidKeys,
    endpoint: string,
    nowS: number,
): Promise<string> {
    const encoder = new TextEncoder()
    const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const claims = base64UrlEncode(
        encoder.encode(
            JSON.stringify({
                aud: new URL(endpoint).origin,
                exp: nowS + VAPID_TOKEN_TTL_S,
                sub: keys.subject,
            }),
        ),
    )

    const signingInput = `${header}.${claims}`
    // WebCrypto's ECDSA output is already the raw r||s pair JWS ES256 wants — no
    // DER unwrapping, unlike most server-side crypto libraries.
    const signature = new Uint8Array(
        await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            await importVapidPrivateKey(keys),
            encoder.encode(signingInput),
        ),
    )

    return `vapid t=${signingInput}.${base64UrlEncode(signature)},k=${keys.publicKey}`
}

export type PushResult = {
    readonly ok: boolean
    readonly status: number
    /**
     * The push service says this subscription is gone for good, as opposed to
     * temporarily unreachable. The only response worth deleting a row over.
     */
    readonly isGone: boolean
}

/**
 * Encrypt and POST one push message. Never throws: a push that fails is a push
 * that fails, and the caller is a fire-and-forget `waitUntil` with nothing
 * useful to do about it beyond pruning a dead subscription.
 */
export async function sendPush(options: {
    readonly keys: VapidKeys
    readonly target: PushTarget
    readonly payload: string
    readonly nowS: number
    readonly ttlS?: number
}): Promise<PushResult> {
    const { keys, target, payload, nowS, ttlS = DEFAULT_TTL_S } = options

    try {
        const plaintext = new TextEncoder().encode(payload)
        if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
            // Encrypting it would only produce a body the push service rejects.
            return { ok: false, status: 0, isGone: false }
        }

        const body = await encryptPayload(plaintext, target)
        const response = await fetch(target.endpoint, {
            method: 'POST',
            headers: {
                Authorization: await vapidAuthorization(keys, target.endpoint, nowS),
                'Content-Encoding': 'aes128gcm',
                'Content-Type': 'application/octet-stream',
                TTL: ttlS.toString(),
                Urgency: 'normal',
            },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        return {
            ok: response.ok,
            status: response.status,
            // 404: the push service never had it. 410: it had it and the
            // browser has since dropped it. Both mean the row is dead.
            isGone: response.status === 404 || response.status === 410,
        }
    } catch {
        return { ok: false, status: 0, isGone: false }
    }
}
