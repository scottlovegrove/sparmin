import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Time;

//! Guarded end (§5 CONFIRM_END): shows total-so-far with a tick (confirm) and a
//! cross (cancel), mirroring the native activity stop. Marks are drawn as line
//! shapes rather than glyph fonts so they stay legible on the FR745's MIP panel.
class ConfirmEndView extends WatchUi.View {
    private var _stripView as StripView;
    private var _session as SessionManager;
    private var _isTouch as Lang.Boolean;
    public var focus as Lang.Number;      // 0 = confirm, 1 = cancel
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    function initialize(stripView as StripView) {
        View.initialize();
        _stripView = stripView;
        _session = stripView.getSession();
        _isTouch = stripView.isTouch();
        focus = 0;
    }

    function getSession() as SessionManager { return _session; }
    function getStripView() as StripView { return _stripView; }
    function isTouch() as Lang.Boolean { return _isTouch; }

    function toggleFocus() as Void {
        focus = (focus == 0) ? 1 : 0;
        WatchUi.requestUpdate();
    }

    //! 0 = confirm (left), 1 = cancel (right).
    function choiceAtPoint(coords as Lang.Array) as Lang.Number {
        return (coords[0] < _w / 2) ? 0 : 1;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        dc.drawText(_w / 2, _h * 0.20, Graphics.FONT_SMALL, "End session?",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var now = Time.now().value();
        dc.drawText(_w / 2, _h * 0.38, Graphics.FONT_NUMBER_MEDIUM,
                    Fmt.duration(_session.elapsedSeconds(now)),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var r = (_h * 0.13).toNumber();
        _drawTick(dc, (_w * 0.32).toNumber(), (_h * 0.72).toNumber(), r, focus == 0);
        _drawCross(dc, (_w * 0.68).toNumber(), (_h * 0.72).toNumber(), r, focus == 1);
    }

    private function _drawTick(dc as Graphics.Dc, cx, cy, r, focused) as Void {
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, r);
        _ring(dc, cx, cy, r, focused);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawLine(cx - r * 0.45, cy + r * 0.05, cx - r * 0.1, cy + r * 0.4);
        dc.drawLine(cx - r * 0.1, cy + r * 0.4, cx + r * 0.5, cy - r * 0.4);
        dc.setPenWidth(1);
    }

    private function _drawCross(dc as Graphics.Dc, cx, cy, r, focused) as Void {
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, r);
        _ring(dc, cx, cy, r, focused);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawLine(cx - r * 0.4, cy - r * 0.4, cx + r * 0.4, cy + r * 0.4);
        dc.drawLine(cx - r * 0.4, cy + r * 0.4, cx + r * 0.4, cy - r * 0.4);
        dc.setPenWidth(1);
    }

    private function _ring(dc as Graphics.Dc, cx, cy, r, focused) as Void {
        if (!focused) {
            return;
        }
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        dc.drawCircle(cx, cy, r + 3);
        dc.setPenWidth(1);
    }
}
