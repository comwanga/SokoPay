import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import type { Product } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  /** The full product snapshot at time of add. Price/stock may have changed. */
  product: Product
  quantity: number
}

interface CartState {
  items: CartItem[]
}

type CartAction =
  | { type: 'ADD_ITEM';    product: Product; quantity: number }
  | { type: 'REMOVE_ITEM'; productId: string }
  | { type: 'SET_QTY';     productId: string; quantity: number }
  | { type: 'CLEAR' }
  | { type: 'HYDRATE';     items: CartItem[] }

interface CartContextValue {
  items: CartItem[]
  /** Total number of individual units (sum of all quantities). */
  totalCount: number
  /** Total price in KES as a formatted string. */
  totalKes: number
  addItem(product: Product, quantity?: number): void
  removeItem(productId: string): void
  setQuantity(productId: string, quantity: number): void
  clear(): void
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'HYDRATE':
      return { items: action.items }

    case 'ADD_ITEM': {
      const existing = state.items.findIndex(i => i.product.id === action.product.id)
      if (existing >= 0) {
        // Increase quantity, capped at available stock
        const maxQty = parseFloat(action.product.quantity_avail)
        const newQty = Math.min(state.items[existing].quantity + action.quantity, maxQty)
        const items = state.items.map((item, idx) =>
          idx === existing ? { ...item, quantity: newQty } : item
        )
        return { items }
      }
      return { items: [...state.items, { product: action.product, quantity: action.quantity }] }
    }

    case 'REMOVE_ITEM':
      return { items: state.items.filter(i => i.product.id !== action.productId) }

    case 'SET_QTY': {
      if (action.quantity <= 0) {
        return { items: state.items.filter(i => i.product.id !== action.productId) }
      }
      return {
        items: state.items.map(i =>
          i.product.id === action.productId ? { ...i, quantity: action.quantity } : i
        ),
      }
    }

    case 'CLEAR':
      return { items: [] }

    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sokopay_cart'

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [] })

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: CartItem[] = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          dispatch({ type: 'HYDRATE', items: parsed })
        }
      }
    } catch { /* ignore corrupt data */ }
  }, [])

  // Persist to localStorage whenever items change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items))
    } catch { /* ignore quota errors */ }
  }, [state.items])

  const totalCount = state.items.reduce((sum, i) => sum + i.quantity, 0)
  const totalKes   = state.items.reduce(
    (sum, i) => sum + parseFloat(i.product.price_kes) * i.quantity,
    0,
  )

  const value: CartContextValue = {
    items: state.items,
    totalCount,
    totalKes,
    addItem:     (product, qty = 1) => dispatch({ type: 'ADD_ITEM',    product, quantity: qty }),
    removeItem:  (productId)         => dispatch({ type: 'REMOVE_ITEM', productId }),
    setQuantity: (productId, qty)    => dispatch({ type: 'SET_QTY',     productId, quantity: qty }),
    clear:       ()                  => dispatch({ type: 'CLEAR' }),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
