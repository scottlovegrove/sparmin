import Toybox.Lang;
import Toybox.Application;
import Toybox.System;
import Toybox.Math;

//! What the watch remembers about being linked to a Sparmin account: the bearer
//! token it posts sessions with, and its own id for itself.
//!
//! The token is a credential. It grants one capability — send sessions for its
//! owner — and nothing else, but it is still the thing to clear the moment the
//! backend says it is no longer valid.
module LinkConfig {

    const TOKEN_KEY = "deviceToken";
    const INSTALL_KEY = "installId";

    //! The stored bearer token, or null when this watch has never been linked or
    //! has been revoked.
    function token() {
        var stored = Application.Storage.getValue(TOKEN_KEY);
        return (stored instanceof Lang.String && stored.length() > 0) ? stored : null;
    }

    function isLinked() as Lang.Boolean {
        return token() != null;
    }

    function setToken(value) as Void {
        Application.Storage.setValue(TOKEN_KEY, value);
        WatchLog.add("link: token stored");
    }

    //! Forget the token. Called when the backend rejects it — the watch is no
    //! longer linked, and queuing sessions against a dead credential only hides
    //! that from the wearer.
    function clearToken() as Void {
        Application.Storage.deleteValue(TOKEN_KEY);
        WatchLog.add("link: token cleared");
    }

    //! This watch's id for itself, stable across restarts so that re-linking
    //! updates the account's existing row rather than adding another.
    //!
    //! Prefers the device's own identifier, which also survives reinstalling the
    //! app; falls back to a generated id persisted here, which does not. Losing
    //! it costs a re-link, nothing more.
    function installId() as Lang.String {
        var stored = Application.Storage.getValue(INSTALL_KEY);
        if (stored instanceof Lang.String && stored.length() > 0) {
            return stored;
        }
        var fresh = _deviceIdentifier();
        if (fresh == null) {
            fresh = _generatedId();
        }
        Application.Storage.setValue(INSTALL_KEY, fresh);
        return fresh;
    }

    //! The watch's product name, so the confirmation screen in the companion can
    //! say which watch is asking. Best effort — it is a label, not a key.
    function product() {
        return System.getDeviceSettings().partNumber;
    }

    function _deviceIdentifier() {
        var id = System.getDeviceSettings().uniqueIdentifier;
        return (id instanceof Lang.String && id.length() > 0) ? id : null;
    }

    //! Only ever an identifier, never a credential — Math.rand is not a CSPRNG,
    //! and nothing here depends on this being unguessable.
    function _generatedId() as Lang.String {
        var out = "ciq-";
        for (var i = 0; i < 4; i += 1) {
            out += (Math.rand() % 100000).format("%05d");
        }
        return out;
    }
}
