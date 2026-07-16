import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react'
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
        const list = [...(files ?? [])].filter((file) => file.name.toLowerCase().endsWith('.fit'))
        if (list.length === 0) {
            return
        }
        const mine = ++batch.current
        setRows(list.map((file) => ({ name: file.name, status: 'working' })))

        // Sequential on purpose: D1 is single-threaded, and a handful of files
        // finishing in order reads better than a race.
        let anyImported = false
        for (const [index, file] of list.entries()) {
            let outcome: ImportOutcome
            try {
                outcome = await importFit(file)
            } catch {
                outcome = { status: 'rejected', reason: "That file couldn't be read" }
            }
            if (batch.current !== mine) {
                return
            }
            anyImported ||= outcome.status === 'imported'
            setRows((current) =>
                current.map((row, i) => (i === index ? { name: file.name, ...outcome } : row)),
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
                <strong>Drop your .fit exports here</strong>
                <span className="muted small">or click to choose — several at once is fine</span>
            </button>
            <input
                ref={fileInput}
                type="file"
                accept=".fit"
                multiple
                hidden
                onChange={handleChange}
            />

            {rows.length > 0 && (
                <ul className="results">
                    {rows.map((row) => (
                        <li key={row.name} className={row.status}>
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
                Export an activity from Garmin Connect as a <code>.fit</code> file. It’s read here
                in your browser — only the session details are sent.
            </p>
        </section>
    )
}
