/**
 * Opens a URL in a new window and calls `onClose` when the window is closed
 * or when the child window sends a `checkout_status` postMessage signal.
 * Uses the parent window's `focus` event to detect closure (no polling).
 */
export function openWindowWithCallback(
  url: string,
  onClose: () => void,
  toast?: (options: object) => void
): void {
  const { width = 900, height = 700 } = { width: 900, height: 700 }
  const left = Math.round((screen.width - width) / 2)
  const top = Math.round((screen.height - height) / 2)
  const newWindow = window.open(
    url,
    '_blank',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  )
  if (!newWindow) return

  const cleanup = () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('message', onMessage)
  }

  const showToast = () => {
    toast?.({
      title: 'Payment verified',
      description:
        'Your payment has been verified. Your instance is currently being deployed.',
      status: 'success',
      duration: 6000,
      isClosable: true,
      position: 'top-right',
    })
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source === newWindow && event.data?.type === 'checkout_status') {
      cleanup()
      showToast()
      onClose()
    }
  }

  const onFocus = () => {
    if (newWindow.closed) {
      cleanup()
      onClose()
    }
  }

  window.addEventListener('message', onMessage)
  window.addEventListener('focus', onFocus)
}