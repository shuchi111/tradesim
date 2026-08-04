'use client';

import { useState, useEffect } from 'react';

const API_BASE = '/api/agents';

interface Agent {
  id: string;
  name: string;
  team: string;
  role: string;
  icon: string;
}

interface AgentReports {
  market_analyst?: string;
  social_analyst?: string;
  news_analyst?: string;
  fundamentals_analyst?: string;
  situation_summary?: string;
  bull_researcher?: string;
  bear_researcher?: string;
  research_manager?: string;
  trader?: string;
  aggressive_debator?: string;
  neutral_debator?: string;
  conservative_debator?: string;
  risk_manager?: string;
  [key: string]: string | undefined;
}

interface Recommendation {
  signal: string;
  confidence: number;
  size_fraction: number;
  target_price: number | null;
  stop_loss: number | null;
  time_horizon_days: number | null;
  currency: string | null;
  rationale: string;
  warning_message: string | null;
  entry_reference_price: number | null;
}

interface AnalysisResult {
  ticker: string;
  trade_date: string;
  timestamp: string;
  agent_reports: AgentReports;
  final_trade_decision: string;
  recommendation: Recommendation;
}

interface HistoryItem {
  id?: number;
  ticker: string;
  trade_date: string;
  signal: string;
  confidence: number;
  size_fraction: number;
  target_price: number | null;
  stop_loss: number | null;
  log_file?: string;
  task_id?: string;
  cached?: boolean;
}

async function fetchHistory(): Promise<HistoryItem[]> {
  try {
    const resp = await fetch(`${API_BASE}/history?limit=20`);
    const data = await resp.json();
    return data.history || [];
  } catch {
    return [];
  }
}

const TEAM_COLORS: Record<string, string> = {
  'Analyst Team': 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  'Research Team': 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  'Trading': 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  'Risk Management': 'bg-red-500/10 border-red-500/30 text-red-300',
};

const SIGNAL_COLORS: Record<string, string> = {
  BUY: 'bg-green-500/20 text-green-400 border-green-500/40',
  SELL: 'bg-red-500/20 text-red-400 border-red-500/40',
  HOLD: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
};

export default function AgentPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticker, setTicker] = useState('RELIANCE.NS');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // Load agents + history once on mount
  useEffect(() => {
    fetch(API_BASE)
      .then(r => r.json())
      .then(data => setAgents(data.agents || []))
      .catch(() => {});
    fetchHistory().then(setHistory);
  }, []);

  // Load cached result when ticker changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/cached?ticker=${encodeURIComponent(ticker)}`);
        if (cancelled) return;

        if (!resp.ok) {
          setResult(null);
          setFromCache(false);
          return;
        }

        const data = await resp.json();
        if (cancelled) return;

        if (data.cached && data.result) {
          setResult(data.result);
          setFromCache(true);
          setStatus('idle');
        } else {
          setResult(null);
          setFromCache(false);
        }
      } catch {
        if (!cancelled) {
          setResult(null);
          setFromCache(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const loadHistoryItem = async (item: HistoryItem) => {
    if (!item.id) return;
    try {
      const resp = await fetch(`${API_BASE}/${item.id}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.result) {
        setTicker(item.ticker);
        setResult(data.result);
        setFromCache(true);
        setSelectedAgent(null);
        setError(null);
      }
    } catch {
      // ignore
    }
  };

  // Poll for task status
  useEffect(() => {
    if (!taskId) return;
    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`${API_BASE}/status/${taskId}`);
        const data = await resp.json();
        setStatus(data.status);
        setProgress(data.progress || '');

        if (data.status === 'completed' && data.result) {
          setResult(data.result);
          setFromCache(false);
          setTaskId(null);
          fetchHistory().then(setHistory);
          clearInterval(interval);
        } else if (data.status === 'failed') {
          setError(data.error || 'Analysis failed');
          setTaskId(null);
          clearInterval(interval);
        }
      } catch {
        // ignore poll errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  const startAnalysis = async (force = true) => {
    setError(null)
    if (force) {
      setResult(null)
      setFromCache(false)
    }
    setStatus('starting')
    try {
      const resp = await fetch(
        `${API_BASE}/analyze?ticker=${encodeURIComponent(ticker)}${force ? '&force=true' : ''}`
      )
      const text = await resp.text()
      let data: {
        task_id?: string
        cached?: boolean
        result?: AnalysisResult
        detail?: string
        message?: string
        error?: string
      } = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(
          resp.ok
            ? 'Invalid response from server'
            : `Scanner unavailable (${resp.status}). Start it with: npm run scanner`
        )
      }
      if (!resp.ok) {
        throw new Error(data.error || data.detail || data.message || `Server error (${resp.status})`)
      }
      if (data.cached && data.result) {
        setResult(data.result)
        setFromCache(true)
        setStatus('idle')
        return
      }
      if (data.task_id) {
        setTaskId(data.task_id)
        setStatus('queued')
      } else {
        throw new Error('Server did not return a task id')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
      setStatus('idle')
    }
  }

  const teams = [...new Set(agents.map(a => a.team))];
  const isRunning = status === 'queued' || status === 'running' || status === 'starting';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/40 rounded-xl p-6 border border-indigo-500/20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            🏛️ Tauric Research TradingAgents
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            10-agent AI trading firm — analysts debate, researchers argue, risk managers decide
          </p>
        </div>
      </div>

      {/* Analysis Input */}
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">Stock Ticker</label>
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              placeholder="e.g. RELIANCE.NS, AAPL, TCS.NS"
              disabled={isRunning}
              className="w-full bg-slate-900 text-white px-3 py-2 rounded-lg border border-slate-600 focus:border-indigo-500 outline-none disabled:opacity-50"
            />
          </div>
          <button
            onClick={() => startAnalysis(true)}
            disabled={isRunning || !ticker}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isRunning ? '⏳ Analyzing...' : '🚀 Run 10-Agent Analysis'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Runs 10 AI agents (analysts → bull/bear debate → trader → risk management debate → final decision).
          Takes 3-8 minutes. Results are saved to the database and shown instantly next time.
        </p>
        {fromCache && result && !isRunning && (
          <p className="text-xs text-emerald-400 mt-1">
            Showing cached analysis from {result.trade_date}. Click Run to generate a fresh one.
          </p>
        )}
      </div>

      {/* Status / Progress */}
      {isRunning && (
        <div className="bg-indigo-900/20 rounded-xl p-4 border border-indigo-500/30">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
            <div>
              <div className="text-indigo-300 font-medium">{progress || 'Starting...'}</div>
              <div className="text-xs text-gray-500">
                Task: {taskId} — polling every 5s
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 rounded-xl p-4 border border-red-500/30">
          <div className="text-red-400 font-medium">❌ {error}</div>
        </div>
      )}

      {/* Result */}
      {result && (
        <AgentResult result={result} agents={agents} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} />
      )}

      {/* Agents Grid (always visible) */}
      {!result && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-300">The 10-Agent Trading Firm</h3>
          {teams.map(team => (
            <div key={team}>
              <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">{team}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agents.filter(a => a.team === team).map(agent => (
                  <div
                    key={agent.id}
                    className={`rounded-lg p-3 border ${TEAM_COLORS[agent.team] || 'bg-slate-800 border-slate-700'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{agent.icon}</span>
                      <span className="font-medium text-sm text-white">{agent.name}</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{agent.role}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Past Agent Analyses</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Ticker</th>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-center py-2 px-2">Signal</th>
                  <th className="text-center py-2 px-2">Confidence</th>
                  <th className="text-center py-2 px-2">Size</th>
                  <th className="text-right py-2 px-2">Target</th>
                  <th className="text-right py-2 px-2">Stop Loss</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr
                    key={h.id ?? i}
                    onClick={() => loadHistoryItem(h)}
                    className="border-b border-slate-700/50 hover:bg-slate-800/50 cursor-pointer"
                  >
                    <td className="py-2 px-2 text-white font-medium">{h.ticker}</td>
                    <td className="py-2 px-2 text-gray-400">{h.trade_date}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_COLORS[h.signal] || ''}`}>
                        {h.signal}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-gray-300">
                      {(h.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 px-2 text-center text-gray-300">
                      {(h.size_fraction * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 px-2 text-right text-green-400">
                      {h.target_price ? `₹${h.target_price.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2 px-2 text-right text-red-400">
                      {h.stop_loss ? `₹${h.stop_loss.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentResult({
  result,
  agents,
  selectedAgent,
  setSelectedAgent,
}: {
  result: AnalysisResult;
  agents: Agent[];
  selectedAgent: string | null;
  setSelectedAgent: (v: string | null) => void;
}) {
  const { recommendation: rec, agent_reports: reports } = result;
  const signalColor = SIGNAL_COLORS[rec?.signal] || '';

  const agentReportMap: Record<string, string> = {
    market_analyst: reports.market_analyst || '',
    social_analyst: reports.social_analyst || '',
    news_analyst: reports.news_analyst || '',
    fundamentals_analyst: reports.fundamentals_analyst || '',
    bull_researcher: reports.bull_researcher || '',
    bear_researcher: reports.bear_researcher || '',
    research_manager: reports.research_manager || '',
    trader: reports.trader || '',
    aggressive_debator: reports.aggressive_debator || '',
    neutral_debator: reports.neutral_debator || '',
    conservative_debator: reports.conservative_debator || '',
    risk_manager: reports.risk_manager || '',
  };

  return (
    <div className="space-y-4">
      {/* Final Decision Card */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-gray-500 uppercase">Final Decision</div>
            <div className="text-xl font-bold text-white">{result.ticker}</div>
            <div className="text-xs text-gray-500">{result.trade_date}</div>
          </div>
          <div className={`px-6 py-3 rounded-xl border-2 ${signalColor}`}>
            <div className="text-3xl font-black">{rec?.signal || 'UNKNOWN'}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Stat label="Confidence" value={rec ? `${(rec.confidence * 100).toFixed(0)}%` : '-'} />
          <Stat label="Position Size" value={rec ? `${(rec.size_fraction * 100).toFixed(0)}% of capital` : '-'} />
          <Stat label="Target" value={rec?.target_price ? `₹${rec.target_price.toFixed(2)}` : '-'} color="text-green-400" />
          <Stat label="Stop Loss" value={rec?.stop_loss ? `₹${rec.stop_loss.toFixed(2)}` : '-'} color="text-red-400" />
          <Stat label="Hold Days" value={rec?.time_horizon_days ? `${rec.time_horizon_days}d` : '-'} />
        </div>

        {rec?.rationale && (
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-gray-500 mb-1">Rationale</div>
            <p className="text-sm text-gray-300 leading-relaxed">{rec.rationale}</p>
          </div>
        )}
        {rec?.warning_message && (
          <div className="mt-2 text-xs text-yellow-400">⚠️ {rec.warning_message}</div>
        )}
      </div>

      {/* Agent Reports */}
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📊 Individual Agent Reports</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {agents.map(agent => {
            const reportText = agentReportMap[agent.id] || '';
            const hasContent = reportText.length > 10;
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  selectedAgent === agent.id
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : hasContent
                    ? 'bg-slate-700/50 border-slate-600 text-gray-300 hover:bg-slate-700'
                    : 'bg-slate-800/30 border-slate-700/30 text-gray-600'
                }`}
              >
                {agent.icon} {agent.name}
              </button>
            );
          })}
        </div>

        {selectedAgent && (
          <div className="bg-slate-900/70 rounded-lg p-4 border border-slate-700/50 max-h-96 overflow-y-auto">
            <div className="text-xs text-gray-500 mb-2 uppercase">
              {agents.find(a => a.id === selectedAgent)?.name} Report
            </div>
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
              {agentReportMap[selectedAgent] || 'No report generated for this agent.'}
            </pre>
          </div>
        )}
      </div>

      {/* Final Trade Decision (Risk Manager) */}
      {result.final_trade_decision && (
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">🏛️ Risk Manager Final Decision</h3>
          <div className="bg-slate-900/70 rounded-lg p-4 border border-slate-700/50 max-h-96 overflow-y-auto">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
              {result.final_trade_decision}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
