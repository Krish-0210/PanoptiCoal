// Inline state for one card or chart whose data did not arrive (after the automatic retries in
// api.ts): a short line and a retry control, in place of the content. `inLink` renders the control
// as a span, for use inside a card that is itself a link.
export default function LoadRetry({ onRetry, inLink = false, className = '' }: { onRetry: () => void; inLink?: boolean; className?: string }) {
  const go = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault()
    e.stopPropagation()
    onRetry()
  }
  return (
    <span className={`load-retry micro ${className}`} role="status">
      Couldn’t load,{' '}
      {inLink ? (
        <span className="load-retry-btn" role="button" tabIndex={0} onClick={go} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go(e)}>
          retry
        </span>
      ) : (
        <button type="button" className="load-retry-btn" onClick={go}>
          retry
        </button>
      )}
    </span>
  )
}
