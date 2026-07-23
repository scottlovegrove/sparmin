import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react'
import { expandDrop } from '../lib/expand-drop'
import { type ImportOutcome, importFit, preloadParser } from '../lib/import-fit'

type Row = { name: string } & ({ status: 'working' } | ImportOutcome)

const LABELS: Record<Row['status'], string> = {
    working: 'Importing…',
    imported: 'Imported',
    duplicate: 'Already imported',
    rejected: 'Not imported',
}

export function ImportPanel({ onImported }: { onImported: () => void }) {
    const [rows, setRows] = useState<Row[]>([])
    const [isOver, setIsOver] = useState(false)
    const fileInput = useRef<HTMLInputElement>(null)
    // Identifies the batch on screen. A second drop replaces the rows, so an
    // earlier run still in flight must not write its results over them.
    const batch = useRef(0)

    // Fetch the parser as soon as there's somewhere to drop a file, so the first
    // import doesn't stall on the download.
    useEffect(preloadParser, [])

    async function handleFiles(files: FileList | null) {
        const list = [...(files ?? [])]
        if (list.length === 0) {
            return
        }
        const mine = ++batch.current

        // A zip expands into a .fit per entry, so what the user dropped and what
        // gets imported aren't one-to-one. Unpack first, then work the results.
        const items = await expandDrop(list)
        // A newer drop landed while this one was unzipping; its rows own the
        // screen now, so don't overwrite them.
        if (batch.current !== mine) {
            return
        }

        // Everything gets a row, including files this can't read — dropping a
        // photo and watching nothing happen is worse than being told why.
        setRows(
            items.map((item) =>
                'file' in item
                    ? { name: item.name, status: 'working' }
                    : { name: item.name, ...item.outcome },
            ),
        )

        // Sequential on purpose: D1 is single-threaded, and a handful of files
        // finishing in order reads better than a race.
        let anyImported = false
        for (const [index, item] of items.entries()) {
            if (!('file' in item)) {
                continue
            }
            let outcome: ImportOutcome
            try {
                outcome = await importFit(item.file)
            } catch {
                outcome = { status: 'rejected', reason: "That file couldn't be read" }
            }
            // A newer batch has replaced these rows; its results are the ones on
            // screen, so stop rather than write over them.
            if (batch.current !== mine) {
                return
            }
            anyImported ||= outcome.status === 'imported'
            setRows((current) =>
                current.map((row, i) => (i === index ? { name: item.name, ...outcome } : row)),
            )
        }
        if (anyImported) {
            onImported()
        }
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault()
        setIsOver(false)
        void handleFiles(event.dataTransfer.files)
    }

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
        void handleFiles(event.target.files)
        // Let the same file be picked again after a failure.
        event.target.value = ''
    }

    return (
        <section className="card">
            <h2>Import a session</h2>
            <button
                type="button"
                className={`dropzone ${isOver ? 'is-over' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                    event.preventDefault()
                    setIsOver(true)
                }}
                onDragLeave={() => setIsOver(false)}
                onDrop={handleDrop}
            >
                <strong>Drop your .fit or .zip exports here</strong>
                <span className="muted small">or click to choose — several at once is fine</span>
            </button>
            <input
                ref={fileInput}
                type="file"
                accept=".fit,.zip"
                multiple
                hidden
                onChange={handleChange}
            />

            {rows.length > 0 && (
                <ul className="results">
                    {rows.map((row, index) => (
                        <li key={index} className={row.status}>
                            <span className="file">{row.name}</span>
                            <span className="outcome">
                                {LABELS[row.status]}
                                {row.status === 'rejected' && (
                                    <span className="muted small"> — {row.reason}</span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            <p className="muted small">
                Export an activity from Garmin Connect — a <code>.fit</code> file, or the{' '}
                <code>.zip</code> it downloads as. It’s read here in your browser — only the session
                details are sent.
            </p>
        </section>
    )
}
