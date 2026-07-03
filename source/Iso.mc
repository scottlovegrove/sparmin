import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

//! ISO-8601 UTC formatting for the backend payload timestamps.
module Iso {

    //! Format epoch seconds as e.g. "2026-07-03T15:30:00Z". Returns null for a
    //! null input (open/absent timestamps stay null in the payload).
    function fromEpoch(epochSeconds) {
        if (epochSeconds == null) {
            return null;
        }
        var info = Gregorian.utcInfo(new Time.Moment(epochSeconds), Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d"),
            info.hour.format("%02d"),
            info.min.format("%02d"),
            info.sec.format("%02d")
        ]);
    }
}
