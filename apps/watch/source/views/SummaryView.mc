import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Timer;

//! Read-only end-of-session summary (§5 SUMMARY). One row per activity, in the
//! order each was *first* visited: its icon on the left, the name aligned to the
//! icon's top, and every visit's duration listed underneath. A repeat visit does
//! not get its own row — it appears as another time under the first, so the row
//! order reads as the route you actually walked.
//!
//! Scrolls by pixels (rows vary in height with the number of visits). The FIT
//! file has already been saved on confirm.
class SummaryView extends WatchUi.View {
    private var _stripView as StripView;
    private var _session as SessionManager;
    private var _scroll as Lang.Float = 0.0;      // pixels scrolled past the top (eased)
    private var _target as Lang.Float = 0.0;      // where the scroll is heading
    private var _contentH as Lang.Number = 0;     // total drawn height, for clamping
    private var _animTimer as Timer.Timer?;
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    function initialize(stripView as StripView) {
        View.initialize();
        _stripView = stripView;
        _session = stripView.getSession();
    }

    function getStripView() as StripView { return _stripView; }
    function getSession() as SessionManager { return _session; }

    function onHide() as Void {
        _stopAnim();
    }

    //! Scroll by a notch (a button press or swipe). The step is one row, and the
    //! view eases toward it rather than jumping — a hard jump of a third of the
    //! screen reads as a lurch.
    function scroll(delta as Lang.Number) as Void {
        _target = _clamp(_target + delta * _rowStep());
        if (_animTimer == null) {
            _animTimer = new Timer.Timer();
            _animTimer.start(method(:onAnimTick), 33, true);
        }
        WatchUi.requestUpdate();
    }

    //! Drag the list directly with a finger (touch): 1:1, no easing.
    function dragBy(dy as Lang.Number) as Void {
        _target = _clamp(_target - dy);
        _scroll = _target;
        _stopAnim();
        WatchUi.requestUpdate();
    }

    function onAnimTick() as Void {
        var diff = _target - _scroll;
        if (_absf(diff) < 1.0) {
            _scroll = _target;
            _stopAnim();
        } else {
            _scroll += diff * 0.35;   // exponential ease-out, as the strip uses
        }
        WatchUi.requestUpdate();
    }

    private function _stopAnim() as Void {
        if (_animTimer != null) {
            _animTimer.stop();
            _animTimer = null;
        }
    }

    private function _absf(v as Lang.Float) as Lang.Float {
        return v < 0.0 ? -v : v;
    }

    //! One notch = roughly one row, so a press advances the list predictably.
    private function _rowStep() as Lang.Float {
        return _h * 0.22;
    }

    private function _clamp(v as Lang.Float) as Lang.Float {
        var maxScroll = _contentH - _h + (_h * 0.10);   // a little breathing room
        if (maxScroll < 0) {
            maxScroll = 0.0;
        }
        if (v > maxScroll) {
            v = maxScroll.toFloat();
        }
        if (v < 0.0) {
            v = 0.0;
        }
        return v;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        // The rows scroll under the pinned header, which is drawn last, over them.
        var origin = (_h * 0.20).toNumber();
        var top = origin - _scroll.toNumber();
        var y = _drawBody(dc, top);
        _contentH = (y - top) + origin;   // full height in content space

        _drawHeader(dc);
    }

    //! Pinned header: the session total, on a band the rows scroll under.
    private function _drawHeader(dc as Graphics.Dc) as Void {
        var bandH = (_h * 0.17).toNumber();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.fillRectangle(0, 0, _w, bandH);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, bandH / 2, Graphics.FONT_TINY,
                    Fmt.duration(_session.totalSeconds()),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Draw each activity row from `y` down; returns the y after the last one.
    private function _drawBody(dc as Graphics.Dc, y as Lang.Number) as Lang.Number {
        var aggs = _session.activityAggregates();
        for (var i = 0; i < aggs.size(); i += 1) {
            y = _drawRow(dc, aggs[i], y);
        }
        return _drawTransitions(dc, y);
    }

    //! One activity: icon left, name aligned to its top, each visit's time under
    //! the name. Returns the y below the row.
    private function _drawRow(dc as Graphics.Dc, agg as ActivityAggregate, y as Lang.Number) as Lang.Number {
        var pad = (_w * 0.06).toNumber();
        var nameFont = Graphics.FONT_XTINY;
        var timeFont = Graphics.FONT_XTINY;
        var nameH = dc.getFontHeight(nameFont);
        var timeH = dc.getFontHeight(timeFont);

        var bmp = ActivityIcons.bitmapFor(agg.activityId);
        var iconW = (bmp != null) ? bmp.getWidth() : 0;
        var iconH = (bmp != null) ? bmp.getHeight() : 0;
        // Icons are family-sized for the strip's tiles, which is chunky here — keep
        // the text column clear of it rather than scaling (CIQ can't scale bitmaps).
        var textX = pad + iconW + (_w * 0.04).toNumber();

        var rowH = nameH + timeH;      // name + the single times line
        if (iconH > rowH) {
            rowH = iconH;
        }

        // Skip rows scrolled fully off-screen (cheap, and keeps long lists smooth).
        if (y + rowH < 0 || y > _h) {
            return y + rowH + (_h * 0.03).toNumber();
        }

        if (bmp != null) {
            dc.drawBitmap(pad, y, bmp);
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(textX, y, nameFont, agg.displayName, Graphics.TEXT_JUSTIFY_LEFT);

        // Every visit on one line under the name, in the order it happened.
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(textX, y + nameH, timeFont, _visitTimes(agg), Graphics.TEXT_JUSTIFY_LEFT);

        return y + rowH + (_h * 0.03).toNumber();
    }

    //! Each visit's duration, in order, on one line: "12:30 · 04:15".
    private function _visitTimes(agg as ActivityAggregate) as Lang.String {
        var segs = agg.segments as Lang.Array;
        var out = "";
        for (var i = 0; i < segs.size(); i += 1) {
            if (i > 0) {
                out += " · ";
            }
            out += Fmt.duration(segs[i].durationSeconds());
        }
        return out;
    }

    private function _drawTransitions(dc as Graphics.Dc, y as Lang.Number) as Lang.Number {
        var font = Graphics.FONT_XTINY;
        if (y > -dc.getFontHeight(font) && y < _h) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, y, font,
                        "Transitions  " + Fmt.duration(_session.transitionSeconds()),
                        Graphics.TEXT_JUSTIFY_CENTER);
        }
        return y + dc.getFontHeight(font);
    }
}
