import { FileDown } from 'lucide-react'

interface ReceiptData {
  orderId: string
  productTitle: string
  sellerName: string
  quantity: string
  unit: string
  priceKes: string
  totalKes: string
  paymentMethod: 'lightning' | 'mpesa'
  mpesaReceipt?: string | null
  amountSats?: number
  settledAt?: string
}

function buildReceiptHtml(r: ReceiptData): string {
  const date = r.settledAt
    ? new Date(r.settledAt).toLocaleString('en-KE', { dateStyle: 'long', timeStyle: 'short' })
    : new Date().toLocaleString('en-KE', { dateStyle: 'long', timeStyle: 'short' })

  const methodLabel = r.paymentMethod === 'lightning' ? '⚡ Bitcoin Lightning' : '📱 M-Pesa'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SokoPay Receipt — ${r.orderId.slice(0, 8).toUpperCase()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #111; padding: 40px 24px; max-width: 480px; margin: 0 auto; }
    .logo { font-size: 22px; font-weight: 800; color: #d97b18; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #666; margin-bottom: 32px; }
    .receipt-box { border: 1.5px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
    .receipt-header { background: #f9fafb; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; }
    .receipt-header h2 { font-size: 14px; font-weight: 700; color: #111; }
    .receipt-header p { font-size: 12px; color: #666; margin-top: 2px; }
    .receipt-body { padding: 20px; }
    .row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; font-size: 13px; }
    .row .label { color: #666; }
    .row .value { font-weight: 600; color: #111; text-align: right; }
    .divider { border: none; border-top: 1px dashed #e5e7eb; margin: 14px 0; }
    .total-row { display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; }
    .total-row .amount { color: #d97b18; }
    .badge { display: inline-block; background: #f3f4f6; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; color: #374151; margin-top: 14px; }
    .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center; line-height: 1.6; }
    .ref { font-family: monospace; font-size: 11px; color: #6b7280; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="logo">SokoPay</div>
  <p class="subtitle">Payment Receipt</p>

  <div class="receipt-box">
    <div class="receipt-header">
      <h2>Purchase Confirmed</h2>
      <p>${date}</p>
    </div>
    <div class="receipt-body">
      <div class="row">
        <span class="label">Product</span>
        <span class="value">${r.productTitle}</span>
      </div>
      <div class="row">
        <span class="label">Seller</span>
        <span class="value">${r.sellerName}</span>
      </div>
      <div class="row">
        <span class="label">Quantity</span>
        <span class="value">${r.quantity} ${r.unit}</span>
      </div>
      <div class="row">
        <span class="label">Unit price</span>
        <span class="value">KES ${parseFloat(r.priceKes).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
      </div>
      <hr class="divider"/>
      <div class="total-row">
        <span>Total paid</span>
        <span class="amount">KES ${parseFloat(r.totalKes).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
      </div>
      ${r.amountSats ? `<p style="font-size:11px;color:#6b7280;text-align:right;margin-top:4px;">≈ ${r.amountSats.toLocaleString()} sats</p>` : ''}
      <span class="badge">${methodLabel}</span>
      ${r.mpesaReceipt ? `<div style="margin-top:10px;" class="row"><span class="label">M-Pesa ref</span><span class="value ref">${r.mpesaReceipt}</span></div>` : ''}
    </div>
  </div>

  <div class="footer">
    Order ID: <span class="ref">${r.orderId.toUpperCase()}</span><br/>
    Issued by SokoPay · sokopay.app<br/>
    This is your official payment receipt.
  </div>
</body>
</html>`
}

export function downloadReceipt(data: ReceiptData) {
  const html = buildReceiptHtml(data)
  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `sokopay-receipt-${data.orderId.slice(0, 8).toUpperCase()}.html`
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  data: ReceiptData
}

export default function ReceiptDownloadButton({ data }: Props) {
  return (
    <button
      onClick={() => downloadReceipt(data)}
      className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors border border-gray-700 hover:border-gray-500 rounded-xl px-4 py-2"
    >
      <FileDown className="w-4 h-4" />
      Download Receipt
    </button>
  )
}
