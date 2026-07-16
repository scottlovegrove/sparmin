import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { parseFit } from '../src/lib/fit/parse-fit'
import app from '../worker'

// The 8 July recording: made by the watch build that never wrote the developer
// field_description, so its station labels only survive the number-based read.
// Parsing it here and posting the result proves the parser's output actually
// satisfies the ingest contract, and that every label it produces resolves
// against the seeded catalogue — the two halves share a schema, but nothing else
// checks they meet.
describe('ingesting a real FIT export', () => {
    it('parses and imports, resolving every lap to a seeded station', async () => {
        const parsed = parseFit(Uint8Array.from(env.TEST_FIT_FIXTURE))

        const res = await app.request(
            '/api/sessions',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: crypto.randomUUID(), ...parsed }),
            },
            env,
        )

        expect(res.status).toBe(201)

        const rows = await env.DB.prepare(
            `SELECT s.name FROM station_intervals si
             JOIN stations s ON s.id = si.station_id
             ORDER BY si.lap_index`,
        ).all<{ name: string }>()

        expect(rows.results.map((r) => r.name)).toEqual([
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

        // Every label matched the seeded catalogue — nothing was auto-inserted,
        // so the watch's names and the seed are still in step.
        const unclassified = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM stations WHERE thermal_class = 'unclassified' AND is_transition = 0",
        ).first<{ n: number }>()
        expect(unclassified?.n).toBe(0)
    })
})
