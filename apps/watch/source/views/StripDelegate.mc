import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;
import Toybox.System;

//! Input for the strip view (§7). Uses raw InputDelegate events, not
//! BehaviorDelegate — on a touch device BehaviorDelegate translates a tap into
//! the SELECT behaviour (losing the coordinates), so tile selection could never
//! see where you tapped.
//!
//! Touch (VA5):   tap a tile to select; tap the footer (idle) to edit activities;
//!                swipe to pan; top-right button (KEY_ENTER) = Stop; bottom-right
//!                (KEY_ESC) = Back/exit.
//! Buttons (FR745): Up/Down move focus; Start selects the focused tile; Back/Lap
//!                is the context Stop; Menu edits activities.
//!
//! With water-safe touch on (TouchConfig): a tile actuates only on a *second*
//! tap of the same tile within DOUBLE_TAP_MS, and the bottom-right button
//! (KEY_ESC, otherwise a mid-session no-op on touch) toggles a touch-lock that
//! makes the strip ignore all touch until pressed again.
class StripDelegate extends WatchUi.InputDelegate {
    private var _view as StripView;
    private var _session as SessionManager;
    private var _ctrl as StripController;
    private var _isTouch as Lang.Boolean;
    private var _dragStartX as Lang.Number = 0;
    private var _dragStartVisual as Lang.Float = 0.0;
    private var _lastTapId = null;                  // armed tile for the double-tap gate
    private var _lastTapMs as Lang.Number = 0;

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

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (_isTouch) {
            if (key == WatchUi.KEY_ENTER) { _stop(); return true; }      // top-right
            if (key == WatchUi.KEY_ESC) { return _back(); }              // bottom-right
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

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        if (_view.isTouchLocked()) {
            return true;   // water-safe lock: swallow all touch
        }
        var coords = evt.getCoordinates();
        if (_session.getState() == STATE_IDLE && _view.isFooterTap(coords)) {
            _openConfig();
            return true;
        }
        var id = _view.activityIdAtPoint(coords);
        if (id == null) {
            return true;
        }
        if (TouchConfig.isWaterSafe() && !_confirmsSecondTap(id)) {
            return true;   // first tap arms; a droplet won't produce the second
        }
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
        if (_view.isTouchLocked()) {
            return true;   // water-safe lock: no drag scrolling either
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

    private function _stop() as Void {
        _session.stopPress(now());
        if (_session.getState() == STATE_CONFIRM_END) {
            var cev = new ConfirmEndView(_view);
            WatchUi.pushView(cev, new ConfirmEndDelegate(cev), WatchUi.SLIDE_UP);
        } else {
            WatchUi.requestUpdate();
        }
    }

    // Back: exit from IDLE (both devices). Mid-session it's the context Stop on
    // button devices. On touch it's a no-op (Stop is the top-right button) — or,
    // with water-safe touch on, it toggles the touch-lock so the strip can be
    // sealed against stray water taps.
    private function _back() as Lang.Boolean {
        if (_session.getState() == STATE_IDLE) {
            return false;   // let the OS exit the app
        }
        if (_isTouch) {
            if (TouchConfig.isWaterSafe()) {
                _view.toggleTouchLock();
                WatchUi.requestUpdate();
            }
            return true;
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
