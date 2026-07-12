import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;

//! Discard confirmation — the native "discard without saving?" step.
//!
//! Touch (VA5): instructional copy plus two bezel arcs — the top-right button
//! (red bin) discards, the bottom-right (green back arrow) returns.
//! Buttons (FR745): a discard/cancel pair moved through with Up/Down and
//! committed with Start; Back cancels. Focus starts on **cancel**, so a stray
//! Start press can't throw the session away.
class DiscardConfirmView extends WatchUi.View {
    private var _stripView as StripView;
    private var _isTouch as Lang.Boolean;
    public var focus as Lang.Number;      // buttons only: 0 = cancel, 1 = discard
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    // Instructional copy, left-aligned and pre-wrapped like the native screen so
    // it's unmistakable which button discards.
    private var _lines as Lang.Array<Lang.String> = [
        "Press top button",
        "to discard this",
        "session without",
        "saving."
    ];

    function initialize(stripView as StripView) {
        View.initialize();
        _stripView = stripView;
        _isTouch = stripView.isTouch();
        focus = 0;   // default to cancel — discard is destructive
    }

    function getStripView() as StripView { return _stripView; }
    function getSession() as SessionManager { return _stripView.getSession(); }
    function isTouch() as Lang.Boolean { return _isTouch; }

    function toggleFocus() as Void {
        focus = (focus == 0) ? 1 : 0;
        WatchUi.requestUpdate();
    }

    //! Top half = discard (top-right bin); bottom half = go back. Touch only.
    function isDiscardTap(coords as Lang.Array) as Lang.Boolean {
        return coords[1] < _h / 2;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        if (_isTouch) {
            _drawTouch(dc);
        } else {
            _drawButtons(dc);
        }
    }

    private function _drawTouch(dc as Graphics.Dc) as Void {
        // Red bin at the top-right button (discard), green back-arrow at the
        // bottom-right button (return). Draw the arcs first so text sits over black.
        ButtonHints.draw(dc, _w, _h, ButtonHints.DEG_TOP_RIGHT, ButtonHints.HINT_RED, ButtonHints.GLYPH_TRASH);
        ButtonHints.draw(dc, _w, _h, ButtonHints.DEG_BOTTOM_RIGHT, ButtonHints.HINT_GREEN, ButtonHints.GLYPH_BACK);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var font = Graphics.FONT_SMALL;
        var lh = dc.getFontHeight(font);
        var x = (_w * 0.12).toNumber();
        var startY = (_h / 2) - (_lines.size() * lh) / 2;
        for (var i = 0; i < _lines.size(); i += 1) {
            dc.drawText(x, startY + i * lh + lh / 2, font, _lines[i],
                        Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    //! Button device: centred question + a cancel/discard pair under the focus
    //! cursor. No arcs — there are no side buttons to point at.
    private function _drawButtons(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * 0.24, Graphics.FONT_SMALL, "Discard session",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * 0.38, Graphics.FONT_XTINY, "without saving?",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(_w / 2, _h * 0.53, Graphics.FONT_XTINY,
                    (focus == 0) ? "Cancel" : "Discard",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var r = (_h * 0.13).toNumber();
        var markCy = (_h * 0.74).toNumber();
        _drawCross(dc, (_w * 0.32).toNumber(), markCy, r, focus == 0);   // cancel
        _drawBin(dc, (_w * 0.68).toNumber(), markCy, r, focus == 1);     // discard
    }

    //! Cancel mark (a cross on grey — it returns, it doesn't destroy).
    private function _drawCross(dc as Graphics.Dc, cx, cy, r, focused) as Void {
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, r);
        _ring(dc, cx, cy, r, focused);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawLine(cx - r * 0.4, cy - r * 0.4, cx + r * 0.4, cy + r * 0.4);
        dc.drawLine(cx - r * 0.4, cy + r * 0.4, cx + r * 0.4, cy - r * 0.4);
        dc.setPenWidth(1);
    }

    //! Waste bin (discard), filled rectangles so it stays legible on MIP.
    private function _drawBin(dc as Graphics.Dc, cx, cy, r, focused) as Void {
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, r);
        _ring(dc, cx, cy, r, focused);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var s = (r * 0.5).toNumber();
        dc.fillRectangle(cx - s, (cy - s * 0.55).toNumber(), 2 * s, (s * 0.3).toNumber() + 1);
        dc.fillRectangle((cx - s * 0.4).toNumber(), cy - s, (s * 0.8).toNumber(), (s * 0.4).toNumber() + 1);
        dc.fillRectangle((cx - s * 0.75).toNumber(), (cy - s * 0.2).toNumber(),
                         (s * 1.5).toNumber(), (s * 1.35).toNumber());
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
