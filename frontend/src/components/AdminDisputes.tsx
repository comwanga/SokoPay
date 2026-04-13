import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, ChevronDown, ChevronUp, FileText, Check,
  AlertTriangle, UserCheck, Users, RefreshCw,
} from 'lucide-react'
import {
  listAdminDisputes, getDisputeEvidence, resolveDispute,
  createUser, formatKes,
} from '../api/client.ts'
import type { OpenDisputeRow, ResolveDisputePayload, CreateUserRequest } from '../types'

// ── Single dispute row ────────────────────────────────────────────────────────

function DisputeRow({ d }: { d: OpenDisputeRow }) {
  const [expanded, setExpanded] = useState(false)
  const [resolution, setResolution] = useState<ResolveDisputePayload['resolution']>('refund_buyer')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const qc = useQueryClient()

  const { data: evidence = [] } = useQuery({
    queryKey: ['admin-evidence', d.order_id],
    queryFn: () => getDisputeEvidence(d.order_id),
    enabled: expanded,
    staleTime: 30_000,
  })

  const resolve = useMutation({
    mutationFn: () => resolveDispute(d.order_id, { resolution, admin_notes: notes.trim() || undefined }),
    onSuccess: () => {
      setDone(true)
      qc.invalidateQueries({ queryKey: ['admin-disputes'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (done) {
    return (
      <div className="card p-4 flex items-center gap-3 text-sm text-mpesa">
        <Check className="w-4 h-4" />
        <span>Dispute resolved: <strong>{d.product_title}</strong> — {resolution.replace('_', ' ')}</span>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-4 p-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-gray-100 truncate">{d.product_title}</p>
          <p className="text-xs text-gray-400">
            Buyer: {d.buyer_name} · Seller: {d.seller_name}
          </p>
          <p className="text-xs text-gray-400">
            {formatKes(d.total_kes)}
            {d.total_sats ? ` · ${d.total_sats.toLocaleString()} sats` : ''}
            {d.dispute_opened_at && (
              <> · Opened {new Date(d.dispute_opened_at).toLocaleDateString('en-KE')}</>
            )}
          </p>
          {d.dispute_reason && (
            <p className="text-xs text-yellow-300/80 mt-1 line-clamp-2">"{d.dispute_reason}"</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
            {d.evidence_count} evidence
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* Evidence */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="w-3 h-3" /> Evidence ({evidence.length})
            </p>
            {evidence.length === 0 ? (
              <p className="text-xs text-gray-600">No evidence submitted.</p>
            ) : (
              <ul className="space-y-2">
                {evidence.map(e => (
                  <li key={e.id} className="bg-gray-800/60 rounded-lg px-3 py-2 text-xs text-gray-300">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase mr-2">{e.kind}</span>
                    {e.kind === 'url'
                      ? <a href={e.content} target="_blank" rel="noreferrer" className="text-brand-400 underline break-all">{e.content}</a>
                      : <span className="break-words">{e.content}</span>
                    }
                    <span className="block text-[10px] text-gray-600 mt-0.5">
                      {new Date(e.created_at).toLocaleString('en-KE')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Resolution form */}
          <div className="space-y-3 bg-gray-800/40 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-300">Resolve Dispute</p>

            <div className="grid grid-cols-3 gap-2">
              {([
                ['refund_buyer',    'Refund Buyer',    'bg-blue-900/30 border-blue-700/40 text-blue-300'],
                ['release_seller',  'Release Seller',  'bg-mpesa/10 border-mpesa/30 text-mpesa'],
                ['split',           'Split 50/50',     'bg-yellow-900/20 border-yellow-700/30 text-yellow-300'],
              ] as const).map(([val, label, cls]) => (
                <button
                  key={val}
                  onClick={() => setResolution(val)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all ${cls} ${
                    resolution === val ? 'ring-2 ring-white/20' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Admin notes (visible in order history, optional)…"
              rows={2}
              className="input-base text-xs w-full resize-none"
            />

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={() => resolve.mutate()}
              disabled={resolve.isPending}
              className="btn-primary w-full justify-center text-sm"
            >
              <Check className="w-4 h-4" />
              {resolve.isPending ? 'Resolving…' : `Resolve — ${resolution.replace('_', ' ')}`}
            </button>
          </div>

          <p className="text-[10px] text-gray-600">Order ID: {d.order_id}</p>
        </div>
      )}
    </div>
  )
}

// ── Create user panel ─────────────────────────────────────────────────────────

function CreateUserPanel() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<CreateUserRequest['role']>('farmer')
  const [showPw, setShowPw] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createUser({ username: username.trim(), password, role }),
    onSuccess: res => {
      setResult(`Created: ${res.username} (${res.role})`)
      setUsername('')
      setPassword('')
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="card p-5 space-y-4">
      <p className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <UserCheck className="w-4 h-4 text-brand-400" />
        Create User Account
      </p>
      <p className="text-xs text-gray-500">
        Farmers and operators log in with username/password when they don't use Nostr.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-400">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="input-base text-xs"
            placeholder="jane_farmer"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-400">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as CreateUserRequest['role'])}
            className="input-base text-xs"
          >
            <option value="farmer">farmer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-400">Password</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="input-base text-xs pr-8 w-full"
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPw ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <p className="text-xs text-mpesa">{result}</p>}

      <button
        onClick={() => create.mutate()}
        disabled={create.isPending || !username.trim() || password.length < 8}
        className="btn-primary text-sm"
      >
        {create.isPending ? 'Creating…' : 'Create Account'}
      </button>
      {password.length > 0 && password.length < 8 && (
        <p className="text-[11px] text-yellow-500">Password must be at least 8 characters</p>
      )}
    </div>
  )
}

// ── Admin page ────────────────────────────────────────────────────────────────

export default function AdminDisputes() {
  const [tab, setTab] = useState<'disputes' | 'users'>('disputes')

  const { data: disputes = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-disputes'],
    queryFn: listAdminDisputes,
    staleTime: 30_000,
    enabled: tab === 'disputes',
  })

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-400" />
            Admin Panel
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Dispute resolution and user management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('disputes')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            tab === 'disputes' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Open Disputes
        </button>
        <button
          onClick={() => setTab('users')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            tab === 'users' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          User Accounts
        </button>
      </div>

      {/* Disputes tab */}
      {tab === 'disputes' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {isLoading ? 'Loading…' : `${disputes.length} open dispute${disputes.length !== 1 ? 's' : ''}`}
            </p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="card h-20 skeleton" />)}
            </div>
          )}

          {isError && (
            <p className="text-sm text-red-400">Failed to load disputes. Check that you are signed in as admin.</p>
          )}

          {!isLoading && !isError && disputes.length === 0 && (
            <div className="text-center py-16 space-y-2">
              <Shield className="w-10 h-10 text-gray-700 mx-auto" />
              <p className="text-gray-400 font-medium">No open disputes</p>
              <p className="text-sm text-gray-600">All disputes have been resolved.</p>
            </div>
          )}

          {disputes.map(d => <DisputeRow key={d.order_id} d={d} />)}
        </section>
      )}

      {/* Users tab */}
      {tab === 'users' && (
        <section className="space-y-4">
          <CreateUserPanel />
        </section>
      )}
    </div>
  )
}
