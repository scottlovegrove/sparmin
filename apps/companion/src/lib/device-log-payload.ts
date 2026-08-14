import { z } from 'zod'

// What a linked watch posts from its on-device diagnostic log. Mirrors
// LogClient.upload() in apps/watch, and speaks ISO-8601 for the same reason the
// session payload does — the watch formats UTC to the second, and a stamp that
// reads correctly in a database client is worth more here than four bytes saved.

// The watch's ring buffer is smaller than this and it only ever sends what it has
// not already delivered, so a full upload is a handful of lines. The cap is here
// to bound the row it turns into, not to shape the normal case.
export const MAX_LINES_PER_UPLOAD = 200

// Long enough for any line the watch can produce (it clips its own at 96
// characters), with room for that limit to move without this becoming the thing
// that truncates.
export const MAX_LINE_LENGTH = 200

export const deviceLogLineSchema = z.object({
    at: z.iso.datetime(),
    text: z.string().min(1).max(MAX_LINE_LENGTH),
})

export const deviceLogPayloadSchema = z.object({
    appVersion: z.string().min(1).max(32).nullish().default(null),
    lines: z.array(deviceLogLineSchema).min(1).max(MAX_LINES_PER_UPLOAD),
})

export type DeviceLogLine = z.infer<typeof deviceLogLineSchema>
export type DeviceLogPayload = z.infer<typeof deviceLogPayloadSchema>
