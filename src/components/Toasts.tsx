import { AlertIcon, CheckIcon } from './Icons'

export interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'error' | 'info'
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toast toast-${item.tone}`}
          onClick={() => onDismiss(item.id)}
        >
          <span className="toast-icon">
            {item.tone === 'ok' ? (
              <CheckIcon size={14} />
            ) : item.tone === 'error' ? (
              <AlertIcon size={14} />
            ) : (
              '◇'
            )}
          </span>
          <span>{item.message}</span>
        </button>
      ))}
    </div>
  )
}
