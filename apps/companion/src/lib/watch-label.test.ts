import { describe, expect, it } from 'vitest'
import { watchLabel, watchSubtitle } from './watch-label'

describe('watchLabel', () => {
    it('translates the part number Connect IQ actually reports', () => {
        expect(watchLabel({ product: '006-B4426-00' })).toBe('vívoactive 5')
    })

    it('prefers a name the user gave it', () => {
        expect(watchLabel({ name: 'Pool watch', product: '006-B4426-00' })).toBe('Pool watch')
    })

    // A device newer than the shipped map is still recognisable to someone who
    // can look the number up. A blank row is not.
    it('shows an unknown part number rather than nothing', () => {
        expect(watchLabel({ product: '006-BZZZZ-00' })).toBe('006-BZZZZ-00')
    })

    it('falls back to a generic label when there is nothing at all', () => {
        expect(watchLabel({})).toBe('A Garmin watch')
        expect(watchLabel({ name: '   ', product: null })).toBe('A Garmin watch')
    })

    it('ignores a name that is only whitespace', () => {
        expect(watchLabel({ name: '  ', product: '006-B4426-00' })).toBe('vívoactive 5')
    })
})

describe('watchSubtitle', () => {
    // Renaming a watch replaces the only clue to which physical device it is,
    // so the model moves underneath rather than disappearing.
    it('keeps the model visible under a renamed watch', () => {
        expect(watchSubtitle({ name: 'Pool watch', product: '006-B4426-00' })).toBe('vívoactive 5')
    })

    it('says nothing when the label is already the model', () => {
        expect(watchSubtitle({ product: '006-B4426-00' })).toBeNull()
    })
})
