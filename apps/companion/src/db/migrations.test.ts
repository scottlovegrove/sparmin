import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A migration that rebuilds a table silently deletes every row that references
// it, and the table being rebuilt survives — so nothing looks wrong until
// someone opens a record and finds it empty. That is what happened to
// station_intervals in production (see AGENTS.md, Migrations).
//
// No test that starts from an empty database can catch this, and every test
// database here starts empty. So this reads the SQL instead.

const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations')

function migrationFiles(): { name: string; sql: string }[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

// Drizzle's rebuild works through a `__new_`-prefixed copy; anything else
// beginning with `__` is a temp table a migration made for itself. Neither is a
// real table with dependants.
function isScratchTable(table: string): boolean {
    return table.startsWith('__')
}

function droppedTables(sql: string): string[] {
    return [...sql.matchAll(/DROP TABLE (?:IF EXISTS )?[`"]?(\w+)[`"]?/gi)]
        .map((match) => match[1])
        .filter((table) => !isScratchTable(table))
}

function tablesReferencing(target: string, files: { sql: string }[]): boolean {
    const reference = new RegExp(`REFERENCES\\s+[\`"]?${target}[\`"]?`, 'i')
    return files.some((file) => reference.test(file.sql))
}

describe('migrations that rebuild a table', () => {
    it('carry the dependent rows across the drop', () => {
        const files = migrationFiles()
        const unsafe: string[] = []

        for (const file of files) {
            for (const table of droppedTables(file.sql)) {
                if (!tablesReferencing(table, files)) {
                    // Nothing points at it, so nothing can be cascaded away.
                    continue
                }
                // The carry is the only thing that survives the cascade —
                // `PRAGMA foreign_keys=OFF` does not, being a no-op inside the
                // transaction D1 wraps every migration in.
                if (!file.sql.includes('__carry_')) {
                    unsafe.push(`${file.name} drops \`${table}\`, which other tables reference`)
                }
            }
        }

        expect(unsafe).toEqual([])
    })

    it('recognises a rebuild of a referenced table as needing one', () => {
        // Guards the guard: if the detection ever stops matching, the test above
        // passes for the wrong reason and the next rebuild goes through unnoticed.
        const files = migrationFiles()
        const rebuilds = files.filter((file) =>
            droppedTables(file.sql).some((table) => tablesReferencing(table, files)),
        )

        expect(rebuilds.length).toBeGreaterThan(0)
    })
})
