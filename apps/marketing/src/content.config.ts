import { glob } from 'astro/loaders'
import { defineCollection } from 'astro:content'
import { z } from 'zod'

// One Markdown file per release, named after its version. Releases are ordered
// by version, so `date` is optional — supply it and the page shows it.
const changelog = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/changelog' }),
    schema: z.object({
        version: z.string(),
        date: z.date().optional(),
        summary: z.string(),
    }),
})

export const collections = { changelog }
