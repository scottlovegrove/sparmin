import Toybox.Lang;

//! One recorded lap in the in-memory model, mirroring a FIT lap. A null
//! stationId marks a transition (non-station) lap. Times are epoch seconds so
//! durations stay wall-clock correct across suspend/resume — never derived from
//! a ticking counter.
class Segment {
    public var stationId;   // String, or null for a transition lap
    public var startTime;   // Number (epoch seconds)
    public var endTime;     // Number (epoch seconds), or null while open
    public var hrMin;       // Number, or null
    public var hrMax;       // Number, or null
    public var hrSum;       // Number
    public var hrCount;     // Number

    function initialize(stationId, startTime) {
        me.stationId = stationId;
        me.startTime = startTime;
        me.endTime = null;
        me.hrMin = null;
        me.hrMax = null;
        me.hrSum = 0;
        me.hrCount = 0;
    }

    function close(endTime) {
        me.endTime = endTime;
    }

    function isOpen() {
        return endTime == null;
    }

    function isStation() {
        return stationId != null;
    }

    function durationSeconds() {
        var end = (endTime == null) ? startTime : endTime;
        return end - startTime;
    }

    //! Fold a live heart-rate reading into this segment's stats. The caller must
    //! pre-filter null / invalid samples (see HrSampler); stale or fallback
    //! readings must never reach here.
    function foldHr(hr) {
        hrSum += hr;
        hrCount += 1;
        if (hrMin == null || hr < hrMin) {
            hrMin = hr;
        }
        if (hrMax == null || hr > hrMax) {
            hrMax = hr;
        }
    }

    //! Rounded average, or null when there were no valid samples.
    function hrAvg() {
        if (hrCount <= 0) {
            return null;
        }
        return (hrSum + hrCount / 2) / hrCount;
    }
}
