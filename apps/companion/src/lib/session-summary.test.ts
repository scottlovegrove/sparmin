import { describe, expect, it } from 'vitest'
import { type Stay, type ThermalClass, formatStay, summarise } from './session-summary'

let order = 0
const stay = (station: string, thermalClass: ThermalClass, elapsedS: number): Stay => ({
    order: order++,
    station,
    thermalClass,
    isTransition: station === 'transition',
    startedAt: 0,
    endedAt: elapsedS,
    elapsedS,
    timerS: elapsedS,
    avgHr: null,
    maxHr: null,
    calories: null,
    cycles: null,
})

const hot = (s: number) => stay('Himalayan salt sauna', 'hot', s)
const cold = (s: number) => stay('Outdoor cold plunge', 'cold', s)
const walk = (s: number) => stay('transition', 'unclassified', s)
const lounge = (s: number) => stay('Outdoor lounger', 'neutral', s)

describe('summarise', () => {
    it('splits the time by what the station is', () => {
        const s = summarise([hot(900), walk(60), cold(300), walk(30), lounge(120)])

        expect(s).toMatchObject({ hotS: 900, coldS: 300, neutralS: 120, transitionS: 90 })
    })

    it('keeps the walking apart from the exposure', () => {
        // Transitions are real time, but sitting in neither heat nor cold — folding
        // them into either would overstate a dose.
        const s = summarise([hot(600), walk(120)])

        expect(s.hotS).toBe(600)
        expect(s.transitionS).toBe(120)
        expect(s.coldS).toBe(0)
    })

    it('counts a cycle when heat is followed by cold', () => {
        expect(summarise([hot(900), walk(60), cold(300)]).contrastCycles).toBe(1)
        expect(
            summarise([hot(900), walk(60), cold(300), walk(60), hot(600), walk(60), cold(240)])
                .contrastCycles,
        ).toBe(2)
    })

    it('counts the crossing, not the stays either side of it', () => {
        // Two saunas then one plunge is one cycle: you went from heat to cold once.
        const s = summarise([hot(600), walk(30), hot(600), walk(60), cold(300)])

        expect(s.contrastCycles).toBe(1)
    })

    it('needs the heat first — cold on its own is not a cycle', () => {
        expect(summarise([cold(300), walk(60), cold(240)]).contrastCycles).toBe(0)
        expect(summarise([lounge(600), walk(60), cold(300)]).contrastCycles).toBe(0)
    })

    it('does not let the walk between them break the cycle', () => {
        // Walking from the sauna to the plunge is how the circuit works.
        expect(summarise([hot(900), walk(200), cold(300)]).contrastCycles).toBe(1)
    })

    it('ignores a station nobody has classified yet', () => {
        const unknown = stay('Cryotherapy chamber', 'unclassified', 120)
        const s = summarise([hot(600), unknown, cold(300)])

        expect(s).toMatchObject({ hotS: 600, coldS: 300, neutralS: 0 })
        // Still a cycle: an unclassified stay is unknown, not an interruption.
        expect(s.contrastCycles).toBe(1)
    })

    it('handles a session with nothing in it', () => {
        expect(summarise([])).toEqual({
            hotS: 0,
            coldS: 0,
            neutralS: 0,
            transitionS: 0,
            contrastCycles: 0,
        })
    })
})

describe('formatStay', () => {
    it('keeps the seconds a stay is measured in', () => {
        expect(formatStay(301)).toBe('5:01')
        expect(formatStay(899.945)).toBe('15:00')
        expect(formatStay(59)).toBe('0:59')
        expect(formatStay(0.092)).toBe('0:00')
    })
})
