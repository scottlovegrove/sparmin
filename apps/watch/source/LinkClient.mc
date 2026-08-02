import Toybox.Lang;
import Toybox.Communications;
import Toybox.PersistedContent;
import Toybox.System;

//! The two calls the pairing flow needs: ask for a code, then ask whether anyone
//! has approved it yet.
//!
//! Separate from BackendClient on purpose. That one owns a queue with a single
//! in-flight slot and a response handler wired to it; borrowing it for a poll
//! that runs every five seconds would tangle two unrelated retry policies.
class LinkClient {

    private var _onResult;   //! callback(state as Lang.String, data)
    private var _deviceCode;
    private var _busy;

    //! States handed to the callback. The first four mirror what the backend
    //! answers; `offline` and `failed` are this end's own.
    static const PENDING = "authorization_pending";
    static const SLOW_DOWN = "slow_down";
    static const EXPIRED = "expired_token";
    static const LINKED = "linked";
    static const OFFLINE = "offline";
    static const FAILED = "failed";

    function initialize(onResult) {
        _onResult = onResult;
        _deviceCode = null;
        _busy = false;
    }

    function isBusy() as Lang.Boolean {
        return _busy;
    }

    //! Ask the backend to open a pairing attempt. The reply carries the code to
    //! show and the secret half to keep.
    function requestCode() as Void {
        if (_busy) {
            return;
        }
        if (!_isConnected()) {
            WatchLog.add("link: no phone, cannot request code");
            _onResult.invoke(OFFLINE, null);
            return;
        }
        _busy = true;
        WatchLog.add("link: requesting code");
        Communications.makeWebRequest(
            Backend.URL + "/api/device/code",
            {
                "installId" => LinkConfig.installId(),
                "product" => LinkConfig.product()
            },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onCodeResponse)
        );
    }

    //! Public so `method(:onCodeResponse)` can reach it; not for callers.
    function onCodeResponse(
        responseCode as Lang.Number,
        data as Null or Lang.Dictionary or Lang.String or PersistedContent.Iterator
    ) as Void {
        _busy = false;
        if (responseCode != 201 || !(data instanceof Lang.Dictionary)) {
            WatchLog.add("link: code request failed " + responseCode);
            _onResult.invoke(FAILED, null);
            return;
        }
        _deviceCode = data["deviceCode"];
        WatchLog.add("link: code " + data["userCode"]);
        _onResult.invoke("code", data);
    }

    //! Ask whether the code has been approved. Safe to call on a timer — an
    //! in-flight request is skipped rather than stacked.
    function poll() as Void {
        if (_busy || _deviceCode == null) {
            return;
        }
        if (!_isConnected()) {
            _onResult.invoke(OFFLINE, null);
            return;
        }
        _busy = true;
        Communications.makeWebRequest(
            Backend.URL + "/api/device/token",
            { "deviceCode" => _deviceCode },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onPollResponse)
        );
    }

    //! Public so `method(:onPollResponse)` can reach it; not for callers.
    function onPollResponse(
        responseCode as Lang.Number,
        data as Null or Lang.Dictionary or Lang.String or PersistedContent.Iterator
    ) as Void {
        _busy = false;
        if (responseCode != 200 || !(data instanceof Lang.Dictionary)) {
            WatchLog.add("link: poll failed " + responseCode);
            _onResult.invoke(FAILED, null);
            return;
        }
        var status = data["status"];
        if (status == null) {
            _onResult.invoke(FAILED, null);
            return;
        }
        if (status.equals(LINKED)) {
            WatchLog.add("link: approved");
            LinkConfig.setToken(data["token"]);
            LinkConfig.setAccount(data["account"], data["linkedAt"]);
            _deviceCode = null;
            _onResult.invoke(LINKED, data);
            return;
        }
        if (status.equals(EXPIRED)) {
            WatchLog.add("link: code expired");
            _deviceCode = null;
        }
        _onResult.invoke(status, data);
    }

    private function _isConnected() as Lang.Boolean {
        var settings = System.getDeviceSettings();
        return settings != null && settings.phoneConnected;
    }
}
