import Toybox.Lang;
import Toybox.WatchUi;

//! Hub for the activity-config screens (§4a), reached from the idle strip. Routes
//! to the show/hide checkbox menu and the reorder move-mode view.
class ConfigDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id.equals("hide")) {
            var menu = new WatchUi.CheckboxMenu({ :title => "Show / hide" });
            var cfg = ActivityConfig.load();
            var all = SpaActivity.allIds();
            for (var i = 0; i < all.size(); i += 1) {
                var sid = all[i];
                menu.addItem(new WatchUi.CheckboxMenuItem(
                    SpaActivity.nameFor(sid), null, sid, cfg.indexOf(sid) >= 0, null));
            }
            WatchUi.pushView(menu, new HideMenuDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id.equals("reorder")) {
            var view = new MoveModeView();
            WatchUi.pushView(view, new MoveModeDelegate(view), WatchUi.SLIDE_LEFT);
        } else if (id.equals("waterSafe")) {
            // Menu2 has already flipped the toggle; persist its new state.
            TouchConfig.setWaterSafe((item as WatchUi.ToggleMenuItem).isEnabled());
        }
    }
}

//! Show/hide checkbox menu (§4a). A CheckboxMenu is driven by a
//! Menu2InputDelegate; the toggled item arrives as a CheckboxMenuItem. Persists
//! on each toggle and refuses to hide the last activity (restores the checkbox).
class HideMenuDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var cb = item as WatchUi.CheckboxMenuItem;
        var sid = cb.getId();
        var cfg = ActivityConfig.load();
        var updated = ActivityConfig.toggle(cfg, sid);
        if (updated.size() == cfg.size() && !cb.isChecked()) {
            cb.setChecked(true);   // hiding the last activity was blocked
        } else {
            ActivityConfig.save(updated);
        }
    }
}

//! Move-mode input for reordering (§4a), via raw InputDelegate. Up/Down move the
//! focus or the held item; Start picks up / drops; Back/Lap saves and exits. On
//! touch, tap an item to pick it up, then tap a slot to drop.
class MoveModeDelegate extends WatchUi.InputDelegate {
    private var _view as MoveModeView;

    function initialize(view as MoveModeView) {
        InputDelegate.initialize();
        _view = view;
    }

    function onKey(evt as WatchUi.KeyEvent) as Lang.Boolean {
        var key = evt.getKey();
        if (key == WatchUi.KEY_UP) { _view.moveFocus(-1); return true; }
        if (key == WatchUi.KEY_DOWN) { _view.moveFocus(1); return true; }
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) { _view.togglePick(); return true; }
        if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
            _view.save();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return true;
        }
        return false;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        var idx = _view.indexAtPoint(evt.getCoordinates());
        if (idx >= 0) {
            if (_view.picked < 0) {
                _view.pickAt(idx);
            } else {
                _view.dropAt(idx);
            }
        }
        return true;
    }
}
