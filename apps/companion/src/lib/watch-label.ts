import { GARMIN_PRODUCTS } from './garmin-products'

export type NamedWatch = {
    readonly name?: string | null
    readonly product?: string | null
}

// A name the user typed wins over anything derived: they renamed it because the
// default did not tell them what they wanted to know.
//
// Failing that, the part number is translated — Connect IQ gives an app only
// "006-B4426-00", which identifies the hardware exactly and means nothing to the
// person reading it. An unknown part number is shown as it came rather than
// hidden: a device too new for the shipped map is still recognisable to someone
// who can look it up, and a blank row is not.
export function watchLabel(watch: NamedWatch): string {
    const named = watch.name?.trim()
    if (named != null && named !== '') {
        return named
    }
    const product = watch.product?.trim()
    if (product == null || product === '') {
        return 'A Garmin watch'
    }
    return GARMIN_PRODUCTS[product] ?? product
}

// What the row shows underneath, when a renamed watch would otherwise lose the
// only clue to which physical device it is.
export function watchSubtitle(watch: NamedWatch): string | null {
    const named = watch.name?.trim()
    if (named == null || named === '') {
        return null
    }
    const product = watch.product?.trim()
    if (product == null || product === '') {
        return null
    }
    return GARMIN_PRODUCTS[product] ?? product
}
