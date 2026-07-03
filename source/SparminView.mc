import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

//! Main view. Renders the layout defined in resources/layouts/layout.xml.
class SparminView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    //! Load the layout and prepare resources for rendering.
    function onLayout(dc as Dc) as Void {
        setLayout(Rez.Layouts.MainLayout(dc));
    }

    //! Called when this view becomes visible. Restore state / start timers here.
    function onShow() as Void {
    }

    //! Draw the view. Called on show and whenever the UI is invalidated.
    function onUpdate(dc as Dc) as Void {
        View.onUpdate(dc);
    }

    //! Called when this view is hidden. Persist state / stop timers here.
    function onHide() as Void {
    }
}
