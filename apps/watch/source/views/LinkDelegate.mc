import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the link screen. There is almost nothing to do here — the work is
//! happening on somebody's phone — so the only actions are retry and leave.
class LinkDelegate extends WatchUi.InputDelegate {

    private var _view as LinkView;

    function initialize(view as LinkView) {
        InputDelegate.initialize();
        _view = view;
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if ((key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) && _view.canRetry()) {
            _view.retry();
            return true;
        }
        if (key == WatchUi.KEY_ESC) {
            _leave();
            return true;
        }
        return false;
    }

    //! Left-to-right is the system Back gesture. Unanswered it pops this view
    //! anyway, which is the same outcome — but answering it keeps the intent
    //! explicit and stops the poll timer through onHide either way (AGENTS.md).
    function onSwipe(evt as WatchUi.SwipeEvent) as Lang.Boolean {
        if (!_view.isTouch() || evt.getDirection() != WatchUi.SWIPE_RIGHT) {
            return false;
        }
        _leave();
        return true;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_view.isTouch()) {
            return false;
        }
        if (_view.canRetry()) {
            _view.retry();
        }
        return true;
    }

    private function _leave() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
