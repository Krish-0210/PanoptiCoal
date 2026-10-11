import { lite, useLite, useLiteNote } from '../lib/lite'

// Footer switch for lite mode (lighter visuals, same data and features). A real button; the choice
// is saved in localStorage by lib/lite.
export default function LiteToggle() {
  const on = useLite()
  return (
    <button type="button" className={`micro lite-toggle${on ? ' on' : ''}`} aria-pressed={on} data-lite-toggle onClick={() => lite.set(!on)}>
      <i aria-hidden="true" /> Lite mode <span className="mono">{on ? 'on' : 'off'}</span>
    </button>
  )
}

// Shown once when lite mode switched itself on (low measured frame rate), until dismissed.
export function LiteNote() {
  const show = useLiteNote()
  if (!show) return null
  return (
    <div className="lite-note" role="status">
      <span className="micro">Lite mode on for smoother performance. Switch off anytime.</span>
      <button type="button" className="lite-note-x" aria-label="Dismiss" onClick={() => lite.dismissNote()}>
        ×
      </button>
    </div>
  )
}
