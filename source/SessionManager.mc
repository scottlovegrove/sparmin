import Toybox.Lang;
import Toybox.Application;

//! Session states (§5). These drive both the UI and the FIT recorder.
enum {
    STATE_IDLE,
    STATE_TRANSITION,
    STATE_STATION_ACTIVE,
    STATE_CONFIRM_END,
    STATE_SUMMARY
}

//! Storage key for the crash/resume snapshot (§6.5).
const SESSION_SNAP_KEY = "sessionSnapshot";

//! True if a snapshot of an in-progress session is persisted (checked on launch
//! before deciding whether to offer resume).
function hasSessionSnapshot() as Lang.Boolean {
    return Application.Storage.getValue(SESSION_SNAP_KEY) != null;
}

function loadSessionSnapshot() {
    return Application.Storage.getValue(SESSION_SNAP_KEY);
}

//! Owns the whole state machine, drives the FIT recorder through the injected
//! Recorder, holds the in-memory model, and builds the backend payload. It never
//! touches UI or device sensor APIs directly, so the state/duration/aggregation
//! logic is unit-testable with a fake recorder and injected timestamps.
//!
//! Timekeeping: every transition takes an explicit `now` (epoch seconds). The
//! caller passes Time.now().value(); tests pass fixed values. Durations are
//! derived from these boundaries, never from a ticking counter (§10).
class SessionManager {

    const LABEL_TRANSITION = "transition";

    //! Max length of the session-summary string written to the FIT session field.
    //! Bounds the FIT string buffer (see Recorder); longer summaries are truncated.
    const SUMMARY_MAX = 240;

    private var _recorder;
    private var _state;
    private var _segments as Lang.Array = [];  // Array<Segment>, closed laps in order
    private var _open;           // the currently open Segment, or null
    private var _openLabel;      // FIT label of the open lap
    private var _sessionStart;   // epoch seconds, or null
    private var _sessionEnd;     // epoch seconds, or null
    private var _sessionId;      // String, or null
    private var _activeStationId;// convenience mirror for the UI

    function initialize(recorder) {
        _recorder = recorder;
        reset();
    }

    function reset() {
        _state = STATE_IDLE;
        _segments = [];
        _open = null;
        _openLabel = null;
        _sessionStart = null;
        _sessionEnd = null;
        _sessionId = null;
        _activeStationId = null;
    }

    // ---- Queries ----

    function getState() { return _state; }
    function getSessionId() { return _sessionId; }
    function getActiveStationId() { return _activeStationId; }
    function getOpenSegment() { return _open; }
    function getSessionStart() { return _sessionStart; }

    function isRecording() {
        return _state == STATE_TRANSITION
            || _state == STATE_STATION_ACTIVE
            || _state == STATE_CONFIRM_END;
    }

    // ---- Transitions (§5) ----

    //! IDLE -> TRANSITION: begin recording and open the first (transition) lap.
    function startSession(now) {
        if (_state != STATE_IDLE) {
            return;
        }
        _beginSession(now);
        _persist();
    }

    //! Rebuild the in-memory model from a persisted snapshot (§6.5). Does not
    //! touch the recorder — the caller reconnects the FIT session separately.
    function restore(snap as Lang.Dictionary) as Void {
        _state = snap["state"];
        _sessionStart = snap["sessionStart"];
        _sessionEnd = snap["sessionEnd"];
        _sessionId = snap["sessionId"];
        _openLabel = snap["openLabel"];
        _activeStationId = snap["activeStationId"];
        _segments = [];
        var segs = snap["segments"] as Lang.Array;
        for (var i = 0; i < segs.size(); i += 1) {
            _segments.add(segmentFromDict(segs[i] as Lang.Dictionary));
        }
        var open = snap["open"];
        _open = (open != null) ? segmentFromDict(open as Lang.Dictionary) : null;
    }

    private function _persist() as Void {
        var segs = [];
        for (var i = 0; i < _segments.size(); i += 1) {
            segs.add(_segments[i].toDict());
        }
        Application.Storage.setValue(SESSION_SNAP_KEY, {
            "state" => _state,
            "sessionStart" => _sessionStart,
            "sessionEnd" => _sessionEnd,
            "sessionId" => _sessionId,
            "openLabel" => _openLabel,
            "activeStationId" => _activeStationId,
            "segments" => segs,
            "open" => (_open != null) ? _open.toDict() : null
        });
    }

    private function _clearPersist() as Void {
        Application.Storage.deleteValue(SESSION_SNAP_KEY);
    }

    //! Select a station tile. Behaviour depends on the current state:
    //!  - IDLE:            start the session, then open the station lap.
    //!  - TRANSITION:      open the station lap.
    //!  - STATION_ACTIVE, same station:      close it -> TRANSITION.
    //!  - STATION_ACTIVE, different station: auto-switch, zero gap.
    function selectStation(stationId, now) {
        if (_state == STATE_IDLE) {
            _beginSession(now);
            _openStation(stationId, now);
        } else if (_state == STATE_TRANSITION) {
            _openStation(stationId, now);
        } else if (_state == STATE_STATION_ACTIVE) {
            if (_activeStationId != null && _activeStationId.equals(stationId)) {
                _boundary(null, LABEL_TRANSITION, now);
                _activeStationId = null;
                _state = STATE_TRANSITION;
            } else {
                _openStation(stationId, now);
            }
        } else {
            return;   // no-op state: nothing to persist
        }
        _persist();
    }

    //! Context-dependent stop button.
    //!  - STATION_ACTIVE: close the station lap -> TRANSITION.
    //!  - TRANSITION:     -> CONFIRM_END.
    function stopPress(now) {
        if (_state == STATE_STATION_ACTIVE) {
            _boundary(null, LABEL_TRANSITION, now);
            _activeStationId = null;
            _state = STATE_TRANSITION;
            _persist();
        } else if (_state == STATE_TRANSITION) {
            _state = STATE_CONFIRM_END;
            _persist();
        }
    }

    function cancelEnd() {
        if (_state == STATE_CONFIRM_END) {
            _state = STATE_TRANSITION;
            _persist();
        }
    }

    //! CONFIRM_END -> SUMMARY: close the final lap, stop and save the activity.
    //! The final segment is closed first so summaryText() reflects the whole
    //! session; _openLabel is unchanged, so the FIT closing-lap label still holds.
    function confirmEnd(now) {
        if (_state != STATE_CONFIRM_END) {
            return;
        }
        if (_open != null) {
            _open.close(now);
            _segments.add(_open);
            _open = null;
        }
        _sessionEnd = now;
        _recorder.finish(_openLabel, summaryText());
        _activeStationId = null;
        _state = STATE_SUMMARY;
        _clearPersist();   // recording saved — no in-progress session to resume
    }

    function dismissSummary() {
        if (_state == STATE_SUMMARY) {
            reset();
        }
    }

    //! Fold a live HR reading into the open station lap (station laps only).
    function foldHr(hr) {
        if (_state == STATE_STATION_ACTIVE && _open != null && hr != null) {
            _open.foldHr(hr);
        }
    }

    // ---- Internals ----

    private function _beginSession(now) {
        _sessionId = Uuid.generate();
        _sessionStart = now;
        _sessionEnd = null;
        _segments = [];
        _recorder.startSession();
        _open = new Segment(null, now);
        _openLabel = LABEL_TRANSITION;
        _activeStationId = null;
        _state = STATE_TRANSITION;
    }

    private function _openStation(stationId, now) {
        _boundary(stationId, Station.nameFor(stationId), now);
        _activeStationId = stationId;
        _state = STATE_STATION_ACTIVE;
    }

    //! Close the open lap (labelled with its own label) and open a new one.
    private function _boundary(newStationId, newLabel, now) {
        _recorder.markLap(_openLabel);
        if (_open != null) {
            _open.close(now);
            _segments.add(_open);
        }
        _open = new Segment(newStationId, now);
        _openLabel = newLabel;
    }

    // ---- Derived views for the summary + payload ----

    function totalSeconds() {
        if (_sessionStart == null) {
            return 0;
        }
        var end = (_sessionEnd == null) ? _sessionStart : _sessionEnd;
        return end - _sessionStart;
    }

    //! Live master elapsed at `now` (epoch seconds) — for the running display.
    function elapsedSeconds(now) {
        if (_sessionStart == null) {
            return 0;
        }
        return now - _sessionStart;
    }

    //! Live elapsed in the open station lap at `now`, or 0 when not in a station.
    function stationElapsedSeconds(now) {
        if (_state == STATE_STATION_ACTIVE && _open != null) {
            return now - _open.startTime;
        }
        return 0;
    }

    function transitionSeconds() {
        var sum = 0;
        for (var i = 0; i < _segments.size(); i += 1) {
            if (!_segments[i].isStation()) {
                sum += _segments[i].durationSeconds();
            }
        }
        return sum;
    }

    //! Chronological station segments only (transition laps excluded).
    function stationSegments() as Lang.Array {
        var out = [];
        for (var i = 0; i < _segments.size(); i += 1) {
            var s = _segments[i];
            if (s.isStation()) {
                out.add(s);
            }
        }
        return out;
    }

    //! One StationAggregate per station, repeat visits summed, in first-visit
    //! order.
    function stationAggregates() as Lang.Array {
        var order = [];                    // Array<StationAggregate>
        var byId = {} as Lang.Dictionary;  // stationId -> StationAggregate
        for (var i = 0; i < _segments.size(); i += 1) {
            var s = _segments[i];
            if (!s.isStation()) {
                continue;
            }
            var agg = byId[s.stationId];
            if (agg == null) {
                agg = new StationAggregate(s.stationId);
                byId[s.stationId] = agg;
                order.add(agg);
            }
            agg.addSegment(s);
        }
        return order;
    }

    //! One compact line summarising the whole session, written to the FIT
    //! session field so it surfaces on the activity (§5). Mirrors the on-watch
    //! summary content. Capped at SUMMARY_MAX chars so it can't overflow the FIT
    //! string buffer.
    function summaryText() as Lang.String {
        var out = "Total " + Fmt.duration(totalSeconds());
        var aggs = stationAggregates();
        for (var i = 0; i < aggs.size(); i += 1) {
            var a = aggs[i];
            out += " · " + a.displayName + " " + Fmt.duration(a.totalSeconds);
            if (a.visits > 1) {
                out += " x" + a.visits.format("%d");
            }
            out += " (HR " + Fmt.hr(a.hrAvg()) + "/" + Fmt.hr(a.hrMax) + ")";
        }
        out += " · Trans " + Fmt.duration(transitionSeconds());
        if (out.length() > SUMMARY_MAX) {
            out = out.substring(0, SUMMARY_MAX) as Lang.String;
        }
        return out;
    }

    //! Build the §12 backend payload as a JSON-serialisable Dictionary.
    function buildPayload() as Lang.Dictionary {
        var stations = [];
        var aggs = stationAggregates();
        for (var i = 0; i < aggs.size(); i += 1) {
            stations.add(aggs[i].toDict());
        }
        var segs = [];
        var chron = stationSegments();
        for (var i = 0; i < chron.size(); i += 1) {
            var s = chron[i];
            segs.add({
                "stationId" => s.stationId,
                "startedAt" => Iso.fromEpoch(s.startTime),
                "endedAt" => Iso.fromEpoch(s.endTime),
                "hrAvg" => s.hrAvg(),
                "hrMax" => s.hrMax,
                "hrMin" => s.hrMin
            });
        }
        return {
            "sessionId" => _sessionId,
            "startedAt" => Iso.fromEpoch(_sessionStart),
            "endedAt" => Iso.fromEpoch(_sessionEnd),
            "totalSeconds" => totalSeconds(),
            "transitionSeconds" => transitionSeconds(),
            "stations" => stations,
            "segments" => segs
        };
    }
}

//! Per-station rollup used by the summary screen and the backend payload.
//! Repeat visits to the same station fold into one of these.
class StationAggregate {
    public var stationId;
    public var displayName;
    public var totalSeconds;
    public var visits;
    public var hrSum;
    public var hrCount;
    public var hrMin;
    public var hrMax;

    function initialize(stationId) {
        me.stationId = stationId;
        me.displayName = Station.nameFor(stationId);
        me.totalSeconds = 0;
        me.visits = 0;
        me.hrSum = 0;
        me.hrCount = 0;
        me.hrMin = null;
        me.hrMax = null;
    }

    function addSegment(seg) {
        totalSeconds += seg.durationSeconds();
        visits += 1;
        hrSum += seg.hrSum;
        hrCount += seg.hrCount;
        if (seg.hrMin != null && (hrMin == null || seg.hrMin < hrMin)) {
            hrMin = seg.hrMin;
        }
        if (seg.hrMax != null && (hrMax == null || seg.hrMax > hrMax)) {
            hrMax = seg.hrMax;
        }
    }

    function hrAvg() {
        if (hrCount <= 0) {
            return null;
        }
        return (hrSum + hrCount / 2) / hrCount;
    }

    function toDict() {
        return {
            "stationId" => stationId,
            "displayName" => displayName,
            "totalSeconds" => totalSeconds,
            "visits" => visits,
            "hrAvg" => hrAvg(),
            "hrMax" => hrMax,
            "hrMin" => hrMin
        };
    }
}
