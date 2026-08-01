import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the diagnostics log: scroll, and leave.
class DiagnosticsDelegate extends WatchUi.InputDelegate {

    private var _view as DiagnosticsView;
    private var _isTouch as Lang.Boolean;

    function initialize(view as DiagnosticsView, isTouch as Lang.Boolean) {
        InputDelegate.initialize();
        _view = view;
        _isTouch = isTouch;
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (key == WatchUi.KEY_DOWN) { _view.scroll(1); return true; }
        if (key == WatchUi.KEY_UP) { _view.scroll(-1); return true; }
        if (key == WatchUi.KEY_ESC) { WatchUi.popView(WatchUi.SLIDE_RIGHT); return true; }
        return false;
    }

    function onSwipe(evt as WatchUi.SwipeEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        var direction = evt.getDirection();
        if (direction == WatchUi.SWIPE_UP) { _view.scroll(1); return true; }
        if (direction == WatchUi.SWIPE_DOWN) { _view.scroll(-1); return true; }
        if (direction == WatchUi.SWIPE_RIGHT) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return true;
        }
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        return _isTouch;
    }
}
