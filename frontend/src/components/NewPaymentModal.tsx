import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  X,
  Zap,
  ChevronDown,
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { getFarmers, createPayment, getRate } from '../api/client.ts'
import type { Farmer, CreatePaymentResponse } from '../types'
import { CROP_TYPES } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSats(n: number) {
  return n.toLocaleString('en-US')
}

// ─── Farmer Dropdown ──────────────────────────────────────────────────────────

interface FarmerSelectProps {
  farmers: Farmer[]
  value: string
  onChange: (id: string) => void
  error?: string
}

function FarmerSelect({ farmers, value, onChange, error }: FarmerSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(
    () =>
      farmers.filter(
        (f) =>
          f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.phone.includes(search) ||
          f.cooperative.toLowerCase().includes(search.toLowerCase()),
      ),
    [farmers, search],
  )

  const selected = farmers.find((f) => f.id === value)

  function choose(f: Farmer) {
    onChange(f.id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-gray-800 border rounded-lg
          text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500
          ${error ? 'border-red-500' : 'border-gray-700 hover:border-gray-600'}`}
      >
        {selected ? (
          <div>
            <p className="text-sm font-medium text-gray-200">{selected.name}</p>
            <p className="text-[11px] text-gray-500">
              {selected.phone} · {selected.cooperative}
            </p>
          </div>
        ) : (
          <span className="text-sm text-gray-500">Select a farmer…</span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-500 shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-700">
            <input
              autoFocus
              type="text"
              placeholder="Search by name, phone or cooperative…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm
                text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No farmers found</p>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => choose(f)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-brand-400">
                      {f.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-200">{f.name}</p>
                    <p className="text-[11px] text-gray-500">
                      {f.phone} · {f.cooperative}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}

// ─── Success Screen ───────────────────────────────────────────────────────────

interface SuccessScreenProps {
  result: CreatePaymentResponse
  farmerName: string
  onClose: () => void
}

function SuccessScreen({ result, farmerName, onClose }: SuccessScreenProps) {
  const [copied, setCopied] = useState(false)
  const payUrl = result.btcpay_payment_url

  function copyUrl() {
    if (!payUrl) return
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="px-6 py-5">
      {/* Success header */}
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-full bg-mpesa/20 border-2 border-mpesa/40 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-7 h-7 text-mpesa" />
        </div>
        <h3 className="text-base font-semibold text-gray-100 mb-1">Payment Created!</h3>
        <p className="text-sm text-gray-400">
          Share the BTCPay invoice link with the buyer to receive payment.
        </p>
      </div>

      {/* Summary */}
      <div className="bg-gray-800/60 rounded-xl border border-gray-700 p-4 mb-5 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Farmer</span>
          <span className="text-gray-200 font-medium">{farmerName}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Amount (KES)</span>
          <span className="text-gray-200 font-medium">
            KES {parseFloat(result.payment.amount_kes).toLocaleString('en-KE')}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Amount (sats)</span>
          <span className="text-amber-400 font-mono font-semibold">
            {fmtSats(result.payment.amount_sats)} sats
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Rate</span>
          <span className="text-gray-400">
            {parseFloat(result.payment.rate_used).toLocaleString('en-KE')} KES/BTC
          </span>
        </div>
      </div>

      {/* QR Code / payment URL */}
      {payUrl ? (
        <>
          <div className="flex flex-col items-center mb-5">
            <p className="text-xs text-gray-500 mb-3">BTCPay Invoice QR Code</p>
            <div className="bg-white p-3 rounded-xl shadow-lg">
              <QRCodeSVG
                value={payUrl}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-[11px] text-gray-600 mt-2 text-center">
              Scan or open the link to pay with any Bitcoin wallet
            </p>
          </div>

          {/* Payment URL */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Payment Link
              </span>
              <div className="flex items-center gap-1.5">
                <a
                  href={payUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </a>
                <button
                  onClick={copyUrl}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    copied
                      ? 'bg-mpesa/20 text-mpesa border border-green-600/30'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
                  }`}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 font-mono break-all leading-relaxed">
              {payUrl}
            </p>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-500 mb-5">
          No payment URL available — BTCPay Server may be offline.
        </div>
      )}

      <button onClick={onClose} className="btn-secondary w-full justify-center">
        Done
      </button>
    </div>
  )
}

// ─── Form ─────────────────────────────────────────────────────────────────────

interface FormState {
  farmer_id: string
  amount_kes: string
  crop_type: string
  notes: string
}

interface FormErrors {
  farmer_id?: string
  amount_kes?: string
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface NewPaymentModalProps {
  onClose: () => void
  onSuccess: () => void
}

export default function NewPaymentModal({ onClose, onSuccess }: NewPaymentModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>({
    farmer_id: '',
    amount_kes: '',
    crop_type: '',
    notes: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [result, setResult] = useState<CreatePaymentResponse | null>(null)

  const { data: farmers = [], isLoading: farmersLoading } = useQuery({
    queryKey: ['farmers'],
    queryFn: getFarmers,
  })

  const { data: rate } = useQuery({
    queryKey: ['rate'],
    queryFn: getRate,
    staleTime: 60_000,
  })

  const selectedFarmer = farmers.find((f) => f.id === form.farmer_id)

  // Live sats preview
  const estimatedSats = useMemo(() => {
    const kes = parseFloat(form.amount_kes)
    if (!kes || !rate || kes <= 0) return null
    return Math.round((kes / parseFloat(rate.btc_kes)) * 100_000_000)
  }, [form.amount_kes, rate])

  const mutation = useMutation({
    mutationFn: createPayment,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      setResult(data)
      onSuccess()
    },
  })

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.farmer_id) e.farmer_id = 'Please select a farmer'
    const kes = parseFloat(form.amount_kes)
    if (!form.amount_kes || isNaN(kes) || kes <= 0) {
      e.amount_kes = 'Enter a valid amount in KES'
    } else if (kes < 10) {
      e.amount_kes = 'Minimum amount is KES 10'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    mutation.mutate({
      farmer_id: form.farmer_id,
      amount_kes: form.amount_kes,
      crop_type: form.crop_type || undefined,
      notes: form.notes.trim() || undefined,
    })
  }

  const setField = useCallback(
    <K extends keyof FormState>(key: K) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [key]: e.target.value }))
        if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }))
      },
    [errors],
  )

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">New Payment</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Create a BTCPay invoice for a farmer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {result ? (
          <SuccessScreen
            result={result}
            farmerName={selectedFarmer?.name ?? 'Farmer'}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {/* Mutation error */}
            {mutation.isError && (
              <div className="flex items-center gap-3 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{(mutation.error as Error).message}</span>
              </div>
            )}

            {/* Farmer select */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Farmer <span className="text-red-500">*</span>
              </label>
              {farmersLoading ? (
                <div className="skeleton h-10 rounded-lg" />
              ) : farmers.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 border border-gray-700 rounded-lg text-sm text-gray-500">
                  <AlertCircle className="w-4 h-4" />
                  No farmers registered. Add a farmer first.
                </div>
              ) : (
                <FarmerSelect
                  farmers={farmers}
                  value={form.farmer_id}
                  onChange={(id) => {
                    setForm((prev) => ({ ...prev, farmer_id: id }))
                    setErrors((prev) => ({ ...prev, farmer_id: undefined }))
                  }}
                  error={errors.farmer_id}
                />
              )}
            </div>

            {/* Amount KES */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Amount (KES) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-medium">
                  KES
                </span>
                <input
                  type="number"
                  min="10"
                  step="1"
                  placeholder="5000"
                  className={`input-base pl-12 ${errors.amount_kes ? 'border-red-500 focus:ring-red-500' : ''}`}
                  value={form.amount_kes}
                  onChange={setField('amount_kes')}
                />
              </div>
              {errors.amount_kes && (
                <p className="text-xs text-red-400 mt-1">{errors.amount_kes}</p>
              )}

              {/* Live sats preview */}
              {estimatedSats !== null && (
                <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs text-gray-400">≈</span>
                  <span className="text-sm font-bold text-amber-400 font-mono">
                    {fmtSats(estimatedSats)} sats
                  </span>
                  <ArrowRight className="w-3 h-3 text-gray-600" />
                  <span className="text-xs text-gray-500">via Bitcoin</span>
                  {rate && (
                    <span className="ml-auto text-[11px] text-gray-600">
                      @ {parseFloat(rate.btc_kes).toLocaleString('en-KE')} KES/BTC
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Crop type */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Crop Type <span className="text-gray-600">(optional)</span>
              </label>
              <select
                className="input-base"
                value={form.crop_type}
                onChange={setField('crop_type')}
              >
                <option value="">Select crop type…</option>
                {CROP_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Notes <span className="text-gray-600">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Add any notes about this payment…"
                className="input-base resize-none"
                value={form.notes}
                onChange={setField('notes')}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={mutation.isPending || farmers.length === 0}
                className="btn-primary flex-1 justify-center"
              >
                {mutation.isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Create Payment
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
                disabled={mutation.isPending}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
