import Toybox.Lang;
import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.PersistedContent;
import Toybox.System;
import Toybox.Time;

//! Posts a finished session to the companion, with an offline queue for the ones
//! that couldn't go at the time.
//!
//! The FIT is the record; this is a convenience on top of it. Nothing here may
//! ever affect the recording, and a session that never sends is recoverable by
//! exporting its activity and importing that instead — which is why a failure
//! costs a log line rather than anything on screen mid-session.
//!
//! Runs in both processes: the app posts a session as it ends, and the background
//! service retries whatever that left behind. Everything here is therefore
//! `(:background)`, and must stay small enough for a background memory pool that
//! is 32 KB on the older devices.
(:background)
class BackendClient {

    const QUEUE_KEY = "pendingPayloads";

    //! Sessions to keep when the phone has been away. Twenty is more than a
    //! fortnight of daily visits; past that the oldest go, because an unbounded
    //! array in Storage is a memory risk on a watch and anything this old is
    //! still sitting in Garmin Connect as a FIT.
    const MAX_QUEUED = 20;

    //! How many transient failures a payload may collect before it is dropped.
    //! Without a cap, a payload that can never succeed is retried for ever and
    //! blocks the queue behind it.
    //!
    //! Only failures the server might yet recover from are counted — a refusal
    //! is terminal on the spot (see `onResponse`) — so this is a patience
    //! setting, not a correctness one. At the retry interval below it is a
    //! little over an hour and a half of trying, which comfortably outlasts a
    //! flat phone or a spa with no signal in it.
    const MAX_ATTEMPTS = 20;

    //! How often the background service wakes while anything is queued. Five
    //! minutes is the floor the system allows for a temporal event; asking for
    //! less throws.
    const RETRY_INTERVAL_S = 300;

    private var _inFlight;   // payload currently being POSTed (for re-queue on failure)
    private var _onSettled;  // called once the response has been dealt with (background only)

    function initialize() {
        _inFlight = null;
        _onSettled = null;
    }

    //! Unlink on purpose, from the account screen.
    //!
    //! Takes the queue with it, for the reason the 401 path does: those sessions
    //! were recorded for an account this watch is deliberately leaving, and
    //! linking to a different one later must not post them into it. Nothing is
    //! lost that Garmin Connect does not still hold.
    //!
    //! This end only. The account keeps its record of the watch until it is
    //! removed in the companion, which is where a server-side revoke lives.
    function forget() as Void {
        WatchLog.add("link: forgetting account, dropping " + queuedCount());
        LinkConfig.clearToken();
        Application.Storage.deleteValue(QUEUE_KEY);
        // A POST already on the wire outlives this call, and its callback would
        // otherwise re-queue the payload it was carrying — putting a session
        // belonging to the account just left back into a queue the next account
        // will flush. Dropping the reference is what makes the unlink complete:
        // the response still arrives, finds nothing to re-queue, and stops.
        _inFlight = null;
        syncBackgroundEvent();
    }

    //! Stand a payload in the in-flight slot without making a request, so the
    //! late-callback paths can be tested.
    //!
    //! `(:debug)` rather than `(:test)`: the latter registers a function as a
    //! test case in its own right, and this is a seam for one, not one itself.
    //! Either way it is compiled out of the released `.iq`, which is built `-r`.
    (:debug)
    function setInFlight(payload) as Void {
        _inFlight = payload;
    }

    //! Send now if there is a phone and a token, otherwise keep it for later.
    function send(payload) {
        if (!LinkConfig.isLinked()) {
            // Not linked, so there is nowhere to send it and no point hoarding
            // it: the FIT is safe, and linking later does not retroactively make
            // this session sendable.
            WatchLog.add("send: not linked, skipping");
            return;
        }
        if (!_isConnected()) {
            WatchLog.add("send: no phone, queued");
            _enqueue(payload);
            return;
        }
        if (_inFlight != null) {
            // One request at a time: there is a single in-flight slot, and
            // overwriting it would make the next response settle the wrong
            // payload — marking one sent while quietly losing the other.
            WatchLog.add("send: another in flight, queued");
            _enqueue(payload);
            return;
        }
        if (queuedCount() > 0) {
            // Something older is already waiting. Go behind it rather than
            // jumping the queue: these are a diary, and posting the newest first
            // would also put it at the front of the queue on a failure, where
            // the trim takes the front.
            _enqueue(payload);
            flushQueue();
            return;
        }
        _post(payload);
    }

    //! Retry queued payloads. Called on app start, and after each response.
    //! Posts one at a time; a failure re-queues via the response callback.
    function flushQueue() {
        if (!_isConnected() || _inFlight != null || !LinkConfig.isLinked()) {
            return;
        }
        var queue = _queue();
        if (queue.size() == 0) {
            return;
        }
        var next = queue[0];
        // Drop the head now; a failed POST re-enqueues it.
        var rest = [];
        for (var i = 1; i < queue.size(); i += 1) {
            rest.add(queue[i]);
        }
        Application.Storage.setValue(QUEUE_KEY, rest);
        WatchLog.add("send: retrying queued, " + rest.size() + " behind it");
        _post(next);
    }

    //! Post exactly one queued payload and report back once its response has been
    //! dealt with. Answers false when nothing went out, in which case no callback
    //! is coming and the caller must move on by itself.
    //!
    //! This is the background service's whole job. It exists rather than the
    //! service calling `flushQueue()` because a settled response there must not
    //! start the next request: see `onResponse`.
    function flushOnce(onSettled) as Lang.Boolean {
        _onSettled = onSettled;
        flushQueue();
        if (_inFlight == null) {
            // `flushQueue` declined — no phone, nothing queued, or no token.
            _onSettled = null;
            return false;
        }
        return true;
    }

    //! Match the background wake-up to whether there is anything to wake up for.
    //!
    //! A temporal event is the system starting a process every five minutes, for
    //! ever, until it is told otherwise — so it is registered only while the
    //! queue has something in it and dropped the moment it empties. A watch that
    //! is up to date asks nothing of the battery.
    //!
    //! Called after every change to the queue. Cheap and idempotent: it compares
    //! what is registered against what is wanted and does nothing when they agree.
    function syncBackgroundEvent() as Void {
        if (!(Toybox has :Background)) {
            return;
        }
        var wanted = queuedCount() > 0;
        var registered = Background.getTemporalEventRegisteredTime() != null;
        if (wanted == registered) {
            return;
        }
        if (!wanted) {
            Background.deleteTemporalEvent();
            WatchLog.add("send: queue clear, retries off");
            return;
        }
        try {
            Background.registerForTemporalEvent(new Time.Duration(RETRY_INTERVAL_S));
            WatchLog.add("send: retrying every " + (RETRY_INTERVAL_S / 60) + " min");
        } catch (e instanceof Background.InvalidBackgroundTimeException) {
            // The interval asked for is exactly the documented floor, so this
            // should not happen. If it ever does, the next app launch still
            // flushes and nothing is lost.
            WatchLog.add("send: retry schedule refused");
        }
    }

    function queuedCount() {
        return _queue().size();
    }

    private function _isConnected() {
        return System.getDeviceSettings().phoneConnected;
    }

    private function _post(payload) {
        _inFlight = payload;
        Communications.makeWebRequest(
            Backend.URL + "/api/sessions/watch",
            payload,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => {
                    "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                    "Authorization" => "Bearer " + LinkConfig.token()
                },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onResponse)
        );
    }

    //! Public so `method(:onResponse)` can reach it; not for callers.
    //!
    //! 200 and 201 are both success: the companion answers 200 when it already
    //! had the session, which is the ordinary outcome of a retry rather than a
    //! problem.
    //!
    //! Everything else divides into refused and failed. A 4xx is the server
    //! saying it understood and will not take this — a validation bug, or a
    //! credential it no longer honours — and no amount of retrying changes its
    //! mind, so the payload goes rather than occupying the head of the queue
    //! until its attempts run out. A 5xx or a transport error might yet come
    //! good, so it waits its turn again.
    function onResponse(
        responseCode as Lang.Number,
        data as Null or Lang.Dictionary or Lang.String or PersistedContent.Iterator
    ) as Void {
        var payload = _inFlight;
        _inFlight = null;
        var settled = _onSettled;
        _onSettled = null;

        var ok = (responseCode == 200 || responseCode == 201);
        if (ok) {
            WatchLog.add("send: ok " + responseCode);
        } else if (responseCode == 401) {
            // The token is gone or revoked. Drop the queue with it — those
            // sessions were recorded for an account this watch is no longer
            // attached to, and linking to a different one later must not deliver
            // someone else's visits into it. The FITs are all still in Garmin
            // Connect.
            WatchLog.add("send: rejected, unlinking and clearing " + queuedCount());
            LinkConfig.clearToken();
            Application.Storage.deleteValue(QUEUE_KEY);
        } else if (responseCode >= 400 && responseCode < 500) {
            WatchLog.add("send: refused " + responseCode + ", dropped");
        } else {
            WatchLog.add("send: failed " + responseCode);
            if (payload != null) {
                _requeue(payload);
            }
        }

        syncBackgroundEvent();

        if (settled != null) {
            // The background service is waiting to exit, and must not be handed
            // another request to sit through.
            settled.invoke();
            return;
        }
        if (ok) {
            flushQueue();
        }
        // A failure deliberately does not drain the rest here. Retrying the whole
        // queue on every failure turns one unreachable server into a tight loop;
        // the background service comes back in five minutes.
    }

    //! Put a failed payload back at the *front*. Appending it would reorder the
    //! queue, and these are a diary — they should reach the companion in the
    //! order they happened.
    private function _requeue(payload) {
        var attempts = _attempts(payload) + 1;
        if (attempts >= MAX_ATTEMPTS) {
            WatchLog.add("send: giving up after " + attempts);
            return;
        }
        (payload as Lang.Dictionary)["attempts"] = attempts;

        var queue = _queue();
        var restored = [payload];
        for (var i = 0; i < queue.size(); i += 1) {
            restored.add(queue[i]);
        }
        _store(restored);
    }

    private function _attempts(payload) {
        var stored = (payload as Lang.Dictionary)["attempts"];
        return (stored instanceof Lang.Number) ? stored : 0;
    }

    private function _enqueue(payload) {
        var queue = _queue();
        queue.add(payload);
        _store(queue);
    }

    //! Write the queue back, trimmed to the cap.
    private function _store(queue as Lang.Array) as Void {
        var trimmed = trimQueue(queue, MAX_QUEUED);
        if (trimmed.size() < queue.size()) {
            WatchLog.add("send: queue full, dropped " + (queue.size() - trimmed.size()));
        }
        Application.Storage.setValue(QUEUE_KEY, trimmed);
        syncBackgroundEvent();
    }

    //! Drop from the front until the queue fits. Oldest first, deliberately: an
    //! old session is the one most likely to have been exported and imported by
    //! hand already, and the newest is the one the wearer just finished.
    //! Pure, so it can be tested without a phone or a backend.
    function trimQueue(queue as Lang.Array, max) as Lang.Array {
        var trimmed = queue;
        while (trimmed.size() > max) {
            trimmed = trimmed.slice(1, trimmed.size()) as Lang.Array;
        }
        return trimmed;
    }

    private function _queue() as Lang.Array {
        var q = Application.Storage.getValue(QUEUE_KEY);
        return (q instanceof Array) ? q as Lang.Array : [];
    }
}
