import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FitParseError, parseFit } from './parse-fit'

const fixturesDir = fileURLToPath(new URL('../../../test/fixtures', import.meta.url))
const load = (name: string) => readFileSync(`${fixturesDir}/${name}`)
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.fit'))

// The two oldest recordings were made by a watch build that never wrote the
// developer field_description, so the station labels only survive via the raw,
// number-based read. The rest carry the full scaffolding.
const BROKEN_FIXTURE = '23520138132_ACTIVITY.fit' // 8 July 2026

describe('parseFit', () => {
    it('parses every fixture into a valid payload', () => {
        expect(fixtures.length).toBeGreaterThan(0)
        for (const name of fixtures) {
            const parsed = parseFit(load(name))
            expect(parsed.device.product, name).toBe('vivoactive5')
            expect(parsed.device.serial, name).toBe('1234567890')
            expect(parsed.laps.length, name).toBeGreaterThan(0)
            // Every lap resolves a station label — the crux for the older files.
            for (const lap of parsed.laps) {
                expect(lap.station.length, `${name} lap ${lap.lapIndex}`).toBeGreaterThan(0)
            }
        }
    })

    it('recovers station labels from a file missing the field_description', () => {
        const parsed = parseFit(load(BROKEN_FIXTURE))
        expect(parsed.laps.map((l) => l.station)).toEqual([
            'transition',
            'Himalayan salt sauna',
            'transition',
            'Heated loungers',
            'transition',
            'Hydro pool',
            'transition',
            'Steam room',
            'transition',
            'Ice cave',
            'transition',
        ])
    })

    it('maps session totals verbatim, as unix seconds', () => {
        const { session, device } = parseFit(load(BROKEN_FIXTURE))
        expect(device).toEqual({ serial: '1234567890', product: 'vivoactive5' })
        expect(session).toEqual({
            startedAt: 1783496460,
            endedAt: 1783498774, // round(startedAt + totalElapsedS)
            utcOffsetS: 3600,
            totalElapsedS: 2313.637,
            totalTimerS: 2313.637,
            totalCalories: 267,
            avgHr: 99,
            maxHr: 133,
        })
    })

    it('derives lap start from FIT epoch and carries the native fields', () => {
        const { laps } = parseFit(load(BROKEN_FIXTURE))
        expect(laps[0]).toEqual({
            lapIndex: 0,
            station: 'transition',
            startedAt: 1783496460,
            elapsedS: 0.092,
            timerS: 0.092,
            avgHr: null,
            maxHr: null,
            calories: null,
            cycles: null,
        })
        expect(laps[1]).toEqual({
            lapIndex: 1,
            station: 'Himalayan salt sauna',
            startedAt: 1783496461,
            elapsedS: 899.945,
            timerS: 899.945,
            avgHr: 98,
            maxHr: 119,
            calories: 109,
            cycles: 3,
        })
    })

    it('closes with the trailing sessionEnd transition lap', () => {
        const { laps } = parseFit(load(BROKEN_FIXTURE))
        const last = laps.at(-1)
        expect(last?.station).toBe('transition')
        expect(last?.elapsedS).toBeLessThan(5)
    })

    it('rejects a non-FIT input', () => {
        expect(() => parseFit(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(FitParseError)
    })
})
