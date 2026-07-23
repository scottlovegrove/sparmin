import type { ImportOutcome } from './import-fit'

// Garmin Connect's "Export Original" hands over a zip, so the drop can be a
// container as well as a bare .fit. A zip is small on the wire but inflates, so
// cap the archive before reading it in — the same reasoning as import-fit's
// MAX_BYTES, one size up because a zip can legitimately hold several files.
const MAX_ZIP_BYTES = 25 * 1024 * 1024

// fflate is only needed when a zip actually turns up, so load it on demand
// rather than paying for it on every drop (or in the main bundle).
const loadUnzip = () => import('fflate')

type Rejected = Extract<ImportOutcome, { status: 'rejected' }>

//! One dropped file, expanded: either a FIT ready to import (its own file, or one
//! lifted out of a zip) or a reason we can't. A single zip can yield several.
export type DropItem = { name: string; file: File } | { name: string; outcome: Rejected }

function hasExtension(name: string, ext: string): boolean {
    return name.toLowerCase().endsWith(ext)
}

function baseName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1)
}

// Zips carry directory entries and, from macOS, an __MACOSX/ tree of AppleDouble
// "._name" resource forks — neither is a real FIT, so drop both.
function isJunkEntry(path: string): boolean {
    return path.endsWith('/') || path.startsWith('__MACOSX/') || baseName(path).startsWith('._')
}

async function expandZip(file: File): Promise<DropItem[]> {
    if (file.size > MAX_ZIP_BYTES) {
        return [{ name: file.name, outcome: { status: 'rejected', reason: 'Zip is too big' } }]
    }

    let entries: Record<string, Uint8Array>
    try {
        const { unzipSync } = await loadUnzip()
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    } catch {
        return [
            { name: file.name, outcome: { status: 'rejected', reason: "Couldn't open the zip" } },
        ]
    }

    const fits = Object.entries(entries).filter(
        ([path]) => !isJunkEntry(path) && hasExtension(path, '.fit'),
    )
    if (fits.length === 0) {
        return [
            { name: file.name, outcome: { status: 'rejected', reason: 'No .fit file in the zip' } },
        ]
    }

    return fits.map(([path, bytes]) => {
        const entry = baseName(path)
        // Copy into a fresh Uint8Array: fflate types entries as ArrayBufferLike
        // (possibly shared), which isn't a valid BlobPart for File.
        return { name: `${file.name} → ${entry}`, file: new File([new Uint8Array(bytes)], entry) }
    })
}

//! Turn the raw dropped files into importable units. A .fit passes straight
//! through; a .zip is unpacked here and each .fit inside becomes its own unit;
//! anything else is rejected with a reason. Extraction happens entirely in the
//! browser — the bytes go no further than parseFit.
export async function expandDrop(files: File[]): Promise<DropItem[]> {
    const expanded: DropItem[] = []
    for (const file of files) {
        if (hasExtension(file.name, '.fit')) {
            expanded.push({ name: file.name, file })
        } else if (hasExtension(file.name, '.zip')) {
            expanded.push(...(await expandZip(file)))
        } else {
            expanded.push({
                name: file.name,
                outcome: { status: 'rejected', reason: 'Not a .fit or .zip export' },
            })
        }
    }
    return expanded
}
