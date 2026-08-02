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

    //! Time of day as "hh:mm" (24-hour) or "h:mm" (12-hour, no suffix — the
    //! glanceable digits are the point, and nobody is unsure which half of the
    //! day they are in). Pure: the caller passes System.getClockTime() values and
    //! the device's own 24-hour setting, so this stays testable off-device.
    function clock(hour, minute, is24Hour) as Lang.String {
        var h = hour.toNumber();
        if (is24Hour) {
            return Lang.format("$1$:$2$", [h.format("%02d"), minute.format("%02d")]);
        }
        h = h % 12;
        if (h == 0) {
            h = 12;
        }
        return Lang.format("$1$:$2$", [h.format("%d"), minute.format("%02d")]);
    }

    //! Heart rate as an integer string, "--" when null.
    function hr(value) as Lang.String {
        if (value == null) {
            return "--";
        }
        return value.format("%d");
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    //! A short date, "2 Aug 2026", from a Gregorian day/month/year. Pure — the
    //! caller does the `Gregorian.info()` call — so it stays testable off-device.
    //!
    //! The year is always shown. A watch may sit linked for years, and "2 Aug"
    //! on its own is read as *this* August by anyone glancing at it.
    function date(day, month, year) as Lang.String {
        if (day == null || month == null || year == null) {
            return "";
        }
        var index = month.toNumber() - 1;
        if (index < 0 || index >= MONTHS.size()) {
            return "";
        }
        return Lang.format("$1$ $2$ $3$", [
            day.format("%d"),
            MONTHS[index],
            year.format("%04d")
        ]);
    }
}
