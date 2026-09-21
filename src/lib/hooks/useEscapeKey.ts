import { useEffect } from 'react'

/**
 * Calls onClose when Escape is pressed while active is true.
 * Use for custom modal markup that doesn't go through the shared <Modal> component
 * (e.g. a deliberately different theme) — keeps keyboard-close behavior consistent everywhere.
 */
export function useEscapeKey(onClose: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active, onClose])
}
