import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;

//! Input for the confirm-end screen (raw InputDelegate).
//!
//! Touch (VA5): top-right button (KEY_ENTER) = Resume; bottom-right (KEY_ESC) =
//! Save. Taps map by arc: top = Discard (-> its own confirm), the right arc =
//! Resume, the bottom arc = Save.
//! Buttons (FR745): Up/Down move focus between save/resume, Start commits the
//! focused one, Back/Lap resumes.
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
                if (_view.focus == 0) { _save(); } else { _resume(); }
                return true;
            }
            if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
                _resume();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER) { _resume(); return true; }   // top-right
        if (key == WatchUi.KEY_ESC) { _save(); return true; }       // bottom-right
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!_isTouch) {
            return false;
        }
        var region = _view.regionAtPoint(evt.getCoordinates());
        if (region == CONFIRM_REGION_DISCARD) {
            _discard();
        } else if (region == CONFIRM_REGION_RESUME) {
            _resume();
        } else if (region == CONFIRM_REGION_SAVE) {
            _save();
        }
        return true;
    }

    //! Save the FIT and show the summary.
    private function _save() as Void {
        _session.confirmEnd(now());   // stops + saves the FIT activity
        var sv = new SummaryView(_stripView);
        WatchUi.switchToView(sv, new SummaryDelegate(sv), WatchUi.SLIDE_UP);
    }

    //! Back to the running session (still TRANSITION).
    private function _resume() as Void {
        _session.cancelEnd();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    //! Hand off to the discard confirmation.
    private function _discard() as Void {
        var dv = new DiscardConfirmView(_stripView);
        WatchUi.switchToView(dv, new DiscardConfirmDelegate(dv), WatchUi.SLIDE_UP);
    }
}
