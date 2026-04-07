import { NavLink, useNavigate } from 'react-router-dom'
import { ShoppingBag, Package, Wheat, TrendingUp, AlertCircle, LogOut, Plus, UserCircle, LogIn } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getRate, clearToken } from '../api/client.ts'
import { useCurrentFarmer } from '../hooks/useCurrentFarmer.ts'
import { useAuth } from '../context/auth.tsx'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface NavItemProps {
  to: string
  icon: ReactNode
  label: string
  end?: boolean
}

function NavItem({ to, icon, label, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
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

function RateDisplay() {
  const { data: rate, isError } = useQuery({
    queryKey: ['rate'],
    queryFn: getRate,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-400">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Rate unavailable</span>
      </div>
    )
  }

  if (!rate) {
    return (
      <div className="space-y-1.5">
        <div className="skeleton h-3 w-28 rounded" />
        <div className="skeleton h-3 w-20 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5 text-bitcoin shrink-0" />
        <span className="text-xs font-semibold text-bitcoin">
          {parseFloat(rate.btc_kes).toLocaleString('en-KE', { maximumFractionDigits: 0 })} KES
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-5">
        <span className="text-xs text-gray-500">
          ${parseFloat(rate.btc_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
        </span>
        <span className={clsx(
          'text-[10px] px-1 py-0.5 rounded font-medium',
          rate.live ? 'bg-mpesa/20 text-mpesa' : 'bg-gray-700 text-gray-400',
        )}>
          {rate.live ? 'LIVE' : 'CACHED'}
        </span>
      </div>
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { authed, connecting, connect } = useAuth()
  const { farmer, needsSetup } = useCurrentFarmer()

  function handleLogout() {
    clearToken()
    window.location.reload()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
            <Wheat className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <p className="text-base font-bold text-gray-100 leading-tight">AgriPay</p>
            <p className="text-[11px] text-gray-500 leading-tight">P2P · Lightning</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Marketplace
          </p>
          <NavItem to="/" icon={<ShoppingBag />} label="Browse" end />
          <NavItem to="/orders" icon={<Package />} label="My Orders" />

          <p className="px-3 mt-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Selling
          </p>
          <NavItem to="/sell" icon={<Wheat />} label="My Listings" />
          <button
            onClick={() => navigate('/sell/new')}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          >
            <span className="w-5 h-5 shrink-0"><Plus /></span>
            <span>New Listing</span>
          </button>

          <p className="px-3 mt-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Account
          </p>
          {authed ? (
            <NavLink
              to="/profile"
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
              <span className="flex-1">
                {farmer?.name ?? 'Profile'}
              </span>
              {needsSetup && (
                <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                  Setup
                </span>
              )}
            </NavLink>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left text-brand-400 hover:text-brand-300 hover:bg-brand-500/10"
            >
              <span className="w-5 h-5 shrink-0"><LogIn /></span>
              <span>{connecting ? 'Connecting…' : 'Connect'}</span>
            </button>
          )}
        </nav>

        {/* Setup nudge banner */}
        {authed && needsSetup && (
          <button
            onClick={() => navigate('/profile?setup=1')}
            className="mx-3 mb-2 flex gap-2 items-start bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2.5 text-left hover:bg-yellow-900/30 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-400 leading-snug">
              Add your Lightning Address to receive payments
            </p>
          </button>
        )}

        {/* BTC Rate + logout */}
        <div className="px-4 py-4 border-t border-gray-800 space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">
              BTC / 1 Bitcoin
            </p>
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto scrollbar-thin bg-gray-950">
        {children}
      </main>
    </div>
  )
}
