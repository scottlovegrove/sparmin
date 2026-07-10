import Toybox.Lang;
import Toybox.Activity;
import Toybox.ActivityMonitor;

//! Heart-rate acquisition and validity filtering. Stat folding itself lives on
//! Segment; this module decides what counts as a usable reading.
//!
//! Only the live activity sample feeds per-activity stats. The history fallback
//! is display-only — folding it into stats would pollute them with stale values
//! (§8).
module HrSampler {

    //! Current HR for stats: trust only the activity's live sample. Returns a
    //! valid Number, or null when there is no usable reading.
    function currentForStats(info) {
        if (info != null && info.currentHeartRate != null) {
            return info.currentHeartRate;
        }
        return null;
    }

    //! Display-only HR: the live sample, else the most recent non-invalid sample
    //! from HR history. Never feed the result into per-activity stats.
    function currentForDisplay(info) {
        var live = currentForStats(info);
        if (live != null) {
            return live;
        }
        var history = ActivityMonitor.getHeartRateHistory(1, true);
        if (history != null) {
            var sample = history.next();
            if (sample != null
                    && sample.heartRate != null
                    && sample.heartRate != ActivityMonitor.INVALID_HR_SAMPLE) {
                return sample.heartRate;
            }
        }
        return null;
    }
}
