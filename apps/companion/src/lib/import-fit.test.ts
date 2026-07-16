import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importFit } from './import-fit'

const fixture = fileURLToPath(
    new URL('../../test/fixtures/23520138132_ACTIVITY.fit', import.meta.url),
)

// A real export, and something that plainly isn't one.
const fitFile = () => new File([readFileSync(fixture)], 'spa.fit')
const junkFile = () => new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'holiday.fit')

function mockFetch(status: number) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('importFit', () => {
    it('posts the parsed session, not the file', async () => {
        const fetchMock = mockFetch(201)

        const outcome = await importFit(fitFile())

        expect(outcome).toEqual({ status: 'imported' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/sessions')
        const body = JSON.parse(init.body as string)
        // The FIT bytes stay in the browser — the payload is the parsed session.
        expect(body).toMatchObject({
            device: { serial: '1234567890', product: 'vivoactive5' },
            session: { startedAt: 1783496460, totalCalories: 267 },
        })
        expect(body.laps).toHaveLength(11)
        expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('reports an already-imported file as such, not as an error', async () => {
        mockFetch(409)

        expect(await importFit(fitFile())).toEqual({ status: 'duplicate' })
    })

    it('rejects a file that is not a spa session without calling the API', async () => {
        const fetchMock = mockFetch(201)

        const outcome = await importFit(junkFile())

        expect(outcome.status).toBe('rejected')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('explains an expired session rather than showing a status code', async () => {
        mockFetch(401)

        expect(await importFit(fitFile())).toEqual({
            status: 'rejected',
            reason: 'Your session expired — sign in again',
        })
    })

    it('surfaces an unexpected server response', async () => {
        mockFetch(500)

        const outcome = await importFit(fitFile())

        expect(outcome).toMatchObject({ status: 'rejected' })
    })

    it('refuses an oversized file without reading it into memory', async () => {
        const fetchMock = mockFetch(201)
        // Claims to be 11 MB. A real export is tens of kilobytes, and reading
        // something huge in would take the tab down before anything rejected it.
        const huge = fitFile()
        const readSpy = vi.spyOn(huge, 'arrayBuffer')
        vi.spyOn(huge, 'size', 'get').mockReturnValue(11 * 1024 * 1024)

        const outcome = await importFit(huge)

        expect(outcome).toEqual({ status: 'rejected', reason: 'Too big to be a spa session' })
        expect(readSpy).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
