import { NavLink } from 'react-router-dom'
import { Home, Users, Zap, Wheat, TrendingUp, AlertCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getRate } from '../api/client.ts'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface NavItemProps {
  to: string
  icon: ReactNode
  label: string
}

function NavItem({ to, icon, label }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
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
        <span
          className={clsx(
            'text-[10px] px-1 py-0.5 rounded font-medium',
            rate.live
              ? 'bg-mpesa/20 text-mpesa'
              : 'bg-gray-700 text-gray-400',
          )}
        >
          {rate.live ? 'LIVE' : 'CACHED'}
        </span>
      </div>
    </div>
  )
}

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
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
            <p className="text-[11px] text-gray-500 leading-tight">Lightning ↔ M-Pesa</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <p className="px-3 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Navigation
          </p>
          <NavItem to="/" icon={<Home />} label="Dashboard" />
          <NavItem to="/farmers" icon={<Users />} label="Farmers" />
          <NavItem to="/payments" icon={<Zap />} label="Payments" />
        </nav>

        {/* BTC Rate at bottom */}
        <div className="px-4 py-4 border-t border-gray-800">
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">
            BTC / 1 Bitcoin
          </p>
          <RateDisplay />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto scrollbar-thin bg-gray-950">
        {children}
      </main>
    </div>
  )
}
