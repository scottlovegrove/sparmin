import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;

//! Input for the confirm-end dialog (§7), via raw InputDelegate events.
//! Buttons: Up/Down move focus between tick/cross, Start commits the focused
//! choice, Back/Lap cancels. Touch: tap the tick (left) to confirm, the cross
//! (right) to cancel; top-right button confirms, bottom-right cancels.
class ConfirmEndDelegate extends WatchUi.InputDelegate {
    private var _view as ConfirmEndView;
    private var _session as SessionManager;
    private var _stripView as StripView;
    private var _isTouch as Lang.Boolean;

    function initialize(view as ConfirmEndView) {
        InputDelegate.initialize();
        _view = view;
        _session = view.getSession();
        _stripView = view.getStripView();
        _isTouch = view.isTouch();
    }

    private function now() as Lang.Number {
        return Time.now().value();
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (!_isTouch) {
            if (key == WatchUi.KEY_UP || key == WatchUi.KEY_DOWN) {
                _view.toggleFocus();
                return true;
            }
            if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
                if (_view.focus == 0) { _confirm(); } else { _cancel(); }
                return true;
            }
            if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
                _cancel();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER) { _confirm(); return true; }
        if (key == WatchUi.KEY_ESC) { _cancel(); return true; }
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        if (_view.choiceAtPoint(evt.getCoordinates()) == 0) { _confirm(); } else { _cancel(); }
        return true;
    }

    private function _confirm() as Void {
        _session.confirmEnd(now());   // stops + saves the FIT activity
        // Backend POST would fire here once the backend exists (deferred).
        var sv = new SummaryView(_stripView);
        WatchUi.switchToView(sv, new SummaryDelegate(sv), WatchUi.SLIDE_UP);
    }

    private function _cancel() as Void {
        _session.cancelEnd();
        WatchUi.popView(WatchUi.SLIDE_DOWN);  // back to the strip (TRANSITION)
    }
}
