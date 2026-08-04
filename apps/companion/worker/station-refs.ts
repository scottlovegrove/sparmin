import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { stations } from '../src/db/schema'
import type { Db } from './db'

// How a source names a station. The FIT writes the display name into each lap;
// the watch sends the catalogue's permanent id. Both land on the same row — the
// slug column exists so neither has to know the other's key.
export type StationRef =
    | { readonly kind: 'name'; readonly name: string }
    | { readonly kind: 'slug'; readonly slug: string; readonly displayName: string | null }

// A ref reduced to something a Map can key on.
export function stationKey(ref: StationRef): string {
    return ref.kind === 'name' ? `name:${ref.name}` : `slug:${ref.slug}`
}

// Stations the catalogue has since renamed, old name to current one. A FIT
// recorded before a rename still carries the old label in its laps, so it is
// folded onto the row it has always meant rather than auto-inserted as a station
// of its own.
const RENAMED_STATIONS: Readonly<Record<string, string>> = {
    'Outdoor lounger': 'Loungers',
}

function label(ref: StationRef): string {
    const name = ref.kind === 'name' ? ref.name : (ref.displayName ?? ref.slug)
    return RENAMED_STATIONS[name] ?? name
}

//! Resolve every station a session refers to, whichever key it used, inserting
//! anything the catalogue doesn't know as `unclassified` rather than rejecting
//! the session (§4.4). A watch that ships a new station must never cost the user
//! a visit; the unknown label surfaces for tagging later.
//!
//! A slug that isn't in the catalogue but whose display name is gets adopted:
//! that is the row a FIT import auto-inserted first, and giving it the slug now
//! means the two sources stop diverging from here on.
export async function resolveStations(
    db: Db,
    refs: readonly StationRef[],
): Promise<Map<string, number>> {
    const unique = new Map(refs.map((ref) => [stationKey(ref), ref]))
    if (unique.size === 0) {
        return new Map()
    }

    const names = [...unique.values()].map(label)
    const slugs = [...unique.values()].filter((ref) => ref.kind === 'slug').map((ref) => ref.slug)

    const known = await db
        .select({ id: stations.id, name: stations.name, slug: stations.slug })
        .from(stations)
        .where(
            slugs.length > 0
                ? or(inArray(stations.name, names), inArray(stations.slug, slugs))
                : inArray(stations.name, names),
        )
    const byName = new Map(known.map((row) => [row.name, row]))
    const bySlug = new Map(
        known.filter((row) => row.slug != null).map((row) => [row.slug as string, row.id]),
    )

    const resolved = new Map<string, number>()
    const adoptions: { id: number; slug: string }[] = []
    const missing: StationRef[] = []

    for (const [key, ref] of unique) {
        const id = ref.kind === 'name' ? byName.get(label(ref))?.id : bySlug.get(ref.slug)
        if (id != null) {
            resolved.set(key, id)
            continue
        }
        if (ref.kind === 'slug') {
            const named = byName.get(label(ref))
            // A slug the catalogue lacks, but whose display name it has: the row
            // a FIT import created before the watch was ever linked. Claim it —
            // but only while it is unclaimed. `stations` is shared by every
            // account, so a stale or wrong payload must not be able to repoint a
            // slug and break resolution for everyone.
            if (named != null && named.slug == null) {
                resolved.set(key, named.id)
                adoptions.push({ id: named.id, slug: ref.slug })
                continue
            }
            // Already spoken for by a different id: use the row, change nothing.
            if (named != null) {
                resolved.set(key, named.id)
                continue
            }
        }
        missing.push(ref)
    }

    for (const adoption of adoptions) {
        await db
            .update(stations)
            .set({ slug: adoption.slug })
            // Still unclaimed at write time, not merely when it was read.
            .where(and(eq(stations.id, adoption.id), isNull(stations.slug)))
    }

    if (missing.length === 0) {
        return resolved
    }

    const now = Math.floor(Date.now() / 1000)
    const inserted = await db
        .insert(stations)
        .values(
            missing.map((ref) => ({
                name: label(ref),
                slug: ref.kind === 'slug' ? ref.slug : null,
                thermalClass: 'unclassified' as const,
                createdAt: now,
            })),
        )
        .onConflictDoNothing()
        .returning({ id: stations.id, name: stations.name })
    const insertedByName = new Map(inserted.map((row) => [row.name, row.id]))

    // A concurrent write may have inserted the same label first, in which case
    // onConflictDoNothing returned nothing for it — read those back.
    const stillMissing = missing.filter((ref) => !insertedByName.has(label(ref)))
    if (stillMissing.length > 0) {
        const raced = await db
            .select({ id: stations.id, name: stations.name })
            .from(stations)
            .where(inArray(stations.name, stillMissing.map(label)))
        for (const row of raced) {
            insertedByName.set(row.name, row.id)
        }
    }

    for (const ref of missing) {
        const id = insertedByName.get(label(ref))
        if (id != null) {
            resolved.set(stationKey(ref), id)
        }
    }
    return resolved
}
