import { Decoder, Stream } from '@garmin/fitsdk'
import { type ParsedLap, type ParsedSession, parsedSessionSchema } from '../session-payload'

// Seconds between the unix epoch (1970-01-01) and the FIT epoch (1989-12-31).
const FIT_EPOCH_OFFSET = 631065600

// The watch writes the station label as developer field number 0 on each lap
// (Recorder.FIELD_ID). Older builds didn't emit the field_description, so the
// SDK's name-based decode drops it — read it by number instead. See
// docs/spa-logger-spec.md §4.2.
const STATION_DEV_FIELD_NUM = 0
const LAP_GLOBAL_MESG_NUM = 19
const MESSAGE_INDEX_FIELD_NUM = 254

export class FitParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FitParseError'
    }
}

// FIT DateTime fields decode to a number when convertDateTimesToDates is off (the
// SDK type also allows Date and 'min'/'max' sentinels). Convert raw FIT seconds to
// unix seconds; returns null for anything that isn't a plain number.
function fitToUnix(value: unknown): number | null {
    return typeof value === 'number' ? value + FIT_EPOCH_OFFSET : null
}

//! Parse one exported spa-session FIT file into the ingest payload (minus the
//! client id). Pure and deterministic. Throws FitParseError on anything that
//! isn't a spa session.
export function parseFit(input: ArrayBuffer | Uint8Array): ParsedSession {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    const decoder = new Decoder(Stream.fromByteArray(bytes))
    if (!decoder.isFIT()) {
        throw new FitParseError('Not a FIT file')
    }

    const { messages } = decoder.read({ convertDateTimesToDates: false })

    const fileId = messages.fileIdMesgs?.[0]
    if (fileId == null) {
        throw new FitParseError('FIT file has no file_id message')
    }
    if (fileId.type !== 'activity') {
        throw new FitParseError(`Not an activity file (file_id.type = ${String(fileId.type)})`)
    }

    const session = messages.sessionMesgs?.[0]
    if (session == null) {
        throw new FitParseError('FIT file has no session message')
    }

    const stations = extractLapStations(bytes)
    if (stations.size === 0) {
        throw new FitParseError('No station labels found — this does not look like a spa session')
    }

    const startedAt = fitToUnix(session.startTime)
    if (startedAt == null) {
        throw new FitParseError('session message has no start_time')
    }
    const totalElapsedS = session.totalElapsedTime ?? 0

    const activity = messages.activityMesgs?.[0]
    const utcOffsetS =
        typeof activity?.localTimestamp === 'number' && typeof activity.timestamp === 'number'
            ? activity.localTimestamp - activity.timestamp
            : null

    const laps: ParsedLap[] = []
    for (const lap of messages.lapMesgs ?? []) {
        const lapIndex = typeof lap.messageIndex === 'number' ? lap.messageIndex : null
        const lapStart = fitToUnix(lap.startTime)
        if (lapIndex == null || lapStart == null) {
            continue
        }
        const station = stations.get(lapIndex)
        if (station == null) {
            continue
        }
        laps.push({
            lapIndex,
            station,
            startedAt: lapStart,
            elapsedS: lap.totalElapsedTime ?? 0,
            timerS: lap.totalTimerTime ?? null,
            avgHr: lap.avgHeartRate ?? null,
            maxHr: lap.maxHeartRate ?? null,
            calories: lap.totalCalories ?? null,
            cycles: lap.totalCycles ?? null,
        })
    }

    const product =
        typeof fileId.garminProduct === 'string'
            ? fileId.garminProduct
            : fileId.product != null
              ? String(fileId.product)
              : null

    const parsed = {
        device: {
            serial: String(fileId.serialNumber ?? ''),
            product,
        },
        session: {
            startedAt,
            endedAt: Math.round(startedAt + totalElapsedS),
            utcOffsetS,
            totalElapsedS,
            totalTimerS: session.totalTimerTime ?? null,
            totalCalories: session.totalCalories ?? null,
            avgHr: session.avgHeartRate ?? null,
            maxHr: session.maxHeartRate ?? null,
        },
        laps,
    }
    return parsedSessionSchema.parse(parsed)
}

type FieldDef = { num: number; size: number }
type DevFieldDef = { num: number; size: number; devDataIndex: number }
type LocalMessageDef = {
    globalNum: number
    littleEndian: boolean
    fields: FieldDef[]
    devFields: DevFieldDef[]
}

//! Walk the raw FIT records and pull each lap's station label from developer
//! field (developerDataIndex 0, fieldDefNum 0), keyed by lap message_index. This
//! recovers the label even on files whose field_description was never written.
function extractLapStations(bytes: Uint8Array): Map<number, string> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const textDecoder = new TextDecoder()
    const stations = new Map<number, string>()
    const defs = new Map<number, LocalMessageDef>()

    const headerSize = bytes[0]
    const dataEnd = bytes.length - 2 // trailing 2-byte file CRC
    let pos = headerSize

    while (pos < dataEnd) {
        const recordHeader = bytes[pos]
        if ((recordHeader & 0x80) !== 0) {
            // Compressed-timestamp header: only used by record (HR) messages, and
            // not seen in this app's files. Bail rather than mis-parse.
            throw new FitParseError('Unsupported compressed-timestamp record header')
        }
        const localType = recordHeader & 0x0f
        const isDefinition = (recordHeader & 0x40) !== 0
        const hasDevData = (recordHeader & 0x20) !== 0

        if (isDefinition) {
            let p = pos + 2 // skip record header + reserved byte
            const littleEndian = bytes[p] === 0
            p += 1
            const globalNum = view.getUint16(p, littleEndian)
            p += 2
            const fieldCount = bytes[p]
            p += 1
            const fields: FieldDef[] = []
            for (let i = 0; i < fieldCount; i += 1) {
                fields.push({ num: bytes[p], size: bytes[p + 1] })
                p += 3
            }
            const devFields: DevFieldDef[] = []
            if (hasDevData) {
                const devCount = bytes[p]
                p += 1
                for (let i = 0; i < devCount; i += 1) {
                    devFields.push({
                        num: bytes[p],
                        size: bytes[p + 1],
                        devDataIndex: bytes[p + 2],
                    })
                    p += 3
                }
            }
            defs.set(localType, { globalNum, littleEndian, fields, devFields })
            pos = p
        } else {
            const def = defs.get(localType)
            if (def == null) {
                throw new FitParseError(`Data record for undefined local message type ${localType}`)
            }
            let p = pos + 1
            let messageIndex: number | null = null
            for (const field of def.fields) {
                if (
                    def.globalNum === LAP_GLOBAL_MESG_NUM &&
                    field.num === MESSAGE_INDEX_FIELD_NUM &&
                    field.size >= 2
                ) {
                    messageIndex = view.getUint16(p, def.littleEndian) & 0x0fff
                }
                p += field.size
            }
            for (const devField of def.devFields) {
                if (
                    def.globalNum === LAP_GLOBAL_MESG_NUM &&
                    devField.num === STATION_DEV_FIELD_NUM &&
                    devField.devDataIndex === 0 &&
                    messageIndex != null
                ) {
                    const raw = bytes.subarray(p, p + devField.size)
                    const nul = raw.indexOf(0)
                    const label = textDecoder.decode(nul === -1 ? raw : raw.subarray(0, nul)).trim()
                    if (label.length > 0) {
                        stations.set(messageIndex, label)
                    }
                }
                p += devField.size
            }
            pos = p
        }
    }
    return stations
}
