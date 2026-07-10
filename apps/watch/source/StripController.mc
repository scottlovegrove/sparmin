import Toybox.Lang;

//! Pure strip navigation: the focus cursor and the visible window over the
//! configured activity list. No drawing, no device APIs — the edge-sliding rule
//! (§4) is unit-testable here.
//!
//! When `endSlot` is set (the touch wet-fallback: cycle with one button, commit
//! with the other), the cursor also reaches one virtual trailing slot past the
//! last station — the "End / Exit" target. It carries no activityId; the view
//! draws it and the delegate interprets it by session state (End mid-session,
//! Exit at idle).
class StripController {
    public var visibleIds as Lang.Array;  // configured, ordered visible activityIds
    public var focusedIndex as Lang.Number;
    public var windowStart as Lang.Number;
    public var visibleCount as Lang.Number;
    public var endSlot as Lang.Boolean;   // trailing End/Exit target enabled?

    function initialize(visibleIds as Lang.Array, visibleCount as Lang.Number, endSlot as Lang.Boolean) {
        me.visibleIds = visibleIds;
        me.visibleCount = (visibleCount < visibleIds.size()) ? visibleCount : visibleIds.size();
        me.focusedIndex = 0;
        me.windowStart = 0;
        me.endSlot = endSlot;
    }

    //! Number of stations (the End/Exit slot is not one).
    function count() as Lang.Number {
        return visibleIds.size();
    }

    //! Total selectable slots, including the trailing End/Exit tile when enabled.
    function slotCount() as Lang.Number {
        return visibleIds.size() + (endSlot ? 1 : 0);
    }

    //! True when the cursor sits on the trailing End/Exit tile.
    function isOnEndSlot() as Lang.Boolean {
        return endSlot && focusedIndex == visibleIds.size();
    }

    //! True when absolute slot index `i` is the End/Exit tile.
    function isEndIndex(i as Lang.Number) as Lang.Boolean {
        return endSlot && i == visibleIds.size();
    }

    function focusedId() {
        if (visibleIds.size() == 0 || isOnEndSlot()) {
            return null;
        }
        return visibleIds[focusedIndex];
    }

    //! Move the focus cursor by delta, wrapping over all slots (stations + the
    //! End/Exit tile), sliding the window to keep the cursor visible.
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
    //! the End/Exit tile, which has no id — test it with isEndIndex).
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
