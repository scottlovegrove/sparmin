import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'

type ConfirmDialogProps = {
    readonly title: string
    readonly message: string
    readonly confirmText: string
    readonly cancelText?: string
    readonly isDestructive?: boolean
    readonly busy?: boolean
    readonly busyText?: string
    readonly onConfirm: () => void
    readonly onCancel: () => void
}

// A small confirmation modal, framework-free like the rest of the app: a portal
// into `document.body`, a tinted backdrop and a `.card`-styled panel. There is no
// modal library here on purpose — this is the one dialog the app needs.
//
// Escape and a backdrop click both cancel, but not while `busy`: once a
// destructive action is in flight there's no half-way out of it, so the exits are
// closed until it settles.
export function ConfirmDialog(props: ConfirmDialogProps) {
    const {
        title,
        message,
        confirmText,
        cancelText = 'Cancel',
        isDestructive = false,
        busy = false,
        busyText = confirmText,
        onConfirm,
        onCancel,
    } = props
    const titleId = useId()

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape' && !busy) {
                onCancel()
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [busy, onCancel])

    return createPortal(
        <div
            className="overlay"
            onClick={() => {
                if (!busy) {
                    onCancel()
                }
            }}
        >
            <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                // The panel swallows clicks so hitting it doesn't fall through to
                // the backdrop's cancel.
                onClick={(event) => event.stopPropagation()}
            >
                <h2 id={titleId}>{title}</h2>
                <p className="muted small">{message}</p>
                <div className="modal-actions">
                    <button
                        type="button"
                        className="button secondary"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        className={isDestructive ? 'button danger' : 'button'}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? busyText : confirmText}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
