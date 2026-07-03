import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;

//! Reorder screen (§4a): a classic pick-up / move / drop list that works the
//! same on FR745 buttons and VA5 touch. Select an item to "pick it up", move it
//! with Up/Down (or tap a slot on touch), select again to drop. Order is
//! persisted on exit; it only affects the strip, never recorded data.
class MoveModeView extends WatchUi.View {
    public var ids as Lang.Array;        // working copy of the visible id order
    public var focus as Lang.Number;
    public var picked as Lang.Number;    // index picked up, or -1
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;
    private var _top as Lang.Number = 0;
    private var _lineH as Lang.Number = 1;
    private var _start as Lang.Number = 0;

    function initialize() {
        View.initialize();
        ids = StationConfig.load();
        focus = 0;
        picked = -1;
    }

    //! Up/Down: move the focus, or the picked item if one is held.
    function moveFocus(delta as Lang.Number) as Void {
        if (picked >= 0) {
            var target = picked + delta;
            if (target < 0 || target >= ids.size()) {
                return;
            }
            ids = StationConfig.move(ids, picked, target);
            picked = target;
            focus = target;
        } else {
            focus += delta;
            if (focus < 0) {
                focus = 0;
            }
            if (focus >= ids.size()) {
                focus = ids.size() - 1;
            }
        }
        WatchUi.requestUpdate();
    }

    function togglePick() as Void {
        picked = (picked >= 0) ? -1 : focus;
        WatchUi.requestUpdate();
    }

    function pickAt(idx as Lang.Number) as Void {
        picked = idx;
        focus = idx;
        WatchUi.requestUpdate();
    }

    function dropAt(idx as Lang.Number) as Void {
        if (picked >= 0) {
            ids = StationConfig.move(ids, picked, idx);
        }
        picked = -1;
        focus = idx;
        WatchUi.requestUpdate();
    }

    function save() as Void {
        StationConfig.save(ids);
    }

    function indexAtPoint(coords as Lang.Array) as Lang.Number {
        var y = coords[1];
        var firstTop = _top - _lineH / 2;
        if (y < firstTop) {
            return -1;
        }
        var idx = _start + ((y - firstTop) / _lineH).toNumber();
        return (idx >= 0 && idx < ids.size()) ? idx : -1;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        var hint = (picked >= 0) ? "Move, then select to drop" : "Reorder — select to move";
        dc.drawText(_w / 2, _h * 0.07, Graphics.FONT_XTINY, hint, Graphics.TEXT_JUSTIFY_CENTER);

        _lineH = dc.getFontHeight(Graphics.FONT_XTINY) + 8;
        _top = (_h * 0.20).toNumber();
        var bottom = (_h * 0.92).toNumber();
        var perScreen = ((bottom - _top) / _lineH).toNumber();
        if (perScreen < 1) {
            perScreen = 1;
        }
        _start = (focus >= perScreen) ? (focus - perScreen + 1) : 0;

        var y = _top;
        for (var i = _start; i < ids.size() && i < _start + perScreen; i += 1) {
            if (i == focus) {
                dc.setColor((i == picked) ? Graphics.COLOR_ORANGE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(_w * 0.06, y - _lineH / 2 + 2, _w * 0.88, _lineH - 4, 4);
            }
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, y, Graphics.FONT_XTINY, Station.nameFor(ids[i]),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            y += _lineH;
        }
    }
}
