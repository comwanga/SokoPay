import { useState, useEffect } from 'react'

const KEY = 'sokopay_country'

export function useCountry() {
  const [country, setCountry] = useState<string>(
    () => localStorage.getItem(KEY) ?? '',
  )

  // React to changes made in other components (storage event fires cross-tab;
  // for same-tab changes we dispatch a custom event from setCountry callers)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY) setCountry(e.newValue ?? '')
    }
    function onLocal(e: Event) {
      setCountry((e as CustomEvent<string>).detail)
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
    setCountry(code)
    // Notify same-tab listeners
    window.dispatchEvent(new CustomEvent('sokopay:country', { detail: code }))
  }

  return { country, saveCountry }
}
