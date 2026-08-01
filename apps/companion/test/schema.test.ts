import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signIn } from './auth-helper'
import { countRows, resetUsers, uuid } from './helpers'

// The migration that adds watch sync rebuilds `sessions` — SQLite cannot drop a
// NOT NULL or a UNIQUE in place. These assert the shape that rebuild is supposed
// to leave behind, because a bad hand-edit to the generated SQL is otherwise only
// visible as every other suite failing at setup with a confusing error.
// See docs/watch-sync-spec.md §3.5.

type ColumnInfo = { name: string; notnull: number; dflt_value: string | null }

async function columns(table: string): Promise<Map<string, ColumnInfo>> {
    const { results } = await env.DB.prepare(
        `SELECT name, "notnull", dflt_value FROM pragma_table_info(?)`,
    )
        .bind(table)
        .all<ColumnInfo>()
    return new Map(results.map((column) => [column.name, column]))
}

async function indexNames(table: string): Promise<string[]> {
    const { results } = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
    )
        .bind(table)
        .all<{ name: string }>()
    return results.map((row) => row.name)
}

describe('the sessions rebuild', () => {
    it('leaves device_serial nullable, so a watch push can omit it', async () => {
        const sessions = await columns('sessions')

        expect(sessions.get('device_serial')?.notnull).toBe(0)
    })

    it('defaults source to fit, which is what every pre-existing row was', async () => {
        const sessions = await columns('sessions')

        expect(sessions.get('source')?.dflt_value).toBe("'fit'")
        expect(sessions.get('source')?.notnull).toBe(1)
    })

    it('drops the device-serial dedupe key it replaced', async () => {
        const indexes = await indexNames('sessions')

        expect(indexes).not.toContain('sessions_dedupe')
        expect(indexes).toContain('idx_sessions_user_started')
    })

    it('still guards concurrent imports of the same export', async () => {
        // The old unique key was the only thing stopping two simultaneous
        // imports both passing ingest's duplicate check and both inserting.
        // It survives as a partial index over the rows it always covered.
        const indexes = await indexNames('sessions')

        expect(indexes).toContain('idx_sessions_fit_dedupe')
    })

    it('keeps one ascending index rather than a separate descending one', async () => {
        // SQLite reads an index in either direction, so the list's ORDER BY
        // started_at DESC and the ingest window's range scan share this one.
        const indexes = await indexNames('sessions')

        expect(indexes).not.toContain('idx_sessions_user_time')
    })
})

describe('the watch session id index', () => {
    let userId: string

    beforeEach(async () => {
        await resetUsers()
        // A real sign-in, so the user_id foreign key is satisfied — these go in
        // through raw SQL rather than the API to reach the index directly.
        userId = (await signIn()).userId
    })

    async function insertSession(id: string, watchSessionId: string | null): Promise<void> {
        await env.DB.prepare(
            `INSERT INTO sessions
                (id, user_id, started_at, ended_at, total_elapsed_s, created_at, watch_session_id)
             VALUES (?, ?, 1783496460, 1783498774, 2313, 1783498800, ?)`,
        )
            .bind(id, userId, watchSessionId)
            .run()
    }

    it('lets any number of sessions have no watch id', async () => {
        // The partial index exists precisely so FIT-only imports don't collide
        // with each other on a column none of them populate.
        await insertSession(uuid(1), null)
        await insertSession(uuid(2), null)

        expect(await countRows('sessions')).toBe(2)
    })

    it('refuses a second session claiming the same watch id', async () => {
        // This is what makes an offline-queue re-send idempotent.
        await insertSession(uuid(1), 'watch-session-a')

        await expect(insertSession(uuid(2), 'watch-session-a')).rejects.toThrow()
    })
})

describe('the FIT dedupe index', () => {
    let userId: string

    beforeEach(async () => {
        await resetUsers()
        userId = (await signIn()).userId
    })

    async function insertFitSession(id: string, serial: string | null): Promise<void> {
        await env.DB.prepare(
            `INSERT INTO sessions
                (id, user_id, started_at, ended_at, total_elapsed_s, created_at, device_serial)
             VALUES (?, ?, 1783496460, 1783498774, 2313, 1783498800, ?)`,
        )
            .bind(id, userId, serial)
            .run()
    }

    it('refuses two imports of the same visit from the same watch', async () => {
        // Ingest's own duplicate check is a separate statement from the insert,
        // so two concurrent imports can both pass it. This is the backstop.
        await insertFitSession(uuid(1), '1234567890')

        await expect(insertFitSession(uuid(2), '1234567890')).rejects.toThrow()
    })

    it('does not constrain watch pushes, which have no serial', async () => {
        await insertFitSession(uuid(1), null)
        await insertFitSession(uuid(2), null)

        expect(await countRows('sessions')).toBe(2)
    })
})

describe('the station catalogue', () => {
    it('gives every station the watch knows a slug', async () => {
        const { results } = await env.DB.prepare(
            `SELECT name, slug FROM stations WHERE slug IS NULL`,
        ).all<{ name: string; slug: string | null }>()

        // `transition` is a lap label, not a catalogue entry — the watch never
        // sends it, so it is the only row without one.
        expect(results.map((row) => row.name)).toEqual(['transition'])
    })

    it('maps the display name the FIT writes to the id the watch sends', async () => {
        const row = await env.DB.prepare(
            `SELECT name FROM stations WHERE slug = 'salt_sauna'`,
        ).first<{
            name: string
        }>()

        expect(row?.name).toBe('Himalayan salt sauna')
    })
})
