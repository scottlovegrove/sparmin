import Toybox.Lang;
import Toybox.Background;
import Toybox.System;

//! The background half of getting a finished session to the companion.
//!
//! A session is posted the moment it ends, which is the worst possible moment to
//! ask for a phone: Bluetooth is 2.4 GHz, water absorbs 2.4 GHz, and a wrist
//! still in the pool has no link to a phone sitting an arm's length away. The
//! post is queued instead — and for as long as the app was the only thing that
//! drained the queue, "queued" meant "waits until you next open Sparmin", which
//! in practice was hours later or the next visit.
//!
//! So while anything is waiting, the system starts this every five minutes and
//! it sends one. `BackendClient.syncBackgroundEvent` registers the wake-up when
//! the queue fills and drops it when the queue empties, so a watch with nothing
//! to send is not woken at all.
(:background)
class SessionSyncService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    //! One payload per wake, never a chain.
    //!
    //! A background process is killed if it has not exited within thirty seconds,
    //! and may be killed sooner to give its memory to the foreground. A payload
    //! is taken off the queue before it is posted, so a process killed part-way
    //! through draining loses whichever one it was carrying. Sending one keeps
    //! that window a single request wide, and a queue of three simply takes
    //! fifteen minutes to clear.
    function onTemporalEvent() as Void {
        var client = new BackendClient();
        if (!client.flushOnce(method(:onSettled))) {
            // Nothing queued, no phone, or no account to send to. Waking, looking
            // and going back to sleep costs the radio nothing.
            Background.exit(null);
        }
    }

    //! Public so `method(:onSettled)` can reach it; not for callers.
    function onSettled() as Void {
        Background.exit(null);
    }
}
