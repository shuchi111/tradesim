'use client'

import { useEffect, useState } from 'react'
import { useCurrency } from '@/lib/currency'

interface StatsBarProps {
  refreshKey: number
}

interface AccountStats {
  balance: number
  startingEquity: number
  equity: number
  positionsValue: number
  sipAmountInr: number
  sipDayOfMonth?: number
  sipEligibleFrom?: string | null
  lastSipDate: string | null
  totalDeposited?: number
}

function formatSipStatus(stats: AccountStats): string {
  if (stats.lastSipDate) {
    return `Last: ${new Date(stats.lastSipDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
  }

  const sipDay = stats.sipDayOfMonth ?? 7
  const now = new Date()
  const istDay = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(now)
  )
  const istMonth = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
  }).format(now)

  if (istDay >= sipDay) {
    return `Due: ${sipDay} ${istMonth} (on auto-trade)`
  }
  return `Next: ${sipDay} ${istMonth}`
}

interface ClosedStats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  realizedPnl: number
}

export default function StatsBar({ refreshKey }: StatsBarProps) {
  const [stats, setStats] = useState<AccountStats | null>(null)
  const [closedStats, setClosedStats] = useState<ClosedStats | null>(null)
  const { fmt } = useCurrency()

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [accountRes, closedRes] = await Promise.all([
          fetch('/api/account'),
          fetch('/api/trades/closed'),
        ])
        const accountJson = await accountRes.json()
        if (accountJson.data) setStats(accountJson.data)

        const closedJson = await closedRes.json()
        if (closedJson.stats) setClosedStats(closedJson.stats)
      } catch {
        // ignore
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [refreshKey])

  const totalDeposited =
    stats?.totalDeposited && stats.totalDeposited > 0
      ? stats.totalDeposited
      : stats?.lastSipDate
        ? stats.sipAmountInr
        : 0
  const investedCapital = stats ? stats.startingEquity + totalDeposited : 0
  // Exclude SIP deposits from P&L
  const totalPnl = stats ? stats.equity - investedCapital : 0
  const pnlPercent = investedCapital > 0 ? (totalPnl / investedCapital) * 100 : 0
  const isPositive = totalPnl >= 0

  return (
    <div className="flex items-center gap-5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2 overflow-x-auto">
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">Portfolio Value</span>
        <span className="text-base font-semibold tabular-nums">
          {stats ? fmt(stats.equity, { decimals: 0 }) : '—'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">Available Balance</span>
        <span className="text-base font-semibold tabular-nums">
          {stats ? fmt(stats.balance, { decimals: 0 }) : '—'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">Positions Value</span>
        <span className="text-base font-semibold tabular-nums">
          {stats ? fmt(stats.positionsValue, { decimals: 0 }) : '—'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">Total P&L</span>
        <span className={`text-base font-semibold tabular-nums ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
          {isPositive ? '+' : '-'}{stats ? fmt(Math.abs(totalPnl), { decimals: 0 }) : '—'}
          {' '}
          ({isPositive ? '+' : ''}{(pnlPercent ?? 0).toFixed(2)}%)
        </span>
      </div>
      {closedStats && closedStats.totalTrades > 0 && (
        <div className="flex flex-col">
          <span className="text-xs text-[var(--text-secondary)]">Win Rate</span>
          <span className="text-base font-semibold tabular-nums">
            {closedStats.winRate.toFixed(1)}%
            <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
              ({closedStats.wins}W / {closedStats.losses}L)
            </span>
          </span>
        </div>
      )}
      {closedStats && closedStats.totalTrades > 0 && (
        <div className="flex flex-col">
          <span className="text-xs text-[var(--text-secondary)]">Realized P&L</span>
          <span className={`text-base font-semibold tabular-nums ${closedStats.realizedPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
            {closedStats.realizedPnl >= 0 ? '+' : '-'}{fmt(Math.abs(closedStats.realizedPnl), { decimals: 0 })}
          </span>
        </div>
      )}
      {stats && (
        <div className="flex flex-col">
          <span className="text-xs text-[var(--text-secondary)]">📅 SIP ₹{stats.sipAmountInr.toLocaleString('en-IN')}/mo</span>
          <span className="text-xs font-medium tabular-nums text-[var(--green)]">
            {formatSipStatus(stats)}
          </span>
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">📉 Sell Penalty</span>
        <span className="text-xs font-medium tabular-nums text-[var(--red)]">₹150 / sell</span>
      </div>
    </div>
  )
}
