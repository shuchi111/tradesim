'use client'

import StrategyPanel from '@/components/StrategyPanel'

interface StrategyTabProps {
  onTradeComplete: () => void
}

const STRATEGIES = [
  {
    icon: '🎯',
    name: 'Multi-Indicator Confluence',
    color: 'green',
    description: 'SMA(5/20) crossover + RSI(14) + MACD + Bollinger Bands + Volume',
    entry: [
      'SMA(5/20) golden cross or bullish alignment (+1 to +2)',
      'RSI(14) < 45 — oversold momentum (+1 to +2)',
      'MACD bullish crossover — histogram > 0 (+2)',
      'Lower Bollinger Band — mean reversion (+1)',
      'High volume > 1.5× average confirms (+0.5)',
    ],
    best: 'Trending markets with clear momentum',
  },
  {
    icon: '🚀',
    name: 'Momentum Breakout',
    color: 'blue',
    description: 'Price breaks above 20-day high with volume surge',
    entry: [
      'Price closes above 20-day high (+3)',
      'Volume > 1.5× 20-day average (+2)',
      'RSI 40–70 — momentum without overbought (+1)',
      'SMA5 > SMA20 — trend aligned (+1)',
    ],
    best: 'Stocks beginning large directional moves',
  },
  {
    icon: '↩️',
    name: 'Mean Reversion',
    color: 'yellow',
    description: 'Oversold bounce — RSI < 35 + lower Bollinger + above SMA50',
    entry: [
      'RSI(14) < 35 — deeply oversold (+2 to +3)',
      'Price at/below lower Bollinger Band (+2)',
      'RSI turning up — bounce starting (+2)',
      'Price above SMA50 — structural support (+2)',
    ],
    best: 'Range-bound or choppy markets',
  },
  {
    icon: '📈',
    name: 'EMA Crossover Trend',
    color: 'green',
    description: 'EMA(9/21) crossover with SMA50 trend filter + MACD confirm',
    entry: [
      'EMA(9) crosses above EMA(21) (+3)',
      'Price above SMA50 — long-term uptrend (+2)',
      'MACD histogram > 0 — momentum confirms (+2)',
    ],
    best: 'Early trend entries — faster than SMA crossover',
  },
]

export default function StrategyTab({ onTradeComplete }: StrategyTabProps) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <StrategyPanel onTradeComplete={onTradeComplete} />

      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-bold">🧠 Multi-Strategy Trading Engine</h2>
          <span className="rounded-md bg-[var(--blue)]/20 px-2 py-0.5 text-xs font-medium text-[var(--blue)]">
            5 Strategies · Consensus Voting
          </span>
        </div>

        {/* Consensus explanation */}
        <div className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-2 font-bold text-[var(--blue)]">⚖️ How the Consensus Engine Works</h3>
          <div className="grid grid-cols-3 gap-4 text-xs text-[var(--text-secondary)]">
            <div>
              <div className="mb-1 font-bold text-[var(--green)]">Strong BUY</div>
              <div>2+ strategies agree → confidence boosted +10% per agreeing strategy. Requires 70% confidence to enter.</div>
            </div>
            <div>
              <div className="mb-1 font-bold text-[var(--yellow)]">Single BUY</div>
              <div>1 strategy votes BUY → base confidence. Requires 80% confidence to enter.</div>
            </div>
            <div>
              <div className="mb-1 font-bold text-[var(--red)]">SELL Exit</div>
              <div>2+ strategies vote SELL → strong exit. 1 strategy SELL → also triggers position close.</div>
            </div>
          </div>
        </div>

        {/* Strategy cards */}
        <div className="grid grid-cols-2 gap-4">
          {STRATEGIES.map((s) => (
            <div key={s.name} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg">{s.icon}</span>
                <h3 className={`font-bold text-[var(--${s.color})]`}>{s.name}</h3>
              </div>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">{s.description}</p>
              <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                {s.entry.map((rule, i) => (
                  <li key={i}>• {rule}</li>
                ))}
              </ul>
              <div className="mt-2 border-t border-[var(--border-color)] pt-2 text-xs">
                <span className="text-[var(--text-secondary)]">Best for: </span>
                <span className="text-[var(--text-primary)]">{s.best}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Risk Management */}
        <div className="mt-4 rounded-lg border border-[var(--yellow)]/30 bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-2 font-bold text-[var(--yellow)]">🛡️ Risk Management — Portfolio Protection</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--text-secondary)]">
            <div>🛑 <b>Hard Stop-Loss:</b> Auto-close at <span className="text-[var(--red)]">-7%</span> loss</div>
            <div>🎯 <b>Take-Profit:</b> Auto-close at <span className="text-[var(--green)]">+15%</span> gain</div>
            <div>🔒 <b>Trailing Stop:</b> Lock profits above <span className="text-[var(--green)]">+7%</span> (protects 60%)</div>
            <div>💸 <b>Partial Profit:</b> Sell 50% at <span className="text-[var(--green)]">+5%</span>, stop → breakeven</div>
            <div>⏰ <b>Time Exit:</b> Close after 10 days if stagnant (&lt;3% move)</div>
            <div>⚠️ <b>Circuit Breaker:</b> Stop buying if drawdown &gt; <span className="text-[var(--red)]">6%</span></div>
            <div>📊 <b>Max Positions:</b> 8 instruments simultaneously</div>
            <div>💰 <b>Cash Reserve:</b> Always keep <span className="text-[var(--green)]">30%</span> in cash</div>
            <div>📏 <b>Position Sizing:</b> 4–8% of equity (confidence-tiered)</div>
            <div>📅 <b>Daily Loss Limit:</b> Stop if daily loss &gt; <span className="text-[var(--red)]">2.5%</span> of equity</div>
            <div>🔍 <b>Scans:</b> All 50 NIFTY stocks every 2 minutes</div>
            <div>🎯 <b>Min Confidence:</b> 70% (multi-strategy) / 80% (single strategy)</div>
          </div>
        </div>

        {/* Auto-trade info */}
        <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 text-xs text-[var(--text-secondary)]">
          <b className="text-[var(--text-primary)]">🤖 Fully Automated:</b> The auto-trade bot runs as a background service — it trades 24/7 even when your browser is closed.
          It runs all 5 strategies on every NIFTY 50 stock every <b>2 minutes</b>, aggregates their votes into a consensus signal,
          and executes trades with full risk management. Multi-strategy agreement means higher conviction entries and fewer false signals.
        </div>
      </div>
    </div>
  )
}
