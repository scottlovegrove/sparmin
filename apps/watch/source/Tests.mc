import Toybox.Lang;
import Toybox.Test;
import Toybox.Application;

//! Unit tests for the device-independent core (§13). Build/run with --unit-test
//! in the simulator. These cover the state machine, lap-boundary logic, duration
//! and aggregation derivation, HR stat folding, payload construction, and the
//! activity-config helpers — none of which touch device sensor/UI APIs.

//! A stand-in for Recorder so SessionManager runs without ActivityRecording. It
//! records the labels handed to it so we can assert the FIT labelling order.
class FakeRecorder {
    public var started;
    public var stopped;
    public var discarded;
    public var lapLabels as Lang.Array = [];  // labels passed to markLap(), in order
    public var finishLabel;  // label passed to finish()
    public var finishSummary;  // summary string passed to finish()

    function initialize() {
        started = false;
        stopped = false;
        discarded = false;
        lapLabels = [];
        finishLabel = null;
        finishSummary = null;
    }

    function isActive() { return started && !stopped; }
    function startSession() { started = true; }
    function markLap(label) { lapLabels.add(label); }
    function finish(label, summary) { finishLabel = label; finishSummary = summary; stopped = true; }
    function discard() { discarded = true; }
}

// ---- SpaActivity config ----

(:test)
function testDefaultConfigIsFullCatalogue(logger) {
    Application.Storage.deleteValue(ActivityConfig.STORAGE_KEY);
    var cfg = ActivityConfig.load();
    Test.assertEqual(cfg.size(), SpaActivity.count());
    Test.assertEqual(cfg[0], "outdoor_cold_plunge");
    Test.assertEqual(cfg[cfg.size() - 1], "outdoor_lounger");
    return true;
}

(:test)
function testCannotHideLastActivity(logger) {
    var one = ["finnish_sauna"];
    var after = ActivityConfig.toggle(one, "finnish_sauna");
    Test.assertEqual(after.size(), 1); // blocked; unchanged
    Test.assertEqual(after[0], "finnish_sauna");
    return true;
}

(:test)
function testHideThenShow(logger) {
    var ids = ["outdoor_cold_plunge", "hydro_pool", "steam_room"];
    var afterHide = ActivityConfig.toggle(ids, "hydro_pool");
    Test.assertEqual(afterHide.size(), 2);
    Test.assertEqual(afterHide.indexOf("hydro_pool"), -1);
    var shown = ActivityConfig.toggle(afterHide, "hydro_pool");
    Test.assertEqual(shown.size(), 3);
    Test.assertEqual(shown[shown.size() - 1], "hydro_pool"); // appended
    return true;
}

(:test)
function testReorderMovesOnlyOrder(logger) {
    var ids = ["outdoor_cold_plunge", "indoor_cold_plunge", "hydro_pool"];
    var moved = ActivityConfig.move(ids, 0, 2);
    Test.assertEqual(moved.size(), 3);
    Test.assertEqual(moved[0], "indoor_cold_plunge");
    Test.assertEqual(moved[1], "hydro_pool");
    Test.assertEqual(moved[2], "outdoor_cold_plunge");
    return true;
}

// ---- Water-safe touch (double-tap gate) ----

(:test)
function testWaterSafeDefaultOff(logger) {
    Application.Storage.deleteValue(TouchConfig.STORAGE_KEY);
    Test.assertEqual(TouchConfig.isWaterSafe(), false);
    return true;
}

(:test)
function testDoubleTapConfirmsSameTileInWindow(logger) {
    var w = TouchConfig.DOUBLE_TAP_MS;
    // Second tap of the same tile, inside the window -> confirmed.
    Test.assert(TouchConfig.confirmsTap("hydro_pool", 1000, "hydro_pool", 1000 + w, w));
    // Exactly at the boundary still counts.
    Test.assert(TouchConfig.confirmsTap("hydro_pool", 1000, "hydro_pool", 1000 + w, w));
    return true;
}

(:test)
function testDoubleTapRejectsUnarmedDifferentAndLate(logger) {
    var w = TouchConfig.DOUBLE_TAP_MS;
    // Nothing armed yet (first tap).
    Test.assertEqual(TouchConfig.confirmsTap(null, 0, "hydro_pool", 500, w), false);
    // A different tile doesn't complete the double-tap.
    Test.assertEqual(TouchConfig.confirmsTap("ice_cave", 1000, "hydro_pool", 1100, w), false);
    // Same tile but too slow.
    Test.assertEqual(TouchConfig.confirmsTap("hydro_pool", 1000, "hydro_pool", 1000 + w + 1, w), false);
    return true;
}

// ---- State machine + laps ----

(:test)
function testIdleNoOps(logger) {
    var sm = new SessionManager(new FakeRecorder());
    Test.assertEqual(sm.getState(), STATE_IDLE);
    sm.stopPress(0);
    Test.assertEqual(sm.getState(), STATE_IDLE); // stop in IDLE is a no-op
    sm.cancelEnd();
    Test.assertEqual(sm.getState(), STATE_IDLE);
    return true;
}

(:test)
function testFullSessionFlowAndLabels(logger) {
    var rec = new FakeRecorder();
    var sm = new SessionManager(rec);

    sm.startSession(1000);
    Test.assertEqual(sm.getState(), STATE_TRANSITION);

    sm.selectActivity("finnish_sauna", 1010);       // trans[1000,1010]=10
    Test.assertEqual(sm.getState(), STATE_IN_ACTIVITY);

    sm.selectActivity("ice_cave", 1130);            // finnish[1010,1130]=120 (auto-switch)
    Test.assertEqual(sm.getState(), STATE_IN_ACTIVITY);

    sm.stopPress(1150);                             // ice_cave[1130,1150]=20 -> transition
    Test.assertEqual(sm.getState(), STATE_TRANSITION);

    sm.stopPress(1150);                             // -> confirm
    Test.assertEqual(sm.getState(), STATE_CONFIRM_END);

    sm.confirmEnd(1160);                            // trans[1150,1160]=10
    Test.assertEqual(sm.getState(), STATE_SUMMARY);

    Test.assertEqual(sm.totalSeconds(), 160);
    Test.assertEqual(sm.transitionSeconds(), 20);

    // FIT labels: each markLap carries the *closing* lap's label.
    Test.assertEqual(rec.lapLabels.size(), 3);
    Test.assertEqual(rec.lapLabels[0], "transition");
    Test.assertEqual(rec.lapLabels[1], "Finnish sauna");
    Test.assertEqual(rec.lapLabels[2], "Ice cave");
    Test.assertEqual(rec.finishLabel, "transition");

    sm.dismissSummary();
    Test.assertEqual(sm.getState(), STATE_IDLE);
    return true;
}

(:test)
function testDoubleTapStartOpensStationAsFirstLap(logger) {
    // The real production entry: selectActivity straight from IDLE (double-tap a
    // station). The first FIT lap must BE the station, not a zero-length
    // leading "transition" ghost lap.
    var rec = new FakeRecorder();
    var sm = new SessionManager(rec);

    sm.selectActivity("finnish_sauna", 1000);       // start straight into station
    Test.assertEqual(sm.getState(), STATE_IN_ACTIVITY);

    sm.selectActivity("ice_cave", 1120);            // finnish[1000,1120]=120 (auto-switch)
    sm.stopPress(1150);                             // ice_cave[1120,1150]=30 -> transition
    sm.stopPress(1150);                             // -> confirm
    sm.confirmEnd(1160);                            // trans[1150,1160]=10

    // No leading transition: only the trailing gap before confirm counts.
    Test.assertEqual(sm.transitionSeconds(), 10);

    // First closing lap is the station itself — no leading "transition".
    Test.assertEqual(rec.lapLabels.size(), 2);
    Test.assertEqual(rec.lapLabels[0], "Finnish sauna");
    Test.assertEqual(rec.lapLabels[1], "Ice cave");
    Test.assertEqual(rec.finishLabel, "transition");
    return true;
}

(:test)
function testSummaryText(logger) {
    var rec = new FakeRecorder();
    var sm = new SessionManager(rec);

    sm.startSession(1000);
    sm.selectActivity("finnish_sauna", 1010);   // trans 10
    sm.selectActivity("ice_cave", 1130);        // finnish 120 (auto-switch)
    sm.selectActivity("finnish_sauna", 1150);   // ice_cave 20 (auto-switch)
    sm.stopPress(1210);                         // finnish +60 -> total 180, visits 2
    sm.stopPress(1210);                         // -> confirm
    sm.confirmEnd(1220);                        // trans 10

    var text = sm.summaryText();
    // Summary captured at finish() must match what summaryText() reports.
    Test.assertEqual(rec.finishSummary, text);
    Test.assert(text.find("Total 03:40") != null);
    Test.assert(text.find("Finnish sauna 03:00 x2") != null);  // repeat folded
    Test.assert(text.find("Ice cave 00:20") != null);
    Test.assert(text.find("Trans 00:20") != null);
    return true;
}

(:test)
function testAutoSwitchIsZeroGap(logger) {
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(0);
    sm.selectActivity("finnish_sauna", 10);
    sm.selectActivity("ice_cave", 40);   // auto-switch at t=40
    var segs = sm.activitySegments();
    Test.assertEqual(segs.size(), 1);   // ice_cave still open, not yet closed
    // close it out to inspect both
    sm.stopPress(50);
    segs = sm.activitySegments();
    Test.assertEqual(segs.size(), 2);
    Test.assertEqual(segs[0].endTime, segs[1].startTime); // zero gap
    return true;
}

(:test)
function testAggregateRepeatVisits(logger) {
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(0);
    sm.selectActivity("finnish_sauna", 10);  // trans 10
    sm.selectActivity("ice_cave", 40);       // finnish 30
    sm.selectActivity("finnish_sauna", 60);  // ice 20
    sm.stopPress(100);                       // finnish 40
    sm.stopPress(100);
    sm.confirmEnd(100);                      // trans 0

    var aggs = sm.activityAggregates();
    Test.assertEqual(aggs.size(), 2);
    // finnish first-seen -> index 0
    Test.assertEqual(aggs[0].activityId, "finnish_sauna");
    Test.assertEqual(aggs[0].visits, 2);
    Test.assertEqual(aggs[0].totalSeconds, 70); // 30 + 40
    Test.assertEqual(aggs[1].activityId, "ice_cave");
    Test.assertEqual(aggs[1].visits, 1);
    Test.assertEqual(aggs[1].totalSeconds, 20);
    Test.assertEqual(sm.transitionSeconds(), 10);
    Test.assertEqual(sm.totalSeconds(), 100);
    return true;
}

// ---- HR folding ----

(:test)
function testHrFoldingRejectsInvalidAndTransition(logger) {
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(0);
    sm.foldHr(200);                     // in TRANSITION -> ignored
    sm.selectActivity("finnish_sauna", 10);
    sm.foldHr(80);
    sm.foldHr(null);                    // invalid -> ignored
    sm.foldHr(100);
    sm.stopPress(30);
    sm.stopPress(30);
    sm.confirmEnd(30);

    var aggs = sm.activityAggregates();
    Test.assertEqual(aggs.size(), 1);
    Test.assertEqual(aggs[0].hrAvg(), 90); // (80+100)/2, 200 excluded
    Test.assertEqual(aggs[0].hrMin, 80);
    Test.assertEqual(aggs[0].hrMax, 100);
    return true;
}

// ---- Strip navigation (window sliding) ----

(:test)
function testStripWindowSlidesAtEdges(logger) {
    var c = new StripController(SpaActivity.allIds(), 3); // 10 activities, window 3
    Test.assertEqual(c.windowStart, 0);
    c.moveFocus(1);
    c.moveFocus(1);              // focus 2, still fully visible
    Test.assertEqual(c.windowStart, 0);
    c.moveFocus(1);              // focus 3 past the window -> slides
    Test.assertEqual(c.focusedIndex, 3);
    Test.assertEqual(c.windowStart, 1);
    return true;
}

(:test)
function testStripWrapsAtStart(logger) {
    var c = new StripController(SpaActivity.allIds(), 3);
    c.moveFocus(-1);             // wrap 0 -> 9
    Test.assertEqual(c.focusedIndex, 9);
    Test.assertEqual(c.windowStart, 7); // last three visible
    return true;
}

(:test)
function testStripReloadClampsFocus(logger) {
    var c = new StripController(SpaActivity.allIds(), 3);
    c.moveFocus(1);
    c.moveFocus(1);
    c.moveFocus(1);             // focus 3
    c.reload(["finnish_sauna", "ice_cave"]);
    Test.assertEqual(c.visibleCount, 2);
    Test.assert(c.focusedIndex <= 1);
    return true;
}

// ---- Crash / resume persistence ----

(:test)
function testNoSnapshotWhenIdle(logger) {
    Application.Storage.deleteValue(SESSION_SNAP_KEY);
    Test.assertEqual(hasSessionSnapshot(), false);
    return true;
}

(:test)
function testPersistAndRestore(logger) {
    Application.Storage.deleteValue(SESSION_SNAP_KEY);
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(1000);
    sm.selectActivity("finnish_sauna", 1010);   // trans[1000,1010], open finnish
    Test.assert(hasSessionSnapshot());

    // Simulate a relaunch: a fresh manager restores the persisted model.
    var sm2 = new SessionManager(new FakeRecorder());
    sm2.restore(loadSessionSnapshot());
    Test.assertEqual(sm2.getState(), STATE_IN_ACTIVITY);
    Test.assertEqual(sm2.getActiveActivityId(), "finnish_sauna");
    Test.assertEqual(sm2.getSessionStart(), 1000);

    // Continue on the restored manager and check the totals line up.
    sm2.stopPress(1130);    // finnish 120 -> transition
    sm2.stopPress(1130);    // -> confirm
    sm2.confirmEnd(1140);   // trans 10 -> summary
    Test.assertEqual(sm2.getState(), STATE_SUMMARY);
    Test.assertEqual(sm2.totalSeconds(), 140);
    Test.assertEqual(sm2.transitionSeconds(), 20);
    var aggs = sm2.activityAggregates();
    Test.assertEqual(aggs.size(), 1);
    Test.assertEqual(aggs[0].totalSeconds, 120);
    return true;
}

(:test)
function testSnapshotClearedOnConfirm(logger) {
    Application.Storage.deleteValue(SESSION_SNAP_KEY);
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(0);
    Test.assert(hasSessionSnapshot());
    sm.stopPress(0);        // -> confirm
    sm.confirmEnd(0);       // -> summary, snapshot cleared
    Test.assertEqual(hasSessionSnapshot(), false);
    return true;
}

// ---- Payload ----

(:test)
function testBuildPayloadShape(logger) {
    var sm = new SessionManager(new FakeRecorder());
    sm.startSession(1000);
    sm.selectActivity("finnish_sauna", 1010);
    sm.stopPress(1130);
    sm.stopPress(1130);
    sm.confirmEnd(1140);

    var p = sm.buildPayload();
    Test.assert(p["sessionId"] != null);
    Test.assertEqual(p["totalSeconds"], 140);
    Test.assertEqual(p["transitionSeconds"], 20); // [1000,1010]=10 + [1130,1140]=10
    var activities = p["activities"] as Lang.Array;
    var segments = p["segments"] as Lang.Array;
    Test.assertEqual(activities.size(), 1);
    Test.assertEqual(segments.size(), 1);    // activity laps only
    var firstSeg = segments[0] as Lang.Dictionary;
    Test.assertEqual(firstSeg["activityId"], "finnish_sauna");
    Test.assert(p["startedAt"] != null);
    Test.assert(p["endedAt"] != null);
    return true;
}
