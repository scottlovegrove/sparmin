import Toybox.Lang;
import Toybox.WatchUi;

//! Handles selection in the main menu (resources/menus/menu.xml).
class SparminMenuDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    //! Called when a menu item is chosen.
    function onSelect(item as WatchUi.MenuItem) as Void {
        // Branch on item.getId() to act on each entry.
    }
}
