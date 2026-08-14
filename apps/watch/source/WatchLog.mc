import Toybox.Lang;
import Toybox.Application;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

//! A small diagnostic log that survives a restart, so a failure that happened in
//! a changing room can be read back afterwards instead of reproduced.
//!
//! Connect IQ gives an app no way to write a file a computer can read: the only
//! thing that reaches GARMIN/APPS/LOGS/ over USB is CIQ_LOG.YML, which the system
//! writes when an app *throws*. When the system terminates an app instead — for
//! its memory, or because the watch restarted — nothing is written at all, and
//! this buffer is the only record that the app was ever running. So it lives in
//! Application.Storage, is read on the watch via Settings -> Diagnostics, and is
//! uploaded to the companion by LogClient when there is a phone.
//!
//! Each entry is `[sequence, epochSeconds, text]`. The sequence is what LogClient
//! tracks rather than the timestamp: two lines can share a second, and a cursor
//! that cannot tell them apart either re-sends one for ever or drops one silently.
//!
//! `System.println` is kept alongside it for the simulator, where it is the
//! quickest thing to watch while developing.
//!
//! `(:background)`: a retry that only ever runs while nobody is looking is
//! exactly the thing that needs to leave a trace.
(:background)
module WatchLog {

    const STORAGE_KEY = "log";
    const SEQ_KEY = "logSeq";
    //! Enough to hold a whole link attempt, a session's worth of heartbeats and
    //! the queue activity around them. Bounded rather than generous because the
    //! whole buffer is read into memory on every write, and this module runs in
    //! the background process too, whose pool is 32 KB on the older devices.
    const MAX_LINES = 60;
    //! Bounds one entry so a long error can't crowd out the history around it,
    //! which is usually the part that explains it.
    const MAX_TEXT = 96;

    //! Record one thing that happened. Keep the message short and factual — this
    //! is read on a watch screen.
    function add(message) as Void {
        var at = Time.now().value();
        var text = _clip(message);
        System.println(format(at, text));

        var seq = _nextSeq();
        var entries = read();
        entries.add([seq, at, text]);
        while (entries.size() > MAX_LINES) {
            entries = entries.slice(1, entries.size()) as Lang.Array;
        }
        Application.Storage.setValue(STORAGE_KEY, entries);
    }

    //! The log, oldest first. Always an array, whatever is in the store.
    //!
    //! Entries written before the stamp carried a date are plain strings and are
    //! dropped: there is no date in them to recover, and a diagnostic log that
    //! cannot say which day a line belongs to is what this shape exists to fix.
    function read() as Lang.Array {
        var stored = Application.Storage.getValue(STORAGE_KEY);
        if (!(stored instanceof Lang.Array)) {
            return [];
        }
        var all = stored as Lang.Array;
        var entries = [];
        for (var i = 0; i < all.size(); i += 1) {
            if (_isEntry(all[i])) {
                entries.add(all[i]);
            }
        }
        return entries;
    }

    //! Entries newer than `seq`, oldest first — what LogClient has yet to send.
    function since(seq) as Lang.Array {
        var entries = read();
        var fresh = [];
        for (var i = 0; i < entries.size(); i += 1) {
            if (seqOf(entries[i]) > seq) {
                fresh.add(entries[i]);
            }
        }
        return fresh;
    }

    function seqOf(entry) as Lang.Number {
        return (entry as Lang.Array)[0] as Lang.Number;
    }

    function epochOf(entry) as Lang.Number {
        return (entry as Lang.Array)[1] as Lang.Number;
    }

    function textOf(entry) as Lang.String {
        return (entry as Lang.Array)[2] as Lang.String;
    }

    //! One entry as it is read on the watch.
    function line(entry) as Lang.String {
        return format(epochOf(entry), textOf(entry));
    }

    //! "08-14 09:28:30 app: stopping", in the watch's own local time.
    //!
    //! The date is here because it has to be: without it two lines an hour apart
    //! and two lines a fortnight apart look exactly the same, which is how an
    //! afternoon goes into proving which day a line came from.
    function format(at, text) as Lang.String {
        var info = Gregorian.info(new Time.Moment(at), Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$ $3$:$4$:$5$ $6$", [
            info.month.format("%02d"),
            info.day.format("%02d"),
            info.hour.format("%02d"),
            info.min.format("%02d"),
            info.sec.format("%02d"),
            text
        ]);
    }

    function clear() as Void {
        Application.Storage.deleteValue(STORAGE_KEY);
    }

    //! Monotonic across restarts, because it is what the upload cursor compares
    //! against. It only ever moves forward, so a wrap is not worth guarding: at a
    //! line a second it would take sixty years.
    function _nextSeq() as Lang.Number {
        var stored = Application.Storage.getValue(SEQ_KEY);
        var seq = ((stored instanceof Lang.Number) ? stored : 0) + 1;
        Application.Storage.setValue(SEQ_KEY, seq);
        return seq;
    }

    function _isEntry(value) as Lang.Boolean {
        return value instanceof Lang.Array && (value as Lang.Array).size() == 3;
    }

    function _clip(message) as Lang.String {
        var text = (message == null) ? "null" : message.toString();
        if (text.length() > MAX_TEXT) {
            return text.substring(0, MAX_TEXT) as Lang.String;
        }
        return text;
    }
}
