import Toybox.Lang;
import Toybox.Math;

//! Client-generated session id. An RFC-4122 version-4-shaped string is plenty
//! for correlating the watch payload with the Strava activity backend-side.
module Uuid {

    const HEX = ["0", "1", "2", "3", "4", "5", "6", "7",
                 "8", "9", "a", "b", "c", "d", "e", "f"];

    function generate() {
        var s = "";
        for (var i = 0; i < 32; i += 1) {
            var nibble;
            if (i == 12) {
                nibble = 4;                 // version 4
            } else if (i == 16) {
                nibble = 8 + _rand(4);      // variant (8..b)
            } else {
                nibble = _rand(16);
            }
            s += HEX[nibble];
            if (i == 7 || i == 11 || i == 15 || i == 19) {
                s += "-";
            }
        }
        return s;
    }

    function _rand(mod) {
        var r = Math.rand() % mod;
        if (r < 0) {
            r += mod;
        }
        return r;
    }
}
