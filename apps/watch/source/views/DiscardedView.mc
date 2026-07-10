import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Timer;

//! Brief "Discarded" acknowledgement shown after a discard, then auto-returns to
//! the idle strip. A tap or press dismisses it early.
class DiscardedView extends WatchUi.View {
    private const DWELL_MS = 1400;
    private var _timer as Timer.Timer?;
    private var _dismissed as Lang.Boolean = false;
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        if (_timer == null) {
            _timer = new Timer.Timer();
            _timer.start(method(:dismiss), DWELL_MS, false);
        }
    }

    function onHide() as Void {
        _stopTimer();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(_w / 2, _h / 2, Graphics.FONT_MEDIUM, "Discarded",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Return to the idle strip (once). Called by the dwell timer or a tap/press.
    function dismiss() as Void {
        if (_dismissed) {
            return;
        }
        _dismissed = true;
        _stopTimer();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    private function _stopTimer() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }
}
