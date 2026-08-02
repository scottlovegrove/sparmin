import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;
import Toybox.Time.Gregorian;

//! The account screen, reached from Settings once this watch is linked.
//!
//! It exists because the watch could previously say only *that* it was linked,
//! never to what. A watch that sends your heart rate somewhere should be able to
//! name where, on the watch, without a phone to hand.
module AccountMenu {

    //! Build the menu. The first item is the account itself — selecting it does
    //! nothing, it is there to be read.
    function build() as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => "Account" });
        var email = LinkConfig.account();
        menu.addItem(new WatchUi.MenuItem(
            email != null ? email : "Linked",
            _linkedLine(),
            "account",
            null));
        menu.addItem(new WatchUi.MenuItem("Link a different account", null, "relink", null));
        menu.addItem(new WatchUi.MenuItem("Forget this account", null, "forget", null));
        return menu;
    }

    //! "Linked 2 Aug 2026", or a plain fallback when the watch was linked before
    //! the backend began sending the account back. Saying nothing is better than
    //! inventing a date, and the next re-link fills it in.
    function _linkedLine() {
        var at = LinkConfig.linkedAt();
        if (at == null) {
            return LinkConfig.account() != null ? null : "Linked to an account";
        }
        var info = Gregorian.info(new Time.Moment(at), Time.FORMAT_SHORT);
        var formatted = Fmt.date(info.day, info.month, info.year);
        return formatted.length() > 0 ? "Linked " + formatted : null;
    }
}

//! Input for the account menu.
class AccountDelegate extends WatchUi.Menu2InputDelegate {

    private var _backend;

    function initialize(backend) {
        Menu2InputDelegate.initialize();
        _backend = backend;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == null) {
            return;
        }
        if (id.equals("relink")) {
            // Deliberate, and the only way to reach the pairing flow while
            // linked. Approving the new code rotates this watch's token, so the
            // old account stops receiving without anything else being done.
            var link = new LinkView();
            WatchUi.pushView(link, new LinkDelegate(link), WatchUi.SLIDE_LEFT);
        } else if (id.equals("forget")) {
            WatchUi.pushView(
                new WatchUi.Confirmation("Stop sending to this account?"),
                new ForgetDelegate(_backend),
                WatchUi.SLIDE_IMMEDIATE);
        }
    }
}

//! Confirmation for forgetting the account. Unlinking silently on a single tap
//! would be too easy to do by accident, and the wearer would find out weeks
//! later when their sessions were not where they expected.
class ForgetDelegate extends WatchUi.ConfirmationDelegate {

    private var _backend;

    function initialize(backend) {
        ConfirmationDelegate.initialize();
        _backend = backend;
    }

    function onResponse(response) as Lang.Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _backend.forget();
            // Back to Settings: this menu now describes an account the watch has
            // no token for, and rebuilding it in place is not worth the code.
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
        return true;
    }
}
