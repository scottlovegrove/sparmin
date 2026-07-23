import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { type DropItem, expandDrop } from './expand-drop'

const fixture = fileURLToPath(
    new URL('../../test/fixtures/23520138132_ACTIVITY.fit', import.meta.url),
)
const fitBytes = new Uint8Array(readFileSync(fixture))

function zipFile(name: string, entries: Record<string, Uint8Array>): File {
    return new File([zipSync(entries)], name)
}

function isImportable(item: DropItem): item is Extract<DropItem, { file: File }> {
    return 'file' in item
}

async function bytesOf(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer())
}

describe('expandDrop', () => {
    it('passes a plain .fit straight through', async () => {
        const file = new File([fitBytes], 'spa.fit')

        const [item, ...rest] = await expandDrop([file])

        expect(rest).toHaveLength(0)
        expect(isImportable(item)).toBe(true)
        if (isImportable(item)) {
            expect(item.file).toBe(file)
            expect(item.name).toBe('spa.fit')
        }
    })

    it('lifts a single .fit out of a zip', async () => {
        const zip = zipFile('garmin.zip', { 'activity.fit': fitBytes })

        const [item, ...rest] = await expandDrop([zip])

        expect(rest).toHaveLength(0)
        expect(isImportable(item)).toBe(true)
        if (isImportable(item)) {
            expect(item.name).toBe('garmin.zip → activity.fit')
            expect(item.file.name).toBe('activity.fit')
            expect(await bytesOf(item.file)).toEqual(fitBytes)
        }
    })

    it('yields one unit per .fit in a multi-file zip', async () => {
        const zip = zipFile('two.zip', { 'a.fit': fitBytes, 'b.fit': fitBytes })

        const items = await expandDrop([zip])

        expect(items.map((item) => item.name)).toEqual(['two.zip → a.fit', 'two.zip → b.fit'])
        expect(items.every(isImportable)).toBe(true)
    })

    it('ignores directory and __MACOSX junk entries', async () => {
        const zip = zipFile('messy.zip', {
            'activity.fit': fitBytes,
            '__MACOSX/._activity.fit': new Uint8Array([0]),
            '._activity.fit': new Uint8Array([0]),
        })

        const items = await expandDrop([zip])

        expect(items).toHaveLength(1)
        expect(items[0].name).toBe('messy.zip → activity.fit')
    })

    it('rejects a zip with no .fit inside', async () => {
        const zip = zipFile('empty.zip', { 'readme.txt': new Uint8Array([1, 2, 3]) })

        const [item] = await expandDrop([zip])

        expect(item).toEqual({
            name: 'empty.zip',
            outcome: { status: 'rejected', reason: 'No .fit file in the zip' },
        })
    })

    it('rejects bytes that are not a real zip', async () => {
        const notZip = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.zip')

        const [item] = await expandDrop([notZip])

        expect(item).toEqual({
            name: 'broken.zip',
            outcome: { status: 'rejected', reason: "Couldn't open the zip" },
        })
    })

    it('rejects a file that is neither .fit nor .zip', async () => {
        const photo = new File([new Uint8Array([1, 2, 3])], 'holiday.jpg')

        const [item] = await expandDrop([photo])

        expect(item).toEqual({
            name: 'holiday.jpg',
            outcome: { status: 'rejected', reason: 'Not a .fit or .zip export' },
        })
    })
})
