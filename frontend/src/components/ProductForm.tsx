import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, X, MapPin, Loader2, Globe, ImagePlus } from 'lucide-react'
import {
  getProduct, createProduct, updateProduct,
  uploadProductImage, deleteProductImage,
} from '../api/client.ts'
import { PRODUCT_CATEGORIES, PRODUCT_UNITS, CATEGORY_ICONS } from '../types'
import SmartDescriptionGenerator from './SmartDescriptionGenerator.tsx'
import AIPriceSuggestion from './AIPriceSuggestion.tsx'
import clsx from 'clsx'

const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GH', name: 'Ghana' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  { code: 'SN', name: 'Senegal' },
  { code: 'CI', name: "Côte d'Ivoire" },
]

export default function ProductForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEdit = !!id

  const [title, setTitle]               = useState('')
  const [description, setDescription]   = useState('')
  const [priceKes, setPriceKes]         = useState('')
  const [unit, setUnit]                 = useState('kg')
  const [quantity, setQuantity]         = useState('')
  const [category, setCategory]         = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationLat, setLocationLat]   = useState<number | undefined>()
  const [locationLng, setLocationLng]   = useState<number | undefined>()
  const [locating, setLocating]         = useState(false)
  const [countryCode, setCountryCode]         = useState('KE')
  const [isGlobal, setIsGlobal]               = useState(false)
  const [lowStockThreshold, setLowStockThreshold] = useState('')
  const [escrowMode, setEscrowMode] = useState(false)

  const [pendingImages, setPendingImages]     = useState<File[]>([])
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [error, setError] = useState<string | null>(null)

  const { data: existing } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id!),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) {
      setTitle(existing.title)
      setDescription(existing.description)
      setPriceKes(existing.price_kes)
      setUnit(existing.unit)
      setQuantity(existing.quantity_avail)
      setCategory(existing.category)
      setLocationName(existing.location_name)
      if (existing.country_code) setCountryCode(existing.country_code)
      setIsGlobal(existing.is_global ?? false)
      if (existing.low_stock_threshold) setLowStockThreshold(existing.low_stock_threshold)
      setEscrowMode(existing.escrow_mode ?? false)
    }
  }, [existing])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const total = pendingImages.length + (existing?.images.length ?? 0)
    const allowed = Math.min(files.length, 5 - total)
    if (allowed <= 0) return

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const MAX_SIZE_MB   = 10

    const valid: File[] = []
    const errors: string[] = []

    for (const f of files.slice(0, allowed)) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        errors.push(`${f.name}: not a supported image (JPEG, PNG, WebP, GIF)`)
        continue
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        errors.push(`${f.name}: exceeds ${MAX_SIZE_MB} MB limit`)
        continue
      }
      valid.push(f)
    }

    if (errors.length) alert(errors.join('\n'))
    if (!valid.length) { e.target.value = ''; return }

    setPendingImages(prev => [...prev, ...valid])
    valid.forEach(f => setPendingPreviews(prev => [...prev, URL.createObjectURL(f)]))
    e.target.value = ''
  }

  function removePendingImage(idx: number) {
    URL.revokeObjectURL(pendingPreviews[idx])
    setPendingImages(prev => prev.filter((_, i) => i !== idx))
    setPendingPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleGetLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocationLat(pos.coords.latitude)
        setLocationLng(pos.coords.longitude)
        setLocating(false)
      },
      () => setLocating(false),
    )
  }

  const save = useMutation({
    mutationFn: async () => {
      setError(null)
      if (!title.trim()) throw new Error('Title is required')
      if (!priceKes || parseFloat(priceKes) <= 0) throw new Error('Price must be a positive number')
      if (!quantity || parseFloat(quantity) < 0) throw new Error('Quantity must be 0 or more')

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        price_kes: priceKes,
        unit,
        quantity_avail: quantity,
        low_stock_threshold: lowStockThreshold ? lowStockThreshold : null,
        escrow_mode: escrowMode,
        category: category || undefined,
        location_name: locationName.trim() || undefined,
        location_lat: locationLat,
        location_lng: locationLng,
        country_code: countryCode || undefined,
        is_global: isGlobal,
      }

      let productId: string
      if (isEdit && existing) {
        await updateProduct(existing.id, payload)
        productId = existing.id
      } else {
        const p = await createProduct(payload)
        productId = p.id
      }

      if (pendingImages.length > 0) {
        setUploadingImages(true)
        for (const file of pendingImages) {
          await uploadProductImage(productId, file)
        }
        setUploadingImages(false)
      }
      return productId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home-new-arrivals'] })
      queryClient.invalidateQueries({ queryKey: ['home-trending'] })
      queryClient.invalidateQueries({ queryKey: ['home-top-picks'] })
      queryClient.invalidateQueries({ queryKey: ['home-spotlight'] })
      queryClient.invalidateQueries({ queryKey: ['my-products'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard-products'] })
      queryClient.invalidateQueries({ queryKey: ['seller-products-home'] })
      navigate('/sell')
    },
    onError: (e: Error) => setError(e.message),
  })

  const removeExistingImage = useMutation({
    mutationFn: ({ imgId }: { imgId: string }) => deleteProductImage(id!, imgId),
  })

  const totalImages = (existing?.images.length ?? 0) + pendingImages.length

  return (
    <div className="p-4 sm:p-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/sell')}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-100 leading-tight">
            {isEdit ? 'Edit Listing' : 'New Listing'}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {isEdit ? 'Update your product details' : 'List a product to sell on SokoPay'}
          </p>
        </div>
      </div>

      {/* Two-column layout on lg */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">

        {/* ── Left column: core fields ──────────────────────────────────── */}
        <div className="space-y-4">

          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What are you selling?"
              maxLength={200}
              className="input-base"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe condition, specifications, harvest date, storage…"
              rows={3}
              maxLength={2000}
              className="input-base resize-none"
            />
            <SmartDescriptionGenerator
              title={title}
              category={category}
              priceKes={priceKes}
              unit={unit}
              onApply={setDescription}
            />
          </div>

          {/* Price + Unit + Quantity */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Price (KES) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={priceKes}
                onChange={e => setPriceKes(e.target.value)}
                placeholder="0.00"
                className="input-base"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit</label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="input-base"
              >
                {PRODUCT_UNITS.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Qty *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                className="input-base"
              />
            </div>
          </div>

          {/* AI price suggestion */}
          {category && (
            <AIPriceSuggestion
              category={category}
              currentPrice={priceKes}
              unit={unit}
              onApply={setPriceKes}
            />
          )}

          {/* Low-stock threshold */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Low-stock alert threshold (optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={lowStockThreshold}
              onChange={e => setLowStockThreshold(e.target.value)}
              placeholder={`e.g. 10 ${unit}`}
              className="input-base"
            />
            <p className="text-[11px] text-gray-600">
              You'll be notified when stock drops to or below this level.
            </p>
          </div>

          {/* Escrow mode — Coming Soon */}
          <div className="flex items-center gap-3 select-none opacity-55 cursor-not-allowed">
            <div className="w-9 h-5 rounded-full bg-gray-700 relative shrink-0">
              <span className="absolute top-0.5 translate-x-0.5 w-4 h-4 rounded-full bg-gray-500 shadow" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-gray-200">Escrow protection</p>
                <span className="coming-soon-pill">Coming Soon</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
                Funds held securely until buyer confirms delivery. Launching soon.
              </p>
            </div>
          </div>

          {/* Location + Country */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={locationName}
                  onChange={e => setLocationName(e.target.value)}
                  placeholder="City or area…"
                  className="input-base"
                />
                <button
                  type="button"
                  onClick={handleGetLocation}
                  disabled={locating}
                  className="btn-secondary px-3 shrink-0"
                  title="Use GPS"
                >
                  {locating
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <MapPin className="w-4 h-4" />}
                </button>
              </div>
              {locationLat && locationLng && (
                <p className="text-xs text-mpesa flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> GPS captured
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Country</label>
              <select
                value={countryCode}
                onChange={e => setCountryCode(e.target.value)}
                className="input-base"
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Ships globally */}
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-gray-800/40 border border-gray-700/50 hover:border-gray-600 transition-colors">
            <div className="relative shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={isGlobal}
                onChange={e => setIsGlobal(e.target.checked)}
              />
              <div className={clsx(
                'w-9 h-5 rounded-full transition-colors',
                isGlobal ? 'bg-brand-500' : 'bg-gray-700',
              )} />
              <div className={clsx(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                isGlobal ? 'translate-x-4' : 'translate-x-0.5',
              )} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-brand-400" />
                Ships globally
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Buyers in other countries can find this listing</p>
            </div>
          </label>

        </div>

        {/* ── Right column: category + photos ──────────────────────────── */}
        <div className="space-y-4">

          {/* Category */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Category</label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setCategory('')}
                className={clsx(
                  'flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-[10px] font-medium border transition-all',
                  !category
                    ? 'bg-brand-500/20 text-brand-400 border-brand-500/40'
                    : 'bg-gray-800/60 text-gray-500 border-gray-700/50 hover:border-gray-500 hover:text-gray-300',
                )}
              >
                <span className="text-base">🏪</span>
                <span>All</span>
              </button>
              {PRODUCT_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat === category ? '' : cat)}
                  className={clsx(
                    'flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-[10px] font-medium border transition-all',
                    category === cat
                      ? 'bg-brand-500/20 text-brand-400 border-brand-500/40'
                      : 'bg-gray-800/60 text-gray-500 border-gray-700/50 hover:border-gray-500 hover:text-gray-300',
                  )}
                >
                  <span className="text-base">{CATEGORY_ICONS[cat]}</span>
                  <span className="leading-tight text-center line-clamp-1">{cat.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Photos
              </label>
              <span className="text-xs text-gray-600">{totalImages}/5</span>
            </div>

            {/* Image grid */}
            <div className="grid grid-cols-3 gap-2">
              {existing?.images.map(img => (
                <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-800 group">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                  <button
                    type="button"
                    onClick={() => removeExistingImage.mutate({ imgId: img.id })}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-gray-900/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/90"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}

              {pendingPreviews.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-800 group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                  <button
                    type="button"
                    onClick={() => removePendingImage(i)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-gray-900/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/90"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                  <span className="absolute bottom-1 left-1.5 text-[9px] font-semibold text-white/70 bg-black/40 rounded px-1">
                    Pending
                  </span>
                </div>
              ))}

              {totalImages < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500/60 flex flex-col items-center justify-center gap-1.5 text-gray-600 hover:text-brand-400 transition-all hover:bg-brand-500/5"
                >
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-[10px] font-medium">Add photo</span>
                </button>
              )}
            </div>

            <p className="text-[11px] text-gray-600">JPEG / PNG / WebP · Max 5 MB · Up to 5 photos</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Listing preview pill */}
          {(title || priceKes) && (
            <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 space-y-1">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Preview</p>
              <p className="text-sm font-semibold text-gray-100 truncate">{title || 'Untitled'}</p>
              <div className="flex items-baseline gap-1.5">
                {priceKes && (
                  <span className="text-sm font-bold text-brand-400">
                    KES {parseFloat(priceKes || '0').toLocaleString('en-KE')}
                  </span>
                )}
                <span className="text-xs text-gray-500">/{unit}</span>
                {quantity && (
                  <span className="text-xs text-gray-500 ml-auto">{quantity} {unit} avail.</span>
                )}
              </div>
              {locationName && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />{locationName}
                </p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-4 text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-800">
        <button
          type="button"
          onClick={() => navigate('/sell')}
          className="btn-secondary flex-1 justify-center"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-primary flex-1 justify-center"
        >
          {save.isPending
            ? uploadingImages
              ? 'Uploading photos…'
              : 'Saving…'
            : isEdit
            ? 'Save Changes'
            : 'Create Listing'}
        </button>
      </div>

    </div>
  )
}
