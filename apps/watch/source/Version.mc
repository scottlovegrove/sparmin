import Toybox.Lang;

//! The app version, as shown on the About page.
module Version {

    //! Bumped by hand at each release, to match the version entered in the
    //! Connect IQ store dashboard — a v3 manifest carries no version field of
    //! its own, so this constant is the only source of truth in the app.
    const APP = "0.4.0";
}
