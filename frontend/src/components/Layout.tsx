import { useState, useCallback, useEffect } from 'react'
import { NavLink, useNavigate, Link } from 'react-router-dom'
import {
  ShoppingBag, Package, Store, TrendingUp, AlertCircle,
  LogOut, Plus, UserCircle, LogIn, Menu, X, Shield,
  ArrowLeftRight, History, Settings, ShoppingCart, Search,
  MapPin, ChevronRight, Home, Heart, UserCheck,
} from 'lucide-react'
import { useWishlist } from '../context/wishlist.tsx'
import { useWishlistPriceAlerts } from '../hooks/useWishlistPriceAlerts.ts'
import { useSellerFollow } from '../hooks/useSellerFollow.ts'
import { useQuery } from '@tanstack/react-query'
import { getRate, clearToken } from '../api/client.ts'
import { useCurrentFarmer } from '../hooks/useCurrentFarmer.ts'
import { useAuth } from '../context/auth.tsx'
import { useDisplaySettings } from '../context/displaySettings.tsx'
import { useTranslation } from '../i18n/index.tsx'
import { useCart } from '../context/cart.tsx'
import { PRODUCT_CATEGORIES, CATEGORY_ICONS, countryName } from '../types'
import CurrencyConverter from './CurrencyConverter.tsx'
import CartDrawer from './CartDrawer.tsx'
import Footer from './Footer.tsx'
import ToastContainer from './ToastContainer.tsx'
import OnboardingModal from './OnboardingModal.tsx'
import clsx from 'clsx'
import type { ReactNode } from 'react'


function RatePill() {
  const { fiatCurrency } = useDisplaySettings()
  const { data: rate } = useQuery({
    queryKey: ['rate'],
    queryFn: () => getRate(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (!rate) return <div className="skeleton h-5 w-24 rounded-full hidden lg:block" />

  const value = fiatCurrency === 'KES'
    ? `KES ${parseFloat(rate.btc_local).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
    : `$${parseFloat(rate.btc_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bitcoin/10 border border-bitcoin/20 shrink-0">
      <span className="text-bitcoin text-xs font-bold">₿</span>
      <span className="text-xs font-semibold text-bitcoin">{value}</span>
      <span className={clsx(
        'text-[9px] font-bold px-1 py-0.5 rounded',
        rate.live ? 'bg-mpesa/20 text-mpesa' : 'bg-gray-700 text-gray-400',
      )}>
        {rate.live ? 'LIVE' : 'CACHED'}
      </span>
    </div>
  )
}


interface TopNavbarProps {
  onMenuOpen: () => void
  onCartOpen: () => void
  onConverterOpen: () => void
}

function TopNavbar({ onMenuOpen, onCartOpen, onConverterOpen }: TopNavbarProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { authed, connect, connecting } = useAuth()
  const { farmer } = useCurrentFarmer()
  const { totalCount } = useCart()
  const [searchFocused, setSearchFocused] = useState(false)

  const stored = localStorage.getItem('sokopay_country')
  const locationLabel = stored ? countryName(stored) : 'Africa'

  return (
    <header role="banner" className="fixed top-0 inset-x-0 z-40 bg-gray-900 border-b border-gray-800 h-14 shadow-lg">
      <div className="flex items-center h-full px-3 gap-2 sm:gap-3 max-w-screen-2xl mx-auto">

        {/* Hamburger */}
        <button
          onClick={onMenuOpen}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0 group">
          <div className="w-8 h-8 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center group-hover:bg-brand-500/30 transition-colors">
            <Store className="w-4 h-4 text-brand-400" />
          </div>
          <span className="text-base font-bold text-gray-100 hidden sm:block leading-tight">SokoPay</span>
        </Link>

        {/* Deliver-to pill (desktop) */}
        <button
          onClick={() => navigate('/browse')}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-transparent hover:border-gray-700 hover:bg-gray-800 transition-all shrink-0"
        >
          <MapPin className="w-3.5 h-3.5 text-brand-400" />
          <div className="text-left">
            <p className="text-[10px] text-gray-500 leading-none">{t('nav.deliver_to')}</p>
            <p className="text-xs font-semibold text-gray-200 leading-none mt-0.5">{locationLabel} ▾</p>
          </div>
        </button>

        {/* Search bar */}
        <form
          className="flex-1 relative hidden sm:block"
          onSubmit={e => {
            e.preventDefault()
            const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim()
            navigate(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse')
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            name="q"
            type="text"
            placeholder={t('market.search')}
            className={clsx(
              'w-full bg-gray-800 border rounded-xl pl-9 pr-4 py-2 text-sm text-gray-100 placeholder-gray-500 transition-all outline-none',
              searchFocused
                ? 'border-brand-500 ring-1 ring-brand-500/30'
                : 'border-gray-700 hover:border-gray-600',
            )}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </form>

        {/* Right actions */}
        <div className="flex items-center gap-1 ml-auto sm:ml-0">
          <RatePill />

          <button
            onClick={onConverterOpen}
            className="hidden md:flex p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Currency Converter"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>

          {/* Search icon — mobile only */}
          <button
            onClick={() => navigate('/browse')}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors sm:hidden"
          >
            <Search className="w-5 h-5" />
          </button>

          {/* Account (desktop) */}
          {authed ? (
            <Link
              to="/profile"
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <UserCircle className="w-5 h-5 text-gray-400" />
              <div className="text-left">
                <p className="text-[10px] text-gray-500 leading-none">{t('nav.hello')}</p>
                <p className="text-xs font-semibold text-gray-200 leading-none mt-0.5">
                  {farmer?.name?.split(' ')[0] ?? t('nav.account')}
                </p>
              </div>
            </Link>
          ) : (
            <button
              onClick={connecting ? undefined : connect}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <UserCircle className="w-5 h-5 text-gray-400" />
              <div className="text-left">
                <p className="text-[10px] text-gray-500 leading-none">{t('nav.hello')}</p>
                <p className="text-xs font-semibold text-brand-400 leading-none mt-0.5">
                  {connecting ? t('nav.connecting') : t('nav.sign_in')}
                </p>
              </div>
            </button>
          )}

          {/* Cart */}
          <button
            onClick={onCartOpen}
            aria-label={totalCount > 0 ? `Open cart, ${totalCount} item${totalCount !== 1 ? 's' : ''}` : 'Open cart'}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <div className="relative">
              <ShoppingCart className="w-5 h-5" aria-hidden="true" />
              {totalCount > 0 && (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-0.5 bg-brand-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalCount > 99 ? '99+' : totalCount}
                </span>
              )}
            </div>
            <span className="hidden md:block text-xs font-semibold">{t('nav.cart')}</span>
          </button>
        </div>
      </div>
    </header>
  )
}


interface MegaMenuProps {
  open: boolean
  onClose: () => void
  onConverterOpen: () => void
}

function MegaMenu({ open, onClose, onConverterOpen }: MegaMenuProps) {
  const navigate = useNavigate()
  const { authed, isAdmin, connect, connecting } = useAuth()
  const { farmer, needsSetup } = useCurrentFarmer()
  const { count: wishlistCount } = useWishlist()
  const { count: followingCount } = useSellerFollow()
  const { t } = useTranslation()

  function handleLogout() {
    clearToken()
    window.location.reload()
  }

  function go(path: string) {
    navigate(path)
    onClose()
  }

  function MenuItem({ label, icon, path, badge }: { label: string; icon: ReactNode; path: string; badge?: string }) {
    return (
      <button
        onClick={() => go(path)}
        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-colors text-left"
      >
        <span className="w-4 h-4 shrink-0 text-gray-500">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge && (
          <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
        <ChevronRight className="w-3 h-3 text-gray-700 shrink-0" />
      </button>
    )
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <aside
        role="navigation"
        aria-label="Main menu"
        aria-hidden={!open}
        className={clsx(
          'fixed top-0 left-0 h-full w-80 bg-gray-900 border-r border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >

        {/* User greeting */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 bg-brand-500/5 shrink-0">
          {authed ? (
            <button onClick={() => go('/profile')} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <div className="w-10 h-10 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
                <UserCircle className="w-6 h-6 text-brand-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500">{t('nav.hello')},</p>
                <p className="text-sm font-bold text-gray-100 truncate">{farmer?.name ?? t('nav.profile')}</p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => { connect(); onClose() }}
              disabled={connecting}
              className="flex items-center gap-3 flex-1 text-left"
            >
              <div className="w-10 h-10 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
                <UserCircle className="w-6 h-6 text-gray-500" />
              </div>
              <div>
                <p className="text-[11px] text-gray-500">{t('nav.hello')}, sign in</p>
                <p className="text-sm font-bold text-brand-400">
                  {connecting ? t('nav.connecting') : t('nav.account_and_lists')}
                </p>
              </div>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Setup nudge */}
        {authed && needsSetup && (
          <button
            onClick={() => go('/profile?setup=1')}
            className="flex items-start gap-2 px-4 py-2.5 bg-yellow-900/20 border-b border-yellow-700/20 text-left w-full"
          >
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-400 leading-snug">{t('nav.add_lightning')}</p>
          </button>
        )}

        {/* Scrollable nav sections */}
        <div className="flex-1 overflow-y-auto">

          {/* Browse Departments */}
          <div className="py-1">
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
              {t('nav.browse_departments')}
            </p>
            <MenuItem label={t('nav.all_products')} icon={<ShoppingBag className="w-4 h-4" />} path="/browse" />
            {PRODUCT_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => go(`/category/${encodeURIComponent(cat)}`)}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-colors"
              >
                <span className="text-base w-4 text-center shrink-0">{CATEGORY_ICONS[cat] ?? '📦'}</span>
                <span className="flex-1 text-left">{cat}</span>
                <ChevronRight className="w-3 h-3 text-gray-700 shrink-0" />
              </button>
            ))}
          </div>

          <div className="h-px bg-gray-800 mx-4" />

          {/* Your Account */}
          <div className="py-1">
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
              {t('nav.section.account')}
            </p>
            <MenuItem label={t('nav.orders')} icon={<Package className="w-4 h-4" />} path="/orders" />
            <MenuItem
              label="Wishlist"
              icon={<Heart className="w-4 h-4" />}
              path="/wishlist"
              badge={wishlistCount > 0 ? String(wishlistCount) : undefined}
            />
            <MenuItem
              label="Following"
              icon={<UserCheck className="w-4 h-4" />}
              path="/following"
              badge={followingCount > 0 ? String(followingCount) : undefined}
            />
            <MenuItem
              label={t('nav.profile')}
              icon={<UserCircle className="w-4 h-4" />}
              path="/profile"
              badge={needsSetup ? 'Setup' : undefined}
            />
            <MenuItem label={t('nav.payments')} icon={<History className="w-4 h-4" />} path="/payments" />
            <MenuItem label={t('nav.price_index')} icon={<TrendingUp className="w-4 h-4" />} path="/price-index" />
            <MenuItem label={t('nav.settings')} icon={<Settings className="w-4 h-4" />} path="/settings" />
          </div>

          <div className="h-px bg-gray-800 mx-4" />

          {/* Sell on SokoPay */}
          <div className="py-1">
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
              {t('nav.section.selling')}
            </p>
            <MenuItem label={t('nav.sell')} icon={<Store className="w-4 h-4" />} path="/sell" />
            <MenuItem label={t('nav.new_listing')} icon={<Plus className="w-4 h-4" />} path="/sell/new" />
          </div>

          {isAdmin && (
            <>
              <div className="h-px bg-gray-800 mx-4" />
              <div className="py-1">
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
                  {t('nav.section.admin')}
                </p>
                <MenuItem label={t('nav.admin')} icon={<Shield className="w-4 h-4" />} path="/admin" />
              </div>
            </>
          )}
        </div>

        {/* Footer: rate + converter + sign out */}
        <div className="border-t border-gray-800 px-4 py-3 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <RatePill />
            <button
              onClick={() => { onConverterOpen(); onClose() }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {t('nav.converter')}
            </button>
          </div>
          {authed && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t('nav.sign_out')}
            </button>
          )}
        </div>
      </aside>
    </>
  )
}


function BottomNav({ onCartOpen }: { onCartOpen: () => void }) {
  const { authed, connect } = useAuth()
  const { totalCount } = useCart()

  return (
    <nav aria-label="Bottom navigation" className="md:hidden fixed bottom-0 inset-x-0 bg-gray-900 border-t border-gray-800 z-40">
      <div className="flex items-stretch justify-around px-1 py-1 max-w-screen-sm mx-auto">

        <NavLink
          to="/"
          end
          className={({ isActive }) => clsx(
            'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300',
          )}
        >
          <Home className="w-5 h-5" />
          Home
        </NavLink>

        <NavLink
          to="/browse"
          className={({ isActive }) => clsx(
            'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300',
          )}
        >
          <ShoppingBag className="w-5 h-5" />
          Browse
        </NavLink>

        {/* Cart tab — centre, highlighted */}
        <button
          onClick={onCartOpen}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium text-gray-500 hover:text-gray-300 transition-colors relative"
        >
          <div className="relative">
            <ShoppingCart className="w-5 h-5" />
            {totalCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 bg-brand-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {totalCount > 9 ? '9+' : totalCount}
              </span>
            )}
          </div>
          Cart
        </button>

        <NavLink
          to="/orders"
          className={({ isActive }) => clsx(
            'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300',
          )}
        >
          <Package className="w-5 h-5" />
          Orders
        </NavLink>

        {authed ? (
          <NavLink
            to="/profile"
            className={({ isActive }) => clsx(
              'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300',
            )}
          >
            <UserCircle className="w-5 h-5" />
            Account
          </NavLink>
        ) : (
          <button
            onClick={connect}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-[10px] font-medium text-brand-400 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Sign in
          </button>
        )}
      </div>
    </nav>
  )
}


export default function Layout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen]           = useState(false)
  const [converterOpen, setConverterOpen] = useState(false)
  const [cartOpen, setCartOpen]           = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() =>
    !localStorage.getItem('sokopay_onboarded'),
  )
  const { error, clearError }             = useAuth()
  useWishlistPriceAlerts()

  const openMenu      = useCallback(() => setMenuOpen(true), [])
  const closeMenu     = useCallback(() => setMenuOpen(false), [])
  const openConverter = useCallback(() => setConverterOpen(true), [])
  const openCart      = useCallback(() => setCartOpen(true), [])

  // Auto-dismiss auth error after 8 seconds
  useEffect(() => {
    if (!error) return
    const t = setTimeout(clearError, 8000)
    return () => clearTimeout(t)
  }, [error, clearError])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <TopNavbar
        onMenuOpen={openMenu}
        onCartOpen={openCart}
        onConverterOpen={openConverter}
      />

      {error && (
        <div className="fixed top-14 inset-x-0 z-50 flex justify-center px-4 pt-2 pointer-events-none">
          <div className="flex items-center gap-3 bg-red-900/90 border border-red-700/60 rounded-xl px-4 py-2.5 shadow-lg pointer-events-auto max-w-sm w-full">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-300 flex-1">{error}</p>
            <button onClick={clearError} className="text-red-500 hover:text-red-300 transition-colors shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <MegaMenu
        open={menuOpen}
        onClose={closeMenu}
        onConverterOpen={openConverter}
      />

      {/* pt-14 clears the fixed top navbar; pb-16 clears mobile bottom nav */}
      <main id="main-content" className="flex-1 pt-14 pb-16 md:pb-0" tabIndex={-1}>
        {children}
      </main>

      <BottomNav onCartOpen={openCart} />

      <Footer />

      {converterOpen && (
        <CurrencyConverter onClose={() => setConverterOpen(false)} />
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      <ToastContainer />

      {showOnboarding && (
        <OnboardingModal onClose={() => {
          localStorage.setItem('sokopay_onboarded', '1')
          setShowOnboarding(false)
        }} />
      )}
    </div>
  )
}
