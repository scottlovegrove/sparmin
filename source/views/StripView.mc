import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Activity;
import Toybox.System;
import Toybox.Timer;
import Toybox.Time;

//! Home screen: renders IDLE / TRANSITION / STATION_ACTIVE (§9 views 1–2). The
//! station strip sits at the top; master + station timers and live HR below.
//! Custom-drawn so one view adapts to both round displays. A 1 s timer refreshes
//! the display and folds the live HR sample into the open station lap.
class StripView extends WatchUi.View {
    private var _session as SessionManager;
    private var _ctrl as StripController;
    private var _timer as Timer.Timer?;
    private var _hrDisplay;                // Number or null
    private var _isTouch as Lang.Boolean;
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;

    function initialize(session as SessionManager) {
        View.initialize();
        _session = session;
        _hrDisplay = null;
        _isTouch = System.getDeviceSettings().isTouchScreen;
        var tiles = _isTouch ? 5 : 3;      // VA5 fits 5, FR745 3 (§2)
        _ctrl = new StripController(StationConfig.load(), tiles);
    }

    function getController() as StripController { return _ctrl; }
    function isTouch() as Lang.Boolean { return _isTouch; }
    function getSession() as SessionManager { return _session; }

    function onShow() as Void {
        // Pick up any station-config changes made on the config screen.
        _ctrl.reload(StationConfig.load());
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        var info = Activity.getActivityInfo();
        _session.foldHr(HrSampler.currentForStats(info));   // ignored unless STATION_ACTIVE
        _hrDisplay = HrSampler.currentForDisplay(info);
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var state = _session.getState();
        _drawStrip(dc, state);
        _drawTimers(dc, state);
        _drawHr(dc, state);
        if (state == STATE_IDLE) {
            _drawHint(dc);
        }
    }

    //! True when a tap lands on the idle footer (the "Edit stations" target).
    function isFooterTap(coords as Lang.Array) as Lang.Boolean {
        var y = coords[1];
        return y > _h * 0.72 && y < _h * 0.93;
    }

    //! Map a tapped point to the stationId under it, or null if outside the strip.
    function stationIdAtPoint(coords as Lang.Array) {
        if (_w == 0) { return null; }
        var n = _ctrl.visibleCount;
        if (n <= 0) { return null; }
        var top = (_h * 0.13).toNumber();
        var tileH = (_h * 0.26).toNumber();
        var y = coords[1];
        if (y < top || y > top + tileH) { return null; }
        var tileW = _w / n;
        var k = coords[0] / tileW;
        if (k < 0 || k >= n) { return null; }
        return _ctrl.idAtSlot(k);
    }

    private function _drawStrip(dc as Graphics.Dc, state) as Void {
        var n = _ctrl.visibleCount;
        if (n <= 0) { return; }
        var tileW = _w / n;
        var tileH = (_h * 0.26).toNumber();
        var top = (_h * 0.13).toNumber();
        var pad = 4;
        var activeId = _session.getActiveStationId();
        for (var k = 0; k < n; k += 1) {
            var id = _ctrl.idAtSlot(k);
            if (id == null) { continue; }
            var x = k * tileW;
            var isActive = (activeId != null && activeId.equals(id));
            var isFocused = (!_isTouch && (_ctrl.windowStart + k) == _ctrl.focusedIndex);

            dc.setColor(isActive ? Graphics.COLOR_BLUE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x + pad, top, tileW - 2 * pad, tileH, 6);

            if (isFocused) {
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(3);
                dc.drawRoundedRectangle(x + pad, top, tileW - 2 * pad, tileH, 6);
                dc.setPenWidth(1);
            }

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(x + tileW / 2, top + tileH / 2, Graphics.FONT_XTINY, Station.shortFor(id),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Scroll chevrons when there are more tiles beyond the window.
        var midY = top + tileH / 2;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        if (_ctrl.windowStart > 0) {
            dc.drawText(2, midY, Graphics.FONT_XTINY, "<", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        if (_ctrl.windowStart + n < _ctrl.count()) {
            dc.drawText(_w - 2, midY, Graphics.FONT_XTINY, ">", Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    private function _drawTimers(dc as Graphics.Dc, state) as Void {
        var now = Time.now().value();
        if (state == STATE_IDLE) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, Graphics.FONT_NUMBER_MEDIUM, "00:00",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }
        if (state == STATE_STATION_ACTIVE) {
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.46, Graphics.FONT_TINY, Station.nameFor(_session.getActiveStationId()),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, Graphics.FONT_NUMBER_MEDIUM,
                        Fmt.duration(_session.stationElapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.71, Graphics.FONT_XTINY,
                        "Total " + Fmt.duration(_session.elapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            // TRANSITION
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.46, Graphics.FONT_TINY, "Between stations",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, Graphics.FONT_NUMBER_MEDIUM,
                        Fmt.duration(_session.elapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    private function _drawHr(dc as Graphics.Dc, state) as Void {
        if (state == STATE_IDLE) { return; }
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * 0.83, Graphics.FONT_TINY, "HR " + Fmt.hr(_hrDisplay),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function _drawHint(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var msg = _isTouch ? "Tap a station to start" : "Select a station to start";
        dc.drawText(_w / 2, _h * 0.68, Graphics.FONT_XTINY, msg,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Footer: edit-stations affordance (tap target on touch; Menu on buttons).
        var fy = (_h * 0.82).toNumber();
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(_w * 0.24, fy - _h * 0.055, _w * 0.52, _h * 0.11, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, fy, Graphics.FONT_XTINY, "Edit stations",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
