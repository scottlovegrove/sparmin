import { useState } from 'react'
import { useAppUpdate } from '../lib/use-app-update'

// Mounted once, above the sign-in / signed-in branch in app.tsx, so an update is
// offered wherever the user happens to be — including the sign-in screen, which is a
// separate branch of the tree.
export function UpdateBanner() {
    const { needRefresh, update, detectionToken } = useAppUpdate()
    // Which detection was dismissed. -1 is "none yet", and can't collide with a real
    // token, which starts at 0 and only counts up.
    const [dismissedToken, setDismissedToken] = useState(-1)

    if (!needRefresh || dismissedToken === detectionToken) {
        return null
    }

    return (
        <div className="update-banner" role="status">
            <span className="small">A new version of Sparmin is ready.</span>
            <button type="button" className="update-action" onClick={update}>
                Update
            </button>
            <button
                type="button"
                className="link"
                onClick={() => setDismissedToken(detectionToken)}
            >
                Later
            </button>
        </div>
    )
}
