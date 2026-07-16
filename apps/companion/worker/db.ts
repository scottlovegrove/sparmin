import { drizzle } from 'drizzle-orm/d1'
import { sessions, stationIntervals, stations } from '../src/db/schema'

const schema = { stations, sessions, stationIntervals }

export type Db = ReturnType<typeof createDb>

//! Wrap the request's D1 binding in Drizzle. One per request — D1Database is a
//! binding, not a pooled connection, so there is nothing to reuse across them.
export function createDb(d1: D1Database) {
    return drizzle(d1, { schema })
}
