import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { signIn } from './auth-helper'
import { getJson } from './helpers'

type StationRow = {
    id: number
    name: string
    thermalClass: string
    isTransition: boolean
}

const get = async () => getJson<{ stations: StationRow[] }>('/api/stations', await signIn())

describe('GET /api/stations', () => {
    it('returns the seeded catalogue in watch order', async () => {
        const { status, body } = await get()

        expect(status).toBe(200)
        expect(body.stations.map((s) => s.name)).toEqual([
            'Outdoor cold plunge',
            'Indoor cold plunge',
            'Hydro pool',
            'Heated loungers',
            'Himalayan salt sauna',
            'Steam room',
            'Fire and ice room',
            'Finnish sauna',
            'Ice cave',
            'Outdoor lounger',
            'transition',
        ])
    })

    it('classes the circuit, and marks transition as the only non-station', async () => {
        const { body } = await get()
        const byName = new Map(body.stations.map((s) => [s.name, s]))

        expect(byName.get('Himalayan salt sauna')?.thermalClass).toBe('hot')
        expect(byName.get('Hydro pool')?.thermalClass).toBe('hot')
        expect(byName.get('Heated loungers')?.thermalClass).toBe('hot')
        expect(byName.get('Fire and ice room')?.thermalClass).toBe('hot')
        expect(byName.get('Ice cave')?.thermalClass).toBe('cold')
        expect(byName.get('Outdoor cold plunge')?.thermalClass).toBe('cold')
        expect(byName.get('Outdoor lounger')?.thermalClass).toBe('neutral')

        // transition is the walk between stations: never counts as hot or cold.
        const transition = byName.get('transition')
        expect(transition?.isTransition).toBe(true)
        expect(transition?.thermalClass).toBe('unclassified')
        expect(body.stations.filter((s) => s.isTransition)).toHaveLength(1)
    })

    it('seeds a station for every label the parser can produce', async () => {
        const { body } = await get()
        // The FIT fixtures' labels must all resolve; this is the parser -> DB join.
        const seeded = new Set(body.stations.map((s) => s.name))
        for (const label of ['Himalayan salt sauna', 'Steam room', 'Ice cave', 'transition']) {
            expect(seeded.has(label), label).toBe(true)
        }
    })
})

describe('stations schema', () => {
    it('rejects an invalid thermal_class', async () => {
        await expect(
            env.DB.prepare(
                "INSERT INTO stations (name, thermal_class, is_transition, created_at) VALUES ('Bad', 'lukewarm', 0, 0)",
            ).run(),
        ).rejects.toThrow()
    })

    it('rejects a duplicate station name', async () => {
        await expect(
            env.DB.prepare(
                "INSERT INTO stations (name, thermal_class, is_transition, created_at) VALUES ('Steam room', 'hot', 0, 0)",
            ).run(),
        ).rejects.toThrow()
    })
})
