import Toybox.Lang;

//! Small display formatting helpers for the views.
module Fmt {

    //! Duration as m:ss (or h:mm:ss past an hour). "--:--" for null.
    function duration(totalSeconds) as Lang.String {
        if (totalSeconds == null) {
            return "--:--";
        }
        var s = totalSeconds.toNumber();
        if (s < 0) {
            s = 0;
        }
        var h = s / 3600;
        var m = (s % 3600) / 60;
        var sec = s % 60;
        if (h > 0) {
            return Lang.format("$1$:$2$:$3$", [h.format("%d"), m.format("%02d"), sec.format("%02d")]);
        }
        return Lang.format("$1$:$2$", [m.format("%02d"), sec.format("%02d")]);
    }

    //! Heart rate as an integer string, "--" when null.
    function hr(value) as Lang.String {
        if (value == null) {
            return "--";
        }
        return value.format("%d");
    }
}
