import Toybox.Lang;
import Toybox.WatchUi;

//! Input for the discard confirmation.
//!
//! Touch (VA5): top-right button (KEY_ENTER) or a top tap discards without
//! saving; bottom-right (KEY_ESC) or a bottom tap goes back to the end screen.
//! Buttons (FR745): Up/Down move focus between cancel and discard, Start commits
//! the focused one, Back/Lap cancels.
class DiscardConfirmDelegate extends WatchUi.InputDelegate {
    private var _view as DiscardConfirmView;
    private var _session as SessionManager;
    private var _stripView as StripView;
    private var _isTouch as Lang.Boolean;

    function initialize(view as DiscardConfirmView) {
        InputDelegate.initialize();
        _view = view;
        _session = view.getSession();
        _stripView = view.getStripView();
        _isTouch = view.isTouch();
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (!_isTouch) {
            if (key == WatchUi.KEY_UP || key == WatchUi.KEY_DOWN) {
                _view.toggleFocus();
                return true;
            }
            if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
                if (_view.focus == 1) { _discard(); } else { _back(); }
                return true;
            }
            if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
                _back();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER) { _discard(); return true; }   // top-right
        if (key == WatchUi.KEY_ESC) { _back(); return true; }        // bottom-right
        return false;
    }

    //! Back-swipe cancels back to the end screen, like the bottom-right button.
    //! Left to the OS it would pop straight to the strip with the session still
    //! in CONFIRM_END and nothing on screen offering to finish it.
    function onSwipe(evt as WatchUi.SwipeEvent) as Lang.Boolean {
        if (!_isTouch || evt.getDirection() != WatchUi.SWIPE_RIGHT) {
            return false;
        }
        _back();
        return true;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
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
