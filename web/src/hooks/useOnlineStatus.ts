import { useEffect, useState } from 'react'

export function useOnlineStatus(url: string): boolean | null {
  const [isOnline, setIsOnline] = useState<boolean | null>(null)

  useEffect(() => {
    if (!url) return

    const check = async () => {
      try {
        const isExternal = url.startsWith('http')
        const response = await fetch(url, {
          credentials: isExternal ? 'omit' : 'include',
        })
        setIsOnline(isExternal ? true : response.ok)
      } catch {
        setIsOnline(false)
      }
    }

    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [url])

  return isOnline
}