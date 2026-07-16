import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` diffs src/db/schema.ts and writes SQL migrations to
// ./migrations. Migrations are applied with `wrangler d1 migrations apply`
// (see README), never `drizzle-kit migrate`.
export default defineConfig({
    schema: './src/db/schema.ts',
    out: './migrations',
    dialect: 'sqlite',
})
