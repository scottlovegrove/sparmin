import Toybox.Lang;
import Toybox.WatchUi;

//! Any press or tap dismisses the "Discarded" acknowledgement early; otherwise it
//! auto-returns to the idle strip after its dwell.
class DiscardedDelegate extends WatchUi.InputDelegate {
    private var _view as DiscardedView;

    function initialize(view as DiscardedView) {
        InputDelegate.initialize();
        _view = view;
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        _view.dismiss();
        return true;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        _view.dismiss();
        return true;
    }
}
