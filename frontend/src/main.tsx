import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { DisplaySettingsProvider } from './context/displaySettings.tsx'
import { I18nProvider } from './i18n/index.tsx'
import { CartProvider } from './context/cart.tsx'
import { ToastProvider } from './context/toast.tsx'
import { WishlistProvider } from './context/wishlist.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry 4xx client errors — they won't self-heal and retrying
      // 429 responses makes the rate-limit cascade exponentially worse.
      retry: (failureCount, error) => {
        if (error instanceof Error && /^HTTP 4/.test(error.message)) return false
        return failureCount < 2
      },
      // Refetching on window focus creates a burst when the user switches back
      // from DevTools (or any other window): every mounted query fires at once
      // against the same IP, easily exceeding the server's burst limit.
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DisplaySettingsProvider>
      <I18nProvider>
        <ToastProvider>
          <WishlistProvider>
          <CartProvider>
            <QueryClientProvider client={queryClient}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </QueryClientProvider>
          </CartProvider>
          </WishlistProvider>
        </ToastProvider>
      </I18nProvider>
    </DisplaySettingsProvider>
  </React.StrictMode>,
)
