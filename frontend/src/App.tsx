import { Routes, Route, Navigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { AuthProvider, useAuth } from './context/auth.tsx'
import Layout from './components/Layout.tsx'
import Marketplace from './components/Marketplace.tsx'
import ProductDetail from './components/ProductDetail.tsx'
import SellerDashboard from './components/SellerDashboard.tsx'
import BuyerOrders from './components/BuyerOrders.tsx'
import ProductForm from './components/ProductForm.tsx'
import Profile from './components/Profile.tsx'
import AdminDisputes from './components/AdminDisputes.tsx'

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { authed, isAdmin } = useAuth()
  if (!authed) return <RequireAuth>{children}</RequireAuth>
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authed, connecting, connect } = useAuth()

  if (authed) return <>{children}</>

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6">
      <div className="text-center w-full max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mx-auto mb-5">
          <LogIn className="w-7 h-7 text-gray-400" />
        </div>
        <p className="text-gray-100 font-semibold mb-1">Connect to continue</p>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          This feature requires a Nostr identity.
          Open SokoPay inside <strong className="text-gray-300">Fedi</strong> for instant access,
          or paste your public key below.
        </p>
        <button
          onClick={connect}
          disabled={connecting}
          className="btn-primary w-full justify-center"
        >
          {connecting ? 'Connecting…' : 'Connect with Nostr'}
        </button>
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Marketplace />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/sell" element={<RequireAuth><SellerDashboard /></RequireAuth>} />
        <Route path="/sell/new" element={<RequireAuth><ProductForm /></RequireAuth>} />
        <Route path="/sell/edit/:id" element={<RequireAuth><ProductForm /></RequireAuth>} />
        <Route path="/orders" element={<RequireAuth><BuyerOrders /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><AdminDisputes /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
