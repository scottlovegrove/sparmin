import { z } from 'zod'

// The parsed shape of one spa session, shared by the client FIT parser and the
// server ingest endpoint. Times are unix seconds UTC. See
// docs/spa-logger-spec.md §5.1. The client `id` (idempotency uuid) is added by
// the upload layer, not the parser — this is the deterministic parsed body.

export const parsedLapSchema = z.object({
    lapIndex: z.number().int().nonnegative(),
    station: z.string().min(1),
    startedAt: z.number().int(),
    elapsedS: z.number().nonnegative(),
    timerS: z.number().nonnegative().nullable(),
    avgHr: z.number().int().nullable(),
    maxHr: z.number().int().nullable(),
    calories: z.number().int().nullable(),
    cycles: z.number().int().nullable(),
})

export const parsedSessionSchema = z.object({
    device: z.object({
        serial: z.string().min(1),
        product: z.string().nullable(),
    }),
    session: z.object({
        startedAt: z.number().int(),
        endedAt: z.number().int(),
        utcOffsetS: z.number().int().nullable(),
        totalElapsedS: z.number().nonnegative(),
        totalTimerS: z.number().nonnegative().nullable(),
        totalCalories: z.number().int().nullable(),
        avgHr: z.number().int().nullable(),
        maxHr: z.number().int().nullable(),
    }),
    laps: z.array(parsedLapSchema).min(1),
})

// What POST /api/sessions accepts: the parsed session plus the client-minted
// idempotency uuid. The client is untrusted in principle; in practice the blast
// radius is a user's own data.
export const ingestPayloadSchema = parsedSessionSchema.extend({
    id: z.uuid(),
})

// What PUT /api/sessions/:id/intervals accepts: the session's laps regrouped in
// the editor. Each group is one lap in the result — its `laps` are the original
// lap orders (lap_index) folded into it, in order, and `station` is the label to
// give it. The client never sends timing or HR: the server rebuilds those from
// the stored rows, so the recording's own (imperfect, sometimes overlapping)
// boundaries are preserved rather than re-derived and rejected. The groups must
// cover every original lap exactly once, in order — that's the whole invariant.
export const lapGroupSchema = z.object({
    station: z.string().min(1),
    laps: z.array(z.number().int().nonnegative()).min(1),
})

export const replaceLapsSchema = z.object({
    groups: z.array(lapGroupSchema).min(1),
})

export type ParsedLap = z.infer<typeof parsedLapSchema>
export type ParsedSession = z.infer<typeof parsedSessionSchema>
export type IngestPayload = z.infer<typeof ingestPayloadSchema>
export type LapGroup = z.infer<typeof lapGroupSchema>
export type ReplaceLaps = z.infer<typeof replaceLapsSchema>
