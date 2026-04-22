import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Package, Edit2, Trash2, ChevronDown, ChevronUp,
  Truck, CheckCircle, Eye, EyeOff, AlertCircle, Zap,
  ShoppingBag, TrendingUp, Boxes, Tag, Copy, Check, X,
  BarChart2, Star, ShieldAlert,
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
import { useSellerPromoCodes } from '../hooks/usePromoCode.ts'
import { useToast } from '../context/toast.tsx'
import OrderStatusSteps from './OrderStatusSteps.tsx'
import MessageThread from './MessageThread.tsx'
import StarRating from './StarRating.tsx'
import SellerTierBadge, { computeTier } from './SellerTierBadge.tsx'
import EmptyState from './EmptyState.tsx'
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
        {product.low_stock_threshold !== null &&
          parseFloat(product.quantity_avail) <= parseFloat(product.low_stock_threshold ?? '0') && (
          <p className="text-[11px] text-yellow-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Low stock
          </p>
        )}
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

// ─── Fraud risk scoring ───────────────────────────────────────────────────────

function computeRisk(order: Order, allOrders: Order[]): { level: 'low' | 'medium' | 'high'; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  const totalKes = parseFloat(order.total_kes)
  if (totalKes > 50_000) { score += 2; reasons.push('High order value (>KES 50k)') }
  else if (totalKes > 20_000) { score += 1; reasons.push('Large order value (>KES 20k)') }

  const buyerOrders = allOrders.filter(o => o.buyer_name === order.buyer_name)
  if (buyerOrders.length >= 3) { score += 1; reasons.push('Buyer has 3+ orders in this session') }

  const orderedAt = new Date(order.created_at).getTime()
  const recentFromSameBuyer = buyerOrders.filter(o =>
    o.id !== order.id &&
    Math.abs(new Date(o.created_at).getTime() - orderedAt) < 60 * 60 * 1000,
  )
  if (recentFromSameBuyer.length >= 2) { score += 2; reasons.push('Multiple orders within 1 hour') }

  const maxQty = parseFloat(order.quantity)
  if (maxQty >= 50) { score += 1; reasons.push('Unusually large quantity') }

  return {
    level: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
    reasons,
  }
}

// ─── Incoming order card ──────────────────────────────────────────────────────

function IncomingOrderCard({ order, allOrders }: { order: Order; allOrders: Order[] }) {
  const [expanded, setExpanded] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(order.seller_delivery_date ?? '')
  const [notes, setNotes] = useState(order.delivery_notes ?? '')
  const [photoUrl, setPhotoUrl] = useState('')
  const qc = useQueryClient()

  const next = sellerNextStatus(order.status)
  const risk = computeRisk(order, allOrders)

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

        <div className="flex items-center gap-2 shrink-0">
          {risk.level !== 'low' && (
            <span
              className={clsx(
                'flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                risk.level === 'high'
                  ? 'bg-red-900/30 text-red-400 border-red-700/30'
                  : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
              )}
              title={risk.reasons.join(' · ')}
            >
              <ShieldAlert className="w-3 h-3" />
              {risk.level === 'high' ? 'High risk' : 'Review'}
            </span>
          )}
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
          {risk.level !== 'low' && (
            <div className={clsx(
              'flex items-start gap-2 rounded-xl px-3 py-2.5 border text-xs',
              risk.level === 'high'
                ? 'bg-red-900/20 border-red-700/30 text-red-400'
                : 'bg-yellow-900/20 border-yellow-700/30 text-yellow-400',
            )}>
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Risk signals detected</p>
                <ul className="space-y-0.5 opacity-80">
                  {risk.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                </ul>
                <p className="mt-1 opacity-60">Verify buyer identity before fulfilling. You are not required to ship to high-risk orders.</p>
              </div>
            </div>
          )}
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

// ─── Inventory tab ────────────────────────────────────────────────────────────

function InventoryTab({ products, loading }: { products: Product[]; loading: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const toggleStatus = useMutation({
    mutationFn: (p: Product) =>
      updateProduct(p.id, { status: p.status === 'active' ? 'paused' : 'active' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-products'] }),
  })

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse bg-gray-800" />)}
      </div>
    )
  }

  if (!products.length) {
    return (
      <EmptyState
        icon={<Boxes className="w-6 h-6" />}
        title="No products yet"
        description="Create your first listing to start tracking inventory."
        action={<button onClick={() => navigate('/sell/new')} className="btn-primary text-sm"><Plus className="w-4 h-4" />New Listing</button>}
      />
    )
  }

  const lowStock  = products.filter(p => p.low_stock_threshold !== null && parseFloat(p.quantity_avail) <= parseFloat(p.low_stock_threshold ?? '0') && p.status === 'active')
  const outOfStock = products.filter(p => parseFloat(p.quantity_avail) <= 0)
  const paused    = products.filter(p => p.status === 'paused')
  const active    = products.filter(p => p.status === 'active' && parseFloat(p.quantity_avail) > 0)

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active',      count: active.length,    color: 'text-mpesa',    bg: 'bg-mpesa/10 border-mpesa/20' },
          { label: 'Low Stock',   count: lowStock.length,  color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/30' },
          { label: 'Out of Stock',count: outOfStock.length,color: 'text-red-400',  bg: 'bg-red-900/20 border-red-700/30' },
          { label: 'Paused',      count: paused.length,    color: 'text-gray-400', bg: 'bg-gray-800 border-gray-700' },
        ].map(s => (
          <div key={s.label} className={clsx('rounded-xl border p-3 space-y-0.5', s.bg)}>
            <p className={clsx('text-2xl font-bold', s.color)}>{s.count}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Low stock alerts */}
      {lowStock.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Low Stock Alerts
          </p>
          {lowStock.map(p => (
            <div key={p.id} className="flex items-center gap-4 bg-yellow-900/10 border border-yellow-700/20 rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-100 truncate">{p.title}</p>
                <p className="text-xs text-yellow-400">{p.quantity_avail} {p.unit} left (threshold: {p.low_stock_threshold})</p>
              </div>
              <button
                onClick={() => navigate(`/sell/edit/${p.id}`)}
                className="btn-secondary text-xs px-3 py-1.5 shrink-0"
              >
                <Edit2 className="w-3 h-3" /> Restock
              </button>
            </div>
          ))}
        </div>
      )}

      {/* All products stock table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-sm font-semibold text-gray-200">All Products — Stock Levels</p>
        </div>
        <div className="divide-y divide-gray-800/50">
          {products.map(p => {
            const qty     = parseFloat(p.quantity_avail)
            const thresh  = p.low_stock_threshold ? parseFloat(p.low_stock_threshold) : null
            const maxVis  = Math.max(qty, thresh ?? 0, 20)
            const pct     = maxVis > 0 ? Math.min(100, (qty / maxVis) * 100) : 0
            const barColor =
              qty <= 0            ? 'bg-red-500' :
              thresh && qty <= thresh ? 'bg-yellow-500' :
                                        'bg-mpesa'
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm text-gray-200 truncate">{p.title}</p>
                    <span className={clsx(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
                      p.status === 'active'   ? 'bg-mpesa/20 text-mpesa' :
                      p.status === 'paused'   ? 'bg-gray-700 text-gray-400' :
                                                'bg-red-900/20 text-red-400',
                    )}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">{qty} {p.unit}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleStatus.mutate(p)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    title={p.status === 'active' ? 'Pause' : 'Activate'}
                  >
                    {p.status === 'active' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => navigate(`/sell/edit/${p.id}`)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Promo Codes tab ──────────────────────────────────────────────────────────

function PromoCodesTab({ farmerId }: { farmerId: string }) {
  const { codes, addCode, removeCode } = useSellerPromoCodes(farmerId)
  const { toast } = useToast()
  const [form, setForm] = useState({ code: '', type: 'percent' as 'percent' | 'fixed', value: '', description: '' })
  const [copied, setCopied] = useState<string | null>(null)

  function handleCreate() {
    const val = parseFloat(form.value)
    if (!form.code.trim() || isNaN(val) || val <= 0) {
      toast('Enter a valid code and discount value', 'error')
      return
    }
    if (form.type === 'percent' && val > 100) {
      toast('Percentage must be 100 or less', 'error')
      return
    }
    addCode({ code: form.code, type: form.type, value: val, description: form.description.trim() })
    setForm({ code: '', type: 'percent', value: '', description: '' })
    toast('Promo code created!', 'success')
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
    toast('Code copied to clipboard', 'info', 2000)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 bg-brand-500/10 border border-brand-500/20 rounded-xl px-4 py-3">
        <Tag className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-brand-300">Share discount codes with buyers</p>
          <p className="text-xs text-brand-400/70 mt-0.5 leading-snug">
            Create codes your buyers enter at checkout. Copy and share via WhatsApp, SMS, or social media.
          </p>
        </div>
      </div>

      {/* Create form */}
      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-200">Create New Code</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Code</label>
            <input
              type="text"
              placeholder="SAVE20"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              className="input-base font-mono uppercase"
              maxLength={12}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Type</label>
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
              {(['percent', 'fixed'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={clsx(
                    'flex-1 py-1.5 rounded-md text-xs font-medium transition-colors',
                    form.type === t ? 'bg-gray-700 text-gray-100' : 'text-gray-400',
                  )}
                >
                  {t === 'percent' ? '% Off' : 'KES Off'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">
              {form.type === 'percent' ? 'Discount (%)' : 'Discount (KES)'}
            </label>
            <input
              type="number"
              placeholder={form.type === 'percent' ? '20' : '500'}
              value={form.value}
              onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              min={1}
              max={form.type === 'percent' ? 100 : undefined}
              className="input-base"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Label (optional)</label>
            <input
              type="text"
              placeholder="New customer offer"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="input-base"
              maxLength={40}
            />
          </div>
        </div>
        <button onClick={handleCreate} className="btn-primary text-sm">
          <Plus className="w-4 h-4" /> Create Code
        </button>
      </div>

      {/* Active codes */}
      {codes.length === 0 ? (
        <EmptyState
          icon={<Tag className="w-6 h-6" />}
          title="No promo codes yet"
          description="Create your first code above and share it with buyers."
        />
      ) : (
        <div className="space-y-2">
          {codes.map(c => (
            <div key={c.code} className="card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono font-bold text-brand-400 text-sm">{c.code}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/20">
                    {c.type === 'percent' ? `${c.value}% off` : `KES ${c.value} off`}
                  </span>
                </div>
                {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
                <p className="text-[10px] text-gray-700 mt-0.5">
                  Created {new Date(c.createdAt).toLocaleDateString('en-KE')}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => copyCode(c.code)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                  title="Copy code"
                >
                  {copied === c.code ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { removeCode(c.code); toast('Code removed', 'info', 2000) }}
                  className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                  title="Delete"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function SellerDashboard() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'listings' | 'orders' | 'inventory' | 'promos' | 'analytics'>('listings')
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
    enabled: !!farmerId,
    staleTime: 60_000,
  })

  const ratingsQuery = useQuery({
    queryKey: ['seller-ratings', farmerId],
    queryFn: () => (farmerId ? getSellerRatings(farmerId) : null),
    enabled: !!farmerId,
    staleTime: 60_000,
  })

  const activeOrders = incomingOrders.filter(o => !['confirmed', 'cancelled'].includes(o.status))
  const pastOrders = incomingOrders.filter(o => ['confirmed', 'cancelled'].includes(o.status))

  const products = myProductsQuery.data ?? []

  // Seller tier — computed when analytics data is available
  const tier = analyticsQuery.data && ratingsQuery.data
    ? computeTier(analyticsQuery.data.completed_orders, ratingsQuery.data.avg_rating)
    : null

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100 leading-tight">Seller Dashboard</h1>
          <p className="text-xs text-gray-500">{products.length} listing{products.length !== 1 ? 's' : ''} · {activeOrders.length} active order{activeOrders.length !== 1 ? 's' : ''}</p>
          {tier && (
            <SellerTierBadge
              completedOrders={analyticsQuery.data!.completed_orders}
              avgRating={ratingsQuery.data!.avg_rating}
              size="sm"
            />
          )}
        </div>
        <button onClick={() => navigate('/sell/new')} className="btn-primary text-sm shrink-0">
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

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-xl overflow-x-auto scrollbar-none">
        {[
          { key: 'listings',  label: 'Listings',  icon: <ShoppingBag className="w-3.5 h-3.5" />,  badge: products.length || undefined },
          { key: 'orders',    label: 'Orders',    icon: <Package className="w-3.5 h-3.5" />,       badge: activeOrders.length || undefined },
          { key: 'inventory', label: 'Inventory', icon: <Boxes className="w-3.5 h-3.5" />,         badge: undefined },
          { key: 'promos',    label: 'Promos',    icon: <Tag className="w-3.5 h-3.5" />,           badge: undefined },
          { key: 'analytics', label: 'Analytics', icon: <BarChart2 className="w-3.5 h-3.5" />,    badge: undefined },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
              tab === t.key ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            {t.icon}
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={clsx(
                'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold',
                tab === t.key ? 'bg-brand-500 text-white' : 'bg-gray-600 text-gray-300',
              )}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Listings tab */}
      {tab === 'listings' && (
        <div className="space-y-3">
          {myProductsQuery.isLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-800" />)}
            </div>
          )}
          {!myProductsQuery.isLoading && products.length === 0 && (
            <EmptyState
              icon={<ShoppingBag className="w-6 h-6" />}
              title="No listings yet"
              description="Create your first product listing to start selling on SokoPay."
              action={<button onClick={() => navigate('/sell/new')} className="btn-primary text-sm"><Plus className="w-4 h-4" />Create Listing</button>}
            />
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
            <EmptyState
              icon={<Package className="w-6 h-6" />}
              title="No orders yet"
              description="Orders will appear here when buyers purchase your products."
            />
          )}

          {activeOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active</h2>
              {activeOrders.map(o => <IncomingOrderCard key={o.id} order={o} allOrders={incomingOrders} />)}
            </section>
          )}

          {pastOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Completed / Cancelled</h2>
              {pastOrders.map(o => <IncomingOrderCard key={o.id} order={o} allOrders={incomingOrders} />)}
            </section>
          )}
        </div>
      )}

      {/* Inventory tab */}
      {tab === 'inventory' && (
        <InventoryTab products={products} loading={myProductsQuery.isLoading} />
      )}

      {/* Promos tab */}
      {tab === 'promos' && farmerId && (
        <PromoCodesTab farmerId={farmerId} />
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
              {/* Seller Score Card */}
              {ratingsQuery.data && (
                <div className="card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <SellerTierBadge
                        completedOrders={analyticsQuery.data.completed_orders}
                        avgRating={ratingsQuery.data.avg_rating}
                        size="md"
                        showProgress
                      />
                    </div>
                  </div>
                  {ratingsQuery.data.rating_count > 0 && (
                    <div className="flex items-center gap-3 shrink-0 border-t sm:border-t-0 sm:border-l border-gray-800 pt-3 sm:pt-0 sm:pl-5 w-full sm:w-auto">
                      <div className="space-y-0.5">
                        <p className="text-xs text-gray-500">Seller Rating</p>
                        <div className="flex items-center gap-1.5">
                          <StarRating rating={ratingsQuery.data.avg_rating} size="md" />
                          <span className="text-lg font-bold text-gray-100">{ratingsQuery.data.avg_rating.toFixed(1)}</span>
                          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                        </div>
                        <p className="text-xs text-gray-600">{ratingsQuery.data.rating_count} review{ratingsQuery.data.rating_count !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  )}
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
                <EmptyState
                  icon={<TrendingUp className="w-6 h-6" />}
                  title="No sales data yet"
                  description="Your analytics and charts will appear as orders come in."
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
