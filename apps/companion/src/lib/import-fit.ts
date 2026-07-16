export type ImportOutcome =
    | { status: 'imported' }
    | { status: 'duplicate' }
    | { status: 'rejected'; reason: string }

// A real spa export is tens of kilobytes; the longest imaginable activity is a
// few megabytes. Anything past this is a renamed file or a mistake, and reading
// it in would take the tab down before anything got to reject it.
const MAX_BYTES = 10 * 1024 * 1024

// The FIT SDK is most of this app's JavaScript, and nobody needs it to read the
// sign-in screen or their session list — so it loads on the first import rather
// than on first paint.
const loadParser = () => import('./fit/parse-fit')

//! Warm the parser chunk in the background. Called once the import panel is on
//! screen, so the first drop doesn't wait on a download.
export function preloadParser() {
    void loadParser()
}

//! Parse one exported FIT and post the result. The file itself never leaves the
//! browser — only the parsed session does (spec §1).
export async function importFit(file: File): Promise<ImportOutcome> {
    // Checked before the file is read, not after: the point is to not read it.
    if (file.size > MAX_BYTES) {
        return { status: 'rejected', reason: 'Too big to be a spa session' }
    }

    const { parseFit, FitParseError } = await loadParser()

    let payload
    try {
        payload = { id: crypto.randomUUID(), ...parseFit(await file.arrayBuffer()) }
    } catch (err) {
        // A file that isn't a spa session is the user picking the wrong export,
        // not a failure of the app — say which, plainly.
        if (err instanceof FitParseError) {
            return { status: 'rejected', reason: err.message }
        }
        throw err
    }

    const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (res.status === 201) {
        return { status: 'imported' }
    }
    // Already imported: the same visit exported twice. Not an error — say so.
    if (res.status === 409) {
        return { status: 'duplicate' }
    }
    if (res.status === 401) {
        return { status: 'rejected', reason: 'Your session expired — sign in again' }
    }
    return { status: 'rejected', reason: `The server rejected it (${res.status})` }
}
