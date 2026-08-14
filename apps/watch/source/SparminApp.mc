import Toybox.Application;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! Application entry point. Owns the single SessionManager (with the real FIT
//! recorder) that every view drives.
//!
//! `(:background)` because the class is also the entry point of the background
//! process: the system constructs it there to reach `getServiceDelegate()`. That
//! makes the constructor a shared thing, and everything it touches has to fit in
//! a background memory pool a fraction of the app's — which is why the session
//! manager is built on demand rather than as a member initialiser. Building it
//! here would pull the FIT recorder, and ActivityRecording with it, into a
//! process that has no business recording anything.
(:background)
class SparminApp extends Application.AppBase {

    private var _session;  // SessionManager, built on first use — see getSessionManager
    private var _backend as BackendClient = new BackendClient();
    private var _logs;     // LogClient, built in getInitialView — app process only
    //! True only in the app process. The class is the entry point of both, and
    //! `onStop` cannot otherwise tell "the wearer left the app" from "a background
    //! retry finished", which are not the same event and must not log as one.
    private var _isForeground as Lang.Boolean = false;

    function initialize() {
        AppBase.initialize();
        _session = null;
        _logs = null;
    }

    //! Deliberately empty, and deliberately not where the queue is flushed:
    //! `onStart` runs in the background process as well as the app. (Confirmed in
    //! the simulator, which prefixes that process's output with "Background:".)
    //! A flush started here would post without the one-payload-per-wake callback
    //! the service relies on, and a success would then chain the whole queue into
    //! a thirty-second window that can be killed at any point — losing whichever
    //! payload was in the air, since a payload leaves the queue before it is
    //! posted. Launch-time flushing belongs in `getInitialView`, which only the
    //! app ever calls.
    function onStart(state as Dictionary?) as Void {
    }

    //! The last line the app gets to write, and the one worth having: the system
    //! calls this when the app is being shut down in an orderly way, including
    //! when the shutdown is the system's idea rather than the wearer's. A session
    //! that ends with this line in the log was closed by something; one that ends
    //! without it was killed outright, or the watch restarted underneath it.
    //! Neither leaves a CIQ_LOG.YML, so telling them apart is otherwise guesswork.
    function onStop(state as Dictionary?) as Void {
        if (_isForeground) {
            WatchLog.add("app: stopping");
        }
    }

    //! The service delegate the system calls when a background event fires.
    function getServiceDelegate() as [System.ServiceDelegate] {
        return [new SessionSyncService()];
    }

    (:typecheck(disableBackgroundCheck))
    function getSessionManager() as SessionManager {
        var session = _session;
        if (session == null) {
            session = new SessionManager(new Recorder());
            _session = session;
        }
        return session as SessionManager;
    }

    function getBackend() as BackendClient {
        return _backend;
    }

    //! Built on first use, like the session manager and for the same reason: the
    //! constructor runs in the background process too, and a log upload has no
    //! place in a 32 KB pool with thirty seconds to drain a session queue. Kept in
    //! a field rather than handed out as a local because its response callback is
    //! a method on it, and a collected client has nothing to call back into.
    (:typecheck(disableBackgroundCheck))
    function getLogClient() as LogClient {
        var logs = _logs;
        if (logs == null) {
            logs = new LogClient();
            _logs = logs;
        }
        return logs as LogClient;
    }

    //! The strip view is the home screen; it renders IDLE, TRANSITION and
    //! IN_ACTIVITY. Confirm/summary/config are pushed on top as needed.
    //!
    //! Also the app's real start-up hook, for the reason `onStart` gives: this is
    //! the one entry point the background process never reaches.
    (:typecheck(disableBackgroundCheck))
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        _isForeground = true;
        WatchLog.add("app: started " + Version.APP);

        // Whether anything was waiting has to be read before the flush, which
        // takes the head of the queue off before it posts it.
        var wasQueued = _backend.queuedCount() > 0;
        // Anything that couldn't go at the time goes now, if there is a phone.
        _backend.flushQueue();
        // And whatever that leaves behind gets a background retry booked for it,
        // so the next delivery does not have to wait for the next launch. This
        // also re-books one for a watch that queued a session under a version
        // that had no background service at all.
        _backend.syncBackgroundEvent();

        // The log goes up only when no session was waiting to. A session is the
        // thing someone is missing; the log is for whoever is looking into why.
        if (!wasQueued) {
            getLogClient().upload();
        }

        var view = new StripView(getSessionManager());
        return [view, new StripDelegate(view)];
    }
}

//! Convenience accessor for the singleton application instance.
(:typecheck(disableBackgroundCheck))
function getApp() as SparminApp {
    return Application.getApp() as SparminApp;
}
