import Toybox.Lang;
import Toybox.WatchUi;

//! The activityId -> drawable mapping, with a lazy bitmap cache. Shared by every
//! view that draws activity icons (the strip and the summary), so the bitmaps are
//! loaded once and the id->resource map lives in one place.
//!
//! Icons are rasterised per screen family by tools/rasterise-icons.sh, so the
//! bitmap a device gets is already the right size — draw it at native px.
module ActivityIcons {

    // Rez symbols can't be held in a module-level const, so build the map lazily.
    var _syms as Lang.Dictionary = {};
    var _cache as Lang.Dictionary = {};

    function _symbols() as Lang.Dictionary {
        if (_syms.size() == 0) {
            _syms = {
                "outdoor_cold_plunge" => Rez.Drawables.st_outdoor_cold_plunge,
                "indoor_cold_plunge" => Rez.Drawables.st_indoor_cold_plunge,
                "hydro_pool" => Rez.Drawables.st_hydro_pool,
                "heated_loungers" => Rez.Drawables.st_heated_loungers,
                "salt_sauna" => Rez.Drawables.st_salt_sauna,
                "steam_room" => Rez.Drawables.st_steam_room,
                "fire_ice_room" => Rez.Drawables.st_fire_ice_room,
                "finnish_sauna" => Rez.Drawables.st_finnish_sauna,
                "ice_cave" => Rez.Drawables.st_ice_cave,
                "outdoor_lounger" => Rez.Drawables.st_outdoor_lounger
            };
        }
        return _syms;
    }

    //! The icon bitmap for an activityId, loaded on first use and cached. Null if
    //! the id has no icon (callers fall back to the short text label).
    function bitmapFor(id) {
        if (_cache.hasKey(id)) {
            return _cache[id];
        }
        var syms = _symbols();
        var bmp = syms.hasKey(id) ? WatchUi.loadResource(syms[id]) : null;
        _cache.put(id, bmp);
        return bmp;
    }
}
