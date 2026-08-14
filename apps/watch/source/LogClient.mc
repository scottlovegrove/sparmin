import Toybox.Lang;
import Toybox.Application;
import Toybox.Communications;
import Toybox.PersistedContent;
import Toybox.System;

//! Ships the diagnostic log to the companion, so it can be read with real dates
//! on a real screen instead of a line at a time on a wrist.
//!
//! Deliberately *not* `(:background)`. The background process exists to drain the
//! session queue inside a thirty-second window on a 32 KB pool, and a diagnostic
//! upload has no business competing with a session for either. Uploading on launch
//! is enough for what this is for: the buffer outlives the process, so the trail
//! from a run that ended badly goes up as soon as the app is opened again — which
//! is exactly the case that has no crash log to read.
class LogClient {

    //! The last sequence number known to have reached the companion. A sequence
    //! rather than a timestamp: two lines can share a second, and a cursor that
    //! cannot tell them apart drops one of them.
    const CURSOR_KEY = "logSentSeq";

    private var _pending;   // cursor this upload will commit to, or null when idle

    function initialize() {
        _pending = null;
    }

    //! Send whatever the companion has not seen. Does nothing when there is
    //! nothing new, no phone, or no account to send it to.
    function upload() as Void {
        if (_pending != null || !LinkConfig.isLinked()) {
            return;
        }
        if (!System.getDeviceSettings().phoneConnected) {
            return;
        }
        var entries = WatchLog.since(sentSeq());
        if (entries.size() == 0) {
            return;
        }

        var lines = [];
        var cursor = sentSeq();
        for (var i = 0; i < entries.size(); i += 1) {
            var entry = entries[i];
            lines.add({
                "at" => Iso.fromEpoch(WatchLog.epochOf(entry)),
                "text" => WatchLog.textOf(entry)
            });
            var seq = WatchLog.seqOf(entry);
            if (seq > cursor) {
                cursor = seq;
            }
        }

        _pending = cursor;
        Communications.makeWebRequest(
            Backend.URL + "/api/device-logs",
            { "appVersion" => Version.APP, "lines" => lines },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => {
                    "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                    "Authorization" => "Bearer " + LinkConfig.token()
                },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onResponse)
        );
    }

    //! Public so `method(:onResponse)` can reach it; not for callers.
    //!
    //! The cursor moves only on a success. Anything else leaves it where it was,
    //! so the same lines go again next launch — the companion collapses a repeat,
    //! and re-sending a line costs nothing next to losing the one line that
    //! explained what happened.
    function onResponse(
        responseCode as Lang.Number,
        data as Null or Lang.Dictionary or Lang.String or PersistedContent.Iterator
    ) as Void {
        var cursor = _pending;
        _pending = null;

        if (responseCode == 200 || responseCode == 201) {
            Application.Storage.setValue(CURSOR_KEY, cursor);
            return;
        }
        // Logged rather than surfaced: this is diagnostics, and a wearer who
        // cannot upload a log has nothing to do about it. The line itself goes up
        // with the next attempt.
        WatchLog.add("logs: upload failed " + responseCode);
    }

    //! How far the companion has been brought up to date.
    function sentSeq() as Lang.Number {
        var stored = Application.Storage.getValue(CURSOR_KEY);
        return (stored instanceof Lang.Number) ? stored : 0;
    }
}
