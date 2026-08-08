import { describe, expect, it } from 'vitest'
import app from '../worker'

describe('GET /api/version', () => {
    // No sign-in: the point of the assertion is that the route is in PUBLIC_PATHS,
    // so it answers rather than 401s. `dev` is what the define falls back to when
    // COMPANION_BUILD is unset, which is every run outside the deploy workflow.
    it('reports the build without a session', async () => {
        const res = await app.request('/api/version')

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ version: 'dev' })
    })
})
