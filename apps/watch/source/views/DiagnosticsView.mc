import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;

//! The recent diagnostic log, read on the watch.
//!
//! Connect IQ gives an app no way to write a file that a computer can read over
//! USB — the only thing that reaches GARMIN/APPS/LOGS/ is CIQ_LOG.YML, and the
//! system writes that itself when an app crashes. So when something goes wrong
//! and there is no crash to point at, this screen is where the answer is.
//!
//! Newest line first: whatever just went wrong is what is being looked for.
class DiagnosticsView extends WatchUi.View {

    private var _lines as Lang.Array = [];
    private var _offset;

    function initialize() {
        View.initialize();
        _lines = WatchLog.read();
        _offset = 0;
    }

    function scroll(direction) as Void {
        _offset += direction;
        if (_offset < 0) {
            _offset = 0;
        }
        var last = _lines.size() - 1;
        if (_offset > last) {
            _offset = (last < 0) ? 0 : last;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var lineHeight = dc.getFontHeight(Graphics.FONT_XTINY);
        var top = lineHeight;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        if (_lines.size() == 0) {
            dc.drawText(width / 2, dc.getHeight() / 2, Graphics.FONT_SMALL,
                "Nothing logged", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var rows = (dc.getHeight() - top * 2) / lineHeight;
        for (var i = 0; i < rows; i += 1) {
            // Newest first: the log is stored oldest-first, so walk it backwards.
            var index = _lines.size() - 1 - (_offset + i);
            if (index < 0) {
                break;
            }
            dc.drawText(width / 2, top + i * lineHeight, Graphics.FONT_XTINY,
                _lines[index], Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
