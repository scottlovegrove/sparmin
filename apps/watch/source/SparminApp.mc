import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

//! Application entry point. Owns the single SessionManager (with the real FIT
//! recorder) that every view drives.
class SparminApp extends Application.AppBase {

    private var _session as SessionManager = new SessionManager(new Recorder());

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
    }

    function onStop(state as Dictionary?) as Void {
    }

    function getSessionManager() as SessionManager {
        return _session;
    }

    //! The strip view is the home screen; it renders IDLE, TRANSITION and
    //! IN_ACTIVITY. Confirm/summary/config are pushed on top as needed.
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        var view = new StripView(_session);
        return [view, new StripDelegate(view)];
    }
}

//! Convenience accessor for the singleton application instance.
function getApp() as SparminApp {
    return Application.getApp() as SparminApp;
}
