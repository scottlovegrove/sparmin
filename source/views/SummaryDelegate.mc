import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the summary screen (raw InputDelegate). Scroll with Up/Down or a
//! vertical swipe; dismiss with Start/Back or a tap, returning to the idle strip.
class SummaryDelegate extends WatchUi.InputDelegate {
    private var _view as SummaryView;
    private var _session as SessionManager;

    function initialize(view as SummaryView) {
        InputDelegate.initialize();
        _view = view;
        _session = view.getSession();
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (key == WatchUi.KEY_UP) { _view.scroll(-1); return true; }
        if (key == WatchUi.KEY_DOWN) { _view.scroll(1); return true; }
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START
                || key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
            _dismiss();
            return true;
        }
        return false;
    }

    function onSwipe(evt as WatchUi.SwipeEvent) as Lang.Boolean {
        var dir = evt.getDirection();
        if (dir == WatchUi.SWIPE_UP) {
            _view.scroll(1);
        } else if (dir == WatchUi.SWIPE_DOWN) {
            _view.scroll(-1);
        }
        return true;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        _dismiss();
        return true;
    }

    private function _dismiss() as Void {
        _session.dismissSummary();            // -> IDLE
        WatchUi.popView(WatchUi.SLIDE_DOWN);  // back to the strip
    }
}
