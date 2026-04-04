import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  Users,
  Zap,
  DollarSign,
  Clock,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getFarmers, getPayments, getRate } from '../api/client.ts'
import StatusBadge from './StatusBadge.tsx'
import type { PaymentWithFarmer, ExchangeRate } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(n: number) {
  return `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
}

function fmtSats(n: number) {
  return `${n.toLocaleString('en-US')} sats`
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  iconColor: string
  subtitle?: string
  loading?: boolean
}

function StatCard({ label, value, icon, iconColor, subtitle, loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-24 mb-3 rounded" />
        <div className="skeleton h-8 w-32 mb-2 rounded" />
        <div className="skeleton h-3 w-20 rounded" />
      </div>
    )
  }

  return (
    <div className="card p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-400 font-medium">{label}</p>
        <div className={`p-2 rounded-lg ${iconColor}`}>{icon}</div>
      </div>
      <p className="text-2xl font-bold text-gray-100 mb-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
  )
}

// ─── Rate Widget ─────────────────────────────────────────────────────────────

function RateWidget({ rate, loading }: { rate?: ExchangeRate; loading: boolean }) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-32 mb-4 rounded" />
        <div className="skeleton h-10 w-48 mb-2 rounded" />
        <div className="skeleton h-4 w-36 rounded" />
      </div>
    )
  }

  if (!rate) return null

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-bitcoin" />
          <p className="text-sm font-semibold text-gray-300">Bitcoin Exchange Rate</p>
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${
            rate.live
              ? 'bg-mpesa/20 text-green-300 border-green-600/30'
              : 'bg-gray-700 text-gray-400 border-gray-600'
          }`}
        >
          {rate.live ? 'LIVE' : 'CACHED'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">BTC / KES</p>
          <p className="text-2xl font-bold text-bitcoin">
            {parseFloat(rate.btc_kes).toLocaleString('en-KE', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">Kenyan Shilling</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">BTC / USD</p>
          <p className="text-2xl font-bold text-gray-200">
            {parseFloat(rate.btc_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">US Dollar</p>
        </div>
      </div>

      {rate.fetched_at && (
        <p className="text-[11px] text-gray-600 mt-3">
          Updated {formatDistanceToNow(new Date(rate.fetched_at), { addSuffix: true })}
        </p>
      )}
    </div>
  )
}

// ─── Status Chart ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  created: '#6b7280',
  invoice_created: '#f59e0b',
  bitcoin_received: '#3b82f6',
  credited_to_farmer: '#00a651',
  failed: '#ef4444',
}

function StatusChart({ payments }: { payments: PaymentWithFarmer[] }) {
  const counts = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  const data = Object.entries(counts).map(([status, count]) => ({
    status: status.replace(/_/g, ' '),
    rawStatus: status,
    count,
  }))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
        No payment data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
        <XAxis
          dataKey="status"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#111827',
            border: '1px solid #374151',
            borderRadius: '8px',
            color: '#f3f4f6',
            fontSize: 12,
          }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.rawStatus}
              fill={STATUS_COLORS[entry.rawStatus] ?? '#6b7280'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Recent Payments Table ────────────────────────────────────────────────────

function RecentPayments({ payments, loading }: { payments: PaymentWithFarmer[]; loading: boolean }) {
  const recent = payments.slice(0, 5)

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-gray-200">Recent Payments</h3>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-10 rounded" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <Zap className="w-8 h-8 text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">No payments yet</p>
          <p className="text-xs text-gray-600 mt-1">Create a payment to get started</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>Amount (KES)</th>
                <th>Amount (Sats)</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <td>
                    <p className="font-medium text-gray-200">{p.farmer_name}</p>
                    <p className="text-[11px] text-gray-500">{p.farmer_phone}</p>
                  </td>
                  <td className="font-mono text-gray-200">
                    {parseFloat(p.amount_kes).toLocaleString('en-KE')}
                  </td>
                  <td className="font-mono text-amber-400">
                    {p.amount_sats.toLocaleString('en-US')}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="text-gray-500 text-xs">
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    data: farmers = [],
    isLoading: farmersLoading,
    isError: farmersError,
    refetch: refetchFarmers,
  } = useQuery({
    queryKey: ['farmers'],
    queryFn: getFarmers,
    refetchInterval: 30_000,
  })

  const {
    data: payments = [],
    isLoading: paymentsLoading,
    refetch: refetchPayments,
  } = useQuery<PaymentWithFarmer[]>({
    queryKey: ['payments'],
    queryFn: () => getPayments(),
    refetchInterval: 30_000,
  })

  const { data: rate, isLoading: rateLoading } = useQuery<ExchangeRate>({
    queryKey: ['rate'],
    queryFn: getRate,
    refetchInterval: 60_000,
  })

  const stats = useMemo(() => {
    const credited = payments.filter((p) => p.status === 'credited_to_farmer')
    return {
      total_farmers: farmers.length,
      total_payments: payments.length,
      total_paid_kes: credited.reduce((sum, p) => sum + parseFloat(p.amount_kes), 0),
      total_paid_sats: credited.reduce((sum, p) => sum + p.amount_sats, 0),
      pending_invoices: payments.filter((p) => p.status === 'invoice_created').length,
    }
  }, [payments, farmers])

  const statsLoading = farmersLoading || paymentsLoading

  function refetchAll() {
    refetchFarmers()
    refetchPayments()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Agricultural Bitcoin ↔ M-Pesa payments overview
          </p>
        </div>
        <button
          onClick={refetchAll}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {farmersError && (
        <div className="mb-6 flex items-center gap-3 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Failed to load dashboard data. Is the backend running on port 3001?</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Farmers"
          value={statsLoading ? '—' : stats.total_farmers}
          icon={<Users className="w-4 h-4 text-blue-400" />}
          iconColor="bg-blue-500/10"
          loading={statsLoading}
        />
        <StatCard
          label="Total Payments"
          value={statsLoading ? '—' : stats.total_payments}
          icon={<Zap className="w-4 h-4 text-amber-400" />}
          iconColor="bg-amber-500/10"
          loading={statsLoading}
        />
        <StatCard
          label="Total Paid (KES)"
          value={statsLoading ? '—' : fmtKes(stats.total_paid_kes)}
          icon={<DollarSign className="w-4 h-4 text-mpesa" />}
          iconColor="bg-green-500/10"
          subtitle={statsLoading ? undefined : fmtSats(stats.total_paid_sats)}
          loading={statsLoading}
        />
        <StatCard
          label="Awaiting Payment"
          value={statsLoading ? '—' : stats.pending_invoices}
          icon={<Clock className="w-4 h-4 text-orange-400" />}
          iconColor="bg-orange-500/10"
          subtitle={
            !statsLoading && stats.pending_invoices > 0
              ? 'Awaiting BTC payment'
              : undefined
          }
          loading={statsLoading}
        />
      </div>

      {/* Rate + Chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <RateWidget rate={rate} loading={rateLoading} />

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">
            Payments by Status
          </h3>
          {paymentsLoading ? (
            <div className="skeleton h-48 rounded-lg" />
          ) : (
            <StatusChart payments={payments} />
          )}
        </div>
      </div>

      {/* Recent Payments */}
      <RecentPayments payments={payments} loading={paymentsLoading} />
    </div>
  )
}
