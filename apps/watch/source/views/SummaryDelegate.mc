import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the summary screen (raw InputDelegate). Scroll with Up/Down (eased,
//! one row a press) or by dragging the list with a finger (1:1); dismiss with
//! Start/Back or a tap, returning to the idle strip.
class SummaryDelegate extends WatchUi.InputDelegate {
    private var _view as SummaryView;
    private var _session as SessionManager;
    private var _dragStartY as Lang.Number = 0;
    private var _dragging as Lang.Boolean = false;

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

    //! Track the finger 1:1 while dragging — a swipe-per-notch list feels sticky.
    function onDrag(evt as WatchUi.DragEvent) as Lang.Boolean {
        var coords = evt.getCoordinates();
        var type = evt.getType();
        if (type == WatchUi.DRAG_TYPE_START) {
            _dragStartY = coords[1];
            _dragging = true;
        } else if (type == WatchUi.DRAG_TYPE_CONTINUE && _dragging) {
            _view.dragBy(coords[1] - _dragStartY);
            _dragStartY = coords[1];
        } else if (type == WatchUi.DRAG_TYPE_STOP) {
            _dragging = false;
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
