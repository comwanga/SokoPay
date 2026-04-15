import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Upload, X, MapPin, Loader2, Globe } from 'lucide-react'
import {
  getProduct, createProduct, updateProduct,
  uploadProductImage, deleteProductImage,
} from '../api/client.ts'
import { PRODUCT_CATEGORIES, PRODUCT_UNITS, CATEGORY_ICONS } from '../types'
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
  const isEdit = !!id

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priceKes, setPriceKes] = useState('')
  const [unit, setUnit] = useState('kg')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationLat, setLocationLat] = useState<number | undefined>()
  const [locationLng, setLocationLng] = useState<number | undefined>()
  const [locating, setLocating] = useState(false)
  const [countryCode, setCountryCode] = useState('KE')
  const [isGlobal, setIsGlobal] = useState(false)

  // Image upload state
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [error, setError] = useState<string | null>(null)

  // Load product for editing
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
    }
  }, [existing])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const total = pendingImages.length + (existing?.images.length ?? 0)
    const allowed = Math.min(files.length, 5 - total)
    if (allowed <= 0) return

    const chosen = files.slice(0, allowed)
    setPendingImages(prev => [...prev, ...chosen])
    chosen.forEach(f => {
      const url = URL.createObjectURL(f)
      setPendingPreviews(prev => [...prev, url])
    })
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

      let productId: string

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        price_kes: priceKes,
        unit,
        quantity_avail: quantity,
        category: category || undefined,
        location_name: locationName.trim() || undefined,
        location_lat: locationLat,
        location_lng: locationLng,
        country_code: countryCode || undefined,
        is_global: isGlobal,
      }

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
    onSuccess: () => navigate('/sell'),
    onError: (e: Error) => setError(e.message),
  })

  const removeExistingImage = useMutation({
    mutationFn: ({ imgId }: { imgId: string }) =>
      deleteProductImage(id!, imgId),
  })

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/sell')}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to listings
      </button>

      <h1 className="text-xl font-bold text-gray-100">
        {isEdit ? 'Edit Listing' : 'New Listing'}
      </h1>

      <div className="space-y-5">
        {/* Title */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-400">Title *</label>
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
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-400">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe your item — condition, specifications, notes…"
            rows={3}
            maxLength={2000}
            className="input-base resize-none"
          />
        </div>

        {/* Price + Unit + Quantity */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Price (KES) *</label>
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
            <label className="text-xs font-medium text-gray-400">Unit</label>
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
            <label className="text-xs font-medium text-gray-400">Quantity *</label>
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

        {/* Category */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400">Category</label>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => setCategory('')}
              className={clsx(
                'flex flex-col items-center gap-1 p-2 rounded-xl text-[10px] font-medium border transition-all',
                !category
                  ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                  : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
              )}
            >
              <span className="text-lg">🏪</span>
              <span>None</span>
            </button>
            {PRODUCT_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat === category ? '' : cat)}
                className={clsx(
                  'flex flex-col items-center gap-1 p-2 rounded-xl text-[10px] font-medium border transition-all',
                  category === cat
                    ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                    : 'bg-gray-800/60 text-gray-400 border-gray-700/60 hover:border-gray-500',
                )}
              >
                <span className="text-lg">{CATEGORY_ICONS[cat]}</span>
                <span className="leading-tight text-center line-clamp-2">{cat.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Location + Country */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Location</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={locationName}
                onChange={e => setLocationName(e.target.value)}
                placeholder="City, area…"
                className="input-base"
              />
              <button
                type="button"
                onClick={handleGetLocation}
                disabled={locating}
                className="btn-secondary px-3 shrink-0"
                title="Use GPS"
              >
                {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
              </button>
            </div>
            {locationLat && locationLng && (
              <p className="text-xs text-mpesa">GPS captured</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400">Country</label>
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

        {/* Ships globally toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
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
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              isGlobal ? 'translate-x-4' : 'translate-x-0.5',
            )} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-brand-400" />
              Ships globally
            </p>
            <p className="text-[11px] text-gray-600">Buyers in other countries can find this listing</p>
          </div>
        </label>

        {/* Images */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400">
            Photos ({(existing?.images.length ?? 0) + pendingImages.length}/5)
          </label>

          <div className="flex flex-wrap gap-3">
            {existing?.images.map(img => (
              <div key={img.id} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-800">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeExistingImage.mutate({ imgId: img.id })}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900/80 flex items-center justify-center hover:bg-red-900/80"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {pendingPreviews.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-800">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePendingImage(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900/80 flex items-center justify-center hover:bg-red-900/80"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {(existing?.images.length ?? 0) + pendingImages.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-700 hover:border-brand-500/50 flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-brand-400 transition-colors"
              >
                <Upload className="w-5 h-5" />
                <span className="text-[10px]">Add photo</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <p className="text-[11px] text-gray-600">JPEG, PNG or WebP · Max 5 MB each · Up to 5 photos</p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
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
    </div>
  )
}
