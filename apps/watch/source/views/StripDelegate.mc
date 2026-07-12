import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;
import Toybox.System;

//! Input for the strip view (§7). Uses raw InputDelegate events, not
//! BehaviorDelegate — on a touch device BehaviorDelegate translates a tap into
//! the SELECT behaviour (losing the coordinates), so tile selection could never
//! see where you tapped.
//!
//! Touch (VA5): tap a tile to select; tap the footer (idle) to edit activities;
//!              swipe to pan. The two physical buttons are the wet fallback (a wet
//!              finger can't tap): top-right (KEY_ENTER) = Next, cycling the focus
//!              highlight; bottom-right (KEY_ESC) = Select, committing it. The
//!              cycle ends on a trailing tile — "End" mid-session, "Exit" at idle —
//!              so both leaving the app and ending a session are reachable without
//!              a dedicated gesture (the vívoactive 5 reserves the top-button hold
//!              for its own controls menu). A hold of the bottom-right button is a
//!              shortcut straight to that tile's action.
//!              While idle and *not* button-navigating (no cursor yet), the
//!              bottom-right button keeps its conventional Back/exit meaning, like
//!              every other Garmin app. The first Next press reveals the cursor and
//!              claims the button as Select — the Exit tile is then the way out.
//! Buttons (FR745): Up/Down move focus; Start selects the focused tile; Back/Lap
//!              is the context Stop; Menu edits activities.
//!
//! With water-safe touch on (TouchConfig) a tile actuates only on a *second* tap
//! of the same tile within DOUBLE_TAP_MS — a droplet guard on the touch path; the
//! buttons commit in one press regardless.
class StripDelegate extends WatchUi.InputDelegate {
    private var _view as StripView;
    private var _session as SessionManager;
    private var _ctrl as StripController;
    private var _isTouch as Lang.Boolean;
    private var _dragStartX as Lang.Number = 0;
    private var _dragStartVisual as Lang.Float = 0.0;
    private var _lastTapId = null;                  // armed tile for the double-tap gate
    private var _lastTapMs as Lang.Number = 0;
    private var _escDownMs as Lang.Number = 0;      // bottom-right press time, for hold detection

    function initialize(view as StripView) {
        InputDelegate.initialize();
        _view = view;
        _session = view.getSession();
        _ctrl = view.getController();
        _isTouch = view.isTouch();
    }

    private function now() as Lang.Number {
        return Time.now().value();
    }

    // Hold threshold (ms) for the bottom-right end/exit shortcut.
    const HOLD_MS = 600;
    // Sentinel id for the End/Exit tile's double-tap gate (never a real activityId).
    const END_TAP_ID = "__end__";

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (_isTouch) {
            if (key == WatchUi.KEY_ENTER) { _next(); return true; }      // top-right: cycle
            if (key == WatchUi.KEY_ESC) {                                // bottom-right
                var held = (_escDownMs > 0) ? System.getTimer() - _escDownMs : 0;
                _escDownMs = 0;
                // Idle and not button-navigating: keep the conventional Back (exit
                // the app), like every other Garmin app. Once the cursor is live the
                // button becomes Select — the Exit tile in the cycle is then the way
                // out, so nobody is stranded.
                if (_session.getState() == STATE_IDLE && !_view.isCursorShown()) {
                    return false;   // let the OS take it — exits the app
                }
                if (held >= HOLD_MS) { _endOrExit(); } else { _commit(); }   // hold = end, tap = select
                return true;
            }
            return false;
        }
        // Button device (FR745)
        if (key == WatchUi.KEY_UP) { _ctrl.moveFocus(-1); _view.animateToWindow(); return true; }
        if (key == WatchUi.KEY_DOWN) { _ctrl.moveFocus(1); _view.animateToWindow(); return true; }
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) { _selectActivity(_ctrl.focusedId()); return true; }
        if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) { return _back(); }
        if (key == WatchUi.KEY_MENU) { _openConfig(); return true; }
        return false;
    }

    //! Timestamp a bottom-right press so onKey can tell a tap (Select) from a hold
    //! (end session). Returns false — it must NOT suppress the onKey click that
    //! does the actual work.
    function onKeyPressed(evt as WatchUi.KeyEvent) as Lang.Boolean {
        if (_isTouch && evt.getKey() == WatchUi.KEY_ESC) {
            _escDownMs = System.getTimer();
        }
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        var coords = evt.getCoordinates();
        if (_session.getState() == STATE_IDLE && _view.isFooterTap(coords)) {
            _openConfig();
            return true;
        }
        if (_view.isEndTileAtPoint(coords)) {
            // Same droplet guard as the tiles: needs a confirming second tap.
            if (TouchConfig.isWaterSafe() && !_confirmsSecondTap(END_TAP_ID)) {
                return true;
            }
            _endOrExit();
            return true;
        }
        var id = _view.activityIdAtPoint(coords);
        if (id == null) {
            return true;
        }
        if (TouchConfig.isWaterSafe() && !_confirmsSecondTap(id)) {
            return true;   // first tap arms; a droplet won't produce the second
        }
        _ctrl.focusId(id);   // keep the button cursor in sync with taps
        _selectActivity(id);
        return true;
    }

    //! Advance the double-tap gate for `id`. Returns true when this tap confirms a
    //! double-tap of the same tile; otherwise arms `id` for the next tap.
    private function _confirmsSecondTap(id) as Lang.Boolean {
        var nowMs = System.getTimer();
        var confirmed = TouchConfig.confirmsTap(_lastTapId, _lastTapMs, id, nowMs, TouchConfig.DOUBLE_TAP_MS);
        _lastTapId = confirmed ? null : id;   // consume on confirm, else re-arm
        _lastTapMs = nowMs;
        return confirmed;
    }

    //! Drag-to-scroll: the strip tracks the finger while dragging, then snaps to
    //! the nearest tile on release (much smoother than one-tile-per-swipe).
    function onDrag(evt as WatchUi.DragEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        var coords = evt.getCoordinates();
        var type = evt.getType();
        if (type == WatchUi.DRAG_TYPE_START) {
            _dragStartX = coords[0];
            _dragStartVisual = _view.getVisualStart();
            _view.beginDrag();
        } else if (type == WatchUi.DRAG_TYPE_CONTINUE) {
            var dx = coords[0] - _dragStartX;
            _view.dragTo(_dragStartVisual - dx / _view.stepPx());
        } else if (type == WatchUi.DRAG_TYPE_STOP) {
            _view.snapToNearest();
        }
        return true;
    }

    // ---- Helpers ----

    private function _selectActivity(id) as Void {
        if (id == null) {
            return;
        }
        _session.selectActivity(id, now());
        WatchUi.requestUpdate();
    }

    // ---- Touch button fallback (cycle + commit) ----

    //! Top-right: advance the highlight one slot (loops, includes the End/Exit tile).
    private function _next() as Void {
        _ctrl.moveFocus(1);
        _view.revealCursor();
        _view.animateToWindow();
    }

    //! Bottom-right: commit the highlighted target — start/switch a station, or
    //! end/exit on the trailing tile.
    private function _commit() as Void {
        _view.revealCursor();
        if (_ctrl.isOnEndSlot()) {
            _endOrExit();
            return;
        }
        _selectActivity(_ctrl.focusedId());
    }

    //! The trailing tile (and the bottom-right hold): end the session, or exit the
    //! app at idle — where it's the way out once the cursor has claimed Back.
    private function _endOrExit() as Void {
        if (_session.getState() == STATE_IDLE) {
            System.exit();   // never returns
        } else {
            _session.requestEnd(now());
            var cev = new ConfirmEndView(_view);
            WatchUi.pushView(cev, new ConfirmEndDelegate(cev), WatchUi.SLIDE_UP);
        }
    }

    private function _stop() as Void {
        _session.stopPress(now());
        if (_session.getState() == STATE_CONFIRM_END) {
            var cev = new ConfirmEndView(_view);
            WatchUi.pushView(cev, new ConfirmEndDelegate(cev), WatchUi.SLIDE_UP);
        } else {
            WatchUi.requestUpdate();
        }
    }

    // Back (button devices, FR745): exit from IDLE, otherwise the context Stop.
    private function _back() as Lang.Boolean {
        if (_session.getState() == STATE_IDLE) {
            return false;   // let the OS exit the app
        }
        _stop();
        return true;
    }

    private function _openConfig() as Void {
        if (_session.getState() != STATE_IDLE) {
            return;
        }
        var menu = new WatchUi.Menu2({ :title => "Settings" });
        menu.addItem(new WatchUi.MenuItem("Show / hide", null, "hide", null));
        menu.addItem(new WatchUi.MenuItem("Reorder", null, "reorder", null));
        // Water-safe touch only means anything on a touchscreen (VA5); button
        // devices (FR745) have no touch to guard, so don't offer it there.
        if (_isTouch) {
            menu.addItem(new WatchUi.ToggleMenuItem(
                "Water-safe touch", null, "waterSafe", TouchConfig.isWaterSafe(), null));
        }
        WatchUi.pushView(menu, new ConfigDelegate(), WatchUi.SLIDE_UP);
    }
}
