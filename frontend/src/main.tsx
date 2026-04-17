import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { DisplaySettingsProvider } from './context/displaySettings.tsx'
import { I18nProvider } from './i18n/index.tsx'
import { CartProvider } from './context/cart.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DisplaySettingsProvider>
      <I18nProvider>
        <CartProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </CartProvider>
      </I18nProvider>
    </DisplaySettingsProvider>
  </React.StrictMode>,
)
