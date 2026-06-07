import { create } from "zustand"

export interface Toast {
  id: string
  title: string
  body?: string
  /** Optional chat to navigate to when the toast is clicked */
  chatId?: string
  /** Auto-dismiss delay in ms (0 = never auto-dismiss) */
  durationMs?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, "id"> & { id?: string }) => string
  removeToast: (id: string) => void
  clearToasts: () => void
}

let toastCounter = 0
function nextToastId(): string {
  toastCounter += 1
  return `toast-${toastCounter}`
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = toast.id ?? nextToastId()
    set((state) => ({ toasts: [...state.toasts, { durationMs: 6000, ...toast, id }] }))
    return id
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}))
