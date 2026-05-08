/**
 * Typed toast helpers with correct durations.
 * Use these instead of calling showSuccess() / showError() directly.
 *
 * TOAST_SUCCESS_DURATION = 2500ms  (global Toaster default)
 * TOAST_ERROR_DURATION   = 4000ms  (explicit override for errors)
 */
import { toast } from 'sonner'

export const TOAST_SUCCESS_DURATION = 2500
export const TOAST_ERROR_DURATION   = 4000

export function showSuccess(message: string) {
  return toast.success(message, { duration: TOAST_SUCCESS_DURATION })
}

export function showError(message: string) {
  return toast.error(message, { duration: TOAST_ERROR_DURATION })
}