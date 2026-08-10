import Toybox.Lang;

//! Where the companion lives. One constant, in one place, because both the
//! pairing flow and the session upload need it and they must never disagree
//! about which account a watch is talking to.
//!
//! `(:background)`: the background retry posts to the same host.
(:background)
module Backend {

    //! No trailing slash — callers append the path, starting with one.
    const URL = "https://sparmin-app.scottlovegrove.co.uk";
}
