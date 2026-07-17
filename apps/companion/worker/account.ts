import { eq } from 'drizzle-orm'
import { user, verification } from '../src/db/auth-schema'
import type { Db } from './db'

//! Hard-delete a user and everything tied to them. Returns false if there is no
//! such user. The one `user` row is the root: `session`, `account`, `passkey`,
//! `sessions` and `station_intervals` all cascade off it via ON DELETE CASCADE.
//! `verification` is the exception — it is keyed by email, not user id, so it is
//! cleared explicitly here. Both deletes run in one D1 batch (an implicit
//! transaction), so a half-deleted account can't be left behind.
export async function deleteAccount(db: Db, userId: string): Promise<boolean> {
    const [existing] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
    if (existing == null) {
        return false
    }

    await db.batch([
        db.delete(verification).where(eq(verification.identifier, existing.email)),
        db.delete(user).where(eq(user.id, userId)),
    ])
    return true
}
