import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { AuthProvider, useAuth } from './context/auth.tsx'
import Layout from './components/Layout.tsx'
import HomePage from './components/HomePage.tsx'
import Marketplace from './components/Marketplace.tsx'
import ProductDetail from './components/ProductDetail.tsx'
import SellerDashboard from './components/SellerDashboard.tsx'
import BuyerOrders from './components/BuyerOrders.tsx'
import ProductForm from './components/ProductForm.tsx'
import Profile from './components/Profile.tsx'
import AdminDisputes from './components/AdminDisputes.tsx'
import PaymentHistory from './components/PaymentHistory.tsx'
import DisplayOptions from './components/DisplayOptions.tsx'
import SellerStorefront from './components/SellerStorefront.tsx'
import PriceIndex from './components/PriceIndex.tsx'
import CategoryPage from './components/CategoryPage.tsx'
import CartPage from './components/CartPage.tsx'
import DeveloperSettings from './components/DeveloperSettings.tsx'
import WishlistPage from './components/WishlistPage.tsx'
import FollowingPage from './components/FollowingPage.tsx'

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
          Sign in with your Nostr identity to continue.
          Open SokoPay inside <strong className="text-gray-300">Fedi</strong> for instant access.
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
  const location = useLocation()
  return (
    <Layout>
      <div key={location.pathname} className="page-enter">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<Marketplace />} />
        <Route path="/category/:cat" element={<CategoryPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/sell" element={<RequireAuth><SellerDashboard /></RequireAuth>} />
        <Route path="/sell/new" element={<RequireAuth><ProductForm /></RequireAuth>} />
        <Route path="/sell/edit/:id" element={<RequireAuth><ProductForm /></RequireAuth>} />
        <Route path="/orders" element={<RequireAuth><BuyerOrders /></RequireAuth>} />
        <Route path="/payments" element={<RequireAuth><PaymentHistory /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><DisplayOptions /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/settings/developer" element={<RequireAuth><DeveloperSettings /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><AdminDisputes /></RequireAdmin>} />
        <Route path="/sellers/:id" element={<SellerStorefront />} />
        <Route path="/price-index" element={<PriceIndex />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/following" element={<FollowingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
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
