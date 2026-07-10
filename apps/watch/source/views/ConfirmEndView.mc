import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Time;
import Toybox.Math;

//! Guarded end (§5 CONFIRM_END), styled like the native activity stop screen.
//!
//! Touch (VA5): three bezel arcs — resume (green ▶, top-right button), save
//! (green ✓, bottom-right button) and discard (red bin, top, touch-only). Discard
//! routes through its own confirm screen; the two common actions sit on the two
//! physical buttons so they work with a wet finger.
//! Buttons (FR745): a two-way tick (save) / cross (resume) laid out for the
//! Up/Down focus cursor and drawn as line shapes, legible on its MIP panel.

//! Touch tap regions on the confirm-end screen (the return of regionAtPoint).
enum {
    CONFIRM_REGION_NONE = -1,
    CONFIRM_REGION_DISCARD,
    CONFIRM_REGION_RESUME,
    CONFIRM_REGION_SAVE
}

class ConfirmEndView extends WatchUi.View {
    private var _stripView as StripView;
    private var _session as SessionManager;
    private var _isTouch as Lang.Boolean;
    public var focus as Lang.Number;      // FR745 only: 0 = save, 1 = resume
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

    //! Which arc a tap fell on, by its angle from centre (touch only).
    function regionAtPoint(coords as Lang.Array) as Lang.Number {
        var dx = coords[0] - _w / 2.0;
        var dy = _h / 2.0 - coords[1];     // screen y is down; make up positive
        var ang = Math.atan2(dy, dx) * 180.0 / Math.PI;
        if (ang < 0) { ang += 360; }
        if (ang >= 20 && ang < 78) { return CONFIRM_REGION_RESUME; }
        if (ang >= 78 && ang < 150) { return CONFIRM_REGION_DISCARD; }
        if (ang >= 270 && ang < 340) { return CONFIRM_REGION_SAVE; }
        return CONFIRM_REGION_NONE;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        // Touch keeps the text in the central band, clear of the three edge arcs;
        // the button device uses its original higher layout.
        var titleY = _isTouch ? 0.40 : 0.20;
        var timeY = _isTouch ? 0.56 : 0.38;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * titleY, Graphics.FONT_SMALL, "End session?",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var now = Time.now().value();
        dc.drawText(_w / 2, _h * timeY, Graphics.FONT_NUMBER_MEDIUM,
                    Fmt.duration(_session.elapsedSeconds(now)),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if (_isTouch) {
            ButtonHints.draw(dc, _w, _h, ButtonHints.DEG_TOP, ButtonHints.HINT_RED, ButtonHints.GLYPH_TRASH);
            ButtonHints.draw(dc, _w, _h, ButtonHints.DEG_TOP_RIGHT, ButtonHints.HINT_GREEN, ButtonHints.GLYPH_PLAY);
            ButtonHints.draw(dc, _w, _h, ButtonHints.DEG_BOTTOM_RIGHT, ButtonHints.HINT_GREEN, ButtonHints.GLYPH_TICK);
        } else {
            var r = (_h * 0.13).toNumber();
            var markCy = (_h * 0.72).toNumber();
            _drawTick(dc, (_w * 0.32).toNumber(), markCy, r, focus == 0);
            _drawCross(dc, (_w * 0.68).toNumber(), markCy, r, focus == 1);
        }
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
