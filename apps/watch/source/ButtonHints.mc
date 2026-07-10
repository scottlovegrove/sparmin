import Toybox.Lang;
import Toybox.Graphics;
import Toybox.Math;

//! Native-style physical-button hints: a colour arc hugging the bezel next to a
//! button, with a glyph inside it — mirroring Garmin's own activity screens so
//! the two side buttons read as clearly as on-screen controls. Used as the wet
//! fallback on touch devices (a wet finger can't tap, but can press a button).
//!
//! Geometry adapts from the passed width/height (no device hardcoding). The two
//! vívoactive-5 buttons sit at roughly 2 o'clock (top-right) and 4 o'clock
//! (bottom-right); angles use the Graphics arc convention (0 deg = 3 o'clock,
//! degrees increase counter-clockwise).
module ButtonHints {

    // Button centre angles (degrees) and the half-span of each arc.
    const TOP_DEG = 60;      // ~2 o'clock
    const BOTTOM_DEG = 300;  // ~4 o'clock
    const HALF_SPAN = 22;

    const GREEN = 0x00C853;
    const GREEN_DIM = 0x0A3A1E;
    const RED = 0xE53935;
    const RED_DIM = 0x3A1210;

    // Glyphs.
    enum {
        GLYPH_NEXT,     // right-pointing triangle
        GLYPH_SELECT,   // filled dot
        GLYPH_STOP,     // filled square
        GLYPH_TICK,     // check
        GLYPH_CROSS     // x
    }

    //! Top-right: advance the highlight ("Next").
    function drawNext(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number) as Void {
        _hint(dc, w, h, true, GREEN, GREEN_DIM, GLYPH_NEXT);
    }

    //! Bottom-right: commit the highlight ("Select"). Turns red with a stop mark
    //! when the End/Exit tile is the target, so the destructive commit reads.
    function drawSelect(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, destructive as Lang.Boolean) as Void {
        if (destructive) {
            _hint(dc, w, h, false, RED, RED_DIM, GLYPH_STOP);
        } else {
            _hint(dc, w, h, false, GREEN, GREEN_DIM, GLYPH_SELECT);
        }
    }

    //! Confirm-end screen: green tick top-right, red cross bottom-right.
    function drawConfirm(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number) as Void {
        _hint(dc, w, h, true, GREEN, GREEN_DIM, GLYPH_TICK);
    }

    function drawCancel(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number) as Void {
        _hint(dc, w, h, false, RED, RED_DIM, GLYPH_CROSS);
    }

    //! Draw one arc+glyph. `atTop` picks the top-right vs bottom-right button.
    function _hint(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number,
                   atTop as Lang.Boolean, color as Lang.Number, dim as Lang.Number,
                   glyph as Lang.Number) as Void {
        var cx = w / 2;
        var cy = h / 2;
        var penMain = (w * 0.020 + 2).toNumber();
        var penGlow = penMain * 2;
        var r = (w / 2) - penGlow;
        var mid = atTop ? TOP_DEG : BOTTOM_DEG;
        var start = mid - HALF_SPAN;
        var end = mid + HALF_SPAN;

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
        var rad = mid * Math.PI / 180.0;
        var rg = r - penGlow - (w * 0.045);
        var gx = (cx + rg * Math.cos(rad)).toNumber();
        var gy = (cy - rg * Math.sin(rad)).toNumber();
        var s = (w * 0.045).toNumber();
        _glyph(dc, glyph, gx, gy, s, color);
    }

    function _glyph(dc as Graphics.Dc, glyph as Lang.Number, cx as Lang.Number, cy as Lang.Number,
                    s as Lang.Number, color as Lang.Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        if (glyph == GLYPH_NEXT) {
            dc.fillPolygon([[cx - s / 2, cy - s], [cx - s / 2, cy + s], [cx + s, cy]]);
        } else if (glyph == GLYPH_SELECT) {
            dc.fillCircle(cx, cy, (s * 0.75).toNumber());
        } else if (glyph == GLYPH_STOP) {
            dc.fillRectangle(cx - s, cy - s, 2 * s, 2 * s);
        } else if (glyph == GLYPH_TICK) {
            dc.setPenWidth((s * 0.4).toNumber() + 1);
            dc.drawLine(cx - s, cy, cx - s * 0.2, cy + s * 0.8);
            dc.drawLine(cx - s * 0.2, cy + s * 0.8, cx + s, cy - s);
            dc.setPenWidth(1);
        } else if (glyph == GLYPH_CROSS) {
            dc.setPenWidth((s * 0.4).toNumber() + 1);
            dc.drawLine(cx - s, cy - s, cx + s, cy + s);
            dc.drawLine(cx - s, cy + s, cx + s, cy - s);
            dc.setPenWidth(1);
        }
    }
}
