import Toybox.Lang;
import Toybox.Application;
import Toybox.System;

//! A small diagnostic log that survives a restart, so a failure that happened in
//! a changing room can be read back afterwards instead of reproduced.
//!
//! Connect IQ gives an app no way to write a file a computer can read: the only
//! thing that reaches GARMIN/APPS/LOGS/ over USB is CIQ_LOG.YML, which the system
//! writes when an app crashes. So the log lives in Application.Storage and is
//! read on the watch, via Settings -> Diagnostics.
//!
//! `System.println` is kept alongside it for the simulator, where it is the
//! quickest thing to watch while developing.
//!
//! `(:background)`: a retry that only ever runs while nobody is looking is
//! exactly the thing that needs to leave a trace.
(:background)
module WatchLog {

    const STORAGE_KEY = "log";
    //! Enough to hold a whole link attempt and a session's worth of queue
    //! activity, and small enough that persisting it stays cheap.
    const MAX_LINES = 40;
    //! Bounds one entry so a long error can't crowd out the history around it,
    //! which is usually the part that explains it.
    const MAX_LINE = 96;

    //! Record one thing that happened. Keep the message short and factual — this
    //! is read on a watch screen.
    function add(message) as Void {
        var line = _stamp() + " " + _clip(message);
        System.println(line);

        var lines = read();
        lines.add(line);
        while (lines.size() > MAX_LINES) {
            lines = lines.slice(1, lines.size()) as Lang.Array;
        }
        Application.Storage.setValue(STORAGE_KEY, lines);
    }

    //! The log, oldest first. Always an array, whatever is in the store.
    function read() as Lang.Array {
        var stored = Application.Storage.getValue(STORAGE_KEY);
        if (stored instanceof Lang.Array) {
            return stored as Lang.Array;
        }
        return [];
    }

    function clear() as Void {
        Application.Storage.deleteValue(STORAGE_KEY);
    }

    //! Time of day only. The date is rarely the question, and two more fields
    //! would cost more of the line than they are worth.
    function _stamp() as Lang.String {
        var now = System.getClockTime();
        return Lang.format("$1$:$2$:$3$", [
            now.hour.format("%02d"),
            now.min.format("%02d"),
            now.sec.format("%02d")
        ]);
    }

    function _clip(message) as Lang.String {
        var text = (message == null) ? "null" : message.toString();
        if (text.length() > MAX_LINE) {
            return text.substring(0, MAX_LINE) as Lang.String;
        }
        return text;
    }
}
