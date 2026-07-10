import Toybox.Lang;
import Toybox.ActivityRecording;
import Toybox.Activity;
import Toybox.FitContributor;

//! Thin wrapper over the ActivityRecording API so SessionManager drives the FIT
//! recorder through a small, swappable surface (unit tests inject a fake with
//! the same methods). This is the only place that touches ActivityRecording.
//!
//! Lap labelling contract: the activity developer field is written to the lap
//! that is *closing*, so callers set the closing lap's label immediately before
//! markLap()/finish() (§6.4).
class Recorder {

    // The sport/sub-sport is load-bearing and can only be validated in Garmin
    // Connect on a real device. Failure modes seen:
    //   - SPORT_GENERIC read as a distance/GPS activity ("0 miles" in Connect).
    //   - SUB_SPORT_BREATHING dropped the whole thing into Connect's wellness
    //     view: HR/stress only, no laps table at all.
    // Cardio training is HR- and time-based with no distance, and Connect renders
    // it as a normal activity: a proper laps table (per-lap time/HR/calories),
    // HR chart and zones. Confirmed on-device.
    //
    // NOTE: Connect's app does NOT display Connect IQ developer fields, so the
    // per-lap `activity` label and the session `summary` written below are in the
    // FIT file but invisible in Connect's UI (laps show only as "1, 2, 3…").
    // Surfacing the activity names is the job of the (deferred) Strava-labelling
    // backend, not something a FitContributor field can achieve in Connect.
    const SPORT = Activity.SPORT_TRAINING;
    const SUB_SPORT = Activity.SUB_SPORT_CARDIO_TRAINING;
    const FIELD_NAME = "activity";
    const FIELD_ID = 0;
    // Session-scope field carrying the end-of-session summary line, so the whole
    // visit is legible on the saved activity (the lap field is per-activity only).
    const SUMMARY_FIELD_NAME = "summary";
    const SUMMARY_FIELD_ID = 1;
    const SUMMARY_MAX = 240;

    private var _session;
    private var _activityField;
    private var _summaryField;

    function initialize() {
        _session = null;
        _activityField = null;
        _summaryField = null;
    }

    function isActive() {
        return _session != null && _session.isRecording();
    }

    //! Create + start the session and its lap-scope activity field. Opens lap 1.
    function startSession() {
        _session = ActivityRecording.createSession({
            :name => "Spa",
            :sport => SPORT,
            :subSport => SUB_SPORT
        });
        _activityField = _session.createField(
            FIELD_NAME,
            FIELD_ID,
            FitContributor.DATA_TYPE_STRING,
            {
                :mesgType => FitContributor.MESG_TYPE_LAP,
                :count => SpaActivity.maxNameLength()
            }
        );
        _summaryField = _session.createField(
            SUMMARY_FIELD_NAME,
            SUMMARY_FIELD_ID,
            FitContributor.DATA_TYPE_STRING,
            {
                :mesgType => FitContributor.MESG_TYPE_SESSION,
                :count => SUMMARY_MAX
            }
        );
        _session.start();
    }

    //! Label the currently-open lap, then close it and open the next.
    function markLap(label) {
        _setField(label);
        if (_session != null) {
            _session.addLap();
        }
    }

    //! Label the final lap, attach the session summary, then stop and persist.
    function finish(label, summary) {
        _setField(label);
        if (_summaryField != null && summary != null) {
            _summaryField.setData(summary);
        }
        if (_session != null) {
            _session.stop();
            _session.save();
        }
        _session = null;
        _activityField = null;
        _summaryField = null;
    }

    function discard() {
        if (_session != null) {
            _session.discard();
        }
        _session = null;
        _activityField = null;
        _summaryField = null;
    }

    function _setField(label) {
        if (_activityField != null && label != null) {
            _activityField.setData(label);
        }
    }
}
