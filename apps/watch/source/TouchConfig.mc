import Toybox.Lang;
import Toybox.Application;

//! "Water-safe touch" preference + the double-tap rule that backs it.
//!
//! On a wet touchscreen (e.g. climbing out of a hydro pool) warm droplets fire
//! spurious single taps that the app reads as real activity selections. When the
//! preference is on, tile actuation and the confirm-end tick require a deliberate
//! *double* tap of the same target within a short window, so a lone droplet tap
//! is ignored (the strip also offers a button-driven touch-lock for full
//! immersion). Default off = today's single-tap behaviour.
//!
//! `confirmsTap` is pure (no Storage / device APIs) so the double-tap rule is
//! unit-tested in one place; load/save wrap the flag onto Application.Storage,
//! mirroring ActivityConfig.
module TouchConfig {

    const STORAGE_KEY = "waterSafe";

    //! Max gap between the two taps of a double-tap, in milliseconds.
    const DOUBLE_TAP_MS = 400;

    //! Whether water-safe touch is enabled. Absent/non-boolean store => false.
    function isWaterSafe() as Lang.Boolean {
        return Application.Storage.getValue(STORAGE_KEY) == true;
    }

    function setWaterSafe(on as Lang.Boolean) as Void {
        Application.Storage.setValue(STORAGE_KEY, on);
    }

    //! True when `tile` completes a double-tap: the previous tap armed the *same*
    //! target (`prevTile`) no longer than `windowMs` ago. `prevTile == null` means
    //! nothing is armed (so it's a first tap, not a confirming second).
    function confirmsTap(prevTile, prevMs as Lang.Number, tile, nowMs as Lang.Number, windowMs as Lang.Number) as Lang.Boolean {
        if (prevTile == null || tile == null) {
            return false;
        }
        if (!prevTile.equals(tile)) {
            return false;
        }
        return (nowMs - prevMs) <= windowMs;
    }
}
