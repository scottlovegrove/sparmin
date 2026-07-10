import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;

//! Discard confirmation — the native "discard without saving?" step. Reached only
//! from the touch confirm-end screen. Top-right button (red bin) discards; the
//! bottom-right button (green back arrow) returns to the end screen.
class DiscardConfirmView extends WatchUi.View {
    private var _stripView as StripView;
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    function initialize(stripView as StripView) {
        View.initialize();
        _stripView = stripView;
    }

    function getStripView() as StripView { return _stripView; }
    function getSession() as SessionManager { return _stripView.getSession(); }

    //! Top half = discard (top-right bin); bottom half = go back.
    function isDiscardTap(coords as Lang.Array) as Lang.Boolean {
        return coords[1] < _h / 2;
    }

    // Instructional copy, left-aligned and pre-wrapped like the native screen so
    // it's unmistakable which button discards.
    private var _lines as Lang.Array<Lang.String> = [
        "Press top button",
        "to discard this",
        "session without",
        "saving."
    ];

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

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
}
