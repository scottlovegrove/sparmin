import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

//! Application entry point. The manifest's `entry` attribute names this class.
class SparminApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    //! Called on application start up.
    function onStart(state as Dictionary?) as Void {
    }

    //! Called when the application is exiting.
    function onStop(state as Dictionary?) as Void {
    }

    //! Return the initial view and its input delegate.
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new SparminView(), new SparminDelegate()];
    }
}

//! Convenience accessor for the singleton application instance.
function getApp() as SparminApp {
    return Application.getApp() as SparminApp;
}
