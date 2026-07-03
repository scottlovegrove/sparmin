import Toybox.Lang;
import Toybox.WatchUi;

//! Handles input (button, tap, swipe) for the main view.
class SparminDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! Menu button / long-press: open the main menu.
    function onMenu() as Boolean {
        WatchUi.pushView(new Rez.Menus.MainMenu(), new SparminMenuDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}
