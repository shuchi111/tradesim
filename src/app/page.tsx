'use client'

import { useState, useCallback } from 'react'
import Header from '@/components/Header'
import StatsBar from '@/components/StatsBar'
import HomeTab from '@/components/tabs/HomeTab'
import HoldingsTab from '@/components/tabs/HoldingsTab'
import ChartTab from '@/components/tabs/ChartTab'
import StrategyTab from '@/components/tabs/StrategyTab'
import BacktestTab from '@/components/tabs/BacktestTab'
import WalletTab from '@/components/tabs/WalletTab'
import TradeIntelligenceTab from '@/components/tabs/TradeIntelligenceTab'
import ReportsTab from '@/components/tabs/ReportsTab'
import ConfidenceTab from '@/components/tabs/ConfidenceTab'
import HealthTab from '@/components/tabs/HealthTab'
import ScannerTab from '@/components/tabs/ScannerTab'
import ForecastTab from '@/components/tabs/ForecastTab'
import NotificationBell from '@/components/NotificationBell'

export type TabName =
  | 'home' | 'holdings' | 'chart' | 'strategy' | 'backtest' | 'wallet'
  | 'intelligence' | 'reports' | 'confidence' | 'health' | 'scanner' | 'forecast'

const TABS: { id: TabName; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'holdings', label: 'Holdings', icon: '📊' },
  { id: 'chart', label: 'Chart', icon: '📈' },
  { id: 'strategy', label: 'Strategy', icon: '🎯' },
  { id: 'backtest', label: 'Backtest', icon: '🧪' },
  { id: 'intelligence', label: 'Trade Intel', icon: '🔍' },
  { id: 'confidence', label: 'AI Score', icon: '🧠' },
  { id: 'scanner', label: 'Tauric', icon: '🔬' },
  { id: 'forecast', label: 'AI Forecast', icon: '🔮' },
  { id: 'health', label: 'Health', icon: '💪' },
  { id: 'reports', label: 'Reports', icon: '📄' },
  { id: 'wallet', label: 'Wallet', icon: '💰' },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>('home')
  const [symbol, setSymbol] = useState('NIFTY50')
  const [timeframe, setTimeframe] = useState('1d')
  const [refreshKey, setRefreshKey] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleTradeComplete = () => {
    bumpRefresh()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        symbol={symbol}
        onSymbolChange={setSymbol}
        refreshKey={refreshKey}
      />
      <StatsBar refreshKey={refreshKey} />

      {/* Tab navigation */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
        <div className="ml-auto shrink-0 pl-2">
          <NotificationBell
            refreshKey={refreshKey}
            onJobReady={bumpRefresh}
            onNavigate={(tab: string, sym?: string) => {
              setActiveTab(tab as TabName)
              if (sym) setSymbol(sym)
              bumpRefresh()
            }}
          />
        </div>
      </nav>

      {/* Tab content */}
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'home' && (
          <HomeTab
            symbol={symbol}
            refreshKey={refreshKey}
            onTradeComplete={handleTradeComplete}
          />
        )}
        {activeTab === 'holdings' && (
          <HoldingsTab refreshKey={refreshKey} onTradeComplete={handleTradeComplete} />
        )}
        {activeTab === 'chart' && (
          <ChartTab
            symbol={symbol}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            onSymbolChange={setSymbol}
            onTradeComplete={handleTradeComplete}
          />
        )}
        {activeTab === 'strategy' && (
          <StrategyTab onTradeComplete={handleTradeComplete} refreshKey={refreshKey} />
        )}
        {activeTab === 'backtest' && <BacktestTab refreshKey={refreshKey} />}
        {activeTab === 'intelligence' && <TradeIntelligenceTab refreshKey={refreshKey} />}
        {activeTab === 'confidence' && <ConfidenceTab refreshKey={refreshKey} />}
        {activeTab === 'health' && <HealthTab refreshKey={refreshKey} />}
        {activeTab === 'scanner' && <ScannerTab refreshKey={refreshKey} />}
        {activeTab === 'forecast' && <ForecastTab symbol={symbol} refreshKey={refreshKey} />}
        {activeTab === 'reports' && <ReportsTab refreshKey={refreshKey} />}
        {activeTab === 'wallet' && <WalletTab refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
