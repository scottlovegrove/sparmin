import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Activity;
import Toybox.System;
import Toybox.Timer;
import Toybox.Time;

//! Home screen: renders IDLE / TRANSITION / IN_ACTIVITY (§9 views 1–2). The
//! activity strip sits at the top; master + activity timers and live HR below.
//! Custom-drawn so one view adapts to both round displays. A 1 s timer refreshes
//! the display and folds the live HR sample into the open activity lap.
class StripView extends WatchUi.View {
    private var _session as SessionManager;
    private var _ctrl as StripController;
    private var _timer as Timer.Timer?;
    private var _animTimer as Timer.Timer?;
    private var _visualStart as Lang.Float = 0.0;  // eased window position, in tiles
    private var _hrDisplay;                // Number or null
    private var _isTouch as Lang.Boolean;
    private var _w as Lang.Number = 0;
    private var _h as Lang.Number = 0;
    private var _cursorShown as Lang.Boolean = false; // reveal the focus ring on touch after a button press
    private var _is24Hour as Lang.Boolean = true;     // device clock preference, for the header time
    private var _backNoteMs as Lang.Number = 0;       // when the last back-swipe was swallowed (0 = none)

    //! How long the swallowed-back-swipe note stays up (ms).
    const BACK_NOTE_MS = 2000;

    function initialize(session as SessionManager) {
        View.initialize();
        _session = session;
        _hrDisplay = null;
        var settings = System.getDeviceSettings();
        _isTouch = settings.isTouchScreen;
        _is24Hour = settings.is24Hour;
        var tiles = _isTouch ? 4 : 3;      // roomy tiles: VA5 4, FR745 3 (§2)
        _ctrl = new StripController(ActivityConfig.load(), tiles, _isTouch);
    }

    function getController() as StripController { return _ctrl; }
    function isTouch() as Lang.Boolean { return _isTouch; }
    function getSession() as SessionManager { return _session; }

    //! Reveal the focus ring on touch devices (after the first Next button press),
    //! so the button cursor is visible without cluttering pure-touch use.
    function revealCursor() as Void { _cursorShown = true; }

    //! Whether the button cursor is live (the user has started cycling with Next).
    //! Until it is, the bottom-right button keeps its conventional Back meaning.
    function isCursorShown() as Lang.Boolean { return _cursorShown; }

    //! Flash a note after a back-swipe was swallowed mid-session (StripDelegate).
    //! A gesture that silently does nothing reads as a frozen app, which is the
    //! thing we're trying not to look like.
    function noteBackBlocked() as Void {
        _backNoteMs = System.getTimer();
        WatchUi.requestUpdate();
    }


    function onShow() as Void {
        // Pick up any activity-config changes made on the config screen.
        _ctrl.reload(ActivityConfig.load());
        // The clock format is a device setting the user can change under us.
        _is24Hour = System.getDeviceSettings().is24Hour;
        // A finished/discarded session lands back at IDLE — drop the button cursor
        // so no stray focus ring lingers on the start screen.
        if (_session.getState() == STATE_IDLE) {
            _cursorShown = false;
        }
        _visualStart = _ctrl.windowStart.toFloat();
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
        _stopAnim();
    }

    function onTick() as Void {
        var info = Activity.getActivityInfo();
        _session.foldHr(HrSampler.currentForStats(info));   // ignored unless IN_ACTIVITY
        _hrDisplay = HrSampler.currentForDisplay(info);
        WatchUi.requestUpdate();
    }

    //! Ease the strip toward the controller's current window. Called by the
    //! delegate after a swipe / focus move. A large jump (wrap-around) snaps.
    function animateToWindow() as Void {
        var target = _ctrl.windowStart.toFloat();
        if (_absf(_visualStart - target) > _ctrl.visibleCount + 1) {
            _visualStart = target;
            _stopAnim();
            WatchUi.requestUpdate();
            return;
        }
        if (_animTimer == null) {
            _animTimer = new Timer.Timer();
            _animTimer.start(method(:onAnimTick), 33, true);
        }
        WatchUi.requestUpdate();
    }

    function onAnimTick() as Void {
        var target = _ctrl.windowStart.toFloat();
        var diff = target - _visualStart;
        if (_absf(diff) < 0.04) {
            _visualStart = target;
            _stopAnim();
        } else {
            _visualStart += diff * 0.35;   // exponential ease-out
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

    // ---- Touch drag scrolling (finger-tracking, then snap) ----

    function getVisualStart() as Lang.Float {
        return _visualStart;
    }

    //! Pixels per tile (tile width + gap) — converts a drag delta to tiles.
    function stepPx() as Lang.Float {
        return _stripTileW(_ctrl.visibleCount) + _stripGap();
    }

    //! Begin a drag: cancel any running snap animation so it tracks the finger.
    function beginDrag() as Void {
        _stopAnim();
    }

    //! Move the strip to an unsnapped position while the finger is down.
    function dragTo(visual as Lang.Float) as Void {
        _visualStart = _clampVisual(visual);
        WatchUi.requestUpdate();
    }

    //! On release, snap to the nearest tile and ease into place.
    function snapToNearest() as Void {
        var target = (_visualStart + 0.5).toNumber();
        var maxStart = _maxStart();
        if (target < 0) { target = 0; }
        if (target > maxStart) { target = maxStart; }
        _ctrl.windowStart = target;
        animateToWindow();
    }

    private function _maxStart() as Lang.Number {
        var m = _ctrl.slotCount() - _ctrl.visibleCount;
        return (m < 0) ? 0 : m;
    }

    private function _clampVisual(v as Lang.Float) as Lang.Float {
        if (v < 0.0) {
            return 0.0;
        }
        var maxStart = _maxStart();
        if (v > maxStart) {
            return maxStart.toFloat();
        }
        return v;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        _w = dc.getWidth();
        _h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var state = _session.getState();
        _drawClock(dc);
        _drawStrip(dc, state);
        _drawTimers(dc, state);
        _drawHr(dc, state);
        if (state == STATE_IDLE) {
            _drawHint(dc);
        } else if (_backNoteShowing()) {
            _drawBackNote(dc);
        }
    }

    //! Time of day, in the strip's top margin. It's here because leaving the app
    //! to read the watch face is exactly what used to kill a recording — so the
    //! clock has to be inside the app for there to be no reason to leave.
    private function _drawClock(dc as Graphics.Dc) as Void {
        var t = System.getClockTime();
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _stripTop() / 2, Graphics.FONT_XTINY,
                    Fmt.clock(t.hour, t.min, _is24Hour),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Whether the swallowed-back-swipe note is still within its dwell. The timer
    //! is a free-running millisecond counter that wraps, so a negative age means
    //! it wrapped — treat that as expired rather than showing the note forever.
    private function _backNoteShowing() as Lang.Boolean {
        if (_backNoteMs == 0) {
            return false;
        }
        var age = System.getTimer() - _backNoteMs;
        if (age < 0 || age >= BACK_NOTE_MS) {
            _backNoteMs = 0;
            return false;
        }
        return true;
    }

    private function _drawBackNote(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * 0.93, Graphics.FONT_XTINY, "Use End to finish",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! True when a tap lands on the idle footer (the "Edit activities" target).
    function isFooterTap(coords as Lang.Array) as Lang.Boolean {
        var y = coords[1];
        return y > _h * 0.72 && y < _h * 0.93;
    }

    // Strip geometry, shared by drawing and hit-testing so taps always line up.
    // Tiles are inset from the round bezel with gaps between them.
    private function _stripMargin() as Lang.Float { return _w * 0.05; }
    private function _stripGap() as Lang.Float { return _w * 0.02; }
    private function _stripTop() as Lang.Float { return _h * 0.14; }
    private function _stripTileH() as Lang.Float { return _h * 0.24; }
    private function _stripTileW(n as Lang.Number) as Lang.Float {
        return (_w - 2 * _stripMargin() - (n - 1) * _stripGap()) / n;
    }

    //! Map a tapped point to the activityId under it, or null if outside the
    //! strip. Uses the same eased geometry as drawing so taps match what's shown.
    function activityIdAtPoint(coords as Lang.Array) {
        return _ctrl.idAtIndex(_slotIndexAtPoint(coords));
    }

    //! True when a tap lands on the trailing End/Exit tile.
    function isEndTileAtPoint(coords as Lang.Array) as Lang.Boolean {
        return _ctrl.isEndIndex(_slotIndexAtPoint(coords));
    }

    //! Absolute slot index under a tapped point, or -1. Uses the same eased
    //! geometry as drawing so taps match what's shown.
    private function _slotIndexAtPoint(coords as Lang.Array) as Lang.Number {
        if (_w == 0) { return -1; }
        var n = _ctrl.visibleCount;
        if (n <= 0) { return -1; }
        var top = _stripTop();
        var tileH = _stripTileH();
        var tileW = _stripTileW(n);
        var step = tileW + _stripGap();
        var x = coords[0];
        var y = coords[1];
        if (y < top || y > top + tileH) { return -1; }
        var first = _visualStart.toNumber() - 1;
        var last = _visualStart.toNumber() + n + 1;
        for (var i = first; i <= last; i += 1) {
            if (i < 0 || i >= _ctrl.slotCount()) { continue; }
            var tx = _stripMargin() + (i - _visualStart) * step;
            if (x >= tx && x <= tx + tileW) {
                return i;
            }
        }
        return -1;
    }

    private function _drawStrip(dc as Graphics.Dc, state) as Void {
        var n = _ctrl.visibleCount;
        if (n <= 0) { return; }
        var top = _stripTop();
        var tileH = _stripTileH();
        var tileW = _stripTileW(n);
        var step = tileW + _stripGap();
        var activeId = _session.getActiveActivityId();
        var showCursor = (!_isTouch || _cursorShown);
        // Render one extra tile each side so partials slide in during animation.
        var first = _visualStart.toNumber() - 1;
        var last = _visualStart.toNumber() + n + 1;
        for (var i = first; i <= last; i += 1) {
            if (i < 0 || i >= _ctrl.slotCount()) { continue; }
            var x = _stripMargin() + (i - _visualStart) * step;
            if (x + tileW < 0 || x > _w) { continue; }   // fully off-screen
            var isFocused = (showCursor && i == _ctrl.focusedIndex);

            if (_ctrl.isEndIndex(i)) {
                _drawEndTile(dc, x, top, tileW, tileH, isFocused, state);
                continue;
            }

            var id = _ctrl.idAtIndex(i);
            if (id == null) { continue; }
            var isActive = (activeId != null && activeId.equals(id));

            // Dark tiles so the icons (designed on near-black) stay legible; the
            // active activity gets a lighter blue-grey fill.
            dc.setColor(isActive ? 0x2D5A78 : 0x1C2128, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x, top, tileW, tileH, 8);

            if (isFocused) {
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(3);
                dc.drawRoundedRectangle(x, top, tileW, tileH, 8);
                dc.setPenWidth(1);
            }

            var bmp = ActivityIcons.bitmapFor(id);
            if (bmp != null) {
                dc.drawBitmap(x + (tileW - bmp.getWidth()) / 2,
                              top + (tileH - bmp.getHeight()) / 2, bmp);
            } else {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(x + tileW / 2, top + tileH / 2, Graphics.FONT_XTINY, SpaActivity.shortFor(id),
                            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }

        // Scroll chevrons in the side margins when there are more tiles.
        var midY = top + tileH / 2;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        if (_ctrl.windowStart > 0) {
            dc.drawText(2, midY, Graphics.FONT_XTINY, "<", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        if (_ctrl.windowStart + n < _ctrl.slotCount()) {
            dc.drawText(_w - 2, midY, Graphics.FONT_XTINY, ">", Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    //! The trailing End/Exit tile (touch wet-fallback cursor target): red so it
    //! reads as the terminating action. "End" mid-session, "Exit" at idle — where
    //! it's how you leave the app once the button cursor has claimed Back.
    private function _drawEndTile(dc as Graphics.Dc, x, top, tileW, tileH, isFocused as Lang.Boolean, state) as Void {
        dc.setColor(0x5A2222, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(x, top, tileW, tileH, 8);
        if (isFocused) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            dc.drawRoundedRectangle(x, top, tileW, tileH, 8);
            dc.setPenWidth(1);
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + tileW / 2, top + tileH / 2, Graphics.FONT_XTINY,
                    (state == STATE_IDLE) ? "Exit" : "End",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // The big timer and the name/label fonts are fixed-pixel Garmin fonts, so on
    // a small screen (208px) they eat too much height and collide, and on a large
    // AMOLED (454px) they look undersized. Scale the tier by screen width. The
    // 240px (FR745) and 390px (vívoactive 5) primaries keep their original tiers
    // (NUMBER_MEDIUM / TINY), so their layout is unchanged.
    private function _numFont() as Graphics.FontDefinition {
        if (_w >= 416) { return Graphics.FONT_NUMBER_HOT; }
        if (_w >= 232) { return Graphics.FONT_NUMBER_MEDIUM; }
        return Graphics.FONT_NUMBER_MILD;
    }
    private function _labelFont() as Graphics.FontDefinition {
        return (_w >= 240) ? Graphics.FONT_TINY : Graphics.FONT_XTINY;
    }

    private function _drawTimers(dc as Graphics.Dc, state) as Void {
        var now = Time.now().value();
        if (state == STATE_IDLE) {
            // Name the focused tile (button devices) so icon-only tiles are
            // identifiable as the focus cursor moves across them.
            if (!_isTouch) {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(_w / 2, _h * 0.46, _labelFont(), _focusedName(),
                            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, _numFont(), "00:00",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }
        if (state == STATE_IN_ACTIVITY) {
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.46, _labelFont(), SpaActivity.nameFor(_session.getActiveActivityId()),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, _numFont(),
                        Fmt.duration(_session.activityElapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.71, Graphics.FONT_XTINY,
                        "Total " + Fmt.duration(_session.elapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            // TRANSITION: name the focused tile (buttons), or note the between-
            // activities state (touch, which has no focus cursor).
            var label = _isTouch ? "Between activities" : _focusedName();
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.46, _labelFont(), label,
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(_w / 2, _h * 0.58, _numFont(),
                        Fmt.duration(_session.elapsedSeconds(now)),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    //! Name of the currently focused tile (button devices), or "" if none.
    private function _focusedName() as Lang.String {
        var id = _ctrl.focusedId();
        return (id != null) ? SpaActivity.nameFor(id) : "";
    }

    private function _drawHr(dc as Graphics.Dc, state) as Void {
        if (state == STATE_IDLE) { return; }
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, _h * 0.83, Graphics.FONT_TINY, "HR " + Fmt.hr(_hrDisplay),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function _drawHint(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var msg;
        if (!_isTouch) {
            msg = "Select an activity to start";
        } else if (TouchConfig.isWaterSafe()) {
            // Water-safe touch requires a deliberate double tap to actuate a tile.
            msg = "Double-tap an activity to start";
        } else {
            msg = "Tap an activity to start";
        }
        // ≥240px keeps the original 0.68h line. On smaller screens the fixed 0.68/
        // 0.58 gap is too tight for the number glyph, so anchor the hint just below
        // the actual timer height instead of colliding with it.
        var hintY = _h * 0.68;
        if (_w < 240) {
            var below = _h * 0.58 + dc.getFontHeight(_numFont()) / 2
                        + dc.getFontHeight(Graphics.FONT_XTINY) / 2 + _h * 0.005;
            if (below > hintY) { hintY = below; }
        }
        dc.drawText(_w / 2, hintY, Graphics.FONT_XTINY, msg,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Footer: settings affordance (tap target on touch; Menu on buttons).
        var fy = (_h * 0.82).toNumber();
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(_w * 0.24, fy - _h * 0.055, _w * 0.52, _h * 0.11, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(_w / 2, fy, Graphics.FONT_XTINY, "Settings",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
