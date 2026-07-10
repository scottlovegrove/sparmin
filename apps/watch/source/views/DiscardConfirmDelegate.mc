import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the discard confirmation. Top-right button (KEY_ENTER) or a top tap
//! discards without saving; bottom-right (KEY_ESC) or a bottom tap goes back to
//! the end screen.
class DiscardConfirmDelegate extends WatchUi.InputDelegate {
    private var _view as DiscardConfirmView;
    private var _session as SessionManager;
    private var _stripView as StripView;

    function initialize(view as DiscardConfirmView) {
        InputDelegate.initialize();
        _view = view;
        _session = view.getSession();
        _stripView = view.getStripView();
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (key == WatchUi.KEY_ENTER) { _discard(); return true; }   // top-right
        if (key == WatchUi.KEY_ESC) { _back(); return true; }        // bottom-right
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (_view.isDiscardTap(evt.getCoordinates())) {
            _discard();
        } else {
            _back();
        }
        return true;
    }

    private function _discard() as Void {
        _session.discardSession();   // throws the FIT away, back to IDLE
        var dv = new DiscardedView();
        WatchUi.switchToView(dv, new DiscardedDelegate(dv), WatchUi.SLIDE_UP);
    }

    private function _back() as Void {
        var cev = new ConfirmEndView(_stripView);
        WatchUi.switchToView(cev, new ConfirmEndDelegate(cev), WatchUi.SLIDE_DOWN);
    }
}
