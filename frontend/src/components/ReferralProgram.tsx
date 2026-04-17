import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getMyReferralCode, getReferralStats, applyReferral } from '../api/client'

export default function ReferralProgram() {
  const [codeCopied, setCodeCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [applyCode, setApplyCode] = useState('')
  const [applyMsg, setApplyMsg] = useState('')

  const { data: ref, isLoading: loadingRef } = useQuery({
    queryKey: ['referral-code'],
    queryFn: getMyReferralCode,
  })

  const { data: stats } = useQuery({
    queryKey: ['referral-stats'],
    queryFn: getReferralStats,
  })

  const apply = useMutation({
    mutationFn: applyReferral,
    onSuccess: (data) => {
      setApplyMsg(data.applied ? 'Referral applied!' : 'Already applied or invalid code.')
      setApplyCode('')
    },
    onError: () => setApplyMsg('Failed to apply referral.'),
  })

  function copyCode() {
    if (!ref) return
    navigator.clipboard.writeText(ref.referral_code)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  function copyLink() {
    if (!ref) return
    navigator.clipboard.writeText(ref.referral_link)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Referral Program</h3>
        <p className="text-sm text-gray-400 mt-0.5">
          Invite farmers to SokoPay — share your code or link.
        </p>
      </div>

      {/* My referral code */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-sm text-gray-300 font-medium">Your referral code</p>
        {loadingRef ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : ref ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold tracking-widest text-green-400 font-mono">
                {ref.referral_code}
              </span>
              <button
                onClick={copyCode}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
              >
                {codeCopied ? 'Copied!' : 'Copy code'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={ref.referral_link}
                className="flex-1 text-xs bg-gray-900 text-gray-300 rounded-lg px-3 py-2 font-mono border border-gray-700 outline-none"
              />
              <button
                onClick={copyLink}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
              >
                {linkCopied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Stats */}
      {stats && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-400">Farmers referred</p>
          <p className="text-3xl font-bold text-white mt-1">{stats.total_referrals}</p>
        </div>
      )}

      {/* Apply a referral code */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-sm text-gray-300 font-medium">Were you referred by someone?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={applyCode}
            onChange={e => setApplyCode(e.target.value.toUpperCase())}
            placeholder="Enter referral code"
            maxLength={8}
            className="flex-1 bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-green-500 outline-none font-mono tracking-widest uppercase"
          />
          <button
            onClick={() => { setApplyMsg(''); apply.mutate(applyCode) }}
            disabled={applyCode.length !== 8 || apply.isPending}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {apply.isPending ? 'Applying…' : 'Apply'}
          </button>
        </div>
        {applyMsg && (
          <p className={`text-sm ${applyMsg.includes('!') ? 'text-green-400' : 'text-red-400'}`}>
            {applyMsg}
          </p>
        )}
      </div>
    </div>
  )
}
