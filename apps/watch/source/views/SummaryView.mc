import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Graphics;

//! Read-only end-of-session summary (§5 SUMMARY): total time, one aggregate line
//! per activity (repeat visits folded), a transition-time line, and the per-visit
//! HR. Scrollable when the list is taller than the screen. The FIT file has
//! already been saved on confirm.
class SummaryView extends WatchUi.View {
    private var _stripView as StripView;
    private var _session as SessionManager;
    private var _lines as Lang.Array;   // Array<String>
    private var _scroll as Lang.Number;

    function initialize(stripView as StripView) {
        View.initialize();
        _stripView = stripView;
        _session = stripView.getSession();
        _scroll = 0;
        _lines = _buildLines();
    }

    function getStripView() as StripView { return _stripView; }
    function getSession() as SessionManager { return _session; }

    function scroll(delta as Lang.Number) as Void {
        _scroll += delta;
        if (_scroll < 0) {
            _scroll = 0;
        }
        var maxScroll = _lines.size() - 1;
        if (_scroll > maxScroll) {
            _scroll = maxScroll;
        }
        WatchUi.requestUpdate();
    }

    private function _buildLines() as Lang.Array {
        var lines = [];
        lines.add("Total  " + Fmt.duration(_session.totalSeconds()));
        var aggs = _session.activityAggregates();
        for (var i = 0; i < aggs.size(); i += 1) {
            var a = aggs[i];
            var head = a.displayName + "  " + Fmt.duration(a.totalSeconds);
            if (a.visits > 1) {
                head += " x" + a.visits.format("%d");
            }
            lines.add(head);
            lines.add("HR " + Fmt.hr(a.hrAvg()) + " avg / " + Fmt.hr(a.hrMax) + " max");
        }
        lines.add("Transitions  " + Fmt.duration(_session.transitionSeconds()));
        return lines;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.08, Graphics.FONT_SMALL, "Summary", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var lineH = dc.getFontHeight(Graphics.FONT_XTINY) + 2;
        var y = (h * 0.24).toNumber();
        var bottom = (h * 0.92).toNumber();
        for (var i = _scroll; i < _lines.size(); i += 1) {
            if (y > bottom) {
                break;
            }
            dc.drawText(w / 2, y, Graphics.FONT_XTINY, _lines[i], Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }
    }
}
