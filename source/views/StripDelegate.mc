import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;

//! Input for the strip view (§7). Uses raw InputDelegate events, not
//! BehaviorDelegate — on a touch device BehaviorDelegate translates a tap into
//! the SELECT behaviour (losing the coordinates), so tile selection could never
//! see where you tapped.
//!
//! Touch (VA5):   tap a tile to select; tap the footer (idle) to edit stations;
//!                swipe to pan; top-right button (KEY_ENTER) = Stop; bottom-right
//!                (KEY_ESC) = Back/exit.
//! Buttons (FR745): Up/Down move focus; Start selects the focused tile; Back/Lap
//!                is the context Stop; Menu edits stations.
class StripDelegate extends WatchUi.InputDelegate {
    private var _view as StripView;
    private var _session as SessionManager;
    private var _ctrl as StripController;
    private var _isTouch as Lang.Boolean;

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
        if (key == WatchUi.KEY_UP) { _ctrl.moveFocus(-1); WatchUi.requestUpdate(); return true; }
        if (key == WatchUi.KEY_DOWN) { _ctrl.moveFocus(1); WatchUi.requestUpdate(); return true; }
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) { _selectStation(_ctrl.focusedId()); return true; }
        if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) { return _back(); }
        if (key == WatchUi.KEY_MENU) { _openConfig(); return true; }
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
        _selectStation(_view.stationIdAtPoint(coords));
        return true;
    }

    function onSwipe(evt as WatchUi.SwipeEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        var dir = evt.getDirection();
        if (dir == WatchUi.SWIPE_LEFT) {
            _ctrl.panWindow(1);
            WatchUi.requestUpdate();
        } else if (dir == WatchUi.SWIPE_RIGHT) {
            _ctrl.panWindow(-1);
            WatchUi.requestUpdate();
        }
        return true;
    }

    // ---- Helpers ----

    private function _selectStation(id) as Void {
        if (id == null) {
            return;
        }
        _session.selectStation(id, now());
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
    // button devices, and a no-op on touch (where Stop is the top-right button)
    // to avoid an accidental exit.
    private function _back() as Lang.Boolean {
        if (_session.getState() == STATE_IDLE) {
            return false;   // let the OS exit the app
        }
        if (_isTouch) {
            return true;
        }
        _stop();
        return true;
    }

    private function _openConfig() as Void {
        if (_session.getState() != STATE_IDLE) {
            return;
        }
        var menu = new WatchUi.Menu2({ :title => "Edit stations" });
        menu.addItem(new WatchUi.MenuItem("Show / hide", null, "hide", null));
        menu.addItem(new WatchUi.MenuItem("Reorder", null, "reorder", null));
        WatchUi.pushView(menu, new ConfigDelegate(), WatchUi.SLIDE_UP);
    }
}
