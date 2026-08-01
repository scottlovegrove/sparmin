import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

// A migration that rebuilds a table silently deletes every row that references
// it, and the table being rebuilt survives — so nothing looks wrong until
// someone opens a record and finds it empty. That is what happened to
// station_intervals in production (see AGENTS.md, Migrations).
//
// No test that starts from an empty database can catch this, and every test
// database here starts empty. So this one seeds a parent and a child part-way
// through the migration history and counts the children at the end.

const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations')

function migrations(): { name: string; sql: string }[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

//! Apply one migration the way D1 does: every statement in the file inside a
//! single transaction, with foreign keys enforced.
//!
//! Both halves matter. Foreign keys are on because D1 has them on, and a
//! `PRAGMA foreign_keys=OFF` in the file cannot change that — the pragma is a
//! no-op inside a transaction, which is the whole reason this test exists.
function applyMigration(db: DatabaseSync, sql: string): void {
    db.exec('BEGIN')
    try {
        for (const statement of sql.split('--> statement-breakpoint')) {
            if (statement.trim().length > 0) {
                db.exec(statement)
            }
        }
        db.exec('COMMIT')
    } catch (err) {
        db.exec('ROLLBACK')
        throw err
    }
}

function tableExists(db: DatabaseSync, name: string): boolean {
    return (
        (
            db
                .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`)
                .get(name) as { n: number }
        ).n > 0
    )
}

function count(db: DatabaseSync, table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

// The seed needs a user to hang a session off, so it goes in as soon as the
// auth tables exist. Everything after that point is what this guards.
//
// That leaves 0002 itself uncovered — it is the migration that creates `user`,
// and before it there is nothing to satisfy the foreign key, while its own
// orphan-cleanup would legitimately delete any session seeded without one. It
// had the same flaw and was fixed by hand; every migration after it, and every
// migration added from here, is covered.
function seed(db: DatabaseSync): void {
    db.exec(`
        INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
            VALUES ('seed-user', 'Seed', 'seed@example.com', 1, 1, 1);
        INSERT INTO sessions
            (id, user_id, started_at, ended_at, device_serial, total_elapsed_s, created_at)
            VALUES ('seed-session', 'seed-user', 1000, 2000, '1234567890', 1000, 1);
        INSERT INTO station_intervals
            (session_id, user_id, station_id, lap_index, started_at, ended_at, elapsed_s)
            VALUES ('seed-session', 'seed-user', 1, 0, 1000, 1500, 500),
                   ('seed-session', 'seed-user', 2, 1, 1500, 2000, 500);
    `)
}

describe('applying every migration to a database with rows in it', () => {
    it('keeps the sessions and their stays', () => {
        const db = new DatabaseSync(':memory:')
        db.exec('PRAGMA foreign_keys = ON')

        let seeded = false
        for (const migration of migrations()) {
            applyMigration(db, migration.sql)
            // As soon as there is somewhere to put it, put it there — so every
            // migration from that point on has to carry it.
            if (
                !seeded &&
                ['user', 'sessions', 'station_intervals'].every((t) => tableExists(db, t))
            ) {
                seed(db)
                seeded = true
                expect(count(db, 'station_intervals')).toBe(2)
            }
        }

        expect(seeded).toBe(true)
        expect(count(db, 'sessions')).toBe(1)
        // The assertion this whole file exists for. It was 0 in production.
        expect(count(db, 'station_intervals')).toBe(2)
    })

    it('leaves no scratch tables behind', () => {
        const db = new DatabaseSync(':memory:')
        db.exec('PRAGMA foreign_keys = ON')
        for (const migration of migrations()) {
            applyMigration(db, migration.sql)
        }

        const scratch = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '\\_\\_%' ESCAPE '\\'`,
            )
            .all() as { name: string }[]

        expect(scratch.map((row) => row.name)).toEqual([])
    })
})
