// The name runs the session the app logs: cold plunge on the left, sauna on the
// right. The icon is the favicon's ring, so the header and the home-screen icon
// are recognisably the same thing. Sized in `em`, so it follows whatever type
// size it is dropped into.
export function Wordmark() {
    return (
        <span className="wordmark">
            <svg className="wordmark-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path
                    d="M32 6 A 26 26 0 0 1 32 58"
                    fill="none"
                    stroke="var(--cold)"
                    strokeWidth="9"
                    strokeLinecap="round"
                />
                <path
                    d="M32 6 A 26 26 0 0 0 32 58"
                    fill="none"
                    stroke="var(--hot)"
                    strokeWidth="9"
                    strokeLinecap="round"
                />
                {/* The drop takes the text colour rather than the favicon's white:
                    on a page ground, white would all but vanish in light mode. */}
                <path
                    d="M32 24 C 37 32 40 36 40 40 A 8 8 0 1 1 24 40 C 24 36 27 32 32 24 Z"
                    fill="currentColor"
                />
            </svg>
            <span className="wordmark-word">Sparmin</span>
        </span>
    )
}
