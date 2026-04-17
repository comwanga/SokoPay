import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, MessageCircle, Loader2 } from 'lucide-react'
import { getOrderMessages, sendOrderMessage } from '../api/client.ts'
import { getTokenPayload } from '../hooks/useCurrentFarmer.ts'
import clsx from 'clsx'

interface Props {
  orderId: string
}

export default function MessageThread({ orderId }: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const myId = getTokenPayload()?.farmer_id

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['order-messages', orderId],
    queryFn: () => getOrderMessages(orderId),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const sendMutation = useMutation({
    mutationFn: () => sendOrderMessage(orderId, body.trim()),
    onSuccess: () => {
      setBody('')
      setError(null)
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    try {
      await sendMutation.mutateAsync()
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5" />
        Messages
      </p>

      {/* Thread */}
      <div className="bg-gray-900/60 rounded-xl p-3 max-h-64 overflow-y-auto space-y-2">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-4">
            No messages yet. Start the conversation.
          </p>
        )}

        {messages.map(msg => {
          const isMe = msg.sender_id === myId
          return (
            <div
              key={msg.id}
              className={clsx('flex flex-col', isMe ? 'items-end' : 'items-start')}
            >
              <div
                className={clsx(
                  'max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed',
                  isMe
                    ? 'bg-brand-600/30 text-brand-100 rounded-br-md'
                    : 'bg-gray-800 text-gray-200 rounded-bl-md',
                )}
              >
                {msg.body}
              </div>
              <span className="text-[10px] text-gray-600 mt-0.5 px-1">
                {isMe ? 'You' : msg.sender_name} ·{' '}
                {new Date(msg.sent_at).toLocaleTimeString('en-KE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={e => { setBody(e.target.value); setError(null) }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          maxLength={2000}
          className="input-base text-xs flex-1 resize-none"
        />
        <button
          onClick={handleSend}
          disabled={sending || !body.trim()}
          className="btn-primary px-3 self-end"
          title="Send message"
        >
          {sending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
