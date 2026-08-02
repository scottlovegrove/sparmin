import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Timer;
import Toybox.System;

//! Linking this watch to a Sparmin account. Shows a code for the wearer to type
//! into the companion on a phone or laptop, and asks the backend every few
//! seconds whether anyone has approved it yet.
//!
//! Polling only runs while this view is on screen, which sidesteps every Connect
//! IQ background-execution limit: the flow is attended by definition, since
//! somebody is typing the code somewhere else. Ten minutes of five-second polls
//! is a couple of hundred requests, well inside a foreground app's budget.
class LinkView extends WatchUi.View {

    //! Matches the interval the backend hands back, and its `slow_down` guard.
    const POLL_MS = 5000;

    //! Consecutive failed polls before the attempt is abandoned. Three is about
    //! fifteen seconds of nothing working, which is long enough to ride out a
    //! blip and short enough not to leave a dead code on screen.
    const MAX_POLL_FAILURES = 3;

    enum {
        STATE_ASKING,     // waiting for a code to show
        STATE_WAITING,    // code on screen, waiting for approval
        STATE_LINKED,
        STATE_EXPIRED,
        STATE_FAILED,
        STATE_OFFLINE
    }

    private var _state;
    private var _code;
    //! Ticks to sit out before the next poll. The backend answers `slow_down`
    //! when a watch asks again too soon, and answering that by asking again at
    //! the same rate is how a client gets itself throttled indefinitely.
    private var _waitTicks;
    //! Consecutive failed polls. A request over Bluetooth to a phone that is in
    //! someone's locker will fail now and then, and abandoning a ten-minute code
    //! over one blip means retyping it for no reason. Give up only once it is
    //! clearly not working.
    private var _failures;
    private var _client;
    private var _timer;
    private var _isTouch;

    function initialize() {
        View.initialize();
        _state = STATE_ASKING;
        _code = null;
        _waitTicks = 0;
        _failures = 0;
        _timer = null;
        var settings = System.getDeviceSettings();
        _isTouch = settings != null && settings.isTouchScreen;
        _client = new LinkClient(method(:onLinkResult));
    }

    function isTouch() as Lang.Boolean {
        return _isTouch;
    }

    function onShow() as Void {
        if (_state == STATE_ASKING) {
            _client.requestCode();
        }
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), POLL_MS, true);
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        if (_state != STATE_WAITING) {
            return;
        }
        if (_waitTicks > 0) {
            _waitTicks -= 1;
            return;
        }
        _client.poll();
    }

    //! Public so `method(:onLinkResult)` can reach it. Every state the client can
    //! report ends up on screen — a silent failure here is the worst outcome,
    //! because the wearer is standing there waiting for a code.
    function onLinkResult(state, data) as Void {
        if (state.equals("code")) {
            _code = (data as Lang.Dictionary)["userCode"];
            _state = STATE_WAITING;
            _waitTicks = 0;
        } else if (state.equals(LinkClient.SLOW_DOWN)) {
            // Asked to ease off: sit out a tick, so the next attempt is twice as
            // far away as the one that was too soon. Still a proper answer from
            // the backend, so it breaks any run of failures — the count is of
            // consecutive ones.
            _waitTicks += 1;
            _failures = 0;
        } else if (state.equals(LinkClient.PENDING)) {
            // Answered properly, so whatever backoff was in place has served,
            // and whatever went wrong before has evidently passed.
            _waitTicks = 0;
            _failures = 0;
        } else if (state.equals(LinkClient.LINKED)) {
            _state = STATE_LINKED;
        } else if (state.equals(LinkClient.EXPIRED)) {
            _state = STATE_EXPIRED;
        } else if (state.equals(LinkClient.OFFLINE)) {
            _state = STATE_OFFLINE;
        } else if (state.equals(LinkClient.FAILED)) {
            _failures += 1;
            // The code is still valid on the server and the wearer is still
            // looking at it — keep asking. Only a run of failures means the
            // attempt is actually dead.
            if (_state != STATE_WAITING || _failures >= MAX_POLL_FAILURES) {
                _state = STATE_FAILED;
            }
        }
        // Neither of the waiting states changes what is on screen: the code is
        // still the code, and the wearer has nothing to do but wait.
        WatchUi.requestUpdate();
    }

    //! Ask for a fresh code — after an expiry, or a failure worth retrying.
    function retry() as Void {
        _state = STATE_ASKING;
        _code = null;
        _waitTicks = 0;
        _failures = 0;
        WatchUi.requestUpdate();
        _client.requestCode();
    }

    function canRetry() as Lang.Boolean {
        return _state == STATE_EXPIRED || _state == STATE_FAILED || _state == STATE_OFFLINE;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var middle = height / 2;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, middle - _lineHeight(dc) * 2, Graphics.FONT_XTINY,
            "Link account", Graphics.TEXT_JUSTIFY_CENTER);

        if (_state == STATE_WAITING && _code != null) {
            // The code is the whole point of the screen: biggest type that fits.
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, middle - _lineHeight(dc), _codeFont(dc, width),
                _code, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, middle + _lineHeight(dc), Graphics.FONT_XTINY,
                "Enter this in Sparmin", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, middle - _lineHeight(dc) / 2, Graphics.FONT_SMALL,
                _message(), Graphics.TEXT_JUSTIFY_CENTER);
            if (canRetry()) {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, middle + _lineHeight(dc), Graphics.FONT_XTINY,
                    _isTouch ? "Tap to try again" : "Start to try again",
                    Graphics.TEXT_JUSTIFY_CENTER);
            }
        }
    }

    private function _message() as Lang.String {
        if (_state == STATE_ASKING) { return "Asking…"; }
        if (_state == STATE_LINKED) { return "Linked"; }
        if (_state == STATE_EXPIRED) { return "Code expired"; }
        if (_state == STATE_OFFLINE) { return "No phone"; }
        return "Couldn't link";
    }

    //! Candidate fonts for the code, largest first.
    //!
    //! **Text fonts only.** The `FONT_NUMBER_*` tiers are a separate typeface
    //! (Yantramanav on the vívoactive 5, against Roboto for the text tiers) that
    //! carries digits and a couple of stray letters and nothing else. A code is
    //! alphanumeric, so most of its letters have no glyph and are drawn as empty
    //! space: a code beginning `VRYV` reached the watch intact and rendered as
    //! `R -9 F`. Unreadable, and worse, it still looks like a plausible code, so
    //! the wearer types it in and blames the companion.
    private function _codeFonts() as Lang.Array {
        return [
            Graphics.FONT_LARGE,
            Graphics.FONT_MEDIUM,
            Graphics.FONT_SMALL,
            Graphics.FONT_TINY,
            Graphics.FONT_XTINY
        ];
    }

    //! The largest of those the code actually fits inside. Measured rather than
    //! guessed from the screen width: the code is a fixed nine characters, but
    //! glyph widths vary by device, and a code running off the edge is worse than
    //! a small one.
    private function _codeFont(dc as Graphics.Dc, width) {
        // Round screens narrow towards the top, and the code sits a line above
        // the middle — leave a margin rather than measure the chord.
        var room = width * 4 / 5;
        var fonts = _codeFonts();
        for (var i = 0; i < fonts.size() - 1; i += 1) {
            if (dc.getTextWidthInPixels(_code, fonts[i]) <= room) {
                return fonts[i];
            }
        }
        return fonts[fonts.size() - 1];
    }

    private function _lineHeight(dc as Graphics.Dc) {
        return dc.getFontHeight(Graphics.FONT_SMALL);
    }
}
