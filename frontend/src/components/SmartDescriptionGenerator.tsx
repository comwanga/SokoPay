import { useState } from 'react'
import { Sparkles, RefreshCw, Check, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  title: string
  category: string
  priceKes: string
  unit: string
  onApply(description: string): void
}

// ── Category-aware description templates ──────────────────────────────────────

const FRESHNESS_PHRASES = [
  'freshly harvested', 'farm-fresh', 'straight from the farm', 'harvested this season',
  'sourced directly from local farmers', 'naturally grown',
]
const QUALITY_PHRASES = [
  'premium quality', 'carefully selected', 'hand-picked for quality',
  'grade A quality', 'top-grade', 'carefully sorted',
]
const CTA_PHRASES = [
  'Order today for fast delivery.', 'Contact seller to negotiate bulk pricing.',
  'Limited stock — order now.', 'Wholesale and retail quantities available.',
  'Delivery arranged by seller.', 'Message seller for bulk discount.',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateDescriptions(title: string, category: string, priceKes: string, unit: string): string[] {
  const price  = parseFloat(priceKes) || 0
  const priceStr = price > 0 ? `KES ${price.toLocaleString('en-KE')} per ${unit}` : `priced per ${unit}`
  const t = title.trim() || 'This product'

  const templates: Record<string, () => string[]> = {
    'Food & Groceries': () => [
      `${pick(FRESHNESS_PHRASES)} ${t}, ${pick(QUALITY_PHRASES)}. Available at ${priceStr}. ${pick(CTA_PHRASES)}`,
      `Bring home the freshest ${t.toLowerCase()} at an unbeatable price of ${priceStr}. Sourced from local farms and delivered to your doorstep. Rich in nutrients and perfect for everyday cooking. ${pick(CTA_PHRASES)}`,
      `Looking for quality ${t.toLowerCase()}? Our ${pick(QUALITY_PHRASES).toLowerCase()} product is ${pick(FRESHNESS_PHRASES)} and ready for delivery. At ${priceStr}, this is the best value in the market. ${pick(CTA_PHRASES)}`,
    ],
    'Electronics': () => [
      `${t} — ${pick(QUALITY_PHRASES)} and fully functional. Priced at ${priceStr}. Perfect for home, office, or school use. All accessories included where applicable. ${pick(CTA_PHRASES)}`,
      `Get your hands on this ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at ${priceStr}. Tested and verified to be in excellent working condition. Comes with a warranty where applicable. ${pick(CTA_PHRASES)}`,
      `High-performance ${t.toLowerCase()} available now at ${priceStr}. Ideal for professionals and everyday users alike. ${pick(QUALITY_PHRASES)} with full functionality guaranteed. ${pick(CTA_PHRASES)}`,
    ],
    'Fashion & Clothing': () => [
      `${t} — stylish, comfortable, and affordable at ${priceStr}. ${pick(QUALITY_PHRASES)} materials that last. Perfect for any occasion. Available in multiple sizes — message seller for your size. ${pick(CTA_PHRASES)}`,
      `Stand out with this ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at just ${priceStr}. Made from durable, comfortable fabric. Ideal for both casual and formal wear. ${pick(CTA_PHRASES)}`,
      `Upgrade your wardrobe with ${t.toLowerCase()} at ${priceStr}. ${pick(QUALITY_PHRASES)} craftsmanship that combines style with durability. Message seller for size availability and customisation options. ${pick(CTA_PHRASES)}`,
    ],
    'Agriculture': () => [
      `${t} for the serious farmer — ${pick(QUALITY_PHRASES)} and proven results. Available at ${priceStr} per ${unit}. Suitable for large-scale and small-scale farming operations. ${pick(CTA_PHRASES)}`,
      `Boost your farm productivity with our ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at ${priceStr}. Trusted by farmers across East Africa. ${pick(CTA_PHRASES)}`,
      `${pick(QUALITY_PHRASES)} ${t.toLowerCase()} available at ${priceStr}. Ideal for improving crop yields and farm efficiency. Backed by local farming expertise and experience. ${pick(CTA_PHRASES)}`,
    ],
    'Health & Beauty': () => [
      `${t} — ${pick(QUALITY_PHRASES)} and safe for all skin types. Available at ${priceStr}. Formulated to deliver visible results. Authentic product, no counterfeits. ${pick(CTA_PHRASES)}`,
      `Take care of yourself with our ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at just ${priceStr}. Gentle on skin, powerful results. Trusted by thousands of happy customers. ${pick(CTA_PHRASES)}`,
      `${pick(QUALITY_PHRASES)} ${t.toLowerCase()} for your daily wellness routine. Priced at ${priceStr}, it's an affordable investment in your health and appearance. ${pick(CTA_PHRASES)}`,
    ],
    'Home & Furniture': () => [
      `Transform your living space with this ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at ${priceStr}. Durable, stylish, and built to last. Perfect for any home interior. ${pick(CTA_PHRASES)}`,
      `${t} — ${pick(QUALITY_PHRASES)}, sturdy construction, and great value at ${priceStr}. Elevate your home without breaking the bank. ${pick(CTA_PHRASES)}`,
      `Looking for quality home essentials? This ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at ${priceStr} is exactly what you need. Built for everyday use with long-lasting durability. ${pick(CTA_PHRASES)}`,
    ],
    'Vehicles': () => [
      `${t} in ${pick(QUALITY_PHRASES).toLowerCase()} condition — well-maintained and ready to use. Priced at ${priceStr}. Full service history available on request. ${pick(CTA_PHRASES)}`,
      `Reliable ${t.toLowerCase()} available at ${priceStr}. Excellent condition, recently serviced. Ideal for personal or commercial use. ${pick(CTA_PHRASES)}`,
      `${pick(QUALITY_PHRASES)} ${t.toLowerCase()} at a competitive price of ${priceStr}. All documentation in order. Test drive available by appointment. ${pick(CTA_PHRASES)}`,
    ],
    'Property': () => [
      `${t} — prime location, ${pick(QUALITY_PHRASES).toLowerCase()}, priced at ${priceStr}. All legal documents available. Serious buyers only. ${pick(CTA_PHRASES)}`,
      `Excellent investment opportunity: ${t.toLowerCase()} at ${priceStr}. Strategically located with easy access to amenities. ${pick(QUALITY_PHRASES)} and ready for immediate occupation or development. ${pick(CTA_PHRASES)}`,
      `Don't miss this ${pick(QUALITY_PHRASES).toLowerCase()} ${t.toLowerCase()} at ${priceStr}. Verified title deed, clear ownership. ${pick(CTA_PHRASES)}`,
    ],
    'Services': () => [
      `Professional ${t.toLowerCase()} — ${pick(QUALITY_PHRASES)}, reliable, and affordable at ${priceStr}. Years of experience delivering results across East Africa. ${pick(CTA_PHRASES)}`,
      `Need ${t.toLowerCase()}? Our ${pick(QUALITY_PHRASES).toLowerCase()} service is available at ${priceStr}. Guaranteed satisfaction or your money back. ${pick(CTA_PHRASES)}`,
      `Trusted ${t.toLowerCase()} at ${priceStr}. We deliver ${pick(QUALITY_PHRASES).toLowerCase()} results, on time, every time. ${pick(CTA_PHRASES)}`,
    ],
    'Arts & Crafts': () => [
      `Handcrafted ${t.toLowerCase()} — unique, ${pick(QUALITY_PHRASES).toLowerCase()}, and made with love at ${priceStr}. Each piece is one-of-a-kind. Perfect as a gift or for personal use. ${pick(CTA_PHRASES)}`,
      `Authentic ${t.toLowerCase()} crafted by skilled artisans at ${priceStr}. ${pick(QUALITY_PHRASES)} materials meet traditional craftsmanship. ${pick(CTA_PHRASES)}`,
      `Own a piece of African heritage: ${t.toLowerCase()} at ${priceStr}. Meticulously crafted, ${pick(QUALITY_PHRASES)}, and a conversation starter wherever it goes. ${pick(CTA_PHRASES)}`,
    ],
  }

  const gen = templates[category] ?? (() => [
    `${t} — ${pick(QUALITY_PHRASES)} and available at ${priceStr}. ${pick(CTA_PHRASES)}`,
    `Get the best ${t.toLowerCase()} at ${priceStr}. ${pick(QUALITY_PHRASES)} product with prompt delivery. ${pick(CTA_PHRASES)}`,
    `${pick(QUALITY_PHRASES)} ${t.toLowerCase()} available now at ${priceStr}. Don't miss this great deal. ${pick(CTA_PHRASES)}`,
  ])

  return gen()
}

export default function SmartDescriptionGenerator({ title, category, priceKes, unit, onApply }: Props) {
  const [open, setOpen]         = useState(false)
  const [variants, setVariants] = useState<string[]>([])
  const [applied, setApplied]   = useState<number | null>(null)

  const canGenerate = title.trim().length >= 3

  function generate() {
    if (!canGenerate) return
    setVariants(generateDescriptions(title, category, priceKes, unit))
    setApplied(null)
    setOpen(true)
  }

  function handleApply(text: string, idx: number) {
    onApply(text)
    setApplied(idx)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all',
            canGenerate
              ? 'bg-brand-500/10 border-brand-500/20 text-brand-300 hover:bg-brand-500/20'
              : 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed',
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Smart Description
        </button>
        {variants.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {open ? 'Hide' : 'Show'} suggestions
          </button>
        )}
      </div>

      {open && variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Pick a description — edit after applying
            </p>
            <button
              type="button"
              onClick={generate}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Regenerate
            </button>
          </div>
          {variants.map((text, i) => (
            <div
              key={i}
              className={clsx(
                'relative group rounded-xl border p-3 cursor-pointer transition-all',
                applied === i
                  ? 'border-brand-500/40 bg-brand-500/10'
                  : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800',
              )}
              onClick={() => handleApply(text, i)}
            >
              <p className="text-xs text-gray-300 leading-relaxed pr-8">{text}</p>
              <div className={clsx(
                'absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center transition-all',
                applied === i
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-700 text-gray-500 group-hover:bg-gray-600 group-hover:text-gray-300',
              )}>
                {applied === i
                  ? <Check className="w-3 h-3" />
                  : <span className="text-[10px] font-bold">{i + 1}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
