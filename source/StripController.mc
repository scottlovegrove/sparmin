import Toybox.Lang;

//! Pure strip navigation: the focus cursor (button devices) and the visible
//! window over the configured station list. No drawing, no device APIs — the
//! edge-sliding rule (§4) is unit-testable here.
class StripController {
    public var visibleIds as Lang.Array;  // configured, ordered visible stationIds
    public var focusedIndex as Lang.Number;
    public var windowStart as Lang.Number;
    public var visibleCount as Lang.Number;

    function initialize(visibleIds as Lang.Array, visibleCount as Lang.Number) {
        me.visibleIds = visibleIds;
        me.visibleCount = (visibleCount < visibleIds.size()) ? visibleCount : visibleIds.size();
        me.focusedIndex = 0;
        me.windowStart = 0;
    }

    function count() as Lang.Number {
        return visibleIds.size();
    }

    function focusedId() {
        if (visibleIds.size() == 0) {
            return null;
        }
        return visibleIds[focusedIndex];
    }

    //! Move the focus cursor by delta, wrapping at the ends, sliding the window
    //! to keep the cursor visible.
    function moveFocus(delta as Lang.Number) as Void {
        var n = visibleIds.size();
        if (n == 0) {
            return;
        }
        focusedIndex = (focusedIndex + delta) % n;
        if (focusedIndex < 0) {
            focusedIndex += n;
        }
        _reveal();
    }

    //! Pan the window (touch devices) without moving a focus cursor.
    function panWindow(delta as Lang.Number) as Void {
        windowStart = _clampStart(windowStart + delta);
    }

    //! stationId shown in window slot k (0 .. visibleCount-1), or null.
    function idAtSlot(k as Lang.Number) {
        var idx = windowStart + k;
        return (idx >= 0 && idx < count()) ? visibleIds[idx] : null;
    }

    //! stationId at an absolute index in the visible list, or null.
    function idAtIndex(i as Lang.Number) {
        return (i >= 0 && i < visibleIds.size()) ? visibleIds[i] : null;
    }

    //! Re-apply a (possibly reordered/hidden) config, keeping focus in range.
    function reload(newVisibleIds as Lang.Array) as Void {
        visibleIds = newVisibleIds;
        if (visibleCount > newVisibleIds.size()) {
            visibleCount = newVisibleIds.size();
        }
        if (focusedIndex >= newVisibleIds.size()) {
            focusedIndex = newVisibleIds.size() - 1;
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
        var maxStart = count() - visibleCount;
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
