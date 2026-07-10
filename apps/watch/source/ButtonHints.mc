import Toybox.Lang;
import Toybox.Graphics;
import Toybox.Math;

//! Native-style physical-button hints: a colour arc hugging the bezel next to a
//! button, with a glyph inside it — mirroring Garmin's own stop/discard screens
//! so the two side buttons read as clearly as on-screen controls. Touch devices
//! only (the button device, FR745, uses its own focus-cursor marks).
//!
//! Geometry adapts from the passed width/height (no device hardcoding). Angles
//! use the Graphics arc convention (0 deg = 3 o'clock, degrees increase
//! counter-clockwise); the constants below point at the vívoactive 5's two
//! right-side buttons, plus a top slot that has no button (touch-only).
module ButtonHints {

    const DEG_TOP = 108;          // top, no physical button — touch only
    const DEG_TOP_RIGHT = 52;     // ~2 o'clock, the top-right button
    const DEG_BOTTOM_RIGHT = 306; // ~4-5 o'clock, the bottom-right button
    const HALF_SPAN = 20;

    const GREEN = 0x00C853;
    const GREEN_DIM = 0x0A3A1E;
    const RED = 0xE53935;
    const RED_DIM = 0x3A1210;

    enum { HINT_GREEN, HINT_RED }
    enum { GLYPH_PLAY, GLYPH_TICK, GLYPH_TRASH, GLYPH_BACK }

    //! Draw one arc+glyph centred at `midDeg`, coloured by `kind`.
    function draw(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number,
                  midDeg as Lang.Number, kind as Lang.Number, glyph as Lang.Number) as Void {
        var color = (kind == HINT_RED) ? RED : GREEN;
        var dim = (kind == HINT_RED) ? RED_DIM : GREEN_DIM;
        _hint(dc, w, h, midDeg, color, dim, glyph);
    }

    function _hint(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, midDeg as Lang.Number,
                   color as Lang.Number, dim as Lang.Number, glyph as Lang.Number) as Void {
        var cx = w / 2;
        var cy = h / 2;
        var penMain = (w * 0.015 + 2).toNumber();
        var penGlow = penMain * 2;
        var r = (w / 2) - penGlow;
        var start = midDeg - HALF_SPAN;
        var end = midDeg + HALF_SPAN;

        // Dim underlay (fakes a glow — CIQ arcs have no gradient), then the
        // bright arc on top.
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(penGlow);
        dc.drawArc(cx, cy, r, Graphics.ARC_COUNTER_CLOCKWISE, start, end);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(penMain);
        dc.drawArc(cx, cy, r, Graphics.ARC_COUNTER_CLOCKWISE, start, end);
        dc.setPenWidth(1);

        // Glyph, seated just inside the arc.
        var rad = midDeg * Math.PI / 180.0;
        var rg = r - penGlow - (w * 0.030);
        var gx = (cx + rg * Math.cos(rad)).toNumber();
        var gy = (cy - rg * Math.sin(rad)).toNumber();
        var s = (w * 0.036).toNumber();
        _glyph(dc, glyph, gx, gy, s, color);
    }

    // All coordinates are forced to integers: the CIQ simulator segfaults on
    // fillPolygon (and is unreliable on fill/draw) with fractional points.
    function _glyph(dc as Graphics.Dc, glyph as Lang.Number, cx as Lang.Number, cy as Lang.Number,
                    s as Lang.Number, color as Lang.Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var pen = (s * 0.32).toNumber() + 1;
        if (glyph == GLYPH_PLAY) {
            // Filled right-pointing triangle, drawn as horizontal spans — avoids
            // fillPolygon, which segfaults this simulator build.
            dc.setPenWidth(1);
            var bx = (cx - s * 0.7).toNumber();
            var apexX = cx + s;
            for (var dy = -s; dy <= s; dy += 1) {
                var t = 1.0 - (dy.abs().toFloat() / s);
                var xr = bx + (t * (apexX - bx)).toNumber();
                dc.drawLine(bx, cy + dy, xr, cy + dy);
            }
        } else if (glyph == GLYPH_TICK) {
            dc.setPenWidth(pen);
            dc.drawLine(cx - s, cy, (cx - s * 0.2).toNumber(), (cy + s * 0.8).toNumber());
            dc.drawLine((cx - s * 0.2).toNumber(), (cy + s * 0.8).toNumber(), cx + s, cy - s);
            dc.setPenWidth(1);
        } else if (glyph == GLYPH_TRASH) {
            // bin: lid bar + little handle over a body
            dc.fillRectangle(cx - s, (cy - s * 0.55).toNumber(), 2 * s, (s * 0.28).toNumber() + 1);
            dc.fillRectangle((cx - s * 0.4).toNumber(), cy - s, (s * 0.8).toNumber(), (s * 0.4).toNumber() + 1);
            dc.fillRectangle((cx - s * 0.75).toNumber(), (cy - s * 0.2).toNumber(), (s * 1.5).toNumber(), (s * 1.35).toNumber());
        } else if (glyph == GLYPH_BACK) {
            // left-pointing arrow
            dc.setPenWidth(pen);
            dc.drawLine(cx + s, cy, cx - s, cy);
            dc.drawLine(cx - s, cy, (cx - s * 0.15).toNumber(), (cy - s * 0.7).toNumber());
            dc.drawLine(cx - s, cy, (cx - s * 0.15).toNumber(), (cy + s * 0.7).toNumber());
            dc.setPenWidth(1);
        }
    }
}
