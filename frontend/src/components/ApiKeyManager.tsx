import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
  type CreateApiKeyResponse,
} from '../api/client'

const AVAILABLE_SCOPES = [
  { id: 'read:products',  label: 'Read products' },
  { id: 'write:products', label: 'Write products' },
  { id: 'read:orders',    label: 'Read orders' },
  { id: 'write:orders',   label: 'Write orders' },
  { id: 'read:payments',  label: 'Read payments' },
]

export default function ApiKeyManager() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read:products'])
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  })

  const create = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      setNewKey(data)
      setShowForm(false)
      setName('')
      setScopes(['read:products'])
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  function toggleScope(scope: string) {
    setScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    )
  }

  function handleCopy() {
    if (!newKey) return
    navigator.clipboard.writeText(newKey.raw_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">API Keys</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            Authenticate third-party integrations with <code className="text-green-400">X-Api-Key</code> header.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors"
          >
            + New Key
          </button>
        )}
      </div>

      {/* One-time key reveal */}
      {newKey && (
        <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-xl p-4 space-y-3">
          <p className="text-yellow-300 font-medium text-sm">
            Save this key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-900 text-green-300 rounded-lg px-3 py-2 font-mono break-all">
              {newKey.raw_key}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            I've saved it — dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Key name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My ERP integration"
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-green-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Scopes</label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_SCOPES.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s.id)}
                    onChange={() => toggleScope(s.id)}
                    className="accent-green-500"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => create.mutate({ name, scopes })}
              disabled={!name.trim() || scopes.length === 0 || create.isPending}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
          {create.isError && (
            <p className="text-red-400 text-sm">{String(create.error)}</p>
          )}
        </div>
      )}

      {/* Key list */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-gray-400 text-sm">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map((key: ApiKey) => (
            <div
              key={key.id}
              className="flex items-start justify-between bg-gray-800/50 border border-gray-700 rounded-xl p-4"
            >
              <div className="space-y-1 min-w-0">
                <p className="text-white text-sm font-medium">{key.name}</p>
                <code className="text-xs text-gray-400 font-mono">{key.key_prefix}…</code>
                <div className="flex flex-wrap gap-1 mt-1">
                  {key.scopes.map(s => (
                    <span key={s} className="text-xs bg-gray-700 text-gray-300 rounded px-1.5 py-0.5">{s}</span>
                  ))}
                </div>
                {key.last_used_at && (
                  <p className="text-xs text-gray-500">
                    Last used {new Date(key.last_used_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  if (confirm(`Revoke key "${key.name}"?`)) revoke.mutate(key.id)
                }}
                className="ml-4 text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
