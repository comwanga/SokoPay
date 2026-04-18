import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Package, Edit2, Trash2, ChevronDown, ChevronUp,
  Truck, CheckCircle, Eye, EyeOff, AlertCircle, Zap,
  ShoppingBag, TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  listProducts, listOrders, updateProduct, deleteProduct,
  updateOrderStatus, formatKes, ORDER_STATUS_LABELS, sellerNextStatus,
  getFarmerAnalytics, getSellerRatings,
} from '../api/client.ts'
import { useCurrentFarmer } from '../hooks/useCurrentFarmer.ts'
import OrderStatusSteps from './OrderStatusSteps.tsx'
import MessageThread from './MessageThread.tsx'
import StarRating from './StarRating.tsx'
import clsx from 'clsx'
import type { Order, Product } from '../types'

// ─── My listing card ──────────────────────────────────────────────────────────

function ListingCard({ product }: { product: Product }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const toggleStatus = useMutation({
    mutationFn: () =>
      updateProduct(product.id, {
        status: product.status === 'active' ? 'paused' : 'active',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-products'] }),
  })

  const remove = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-products'] }),
  })

  const primaryImage = product.images.find(i => i.is_primary) ?? product.images[0]

  return (
    <div className="card flex gap-4 p-4">
      {/* Thumbnail */}
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-800 shrink-0">
        {primaryImage ? (
          <img src={primaryImage.url} alt={product.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-6 h-6 text-gray-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-gray-100 truncate">{product.title}</p>
        <p className="text-xs text-gray-400">
          {formatKes(product.price_kes)}/{product.unit} · {product.quantity_avail} {product.unit} available
        </p>
        {product.location_name && (
          <p className="text-xs text-gray-500">{product.location_name}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={clsx(
          'text-[11px] font-medium px-2 py-0.5 rounded-full',
          product.status === 'active'   && 'bg-mpesa/20 text-mpesa',
          product.status === 'paused'   && 'bg-gray-700 text-gray-400',
          product.status === 'sold_out' && 'bg-yellow-900/20 text-yellow-400',
        )}>
          {product.status}
        </span>

        <button
          onClick={() => toggleStatus.mutate()}
          disabled={toggleStatus.isPending}
          className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title={product.status === 'active' ? 'Pause listing' : 'Activate listing'}
        >
          {product.status === 'active' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>

        <button
          onClick={() => navigate(`/sell/edit/${product.id}`)}
          className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title="Edit"
        >
          <Edit2 className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            if (confirm('Delete this listing?')) remove.mutate()
          }}
          disabled={remove.isPending}
          className="p-1.5 rounded-lg hover:bg-red-900/20 text-gray-400 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Incoming order card ──────────────────────────────────────────────────────

function IncomingOrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(order.seller_delivery_date ?? '')
  const [notes, setNotes] = useState(order.delivery_notes ?? '')
  const [photoUrl, setPhotoUrl] = useState('')
  const qc = useQueryClient()

  const next = sellerNextStatus(order.status)

  const advance = useMutation({
    mutationFn: () =>
      updateOrderStatus(order.id, {
        status: next!,
        delivery_date: deliveryDate || undefined,
        notes: notes || undefined,
        delivery_photo_url: photoUrl.trim() || undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'seller'] }),
  })

  const completePOS = useMutation({
    mutationFn: () =>
      updateOrderStatus(order.id, {
        status: 'confirmed',
        notes: 'Completed at point of sale',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'seller'] }),
  })

  const canCompletePOS =
    order.status === 'pending_payment' || order.status === 'paid'

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-gray-100 truncate">{order.product_title}</p>
          <p className="text-xs text-gray-400">
            {order.quantity} {order.unit} · {formatKes(order.total_kes)} · Buyer: {order.buyer_name}
          </p>
          {order.buyer_location_name && (
            <p className="text-xs text-gray-500">
              Deliver to: {order.buyer_location_name}
              {order.distance_km != null ? ` (${order.distance_km.toFixed(0)} km)` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={clsx(
            'text-xs font-semibold px-2 py-1 rounded-full',
            order.status === 'paid'            && 'bg-brand-500/20 text-brand-400',
            order.status === 'processing'      && 'bg-brand-500/20 text-brand-400',
            order.status === 'in_transit'      && 'bg-brand-500/20 text-brand-400',
            order.status === 'delivered'       && 'bg-yellow-900/20 text-yellow-400',
            order.status === 'confirmed'       && 'bg-mpesa/20 text-mpesa',
            order.status === 'pending_payment' && 'bg-gray-700 text-gray-400',
            order.status === 'cancelled'       && 'bg-red-900/20 text-red-400',
            order.status === 'disputed'        && 'bg-yellow-900/20 text-yellow-400',
          )}>
            {ORDER_STATUS_LABELS[order.status] ?? order.status}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          <OrderStatusSteps
            status={order.status}
            estimatedDate={order.estimated_delivery_date}
            sellerDate={order.seller_delivery_date}
          />

          {/* Pending payment: prompt seller to confirm receipt in their wallet */}
          {order.status === 'pending_payment' && (
            <div className="space-y-3 bg-brand-500/5 border border-brand-500/20 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-gray-100">Awaiting payment confirmation</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Check your Lightning wallet. If the buyer has already paid, confirm receipt here to start fulfilling the order.
                  </p>
                </div>
              </div>
              <button
                onClick={() => advance.mutate()}
                disabled={advance.isPending}
                className="btn-primary text-sm w-full justify-center"
              >
                <CheckCircle className="w-4 h-4" />
                {advance.isPending ? 'Confirming…' : 'Payment received in my wallet'}
              </button>
            </div>
          )}

          {/* Active fulfillment steps */}
          {next && order.status !== 'pending_payment' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-400">Delivery date</label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    className="input-base text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-400">Note to buyer</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional"
                    className="input-base text-sm"
                  />
                </div>
              </div>
              {next === 'delivered' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-400">Delivery photo URL (optional)</label>
                  <input
                    type="url"
                    value={photoUrl}
                    onChange={e => setPhotoUrl(e.target.value)}
                    placeholder="https://… (share link from your camera)"
                    className="input-base text-sm font-mono"
                  />
                  <p className="text-[11px] text-gray-600">Paste a link to a photo of the delivered goods as proof of delivery.</p>
                </div>
              )}

              <button
                onClick={() => advance.mutate()}
                disabled={advance.isPending}
                className="btn-primary text-sm"
              >
                {advance.isPending ? 'Updating…' : (
                  <>
                    {next === 'processing' && <><Package className="w-4 h-4" /> Mark as Preparing</>}
                    {next === 'in_transit' && <><Truck className="w-4 h-4" /> Mark as Shipped</>}
                    {next === 'delivered'  && <><CheckCircle className="w-4 h-4" /> Mark as Delivered</>}
                  </>
                )}
              </button>
            </div>
          )}

          {/* POS completion — seller completes in-person sale */}
          {canCompletePOS && (
            <div className="border-t border-gray-800 pt-3">
              <button
                onClick={() => completePOS.mutate()}
                disabled={completePOS.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-mpesa/20 border border-mpesa/30 text-mpesa hover:bg-mpesa/30 transition-colors disabled:opacity-50"
              >
                <ShoppingBag className="w-4 h-4" />
                {completePOS.isPending ? 'Completing…' : 'Complete Sale (In-Person)'}
              </button>
            </div>
          )}

          {/* Buyer ↔ seller messaging */}
          <div className="border-t border-gray-800 pt-3">
            <MessageThread orderId={order.id} />
          </div>

          <p className="text-[11px] text-gray-600">
            {new Date(order.created_at).toLocaleString('en-KE')}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function SellerDashboard() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'listings' | 'orders' | 'analytics'>('listings')
  const { farmerId, needsSetup } = useCurrentFarmer()

  const myProductsQuery = useQuery({
    queryKey: ['my-products', farmerId],
    queryFn: () => (farmerId ? listProducts({ seller_id: farmerId, per_page: 100 }) : []),
    enabled: !!farmerId,
    staleTime: 15_000,
  })

  const { data: incomingOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders', 'seller'],
    queryFn: () => listOrders('seller'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const analyticsQuery = useQuery({
    queryKey: ['analytics', farmerId],
    queryFn: () => (farmerId ? getFarmerAnalytics(farmerId) : null),
    enabled: !!farmerId && tab === 'analytics',
    staleTime: 60_000,
  })

  const ratingsQuery = useQuery({
    queryKey: ['seller-ratings', farmerId],
    queryFn: () => (farmerId ? getSellerRatings(farmerId) : null),
    enabled: !!farmerId && tab === 'analytics',
    staleTime: 60_000,
  })

  const activeOrders = incomingOrders.filter(o => !['confirmed', 'cancelled'].includes(o.status))
  const pastOrders = incomingOrders.filter(o => ['confirmed', 'cancelled'].includes(o.status))

  const products = myProductsQuery.data ?? []

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-100 leading-tight">My Listings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Manage products and incoming orders</p>
        </div>
        <button onClick={() => navigate('/sell/new')} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          New Listing
        </button>
      </div>

      {/* Lightning Address warning */}
      {needsSetup && (
        <button
          onClick={() => navigate('/profile?setup=1')}
          className="w-full flex gap-3 items-start bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 text-left hover:bg-yellow-900/30 transition-colors"
        >
          <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-yellow-300">Set your Lightning Address</p>
            <p className="text-xs text-yellow-500/80">
              Buyers cannot pay you until you add a Lightning Address. Tap to set it up.
            </p>
          </div>
        </button>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('listings')}
          className={clsx(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
            tab === 'listings' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          Listings {products.length > 0 && `(${products.length})`}
        </button>
        <button
          onClick={() => setTab('orders')}
          className={clsx(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors relative',
            tab === 'orders' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          Orders
          {activeOrders.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-500 text-[10px] text-white font-bold">
              {activeOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('analytics')}
          className={clsx(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
            tab === 'analytics' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Analytics
        </button>
      </div>

      {/* Listings tab */}
      {tab === 'listings' && (
        <div className="space-y-3">
          {myProductsQuery.isLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="card h-20 skeleton" />)}
            </div>
          )}
          {!myProductsQuery.isLoading && products.length === 0 && (
            <div className="text-center py-16 space-y-3">
              <Package className="w-12 h-12 text-gray-700 mx-auto" />
              <p className="text-gray-400 font-medium">No listings yet</p>
              <p className="text-sm text-gray-600">Create your first product listing to start selling</p>
              <button onClick={() => navigate('/sell/new')} className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                Create Listing
              </button>
            </div>
          )}
          {products.map(p => <ListingCard key={p.id} product={p} />)}
        </div>
      )}

      {/* Orders tab */}
      {tab === 'orders' && (
        <div className="space-y-6">
          {loadingOrders && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="card h-16 skeleton" />)}
            </div>
          )}

          {!loadingOrders && incomingOrders.length === 0 && (
            <div className="text-center py-16 space-y-2">
              <Package className="w-12 h-12 text-gray-700 mx-auto" />
              <p className="text-gray-400 font-medium">No orders received yet</p>
              <p className="text-sm text-gray-600">Orders will appear here when buyers purchase your products</p>
            </div>
          )}

          {activeOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active</h2>
              {activeOrders.map(o => <IncomingOrderCard key={o.id} order={o} />)}
            </section>
          )}

          {pastOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Completed / Cancelled</h2>
              {pastOrders.map(o => <IncomingOrderCard key={o.id} order={o} />)}
            </section>
          )}
        </div>
      )}

      {/* Analytics tab */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {analyticsQuery.isLoading && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="card h-20 skeleton" />)}
            </div>
          )}

          {analyticsQuery.isError && (
            <p className="text-sm text-red-400">Failed to load analytics. Please refresh.</p>
          )}

          {analyticsQuery.data && (
            <>
              {/* Seller rating summary */}
              {ratingsQuery.data && ratingsQuery.data.rating_count > 0 && (
                <div className="card p-4 flex items-center gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Rating</p>
                    <div className="flex items-center gap-2">
                      <StarRating rating={ratingsQuery.data.avg_rating} size="md" />
                      <span className="text-lg font-bold text-gray-100">
                        {ratingsQuery.data.avg_rating.toFixed(1)}
                      </span>
                      <span className="text-xs text-gray-500">
                        ({ratingsQuery.data.rating_count} review{ratingsQuery.data.rating_count !== 1 ? 's' : ''})
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">Total Revenue</p>
                  <p className="text-lg font-bold text-brand-400">
                    {formatKes(analyticsQuery.data.total_revenue_kes)}
                  </p>
                </div>
                <div className="card p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">Completed</p>
                  <p className="text-lg font-bold text-gray-100">
                    {analyticsQuery.data.completed_orders}
                  </p>
                </div>
                <div className="card p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">Pending</p>
                  <p className="text-lg font-bold text-yellow-400">
                    {analyticsQuery.data.pending_orders}
                  </p>
                </div>
                <div className="card p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">Avg Order</p>
                  <p className="text-lg font-bold text-gray-100">
                    {formatKes(analyticsQuery.data.avg_order_value_kes)}
                  </p>
                </div>
              </div>

              {/* Top Products bar chart */}
              {analyticsQuery.data.top_products.length > 0 && (() => {
                const maxRev = Math.max(...analyticsQuery.data.top_products.map(p => parseFloat(p.revenue_kes)))
                return (
                  <div className="card p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-brand-400" />
                      Top Products by Revenue
                    </h3>
                    <div className="space-y-2.5">
                      {analyticsQuery.data.top_products.map(p => {
                        const rev = parseFloat(p.revenue_kes)
                        const pct = maxRev > 0 ? (rev / maxRev) * 100 : 0
                        return (
                          <div key={p.product_id} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-200 truncate max-w-[55%]">{p.title}</span>
                              <span className="text-brand-400 font-semibold tabular-nums">{formatKes(p.revenue_kes)}</span>
                            </div>
                            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-brand-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-gray-600">
                              {parseFloat(p.units_sold).toLocaleString()} units · {p.order_count} order{p.order_count !== 1 ? 's' : ''}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Revenue area chart */}
              {analyticsQuery.data.monthly_revenue.length > 0 && (() => {
                const chartData = analyticsQuery.data.monthly_revenue.map(m => ({
                  month: m.month.slice(0, 7), // "2026-04"
                  revenue: parseFloat(m.revenue_kes),
                  orders: m.order_count,
                }))
                return (
                  <div className="card p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-brand-400" />
                      Revenue &amp; Orders (Last 6 Months)
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#d97b18" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#d97b18" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                          labelStyle={{ color: '#e5e7eb', fontSize: 12 }}
                          formatter={(v: number, name: string) => [
                            name === 'revenue' ? `KES ${v.toLocaleString()}` : v,
                            name === 'revenue' ? 'Revenue' : 'Orders',
                          ]}
                        />
                        <Legend formatter={v => v === 'revenue' ? 'Revenue (KES)' : 'Orders'} wrapperStyle={{ fontSize: 11 }} />
                        <Area type="monotone" dataKey="revenue" stroke="#d97b18" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>

                    {/* Order count bar chart */}
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={chartData} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} allowDecimals={false} width={24} />
                        <Tooltip
                          contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                          labelStyle={{ color: '#e5e7eb', fontSize: 12 }}
                          formatter={(v: number) => [v, 'Orders']}
                        />
                        <Bar dataKey="orders" fill="#4ade80" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )
              })()}

              {/* Recent Orders */}
              {analyticsQuery.data.recent_orders.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800">
                    <h3 className="text-sm font-semibold text-gray-200">Recent Orders</h3>
                  </div>
                  <div className="divide-y divide-gray-800/50">
                    {analyticsQuery.data.recent_orders.map(o => (
                      <div key={o.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-sm text-gray-200 truncate">{o.product_title}</p>
                          <p className="text-xs text-gray-500">
                            {o.buyer_name} · {o.quantity} {o.unit}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <p className="text-sm font-medium text-gray-100">{formatKes(o.total_kes)}</p>
                          <span className={clsx(
                            'text-[11px] font-medium px-1.5 py-0.5 rounded-full',
                            o.status === 'confirmed'       && 'bg-mpesa/20 text-mpesa',
                            o.status === 'cancelled'       && 'bg-red-900/20 text-red-400',
                            o.status === 'pending_payment' && 'bg-gray-700 text-gray-400',
                            !['confirmed', 'cancelled', 'pending_payment'].includes(o.status) && 'bg-brand-500/20 text-brand-400',
                          )}>
                            {o.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analyticsQuery.data.total_orders === 0 && (
                <div className="text-center py-16 space-y-2">
                  <TrendingUp className="w-12 h-12 text-gray-700 mx-auto" />
                  <p className="text-gray-400 font-medium">No sales data yet</p>
                  <p className="text-sm text-gray-600">Analytics will appear as orders are completed</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
