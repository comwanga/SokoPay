import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  TrendingUp, ShoppingBag, Zap, Smartphone,
  AlertTriangle, CheckCircle2, XCircle, Store, Package,
  RefreshCw, Activity,
} from 'lucide-react'
import { getAdminStats, formatKes } from '../api/client.ts'
import clsx from 'clsx'

function StatCard({
  label, value, sub, icon: Icon, color = 'text-gray-100', trend,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color?: string
  trend?: { value: number; label: string }
}) {
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <p className={clsx('text-2xl font-bold', color)}>{value}</p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
      {trend && (
        <div className={clsx(
          'flex items-center gap-1 text-[11px] font-semibold',
          trend.value >= 0 ? 'text-green-400' : 'text-red-400',
        )}>
          {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value).toFixed(1)}% {trend.label}
        </div>
      )}
    </div>
  )
}

function HealthBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={clsx('font-bold', color)}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all', color.replace('text-', 'bg-'))}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}

export default function AdminStats() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: getAdminStats,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse bg-gray-800" />
          ))}
        </div>
        <div className="card h-48 animate-pulse bg-gray-800" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="card p-6 text-center space-y-3">
        <XCircle className="w-8 h-8 text-red-400 mx-auto" />
        <p className="text-sm text-red-400">Failed to load platform stats.</p>
        <button onClick={() => refetch()} className="btn-secondary text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  const totalPay = data.settled_count + data.expired_count

  const monthlyChart = [...data.monthly_gmv]
    .reverse()
    .map(m => ({
      month: m.month,
      revenue: parseFloat(m.revenue_kes),
      orders: m.order_count,
    }))

  const methodData = [
    { name: 'Lightning', value: data.lightning_count, color: '#f7931a' },
    { name: 'M-Pesa',    value: data.mpesa_count,    color: '#00a651' },
    { name: 'Other',     value: Math.max(0, data.settled_count - data.lightning_count - data.mpesa_count), color: '#6b7280' },
  ].filter(d => d.value > 0)

  const orderStatusData = [
    { name: 'Completed', value: data.completed_orders,  color: '#4ade80' },
    { name: 'Pending',   value: data.pending_orders,    color: '#d97b18' },
    { name: 'Disputed',  value: data.disputed_orders,   color: '#facc15' },
    { name: 'Cancelled', value: data.cancelled_orders,  color: '#f87171' },
  ].filter(d => d.value > 0)

  return (
    <div className="space-y-6">

      {/* Refresh control */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          Live platform metrics
        </p>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Primary KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total GMV"
          value={formatKes(data.gmv_kes)}
          sub={`${data.gmv_sats.toLocaleString()} sats`}
          icon={TrendingUp}
          color="text-brand-400"
        />
        <StatCard
          label="Total Orders"
          value={data.total_orders.toLocaleString()}
          sub={`${data.completed_orders} completed`}
          icon={ShoppingBag}
        />
        <StatCard
          label="Sellers"
          value={data.total_sellers.toLocaleString()}
          sub={`${data.active_listings} active listings`}
          icon={Store}
        />
        <StatCard
          label="Settled Payments"
          value={data.settled_count.toLocaleString()}
          sub={`${totalPay > 0 ? ((data.settled_count / totalPay) * 100).toFixed(1) : 0}% success rate`}
          icon={CheckCircle2}
          color="text-green-400"
        />
      </div>

      {/* Platform health */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-400" />
          Platform Health
        </h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <HealthBar
            label="Payment success rate"
            value={data.payment_success_pct}
            color={data.payment_success_pct >= 90 ? 'text-green-400' : data.payment_success_pct >= 75 ? 'text-yellow-400' : 'text-red-400'}
          />
          <HealthBar
            label="Dispute rate"
            value={data.dispute_rate_pct}
            color={data.dispute_rate_pct <= 2 ? 'text-green-400' : data.dispute_rate_pct <= 5 ? 'text-yellow-400' : 'text-red-400'}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-800">
          {[
            { label: 'Open disputes',  value: data.disputed_orders,  icon: AlertTriangle, color: 'text-yellow-400' },
            { label: 'Expired invoices',value: data.expired_count,   icon: XCircle,       color: 'text-red-400' },
            { label: '⚡ Lightning',   value: data.lightning_count,  icon: Zap,           color: 'text-bitcoin' },
            { label: '📱 M-Pesa',      value: data.mpesa_count,      icon: Smartphone,    color: 'text-mpesa' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className={clsx('text-xl font-bold', s.color)}>{s.value.toLocaleString()}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly GMV chart */}
      {monthlyChart.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-400" />
            Monthly Revenue (KES)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthlyChart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#d97b18" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#d97b18" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#e5e7eb', fontSize: 11 }}
                formatter={(v: number) => [`KES ${v.toLocaleString('en-KE')}`, 'Revenue']}
              />
              <Area type="monotone" dataKey="revenue" stroke="#d97b18" fill="url(#gmvGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>

          {/* Order count bars */}
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={monthlyChart} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} allowDecimals={false} width={22} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                formatter={(v: number) => [v, 'Orders']}
              />
              <Bar dataKey="orders" fill="#4ade80" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Payment method + order status donut charts */}
      <div className="grid sm:grid-cols-2 gap-4">
        {methodData.length > 0 && (
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">Payment Methods</h3>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={methodData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                  {methodData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Legend formatter={v => <span style={{ color: '#9ca3af', fontSize: 11 }}>{v}</span>} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {orderStatusData.length > 0 && (
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">Order Status</h3>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={orderStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                  {orderStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Legend formatter={v => <span style={{ color: '#9ca3af', fontSize: 11 }}>{v}</span>} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Geographic distribution */}
      {data.top_countries.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-400" />
            Orders by Location
          </h3>
          <div className="space-y-2">
            {(() => {
              const max = Math.max(...data.top_countries.map(c => c.order_count))
              return data.top_countries.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4 text-right shrink-0 font-mono">{i + 1}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-200 font-medium truncate max-w-[60%]">{c.country.trim() || 'Unknown'}</span>
                      <span className="text-gray-500 tabular-nums">{c.order_count} orders · {formatKes(c.revenue_kes)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${max > 0 ? (c.order_count / max) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Empty state for new platforms */}
      {data.total_orders === 0 && (
        <div className="card p-8 text-center space-y-2">
          <TrendingUp className="w-10 h-10 text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">No transaction data yet</p>
          <p className="text-sm text-gray-600">Stats will populate as orders are placed and completed.</p>
        </div>
      )}
    </div>
  )
}
