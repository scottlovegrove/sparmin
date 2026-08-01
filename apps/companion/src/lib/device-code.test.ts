import { describe, expect, it } from 'vitest'
import {
    DEVICE_CODE_ALPHABET,
    USER_CODE_LENGTH,
    formatUserCode,
    generateUserCode,
    isUserCodeShaped,
    normaliseUserCode,
} from './device-code'

describe('the code alphabet', () => {
    it('leaves out the characters that get misread off a watch face', () => {
        expect(DEVICE_CODE_ALPHABET).not.toContain('0')
        expect(DEVICE_CODE_ALPHABET).not.toContain('O')
        expect(DEVICE_CODE_ALPHABET).not.toContain('1')
        expect(DEVICE_CODE_ALPHABET).not.toContain('I')
    })

    it('has a power-of-two size, so masking a random byte stays uniform', () => {
        expect(DEVICE_CODE_ALPHABET).toHaveLength(32)
    })
})

describe('generateUserCode', () => {
    it('produces a code of the expected length from the alphabet only', () => {
        const code = generateUserCode()

        expect(code).toHaveLength(USER_CODE_LENGTH)
        expect([...code].every((c) => DEVICE_CODE_ALPHABET.includes(c))).toBe(true)
    })

    it('does not repeat itself', () => {
        // Not a randomness test — just that it isn't a constant.
        const codes = new Set(Array.from({ length: 50 }, generateUserCode))

        expect(codes.size).toBeGreaterThan(1)
    })
})

describe('normaliseUserCode', () => {
    it('accepts the form the user sees, hyphen and all', () => {
        expect(normaliseUserCode('K7QM-4XB9')).toBe('K7QM4XB9')
    })

    it('accepts lower case', () => {
        expect(normaliseUserCode('k7qm4xb9')).toBe('K7QM4XB9')
    })

    it('survives a stray space from selecting the text', () => {
        expect(normaliseUserCode('  K7QM 4XB9 ')).toBe('K7QM4XB9')
    })
})

describe('formatUserCode', () => {
    it('groups the code so it reads back reliably', () => {
        expect(formatUserCode('K7QM4XB9')).toBe('K7QM-4XB9')
    })

    it('is idempotent, so it can format as the user types', () => {
        expect(formatUserCode(formatUserCode('K7QM4XB9'))).toBe('K7QM-4XB9')
    })

    it('leaves a part-typed code alone until there is something to group', () => {
        expect(formatUserCode('K7Q')).toBe('K7Q')
    })
})

describe('isUserCodeShaped', () => {
    it('accepts a full code in either form', () => {
        expect(isUserCodeShaped('K7QM4XB9')).toBe(true)
        expect(isUserCodeShaped('k7qm-4xb9')).toBe(true)
    })

    it('rejects a code that is still being typed', () => {
        expect(isUserCodeShaped('K7QM4XB')).toBe(false)
    })

    it('rejects characters the alphabet deliberately excludes', () => {
        // A user reading `0` for `O` should be told before the round trip.
        expect(isUserCodeShaped('K7QM4XB0')).toBe(false)
        expect(isUserCodeShaped('K7QM4XBI')).toBe(false)
    })
})
