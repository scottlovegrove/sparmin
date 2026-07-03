import Toybox.Lang;
import Toybox.Application;
import Toybox.Communications;
import Toybox.PersistedContent;
import Toybox.System;

//! Posts the session summary (§12) to the backend, with an offline queue that
//! retries on the next launch when the phone is connected (§11). The backend
//! itself is a separate deliverable; this only honours the POST contract.
class BackendClient {

    // Point this at the real backend once it exists (§12 contract).
    const URL = "https://spa-logger.example.com/sessions";
    const QUEUE_KEY = "pendingPayloads";

    private var _inFlight;   // payload currently being POSTed (for re-queue on failure)

    function initialize() {
        _inFlight = null;
    }

    //! Send now if the phone is connected, otherwise queue for later.
    function send(payload) {
        if (_isConnected()) {
            _post(payload);
        } else {
            _enqueue(payload);
        }
    }

    //! Retry queued payloads. Call on app start (and when connectivity returns).
    //! Posts one at a time; a failure re-queues via the response callback.
    function flushQueue() {
        if (!_isConnected() || _inFlight != null) {
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
        _post(next);
    }

    private function _isConnected() {
        var ds = System.getDeviceSettings();
        return ds != null && ds.phoneConnected;
    }

    private function _post(payload) {
        _inFlight = payload;
        Communications.makeWebRequest(
            URL,
            payload,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => {
                    "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
                },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_onResponse)
        );
    }

    function _onResponse(responseCode as Lang.Number, data as Null or Lang.Dictionary or Lang.String or PersistedContent.Iterator) as Void {
        if (responseCode != 200 && responseCode != 201) {
            if (_inFlight != null) {
                _enqueue(_inFlight);
            }
        }
        _inFlight = null;
        // Drain the rest of the queue opportunistically.
        flushQueue();
    }

    private function _enqueue(payload) {
        var queue = _queue();
        queue.add(payload);
        Application.Storage.setValue(QUEUE_KEY, queue);
    }

    private function _queue() as Lang.Array {
        var q = Application.Storage.getValue(QUEUE_KEY);
        return (q instanceof Array) ? q as Lang.Array : [];
    }
}
