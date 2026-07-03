import Toybox.Lang;
import Toybox.Application;

//! User-configurable display order + visibility for the station strip, stored as
//! an ordered array of visible stationIds (order = display order, absence =
//! hidden). Pure display layer: it never affects recorded data — a hidden
//! station simply can't be selected, and its canonical id is untouched.
//!
//! The mutation helpers are pure (list in → new list out) so they can be unit
//! tested without Storage; load/save wrap them onto Application.Storage.
module StationConfig {

    const STORAGE_KEY = "stationConfig";

    //! Ordered visible ids. Falls back to the full catalogue on first run or if
    //! the stored value is missing/corrupt. Stale or duplicate ids are filtered
    //! out so a bad store can never inject a non-canonical id.
    function load() as Lang.Array {
        var stored = Application.Storage.getValue(STORAGE_KEY);
        if (!(stored instanceof Array)) {
            return Station.allIds();
        }
        var arr = stored as Lang.Array;
        var out = [];
        for (var i = 0; i < arr.size(); i += 1) {
            var id = arr[i];
            if (Station.isValidId(id) && out.indexOf(id) < 0) {
                out.add(id);
            }
        }
        return out.size() > 0 ? out : Station.allIds();
    }

    function save(visibleIds) {
        Application.Storage.setValue(STORAGE_KEY, visibleIds);
    }

    //! Toggle a station's visibility. Hiding is blocked when it would empty the
    //! strip (at least one station must remain). Showing appends at the end.
    //! Returns the new list (unchanged if the hide was blocked).
    function toggle(visibleIds as Lang.Array, id) as Lang.Array {
        var idx = visibleIds.indexOf(id);
        if (idx >= 0) {
            if (visibleIds.size() <= 1) {
                return visibleIds; // can't hide the last visible station
            }
            var out = [];
            for (var i = 0; i < visibleIds.size(); i += 1) {
                if (i != idx) {
                    out.add(visibleIds[i]);
                }
            }
            return out;
        }
        if (!Station.isValidId(id)) {
            return visibleIds;
        }
        var shown = [];
        for (var i = 0; i < visibleIds.size(); i += 1) {
            shown.add(visibleIds[i]);
        }
        shown.add(id);
        return shown;
    }

    //! Move the item at index `from` to index `to`, shifting the rest. Returns a
    //! new list (unchanged if either index is out of range).
    function move(visibleIds as Lang.Array, from, to) as Lang.Array {
        var n = visibleIds.size();
        if (from < 0 || from >= n || to < 0 || to >= n || from == to) {
            return visibleIds;
        }
        var item = visibleIds[from];
        var without = [];
        for (var i = 0; i < n; i += 1) {
            if (i != from) {
                without.add(visibleIds[i]);
            }
        }
        var out = [];
        for (var i = 0; i < without.size(); i += 1) {
            if (i == to) {
                out.add(item);
            }
            out.add(without[i]);
        }
        if (to >= without.size()) {
            out.add(item);
        }
        return out;
    }
}
