import Toybox.Lang;

//! What the virtual slot past the last station means, if it exists at all.
enum {
    TRAILING_NONE,
    TRAILING_END,
    TRAILING_SETTINGS
}

//! Pure strip navigation: the focus cursor and the visible window over the
//! configured activity list. No drawing, no device APIs — the edge-sliding rule
//! (§4) is unit-testable here.
//!
//! Past the last station the cursor can reach one virtual trailing slot, whose
//! meaning is `trailingSlot`. It carries no activityId; the view draws it and
//! the delegate interprets it. Touch devices put End/Exit there (the wet
//! fallback: cycle with one button, commit with the other — End mid-session,
//! Exit at idle, which is how you leave the app once the cursor has claimed the
//! Back button). Button devices put Settings there instead, because they have
//! no other on-screen way into it.
class StripController {
    public var visibleIds as Lang.Array;  // configured, ordered visible activityIds
    public var focusedIndex as Lang.Number;
    public var windowStart as Lang.Number;
    public var visibleCount as Lang.Number;
    public var trailingSlot as Lang.Number;   // TRAILING_NONE / _END / _SETTINGS

    function initialize(visibleIds as Lang.Array, visibleCount as Lang.Number, trailingSlot as Lang.Number) {
        me.visibleIds = visibleIds;
        me.visibleCount = (visibleCount < visibleIds.size()) ? visibleCount : visibleIds.size();
        me.focusedIndex = 0;
        me.windowStart = 0;
        me.trailingSlot = trailingSlot;
    }

    //! Number of stations (the trailing slot is not one).
    function count() as Lang.Number {
        return visibleIds.size();
    }

    //! Total selectable slots, including the trailing tile when there is one.
    function slotCount() as Lang.Number {
        return visibleIds.size() + (trailingSlot == TRAILING_NONE ? 0 : 1);
    }

    //! True when the cursor sits on the trailing tile.
    function isOnTrailingSlot() as Lang.Boolean {
        return trailingSlot != TRAILING_NONE && focusedIndex == visibleIds.size();
    }

    //! True when absolute slot index `i` is the trailing tile.
    function isTrailingIndex(i as Lang.Number) as Lang.Boolean {
        return trailingSlot != TRAILING_NONE && i == visibleIds.size();
    }

    //! Change what the trailing slot means (it comes and goes with the session
    //! state on button devices), keeping the cursor and window in range.
    function setTrailingSlot(kind as Lang.Number) as Void {
        if (kind == trailingSlot) {
            return;
        }
        trailingSlot = kind;
        var maxFocus = slotCount() - 1;
        if (focusedIndex > maxFocus) {
            focusedIndex = (maxFocus < 0) ? 0 : maxFocus;
        }
        windowStart = _clampStart(windowStart);
        _reveal();
    }

    function focusedId() {
        if (visibleIds.size() == 0 || isOnTrailingSlot()) {
            return null;
        }
        return visibleIds[focusedIndex];
    }

    //! Move the focus cursor by delta, wrapping over all slots (stations + the
    //! trailing tile), sliding the window to keep the cursor visible.
    function moveFocus(delta as Lang.Number) as Void {
        var n = slotCount();
        if (n == 0) {
            return;
        }
        focusedIndex = (focusedIndex + delta) % n;
        if (focusedIndex < 0) {
            focusedIndex += n;
        }
        _reveal();
    }

    //! Point the cursor at a specific station id (keeps the button cursor in sync
    //! when a tile is tapped). No-op if the id isn't visible.
    function focusId(id) as Void {
        var idx = visibleIds.indexOf(id);
        if (idx >= 0) {
            focusedIndex = idx;
            _reveal();
        }
    }

    //! Pan the window (touch devices) without moving a focus cursor.
    function panWindow(delta as Lang.Number) as Void {
        windowStart = _clampStart(windowStart + delta);
    }

    //! activityId shown in window slot k (0 .. visibleCount-1), or null.
    function idAtSlot(k as Lang.Number) {
        var idx = windowStart + k;
        return (idx >= 0 && idx < count()) ? visibleIds[idx] : null;
    }

    //! activityId at an absolute index in the visible list, or null (also null for
    //! the trailing tile, which has no id — test it with isTrailingIndex).
    function idAtIndex(i as Lang.Number) {
        return (i >= 0 && i < visibleIds.size()) ? visibleIds[i] : null;
    }

    //! Re-apply a (possibly reordered/hidden) config, keeping focus in range.
    function reload(newVisibleIds as Lang.Array) as Void {
        visibleIds = newVisibleIds;
        if (visibleCount > newVisibleIds.size()) {
            visibleCount = newVisibleIds.size();
        }
        var maxFocus = slotCount() - 1;
        if (focusedIndex > maxFocus) {
            focusedIndex = maxFocus;
        }
        if (focusedIndex < 0) {
            focusedIndex = 0;
        }
        windowStart = _clampStart(windowStart);
        _reveal();
    }

    // Slide the window so focusedIndex sits inside it (§4 rule).
    private function _reveal() as Void {
        if (focusedIndex < windowStart) {
            windowStart = focusedIndex;
        } else if (focusedIndex > windowStart + visibleCount - 1) {
            windowStart = focusedIndex - visibleCount + 1;
        }
        windowStart = _clampStart(windowStart);
    }

    private function _clampStart(start as Lang.Number) as Lang.Number {
        var maxStart = slotCount() - visibleCount;
        if (maxStart < 0) {
            maxStart = 0;
        }
        if (start > maxStart) {
            start = maxStart;
        }
        if (start < 0) {
            start = 0;
        }
        return start;
    }
}
