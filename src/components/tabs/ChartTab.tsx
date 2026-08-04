'use client'

import Chart from '@/components/Chart'
import TradingPanel from '@/components/TradingPanel'
import { INSTRUMENTS } from '@/types'

interface ChartTabProps {
  symbol: string
  timeframe: string
  onTimeframeChange: (tf: string) => void
  onSymbolChange: (s: string) => void
  onTradeComplete: () => void
}

export default function ChartTab({ symbol, timeframe, onTimeframeChange, onSymbolChange, onTradeComplete }: ChartTabProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Symbol strip */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst.symbol}
              onClick={() => onSymbolChange(inst.symbol)}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium ${
                symbol === inst.symbol
                  ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {inst.base}
            </button>
          ))}
        </div>

        <Chart
          symbol={symbol}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
        />
      </div>

      <div className="w-[320px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto">
        <TradingPanel symbol={symbol} onTradeComplete={onTradeComplete} />
      </div>
    </div>
  )
}
