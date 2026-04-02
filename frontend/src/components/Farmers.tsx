import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, X, CheckCircle2, AlertCircle, ExternalLink, Phone, Building2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getFarmers, createFarmer } from '../api/client.ts'
import type { Farmer, CreateFarmerPayload } from '../types'

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

let toastId = 0

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium pointer-events-auto
            transition-all duration-300 animate-in slide-in-from-right-5 ${
              t.type === 'success'
                ? 'bg-gray-900 border-green-600/40 text-green-300'
                : 'bg-gray-900 border-red-600/40 text-red-300'
            }`}
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{t.message}</span>
          <button
            onClick={() => onRemove(t.id)}
            className="ml-2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Add Farmer Modal ─────────────────────────────────────────────────────────

interface AddFarmerModalProps {
  onClose: () => void
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}

function AddFarmerModal({ onClose, onSuccess, onError }: AddFarmerModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<CreateFarmerPayload>({
    name: '',
    phone: '',
    cooperative: '',
  })
  const [errors, setErrors] = useState<Partial<CreateFarmerPayload>>({})

  const mutation = useMutation({
    mutationFn: createFarmer,
    onSuccess: (farmer) => {
      qc.invalidateQueries({ queryKey: ['farmers'] })
      onSuccess(`Farmer "${farmer.name}" added successfully!`)
      onClose()
    },
    onError: (err: Error) => {
      onError(err.message)
    },
  })

  function validate(): boolean {
    const e: Partial<CreateFarmerPayload> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.phone.trim()) {
      e.phone = 'Phone is required'
    } else if (!/^(\+254|0)[17]\d{8}$/.test(form.phone.replace(/\s/g, ''))) {
      e.phone = 'Enter a valid Kenya mobile number (e.g. 0712 345678)'
    }
    if (!form.cooperative.trim()) e.cooperative = 'Cooperative is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    mutation.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      cooperative: form.cooperative.trim(),
    })
  }

  function field(key: keyof CreateFarmerPayload) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((prev) => ({ ...prev, [key]: e.target.value }))
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
      },
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-100">Add Farmer</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Register a new farmer for Lightning payments
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Jane Wanjiku"
              className={`input-base ${errors.name ? 'border-red-500 focus:ring-red-500' : ''}`}
              {...field('name')}
            />
            {errors.name && (
              <p className="text-xs text-red-400 mt-1">{errors.name}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="tel"
                placeholder="0712 345 678 or +254712345678"
                className={`input-base pl-9 ${errors.phone ? 'border-red-500 focus:ring-red-500' : ''}`}
                {...field('phone')}
              />
            </div>
            {errors.phone ? (
              <p className="text-xs text-red-400 mt-1">{errors.phone}</p>
            ) : (
              <p className="text-[11px] text-gray-600 mt-1">
                Kenya Safaricom/Airtel number. M-Pesa payments will be sent here.
              </p>
            )}
          </div>

          {/* Cooperative */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Cooperative / Farm Group <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="e.g. Kirinyaga Tea Growers"
                className={`input-base pl-9 ${errors.cooperative ? 'border-red-500 focus:ring-red-500' : ''}`}
                {...field('cooperative')}
              />
            </div>
            {errors.cooperative && (
              <p className="text-xs text-red-400 mt-1">{errors.cooperative}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="btn-primary flex-1"
            >
              {mutation.isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Adding farmer…
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Farmer
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
      </div>
    </div>
  )
}

// ─── Farmers Page ─────────────────────────────────────────────────────────────

export default function Farmers() {
  const [showModal, setShowModal] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const { data: farmers = [], isLoading } = useQuery<Farmer[]>({
    queryKey: ['farmers'],
    queryFn: getFarmers,
  })

  function addToast(type: Toast['type'], message: string) {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // Close modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Farmers</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isLoading ? '…' : `${farmers.length} registered farmer${farmers.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Farmer
          </button>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-12 rounded" />
              ))}
            </div>
          ) : farmers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Users className="w-10 h-10 text-gray-700 mb-3" />
              <p className="text-sm font-medium text-gray-400">No farmers registered yet</p>
              <p className="text-xs text-gray-600 mt-1 mb-4">
                Add your first farmer to start processing Lightning payments
              </p>
              <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                Add First Farmer
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>Phone</th>
                    <th>Cooperative</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {farmers.map((farmer) => (
                    <tr key={farmer.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-brand-400">
                              {farmer.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-200">{farmer.name}</p>
                            <p className="text-[11px] text-gray-600 font-mono">{farmer.id.slice(0, 8)}…</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-sm text-gray-300">{farmer.phone}</span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 text-xs border border-gray-700">
                          <Building2 className="w-3 h-3 text-gray-500" />
                          {farmer.cooperative}
                        </span>
                      </td>
                      <td className="text-gray-500 text-xs">
                        {formatDistanceToNow(new Date(farmer.created_at), { addSuffix: true })}
                      </td>
                      <td>
                        <a
                          href={`/payments?farmer=${farmer.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg border border-blue-500/20 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View Payments
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <AddFarmerModal
          onClose={() => setShowModal(false)}
          onSuccess={(msg) => addToast('success', msg)}
          onError={(msg) => addToast('error', msg)}
        />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  )
}
