// The alphabet a human reads off a watch face and types into a browser. No `0`
// or `O`, no `1` or `I` — the pairs that get mistyped when the code is being read
// from a small screen, possibly through steam.
//
// 32 symbols, and 32 divides 256 exactly, so masking a random byte with 31 is
// uniform. A modulo against a non-power-of-two alphabet would not be.
export const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const USER_CODE_LENGTH = 6

// Where the hyphen goes in the displayed form. Two groups read back more
// reliably than one run of six.
const GROUP_AT = 4

//! A fresh user code, in stored form (no hyphen, upper case).
export function generateUserCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH))
    return [...bytes].map((byte) => DEVICE_CODE_ALPHABET[byte & 31]).join('')
}

//! What the user typed, reduced to what is stored. They will paste it with the
//! hyphen, or in lower case, or with a stray space from a double-tap selection —
//! none of which should be the difference between linking and not.
export function normaliseUserCode(input: string): string {
    return input.replace(/[\s-]/g, '').toUpperCase()
}

//! The display form: `K7QM-42`.
export function formatUserCode(code: string): string {
    const normalised = normaliseUserCode(code)
    if (normalised.length <= GROUP_AT) {
        return normalised
    }
    return `${normalised.slice(0, GROUP_AT)}-${normalised.slice(GROUP_AT)}`
}

//! Whether this could be a code at all — the right length, and only characters
//! the alphabet contains. Lets the UI refuse an obvious typo without a round
//! trip, and keeps a junk value out of the lookup.
export function isUserCodeShaped(input: string): boolean {
    const normalised = normaliseUserCode(input)
    return (
        normalised.length === USER_CODE_LENGTH &&
        [...normalised].every((character) => DEVICE_CODE_ALPHABET.includes(character))
    )
}
