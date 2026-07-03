import Toybox.Lang;

//! Canonical, immutable station catalogue. The ids are permanent — they are
//! written into FIT lap developer fields and the backend payload, so they must
//! never change, remap, or drop. Display order and visibility are configurable
//! (see StationConfig); this catalogue is not.
module Station {

    // Index-aligned id/name arrays. The declaration order is the default
    // display order.
    const IDS = [
        "outdoor_cold_plunge",
        "indoor_cold_plunge",
        "hydro_pool",
        "heated_loungers",
        "salt_sauna",
        "steam_room",
        "fire_ice_room",
        "finnish_sauna",
        "ice_cave",
        "outdoor_lounger"
    ];

    const NAMES = [
        "Outdoor cold plunge",
        "Indoor cold plunge",
        "Hydro pool",
        "Heated loungers",
        "Himalayan salt sauna",
        "Steam room",
        "Fire and ice room",
        "Finnish sauna",
        "Ice cave",
        "Outdoor lounger"
    ];

    function count() {
        return IDS.size();
    }

    //! Index of an id in the catalogue, or -1 if it is not a canonical id.
    function indexOf(id) {
        for (var i = 0; i < IDS.size(); i += 1) {
            if (IDS[i].equals(id)) {
                return i;
            }
        }
        return -1;
    }

    function isValidId(id) {
        return indexOf(id) >= 0;
    }

    //! Display name for an id; falls back to the id itself if unknown.
    function nameFor(id) {
        var i = indexOf(id);
        return i >= 0 ? NAMES[i] : id;
    }

    //! Longest display name + null terminator — used to size the FIT string
    //! field's element count.
    function maxNameLength() {
        var max = 0;
        for (var i = 0; i < NAMES.size(); i += 1) {
            var len = NAMES[i].length();
            if (len > max) {
                max = len;
            }
        }
        return max + 1;
    }

    //! A fresh copy of the full ordered id list (the default configuration).
    function allIds() {
        var out = [];
        for (var i = 0; i < IDS.size(); i += 1) {
            out.add(IDS[i]);
        }
        return out;
    }
}
