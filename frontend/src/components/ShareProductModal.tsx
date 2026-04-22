import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X, Copy, Check, Share2, Link, Smartphone } from 'lucide-react'
import clsx from 'clsx'
import type { Product } from '../types'

interface Props {
  product: Product
  onClose(): void
}

export default function ShareProductModal({ product, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [visible, setVisible] = useState(false)

  const productUrl = `${window.location.origin}/products/${product.id}`

  useEffect(() => {
    const f = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(f)
  }, [])

  function close() {
    setVisible(false)
    setTimeout(onClose, 200)
  }

  function copyLink() {
    navigator.clipboard.writeText(productUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function nativeShare() {
    if (!navigator.share) { copyLink(); return }
    try {
      await navigator.share({
        title: product.title,
        text: `Check out ${product.title} on SokoPay — pay with M-Pesa or Lightning`,
        url: productUrl,
      })
    } catch { /* user dismissed */ }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${product.title} on SokoPay\n${productUrl}`)}`

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4',
        'bg-black/75 backdrop-blur-sm transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onClick={close}
    >
      <div
        className={clsx(
          'relative bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm shadow-2xl',
          'transition-transform duration-300 ease-out',
          visible ? 'translate-y-0' : 'translate-y-4 sm:translate-y-0',
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-gray-100">Share product</h2>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Product info */}
          <div className="flex items-center gap-3">
            {product.images[0] && (
              <img
                src={product.images.find(i => i.is_primary)?.url ?? product.images[0].url}
                alt={product.title}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-100 line-clamp-1">{product.title}</p>
              <p className="text-xs text-gray-500">by {product.seller_name}</p>
            </div>
          </div>

          {/* QR code */}
          <div className="flex justify-center">
            <div className="relative p-4 bg-white rounded-2xl shadow-sm">
              <QRCodeSVG
                value={productUrl}
                size={180}
                level="M"
              />
              {/* SokoPay logo overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-white ring-2 ring-white shadow-sm">
                  <img src="/logo.svg" alt="SokoPay" className="w-full h-full" draggable={false} />
                </div>
              </div>
            </div>
          </div>
          <p className="text-center text-[11px] text-gray-600">Scan to open on any device</p>

          {/* Copy link */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 min-w-0">
              <Link className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <span className="text-xs text-gray-400 truncate font-mono">{productUrl}</span>
            </div>
            <button
              onClick={copyLink}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all shrink-0',
                copied
                  ? 'bg-green-900/20 border-green-700/30 text-green-400'
                  : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700',
              )}
            >
              {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
            </button>
          </div>

          {/* Share actions */}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] text-sm font-semibold hover:bg-[#25D366]/20 transition-colors"
            >
              <Smartphone className="w-4 h-4" />
              WhatsApp
            </a>
            {'share' in navigator ? (
              <button
                onClick={nativeShare}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm font-semibold hover:bg-brand-500/20 transition-colors"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            ) : (
              <button
                onClick={copyLink}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy link
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
