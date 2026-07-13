import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.System;

//! About page, reached from the Settings menu: the launcher icon, the app name,
//! the version it is running, and the device/API line worth quoting in a bug
//! report. Static — a tap or a press dismisses it (AboutDelegate).
class AboutView extends WatchUi.View {
    private var _icon as WatchUi.BitmapResource?;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        if (_icon == null) {
            // The launcher icon is family-sized (resources-<deviceFamily>/), so it
            // is already right for this screen — CIQ can't scale a bitmap anyway.
            _icon = WatchUi.loadResource(Rez.Drawables.LauncherIcon) as WatchUi.BitmapResource;
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var nameFont = Graphics.FONT_MEDIUM;
        var versionFont = Graphics.FONT_SMALL;
        var deviceFont = Graphics.FONT_XTINY;
        var nameH = dc.getFontHeight(nameFont);
        var versionH = dc.getFontHeight(versionFont);
        var deviceH = dc.getFontHeight(deviceFont);
        var gap = (h * 0.02).toNumber();

        var icon = _icon;
        var iconW = (icon != null) ? icon.getWidth() : 0;
        var iconH = (icon != null) ? icon.getHeight() : 0;

        // Centre the whole block, rather than each line against the screen
        // centre — the icon and the fonts differ in height, so stack from a
        // measured top.
        var block = nameH + versionH + deviceH + (gap * 2)
                    + ((icon != null) ? iconH + gap : 0);
        var y = (h - block) / 2;

        if (icon != null) {
            dc.drawBitmap((w - iconW) / 2, y, icon);
            y += iconH + gap;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, nameFont, "Sparmin", Graphics.TEXT_JUSTIFY_CENTER);
        y += nameH + gap;

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, versionFont, "Version " + Version.APP,
                    Graphics.TEXT_JUSTIFY_CENTER);
        y += versionH + gap;

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, deviceFont, _deviceLine(), Graphics.TEXT_JUSTIFY_CENTER);
    }

    //! The device's part number and its Connect IQ API level, e.g.
    //! "006-B4159-00 · CIQ 5.0.1" — the two facts that pin down which build of
    //! which hardware a report came from.
    private function _deviceLine() as Lang.String {
        var settings = System.getDeviceSettings();
        var part = settings.partNumber;
        var mv = settings.monkeyVersion;
        var ciq = mv[0].format("%d") + "." + mv[1].format("%d") + "." + mv[2].format("%d");
        return part + " · CIQ " + ciq;
    }
}
