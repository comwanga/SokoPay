import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ShoppingBag, Package, Store, TrendingUp, AlertCircle,
  LogOut, Plus, UserCircle, LogIn, Menu, X, Shield, ArrowLeftRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getRate, clearToken } from '../api/client.ts'
import { useCurrentFarmer } from '../hooks/useCurrentFarmer.ts'
import { useAuth } from '../context/auth.tsx'
import CurrencyConverter from './CurrencyConverter.tsx'
import clsx from 'clsx'
import type { ReactNode } from 'react'

// ── Rate display ───────────────────────────────────────────────────────────────

function RateDisplay() {
  const { data: rate, isError } = useQuery({
    queryKey: ['rate'],
    queryFn: () => getRate(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (isError) return (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle className="w-3.5 h-3.5" />
      <span>Rate unavailable</span>
    </div>
  )

  if (!rate) return (
    <div className="flex gap-2">
      <div className="skeleton h-3 w-20 rounded" />
      <div className="skeleton h-3 w-14 rounded" />
    </div>
  )

  return (
    <div className="flex items-center gap-1.5">
      <TrendingUp className="w-3.5 h-3.5 text-bitcoin shrink-0" />
      <span className="text-xs font-semibold text-bitcoin">
        {parseFloat(rate.btc_local).toLocaleString('en-KE', { maximumFractionDigits: 0 })} {rate.local_currency}
      </span>
      <span className={clsx(
        'text-[10px] px-1 py-0.5 rounded font-medium ml-1',
        rate.live ? 'bg-mpesa/20 text-mpesa' : 'bg-gray-700 text-gray-400',
      )}>
        {rate.live ? 'LIVE' : 'CACHED'}
      </span>
    </div>
  )
}

// ── Shared nav link ────────────────────────────────────────────────────────────

interface NavItemProps {
  to: string
  icon: ReactNode
  label: string
  end?: boolean
  onClick?: () => void
}

function SideNavItem({ to, icon, label, end, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          isActive
            ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
        )
      }
    >
      <span className="w-5 h-5 shrink-0">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

// ── Sidebar content (shared between desktop aside and mobile drawer) ───────────

interface SidebarContentProps {
  onNav?: () => void
  onOpenConverter: () => void
}

function SidebarContent({ onNav, onOpenConverter }: SidebarContentProps) {
  const navigate = useNavigate()
  const { authed, connecting, connect, isAdmin } = useAuth()
  const { farmer, needsSetup } = useCurrentFarmer()

  function handleLogout() {
    clearToken()
    window.location.reload()
  }

  return (
    <>
      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="px-3 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          Marketplace
        </p>
        <SideNavItem to="/" icon={<ShoppingBag />} label="Browse" end onClick={onNav} />
        <SideNavItem to="/orders" icon={<Package />} label="My Orders" onClick={onNav} />

        <p className="px-3 mt-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          Selling
        </p>
        <SideNavItem to="/sell" icon={<Store />} label="My Listings" onClick={onNav} />
        <button
          onClick={() => { navigate('/sell/new'); onNav?.() }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left text-gray-400 hover:text-gray-200 hover:bg-gray-800"
        >
          <span className="w-5 h-5 shrink-0"><Plus /></span>
          <span>New Listing</span>
        </button>

        {isAdmin && (
          <>
            <p className="px-3 mt-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
              Admin
            </p>
            <SideNavItem to="/admin" icon={<Shield />} label="Disputes & Users" onClick={onNav} />
          </>
        )}

        <p className="px-3 mt-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          Account
        </p>
        {authed ? (
          <NavLink
            to="/profile"
            onClick={onNav}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
              )
            }
          >
            <span className="w-5 h-5 shrink-0 relative">
              <UserCircle />
              {needsSetup && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-400" />
              )}
            </span>
            <span className="flex-1">{farmer?.name ?? 'Profile'}</span>
            {needsSetup && (
              <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                Setup
              </span>
            )}
          </NavLink>
        ) : (
          <button
            onClick={() => { connect(); onNav?.() }}
            disabled={connecting}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left text-brand-400 hover:text-brand-300 hover:bg-brand-500/10"
          >
            <span className="w-5 h-5 shrink-0"><LogIn /></span>
            <span>{connecting ? 'Connecting…' : 'Connect'}</span>
          </button>
        )}
      </nav>

      {/* Setup nudge */}
      {authed && needsSetup && (
        <button
          onClick={() => { navigate('/profile?setup=1'); onNav?.() }}
          className="mx-3 mb-2 flex gap-2 items-start bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2.5 text-left hover:bg-yellow-900/30 transition-colors"
        >
          <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-yellow-400 leading-snug">
            Add your Lightning Address to receive payments
          </p>
        </button>
      )}

      {/* BTC Rate + converter + sign out */}
      <div className="px-4 py-4 border-t border-gray-800 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
              BTC / 1 Bitcoin
            </p>
            <button
              onClick={onOpenConverter}
              className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-brand-400 transition-colors"
              title="Currency Converter"
            >
              <ArrowLeftRight className="w-3 h-3" />
              Converter
            </button>
          </div>
          <RateDisplay />
        </div>
        {authed && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        )}
      </div>
    </>
  )
}

// ── Bottom nav bar (mobile only) ───────────────────────────────────────────────

function BottomNav() {
  const { authed, connect } = useAuth()

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-gray-900 border-t border-gray-800 z-40 safe-bottom">
      <div className="flex items-center justify-around px-2 py-2">
        <NavLink to="/" end className={({ isActive }) =>
          clsx('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500')}>
          <ShoppingBag className="w-5 h-5" />
          Browse
        </NavLink>

        <NavLink to="/orders" className={({ isActive }) =>
          clsx('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500')}>
          <Package className="w-5 h-5" />
          Orders
        </NavLink>

        <NavLink to="/sell" className={({ isActive }) =>
          clsx('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-gray-500')}>
          <Store className="w-5 h-5" />
          Sell
        </NavLink>

        {authed ? (
          <NavLink to="/profile" className={({ isActive }) =>
            clsx('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-400' : 'text-gray-500')}>
            <UserCircle className="w-5 h-5" />
            Profile
          </NavLink>
        ) : (
          <button
            onClick={connect}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-brand-400"
          >
            <LogIn className="w-5 h-5" />
            Connect
          </button>
        )}
      </div>
    </nav>
  )
}

// ── Main layout ────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen]       = useState(false)
  const [converterOpen, setConverterOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gray-900 border-r border-gray-800">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <p className="text-base font-bold text-gray-100 leading-tight">SokoPay</p>
            <p className="text-[11px] text-gray-500 leading-tight">Buy & Sell Anything</p>
          </div>
        </div>
        <SidebarContent onOpenConverter={() => setConverterOpen(true)} />
      </aside>

      {/* ── Mobile drawer overlay ────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside className={clsx(
        'md:hidden fixed top-0 left-0 h-full w-72 bg-gray-900 border-r border-gray-800 z-50 flex flex-col transition-transform duration-200',
        drawerOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-100 leading-tight">SokoPay</p>
              <p className="text-[10px] text-gray-500 leading-tight">Buy & Sell Anything</p>
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="text-gray-500 hover:text-gray-200 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarContent onNav={() => setDrawerOpen(false)} onOpenConverter={() => { setDrawerOpen(false); setConverterOpen(true) }} />
      </aside>

      {/* ── Right-hand column (mobile top bar + main content) ───────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-gray-400 hover:text-gray-200 p-1 -ml-1"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-bold text-gray-100">SokoPay</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <RateDisplay />
            <button
              onClick={() => setConverterOpen(true)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors shrink-0"
              title="Currency Converter"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin bg-gray-950 pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />

      {/* Currency converter bottom sheet */}
      {converterOpen && (
        <CurrencyConverter onClose={() => setConverterOpen(false)} />
      )}
    </div>
  )
}
