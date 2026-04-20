import { useState, useEffect } from 'react'

declare global {
  interface WindowEventMap {
    'sokopay:country': CustomEvent<string>
  }
}

const KEY = 'sokopay_country'

export function useCountry() {
  const [country, setCountry] = useState<string>(
    () => localStorage.getItem(KEY) ?? '',
  )

  useEffect(() => {
    // storage fires cross-tab; sokopay:country fires same-tab (dispatched by saveCountry)
    function onStorage(e: StorageEvent) {
      if (e.key === KEY) setCountry(e.newValue ?? '')
    }
    function onLocal(e: CustomEvent<string>) {
      setCountry(prev => prev === e.detail ? prev : e.detail)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('sokopay:country', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('sokopay:country', onLocal)
    }
  }, [])

  function saveCountry(code: string) {
    if (code) localStorage.setItem(KEY, code)
    else localStorage.removeItem(KEY)
    // Dispatch to all hook instances in this tab (storage event only fires cross-tab)
    window.dispatchEvent(new CustomEvent('sokopay:country', { detail: code }))
  }

  return { country, saveCountry }
}
