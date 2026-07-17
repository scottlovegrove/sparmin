export type ThermalClass = 'hot' | 'cold' | 'neutral' | 'unclassified'

export type Stay = {
    order: number
    station: string
    thermalClass: ThermalClass
    isTransition: boolean
    startedAt: number
    endedAt: number
    elapsedS: number
    timerS: number | null
    avgHr: number | null
    maxHr: number | null
    calories: number | null
    cycles: number | null
}

export type SessionSummary = {
    hotS: number
    coldS: number
    neutralS: number
    transitionS: number
    contrastCycles: number
}

//! Time by thermal class, plus how many times the visit actually went from heat
//! into cold — which is the thing contrast bathing is for, and not something
//! total time can show. Transitions are the walk between stations: real time, but
//! not exposure, so they are counted apart rather than folded into either side.
export function summarise(stays: readonly Stay[]): SessionSummary {
    const summary: SessionSummary = {
        hotS: 0,
        coldS: 0,
        neutralS: 0,
        transitionS: 0,
        contrastCycles: 0,
    }

    for (const stay of stays) {
        if (stay.isTransition) {
            summary.transitionS += stay.elapsedS
            continue
        }
        if (stay.thermalClass === 'hot') summary.hotS += stay.elapsedS
        else if (stay.thermalClass === 'cold') summary.coldS += stay.elapsedS
        else if (stay.thermalClass === 'neutral') summary.neutralS += stay.elapsedS
    }

    // A cycle is heat then cold, in that order. Walking between them doesn't break
    // it — that's how the circuit works — so transitions are ignored rather than
    // treated as an interruption. Cold without heat before it isn't a cycle, and
    // sauna-sauna-plunge is one cycle, not two: it's the crossing that counts.
    let inHeat = false
    for (const stay of stays) {
        if (stay.isTransition) {
            continue
        }
        if (stay.thermalClass === 'hot') {
            inHeat = true
        } else if (stay.thermalClass === 'cold' && inHeat) {
            summary.contrastCycles += 1
            inHeat = false
        }
    }

    return summary
}

//! mm:ss — a stay is minutes long and the seconds are real, so 5:01 in the plunge
//! shouldn't round away to "5m" like a whole session can.
export function formatStay(seconds: number) {
    const total = Math.round(seconds)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
